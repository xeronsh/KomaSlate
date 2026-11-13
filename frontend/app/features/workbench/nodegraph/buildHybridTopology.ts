import type {
	ChatState,
	Character,
	Project,
	Shot,
} from "~/types";
import type { RunState } from "~/query/runState";
import { stepForStage } from "~/utils/workflowSteps";
import {
	GRAPH_NODE_HEIGHT,
	GRAPH_NODE_WIDTH,
	GRAPH_RANK_GAP_X,
	GRAPH_ROW_GAP_Y,
	type HybridGraphEdge,
	type HybridGraphNode,
	type HybridNodeStatus,
} from "./bezierWires";

export interface OutboundMcpSummary {
	id: string;
	name: string;
	transport: string;
	enabled: boolean;
	status?: "online" | "offline" | "error";
	latencyMs?: number | null;
	policy?: "auto_readonly" | "confirm_writes";
	toolsCount?: number;
}

export interface CliToolSummary {
	name: string;
	version: string;
	description: string;
	sampleCommand: string;
	available?: boolean;
}

export interface HybridTopologyInput {
	project: Project;
	characters: Character[];
	shots: Shot[];
	runState: Pick<
		RunState,
		| "isGenerating"
		| "currentRunId"
		| "currentStage"
		| "currentStep"
		| "progress"
		| "awaitingConfirm"
		| "awaitingAgent"
		| "recoveryGate"
		| "recoveryControl"
	> & { currentAgent?: string | null };
	chatState?: ChatState | null;
	mcpServers?: OutboundMcpSummary[];
	cliTools?: CliToolSummary[];
	selectedShotId?: number | null;
	inboundRunning?: boolean;
}

export interface HybridTopologyGraph {
	nodes: HybridGraphNode[];
	edges: HybridGraphEdge[];
	bounds: { width: number; height: number };
}

const RANK_STEP_X = GRAPH_NODE_WIDTH + GRAPH_RANK_GAP_X;
const ROW_STEP_Y = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP_Y;
const ORIGIN_X = 32;
const ORIGIN_Y = 36;

function rankX(rank: 0 | 1 | 2 | 3 | 4): number {
	return ORIGIN_X + rank * RANK_STEP_X;
}

function rowY(row: number): number {
	return ORIGIN_Y + row * ROW_STEP_Y;
}

export function buildHybridTopology({
	project,
	characters,
	shots,
	runState,
	chatState,
	mcpServers = [],
	cliTools = [],
	selectedShotId = null,
	inboundRunning = true,
}: HybridTopologyInput): HybridTopologyGraph {
	const activeShot =
		(selectedShotId ? shots.find((s) => s.id === selectedShotId) : null) ??
		shots.find((s) => s.review_status === "failed" || s.review_status === "unchecked") ??
		shots[0] ??
		null;

	const currentStepMeta = stepForStage(
		runState.recoveryGate?.current_stage ??
			runState.recoveryGate?.stage ??
			runState.currentStep,
	);

	const blockedOrUncheckedShots = shots.filter(
		(s) => s.review_status === "failed" || s.review_status === "unchecked",
	);

	const stageStatus: HybridNodeStatus = runState.isGenerating
		? "running"
		: blockedOrUncheckedShots.length > 0
			? "warn"
			: shots.length > 0
				? "ready"
				: "idle";

	const gateStatus: HybridNodeStatus = runState.awaitingConfirm
		? "waiting"
		: runState.recoveryControl?.state === "recoverable"
			? "warn"
			: runState.isGenerating
				? "ready"
				: "idle";

	const agentStatus: HybridNodeStatus = chatState?.pending
		? "waiting"
		: chatState?.busy
			? "running"
			: blockedOrUncheckedShots.length > 0
				? "warn"
				: "ready";

	const progressPct = Math.round(
		Math.max(0, Math.min(1, runState.progress ?? 0)) * 100,
	);

	const primaryMcp = mcpServers[0];
	const onlineMcpCount = mcpServers.filter((m) => m.enabled).length;
	const mcpStatus: HybridNodeStatus = !primaryMcp
		? "idle"
		: !primaryMcp.enabled
			? "idle"
			: primaryMcp.status === "error"
				? "error"
				: "ready";

	const cliStatus: HybridNodeStatus = runState.isGenerating &&
		(runState.currentStage === "render" || runState.currentStage === "compose")
		? "running"
		: cliTools.length > 0
			? "ready"
			: "idle";

	const inboundStatus: HybridNodeStatus = inboundRunning ? "ready" : "idle";

	const nodes: HybridGraphNode[] = [
		{
			id: "wf_plan",
			kind: "wf_stage",
			rank: 0,
			x: rankX(0),
			y: rowY(0),
			badge: "STAGE",
			title: runState.currentStep
				? `stage: ${runState.currentStep}`
				: "stage: storyboard_plan",
			subtitle: currentStepMeta
				? `${currentStepMeta.label} · ${characters.length} 角色 · ${shots.length} 分镜`
				: `${characters.length} 角色 · ${shots.length} 分镜`,
			status: stageStatus,
			progressPct: runState.isGenerating ? progressPct : shots.length > 0 ? 100 : 0,
			revision: project.revision ?? 1,
			inputs: [{ name: "story", type: "ProjectBrief" }],
			outputs: [
				{ name: "visual_bible", type: "BibleSpec" },
				{ name: "shots", type: `Shot[${shots.length}]` },
			],
			targetRef: { kind: "stage", id: runState.currentStep ?? "plan_shots" },
		},
		{
			id: "wf_gate",
			kind: "wf_gate",
			rank: 1,
			x: rankX(1),
			y: rowY(1),
			badge: "GATE",
			title: runState.awaitingConfirm
				? `gate: ${currentStepMeta?.label ?? runState.awaitingAgent ?? "审批门"}`
				: "gate: human_approval",
			subtitle: runState.awaitingConfirm
				? "等待人类放行 · Lease 有效"
				: "仅限人类决策 · 禁止自批",
			status: gateStatus,
			revision: runState.currentRunId ?? project.revision ?? 1,
			inputs: [{ name: "candidate", type: "StageArtifact" }],
			outputs: [{ name: "human_decision", type: "Confirm|Feedback" }],
			targetRef: {
				kind: "gate",
				id: String(runState.currentRunId ?? "none"),
			},
		},
		{
			id: "agent_core",
			kind: "agent_core",
			rank: 2,
			x: rankX(2),
			y: rowY(0.5),
			badge: "AGENT",
			title: "pi-agent-core 协同体",
			subtitle: chatState?.pending
				? `待确认: ${chatState.pending.tool}`
				: chatState?.busy
					? "正在推理与工具规划…"
					: activeShot
						? `S${String(activeShot.order).padStart(2, "0")} · CAS rev=${activeShot.revision ?? 1}`
						: "就绪 · 写操作需人工确认",
			status: agentStatus,
			revision: activeShot?.revision ?? project.revision ?? 1,
			inputs: [
				{ name: "context", type: "StoryboardGraph" },
				{ name: "prompt", type: "UserTurn" },
			],
			outputs: [
				{ name: "tool_calls", type: "ConfirmedAction[]" },
				{ name: "patch", type: "CASPatch" },
			],
			targetRef: { kind: "agent", id: "pi-agent-core" },
		},
		{
			id: "mcp_out",
			kind: "mcp_out",
			rank: 3,
			x: rankX(3),
			y: rowY(0),
			badge: "MCP OUT",
			title: primaryMcp ? primaryMcp.name : "Outbound MCP Pool",
			subtitle:
				mcpServers.length > 0
					? `${onlineMcpCount}/${mcpServers.length} 在线 · ${primaryMcp?.transport ?? "stdio/HTTP"}`
					: "可在协议枢纽配置外部 MCP",
			status: mcpStatus,
			latencyMs: primaryMcp?.latencyMs ?? null,
			revision: activeShot?.revision ?? null,
			inputs: [{ name: "jsonrpc", type: "tools/call" }],
			outputs: [{ name: "artifact", type: "LocalPathZeroCopy" }],
			targetRef: { kind: "mcp", id: primaryMcp?.id ?? "pool" },
		},
		{
			id: "cli_runner",
			kind: "cli_runner",
			rank: 3,
			x: rankX(3),
			y: rowY(1),
			badge: "CLI",
			title: "komaslate / media CLI",
			subtitle:
				cliTools.length > 0
					? `${cliTools.map((t) => t.name).slice(0, 3).join(" · ")}`
					: "dreamina · ffmpeg · media-bridge",
			status: cliStatus,
			inputs: [{ name: "argv", type: "StdioCommand" }],
			outputs: [
				{ name: "media", type: "MP4|PNG" },
				{ name: "stdout", type: "StreamLog" },
			],
			targetRef: { kind: "cli", id: cliTools[0]?.name ?? "komaslate" },
		},
		{
			id: "mcp_inbound",
			kind: "mcp_inbound",
			rank: 4,
			x: rankX(4),
			y: rowY(0.5),
			badge: "INBOUND",
			title: "komaslate mcp serve",
			subtitle: inboundRunning
				? "北向网关就绪 · Claude / Cursor"
				: "北向 MCP 未暴露",
			status: inboundStatus,
			revision: project.revision ?? 1,
			inputs: [
				{ name: "resources", type: "komaslate://*" },
				{ name: "tools", type: "CASGuardedTools" },
			],
			outputs: [{ name: "client", type: "ExternalIDE" }],
			targetRef: { kind: "inbound", id: "komaslate-mcp" },
		},
	];

	const edges: HybridGraphEdge[] = [
		{
			id: "edge:plan-gate",
			sourceId: "wf_plan",
			targetId: "wf_gate",
			kind: "wf_stage",
			active: runState.isGenerating || runState.awaitingConfirm,
		},
		{
			id: "edge:plan-agent",
			sourceId: "wf_plan",
			targetId: "agent_core",
			kind: "wf_stage",
			active: Boolean(chatState?.busy),
		},
		{
			id: "edge:gate-agent",
			sourceId: "wf_gate",
			targetId: "agent_core",
			kind: "wf_gate",
			active: runState.awaitingConfirm,
		},
		{
			id: "edge:agent-mcp",
			sourceId: "agent_core",
			targetId: "mcp_out",
			kind: "mcp_out",
			active: Boolean(chatState?.busy) || (onlineMcpCount > 0 && runState.isGenerating),
		},
		{
			id: "edge:agent-cli",
			sourceId: "agent_core",
			targetId: "cli_runner",
			kind: "cli_runner",
			active: cliStatus === "running",
		},
		{
			id: "edge:mcp-inbound",
			sourceId: "mcp_out",
			targetId: "mcp_inbound",
			kind: "mcp_inbound",
			active: inboundStatus === "ready" && onlineMcpCount > 0,
		},
		{
			id: "edge:cli-inbound",
			sourceId: "cli_runner",
			targetId: "mcp_inbound",
			kind: "cli_runner",
			active: cliStatus === "running",
		},
	];

	const maxX = Math.max(...nodes.map((n) => n.x + 240)) + 48;
	const maxY = Math.max(...nodes.map((n) => n.y + 128)) + 48;

	return {
		nodes,
		edges,
		bounds: { width: maxX, height: maxY },
	};
}
