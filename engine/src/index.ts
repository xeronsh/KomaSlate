/** Workflow engine sidecar HTTP entry (loopback only). */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { EngineDatabase } from "./db.js";
import {
  TextLlmService,
  type RunCreativeContext,
  type TextProviderSnapshot,
} from "./llm.js";
import { SharedDb, parseJsonColumn } from "./shared-db.js";
import { PipelineRunner } from "./pipeline/runner.js";
import {
  applyInvalidationPlan,
  type RerunIntent,
} from "./invalidation.js";
import { PRODUCTION_STAGE_SEQUENCE, WORKFLOW_VERSION } from "./contract.js";
import { ChatAgents, ChatBusyError } from "./agent/index.js";
import { backendFetch } from "./agent/tools.js";
import { sharedBackendWorkerPool } from "./backend-worker.js";
import { McpClientPool } from "./mcp/index.js";

const execFileAsync = promisify(execFile);

interface CliToolSpec {
  id: string;
  label: string;
  command: string;
  probeArgs: string[];
  description: string;
}

const REGISTERED_CLI_TOOLS: readonly CliToolSpec[] = [
  {
    id: "komaslate",
    label: "komaslate CLI",
    command: "komaslate",
    probeArgs: ["--help"],
    description: "KomaSlate 统一命令行工具",
  },
  {
    id: "ffmpeg",
    label: "ffmpeg",
    command: "ffmpeg",
    probeArgs: ["-version"],
    description: "音视频拼接与字幕烧录工具",
  },
  {
    id: "ffprobe",
    label: "ffprobe",
    command: "ffprobe",
    probeArgs: ["-version"],
    description: "媒体时长与流探测工具",
  },
  {
    id: "dreamina",
    label: "dreamina",
    command: "dreamina",
    probeArgs: ["--version"],
    description: "Dreamina CLI 图像/视频工具",
  },
  {
    id: "engine_media_cli",
    label: "engine_media_cli",
    command: process.env.ENGINE_PYTHON ?? "python",
    probeArgs: ["-m", "app.services.engine_media_cli", "--help"],
    description: "Backend 常驻媒体 Worker CLI",
  },
  {
    id: "komaslate-media",
    label: "komaslate media",
    command: "komaslate",
    probeArgs: ["media", "--help"],
    description: "KomaSlate 独立媒体子命令",
  },
];

const LEASE_TTL_SECONDS = 120;
const LEASE_HEARTBEAT_MS = 30_000;
const INVALIDATION_CHECKPOINT = "__invalidation__";
type ExecutionCommand = {
  version: 1;
  stage: NonNullable<Parameters<PipelineRunner["run"]>[0]["startStage"]> | "full";
  auto_mode: boolean;
  user_feedback: string;
  target_character_ids: number[];
  target_shot_ids: number[];
  force_regenerate?: boolean;
};
type LegacyFullCommand = ExecutionCommand & {
  stage: "full";
  auto_mode: false;
  user_feedback: "";
  target_character_ids: [];
  target_shot_ids: [];
};

export function createEngineApp(dbPath: string) {
  const db = new EngineDatabase(dbPath);
  const llm = new TextLlmService(db);
  const shared = new SharedDb(db.db);
  const pipelines = new Map<number, PipelineRunner>();
  const ownerId = `engine-${process.pid}-${randomUUID()}`;
  const chat = new ChatAgents({
    db,
    llm,
    api: backendFetch(process.env.KOMASLATE_BACKEND_URL ?? process.env.OPENOII_BACKEND_URL ?? "http://127.0.0.1:18765"),
  });
  const mcpPool = new McpClientPool(db);
  mcpPool.startHealthMonitor();

  function runContext(runId: number): RunCreativeContext {
    const row = shared.getRun(runId);
    return parseJsonColumn(row?.context_snapshot, {} as RunCreativeContext);
  }

  function runRerunIntent(runId: number): RerunIntent | undefined {
    const row = db.db
      .prepare("SELECT patch_plan FROM agentrun WHERE id = ?")
      .get(runId) as { patch_plan: string | null } | undefined;
    const plan = parseJsonColumn(row?.patch_plan, null as RerunIntent | null);
    return plan ?? undefined;
  }

  function runScopedLlm(context: RunCreativeContext): TextLlmService {
    const providers =
      typeof context.providers === "object" && context.providers !== null
        ? (context.providers as Record<string, unknown>)
        : {};
    const text =
      typeof providers.text === "object" && providers.text !== null
        ? (providers.text as TextProviderSnapshot)
        : undefined;
    return llm.forSnapshot(text, context);
  }

  function startPipeline(
    runId: number,
    request: Parameters<PipelineRunner["run"]>[0],
    mode: "run" | "resume",
    recoveredCommand?: LegacyFullCommand,
  ): boolean {
    if (pipelines.has(runId)) return false;
    // Callers have already checked the stored run (checkStoredRun): it exists, belongs
    // to this project and matches WORKFLOW_VERSION. Nothing awaits in between.

    const leaseToken = randomUUID();
    if (!shared.acquireRunLease(runId, ownerId, leaseToken, LEASE_TTL_SECONDS)) {
      db.transaction(() => {
        const info = db.db
          .prepare(
            `UPDATE agentrun
             SET status = 'cancelled', awaiting_payload = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ? AND cancel_requested_at IS NOT NULL
               AND status IN ('queued','running','waiting_for_approval','cancelling')
               AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= datetime('now'))`,
          )
          .run(runId);
        if (info.changes === 1) {
          db.appendEvent(runId, request.projectId, "run_cancelled", {
            run_id: runId,
            project_id: request.projectId,
            cancelled_count: 1,
            run_ids: [runId],
          });
        }
      });
      return false;
    }

    try {
      if (recoveredCommand) persistRecoveredCommand(db, runId, leaseToken, recoveredCommand);
      const context = runContext(runId);
      const fencedShared = shared.fenced(runId, leaseToken);
      const plan = runRerunIntent(runId);
      const targetIds = Array.isArray(plan?.scope?.entity_ids)
        ? plan.scope.entity_ids.filter((id) => Number.isSafeInteger(id) && id > 0)
        : [];
      const scopedRequest =
        request.targetCharacterIds?.length || request.targetShotIds?.length || !targetIds.length
          ? request
          : plan?.scope.entity_type === "character"
            ? { ...request, targetCharacterIds: targetIds }
            : plan?.scope.entity_type === "shot"
              ? { ...request, targetShotIds: targetIds }
              : request;
      if (plan && !db.checkpointStages(runId).includes(INVALIDATION_CHECKPOINT)) {
        // Persist the resolved rerun stage under the fencing lease; artifact references
        // are invalidated only in the transaction that commits their replacements.
        const appliedStage = applyInvalidationPlan(fencedShared, request.projectId, plan);
        db.saveCheckpoint(runId, INVALIDATION_CHECKPOINT, {
          applied_at: new Date().toISOString(),
          version: plan.version,
          start_stage: appliedStage,
          scope: plan.scope,
        });
      }

      const runner = new PipelineRunner(db, fencedShared, runScopedLlm(context), context, {
        reclaimLease: () => reclaimLease(runId, request.projectId, leaseToken),
      });
      pipelines.set(runId, runner);

      const heartbeat = setInterval(() => {
        const renewed =
          shared.renewRunLease(runId, ownerId, leaseToken, LEASE_TTL_SECONDS) ||
          reclaimLease(runId, request.projectId, leaseToken);
        if (!renewed) {
          clearInterval(heartbeat);
          runner.requestCancel();
        }
      }, LEASE_HEARTBEAT_MS);
      heartbeat.unref();

      void runner[mode](scopedRequest)
        .catch((error: unknown) => {
          // A runner that rejects (lease lost while committing a failure) must not
          // take the whole sidecar down as an unhandled rejection.
          console.error(`run ${runId}: executor stopped with an uncaught error`, error);
        })
        .finally(() => {
          clearInterval(heartbeat);
          shared.releaseRunLease(runId, ownerId, leaseToken);
          if (pipelines.get(runId) === runner) pipelines.delete(runId);
        });
      return true;
    } catch (error) {
      shared.releaseRunLease(runId, ownerId, leaseToken);
      throw error;
    }
  }

  /** A missed heartbeat (suspended box) is not a dead executor: take the lease back if it is free. */
  function reclaimLease(runId: number, projectId: number, leaseToken: string): boolean {
    if (!shared.reclaimRunLease(runId, ownerId, leaseToken, LEASE_TTL_SECONDS)) return false;
    console.warn(`run ${runId}: lease renewal missed; reclaimed the free lease and kept running`);
    const run = shared.getRun(runId);
    db.appendEvent(runId, projectId, "run_progress", {
      run_id: runId,
      project_id: projectId,
      current_agent: run?.current_agent ?? null,
      progress: run?.progress ?? 0,
    });
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // POST /runs and POST /runs/:id/resume answer a missing / incompatible run the same way.
    const checkStoredRun = (runId: number, projectId: number): boolean => {
      const row = shared.getRun(runId);
      if (!row || row.project_id !== projectId) {
        send(404, {
          error: {
            code: "RUN_NOT_FOUND",
            message: `运行 ${runId} 不存在或不属于项目 ${projectId}`,
            details: { run_id: runId, project_id: projectId },
          },
        });
        return false;
      }
      if (row.workflow_version !== WORKFLOW_VERSION) {
        send(409, {
          error: {
            code: "RUN_WORKFLOW_INCOMPATIBLE",
            message: `运行 ${runId} 使用工作流版本 ${row.workflow_version}，当前引擎是版本 ${WORKFLOW_VERSION}，无法继续；请重新生成`,
            details: {
              run_id: runId,
              workflow_version: row.workflow_version,
              engine_workflow_version: WORKFLOW_VERSION,
            },
          },
        });
        return false;
      }
      return true;
    };
    const conflict = (runId: number): void => {
      send(409, {
        error: {
          code: "RUN_ALREADY_ACTIVE",
          message: `run ${runId} already has an active executor lease`,
          details: { run_id: runId },
        },
      });
    };

    if (req.method === "GET" && url.pathname === "/health") {
      send(200, {
        status: "ok",
        runs: pipelines.size,
        provider: llm.resolveProvider().key,
        workflow_version: WORKFLOW_VERSION,
        owner_id: ownerId,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      send(200, { runs: [...pipelines.keys()] });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/mcp/servers" || url.pathname === "/mcp/status")) {
      send(200, {
        servers: mcpPool.listStatus(),
        worker_pool: sharedBackendWorkerPool.stats(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/mcp/events") {
      const pidParam = url.searchParams.get("project_id");
      const limitParam = Number(url.searchParams.get("limit") ?? 100);
      const pid = pidParam !== null ? Number(pidParam) : undefined;
      const rows = db.recentProtocolEvents(
        pid !== undefined && Number.isFinite(pid) ? pid : undefined,
        Number.isFinite(limitParam) ? limitParam : 100,
      );
      send(200, {
        events: rows.map((row) => ({
          seq: row.seq,
          run_id: row.run_id,
          project_id: row.project_id,
          type: row.type,
          data: parseJsonColumn(row.payload, {}),
          created_at: row.created_at,
        })),
      });
      return;
    }

    const mcpPingMatch = /^\/mcp\/servers\/([^/]+)\/ping$/.exec(url.pathname);
    if (req.method === "POST" && (url.pathname === "/mcp/ping" || mcpPingMatch)) {
      const body = await readJson(req);
      const serverName = mcpPingMatch
        ? decodeURIComponent(mcpPingMatch[1]!)
        : typeof body.server_name === "string"
          ? body.server_name
          : "";
      if (!serverName) {
        send(422, { error: { code: "MCP_SERVER_REQUIRED", message: "server_name is required" } });
        return;
      }
      if (!mcpPool.getServerStatus(serverName)) {
        send(404, { error: { code: "MCP_SERVER_NOT_FOUND", message: `MCP server "${serverName}" is not registered` } });
        return;
      }
      const projectId = typeof body.project_id === "number" && Number.isFinite(body.project_id) ? body.project_id : 0;
      const snapshot = await mcpPool.pingServer(serverName, { projectId });
      send(200, {
        ok: snapshot.status === "connected",
        latency_ms: snapshot.latency_ms,
        error: snapshot.error,
        server: snapshot,
      });
      return;
    }

    const mcpPolicyMatch = /^\/mcp\/servers\/([^/]+)\/policy$/.exec(url.pathname);
    if (req.method === "PATCH" && mcpPolicyMatch) {
      const serverName = decodeURIComponent(mcpPolicyMatch[1]!);
      const body = await readJson(req);
      const rawPolicy = body.policy;
      const policy =
        rawPolicy === "read_only_auto" || rawPolicy === "auto_readonly"
          ? "read_only_auto"
          : rawPolicy === "confirm_writes"
            ? "confirm_writes"
            : null;
      if (!policy) {
        send(422, { error: { code: "MCP_POLICY_INVALID", message: "policy must be read_only_auto or confirm_writes" } });
        return;
      }
      const updated = mcpPool.setServerPolicy(serverName, policy);
      if (!updated) {
        send(404, { error: { code: "MCP_SERVER_NOT_FOUND", message: `MCP server "${serverName}" is not registered` } });
        return;
      }
      send(200, updated);
      return;
    }

    const mcpServerMatch = /^\/mcp\/servers\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PATCH" && mcpServerMatch) {
      const serverName = decodeURIComponent(mcpServerMatch[1]!);
      const body = await readJson(req);
      if (typeof body.enabled !== "boolean") {
        send(422, { error: { code: "MCP_ENABLED_INVALID", message: "enabled must be boolean" } });
        return;
      }
      const updated = mcpPool.setServerEnabled(serverName, body.enabled);
      if (!updated) {
        send(404, { error: { code: "MCP_SERVER_NOT_FOUND", message: `MCP server "${serverName}" is not registered` } });
        return;
      }
      send(200, updated);
      return;
    }

    if (req.method === "GET" && url.pathname === "/cli/tools") {
      send(200, {
        tools: REGISTERED_CLI_TOOLS.map((tool) => ({
          id: tool.id,
          label: tool.label,
          command: `${tool.command} ${tool.probeArgs.join(" ")}`,
          description: tool.description,
        })),
        worker_pool: sharedBackendWorkerPool.stats(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/cli/dry-run") {
      const body = await readJson(req);
      const toolId = typeof body.tool === "string" ? body.tool : "";
      const spec = REGISTERED_CLI_TOOLS.find((entry) => entry.id === toolId);
      if (!spec) {
        send(404, { error: { code: "CLI_TOOL_NOT_FOUND", message: `Unknown CLI tool: ${toolId}` } });
        return;
      }
      const projectId = typeof body.project_id === "number" && Number.isFinite(body.project_id) ? body.project_id : 0;
      const startedAt = Date.now();
      const command = spec.id === "engine_media_cli" ? (process.env.ENGINE_PYTHON ?? "python") : spec.command;
      db.appendEvent(0, projectId, "cli_process_started", {
        command: spec.id,
        args: spec.probeArgs,
        pid: null,
        stage: "dry_run",
        timestamp: new Date(startedAt).toISOString(),
      });
      try {
        const { stdout, stderr } = await execFileAsync(command, spec.probeArgs, {
          timeout: 5000,
          maxBuffer: 256 * 1024,
        });
        const trimmedOut = stdout.trim().slice(0, 2000);
        const trimmedErr = stderr.trim().slice(0, 2000);
        if (trimmedOut) {
          db.appendEvent(0, projectId, "cli_stdout", {
            command: spec.id,
            stream: "stdout",
            line: trimmedOut.split("\n")[0] ?? trimmedOut,
            pid: null,
            timestamp: new Date().toISOString(),
          });
        }
        db.appendEvent(0, projectId, "cli_process_exited", {
          command: spec.id,
          exit_code: 0,
          duration_ms: Date.now() - startedAt,
          pid: null,
          error: null,
          timestamp: new Date().toISOString(),
        });
        send(200, {
          ok: true,
          tool: spec.id,
          exit_code: 0,
          stdout: trimmedOut,
          stderr: trimmedErr,
          duration_ms: Date.now() - startedAt,
        });
      } catch (err) {
        const execErr = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
        const exitCode = typeof execErr.code === "number" ? execErr.code : 1;
        const message = execErr.message ?? "dry-run failed";
        db.appendEvent(0, projectId, "cli_process_exited", {
          command: spec.id,
          exit_code: exitCode,
          duration_ms: Date.now() - startedAt,
          pid: null,
          error: message.slice(0, 500),
          timestamp: new Date().toISOString(),
        });
        send(200, {
          ok: false,
          tool: spec.id,
          exit_code: exitCode,
          stdout: String(execErr.stdout ?? "").trim().slice(0, 2000),
          stderr: String(execErr.stderr ?? message).trim().slice(0, 2000),
          duration_ms: Date.now() - startedAt,
        });
      }
      return;
    }

    const runMatch = /^\/runs\/(\d+)(\/cancel|\/events|\/resume)?$/.exec(url.pathname);

    if (req.method === "POST" && url.pathname === "/runs") {
      const body = await readJson(req);
      const projectId = Number(body.project_id);
      const runId = Number(body.run_id ?? body.id);
      if (!Number.isFinite(projectId) || !Number.isFinite(runId)) {
        send(400, { error: "project_id and run_id are required" });
        return;
      }
      const rawStage = typeof body.stage === "string" ? body.stage : "";
      const numberArray = (value: unknown): number[] | undefined =>
        Array.isArray(value) && value.every((item) => typeof item === "number")
          ? (value as number[])
          : undefined;
      if (
        (Array.isArray(body.target_character_ids) && body.target_character_ids.length === 0) ||
        (Array.isArray(body.target_shot_ids) && body.target_shot_ids.length === 0)
      ) {
        send(400, { error: "target arrays must be omitted when no targets are requested" });
        return;
      }
      const targetCharacterIds = numberArray(body.target_character_ids);
      const targetShotIds = numberArray(body.target_shot_ids);
      const command = {
        version: 1,
        stage: rawStage,
        auto_mode: body.auto_mode,
        user_feedback: body.user_feedback,
        target_character_ids: targetCharacterIds ?? [],
        target_shot_ids: targetShotIds ?? [],
        force_regenerate: body.force_regenerate,
      };
      if (
        ("target_character_ids" in body && !targetCharacterIds) ||
        ("target_shot_ids" in body && !targetShotIds) ||
        !isExecutionCommand(command)
      ) {
        send(400, {
          error: {
            code: "RUN_COMMAND_INVALID",
            message: "Run stage, target scope, or command fields are invalid",
          },
        });
        return;
      }
      // isExecutionCommand already rejects both target kinds at once (RUN_COMMAND_INVALID).
      if (pipelines.has(runId)) {
        conflict(runId);
        return;
      }
      if (!checkStoredRun(runId, projectId)) return;
      const invalidTargets = invalidTargetIds(shared, projectId, targetCharacterIds, targetShotIds);
      if (invalidTargets.length) {
        send(400, { error: `target IDs not found in project ${projectId}: ${invalidTargets.join(", ")}` });
        return;
      }
      const started = startPipeline(
        runId,
        {
          projectId,
          runId,
          autoMode: command.auto_mode,
          userFeedback: command.user_feedback,
          startStage: command.stage === "full" ? undefined : command.stage,
          // Targeted redraw / fill scope; the engine decides which stages run.
          targetCharacterIds: command.target_character_ids.length
            ? command.target_character_ids
            : undefined,
          targetShotIds: command.target_shot_ids.length ? command.target_shot_ids : undefined,
          forceRegenerate: command.force_regenerate === true,
        },
        "run",
      );
      if (!started) {
        conflict(runId);
        return;
      }
      send(202, { status: "running", run_id: runId, project_id: projectId });
      return;
    }

    if (runMatch && req.method === "POST" && runMatch[2] === "/resume") {
      const runId = Number(runMatch[1]);
      const body = await readJson(req);
      const projectId = Number(body.project_id);
      if (!Number.isFinite(projectId)) {
        send(400, { error: "project_id is required" });
        return;
      }
      if (!checkStoredRun(runId, projectId)) return;
      const context = runContext(runId);
      if (typeof context !== "object" || context === null || Array.isArray(context)) {
        send(409, {
          error: {
            code: "RUN_COMMAND_UNRECOVERABLE",
            message: "Run context is malformed; safe recovery is unavailable",
          },
        });
        return;
      }
      const command = context.execution_command;
      const hasCommand = Object.hasOwn(context, "execution_command");
      let recoveryCommand: ExecutionCommand | undefined;
      if (!hasCommand) {
        recoveryCommand = legacyFullCommand(db, runId);
        if (!recoveryCommand) {
          send(409, {
            error: {
              code: "RUN_COMMAND_UNRECOVERABLE",
              message: "Run command is missing and its original scope cannot be proven; safe recovery is unavailable",
            },
          });
          return;
        }
      } else if (isExecutionCommand(command)) {
        recoveryCommand = command;
      } else {
        send(409, {
          error: {
            code: "RUN_COMMAND_UNRECOVERABLE",
            message: "Run command is malformed; safe recovery is unavailable",
          },
        });
        return;
      }
      const invalidTargets = invalidTargetIds(
        shared,
        projectId,
        recoveryCommand.target_character_ids,
        recoveryCommand.target_shot_ids,
      );
      if (invalidTargets.length) {
        send(409, {
          error: {
            code: "TARGET_NOT_FOUND",
            message: `target IDs no longer exist in project ${projectId}: ${invalidTargets.join(", ")}`,
            details: { project_id: projectId, target_ids: invalidTargets },
          },
        });
        return;
      }
      const started = startPipeline(
        runId,
        {
          projectId,
          runId,
          autoMode: recoveryCommand.auto_mode,
          userFeedback: recoveryCommand.user_feedback,
          startStage: recoveryCommand.stage === "full" ? undefined : recoveryCommand.stage,
          targetCharacterIds: recoveryCommand.target_character_ids.length
            ? recoveryCommand.target_character_ids
            : undefined,
          targetShotIds: recoveryCommand.target_shot_ids.length
            ? recoveryCommand.target_shot_ids
            : undefined,
          forceRegenerate: recoveryCommand.force_regenerate === true,
        },
        "resume",
        !hasCommand ? recoveryCommand as LegacyFullCommand : undefined,
      );
      if (!started) {
        conflict(runId);
        return;
      }
      send(202, { status: "running", run_id: runId, project_id: projectId });
      return;
    }

    if (runMatch && req.method === "POST" && runMatch[2] === "/cancel") {
      const runId = Number(runMatch[1]);
      shared.requestRunCancel(runId);
      pipelines.get(runId)?.requestCancel();
      send(202, { status: "cancelling" });
      return;
    }

    if (runMatch && req.method === "GET" && runMatch[2] === "/events") {
      const runId = Number(runMatch[1]);
      const after = Number(url.searchParams.get("after") ?? 0);
      const rows = db.eventsForRun(runId, Number.isFinite(after) ? after : 0);
      send(200, {
        events: rows.map((r) => ({
          seq: r.seq,
          event_id: r.seq,
          run_id: r.run_id,
          project_id: r.project_id,
          type: r.type,
          data: JSON.parse(r.payload) as unknown,
          created_at: r.created_at,
        })),
      });
      return;
    }

    const chatMatch = /^\/chat\/(\d+)(\/abort|\/confirm)?$/.exec(url.pathname);
    if (chatMatch) {
      const projectId = Number(chatMatch[1]);
      const action = chatMatch[2];
      if (req.method === "GET" && !action) {
        send(200, { messages: chat.history(projectId), ...chat.status(projectId) });
        return;
      }
      if (req.method === "POST" && action === "/abort") {
        send(200, { aborted: chat.abort(projectId) });
        return;
      }
      if (req.method === "POST" && action === "/confirm") {
        const body = await readJson(req);
        if (typeof body.tool_call_id !== "string" || typeof body.approved !== "boolean") {
          send(422, { error: { code: "CHAT_CONFIRM_INVALID", message: "需要 tool_call_id 和 approved" } });
          return;
        }
        if (!chat.confirm(projectId, body.tool_call_id, body.approved)) {
          send(404, { error: { code: "CHAT_CONFIRM_NOT_FOUND", message: "这个确认已经失效" } });
          return;
        }
        send(200, { ok: true });
        return;
      }
      if (req.method === "POST" && !action) {
        const content = (await readJson(req)).content;
        if (typeof content !== "string" || !content.trim()) {
          send(422, { error: { code: "CHAT_CONTENT_REQUIRED", message: "消息不能为空" } });
          return;
        }
        try {
          chat.send(projectId, content.trim()).done.catch((err: unknown) => {
            console.error(`chat turn failed for project ${projectId}:`, err);
          });
        } catch (err) {
          if (!(err instanceof ChatBusyError)) throw err;
          send(409, { error: { code: "CHAT_BUSY", message: "助手还在回答上一条消息" } });
          return;
        }
        send(202, { accepted: true });
        return;
      }
    }

    send(404, { error: "not found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof InvalidJsonError) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INVALID_JSON", message: err.message } }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    });
  });

  server.on("close", () => {
    void mcpPool.closeAll();
    void sharedBackendWorkerPool.closeAll();
  });

  return { server, db, llm, shared, pipelines, ownerId, chat, mcpPool };
}

function legacyFullCommand(
  db: EngineDatabase,
  runId: number,
): LegacyFullCommand | undefined {
  const row = db.db
    .prepare(
      "SELECT patch_plan, current_agent, resource_type, context_snapshot FROM agentrun WHERE id = ?",
    )
    .get(runId) as
    | {
        patch_plan: string | null;
        current_agent: string | null;
        resource_type: string | null;
        context_snapshot: string | null;
      }
    | undefined;
  if (!row) return undefined;
  if (row.context_snapshot === null) return undefined;
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.context_snapshot);
  } catch {
    return undefined;
  }
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot) ||
    Object.hasOwn(snapshot, "execution_command")
  ) return undefined;
  let started: unknown;
  let checkpoint: unknown;
  let hasUserMessage: unknown;
  try {
    started = db.db
      .prepare("SELECT 1 FROM engine_run_events WHERE run_id = ? LIMIT 1")
      .get(runId);
    checkpoint = db.db
      .prepare("SELECT 1 FROM engine_checkpoints WHERE run_id = ? LIMIT 1")
      .get(runId);
    hasUserMessage = db.db
      .prepare("SELECT 1 FROM agentmessage WHERE run_id = ? AND role = 'user' LIMIT 1")
      .get(runId);
  } catch {
    return undefined;
  }
  if (
    row.current_agent !== "orchestrator" ||
    row.resource_type !== null ||
    row.patch_plan !== null ||
    started ||
    checkpoint ||
    hasUserMessage
  ) return undefined;
  return {
    version: 1,
    stage: "full",
    auto_mode: false,
    user_feedback: "",
    target_character_ids: [],
    target_shot_ids: [],
  };
}

function persistRecoveredCommand(
  db: EngineDatabase,
  runId: number,
  leaseToken: string,
  command: NonNullable<ReturnType<typeof legacyFullCommand>>,
): void {
  db.transaction(() => {
    const row = db.db
      .prepare("SELECT context_snapshot FROM agentrun WHERE id = ? AND lease_token = ?")
      .get(runId, leaseToken) as { context_snapshot: string | null } | undefined;
    if (!row) throw new Error(`execution lease lost for run ${runId}`);
    const snapshot = parseJsonColumn(row.context_snapshot, {} as Record<string, unknown>);
    const existing = snapshot.execution_command;
    if (existing !== undefined && existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(command)) {
        throw new Error(`execution command changed during recovery for run ${runId}`);
      }
      return;
    }
    const result = db.db
      .prepare(
        `UPDATE agentrun SET context_snapshot = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND lease_token = ? AND lease_expires_at > datetime('now')
           AND cancel_requested_at IS NULL AND context_snapshot IS ?`,
      )
      .run(
        JSON.stringify({ ...snapshot, execution_command: command }),
        runId,
        leaseToken,
        row.context_snapshot,
      );
    if (result.changes !== 1) throw new Error(`execution lease lost for run ${runId}`);
  });
}

function invalidTargetIds(
  shared: SharedDb,
  projectId: number,
  characterIds: number[] | undefined,
  shotIds: number[] | undefined,
): number[] {
  const characters = new Set(shared.charactersForProject(projectId).map((row) => row.id));
  const shots = new Set(shared.shotsForProject(projectId).map((row) => row.id));
  return [
    ...(characterIds ?? []).filter((id) => !characters.has(id)),
    ...(shotIds ?? []).filter((id) => !shots.has(id)),
  ];
}

function isStageId(
  value: string,
): value is NonNullable<Parameters<PipelineRunner["run"]>[0]["startStage"]> {
  return (PRODUCTION_STAGE_SEQUENCE as readonly string[]).includes(value);
}

function isExecutionCommand(value: unknown): value is ExecutionCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const validIds = (ids: unknown): ids is number[] =>
    Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id) && id > 0);
  return (
    command.version === 1 &&
    typeof command.stage === "string" &&
    (command.stage === "full" || isStageId(command.stage)) &&
    typeof command.auto_mode === "boolean" &&
    typeof command.user_feedback === "string" &&
    (command.force_regenerate === undefined || typeof command.force_regenerate === "boolean") &&
    validIds(command.target_character_ids) &&
    validIds(command.target_shot_ids) &&
    new Set(command.target_character_ids).size === command.target_character_ids.length &&
    new Set(command.target_shot_ids).size === command.target_shot_ids.length &&
    !(command.target_character_ids.length && command.target_shot_ids.length) &&
    (!command.target_character_ids.length || command.stage === "render_characters") &&
    (!command.target_shot_ids.length ||
      command.stage === "render_shots" ||
      command.stage === "compose_videos") &&
    (!(command.target_character_ids.length || command.target_shot_ids.length) ||
      typeof command.force_regenerate === "boolean")
  );
}

class InvalidJsonError extends Error {}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (err) {
        reject(new InvalidJsonError(err instanceof Error ? err.message : "bad json"));
      }
    });
    req.on("error", reject);
  });
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith("index.ts");
if (isMain) {
  const defaultDb =
    !existsSync("data/komaslate.db") && existsSync("data/openoii.db")
      ? "data/openoii.db"
      : "data/komaslate.db";
  const dbPath = process.env.ENGINE_DB_PATH ?? defaultDb;
  const port = Number(process.env.ENGINE_PORT ?? 18766);
  const app = createEngineApp(dbPath);
  app.server.listen(port, "127.0.0.1", () => {
    console.log(`komaslate-engine listening on 127.0.0.1:${port} (db: ${dbPath})`);
  });
}
