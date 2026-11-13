/**
 * Engine-side SQLite access (better-sqlite3).
 *
 * The shared database schema is owned exclusively by backend Alembic. The
 * engine configures SQLite connection pragmas and validates the runtime tables,
 * but never CREATEs or ALTERs schema at startup.
 */
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RunEventRow {
  seq: number;
  run_id: number;
  project_id: number;
  type: string;
  payload: string;
  created_at: string;
}

export interface StageAttemptRow {
  id: number;
  stage_attempt_id: string;
  run_id: number;
  stage: string;
  attempt: number;
  execution_attempt: number;
  input_hash: string;
  input_snapshot: string | null;
  idempotency_key: string;
  status: "started" | "succeeded" | "failed" | "cancelled";
  provider_request_id: string | null;
  result_json: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
}

export interface BeginStageAttemptInput {
  runId: number;
  stage: string;
  /** Frozen authoritative input; hashed here so resume never re-derives it. */
  input: unknown;
  executionAttempt: number;
  /**
   * Forces a fresh operation identity even when a non-terminal attempt exists.
   * Set by explicit rerun / feedback invalidation / new execution attempt —
   * never by crash recovery.
   */
  forceNew?: boolean;
}

export interface ChatConfirmationRow {
  id: number;
  project_id: number;
  tool_call_id: string;
  tool_name: string;
  tool_label: string;
  parameters_json: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
  resolved_at: string | null;
  resolved_by: "human" | "timeout" | "recovery" | null;
}

const REQUIRED_RUNTIME_TABLES = [
  "engine_run_events",
  "engine_checkpoints",
  "engine_stage_attempts",
  "chat_message",
] as const;

export class EngineDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 15000");
    this.db.pragma("foreign_keys = ON");
    this.assertSchema();
  }

  private assertSchema(): void {
    const placeholders = REQUIRED_RUNTIME_TABLES.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .all(...REQUIRED_RUNTIME_TABLES) as Array<{ name: string }>;
    const present = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_RUNTIME_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) {
      this.db.close();
      throw new Error(
        `engine database schema is not migrated; missing ${missing.join(", ")}. ` +
          "Run backend Alembic migrations before starting the engine.",
      );
    }
  }

  /**
   * Run `fn` inside one SQLite transaction on this connection.
   *
   * `EngineDatabase` and `SharedDb` are two view classes over the SAME
   * better-sqlite3 handle, so this is the single transaction boundary that
   * makes "mutate business state + append its durable event" atomic. Without
   * it a crash between the two leaves the HTTP state new while clients never
   * receive the event (or vice versa).
   *
   * better-sqlite3 transactions are synchronous; `fn` must not await.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  appendEvent(runId: number, projectId: number, type: string, payload: unknown): number {
    const info = this.db
      .prepare(
        "INSERT INTO engine_run_events (run_id, project_id, type, payload) VALUES (?, ?, ?, ?)",
      )
      .run(runId, projectId, type, JSON.stringify(payload));
    return Number(info.lastInsertRowid);
  }

  /** The project's saved chat (pi-agent-core messages, oldest first). */
  chatMessages(projectId: number): Array<{ id: number; message: unknown }> {
    const rows = this.db
      .prepare("SELECT id, message FROM chat_message WHERE project_id = ? ORDER BY id")
      .all(projectId) as Array<{ id: number; message: string }>;
    return rows.map((row) => ({ id: row.id, message: JSON.parse(row.message) as unknown }));
  }

  appendChatMessage(projectId: number, message: unknown): number {
    const info = this.db
      .prepare("INSERT INTO chat_message (project_id, message) VALUES (?, ?)")
      .run(projectId, JSON.stringify(message));
    return Number(info.lastInsertRowid);
  }

  /** `chat_status` frames are snapshots: keep only the project's newest one. */
  compactChatStatus(projectId: number, keepSeq: number): void {
    this.db
      .prepare(
        "DELETE FROM engine_run_events WHERE run_id = 0 AND project_id = ? AND type = 'chat_status' AND seq < ?",
      )
      .run(projectId, keepSeq);
  }

  /** `llm_stream` frames are snapshots: keep the newest, plus error frames. */
  compactStreamEvents(runId: number, keepSeq: number): void {
    this.db
      .prepare(
        "DELETE FROM engine_run_events WHERE run_id = ? AND type = 'llm_stream' AND seq < ? AND json_extract(payload, '$.status') <> 'error'",
      )
      .run(runId, keepSeq);
  }

  eventsForRun(runId: number, afterSeq = 0): RunEventRow[] {
    return this.db
      .prepare(
        "SELECT seq, run_id, project_id, type, payload, created_at FROM engine_run_events WHERE run_id = ? AND seq > ? ORDER BY seq",
      )
      .all(runId, afterSeq) as RunEventRow[];
  }

  saveCheckpoint(runId: number, stage: string, state: unknown): void {
    this.db
      .prepare(
        `INSERT INTO engine_checkpoints (run_id, stage, state_json, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(run_id, stage) DO UPDATE SET state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run(runId, stage, JSON.stringify(state));
  }

  checkpointStages(runId: number): string[] {
    return (
      this.db
        .prepare("SELECT stage FROM engine_checkpoints WHERE run_id = ?")
        .all(runId) as Array<{ stage: string }>
    ).map((row) => row.stage);
  }

  deleteCheckpoints(runId: number, stages: readonly string[]): number {
    if (stages.length === 0) return 0;
    const placeholders = stages.map(() => "?").join(", ");
    const info = this.db
      .prepare(
        `DELETE FROM engine_checkpoints WHERE run_id = ? AND stage IN (${placeholders})`,
      )
      .run(runId, ...stages);
    return Number(info.changes);
  }

  clearCheckpoints(runId: number): number {
    const info = this.db
      .prepare("DELETE FROM engine_checkpoints WHERE run_id = ?")
      .run(runId);
    return Number(info.changes);
  }

  latestCheckpoint(runId: number): { stage: string; state: unknown } | null {
    const row = this.db
      .prepare(
        "SELECT stage, state_json FROM engine_checkpoints WHERE run_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(runId) as { stage: string; state_json: string } | undefined;
    if (!row) return null;
    return { stage: row.stage, state: JSON.parse(row.state_json) };
  }

  getCheckpoint<T = unknown>(runId: number, stage: string): T | null {
    const row = this.db
      .prepare("SELECT state_json FROM engine_checkpoints WHERE run_id = ? AND stage = ?")
      .get(runId, stage) as { state_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.state_json) as T;
  }

  hasChatConfirmationTable(): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'chat_confirmation'")
      .get() as { ok: number } | undefined;
    return row?.ok === 1;
  }

  upsertChatConfirmation(input: {
    projectId: number;
    toolCallId: string;
    toolName: string;
    toolLabel: string;
    parametersJson: string;
    summary: string;
  }): { createdAt: string } {
    const createdAt = new Date().toISOString();
    if (!this.hasChatConfirmationTable()) return { createdAt };
    this.db
      .prepare(
        `INSERT INTO chat_confirmation
           (project_id, tool_call_id, tool_name, tool_label, parameters_json, summary, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(tool_call_id) DO UPDATE SET
           tool_name = excluded.tool_name,
           tool_label = excluded.tool_label,
           parameters_json = excluded.parameters_json,
           summary = excluded.summary,
           status = 'pending',
           resolved_at = NULL,
           resolved_by = NULL`,
      )
      .run(
        input.projectId,
        input.toolCallId,
        input.toolName,
        input.toolLabel,
        input.parametersJson,
        input.summary,
        createdAt,
      );
    return { createdAt };
  }

  resolveChatConfirmation(
    toolCallId: string,
    status: "approved" | "rejected" | "expired",
    resolvedBy: "human" | "timeout" | "recovery",
  ): { projectId: number; toolName: string; resolvedAt: string } | null {
    if (!this.hasChatConfirmationTable()) return null;
    const resolvedAt = new Date().toISOString();
    const row = this.db
      .prepare("SELECT project_id, tool_name FROM chat_confirmation WHERE tool_call_id = ?")
      .get(toolCallId) as { project_id: number; tool_name: string } | undefined;
    if (!row) return null;
    const info = this.db
      .prepare(
        `UPDATE chat_confirmation
         SET status = ?, resolved_at = ?, resolved_by = ?
         WHERE tool_call_id = ? AND status = 'pending'`,
      )
      .run(status, resolvedAt, resolvedBy, toolCallId);
    if (info.changes === 0) return null;
    return { projectId: row.project_id, toolName: row.tool_name, resolvedAt };
  }

  pendingChatConfirmation(projectId: number): ChatConfirmationRow | null {
    if (!this.hasChatConfirmationTable()) return null;
    return (
      (this.db
        .prepare(
          `SELECT * FROM chat_confirmation
           WHERE project_id = ? AND status = 'pending'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(projectId) as ChatConfirmationRow | undefined) ?? null
    );
  }

  expireAllPendingChatConfirmations(): Array<{
    project_id: number;
    tool_call_id: string;
    tool_name: string;
    tool_label: string;
    summary: string;
    resolved_at: string;
  }> {
    if (!this.hasChatConfirmationTable()) return [];
    const resolvedAt = new Date().toISOString();
    return this.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT project_id, tool_call_id, tool_name, tool_label, summary
           FROM chat_confirmation
           WHERE status = 'pending'`,
        )
        .all() as Array<{
        project_id: number;
        tool_call_id: string;
        tool_name: string;
        tool_label: string;
        summary: string;
      }>;
      if (rows.length > 0) {
        this.db
          .prepare(
            `UPDATE chat_confirmation
             SET status = 'expired',
                 resolved_at = ?,
                 resolved_by = 'recovery'
             WHERE status = 'pending'`,
          )
          .run(resolvedAt);
      }
      return rows.map((row) => ({ ...row, resolved_at: resolvedAt }));
    });
  }

  recentProtocolEvents(projectId?: number, limit = 100): RunEventRow[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    if (typeof projectId === "number" && Number.isFinite(projectId)) {
      return this.db
        .prepare(
          `SELECT seq, run_id, project_id, type, payload, created_at
           FROM engine_run_events
           WHERE project_id = ? AND (type LIKE 'mcp_%' OR type LIKE 'cli_%')
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(projectId, safeLimit) as RunEventRow[];
    }
    return this.db
      .prepare(
        `SELECT seq, run_id, project_id, type, payload, created_at
         FROM engine_run_events
         WHERE type LIKE 'mcp_%' OR type LIKE 'cli_%'
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(safeLimit) as RunEventRow[];
  }

  /**
   * Persist stage identity before side effects, plus the exact input it saw.
   *
   * Resume must NOT re-derive identity from current database state. A stage
   * mutates `character`/`shot`/`project` before it commits its checkpoint, so
   * after a crash the recomputed input no longer matches the interrupted row;
   * keying on it minted a NEW idempotency key and re-called the provider for
   * one logical operation, destroying the at-least-once guarantee.
   *
   * Identity is therefore: `(run_id, stage)` plus "is there a non-terminal
   * attempt?". A `started` row IS the interrupted operation and is reused
   * as-is. A new attempt is created only when the previous one is terminal
   * (succeeded/failed/cancelled/superseded) or when the caller explicitly
   * forces one (rerun / feedback invalidation).
   */
  beginStageAttempt(input: BeginStageAttemptInput): StageAttemptRow {
    const { runId, stage, input: stageInput, executionAttempt, forceNew = false } = input;
    const frozen = JSON.stringify(stageInput ?? null);
    const inputHash = createHash("sha256").update(frozen).digest("hex");

    if (!forceNew) {
      const interrupted = this.db
        .prepare(
          `SELECT * FROM engine_stage_attempts
           WHERE run_id = ? AND stage = ? AND status = 'started'
           ORDER BY attempt DESC LIMIT 1`,
        )
        .get(runId, stage) as StageAttemptRow | undefined;
      if (interrupted) return interrupted;
    }

    const latest = this.db
      .prepare(
        "SELECT COALESCE(MAX(attempt), 0) AS attempt FROM engine_stage_attempts WHERE run_id = ? AND stage = ?",
      )
      .get(runId, stage) as { attempt: number };
    const attempt = Number(latest.attempt ?? 0) + 1;
    const stageAttemptId = randomUUID();
    const idempotencyKey = createHash("sha256")
      .update(`${runId}:${stage}:${attempt}:${inputHash}`)
      .digest("hex");
    this.db
      .prepare(
        `INSERT INTO engine_stage_attempts
          (stage_attempt_id, run_id, stage, attempt, execution_attempt, input_hash,
           input_snapshot, idempotency_key, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run(
        stageAttemptId,
        runId,
        stage,
        attempt,
        executionAttempt,
        inputHash,
        frozen,
        idempotencyKey,
      );
    return this.stageAttemptById(stageAttemptId)!;
  }

  /** Frozen stage input recorded before the attempt's first side effect. */
  stageAttemptInput(stageAttemptId: string): unknown {
    const row = this.db
      .prepare("SELECT input_snapshot FROM engine_stage_attempts WHERE stage_attempt_id = ?")
      .get(stageAttemptId) as { input_snapshot: string | null } | undefined;
    if (!row || row.input_snapshot === null) return null;
    return JSON.parse(row.input_snapshot);
  }

  stageAttemptById(stageAttemptId: string): StageAttemptRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM engine_stage_attempts WHERE stage_attempt_id = ?")
        .get(stageAttemptId) as StageAttemptRow | undefined) ?? null
    );
  }

  completeStageAttempt(
    stageAttemptId: string,
    status: "succeeded" | "failed" | "cancelled",
    details: { providerRequestId?: string | null; result?: unknown; error?: string | null } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE engine_stage_attempts
         SET status = ?, provider_request_id = COALESCE(?, provider_request_id),
             result_json = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE stage_attempt_id = ?`,
      )
      .run(
        status,
        details.providerRequestId ?? null,
        details.result === undefined ? null : JSON.stringify(details.result),
        details.error ?? null,
        stageAttemptId,
      );
  }

  /** Read a config value with DB > env > default precedence (mirrors the app). */
  configValue(key: string, envVar?: string): string | undefined;
  configValue(key: string, envVar: string | undefined, fallback: string): string;
  configValue(key: string, envVar?: string, fallback?: string): string | undefined {
    let row: { value: string } | undefined;
    try {
      row = this.db
        .prepare("SELECT value FROM configitem WHERE key = ?")
        .get(key) as { value: string } | undefined;
    } catch {
      row = undefined;
    }
    if (row && row.value !== "") return row.value;
    if (envVar) {
      const fromEnv = process.env[envVar];
      if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    }
    return fallback;
  }

  close(): void {
    this.db.close();
  }
}
