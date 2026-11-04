/**
 * One AI operation contract shared by text, image and video.
 *
 * Before this, each provider path carried its own copy of the same concerns:
 * text went through `pi-ai` with an AbortSignal, media built its own
 * `Idempotency-Key` header and its own abort plumbing, and neither knew about
 * the other's retry, timeout, credential or error shape. Orchestration
 * semantics therefore existed twice, which is how "retry 3 times", "fall back
 * to another model" and "decide the next stage" ended up encoded in a provider
 * client.
 *
 * An AI operation describes *what is being asked for* and carries the
 * execution identity the engine owns. A provider adapter only turns that into a
 * request and reports success or failure — it never decides policy.
 */
export interface AiOperation {
  /** Stable identity of the logical operation (the stage attempt). */
  operationId: string;
  /** Stage attempt idempotency key; providers that support it receive it. */
  idempotencyKey: string;
  runId: number;
  projectId: number;
  stage: string;
  /** Absolute deadline; adapters must not start work after it passes. */
  deadline: number;
  /** Aborted when the run is cancelled; every provider request must observe it. */
  signal?: AbortSignal;
  /** Reports provider activity to the run's durable event stream. */
  reportActivity?: (
    name: string,
    status: "running" | "succeeded" | "failed" | "cancelled",
    durationMs?: number,
  ) => void;
}

export interface AiOperationContext {
  operationId: string;
  idempotencyKey: string;
  runId: number;
  projectId: number;
  stage: string;
  signal?: AbortSignal;
  reportActivity?: AiOperation["reportActivity"];
  /** Milliseconds from now; defaults to `DEFAULT_OPERATION_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Default wall-clock budget for one provider operation. */
export const DEFAULT_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Per-item budget for stages that call a provider once per character or shot,
 * done one after another. A fixed 10-minute budget breaks a 12-shot video stage
 * (~100 s per clip), so the budget grows with the work instead.
 */
const STAGE_ITEM_TIMEOUT_MS: Record<string, number> = {
  render_characters: 3 * 60 * 1000,
  render_shots: 3 * 60 * 1000,
  critique_character_images: 60 * 1000,
  // A local vision model reads the keyframe plus the cast sheets (~40 s).
  critique_shot_images: 3 * 60 * 1000,
  // Each clip can be checked and redone up to twice (CRITIQUE_MAX_ROUNDS).
  compose_videos: 12 * 60 * 1000,
  compose_merge: 2 * 60 * 1000,
};

function envMs(name: string): number | null {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Wall-clock budget for one stage attempt: the base budget
 * (`KOMASLATE_STAGE_TIMEOUT_MS`, default 10 min) or, for per-item stages,
 * items × per-item budget (`KOMASLATE_STAGE_ITEM_TIMEOUT_MS` overrides the
 * per-stage default), whichever is larger.
 */
export function stageOperationTimeoutMs(stage: string, itemCount: number): number {
  const base = envMs("KOMASLATE_STAGE_TIMEOUT_MS") ?? envMs("OPENOII_STAGE_TIMEOUT_MS") ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const perItem = STAGE_ITEM_TIMEOUT_MS[stage];
  if (perItem === undefined) return base;
  const items = Math.max(0, Math.floor(itemCount));
  return Math.max(base, items * (envMs("KOMASLATE_STAGE_ITEM_TIMEOUT_MS") ?? envMs("OPENOII_STAGE_ITEM_TIMEOUT_MS") ?? perItem));
}

export function beginAiOperation(context: AiOperationContext): AiOperation {
  const timeoutMs = context.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  return {
    operationId: context.operationId,
    idempotencyKey: context.idempotencyKey,
    runId: context.runId,
    projectId: context.projectId,
    stage: context.stage,
    deadline: Date.now() + timeoutMs,
    signal: context.signal,
    reportActivity: context.reportActivity,
  };
}

/** Record one provider operation without exposing its prompt or response. */
export async function withAiActivity<T>(
  operation: AiOperation | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const report = operation?.reportActivity;
  if (!report) return fn();

  const startedAt = Date.now();
  report(name, "running");
  try {
    const result = await fn();
    report(name, "succeeded", Date.now() - startedAt);
    return result;
  } catch (error) {
    report(name, operation.signal?.aborted ? "cancelled" : "failed", Date.now() - startedAt);
    throw error;
  }
}

/** Whether an operation may still start work (deadline + cancellation). */
export function operationInFlight(operation: AiOperation): boolean {
  if (operation.signal?.aborted) return false;
  return Date.now() < operation.deadline;
}

/**
 * Fail fast with one message shape, so a cancelled or timed-out operation is
 * distinguishable from a provider error at every call site.
 */
export function assertOperationInFlight(operation: AiOperation): void {
  if (operation.signal?.aborted) {
    throw new Error(`operation ${operation.operationId} aborted: run cancelled`);
  }
  if (Date.now() >= operation.deadline) {
    throw new Error(
      `这一步生成超时，已完成的部分已保存，点继续即可接着生成（operation ${operation.operationId} exceeded its deadline）`,
    );
  }
}

/**
 * The unified error shape for provider failures. Adapters wrap their own
 * failures in this instead of inventing per-provider message formats.
 */
export type AiOperationErrorKind =
  | "aborted"
  | "timeout"
  | "provider"
  | "invalid_response";

export class AiOperationError extends Error {
  constructor(
    readonly kind: AiOperationErrorKind,
    readonly operationId: string,
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = "AiOperationError";
  }
}

/**
 * Header contract for providers that accept an idempotency key. The media
 * service used to build this inline; it is shared now so text/image/video
 * carry operation identity the same way.
 */
export function operationHeaders(operation: AiOperation): Record<string, string> {
  return { "Idempotency-Key": operation.idempotencyKey };
}
