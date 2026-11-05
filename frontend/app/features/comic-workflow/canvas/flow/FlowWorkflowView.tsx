import {
	Background,
	ReactFlow,
	ReactFlowProvider,
	useNodesState,
	useReactFlow,
	useViewport,
	type NodeProps,
	type NodeTypes,
	type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { PlainButton } from "~/components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { projectQueryKeys } from "~/query/queryKeys";
import { projectsApi } from "~/services/api";
import { useThemeStore } from "~/stores/themeStore";
import { motionDuration } from "~/utils/motion";
import { toast } from "~/utils/toast";
import type { ComicWorkflowGraph, ComicWorkflowSection } from "../../graph/types";
import {
	SHOT_GRID_COLUMNS,
	type ComicWorkflowLayout,
} from "../../graph/layoutComicWorkflow";
import { WorkflowCardView, WorkflowFrameView } from "../WorkflowCards";
import {
	ComicCanvasToolbar,
	type CanvasViewControls,
} from "../toolbar/ComicCanvasToolbar";
import { toolForKey } from "../toolbar/toolShortcut";
import {
	frameNodeId,
	shotReadingOrder,
	moveShot,
	toFlowNodes,
	type CardFlowNode,
	type FrameFlowNode,
	type WorkflowFlowNode,
	type WorkflowInteractionMode,
} from "./toFlowNodes";
import { CardContextMenu, type CardMenuState, menuPosition } from "./CardContextMenu";

const CANVAS_SECTIONS: ReadonlyArray<{
	section: Extract<ComicWorkflowSection, "elements" | "shotline" | "output">;
	num: string;
	label: string;
}> = [
	{ section: "elements", num: "01", label: "角色" },
	{ section: "shotline", num: "02", label: "分镜" },
	{ section: "output", num: "03", label: "成片" },
];

/** 与 <ReactFlow minZoom> 一致：手动缩放的下限。 */
const MIN_ZOOM = 0.2;
/** 卡片标题 13px：自动适配不低于 12/13，屏幕字号就 ≥ 12px。 */
const READABLE_ZOOM = 12 / 13;
/**
 * 适配整块画板（角色、分镜、成片三个 frame）：放大不超过 1，在剩余空间里居中。
 * 整块放不下可读字号时，停在可读下限并以分镜区（focus）为中心，两侧 frame 可以被裁掉。
 * 手动「适应视图」传 floor = MIN_ZOOM：总是显示整块画板（Figma 的 Shift+1），不受可读下限限制。
 * 留白让出两侧打开的浮动面板，以及底部提示栏 + 工具条
 * （--toolbar-offset 6.75rem + 工具条 ~44px + 16px 间隙）。
 */
export function boardViewport(
	bounds: { x: number; y: number; width: number; height: number },
	viewport: { width: number; height: number },
	insets = { left: 0, right: 0 },
	focus = bounds,
	floor = READABLE_ZOOM,
) {
	const pad = { left: 48 + insets.left, right: 48 + insets.right, top: 48, bottom: 168 };
	const availW = Math.max(1, viewport.width - pad.left - pad.right);
	const availH = Math.max(1, viewport.height - pad.top - pad.bottom);
	const fitZoom = Math.min(availW / bounds.width, availH / bounds.height);
	const zoom = Math.min(1, Math.max(floor, fitZoom));
	const box = fitZoom < floor ? focus : bounds;
	const axis = (start: number, avail: number, size: number, origin: number) =>
		size * zoom <= avail
			? start + (avail - size * zoom) / 2 - origin * zoom
			: start - origin * zoom;
	return {
		x: axis(pad.left, availW, box.width, box.x),
		y: axis(pad.top, availH, box.height, box.y),
		zoom,
	};
}

const nodeTypes: NodeTypes = {
	frame: ({ data }: NodeProps<FrameFlowNode>) => (
		<WorkflowFrameView {...data} />
	),
	card: ({ data, selected }: NodeProps<CardFlowNode>) => (
		<WorkflowCardView
			node={data.node}
			draggable={data.draggable}
			selected={selected}
		/>
	),
};

type Positions = Record<string, { x: number; y: number }>;

function readPositions(key: string, legacyKey?: string): Positions {
	try {
		const raw = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null) ?? "{}";
		return JSON.parse(raw) as Positions;
	} catch {
		return {};
	}
}

export interface FlowWorkflowViewProps {
	projectId: number;
	graph: ComicWorkflowGraph;
	layout: ComicWorkflowLayout;
	interactionMode: WorkflowInteractionMode;
	sortMode: boolean;
	structureLocked: boolean;
	onToggleSortMode: () => void;
	onSorted: () => void;
	onSelectedNodeIdChange?: (nodeId: string | null) => void;
	onSelectedNodeIdsChange?: (nodeIds: string[]) => void;
	onOpenAssets?: () => void;
	fitInsets?: { left: number; right: number };
	/** 停在审批门上时要审的那一块：画布平移过去，让人直接看到产物。 */
	focusSection?: ComicWorkflowSection | null;
}

export function FlowWorkflowView(props: FlowWorkflowViewProps) {
	return (
		<ReactFlowProvider>
			<FlowInner {...props} />
		</ReactFlowProvider>
	);
}

function FlowInner({
	projectId,
	graph,
	layout,
	interactionMode,
	sortMode,
	structureLocked,
	onToggleSortMode,
	onSorted,
	onSelectedNodeIdChange,
	onSelectedNodeIdsChange,
	onOpenAssets,
	fitInsets,
	focusSection = null,
}: FlowWorkflowViewProps) {
	const flow = useReactFlow<WorkflowFlowNode>();
	const { zoom } = useViewport();
	const queryClient = useQueryClient();
	const theme = useThemeStore((s) => s.theme);
	const storageKey = `komaslate.flow.frames.${projectId}`;
	const [framePositions, setFramePositions] = useState<Positions>(() =>
		readPositions(storageKey, `openoii.flow.frames.${projectId}`),
	);
	const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowFlowNode>([]);
	const [tool, setTool] = useState<"select" | "hand">("select");
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const next = toolForKey(event);
			if (next) setTool(next);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	const selectedRef = useRef<string[]>([]);
	const fittedRef = useRef(false);
	// 用户自己平移/缩放之后，面板开合不再挪动画板
	const autoFitRef = useRef(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const insetsRef = useRef(fitInsets);
	insetsRef.current = fitInsets;
	// 画布只占两侧栏之间那一栏（见 globals.css），适配按这一栏的尺寸算
	const canvasSize = useCallback(() => {
		const el = containerRef.current;
		if (!el) return null;
		const { left = 0, right = 0 } = insetsRef.current ?? {};
		return { width: Math.max(1, el.clientWidth - left - right), height: el.clientHeight };
	}, []);

	useEffect(() => {
		const selected = new Set(selectedRef.current);
		setNodes(
			toFlowNodes(graph, layout, interactionMode, framePositions).map((n) =>
				selected.has(n.id) ? { ...n, selected: true } : n,
			),
		);
	}, [framePositions, graph, interactionMode, layout, setNodes]);

	const fit = useCallback(
		(duration: number, whole = false) => {
			const size = canvasSize();
			const target = flow.getNodes();
			if (!size || target.length === 0) return;
			const bounds = flow.getNodesBounds(target);
			if (bounds.width === 0 || bounds.height === 0) return;
			const shotline = flow.getNode(frameNodeId("shotline"));
			// 手动看全图之后，面板开合不再按可读下限重新适配
			autoFitRef.current = !whole;
			void flow.setViewport(
				boardViewport(
					bounds,
					size,
					undefined,
					shotline ? flow.getNodesBounds([shotline]) : bounds,
					whole ? MIN_ZOOM : READABLE_ZOOM,
				),
				{ duration },
			);
		},
		[canvasSize, flow],
	);

	useEffect(() => {
		if (fittedRef.current || nodes.length === 0) return;
		fittedRef.current = true;
		requestAnimationFrame(() => fit(0));
	}, [fit, nodes.length]);

	const insetLeft = fitInsets?.left ?? 0;
	const insetRight = fitInsets?.right ?? 0;
	// 左栏开合会挪动画布这一栏的原点；同一帧把视口反向平移，画上的东西在屏幕上不跳
	const prevLeftRef = useRef(insetLeft);
	useLayoutEffect(() => {
		const delta = insetLeft - prevLeftRef.current;
		prevLeftRef.current = insetLeft;
		if (!delta || !fittedRef.current) return;
		const vp = flow.getViewport();
		void flow.setViewport({ ...vp, x: vp.x - delta });
	}, [flow, insetLeft]);
	const focusFrame = useCallback(
		(section: ComicWorkflowSection) => {
			const frame = flow.getNode(frameNodeId(section));
			const size = canvasSize();
			if (!frame || !size) return;
			// 平移到指定分区后，面板开合不再把视口拉回整板
			autoFitRef.current = false;
			void flow.setViewport(
				boardViewport(flow.getNodesBounds([frame]), size),
				{ duration: motionDuration("normal") },
			);
		},
		[canvasSize, flow],
	);

	useEffect(() => {
		if (!fittedRef.current || !autoFitRef.current || focusSection) return;
		fit(motionDuration("normal"));
	}, [fit, focusSection, insetLeft, insetRight]);

	const hasNodes = nodes.length > 0;
	useEffect(() => {
		if (!focusSection || !hasNodes) return;
		const handle = requestAnimationFrame(() => {
			focusFrame(focusSection);
		});
		return () => cancelAnimationFrame(handle);
		// 只在审批门换分区时平移一次，不跟着节点数据变化反复跳
	}, [focusFrame, focusSection, hasNodes]);

	const applySelection = useCallback(
		(ids: string[]) => {
			selectedRef.current = ids;
			setNodes((current) =>
				current.map((n) =>
					Boolean(n.selected) === ids.includes(n.id)
						? n
						: { ...n, selected: ids.includes(n.id) },
				),
			);
		},
		[setNodes],
	);

	useEffect(() => {
		const off = [
			canvasEvents.on("select-workflow-node", ({ nodeId }) =>
				applySelection(nodeId ? [nodeId] : []),
			),
			canvasEvents.on("set-workflow-selection", ({ nodeIds }) =>
				applySelection(nodeIds),
			),
			canvasEvents.on("focus-workflow-node", ({ nodeId }) => {
				if (!flow.getNode(nodeId)) return;
				applySelection([nodeId]);
				autoFitRef.current = false;
				void flow.fitView({ nodes: [{ id: nodeId }], maxZoom: 1, duration: motionDuration("normal") });
			}),
		];
		return () => off.forEach((unsubscribe) => unsubscribe());
	}, [applySelection, flow]);

	const handleSelectionChange = useCallback(
		({ nodes: selected }: OnSelectionChangeParams) => {
			const ids = selected.filter((n) => n.type === "card").map((n) => n.id);
			selectedRef.current = ids;
			onSelectedNodeIdsChange?.(ids);
			onSelectedNodeIdChange?.(ids[0] ?? null);
		},
		[onSelectedNodeIdChange, onSelectedNodeIdsChange],
	);

	const [menu, setMenu] = useState<CardMenuState | null>(null);
	const closeMenu = useCallback(() => setMenu(null), []);
	const handleNodeContextMenu = useCallback(
		(event: React.MouseEvent, node: WorkflowFlowNode) => {
			if (node.type !== "card" || sortMode) return;
			event.preventDefault();
			const box = containerRef.current?.getBoundingClientRect();
			if (!box) return;
			applySelection([node.id]);
			onSelectedNodeIdsChange?.([node.id]);
			onSelectedNodeIdChange?.(node.id);
			setMenu({
				node: node.data.node,
				...menuPosition({ x: event.clientX, y: event.clientY }, box),
			});
		},
		[applySelection, onSelectedNodeIdChange, onSelectedNodeIdsChange, sortMode],
	);

	const SORT_HINT = "排序模式：拖动分镜，或选中一格后按 Alt + 方向键移动。";
	const [announcement, setAnnouncement] = useState("");
	useEffect(() => {
		setAnnouncement(sortMode ? SORT_HINT : "");
	}, [sortMode]);

	const graphRef = useRef(graph);
	graphRef.current = graph;

	const submitOrder = useCallback(
		// 拖动：提示后退出排序模式；键盘：留在排序模式里继续移动，结果由 aria-live 播报
		(items: { shot_id: number; order: number }[], message: string, fromKeyboard = false) => {
			const previous = previousShotOrder(graphRef.current);
			const refresh = () =>
				queryClient.invalidateQueries({ queryKey: projectQueryKeys.shots(projectId) });
			return projectsApi
				.reorderShots(projectId, items)
				.then(() => {
					void refresh();
					if (fromKeyboard) return;
					// 单步撤销：把重排前的顺序原样写回
					toast.success({
						title: "九宫格已重排",
						message,
						duration: 6000,
						actions: [
							{
								label: "撤销",
								onClick: () =>
									void projectsApi
										.reorderShots(projectId, previous)
										.then(() => {
											void refresh();
											toast.info({ title: "已撤销", message: "恢复了重排前的顺序" });
										})
										.catch((error: Error) =>
											toast.error({ title: "撤销失败", message: error.message || "请重试" }),
										),
							},
						],
					});
					onSorted();
				})
				.catch((error: Error) => {
					toast.error({ title: "重排失败", message: error.message || "请重试" });
				});
		},
		[onSorted, projectId, queryClient],
	);

	// 键盘排序：Alt + ←/→ 移一格，Alt + ↑/↓ 移一行；结果经 aria-live 播报
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (interactionMode !== "sort" || !event.altKey) return;
			const delta = {
				ArrowLeft: -1,
				ArrowRight: 1,
				ArrowUp: -SHOT_GRID_COLUMNS,
				ArrowDown: SHOT_GRID_COLUMNS,
			}[event.key];
			if (!delta) return;
			const focused = (event.target as HTMLElement)
				.closest(".react-flow__node")
				?.getAttribute("data-id");
			const nodeId = focused ?? selectedRef.current[0];
			if (!nodeId?.startsWith("shot:")) return;
			event.preventDefault();
			event.stopPropagation();
			const move = moveShot(flow.getNodes(), nodeId, delta);
			if (!move) {
				setAnnouncement("已经到头了，无法再移动。");
				return;
			}
			const message = `${move.title} 移到第 ${move.position} 格`;
			setAnnouncement(message);
			void submitOrder(move.items, message, true);
		},
		[flow, interactionMode, submitOrder],
	);

	const handleDragStop = useCallback(() => {
		const current = flow.getNodes();
		if (interactionMode === "layout") {
			const next: Positions = {};
			for (const n of current) if (n.type === "frame") next[n.id] = n.position;
			localStorage.setItem(storageKey, JSON.stringify(next));
			setFramePositions(next);
			return;
		}
		if (interactionMode !== "sort") return;
		const items = shotReadingOrder(current);
		if (items) void submitOrder(items, `已按阅读顺序更新 ${items.length} 格`);
	}, [flow, interactionMode, storageKey, submitOrder]);

	const handleResetLayout = useCallback(() => {
		localStorage.removeItem(storageKey);
		setFramePositions({});
		setTimeout(() => fit(motionDuration("normal")), 80);
	}, [fit, storageKey]);

	const animation = { duration: motionDuration("fast") };
	const manual = () => {
		autoFitRef.current = false;
	};
	const controls: CanvasViewControls = {
		tool,
		setTool,
		zoomPercent: Math.round(zoom * 100),
		zoomIn: () => {
			manual();
			void flow.zoomIn(animation);
		},
		zoomOut: () => {
			manual();
			void flow.zoomOut(animation);
		},
		zoomReset: () => {
			manual();
			void flow.zoomTo(1, animation);
		},
		fit: () => fit(motionDuration("normal"), true),
	};

	return (
		<div
			ref={containerRef}
			className="infinite-canvas-container relative h-full w-full"
			// 侧栏浮在画布上：节点层在侧栏覆盖的区域淡出，不在面板下面压着、也不在面板边上露半截
			style={
				{
					"--canvas-cover-left": `${insetLeft}px`,
					"--canvas-cover-right": `${insetRight}px`,
				} as CSSProperties
			}
			onKeyDownCapture={handleKeyDown}
		>
			<ReactFlow<WorkflowFlowNode>
				nodes={nodes}
				edges={[]}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onSelectionChange={handleSelectionChange}
				onNodeDragStop={handleDragStop}
				onNodeContextMenu={handleNodeContextMenu}
				onMoveStart={(event) => {
					// event 为 null 表示程序触发（适配、动画），只有用户手势才算手动
					if (event) manual();
				}}
				// 右键按下也会触发 moveStart（右键可拖动平移），所以只在视口真的动了才收起菜单
				onMove={(event) => {
					if (event) closeMenu();
				}}
				colorMode={theme === "dark" ? "dark" : "light"}
				minZoom={MIN_ZOOM}
				maxZoom={2}
				// 只渲染视口内的节点：大项目（上百个镜头）平移/缩放时不再整板重绘
				onlyRenderVisibleElements
				panOnScroll
				panOnDrag={tool === "hand" ? true : [1, 2]}
				selectionOnDrag={tool === "select"}
				deleteKeyCode={null}
				multiSelectionKeyCode={["Shift", "Meta", "Control"]}
				aria-label="漫画工作流画布"
				// 右上角是检查器 / 收起后的「项目」按钮，底边中间是提示栏和工具条：署名放右下角空位
				attributionPosition="bottom-right"
			>
				<Background gap={24} size={1} />
			</ReactFlow>
			{!announcement && hasNodes ? (
				<nav
					aria-label="画布分区导航"
					className="pointer-events-auto absolute left-1/2 top-3 z-panel flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface/95 p-1 shadow-panel backdrop-blur-md"
				>
					{CANVAS_SECTIONS.map(({ section, num, label }) => {
						const active = focusSection === section;
						return (
							<PlainButton
								key={section}
								aria-label={`定位到${label}分区`}
								aria-current={active ? "true" : undefined}
								onClick={() => focusFrame(section)}
								className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-fast ${
									active
										? "bg-primary text-primary-content"
										: "text-ink-muted hover:bg-paper-200 hover:text-ink"
								}`}
							>
								<span className="font-mono text-xs">{num}</span>
								<span>{label}</span>
							</PlainButton>
						);
					})}
					<span className="mx-0.5 h-3.5 w-px bg-line" aria-hidden="true" />
					<PlainButton
						aria-label="打开命令面板"
						title="搜索分镜、角色或项目 (⌘/Ctrl+K)"
						onClick={() => canvasEvents.emit("open-command-palette", {})}
						className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-xs text-ink-muted transition-colors duration-fast hover:bg-paper-200 hover:text-ink"
					>
						<SvgIcon name="search" size={12} />
						<span>⌘K</span>
					</PlainButton>
				</nav>
			) : null}
			<p
				aria-live="polite"
				className={
					announcement
						? "absolute left-1/2 top-3 z-panel m-0 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink shadow-panel"
						: "sr-only"
				}
			>
				{announcement}
			</p>
			{menu ? (
				<CardContextMenu
					menu={menu}
					projectId={projectId}
					structureLocked={structureLocked}
					onClose={closeMenu}
				/>
			) : null}
			<ComicCanvasToolbar
				projectId={projectId}
				onResetLayout={handleResetLayout}
				sortMode={sortMode}
				sortDisabled={structureLocked}
				onToggleSortMode={onToggleSortMode}
				fillDisabled={structureLocked}
				onOpenAssets={onOpenAssets}
				controls={controls}
			/>
		</div>
	);
}

/** 重排前的分镜顺序，供「撤销」写回。 */
export function previousShotOrder(
	graph: ComicWorkflowGraph,
): { shot_id: number; order: number }[] {
	return graph.nodes.flatMap((node) =>
		node.kind === "shot" ? [{ shot_id: node.shot.id, order: node.shot.order }] : [],
	);
}
