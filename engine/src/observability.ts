/**
 * Thinnest useful observability layer: OpenTelemetry spans for the run → stage
 * → provider hierarchy.
 *
 * Deliberately minimal — no exporter is wired in by default and no second
 * framework is introduced. The engine records spans through `@opentelemetry/api`
 * (a no-op when no provider is registered), so a deployment that wants traces
 * registers a provider and gets them, while tests and local runs pay nothing.
 *
 * Attribute names follow the OpenTelemetry GenAI semantic conventions where
 * they exist (still marked Development upstream): `gen_ai.system`,
 * `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.
 * Engine-specific identity uses plain names so the standard ones stay honest.
 */
import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type { AiOperation } from "./ai-operation.js";

export const TRACER_NAME = "komaslate-engine";

/** Engine-specific identity attributes, kept stable for log correlation. */
export interface OperationSpanAttributes {
  [key: string]: string | number | boolean | undefined;
  "komaslate.run_id": number;
  "komaslate.project_id": number;
  "komaslate.stage": string;
  "komaslate.stage_attempt_id": string;
  "komaslate.execution_attempt"?: number;
}

export interface GenAiSpanAttributes {
  [key: string]: string | number | boolean | undefined;
  "gen_ai.system"?: string;
  "gen_ai.operation.name"?: string;
  "gen_ai.request.model"?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
  "komaslate.retry_count"?: number;
  "komaslate.status"?: string;
  "komaslate.error_type"?: string;
}

function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

let contextManagerInstalled = false;

/**
 * Install the async-context manager that makes spans nest.
 *
 * Without it the API's default context manager is a no-op: `context.with()`
 * does not propagate, so every span becomes a SIBLING and the
 * run → stage → provider tree silently flattens. That is a real defect, not a
 * cosmetic one — a flat trace cannot attribute a provider failure to the stage
 * that caused it.
 *
 * Idempotent and side-effect limited to context propagation; registering a
 * provider/exporter stays the deployment's choice.
 */
export function installContextManager(): void {
  if (contextManagerInstalled) return;
  contextManagerInstalled = true;
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
}

/**
 * Run `fn` inside a span, recording error type/status on failure.
 *
 * The span is always ended, including on abort, so a cancelled run does not
 * leak an unfinished span.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  installContextManager();
  const span = tracer().startSpan(name, { attributes });
  // Run the body inside the span's context so nested spans become children
  // rather than siblings (see installContextManager).
  try {
    return await context.with(trace.setSpan(context.active(), span), async () => {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    });
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : String(error));
    span.setAttribute("komaslate.error_type", errorTypeOf(error));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Classify a failure so traces can separate cancellation and deadlines from
 * genuine provider errors without parsing messages.
 */
export function errorTypeOf(error: unknown): string {
  if (error instanceof Error) {
    if (/abort|cancel/i.test(error.message)) return "cancelled";
    if (/deadline|timeout|timed out/i.test(error.message)) return "timeout";
    if (/lease lost/i.test(error.message)) return "lease_lost";
    return error.name || "error";
  }
  return "unknown";
}

/** One span per stage attempt, carrying the run identity it belongs to. */
export async function withStageSpan<T>(
  name: string,
  attributes: OperationSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(name, attributes, fn);
}

/**
 * One span per provider call, carrying GenAI attributes plus retry count.
 * Identity attributes are optional here: a provider call can happen without a
 * stage attempt (e.g. a direct text call), and a missing identity must not
 * prevent the span from being recorded.
 */
export async function withProviderSpan<T>(
  name: string,
  attributes: GenAiSpanAttributes & Partial<OperationSpanAttributes>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(name, attributes, fn);
}

/**
 * Record token usage, cost and model once a provider reports them.
 * `usage` is the pi-ai usage object; token/cost names follow the GenAI
 * conventions so a trace consumer can total spend per run/stage.
 */
export function recordUsage(
  span: Span,
  report: {
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cost?: { total?: number };
    };
  },
): void {
  if (report.model) span.setAttribute("gen_ai.request.model", report.model);
  const usage = report.usage;
  if (!usage) return;
  if (typeof usage.input === "number") {
    span.setAttribute("gen_ai.usage.input_tokens", usage.input);
  }
  if (typeof usage.output === "number") {
    span.setAttribute("gen_ai.usage.output_tokens", usage.output);
  }
  if (typeof usage.cost?.total === "number") {
    span.setAttribute("komaslate.cost.total", usage.cost.total);
  }
}

/**
 * Build the engine-identity attributes for a span from an operation.
 *
 * Identity lives on the operation, so a run/stage/provider span can be
 * correlated with the provider call that produced it without threading five
 * extra parameters through every layer.
 */
export function operationSpanAttributes(operation: AiOperation): OperationSpanAttributes {
  return {
    "komaslate.run_id": operation.runId,
    "komaslate.project_id": operation.projectId,
    "komaslate.stage": operation.stage,
    "komaslate.stage_attempt_id": operation.operationId,
  };
}

/** Root span for one run; every stage and provider span nests under it. */
export async function withRunSpan<T>(
  runId: number,
  projectId: number,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan("run", { "komaslate.run_id": runId, "komaslate.project_id": projectId }, fn);
}
