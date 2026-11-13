import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { AiOperation } from "../ai-operation.js";
import type { EngineDatabase } from "../db.js";
import { resolveStaticMediaReference } from "./sandbox.js";

export const MCP_PING_INTERVAL_MS = 30_000;
export const MCP_UNHEALTHY_THRESHOLD = 2;

export type McpTransportKind = "stdio" | "http";
export type McpServerHealth = "connected" | "unhealthy" | "disconnected";
export type McpApprovalPolicy = "read_only_auto" | "confirm_writes";

export interface McpServerConfig {
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  shareFilesystem?: boolean;
  policy?: McpApprovalPolicy;
  enabled?: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerStatusSnapshot {
  server_name: string;
  direction: "outbound";
  transport: McpTransportKind;
  enabled: boolean;
  status: McpServerHealth;
  latency_ms: number | null;
  consecutive_failures: number;
  last_ping_at: string | null;
  error: string | null;
  policy: McpApprovalPolicy;
  tools: McpToolInfo[];
}

export interface McpCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  operation?: AiOperation | null;
  projectId?: number;
  runId?: number;
}

export interface McpTransport {
  request(
    method: string,
    params?: Record<string, unknown>,
    opts?: { id?: string | number; signal?: AbortSignal },
  ): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function combineSignals(
  signals: Array<AbortSignal | undefined>,
  timeoutMs?: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    const onAbort = () => controller.abort(sig.reason);
    sig.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => sig.removeEventListener("abort", onAbort));
  }

  let timer: NodeJS.Timeout | undefined;
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => controller.abort(new Error(`MCP request timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      for (const fn of cleanups) fn();
    },
  };
}

export class StdioMcpTransport implements McpTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private readonly inflight = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private stderrTail = "";

  constructor(
    private readonly config: McpServerConfig,
  ) {}

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return this.child;
    }
    if (!this.config.command) {
      throw new Error(`MCP stdio server "${this.config.name}" requires command`);
    }
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: this.config.env ? { ...process.env, ...this.config.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child = child;
    this.stderrTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
    });
    this.rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        return;
      }
      if (msg.id === undefined || msg.id === null) return;
      const waiter = this.inflight.get(msg.id);
      if (!waiter) return;
      this.inflight.delete(msg.id);
      if (msg.error) {
        waiter.reject(new Error(msg.error.message ?? `MCP error ${String(msg.error.code ?? -32000)}`));
      } else {
        waiter.resolve(msg.result);
      }
    });

    const failAll = (reason: Error) => {
      if (this.child === child) {
        this.rl?.close();
        this.rl = null;
        this.child = null;
      }
      for (const [id, waiter] of this.inflight) {
        this.inflight.delete(id);
        waiter.reject(reason);
      }
    };
    child.once("error", (err) => failAll(err));
    child.once("close", (code) => {
      failAll(new Error(`MCP stdio server "${this.config.name}" exited (${code}): ${this.stderrTail}`));
    });
    return child;
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts: { id?: string | number; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (opts.signal?.aborted) {
      throw new Error(`MCP request "${method}" aborted`);
    }
    const child = this.ensureStarted();
    const id = opts.id ?? this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.inflight.delete(id);
        void this.notify("notifications/cancelled", {
          requestId: id,
          reason: "aborted by caller",
        }).catch(() => undefined);
        reject(new Error(`MCP request "${method}" aborted`));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      this.inflight.set(id, {
        resolve: (value) => {
          opts.signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (err) => {
          opts.signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      });

      child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          const waiter = this.inflight.get(id);
          if (waiter) {
            this.inflight.delete(id);
            waiter.reject(err);
          }
        }
      });
    });
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const child = this.ensureStarted();
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${payload}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.rl?.close();
    this.rl = null;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.stdin.end();
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 1500);
      timer.unref();
    });
  }
}

export class StreamableHttpMcpTransport implements McpTransport {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(private readonly config: McpServerConfig) {
    if (!config.url) {
      throw new Error(`MCP HTTP server "${config.name}" requires url`);
    }
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts: { id?: string | number; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const id = opts.id ?? this.nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.config.headers ?? {}),
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let response: Response;
    try {
      response = await fetch(this.config.url!, {
        method: "POST",
        headers,
        body,
        signal: opts.signal,
      });
    } catch (error) {
      if (opts.signal?.aborted) {
        void this.notify("notifications/cancelled", { requestId: id, reason: "aborted" }).catch(() => undefined);
      }
      throw error;
    }

    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession) this.sessionId = returnedSession;

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`MCP HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const rpc = contentType.includes("text/event-stream")
      ? parseSseJsonRpc(text, id)
      : (JSON.parse(text) as JsonRpcResponse);

    if (!rpc) {
      throw new Error(`MCP HTTP response missing JSON-RPC body for ${method}`);
    }
    if (rpc.error) {
      throw new Error(rpc.error.message ?? `MCP error ${String(rpc.error.code ?? -32000)}`);
    }
    return rpc.result;
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.config.url) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.config.headers ?? {}),
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    await fetch(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    }).catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.sessionId && this.config.url) {
      await fetch(this.config.url, {
        method: "DELETE",
        headers: { "Mcp-Session-Id": this.sessionId, ...(this.config.headers ?? {}) },
      }).catch(() => undefined);
    }
    this.sessionId = null;
  }
}

function parseSseJsonRpc(sseText: string, expectedId: string | number): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;
  for (const rawLine of sseText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.id === expectedId) return parsed;
      last = parsed;
    } catch {
      // Ignore malformed SSE event line.
    }
  }
  return last;
}

export class McpClient {
  private initialized = false;
  private requestCounter = 0;

  constructor(
    readonly config: McpServerConfig,
    private readonly transport: McpTransport,
    private readonly logRpc?: (
      type: "mcp_rpc_request" | "mcp_rpc_response",
      payload: Record<string, unknown>,
      opts?: { projectId?: number; runId?: number },
    ) => void,
  ) {}

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    opts: McpCallOptions = {},
  ): Promise<unknown> {
    const requestId = `${this.config.name}-${++this.requestCounter}`;
    const timeoutMs =
      opts.timeoutMs ??
      (opts.operation ? Math.max(1000, opts.operation.deadline - Date.now()) : undefined);
    const { signal, cleanup } = combineSignals([opts.signal, opts.operation?.signal], timeoutMs);
    const startedAt = Date.now();

    this.logRpc?.(
      "mcp_rpc_request",
      {
        request_id: requestId,
        server_name: this.config.name,
        direction: "outbound",
        method,
        params: params ?? null,
        timestamp: new Date(startedAt).toISOString(),
      },
      opts,
    );

    try {
      const result = await this.transport.request(method, params, { id: requestId, signal });
      this.logRpc?.(
        "mcp_rpc_response",
        {
          request_id: requestId,
          server_name: this.config.name,
          direction: "outbound",
          method,
          ok: true,
          latency_ms: Date.now() - startedAt,
          result,
          error: null,
          timestamp: new Date().toISOString(),
        },
        opts,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logRpc?.(
        "mcp_rpc_response",
        {
          request_id: requestId,
          server_name: this.config.name,
          direction: "outbound",
          method,
          ok: false,
          latency_ms: Date.now() - startedAt,
          result: null,
          error: { message },
          timestamp: new Date().toISOString(),
        },
        opts,
      );
      throw error;
    } finally {
      cleanup();
    }
  }

  async ensureInitialized(opts: McpCallOptions = {}): Promise<void> {
    if (this.initialized) return;
    await this.rpc(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "komaslate-engine", version: "0.1.0" },
      },
      opts,
    );
    await this.transport.notify("notifications/initialized");
    this.initialized = true;
  }

  async ping(opts: McpCallOptions = {}): Promise<number> {
    await this.ensureInitialized(opts);
    const startedAt = Date.now();
    await this.rpc("ping", {}, { ...opts, timeoutMs: opts.timeoutMs ?? 5000 });
    return Date.now() - startedAt;
  }

  async listTools(opts: McpCallOptions = {}): Promise<McpToolInfo[]> {
    await this.ensureInitialized(opts);
    const res = (await this.rpc("tools/list", {}, opts)) as { tools?: McpToolInfo[] } | undefined;
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    opts: McpCallOptions = {},
  ): Promise<unknown> {
    await this.ensureInitialized(opts);
    return this.rpc("tools/call", { name: toolName, arguments: args }, opts);
  }

  async close(): Promise<void> {
    this.initialized = false;
    await this.transport.close();
  }
}

interface ManagedServer {
  config: McpServerConfig;
  client: McpClient | null;
  status: McpServerHealth;
  consecutiveFailures: number;
  latencyMs: number | null;
  lastPingAt: string | null;
  error: string | null;
  tools: McpToolInfo[];
}

export interface McpPoolOptions {
  staticDir?: string;
  gatewayBaseUrl?: string;
  transportFactory?: (config: McpServerConfig) => McpTransport;
  pingIntervalMs?: number;
}

export class McpClientPool {
  private readonly servers = new Map<string, ManagedServer>();
  private healthTimer: NodeJS.Timeout | null = null;
  private readonly staticDir: string;
  private readonly gatewayBaseUrl: string;
  private readonly transportFactory: (config: McpServerConfig) => McpTransport;
  private readonly pingIntervalMs: number;

  constructor(
    private readonly db?: EngineDatabase,
    options: McpPoolOptions = {},
  ) {
    this.staticDir =
      options.staticDir ??
      process.env.ENGINE_STATIC_DIR ??
      `${process.cwd()}/../backend/app/static`;
    this.gatewayBaseUrl =
      options.gatewayBaseUrl ??
      process.env.KOMASLATE_BACKEND_URL ??
      "http://127.0.0.1:18765";
    this.transportFactory =
      options.transportFactory ??
      ((config) =>
        config.transport === "stdio"
          ? new StdioMcpTransport(config)
          : new StreamableHttpMcpTransport(config));
    this.pingIntervalMs = options.pingIntervalMs ?? MCP_PING_INTERVAL_MS;
    this.loadConfiguredServers();
  }

  private loadConfiguredServers(): void {
    const raw =
      this.db?.configValue("MCP_OUTBOUND_SERVERS", "KOMASLATE_MCP_SERVERS") ??
      process.env.KOMASLATE_MCP_SERVERS;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof (item as McpServerConfig).name === "string") {
          this.registerServer(item as McpServerConfig);
        }
      }
    } catch {
      // Ignore malformed config; operator can inspect or re-register.
    }
  }

  registerServer(config: McpServerConfig): void {
    const existing = this.servers.get(config.name);
    if (existing?.client) {
      void existing.client.close().catch(() => undefined);
    }
    this.servers.set(config.name, {
      config,
      client: null,
      status: "disconnected",
      consecutiveFailures: 0,
      latencyMs: null,
      lastPingAt: null,
      error: null,
      tools: [],
    });
  }

  unregisterServer(name: string): void {
    const entry = this.servers.get(name);
    if (!entry) return;
    if (entry.client) void entry.client.close().catch(() => undefined);
    this.servers.delete(name);
  }

  setServerPolicy(name: string, policy: McpApprovalPolicy): McpServerStatusSnapshot | null {
    const entry = this.servers.get(name);
    if (!entry) return null;
    entry.config = { ...entry.config, policy };
    return this.getServerStatus(name);
  }

  setServerEnabled(name: string, enabled: boolean): McpServerStatusSnapshot | null {
    const entry = this.servers.get(name);
    if (!entry) return null;
    entry.config = { ...entry.config, enabled };
    if (!enabled && entry.client) {
      void entry.client.close().catch(() => undefined);
      entry.client = null;
      entry.status = "disconnected";
    }
    return this.getServerStatus(name);
  }

  private toSnapshot(entry: ManagedServer): McpServerStatusSnapshot {
    return {
      server_name: entry.config.name,
      direction: "outbound",
      transport: entry.config.transport,
      enabled: entry.config.enabled !== false,
      status: entry.status,
      latency_ms: entry.latencyMs,
      consecutive_failures: entry.consecutiveFailures,
      last_ping_at: entry.lastPingAt,
      error: entry.error,
      policy: entry.config.policy ?? "confirm_writes",
      tools: entry.tools,
    };
  }

  listStatus(): McpServerStatusSnapshot[] {
    return Array.from(this.servers.values(), (entry) => this.toSnapshot(entry));
  }

  getServerStatus(name: string): McpServerStatusSnapshot | null {
    const entry = this.servers.get(name);
    return entry ? this.toSnapshot(entry) : null;
  }

  /** Resolve a media reference into Zero-Copy local path or remote HTTP static URL. */
  prepareMediaInput(serverName: string, mediaRef: string): string {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`MCP server "${serverName}" is not registered`);
    return resolveStaticMediaReference(mediaRef, {
      staticDir: this.staticDir,
      gatewayBaseUrl: this.gatewayBaseUrl,
      transport: entry.config.transport,
      shareFilesystem: entry.config.shareFilesystem,
    });
  }

  private getOrCreateClient(entry: ManagedServer): McpClient {
    if (entry.client) return entry.client;
    const transport = this.transportFactory(entry.config);
    const client = new McpClient(entry.config, transport, (type, payload, opts) => {
      this.emitEvent(type, payload, opts);
    });
    entry.client = client;
    return client;
  }

  private emitEvent(
    type: string,
    payload: Record<string, unknown>,
    opts?: { projectId?: number; runId?: number },
  ): void {
    if (!this.db) return;
    try {
      this.db.appendEvent(opts?.runId ?? 0, opts?.projectId ?? 0, type, payload);
    } catch {
      // Never fail an operation because of telemetry write.
    }
  }

  async pingServer(name: string, opts: McpCallOptions = {}): Promise<McpServerStatusSnapshot> {
    const entry = this.servers.get(name);
    if (!entry) {
      throw new Error(`MCP server "${name}" is not registered`);
    }
    const client = this.getOrCreateClient(entry);
    const now = new Date().toISOString();
    entry.lastPingAt = now;
    try {
      const latencyMs = await client.ping(opts);
      entry.consecutiveFailures = 0;
      entry.status = "connected";
      entry.latencyMs = latencyMs;
      entry.error = null;
      if (entry.tools.length === 0) {
        entry.tools = await client.listTools(opts).catch(() => entry.tools);
      }
    } catch (error) {
      entry.consecutiveFailures += 1;
      entry.error = error instanceof Error ? error.message : String(error);
      entry.status =
        entry.consecutiveFailures >= MCP_UNHEALTHY_THRESHOLD ? "unhealthy" : "disconnected";
    }
    this.emitEvent(
      "mcp_server_status",
      {
        server_name: entry.config.name,
        direction: "outbound",
        transport: entry.config.transport,
        status: entry.status,
        latency_ms: entry.latencyMs,
        error: entry.error,
        timestamp: now,
      },
      opts,
    );
    return this.getServerStatus(name)!;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    opts: McpCallOptions = {},
  ): Promise<unknown> {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`MCP server "${serverName}" is not registered`);
    const client = this.getOrCreateClient(entry);
    const startedAt = Date.now();
    this.emitEvent(
      "mcp_tool_called",
      {
        server_name: serverName,
        tool_name: toolName,
        direction: "outbound",
        status: "started",
        timestamp: new Date(startedAt).toISOString(),
      },
      opts,
    );
    try {
      const result = await client.callTool(toolName, args, opts);
      entry.status = "connected";
      entry.consecutiveFailures = 0;
      entry.error = null;
      this.emitEvent(
        "mcp_tool_called",
        {
          server_name: serverName,
          tool_name: toolName,
          direction: "outbound",
          status: "completed",
          latency_ms: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
        opts,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent(
        "mcp_tool_called",
        {
          server_name: serverName,
          tool_name: toolName,
          direction: "outbound",
          status: "failed",
          latency_ms: Date.now() - startedAt,
          error: message,
          timestamp: new Date().toISOString(),
        },
        opts,
      );
      throw error;
    }
  }

  startHealthMonitor(): void {
    if (this.healthTimer || this.pingIntervalMs <= 0) return;
    this.healthTimer = setInterval(() => {
      for (const [name, entry] of this.servers) {
        if (entry.config.enabled === false) continue;
        void this.pingServer(name).catch(() => undefined);
      }
    }, this.pingIntervalMs);
    this.healthTimer.unref();
  }

  async closeAll(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    const clients = Array.from(this.servers.values())
      .map((entry) => entry.client)
      .filter((client): client is McpClient => client !== null);
    for (const entry of this.servers.values()) {
      entry.client = null;
      entry.status = "disconnected";
    }
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  }
}
