import { AGENT_NAME_MAP, type AgentMessage, type FeedbackReceipt } from "~/types";

export type ActivityKind = "run" | "handoff" | "step" | "message" | "warning" | "user" | "error" | "feedback";
export type ActivityStatus = "running" | "done" | "error";

export interface ActivityChild {
	id: string;
	label: string;
	content: string;
}

export interface ActivityEntry {
	id: string;
	kind: ActivityKind;
	agent: string;
	agentLabel: string;
	title: string;
	detail?: string;
	status: ActivityStatus;
	durationMs?: number;
	children: ActivityChild[];
	/** kind === "feedback"：闸门修改意见回执 */
	receipt?: FeedbackReceipt;
}

/** Tool/step detail rows that hang under the current step instead of standing alone. */
const CHILD_LABELS: Record<string, string> = {
	thinking: "思考",
	tool: "工具",
	tool_call: "调用",
	tool_result: "工具结果",
	step_result: "步骤结果",
	result: "审查结果",
};

const PHASE_LABELS: Record<string, string> = {
	reasoning: "分析",
	decision: "决策",
	planning: "规划",
	reviewing: "检查",
};

function isNoise(msg: AgentMessage): boolean {
	if (msg.role === "info" && msg.agent === "system") return true;
	if (msg.role === "separator" || msg.role === "handoff" || msg.role === "thinking") return false;
	return !msg.content?.trim() && !msg.isLoading;
}

function time(msg: AgentMessage): number | undefined {
	const t = msg.timestamp ? Date.parse(msg.timestamp) : Number.NaN;
	return Number.isNaN(t) ? undefined : t;
}

function childContent(msg: AgentMessage): string {
	if (msg.role === "thinking") {
		const phase = msg.phase ? PHASE_LABELS[msg.phase] : undefined;
		return [phase, msg.content?.trim()].filter(Boolean).join(" · ") || "处理中";
	}
	return msg.content?.trim() ?? "";
}

/** 引擎用 ⚠️ 标记提醒；界面用图标和警示色，正文不带 emoji。 */
const WARNING_MARK = /^\s*⚠\uFE0F?\s*/;

/** 旧消息里的「分镜 #<数据库 id>」：对外只说 S01/S02。 */
const SHOT_ID = /分镜\s*#(\d+)/g;

export function tidyShotIds(text: string, shotOrderById?: ReadonlyMap<number, number>): string {
	return text.replace(SHOT_ID, (_whole, id: string) => {
		const order = shotOrderById?.get(Number(id));
		return order === undefined ? "分镜" : `S${String(order).padStart(2, "0")}`;
	});
}

/** 同一步里的细节：「决策 · X」和紧跟的「X」是一回事，只留信息多的那条。 */
function pushChild(children: ActivityChild[], child: ActivityChild) {
	const last = children.at(-1);
	if (last && last.label === child.label && child.content && last.content) {
		if (last.content.endsWith(child.content)) return;
		if (child.content.endsWith(last.content)) {
			children[children.length - 1] = child;
			return;
		}
	}
	children.push(child);
}

/** 三个半角句点（可夹空格）或「。。。」→「…」 */
export function tidyEllipsis(text: string): string {
	return text.replace(/ ?\.(?: ?\.){2}|。{3}/g, "…");
}

/** 「正在生成视频 (3/8)」这类进度行：同一前缀只保留一行，原地更新。 */
const PROGRESS = /^(.*?)\s*[（(](\d+)\s*\/\s*(\d+)[）)]\s*$/;

interface ProgressRun {
	entry: ActivityEntry;
	key: string;
	firstStep: number;
	firstAt?: number;
}

export function formatEta(ms: number): string {
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `约 ${s} 秒`;
	return `约 ${Math.round(s / 60)} 分钟`;
}

/**
 * 把 message feed 推导成步骤时间线（纯函数）。
 * - separator 开一轮运行；handoff 是阶段交接。
 * - step 开一个步骤；thinking / tool_* / *result 挂在当前步骤下（没有就新开一个）。
 * - 其余助手消息、用户消息、错误各占一行；助手消息不结束当前步骤。
 * - 耗时 = 步骤开始到它最后一条细节；没有细节时到下一条记录。
 * - `running` 为真时，最后一个步骤标记为进行中。
 */
export function deriveActivityTimeline(
	messages: readonly AgentMessage[],
	{ running = false, shotOrderById }: { running?: boolean; shotOrderById?: ReadonlyMap<number, number> } = {},
): ActivityEntry[] {
	const entries: ActivityEntry[] = [];
	const starts: (number | undefined)[] = [];
	const ends: (number | undefined)[] = [];
	let openStep: ActivityEntry | null = null;
	let openIndex = -1;
	let progress: ProgressRun | null = null;
	const progressEntries: ActivityEntry[] = [];

	const push = (entry: ActivityEntry, msg: AgentMessage) => {
		entries.push(entry);
		starts.push(time(msg));
		ends.push(time(msg));
	};

	messages.forEach((msg, index) => {
		if (isNoise(msg)) return;
		const id = msg.id || `activity_${index}`;
		const agentLabel = AGENT_NAME_MAP[msg.agent] || msg.agent;
		const base = { id, agent: msg.agent, agentLabel, status: "done" as ActivityStatus, children: [] };

		const childLabel = CHILD_LABELS[msg.role];
		if (childLabel) {
			if (!openStep || openStep.agent !== msg.agent) {
				openStep = { ...base, kind: "step", title: agentLabel };
				push(openStep, msg);
				openIndex = entries.length - 1;
			}
			pushChild(openStep.children, { id, label: childLabel, content: childContent(msg) });
			if (msg.isLoading) openStep.status = "running";
			ends[openIndex] = time(msg) ?? ends[openIndex];
			return;
		}

		// 助手的叙述不打断当前步骤：之后的工具行仍挂在这一步下
		if (msg.role !== "assistant" && msg.role !== "info") openStep = null;
		if (msg.role === "separator") {
			push({ ...base, kind: "run", title: "新一轮运行" }, msg);
		} else if (msg.role === "handoff") {
			push({ ...base, kind: "handoff", title: msg.content?.trim() || "阶段交接" }, msg);
		} else if (msg.role === "step") {
			openStep = { ...base, kind: "step", title: msg.content.trim(), status: msg.isLoading ? "running" : "done" };
			push(openStep, msg);
			openIndex = entries.length - 1;
		} else if (msg.role === "error") {
			push({ ...base, kind: "error", title: msg.content.trim(), detail: msg.details ?? undefined, status: "error" }, msg);
		} else if (msg.role === "user") {
			push({ ...base, kind: "user", title: msg.content.trim() }, msg);
		} else if (msg.role === "feedback" && msg.receipt) {
			// 回执卡里已经引用了这条意见：同内容的用户行不再单列
			const quoted = msg.receipt.content.trim();
			let dup = -1;
			for (let i = entries.length - 1; quoted && i >= 0; i--) {
				if (entries[i].kind === "user" && entries[i].title === quoted) {
					dup = i;
					break;
				}
			}
			if (dup >= 0) {
				entries.splice(dup, 1);
				starts.splice(dup, 1);
				ends.splice(dup, 1);
			}
			push({ ...base, kind: "feedback", title: quoted, receipt: msg.receipt }, msg);
		} else {
			const title = msg.content.trim();
			const match = PROGRESS.exec(title);
			if (match) {
				const [, prefix, stepText, totalText] = match;
				const step = Number(stepText);
				const total = Number(totalText);
				const key = `${msg.agent}|${prefix}|${total}`;
				const at = time(msg);
				if (progress && progress.key === key && entries.at(-1) === progress.entry) {
					progress.entry.title = title;
					// 剩余时间：按已完成的平均间隔粗估（当前这一项还在做，算进剩余）
					const done = step - progress.firstStep;
					progress.entry.detail =
						done > 0 && at !== undefined && progress.firstAt !== undefined && at > progress.firstAt
							? `剩余${formatEta(((at - progress.firstAt) / done) * (total - step + 1))}`
							: undefined;
					return;
				}
				const entry: ActivityEntry = { ...base, kind: "message", title, status: msg.isLoading ? "running" : "done" };
				push(entry, msg);
				progress = { entry, key, firstStep: step, firstAt: at };
				progressEntries.push(entry);
				return;
			}
			if (WARNING_MARK.test(title)) {
				push({ ...base, kind: "warning", title: title.replace(WARNING_MARK, "") }, msg);
				return;
			}
			push({ ...base, kind: "message", title, status: msg.isLoading ? "running" : "done" }, msg);
		}
	});

	// 「正在…」「正在绘制分镜 (2/2)」只描述当下：后面已经有新记录，就说明它做完了，不再挂着
	// （步骤行本身带着耗时和细节，结果由它说）
	for (let i = entries.length - 2; i >= 0; i--) {
		const title = tidyEllipsis(entries[i].title.trim());
		if (entries[i].kind === "message" && (TRANSIENT.test(title) || (title.startsWith("正在") && PROGRESS.test(title)))) {
			entries.splice(i, 1);
			starts.splice(i, 1);
			ends.splice(i, 1);
		}
	}

	// 历史消息里的三个句点统一成省略号
	for (const entry of entries) {
		entry.title = tidyShotIds(tidyEllipsis(entry.title), shotOrderById);
		if (entry.detail) entry.detail = tidyShotIds(entry.detail, shotOrderById);
		for (const child of entry.children) child.content = tidyShotIds(tidyEllipsis(child.content), shotOrderById);
	}

	// 剩余时间只给仍在跑的最后一条进度
	for (const entry of progressEntries) {
		if (!running || entry !== entries.at(-1)) delete entry.detail;
	}

	entries.forEach((entry, i) => {
		if (entry.kind !== "step") return;
		const start = starts[i];
		const last = ends[i];
		// 有细节行：到最后一条细节；否则到下一条记录
		const end = last !== undefined && start !== undefined && last > start ? last : (starts[i + 1] ?? last);
		if (start !== undefined && end !== undefined && end > start) entry.durationMs = end - start;
	});

	if (running) {
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].kind === "step") {
				entries[i].status = "running";
				delete entries[i].durationMs;
				break;
			}
			if (entries[i].kind === "run") break;
		}
	}
	return entries;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
	return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** A transient "doing X…" line: the live stream says the same thing, better. */
const TRANSIENT = /…$/;

/**
 * Put the streaming call inside the step it belongs to instead of a row of its
 * own: the running step of the same agent hosts it, and the trailing
 * "正在生成…" lines of that agent are dropped. Without such a step (or with
 * anything else after it) the stream keeps its own row.
 */
export function attachLiveStream(
	entries: ActivityEntry[],
	live: { agent: string; status: string } | null,
): { entries: ActivityEntry[]; host: ActivityEntry | null } {
	if (!live || live.status === "error") return { entries, host: null };
	let i = entries.length - 1;
	while (i >= 0 && entries[i].kind === "message" && entries[i].agent === live.agent && TRANSIENT.test(entries[i].title)) {
		i -= 1;
	}
	const host = entries[i];
	if (!host || host.kind !== "step" || host.status !== "running" || host.agent !== live.agent) {
		return { entries, host: null };
	}
	return { entries: entries.slice(0, i), host };
}

export interface WarningGroup {
	kind: "warning-group";
	id: string;
	agentLabel: string;
	/** 一行说完：同一句话只换主语时合并主语，否则列出主语和条数 */
	summary: string;
	items: ActivityEntry[];
}

/** 「阿岚 未能完成审查…」：主语是第一个空格前的部分，后面是原因。 */
function splitSubject(title: string): [string, string] | null {
	const at = title.indexOf(" ");
	return at > 0 ? [title.slice(0, at), title.slice(at + 1)] : null;
}

function warningSummary(items: ActivityEntry[]): string {
	const parts = items.map((e) => splitSubject(e.title));
	if (parts.every((p) => p !== null)) {
		const subjects = [...new Set((parts as [string, string][]).map(([s]) => s))].join("、");
		const rest = (parts as [string, string][]).map(([, r]) => r);
		if (rest.every((r) => r === rest[0])) return `${subjects} ${rest[0]}`;
		return `${subjects}：${items.length} 条提醒`;
	}
	return `${items.length} 条提醒`;
}

/**
 * 同一 agent 连续发出的提醒合成一行（×N，可展开看每条）。顺序不变；单条提醒原样保留。
 */
export function groupRepeatedWarnings(entries: ActivityEntry[]): (ActivityEntry | WarningGroup)[] {
	const out: (ActivityEntry | WarningGroup)[] = [];
	let i = 0;
	while (i < entries.length) {
		const first = entries[i];
		let j = i + 1;
		if (first.kind === "warning") {
			while (j < entries.length && entries[j].kind === "warning" && entries[j].agent === first.agent) j += 1;
		}
		if (j - i >= 2) {
			const items = entries.slice(i, j);
			out.push({ kind: "warning-group", id: `warnings-${first.id}`, agentLabel: first.agentLabel, summary: warningSummary(items), items });
		} else {
			out.push(first);
		}
		i = j;
	}
	return out;
}
