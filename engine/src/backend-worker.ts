import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { resolve } from "node:path";

type PendingRequest = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
};

export interface AudioResult {
  video_url: string;
  tts_url: string | null;
  bgm_type: string | null;
  /** 配音服务商失败的原因（不含密钥）；成功或未配音时为 null */
  tts_error: string | null;
}

export interface BgmTrackResult {
  track_url: string | null;
  /** library / minimax / stability / suno */
  source: string | null;
  mood: string | null;
  /** 云端服务商失败的原因（已退回本地曲库）；不含密钥 */
  fallback_reason: string | null;
}

export interface CliProcessEvent {
  type: "cli_process_started" | "cli_stdout" | "cli_process_exited";
  payload: Record<string, unknown>;
}

export interface BackendWorkerOptions {
  pooled?: boolean;
  pool?: BackendWorkerPool;
  onCliEvent?: (event: CliProcessEvent) => void;
}

class ManagedWorkerProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private pending: PendingRequest | null = null;
  private errors = "";
  private activeAbort?: { signal: AbortSignal; handler: () => void };
  private startedAt = 0;

  constructor(
    readonly python: string,
    readonly cwd: string,
    private readonly onSpawn?: () => void,
    private readonly onCliEvent?: (event: CliProcessEvent) => void,
  ) {}

  get alive(): boolean {
    return this.child !== null && !this.child.killed && this.child.exitCode === null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async request(
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error("backend worker cancelled");
    const child = this.ensureStarted();
    const line = await new Promise<string>((resolveLine, reject) => {
      const onAbort = () => {
        this.terminate(child, new Error("backend worker cancelled"));
      };
      this.activeAbort = { signal, handler: onAbort };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        resolve: (value) => {
          this.clearAbort();
          resolveLine(value);
        },
        reject: (err) => {
          this.clearAbort();
          reject(err);
        },
      };
      child.stdin.write(`${JSON.stringify(request)}\n`, (error?: Error | null) => {
        if (error) this.fail(child, error);
      });
    });
    const value: unknown = JSON.parse(line);
    if (value && typeof value === "object" && "error" in value) {
      throw new Error(String((value as { error: unknown }).error));
    }
    return value;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolveClose) => {
      child.once("close", () => resolveClose());
      child.stdin.end();
    });
  }

  private clearAbort(): void {
    if (!this.activeAbort) return;
    this.activeAbort.signal.removeEventListener("abort", this.activeAbort.handler);
    this.activeAbort = undefined;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    this.onSpawn?.();
    this.startedAt = Date.now();
    const child = spawn(this.python, ["-m", "app.services.engine_media_cli"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.errors = "";
    this.onCliEvent?.({
      type: "cli_process_started",
      payload: {
        command: this.python,
        args: ["-m", "app.services.engine_media_cli"],
        pid: child.pid ?? null,
        stage: "media_worker",
        timestamp: new Date().toISOString(),
      },
    });
    child.stderr.setEncoding("utf8");
    let errors = "";
    child.stderr.on("data", (chunk: string) => {
      errors = `${errors}${chunk}`.slice(-4000);
      if (this.child === child) this.errors = errors;
      const line = chunk.trim();
      if (line) {
        this.onCliEvent?.({
          type: "cli_stdout",
          payload: {
            command: "engine_media_cli",
            stream: "stderr",
            line: line.slice(0, 500),
            pid: child.pid ?? null,
            timestamp: new Date().toISOString(),
          },
        });
      }
    });
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      if (this.child !== child) return;
      const pending = this.pending;
      if (!pending) return;
      this.pending = null;
      pending.resolve(line);
    });
    child.once("error", (error) => this.fail(child, error));
    child.once("close", (code) => {
      this.onCliEvent?.({
        type: "cli_process_exited",
        payload: {
          command: "engine_media_cli",
          exit_code: code ?? -1,
          duration_ms: Date.now() - this.startedAt,
          pid: child.pid ?? null,
          error: code === 0 || code === null ? null : errors.slice(-300) || null,
          timestamp: new Date().toISOString(),
        },
      });
      this.fail(child, new Error(`backend worker exited ${code}: ${errors}`));
    });
    return child;
  }

  private terminate(child: ChildProcessWithoutNullStreams, reason: Error): void {
    this.fail(child, reason);
    if (process.platform === "win32" || !child.pid) {
      child.kill("SIGTERM");
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    const pending = this.pending;
    this.pending = null;
    this.clearAbort();
    pending?.reject(error);
    this.lines?.close();
    this.lines = null;
    this.child = null;
  }
}

interface PooledEntry {
  key: string;
  proc: ManagedWorkerProcess;
  lastUsedAt: number;
}

/**
 * Resident worker pool for `python -m app.services.engine_media_cli`.
 * Keeps InsightFace / Pillow / AudioService warm across stages and runs.
 */
export class BackendWorkerPool {
  private readonly idle: PooledEntry[] = [];
  private readonly inUse = new Set<ManagedWorkerProcess>();
  private totalSpawns = 0;
  private reaper: NodeJS.Timeout | null = null;

  constructor(
    private readonly maxSize = 4,
    private readonly idleTtlMs = 5 * 60_000,
  ) {}

  stats(): { spawns: number; idle: number; active: number } {
    return {
      spawns: this.totalSpawns,
      idle: this.idle.length,
      active: this.inUse.size,
    };
  }

  acquire(onCliEvent?: (event: CliProcessEvent) => void): ManagedWorkerProcess {
    const python = process.env.ENGINE_PYTHON ?? "python";
    const cwd = process.env.ENGINE_BACKEND_DIR ?? resolve(process.cwd(), "../backend");
    const key = `${python}\0${cwd}`;

    for (let i = this.idle.length - 1; i >= 0; i -= 1) {
      const entry = this.idle[i]!;
      if (entry.key !== key) continue;
      this.idle.splice(i, 1);
      if (entry.proc.alive) {
        this.inUse.add(entry.proc);
        return entry.proc;
      }
    }

    const proc = new ManagedWorkerProcess(
      python,
      cwd,
      () => {
        this.totalSpawns += 1;
      },
      onCliEvent,
    );
    this.inUse.add(proc);
    return proc;
  }

  release(proc: ManagedWorkerProcess): void {
    if (!this.inUse.delete(proc)) return;
    if (!proc.alive) return;
    if (this.idle.length >= this.maxSize) {
      void proc.close();
      return;
    }
    const key = `${proc.python}\0${proc.cwd}`;
    this.idle.push({ key, proc, lastUsedAt: Date.now() });
    this.ensureReaper();
  }

  async closeAll(): Promise<void> {
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
    const procs = [
      ...this.idle.splice(0).map((entry) => entry.proc),
      ...Array.from(this.inUse),
    ];
    this.inUse.clear();
    await Promise.all(procs.map((proc) => proc.close().catch(() => undefined)));
  }

  private ensureReaper(): void {
    if (this.reaper || this.idleTtlMs <= 0) return;
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - this.idleTtlMs;
      for (let i = this.idle.length - 1; i >= 0; i -= 1) {
        const entry = this.idle[i]!;
        if (!entry.proc.alive || entry.lastUsedAt < cutoff) {
          this.idle.splice(i, 1);
          void entry.proc.close().catch(() => undefined);
        }
      }
      if (this.idle.length === 0 && this.reaper) {
        clearInterval(this.reaper);
        this.reaper = null;
      }
    }, Math.min(this.idleTtlMs, 30_000));
    this.reaper.unref();
  }
}

export const sharedBackendWorkerPool = new BackendWorkerPool();

/** Reuse the backend's existing image, face, and audio helpers from Engine. */
export class BackendWorker {
  private proc: ManagedWorkerProcess | null = null;
  private readonly pooled: boolean;
  private readonly pool: BackendWorkerPool;
  private readonly onCliEvent?: (event: CliProcessEvent) => void;

  constructor(
    private readonly signal: AbortSignal,
    options: BackendWorkerOptions = {},
  ) {
    this.pooled = options.pooled === true;
    this.pool = options.pool ?? sharedBackendWorkerPool;
    this.onCliEvent = options.onCliEvent;
  }

  async faceEmbedding(imageOrPath: Buffer | string): Promise<number[] | null> {
    const payload =
      typeof imageOrPath === "string"
        ? { action: "face_embedding", image_path: imageOrPath }
        : { action: "face_embedding", image: imageOrPath.toString("base64") };
    const value = await this.request(payload);
    if (
      !Array.isArray(value) ||
      value.length !== 512 ||
      !value.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      return null;
    }
    return value as number[];
  }

  async characterReference(
    urls: string[],
    options?: { outputPath?: string },
  ): Promise<Buffer> {
    const req: Record<string, unknown> = { action: "character_reference", urls };
    if (options?.outputPath) req.output_path = options.outputPath;
    return this.imageRequest(req);
  }

  async characterReferencePath(urls: string[], outputPath: string): Promise<string> {
    return this.imagePathRequest({ action: "character_reference", urls, output_path: outputPath }, outputPath);
  }

  async nineGridReference(args: {
    current: string;
    previous?: string | null;
    next?: string | null;
    characters: string[];
    outputPath?: string;
  }): Promise<Buffer> {
    const { outputPath, ...rest } = args;
    const req: Record<string, unknown> = { action: "nine_grid_reference", ...rest };
    if (outputPath) req.output_path = outputPath;
    return this.imageRequest(req);
  }

  async nineGridReferencePath(args: {
    current: string;
    previous?: string | null;
    next?: string | null;
    characters: string[];
    outputPath: string;
  }): Promise<string> {
    const { outputPath, ...rest } = args;
    return this.imagePathRequest(
      { action: "nine_grid_reference", ...rest, output_path: outputPath },
      outputPath,
    );
  }

  async processAudio(args: {
    video_url: string;
    dialogue: string | null;
    speaker: { name: string; description: string | null } | null;
    /** 角色指定的音色；为空时由 backend 按服务商默认或角色描述挑选 */
    voice: string | null;
    scene: string | null;
    expression: string | null;
    genre: string | null;
    settings: {
      text_provider: string;
      image_provider: string;
      video_provider: string;
      tts_enabled: boolean;
      tts_provider: string;
      tts_base_url: string | null;
      tts_api_key: string | null;
      tts_model: string | null;
      tts_default_voice: string;
      tts_volume: number;
      bgm_enabled: boolean;
      bgm_volume: number;
      bgm_directory: string;
    };
  }): Promise<AudioResult> {
    const value = await this.request({ action: "process_audio", ...args });
    if (!value || typeof value !== "object") throw new Error("invalid audio result");
    const result = value as Partial<AudioResult>;
    if (typeof result.video_url !== "string") throw new Error("audio result has no video URL");
    return {
      video_url: result.video_url,
      tts_url: typeof result.tts_url === "string" ? result.tts_url : null,
      bgm_type: typeof result.bgm_type === "string" ? result.bgm_type : null,
      tts_error: typeof result.tts_error === "string" ? result.tts_error : null,
    };
  }

  /** One background track for the whole film (local library or a cloud music provider). */
  async bgmTrack(args: {
    texts: string[];
    genre: string | null;
    duration: number;
    settings: {
      bgm_provider: string;
      bgm_base_url: string | null;
      bgm_api_key: string | null;
      bgm_model: string | null;
      bgm_directory: string;
    };
  }): Promise<BgmTrackResult> {
    const value = await this.request({ action: "bgm_track", ...args });
    if (!value || typeof value !== "object") throw new Error("invalid bgm result");
    const result = value as Partial<BgmTrackResult>;
    return {
      track_url: typeof result.track_url === "string" ? result.track_url : null,
      source: typeof result.source === "string" ? result.source : null,
      mood: typeof result.mood === "string" ? result.mood : null,
      fallback_reason: typeof result.fallback_reason === "string" ? result.fallback_reason : null,
    };
  }

  async close(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    if (this.pooled) {
      this.pool.release(proc);
      return;
    }
    await proc.close();
  }

  private async imageRequest(request: Record<string, unknown>): Promise<Buffer> {
    const value = await this.request(request);
    if (typeof value === "string") return Buffer.from(value, "base64");
    if (value && typeof value === "object") {
      const record = value as { file_path?: unknown; output_path?: unknown; path?: unknown };
      const filePath = record.file_path ?? record.output_path ?? record.path;
      if (typeof filePath === "string" && existsSync(filePath)) {
        return readFileSync(filePath);
      }
    }
    throw new Error("invalid image composition result");
  }

  private async imagePathRequest(
    request: Record<string, unknown>,
    fallbackOutputPath: string,
  ): Promise<string> {
    const value = await this.request(request);
    if (value && typeof value === "object") {
      const record = value as { file_path?: unknown; output_path?: unknown; path?: unknown };
      const filePath = record.file_path ?? record.output_path ?? record.path;
      if (typeof filePath === "string" && filePath.length > 0) {
        return filePath;
      }
    }
    if (typeof value === "string") {
      writeFileSync(fallbackOutputPath, Buffer.from(value, "base64"));
      return fallbackOutputPath;
    }
    throw new Error("invalid image composition result");
  }

  private async request(request: Record<string, unknown>): Promise<unknown> {
    if (this.signal.aborted) throw new Error("backend worker cancelled");
    const proc = this.ensureProcess();
    return proc.request(request, this.signal);
  }

  private ensureProcess(): ManagedWorkerProcess {
    if (this.proc && this.proc.alive) return this.proc;
    if (this.proc && !this.proc.alive && this.pooled) {
      this.pool.release(this.proc);
      this.proc = null;
    }
    if (this.pooled) {
      this.proc = this.pool.acquire(this.onCliEvent);
      return this.proc;
    }
    const python = process.env.ENGINE_PYTHON ?? "python";
    const cwd = process.env.ENGINE_BACKEND_DIR ?? resolve(process.cwd(), "../backend");
    this.proc = new ManagedWorkerProcess(python, cwd, undefined, this.onCliEvent);
    return this.proc;
  }
}
