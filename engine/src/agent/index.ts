/**
 * Chat agent (ADR 0011): one long-lived pi-agent-core `Agent` per project.
 *
 * The 15-stage workflow (`src/pipeline/`) stays a deterministic state machine;
 * this module only lets the user talk to the project. The model picks a tool,
 * the tool calls the backend product API, the result goes back to the model.
 * Write tools wait for the user's confirmation (`beforeToolCall`). A workflow
 * stage never calls into this module.
 *
 * Clients learn about the chat through two durable events on the project's
 * event log (run_id 0, no run): `chat_message` (one finished, saved message)
 * and `chat_status` (busy flag, the reply streaming so far, the pending
 * confirmation). Only the newest `chat_status` row is kept.
 */
import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { piModels, registerFake, requestKey } from "../pi-models.js";
import type { EngineDatabase } from "../db.js";
import { fakeStreamMs, type TextLlmService } from "../llm.js";
import { fakeChatReply } from "./fake.js";
import { chatTools, type BackendFetch, type ChatTool } from "./tools.js";

export const SYSTEM_PROMPT = `你是 KomaSlate 漫剧工作台里的创作助手，用简洁的中文回答。
KomaSlate 用一条固定的分阶段工作流做漫剧：大纲 → 角色 → 分镜 → 角色图 → 分镜画面 → 视频片段 → 成片，
每个规划和画面阶段之后都有一个审批门，必须由用户本人在界面上点「通过」。
你只能通过工具了解和修改项目，回答前先用工具读取最新状态，不要编造 id 或进度。
会改动项目或花钱的工具，系统会先请用户确认；用户拒绝后不要换个工具重试。
你永远不能替用户通过审批门；用户让你批准时，请他在审批区自己确认。`;

/** Messages the model sees per turn; older ones stay in the saved history. */
export const CONTEXT_MESSAGES = 40;
/** Model turns per user message, so a looping model cannot spend tokens forever. */
export const MAX_TURNS = 8;
/** An unanswered confirmation card counts as declined after this long. */
export const CONFIRM_TIMEOUT_MS = 10 * 60_000;
/** Minimum gap between two streaming `chat_status` frames. */
const STREAM_FRAME_MS = 150;

export class ChatBusyError extends Error {
  constructor(readonly projectId: number) {
    super(`project ${projectId} chat is already answering`);
  }
}

/** What the UI shows for one saved message. */
export interface ChatItem {
  id: number;
  role: "user" | "assistant" | "tool";
  text: string;
  /** tool rows: the tool's label and whether it succeeded */
  tool?: string;
  ok?: boolean;
  /** assistant rows that ended in an error or a stop */
  error?: string;
}

export interface ChatConfirm {
  tool_call_id: string;
  tool: string;
  summary: string;
}

export interface ChatStatus {
  busy: boolean;
  text: string;
  pending: ChatConfirm | null;
}

export interface ChatAgentDeps {
  db: EngineDatabase;
  llm: TextLlmService;
  api: BackendFetch;
  /** Tests inject a scripted model; otherwise the configured text model is used. */
  streamFn?: StreamFn;
  tools?: (projectId: number, api: BackendFetch) => ChatTool[];
  confirmTimeoutMs?: number;
}

let fakeChat: ReturnType<typeof registerFake> | null = null;

/** The configured model, through the shared pi-ai registry. */
const modelStream: StreamFn = (model, context, options) => piModels.streamSimple(model, context, options);

/** Fake text provider: a scripted, context-driven reply streamed through pi-ai's faux provider. */
const fakeStream: StreamFn = (model, context, options) => {
  fakeChat!.appendResponses([(ctx) => fakeChatReply(ctx)]);
  return modelStream(model, context, options);
};

function fakeChatModel(): Model<Api> {
  if (!fakeChat) {
    const ms = fakeStreamMs();
    fakeChat = registerFake({
      provider: "fake-chat",
      models: [{ id: "fake-chat", name: "Fake chat" }],
      tokenSize: { min: 1, max: 3 },
      tokensPerSecond: ms > 0 ? 2000 / ms : undefined,
    });
  }
  return fakeChat.getModel() as unknown as Model<Api>;
}

/**
 * Repair orphaned tool calls / tool results in a transcript so LLM providers
 * never reject the context with HTTP 400.
 *
 * (a) Forward repair: an assistant `toolCall` missing its `toolResult` receives
 *     a synthetic cancelled `toolResult`.
 * (b) Backward repair: a `toolResult` whose `toolCall` is absent from the
 *     window is dropped.
 */
export function repairOrphanToolCalls(messages: AgentMessage[]): AgentMessage[] {
  const declaredCalls = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as Array<{ type?: string; id?: string }>) {
        if (block.type === "toolCall" && block.id) {
          declaredCalls.add(block.id);
        }
      }
    }
  }

  const existingResults = new Set<string>();
  for (const m of messages) {
    if (m.role === "toolResult" && m.toolCallId) {
      existingResults.add(m.toolCallId);
    }
  }

  const repaired: AgentMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      if (!msg.toolCallId || !declaredCalls.has(msg.toolCallId)) {
        continue;
      }
    }

    repaired.push(msg);

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<{ type?: string; id?: string; name?: string }>) {
        if (block.type === "toolCall" && block.id && !existingResults.has(block.id)) {
          repaired.push({
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name ?? "unknown",
            content: [{ type: "text", text: "操作已取消：引擎已重启或确认已超时。" }],
            isError: true,
            timestamp: Date.now(),
          } as AgentMessage);
          existingResults.add(block.id);
        }
      }
    }
  }
  return repaired;
}

/** Keep the newest messages, aligned on atomic turn / tool-call-pair boundaries. */
export function recentContext(messages: AgentMessage[], limit = CONTEXT_MESSAGES): AgentMessage[] {
  if (messages.length <= limit) return messages;

  // Partition into atomic units so an assistant toolCall and its toolResults stay indivisible.
  const units: Array<{ start: number; isUser: boolean; isOrphanResult: boolean }> = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === "user") {
      units.push({ start: i, isUser: true, isOrphanResult: false });
      i += 1;
      continue;
    }
    if (msg.role === "assistant") {
      const callIds = new Set<string>();
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<{ type?: string; id?: string }>) {
          if (block.type === "toolCall" && block.id) callIds.add(block.id);
        }
      }
      let j = i + 1;
      if (callIds.size > 0) {
        while (j < messages.length) {
          const next = messages[j]!;
          if (next.role === "toolResult" && next.toolCallId && callIds.has(next.toolCallId)) {
            j += 1;
          } else {
            break;
          }
        }
      }
      units.push({ start: i, isUser: false, isOrphanResult: false });
      i = j;
      continue;
    }
    units.push({ start: i, isUser: false, isOrphanResult: msg.role === "toolResult" });
    i += 1;
  }

  const minStart = messages.length - limit;
  const userUnit = units.find((u) => u.start >= minStart && u.isUser);
  const safeUnit = userUnit ?? units.find((u) => u.start >= minStart && !u.isOrphanResult);
  const fallbackUnit = units.find((u) => !u.isOrphanResult) ?? units[units.length - 1];
  const sliceStart = safeUnit?.start ?? fallbackUnit?.start ?? minStart;
  return repairOrphanToolCalls(messages.slice(sliceStart));
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text : "")).join("")
      : "";

/** Provider errors can be whole HTML pages; the UI gets the first line, clipped. */
const shortError = (message: string): string => {
  const line = message.split("\n", 1)[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
};

/** The UI form of a saved message, or null for a pure tool-call turn. */
export function chatItem(id: number, message: AgentMessage, labels: Map<string, string>): ChatItem | null {
  if (message.role === "user") return { id, role: "user", text: textOf(message.content) };
  if (message.role === "toolResult") {
    const text = textOf(message.content);
    return {
      id,
      role: "tool",
      tool: labels.get(message.toolName) ?? message.toolName,
      ok: !message.isError,
      text: message.isError ? shortError(text) : "",
    };
  }
  if (message.role !== "assistant") return null;
  const text = textOf(message.content);
  if (message.stopReason === "aborted") return { id, role: "assistant", text, error: "已停止" };
  if (message.stopReason === "error") {
    return { id, role: "assistant", text, error: shortError(message.errorMessage ?? "模型调用失败") };
  }
  return text ? { id, role: "assistant", text } : null;
}

export class ChatAgents {
  private readonly sessions = new Map<number, Agent>();
  private readonly turns = new Map<number, number>();
  private readonly streaming = new Map<number, string>();
  private readonly pending = new Map<
    number,
    { card: ChatConfirm; toolName: string; decide: (approved: boolean, resolvedBy?: "human" | "timeout" | "recovery") => void }
  >();
  private readonly labels = new Map<string, string>();

  constructor(private readonly deps: ChatAgentDeps) {
    this.sweepExpiredConfirmations();
  }

  /** Startup sweep: expire any pending chat confirmations left from a previous process crash. */
  private sweepExpiredConfirmations(): void {
    const expired = this.deps.db.expireAllPendingChatConfirmations();
    if (expired.length === 0) return;
    const byProject = new Map<number, typeof expired>();
    for (const row of expired) {
      const list = byProject.get(row.project_id) ?? [];
      list.push(row);
      byProject.set(row.project_id, list);
    }
    for (const [projectId, rows] of byProject) {
      for (const row of rows) {
        this.deps.db.appendEvent(0, projectId, "chat_confirmation_expired", {
          project_id: projectId,
          tool_call_id: row.tool_call_id,
          tool_name: row.tool_name,
          expired_count: rows.length,
          status: "expired",
          resolved_by: "recovery",
          resolved_at: row.resolved_at,
        });
      }
      this.emit(projectId, "chat_status", { project_id: projectId, busy: false, text: "", pending: null });
    }
  }

  /** The saved conversation in UI form. */
  history(projectId: number): ChatItem[] {
    this.session(projectId);
    return this.deps.db
      .chatMessages(projectId)
      .map((row) => chatItem(row.id, row.message as AgentMessage, this.labels))
      .filter((item): item is ChatItem => item !== null);
  }

  busy(projectId: number): boolean {
    return this.sessions.get(projectId)?.state.isStreaming ?? false;
  }

  status(projectId: number): ChatStatus {
    return {
      busy: this.busy(projectId),
      text: this.streaming.get(projectId) ?? "",
      pending: this.pending.get(projectId)?.card ?? null,
    };
  }

  /** Start answering `text`; `done` settles when the reply has finished. */
  send(projectId: number, text: string): { done: Promise<void> } {
    if (this.busy(projectId)) throw new ChatBusyError(projectId);
    const agent = this.session(projectId);
    // Settings may change between messages, so the model is resolved per message.
    const resolved = this.deps.llm.agentModel();
    agent.state.model = resolved.model ?? fakeChatModel();
    agent.streamFunction = this.deps.streamFn ?? (resolved.model ? modelStream : fakeStream);
    agent.getApiKey = () => requestKey(resolved.apiKey);
    agent.state.thinkingLevel = resolved.reasoning ?? "off";
    this.turns.set(projectId, 0);
    return { done: agent.prompt(text) };
  }

  abort(projectId: number): boolean {
    const agent = this.sessions.get(projectId);
    if (!agent?.state.isStreaming) return false;
    agent.abort();
    return true;
  }

  /** The user's answer to a confirmation card; false when no such card is open. */
  confirm(projectId: number, toolCallId: string, approved: boolean): boolean {
    const open = this.pending.get(projectId);
    if (!open || open.card.tool_call_id !== toolCallId) return false;
    open.decide(approved, "human");
    return true;
  }

  private emit(
    projectId: number,
    type:
      | "chat_message"
      | "chat_status"
      | "chat_confirmation_created"
      | "chat_confirmation_resolved"
      | "chat_confirmation_expired"
      | "chat_agent_thought",
    data: object,
  ): void {
    const seq = this.deps.db.appendEvent(0, projectId, type, { project_id: projectId, ...data });
    if (type === "chat_status") this.deps.db.compactChatStatus(projectId, seq);
  }

  private emitStatus(projectId: number): void {
    this.emit(projectId, "chat_status", this.status(projectId));
  }

  private ask(
    projectId: number,
    card: ChatConfirm,
    toolName: string,
    parametersJson: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const decide = (approved: boolean, resolvedBy: "human" | "timeout" | "recovery" = "human") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const status = resolvedBy === "human" ? (approved ? "approved" : "rejected") : "expired";
        const resolved = this.deps.db.resolveChatConfirmation(card.tool_call_id, status, resolvedBy);
        const resolvedAt = resolved?.resolvedAt ?? new Date().toISOString();
        if (status === "expired") {
          this.emit(projectId, "chat_confirmation_expired", {
            tool_call_id: card.tool_call_id,
            tool_name: toolName,
            expired_count: 1,
            status: "expired",
            resolved_by: resolvedBy === "timeout" ? "timeout" : "recovery",
            resolved_at: resolvedAt,
          });
        } else {
          this.emit(projectId, "chat_confirmation_resolved", {
            tool_call_id: card.tool_call_id,
            tool_name: toolName,
            status,
            resolved_by: resolvedBy,
            resolved_at: resolvedAt,
          });
        }
        this.pending.delete(projectId);
        this.emitStatus(projectId);
        resolve(approved);
      };
      const onAbort = () => decide(false, "recovery");
      const timer = setTimeout(
        () => decide(false, "timeout"),
        this.deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      const { createdAt } = this.deps.db.upsertChatConfirmation({
        projectId,
        toolCallId: card.tool_call_id,
        toolName,
        toolLabel: card.tool,
        parametersJson,
        summary: card.summary,
      });
      this.pending.set(projectId, { card, toolName, decide });
      this.emit(projectId, "chat_confirmation_created", {
        tool_call_id: card.tool_call_id,
        tool_name: toolName,
        tool_label: card.tool,
        summary: card.summary,
        status: "pending",
        created_at: createdAt,
      });
      this.emitStatus(projectId);
    });
  }

  private session(projectId: number): Agent {
    const existing = this.sessions.get(projectId);
    if (existing) return existing;
    const tools = (this.deps.tools ?? chatTools)(projectId, this.deps.api);
    for (const tool of tools) this.labels.set(tool.name, tool.label);
    const rawMessages = this.deps.db.chatMessages(projectId).map((row) => row.message as AgentMessage);
    const existingResultIds = new Set(
      rawMessages
        .filter((m): m is Extract<AgentMessage, { role: "toolResult" }> => m.role === "toolResult")
        .map((m) => m.toolCallId),
    );
    const repairedMessages = repairOrphanToolCalls(rawMessages);
    for (const msg of repairedMessages) {
      if (msg.role === "toolResult" && msg.toolCallId && !existingResultIds.has(msg.toolCallId)) {
        this.deps.db.appendChatMessage(projectId, msg);
        existingResultIds.add(msg.toolCallId);
      }
    }
    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        tools,
        messages: repairedMessages,
      },
      streamFn: modelStream,
      transformContext: async (messages) => repairOrphanToolCalls(recentContext(messages)),
      beforeToolCall: async ({ toolCall, args }, signal) => {
        const tool = tools.find((entry) => entry.name === toolCall.name);
        if (!tool?.confirm) return undefined;
        const card = {
          tool_call_id: toolCall.id,
          tool: tool.label,
          summary: tool.confirm(args as Record<string, unknown>),
        };
        if (await this.ask(projectId, card, tool.name, JSON.stringify(args ?? {}), signal)) {
          return undefined;
        }
        return { block: true, reason: "用户没有确认，这个操作没有执行。" };
      },
      finishTurn: () => {
        const turns = (this.turns.get(projectId) ?? 0) + 1;
        this.turns.set(projectId, turns);
        return turns >= MAX_TURNS ? { action: "end" } : undefined;
      },
      toolExecution: "sequential",
      sessionId: `project-${projectId}`,
    });
    let lastFrame = 0;
    let lastThoughtFrame = 0;
    agent.subscribe((event) => {
      if (event.type === "agent_start") {
        this.streaming.set(projectId, "");
        this.emit(projectId, "chat_status", { busy: true, text: "", pending: null });
      } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        this.streaming.set(projectId, textOf(event.message.content));
        if (Date.now() - lastFrame >= STREAM_FRAME_MS) {
          lastFrame = Date.now();
          this.emit(projectId, "chat_status", { busy: true, text: this.streaming.get(projectId), pending: null });
        }
      } else if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
        const thinkingText = Array.isArray(event.message.content)
          ? event.message.content
              .map((block: { type?: string; thinking?: string }) =>
                block.type === "thinking" ? (block.thinking ?? "") : "",
              )
              .join("")
          : "";
        if (Date.now() - lastThoughtFrame >= STREAM_FRAME_MS) {
          lastThoughtFrame = Date.now();
          this.emit(projectId, "chat_agent_thought", {
            agent: "chat_assistant",
            phase: "reasoning",
            content: thinkingText,
            delta: event.assistantMessageEvent.delta,
            done: false,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (event.type === "message_end") {
        this.streaming.set(projectId, "");
        const id = this.deps.db.appendChatMessage(projectId, event.message);
        const item = chatItem(id, event.message, this.labels);
        if (item) this.emit(projectId, "chat_message", { message: item });
      } else if (event.type === "agent_end") {
        this.streaming.delete(projectId);
        this.emit(projectId, "chat_status", { busy: false, text: "", pending: null });
      }
    });
    this.sessions.set(projectId, agent);
    return agent;
  }
}
