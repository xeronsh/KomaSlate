import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/Button";
import { PlainButton } from "~/components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import {
	computeCubicBezierPath,
	getNodePorts,
	getSemanticLod,
	LOD_DIMENSIONS,
	type HybridGraphEdge,
	type HybridGraphNode,
	type HybridNodeKind,
	type HybridNodeStatus,
	type NodeDimensions,
	type SemanticLodTier,
} from "./bezierWires";
import {
	buildHybridTopology,
	type CliToolSummary,
	type OutboundMcpSummary,
} from "./buildHybridTopology";
import type { ChatState, Character, Project, Shot } from "~/types";
import type { RunState } from "~/query/runState";
import "~/components/ui/icons/workbenchIcons";

export interface NodeGraphCanvasProps {
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
	activeNodeId: string | null;
	onSelectNode: (node: HybridGraphNode) => void;
	onOpenHub?: (tab?: "outbound" | "cli" | "inbound") => void;
	onInspectNode?: (node: HybridGraphNode) => void;
	onTriggerNodeAction?: (node: HybridGraphNode) => void;
}

const KIND_WIRE_COLOR: Record<HybridNodeKind, string> = {
	wf_stage: "rgb(var(--color-wire-stage))",
	wf_gate: "rgb(var(--color-wire-gate))",
	agent_core: "rgb(var(--color-wire-agent))",
	mcp_out: "rgb(var(--color-wire-mcp-out))",
	cli_runner: "rgb(var(--color-wire-cli))",
	mcp_inbound: "rgb(var(--color-wire-mcp-in))",
};

const KIND_TEXT_CLASS: Record<HybridNodeKind, string> = {
	wf_stage: "text-wire-stage",
	wf_gate: "text-wire-gate",
	agent_core: "text-wire-agent",
	mcp_out: "text-wire-mcp-out",
	cli_runner: "text-wire-cli",
	mcp_inbound: "text-wire-mcp-in",
};

const KIND_BORDER_CLASS: Record<HybridNodeKind, string> = {
	wf_stage: "border-wire-stage/40",
	wf_gate: "border-wire-gate/50",
	agent_core: "border-wire-agent/45",
	mcp_out: "border-wire-mcp-out/45",
	cli_runner: "border-wire-cli/45",
	mcp_inbound: "border-wire-mcp-in/45",
};

const STATUS_DOT_CLASS: Record<HybridNodeStatus, string> = {
	idle: "bg-ink/35",
	running: "bg-success motion-safe:animate-pulse",
	waiting: "bg-warning",
	ready: "bg-info",
	warn: "bg-warning",
	error: "bg-error",
};

const STATUS_LABEL: Record<HybridNodeStatus, string> = {
	idle: "IDLE",
	running: "RUN",
	waiting: "GATE",
	ready: "READY",
	warn: "WARN",
	error: "ERR",
};

const LOD_LABEL: Record<SemanticLodTier, string> = {
	macro: "宏观胶囊 Macro",
	mid: "标准工作 Mid",
	micro: "端口检视 Micro",
};

const LEGEND_ITEMS: Array<{ kind: HybridNodeKind; label: string }> = [
	{ kind: "wf_stage", label: "Workflow" },
	{ kind: "wf_gate", label: "Human Gate" },
	{ kind: "agent_core", label: "Agent" },
	{ kind: "mcp_out", label: "Outbound MCP" },
	{ kind: "cli_runner", label: "CLI Runner" },
	{ kind: "mcp_inbound", label: "Inbound MCP" },
];

const GraphEdgeItem = memo(function GraphEdgeItem({
	edge,
	src,
	dst,
	nodeDims,
}: {
	edge: HybridGraphEdge;
	src: HybridGraphNode;
	dst: HybridGraphNode;
	nodeDims: NodeDimensions;
}) {
	const { srcX, srcY } = getNodePorts(src, nodeDims);
	const { dstX, dstY } = getNodePorts(dst, nodeDims);
	const pathString = computeCubicBezierPath(srcX, srcY, dstX, dstY);
	const edgeColor = KIND_WIRE_COLOR[edge.kind];
	const markerRef =
		edge.kind === "wf_stage"
			? "url(#wire-arrow)"
			: `url(#wire-arrow-${edge.kind})`;

	return (
		<g>
			<path
				d={pathString}
				fill="none"
				stroke={edgeColor}
				strokeWidth={2}
				strokeOpacity={edge.active ? 0.9 : 0.65}
				strokeDasharray="6 6"
				markerEnd={markerRef}
				className={
					edge.active
						? "animate-flow-dash motion-reduce:animate-none"
						: undefined
				}
			/>
			<circle cx={srcX} cy={srcY} r="3" fill={edgeColor} />
			<circle cx={dstX} cy={dstY} r="3" fill={edgeColor} />
			{edge.active ? (
				<circle r="3.5" fill={edgeColor} className="motion-reduce:hidden">
					<animateMotion
						path={pathString}
						dur="1.8s"
						repeatCount="indefinite"
					/>
				</circle>
			) : null}
		</g>
	);
});

const GraphNodeItem = memo(function GraphNodeItem({
	node,
	lod,
	zoom,
	nodeDims,
	isActive,
	onSelectNode,
	onInspectNode,
	onTriggerNodeAction,
}: {
	node: HybridGraphNode;
	lod: SemanticLodTier;
	zoom: number;
	nodeDims: NodeDimensions;
	isActive: boolean;
	onSelectNode: (node: HybridGraphNode) => void;
	onInspectNode?: (node: HybridGraphNode) => void;
	onTriggerNodeAction?: (node: HybridGraphNode) => void;
}) {
	const invScale = lod === "macro" ? Math.min(2, 1 / Math.max(zoom, 0.45)) : 1;

	return (
		<div
			data-graph-node={node.id}
			data-lod-tier={lod}
			className="absolute"
			style={{
				left: node.x,
				top: node.y,
				width: nodeDims.width,
				height: nodeDims.height,
				transform: lod === "macro" ? `scale(${invScale})` : undefined,
				transformOrigin: "top left",
			}}
		>
			<PlainButton
				onClick={() => onSelectNode(node)}
				aria-label={`${node.badge} ${node.title}`}
				aria-pressed={isActive}
				className={`ink-bleed-hover flex h-full w-full flex-col justify-between rounded-lg border bg-surface p-2.5 text-left transition-colors duration-fast ${
					isActive
						? "border-primary ring-2 ring-primary/30"
						: KIND_BORDER_CLASS[node.kind]
				}`}
			>
				<div className="flex w-full items-center justify-between gap-1.5">
					<span
						className={`truncate font-mono text-xs font-semibold ${KIND_TEXT_CLASS[node.kind]}`}
					>
						{node.badge}
					</span>
					<span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-ink-muted">
						<span
							className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[node.status]}`}
							aria-hidden="true"
						/>
						{STATUS_LABEL[node.status]}
					</span>
				</div>

				{lod === "macro" ? (
					<div className="truncate font-mono text-xs font-semibold text-ink">
						{node.title}
					</div>
				) : (
					<div className="min-w-0">
						<div className="truncate font-mono text-xs font-semibold text-ink">
							{node.title}
						</div>
						<div className="mt-0.5 truncate text-xs text-ink-muted">
							{node.subtitle}
						</div>
					</div>
				)}

				{lod === "micro" ? (
					<div className="mt-1 flex flex-col gap-1 border-t border-line pt-1">
						<div className="flex items-center justify-between gap-2 font-mono text-xs text-ink-muted">
							<span className="truncate">
								in: {node.inputs.map((i) => i.name).join(", ")}
							</span>
							{node.revision != null ? (
								<span className="shrink-0 rounded-sm bg-paper-200 px-1 text-ink">
									rev={node.revision}
								</span>
							) : null}
						</div>
						<div className="flex items-center justify-between gap-2 font-mono text-xs text-ink-muted">
							<span className="truncate">
								out: {node.outputs.map((o) => o.name).join(", ")}
							</span>
							{node.latencyMs != null ? (
								<span className="shrink-0 text-info-fg">
									{node.latencyMs}ms
								</span>
							) : null}
						</div>
					</div>
				) : null}
			</PlainButton>

			{lod === "micro" && (onTriggerNodeAction || onInspectNode) ? (
				<div className="mt-1 flex items-center justify-end gap-1">
					{onInspectNode ? (
						<Button
							size="xs"
							variant="ghost"
							onClick={() => onInspectNode(node)}
						>
							检视
						</Button>
					) : null}
					{onTriggerNodeAction ? (
						<Button
							size="xs"
							variant="secondary"
							onClick={() => onTriggerNodeAction(node)}
						>
							执行
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
});

export function NodeGraphCanvas({
	project,
	characters,
	shots,
	runState,
	chatState,
	mcpServers = [],
	cliTools = [],
	selectedShotId = null,
	activeNodeId,
	onSelectNode,
	onOpenHub,
	onInspectNode,
	onTriggerNodeAction,
}: NodeGraphCanvasProps) {
	const [zoom, setZoom] = useState(0.95);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const draggingRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
	const stageContainerRef = useRef<HTMLDivElement>(null);
	const glowRafRef = useRef<number | null>(null);
	const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		return () => {
			if (glowRafRef.current !== null) cancelAnimationFrame(glowRafRef.current);
		};
	}, []);

	const lod = getSemanticLod(zoom);
	const nodeDims = LOD_DIMENSIONS[lod];

	const topology = useMemo(
		() =>
			buildHybridTopology({
				project,
				characters,
				shots,
				runState,
				chatState,
				mcpServers,
				cliTools,
				selectedShotId,
			}),
		[project, characters, shots, runState, chatState, mcpServers, cliTools, selectedShotId],
	);

	const nodeById = useMemo(
		() => new Map(topology.nodes.map((n) => [n.id, n])),
		[topology.nodes],
	);

	const activeNode =
		(activeNodeId ? nodeById.get(activeNodeId) : null) ?? topology.nodes[0] ?? null;

	const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		const el = stageContainerRef.current;
		if (el) {
			const rect = el.getBoundingClientRect();
			pendingCursorRef.current = {
				x: Math.round(event.clientX - rect.left),
				y: Math.round(event.clientY - rect.top),
			};
			if (glowRafRef.current === null) {
				glowRafRef.current = requestAnimationFrame(() => {
					glowRafRef.current = null;
					const target = stageContainerRef.current;
					const pos = pendingCursorRef.current;
					if (target && pos) {
						target.style.setProperty("--cursor-x", `${pos.x}px`);
						target.style.setProperty("--cursor-y", `${pos.y}px`);
					}
				});
			}
		}
		if (draggingRef.current) {
			const dx = event.clientX - draggingRef.current.startX;
			const dy = event.clientY - draggingRef.current.startY;
			setPan({
				x: draggingRef.current.origX + dx,
				y: draggingRef.current.origY + dy,
			});
		}
	}, []);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if ((event.target as HTMLElement).closest("[data-graph-node]")) return;
			draggingRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				origX: pan.x,
				origY: pan.y,
			};
		},
		[pan.x, pan.y],
	);

	const handlePointerUp = useCallback(() => {
		draggingRef.current = null;
	}, []);

	const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			const delta = event.deltaY < 0 ? 0.1 : -0.1;
			setZoom((z) => Math.max(0.35, Math.min(1.6, Math.round((z + delta) * 100) / 100)));
		}
	}, []);

	const handleFit = useCallback(() => {
		setPan({ x: 0, y: 0 });
		setZoom(0.95);
	}, []);

	return (
		<section
			className="flex h-full min-h-0 flex-col overflow-hidden bg-paper-100"
			aria-label="Option 3 混合编排节点画布"
			data-testid="node-graph-canvas"
			data-lod={lod}
		>
			{/* 顶部控制栏 */}
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1.5">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="text-xs font-semibold text-ink">混合编排有向图</span>
					{activeNode ? (
						<span className="max-w-full truncate rounded-full border border-line bg-paper-200 px-2 py-0.5 text-xs text-ink-muted">
							聚焦：<span className="font-mono text-ink">{activeNode.title}</span>
						</span>
					) : null}
					<span
						className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
						data-testid="lod-badge"
					>
						{LOD_LABEL[lod]} · <span className="font-mono">{Math.round(zoom * 100)}%</span>
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<div className="hidden items-center gap-2.5 text-xs text-ink-muted xl:flex" aria-label="拓扑图例">
						{LEGEND_ITEMS.map((item) => (
							<span key={item.kind} className="inline-flex items-center gap-1 font-mono">
								<span
									className="inline-block h-2 w-2 rounded-full"
									style={{ backgroundColor: KIND_WIRE_COLOR[item.kind] }}
									aria-hidden="true"
								/>
								{item.label}
							</span>
						))}
					</div>

					<div className="flex items-center gap-1 rounded-md border border-line bg-paper-200 p-0.5">
						<PlainButton
							className={`rounded-sm px-2 py-0.5 font-mono text-xs transition-colors duration-fast ${
								lod === "macro"
									? "bg-primary text-primary-content"
									: "text-ink-muted hover:bg-surface hover:text-ink"
							}`}
							onClick={() => setZoom(0.4)}
							aria-label="切换 40% 宏观缩放"
						>
							40%
						</PlainButton>
						<PlainButton
							className={`rounded-sm px-2 py-0.5 font-mono text-xs transition-colors duration-fast ${
								lod === "mid"
									? "bg-primary text-primary-content"
									: "text-ink-muted hover:bg-surface hover:text-ink"
							}`}
							onClick={() => setZoom(0.95)}
							aria-label="切换 95% 标准缩放"
						>
							95%
						</PlainButton>
						<PlainButton
							className={`rounded-sm px-2 py-0.5 font-mono text-xs transition-colors duration-fast ${
								lod === "micro"
									? "bg-primary text-primary-content"
									: "text-ink-muted hover:bg-surface hover:text-ink"
							}`}
							onClick={() => setZoom(1.3)}
							aria-label="切换 130% 微观缩放"
						>
							130%
						</PlainButton>
					</div>

					<Button size="xs" variant="ghost" onClick={handleFit} aria-label="重置节点视图">
						<SvgIcon name="expand" size={14} />
						适应
					</Button>
					{onOpenHub ? (
						<Button
							size="xs"
							variant="secondary"
							onClick={() => onOpenHub("outbound")}
							aria-label="打开 MCP 与 CLI 协议枢纽"
						>
							<SvgIcon name="sliders" size={14} />
							协议枢纽
						</Button>
					) : null}
				</div>
			</div>

			{/* 指针光晕网格舞台 */}
			<div
				ref={stageContainerRef}
				className="workbench-canvas-frame workbench-cursor-glow relative min-h-0 flex-1 overflow-auto overscroll-contain select-none"
				onPointerMove={handlePointerMove}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				onPointerLeave={handlePointerUp}
				onWheel={handleWheel}
			>
				<div
					className="relative origin-top-left transition-transform duration-fast ease-standard"
					style={{
						width: topology.bounds.width,
						height: topology.bounds.height,
						transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
					}}
				>
					{/* SVG Cubic Bezier 有向连线层 */}
					<svg
						className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
						viewBox={`0 0 ${topology.bounds.width} ${topology.bounds.height}`}
						aria-hidden="true"
					>
						<defs>
							<marker
								id="wire-arrow"
								viewBox="0 0 10 10"
								refX="8"
								refY="5"
								markerWidth="6"
								markerHeight="6"
								orient="auto-start-reverse"
							>
								<path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgb(var(--color-primary))" />
							</marker>
							{(Object.keys(KIND_WIRE_COLOR) as HybridNodeKind[]).map((kind) => (
								<marker
									key={kind}
									id={`wire-arrow-${kind}`}
									viewBox="0 0 10 10"
									refX="8"
									refY="5"
									markerWidth="6"
									markerHeight="6"
									orient="auto-start-reverse"
								>
									<path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={KIND_WIRE_COLOR[kind]} />
								</marker>
							))}
						</defs>

						{topology.edges.map((edge) => {
							const src = nodeById.get(edge.sourceId);
							const dst = nodeById.get(edge.targetId);
							if (!src || !dst) return null;
							return (
								<GraphEdgeItem
									key={edge.id}
									edge={edge}
									src={src}
									dst={dst}
									nodeDims={nodeDims}
								/>
							);
						})}
					</svg>

					{/* 三阶语义 LOD 节点卡层 */}
					{topology.nodes.map((node) => (
						<GraphNodeItem
							key={node.id}
							node={node}
							lod={lod}
							zoom={zoom}
							nodeDims={nodeDims}
							isActive={activeNode?.id === node.id}
							onSelectNode={onSelectNode}
							onInspectNode={onInspectNode}
							onTriggerNodeAction={onTriggerNodeAction}
						/>
					))}
				</div>
			</div>
		</section>
	);
}
