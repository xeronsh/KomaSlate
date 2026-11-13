import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { TopBar } from "~/components/layout/TopBar";
import { StudioControls } from "~/components/layout/StudioControls";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { Card } from "~/components/ui/Card";
import { PlainButton } from "~/components/ui/PlainButton";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { buildComicWorkflow } from "~/features/comic-workflow/graph/buildComicWorkflow";
import { AgentPanel } from "~/features/comic-workflow/agent/AgentPanel";
import { InboxPanel, type InboxActions } from "~/features/comic-workflow/agent/InboxPanel";
import { AssistantChat } from "~/components/chat/AssistantChat";
import { ChatPanel } from "~/components/chat/ChatPanel";
import { deriveInboxItems } from "~/features/comic-workflow/agent/inboxItems";
import { InspectorPanel } from "~/features/comic-workflow/inspector/InspectorPanel";
import { PromptBar, type PromptChip } from "~/features/workbench/PromptBar";
import type { HybridGraphNode } from "~/features/workbench/nodegraph/bezierWires";
import type {
	CliToolSummary,
	OutboundMcpSummary,
} from "~/features/workbench/nodegraph/buildHybridTopology";
import { appendProtocolLog } from "~/features/workbench/protocol/protocolLogStore";
import { stepForStage } from "~/utils/workflowSteps";
import {
	deriveStudioStatus,
	studioStatusText,
} from "~/features/comic-workflow/state/deriveStudioStatus";
import { RunTimingBar } from "~/features/comic-workflow/agent/RunTimingBar";
import { subscribeTitleBadge, titleBadge, withTitleBadge } from "~/utils/runNotifications";
import { useIsMobileWorkbench } from "~/features/comic-workflow/mobile/useIsMobileWorkbench";
import { usePreloadedComponent } from "~/utils/preloadComponent";
import {
	keyboardLayerChunk,
	loadViewportWorkbenchChunks,
	mobilePreviewChunk,
	prefetchOtherWorkbenchChunk,
} from "~/features/workbench/workbenchChunks";
import { useRunController } from "~/features/run/useRunController";
import { RegenerateDialog } from "~/features/run/RegenerateDialog";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import { projectQueryKeys } from "~/query/queryKeys";
import { useProjectData } from "~/features/projects/useProjectData";
import {
	chatApi,
	exportApi,
	getStaticUrl,
	mcpApi,
	projectsApi,
} from "~/services/api";
import { useRunStateSelect } from "~/hooks/useRunState";
import { useEditorStore } from "~/stores/editorStore";
import { readRunState as readRunStateSnapshot, type RunState } from "~/query/runState";
import { AGENT_NAME_MAP, type VersionEntityType } from "~/types";
import { ApiError } from "~/types/errors";
import { toast } from "~/utils/toast";
import { SvgIcon } from "~/components/ui/SvgIcon";
import "~/components/ui/icons/workbenchIcons";

void loadViewportWorkbenchChunks().catch(() => {});
prefetchOtherWorkbenchChunk();

const WorkflowCanvas = lazy(() =>
	import("~/features/comic-workflow/canvas/ComicWorkflowCanvas").then((m) => ({
		default: m.ComicWorkflowCanvas,
	})),
);
const NodeGraphCanvas = lazy(() =>
	import("~/features/workbench/nodegraph/NodeGraphCanvas").then((m) => ({
		default: m.NodeGraphCanvas,
	})),
);
const AssetDrawer = lazy(() =>
	import("~/components/panels/AssetDrawer").then((m) => ({ default: m.AssetDrawer })),
);
const VersionCompareDrawer = lazy(() =>
	import("~/components/panels/VersionCompareDrawer").then((m) => ({
		default: m.VersionCompareDrawer,
	})),
);
const ProtocolHubDialog = lazy(() =>
	import("~/features/workbench/protocol/ProtocolHubDialog").then((m) => ({
		default: m.ProtocolHubDialog,
	})),
);

const DEFAULT_CLI_TOOLS: CliToolSummary[] = [
	{
		name: "komaslate",
		version: "v0.9",
		description: "项目控制面 CLI：run / inspect / gate / mcp serve",
		sampleCommand: "komaslate inspect 1 --shots --events",
	},
	{
		name: "dreamina",
		version: "v0.4",
		description: "即梦图生视频与首尾帧任务队列 CLI",
		sampleCommand: "dreamina i2v --shot S01 --duration 4s",
	},
	{
		name: "ffmpeg",
		version: "7.x",
		description: "Animatic 音画混流、字幕压制与成片拼接",
		sampleCommand: "ffmpeg -f concat -i shots.txt -c:v libx264 cut.mp4",
	},
	{
		name: "komaslate-media",
		version: "bridge",
		description: "本地 InsightFace / 九宫格拼接 / TTS helper",
		sampleCommand: "komaslate media nine-grid --help",
	},
];

const DEFAULT_MCP_SERVERS: OutboundMcpSummary[] = [
	{
		id: "filesystem",
		name: "filesystem-assets-mcp",
		transport: "stdio · npx @modelcontextprotocol/server-filesystem",
		enabled: true,
		status: "online",
		latencyMs: 9,
		policy: "auto_readonly",
	},
	{
		id: "comfyui-inpaint",
		name: "comfyui-inpaint-mcp",
		transport: "http · http://127.0.0.1:8188/mcp",
		enabled: false,
		status: "offline",
		latencyMs: null,
		policy: "confirm_writes",
	},
];

/** Only the fields the shell renders: streamed text (liveStream) stays out; progress snaps to 1% steps. */
function selectWorkbenchRun(state: RunState) {
	return {
		isGenerating: state.isGenerating,
		currentRunId: state.currentRunId,
		currentStage: state.currentStage,
		progress: Math.round(state.progress * 100) / 100,
		awaitingConfirm: state.awaitingConfirm,
		recoveryControl: state.recoveryControl,
		currentStep: state.currentStep,
		recoveryGate: state.recoveryGate,
		awaitingAgent: state.awaitingAgent,
		feedbackReceipt: state.feedbackReceipt,
	};
}

export function ProjectWorkbench({ projectId }: { projectId: number }) {
	const queryClient = useQueryClient();
	const runState = useRunStateSelect(projectId, selectWorkbenchRun, { owner: true });
	const {
		isGenerating: runIsGenerating,
		currentRunId: runCurrentRunId,
		currentStage: runCurrentStage,
		progress: runProgress,
		awaitingConfirm: runAwaitingConfirm,
		recoveryControl: runRecoveryControl,
	} = runState;

	const runModePreference = useEditorStore((s) => s.runMode);
	const agentCollapsed = useEditorStore((s) => s.agentCollapsed);
	const setAgentCollapsed = useEditorStore((s) => s.setAgentCollapsed);
	const inspectorOpen = useEditorStore((s) => s.inspectorOpen);
	const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);
	const agentTab = useEditorStore((s) => s.agentTab);
	const setAgentTab = useEditorStore((s) => s.setAgentTab);
	const workbenchView = useEditorStore((s) => s.workbenchView);
	const setWorkbenchView = useEditorStore((s) => s.setWorkbenchView);
	const activeGraphNodeId = useEditorStore((s) => s.activeGraphNodeId);
	const setActiveGraphNodeId = useEditorStore((s) => s.setActiveGraphNodeId);
	const hubDialogOpen = useEditorStore((s) => s.hubDialogOpen);
	const setHubDialogOpen = useEditorStore((s) => s.setHubDialogOpen);
	const setHubTab = useEditorStore((s) => s.setHubTab);
	const syncViewportWidth = useEditorStore((s) => s.syncViewportWidth);
	const selectedShotId = useEditorStore((s) => s.selectedShotId);

	const hasActiveRun = runIsGenerating || Boolean(runCurrentRunId);
	const hasRecovery = Boolean(runRecoveryControl);

	// AUD-UI-15: 统一由 editorStore + ResizeObserver 动态同步断点与折叠状态
	const shellContainerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const initial = typeof window !== "undefined" ? window.innerWidth : 1440;
		syncViewportWidth(initial, { initial: true });

		if (typeof ResizeObserver === "undefined") {
			const onResize = () => syncViewportWidth(window.innerWidth);
			window.addEventListener("resize", onResize);
			return () => window.removeEventListener("resize", onResize);
		}
		const target = shellContainerRef.current;
		if (!target) return;
		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect?.width;
			if (width && width > 0) syncViewportWidth(width);
			else if (typeof window !== "undefined") syncViewportWidth(window.innerWidth);
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [syncViewportWidth]);

	const [assetsOpen, setAssetsOpen] = useState(false);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
	const [versionOpen, setVersionOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [versionTarget, setVersionTarget] = useState<{
		entityType: VersionEntityType;
		entityId: number;
	} | null>(null);

	const [localMcpOverrides, setLocalMcpOverrides] = useState<
		Record<string, Partial<OutboundMcpSummary>>
	>({});

	useEffect(() => {
		return canvasEvents.on("version-history", (target) => {
			setVersionTarget(
				target.entityType && target.entityId != null
					? { entityType: target.entityType, entityId: target.entityId }
					: null,
			);
			setVersionOpen(true);
		});
	}, []);

	const { project, characters, shots, projectLoading, projectError } = useProjectData(projectId);
	useEffect(() => {
		setSelectedNodeId(null);
		setSelectedNodeIds([]);
		const editor = useEditorStore.getState();
		editor.setSelectedShot(null);
		editor.setSelectedCharacter(null);
		editor.setHighlightedMessage(null);
	}, [projectId]);

	const { data: chatState } = useQuery({
		queryKey: projectQueryKeys.chat(projectId),
		queryFn: () => chatApi.get(projectId),
		enabled: projectId > 0,
	});

	const { data: mcpServersResp } = useQuery({
		queryKey: ["mcp", "servers"],
		queryFn: () => mcpApi.listServers().catch(() => ({ servers: [] })),
		enabled: projectId > 0,
		staleTime: 30_000,
	});

	const { data: cliToolsResp } = useQuery({
		queryKey: ["cli", "tools"],
		queryFn: () => mcpApi.listCliTools().catch(() => ({ tools: [] })),
		enabled: projectId > 0,
		staleTime: 60_000,
	});

	const mcpServers = useMemo<OutboundMcpSummary[]>(() => {
		const base =
			mcpServersResp?.servers && mcpServersResp.servers.length > 0
				? mcpServersResp.servers.map((s) => ({
						id: s.id,
						name: s.name,
						transport: s.transport,
						enabled: s.enabled,
						status: s.status,
						latencyMs: s.latency_ms ?? null,
						policy: s.policy,
						toolsCount: s.tools_count,
					}))
				: DEFAULT_MCP_SERVERS;
		return base.map((item) => ({
			...item,
			...(localMcpOverrides[item.id] ?? {}),
		}));
	}, [localMcpOverrides, mcpServersResp]);

	const cliTools = useMemo<CliToolSummary[]>(() => {
		if (cliToolsResp?.tools && cliToolsResp.tools.length > 0) {
			return cliToolsResp.tools.map((t) => ({
				name: t.name,
				version: t.version,
				description: t.description,
				sampleCommand: t.sample_command,
				available: t.available,
			}));
		}
		return DEFAULT_CLI_TOOLS;
	}, [cliToolsResp]);

	// 已有产物时「重新生成」先确认；空项目的「开始生成」直接开始
	const hasContent = Boolean(project?.video_url || characters.length > 0 || shots.length > 0);
	const [regenerateOpen, setRegenerateOpen] = useState(false);
	const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
	const { data: regeneratePlan } = useQuery({
		queryKey: projectQueryKeys.regeneratePlan(projectId),
		queryFn: () => projectsApi.getRegeneratePlan(projectId),
		enabled: projectId > 0 && Boolean(project) && hasContent,
	});
	const previousVersion = regeneratePlan?.previous_version ?? null;

	const {
		handleGenerate,
		handleChat,
		handleConfirm,
		handleCancel,
		handleResume,
		generatePending,
		gateDecisionPending,
		lastRunStatus,
		handleRestorePrevious,
		restorePending,
	} = useRunController({
		projectId,
		project,
		characters,
		shots,
		currentRunId: runCurrentRunId,
		isGenerating: runIsGenerating,
		recoveryControl: runRecoveryControl,
		selectedNodeId,
		selectedNodeIds,
		onRequestRegenerate: hasContent ? () => setRegenerateOpen(true) : undefined,
	});

	const regeneratingFromPrevious =
		previousVersion !== null && hasActiveRun && previousVersion.run_id === runCurrentRunId;
	const previousDownloadUrl =
		regeneratingFromPrevious && previousVersion?.video_url ? getStaticUrl(previousVersion.video_url) : null;
	const canRestorePrevious = Boolean(previousVersion?.restorable) && !hasActiveRun && !hasRecovery;

	useEffect(() => {
		if (!runIsGenerating) {
			const progress = readRunStateSnapshot(projectId).progress;
			if (progress === 1) {
				queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
				queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
			}
		}
	}, [runIsGenerating, projectId, queryClient]);

	const workflowNodes = useMemo(
		() =>
			project
				? buildComicWorkflow({
						project,
						characters,
						shots,
						blockingClips: project.blocking_clips,
						isGenerating: runIsGenerating,
						awaitingConfirm: runAwaitingConfirm,
						currentStep: runState.currentStep,
						target: runState.recoveryControl?.active_run,
					}).nodes
				: [],
		[project, characters, shots, runIsGenerating, runAwaitingConfirm, runState.currentStep, runState.recoveryControl],
	);
	const selectedWorkflowNode = workflowNodes.find((node) => node.id === selectedNodeId) ?? null;
	const briefNode = workflowNodes.find((node) => node.kind === "brief") ?? null;

	const selectionChips = useMemo<PromptChip[]>(
		() =>
			selectedNodeIds.flatMap((id) => {
				const node = workflowNodes.find((n) => n.id === id);
				if (!node) return [];
				const label =
					node.kind === "shot"
						? `分镜 S${String(node.shot.order).padStart(2, "0")}`
						: node.kind === "character"
							? `角色 ${node.title}`
							: node.kind === "output"
								? "成片"
								: "项目";
				return [{ id, label }];
			}),
		[workflowNodes, selectedNodeIds],
	);

	const gateLabel = runAwaitingConfirm
		? (stepForStage(runState.recoveryGate?.current_stage ?? runState.recoveryGate?.stage ?? runState.currentStep)?.label ??
			AGENT_NAME_MAP[runState.awaitingAgent ?? ""] ??
			"当前阶段")
		: null;

	const removeSelection = useCallback(
		(id: string) => {
			canvasEvents.emit("set-workflow-selection", {
				nodeIds: selectedNodeIds.filter((nodeId) => nodeId !== id),
			});
		},
		[selectedNodeIds],
	);

	const selectionKey = selectedNodeIds.length > 0 ? selectedNodeIds.join(",") : (selectedNodeId ?? "");
	useEffect(() => {
		if (selectionKey) setInspectorOpen(true);
	}, [selectionKey, setInspectorOpen]);

	const handleSelectedNodeIdChange = useCallback((nodeId: string | null) => {
		setSelectedNodeId(nodeId);
		if (nodeId?.startsWith("shot:")) {
			const shotId = Number(nodeId.split(":")[1]);
			if (Number.isFinite(shotId)) useEditorStore.getState().setSelectedShot(shotId);
		}
	}, []);

	const handleSelectedNodeIdsChange = useCallback((nodeIds: string[]) => {
		setSelectedNodeIds(nodeIds);
		const first = nodeIds[0] ?? null;
		setSelectedNodeId(first);
		if (first?.startsWith("shot:")) {
			const shotId = Number(first.split(":")[1]);
			if (Number.isFinite(shotId)) useEditorStore.getState().setSelectedShot(shotId);
		}
	}, []);

	const workspaceLoading = projectLoading;
	const isMobileWorkbench = useIsMobileWorkbench();
	const MobileWorkbenchPreview = usePreloadedComponent(mobilePreviewChunk, isMobileWorkbench);
	const KeyboardLayer = usePreloadedComponent(keyboardLayerChunk, !isMobileWorkbench);

	const inboxItems = useMemo(
		() =>
			deriveInboxItems({
				awaitingConfirm: runAwaitingConfirm,
				awaitingAgent: runState.awaitingAgent,
				recoveryGate: runState.recoveryGate,
				recoveryControl: runRecoveryControl,
				isGenerating: hasActiveRun,
				projectStatus: project?.status,
				blockingClips: project?.blocking_clips,
				feedbackReceipt: runState.feedbackReceipt,
				characters,
				shots,
			}),
		[
			characters,
			shots,
			runState.feedbackReceipt,
			runAwaitingConfirm,
			runState.awaitingAgent,
			runState.recoveryGate,
			runRecoveryControl,
			hasActiveRun,
			project?.status,
			project?.blocking_clips,
		],
	);

	const seenInboxIds = useRef<Set<string>>(new Set());
	useEffect(() => {
		const fresh = inboxItems.filter(
			(item) =>
				!seenInboxIds.current.has(item.id) &&
				!(item.kind === "gate" && runModePreference === "yolo"),
		);
		const hadItems = seenInboxIds.current.size > 0;
		seenInboxIds.current = new Set(inboxItems.map((item) => item.id));
		if (fresh.length > 0) {
			setAgentTab("inbox");
			setAgentCollapsed(false);
		} else if (hadItems && inboxItems.length === 0) {
			setAgentTab("activity");
		}
	}, [inboxItems, runModePreference, setAgentCollapsed, setAgentTab]);

	const sendToAssistant = (content: string) => {
		if (workbenchView === "storyboard") {
			setAgentTab("chat");
			setAgentCollapsed(false);
		}
		return handleChat(content);
	};

	const openInbox = useCallback(() => {
		setAgentTab("inbox");
		setAgentCollapsed(false);
		setWorkbenchView("storyboard");
	}, [setAgentCollapsed, setAgentTab, setWorkbenchView]);

	const inboxActions: InboxActions = {
		onConfirm: handleConfirm,
		onRequestChanges: () => {
			document.querySelector<HTMLTextAreaElement>('[data-shell="prompt-bar"] textarea')?.focus();
		},
		onResume: handleResume,
		onCancel: handleCancel,
		onRetry: hasContent ? () => setRegenerateOpen(true) : handleGenerate,
		onSelectShot: (shotId) => {
			setWorkbenchView("storyboard");
			canvasEvents.emit("select-workflow-node", { nodeId: `shot:${shotId}` });
		},
		onFocusNode: (nodeId) => {
			setWorkbenchView("storyboard");
			canvasEvents.emit("focus-workflow-node", { nodeId });
		},
		retryDisabled: generatePending,
		gatePending: gateDecisionPending,
	};

	const derivedStudioStatus = useMemo(
		() =>
			deriveStudioStatus({
				isGenerating: runIsGenerating,
				currentRunId: runCurrentRunId,
				awaitingConfirm: runAwaitingConfirm,
				recoveryControl: runRecoveryControl,
				projectStatus: project?.status,
				projectVideoUrl: project?.video_url,
				blockingClips: project?.blocking_clips,
				lastRunStatus,
				currentStage: runCurrentStage,
				currentStep: runState.currentStep,
				progress: runProgress,
			}),
		[
			runIsGenerating,
			runCurrentRunId,
			runAwaitingConfirm,
			runRecoveryControl,
			project?.status,
			project?.video_url,
			project?.blocking_clips,
			lastRunStatus,
			runCurrentStage,
			runState.currentStep,
			runProgress,
		],
	);

	const studioStatus = useMemo(
		() => ({ ...derivedStudioStatus, pendingCount: inboxItems.length }),
		[derivedStudioStatus, inboxItems.length],
	);

	const projectTitle = project?.title;
	const badge = useSyncExternalStore(subscribeTitleBadge, titleBadge, titleBadge);
	useEffect(() => {
		if (projectTitle === undefined) return;
		const previous = document.title;
		document.title = withTitleBadge(
			`${studioStatusText(studioStatus)} · ${projectTitle || "分镜工作台"} - KomaSlate`,
			badge,
		);
		return () => {
			document.title = previous;
		};
	}, [studioStatus, projectTitle, badge]);

	const handleOpenVersions = () => {
		setVersionTarget(null);
		setVersionOpen(true);
	};

	const handlePingMcp = useCallback(async (serverId?: string) => {
		const target = serverId
			? mcpServers.find((s) => s.id === serverId)
			: mcpServers.find((s) => s.enabled) ?? mcpServers[0];
		if (!target) {
			toast.info({ title: "无已配置 MCP Server", message: "可在协议枢纽中新增或启用" });
			return;
		}
		try {
			const res = await mcpApi.pingServer(target.id);
			setLocalMcpOverrides((prev) => ({
				...prev,
				[target.id]: {
					enabled: true,
					status: res.ok ? "online" : "error",
					latencyMs: res.latency_ms ?? 28,
				},
			}));
			appendProtocolLog(projectId, {
				channel: res.ok ? "RPC" : "ERROR",
				direction: "OUT",
				source: target.name,
				summary: res.ok ? `tools/list -> 200 OK` : res.error || "Ping 失败",
				latencyMs: res.latency_ms ?? null,
				payload: res,
			});
			if (res.ok) {
				toast.success({
					title: `${target.name} 在线`,
					message: res.latency_ms != null ? `延迟 ${res.latency_ms}ms` : "连接正常",
				});
			} else {
				toast.error({ title: `${target.name} 不可达`, message: res.error || "请检查服务状态" });
			}
		} catch {
			appendProtocolLog(projectId, {
				channel: "RPC",
				direction: "OUT",
				source: target.name,
				summary: `tools/list -> offline check`,
				payload: { server: target.name, note: "后端未挂载或服务未启动" },
			});
			toast.info({ title: `${target.name} 未响应`, message: "已记录至协议终端" });
		}
	}, [mcpServers, projectId]);

	const handleDryRunCli = useCallback(
		async (toolName: string, sampleCommand: string) => {
			try {
				const res = await mcpApi.dryRunCli(toolName, sampleCommand);
				appendProtocolLog(projectId, {
					channel: res.exit_code === 0 ? "STDIO" : "ERROR",
					direction: "IN",
					source: toolName,
					summary: res.stdout || `exit=${res.exit_code}`,
					latencyMs: res.duration_ms ?? null,
					payload: res,
				});
				toast.success({ title: `${toolName} 试跑完成`, message: `exit=${res.exit_code}` });
			} catch (err) {
				appendProtocolLog(projectId, {
					channel: "ERROR",
					direction: "IN",
					source: toolName,
					summary: err instanceof Error ? err.message : "试跑失败",
					payload: { command: sampleCommand },
				});
				toast.error({
					title: `${toolName} 试跑失败`,
					message: err instanceof Error ? err.message : "请检查 CLI 配置",
				});
			}
		},
		[projectId],
	);

	const handleSelectGraphNode = useCallback(
		(node: HybridGraphNode) => {
			setActiveGraphNodeId(node.id);
			appendProtocolLog(projectId, {
				channel: "RPC",
				direction: "SYS",
				source: "Graph",
				summary: `聚焦节点 ${node.id} (${node.badge})`,
				payload: node,
			});
		},
		[projectId, setActiveGraphNodeId],
	);

	const handleTriggerGraphAction = useCallback(
		(node: HybridGraphNode) => {
			if (node.kind === "wf_gate") {
				setAgentTab("inbox");
				setAgentCollapsed(false);
				setWorkbenchView("storyboard");
				return;
			}
			if (node.kind === "mcp_out") {
				void handlePingMcp(node.targetRef?.id);
				return;
			}
			if (node.kind === "mcp_inbound") {
				setHubTab("inbound");
				setHubDialogOpen(true);
				return;
			}
			if (node.kind === "cli_runner") {
				setHubTab("cli");
				setHubDialogOpen(true);
				return;
			}
			if (node.kind === "wf_stage") {
				setWorkbenchView("storyboard");
			}
		},
		[handlePingMcp, setAgentCollapsed, setAgentTab, setHubDialogOpen, setHubTab, setWorkbenchView],
	);

	const runExport = async (
		trigger: () => Promise<{ export_id: string }>,
		labels: { pending: string; done: string },
	) => {
		if (exporting) return;
		setExporting(true);
		let pending: string | null = null;
		const clearPending = () => {
			if (pending) toast.dismiss(pending);
			pending = null;
		};
		try {
			const started = await trigger();
			const poll = async (exportId: string): Promise<void> => {
				const response = await exportApi.getStatus(projectId, exportId);
				if (response.status === "processing") {
					await new Promise((r) => setTimeout(r, 2000));
					return poll(exportId);
				}
				if (response.status === "completed") {
					const url = getStaticUrl(response.download_url);
					clearPending();
					toast.success({
						title: "导出完成",
						message: labels.done,
						duration: 8000,
						actions: url
							? [{ label: "下载", onClick: () => window.open(url, "_blank"), variant: "primary" }]
							: undefined,
					});
					return;
				}
				clearPending();
				toast.error({ title: "导出失败", message: "生成失败，请重试" });
			};
			pending = toast.info({ title: "导出中", message: labels.pending, duration: 0 });
			await poll(started.export_id);
		} catch (error) {
			clearPending();
			toast.error({
				title: "导出失败",
				message: error instanceof Error ? error.message : "未知错误",
			});
		} finally {
			clearPending();
			setExporting(false);
		}
	};

	const handleExportWebtoon = () =>
		runExport(() => exportApi.triggerWebtoon(projectId), {
			pending: "正在生成 Webtoon 长图",
			done: "Webtoon 长图已生成",
		});

	const handleExportEditorial = () =>
		runExport(() => exportApi.triggerEditorialPack(projectId), {
			pending: "正在打包分镜素材、SRT 字幕与 FCPXML 时间线",
			done: "剪辑素材包已生成（含 FCPXML / SRT）",
		});

	if (workspaceLoading) {
		return (
			<div className="page-shell items-center justify-center gap-3 bg-paper-100">
				<SvgIcon name="refresh-cw" size={20} className="animate-pulse text-ink-muted" />
				<p className="text-sm text-ink-muted">正在加载项目…</p>
			</div>
		);
	}

	const projectApiError = projectError instanceof ApiError ? projectError : null;
	const projectNotFound = projectApiError?.status === 404;

	if (projectError && !projectNotFound && !project) {
		return (
			<div className="page-shell items-center justify-center bg-paper-100">
				<Card className="max-w-sm text-center">
					<h1 className="mb-2 text-xl font-bold text-pretty">无法加载项目</h1>
					<p className="mb-4 text-sm text-ink-muted">
						{projectApiError?.message || "项目数据获取失败，请检查网络后重试"}
					</p>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							variant="primary"
							onClick={() =>
								queryClient.invalidateQueries({
									queryKey: ["project", projectId],
								})
							}
						>
							<SvgIcon name="refresh-cw" size={16} />
							重试
						</Button>
						<ButtonLink to="/" variant="ghost">返回首页</ButtonLink>
					</div>
				</Card>
			</div>
		);
	}

	if (!project) {
		return (
			<div className="page-shell items-center justify-center bg-paper-100">
				<Card className="text-center">
					<h1 className="mb-4 text-xl font-bold text-pretty">项目未找到</h1>
					<ButtonLink to="/" variant="primary">返回首页</ButtonLink>
				</Card>
			</div>
		);
	}

	return (
		<div
			ref={shellContainerRef}
			className="page-shell bg-paper-100 font-sans"
			data-shell="director-desk"
		>
			<h1 className="sr-only">{project.title || "漫剧工作台"}</h1>
			<a
				href="#workbench-main"
				className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-toast rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-content"
			>
				跳到工作台
			</a>
			<a
				href="#chat-message-input"
				onClick={(event) => {
					const input = document.getElementById("chat-message-input");
					if (!input) return;
					event.preventDefault();
					input.focus();
				}}
				className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-toast rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-content"
			>
				跳到输入栏
			</a>
			{!isMobileWorkbench && KeyboardLayer ? (
				<KeyboardLayer projectId={projectId} shots={shots} characters={characters} />
			) : null}

			<TopBar
				projectId={projectId}
				center={
					<StudioControls
						isGenerating={hasActiveRun}
						studioStatus={studioStatus}
						awaitingConfirm={runAwaitingConfirm}
						hasRecovery={hasRecovery}
						onGenerate={hasContent ? () => setRegenerateOpen(true) : handleGenerate}
						onCancel={handleCancel}
						onOpenInbox={openInbox}
						generateDisabled={generatePending || hasActiveRun}
						generatePending={generatePending}
						onRegenerate={hasContent ? () => setRegenerateOpen(true) : undefined}
						onRestorePrevious={canRestorePrevious ? () => setRestoreConfirmOpen(true) : undefined}
						restoreBusy={restorePending}
						previousDownloadUrl={previousDownloadUrl}
						onOpenVersions={handleOpenVersions}
						onExport={handleExportWebtoon}
						onExportEditorial={handleExportEditorial}
						exportBusy={exporting}
						downloadUrl={
							project?.video_url ? getStaticUrl(`/api/v1/projects/${projectId}/final-video`) : null
						}
					/>
				}
			/>

			<main
				id="workbench-main"
				className={
					isMobileWorkbench
						? "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
						: "relative flex min-h-0 flex-1 flex-col overflow-hidden"
				}
				aria-label="漫剧工作台"
			>
				{isMobileWorkbench && MobileWorkbenchPreview ? (
					<MobileWorkbenchPreview
						projectId={projectId}
						studioStatus={studioStatus}
						videoUrl={project.video_url}
						shots={shots}
						characters={characters}
						inbox={
							inboxItems.length > 0 ? (
								<InboxPanel items={inboxItems} actions={inboxActions} />
							) : null
						}
						chat={<AssistantChat projectId={projectId} hideEmpty />}
						activity={<ChatPanel projectId={projectId} isGenerating={hasActiveRun} limit={5} />}
						timing={hasActiveRun ? <RunTimingBar projectId={projectId} inline /> : null}
						primaryAction={
							hasActiveRun && !runAwaitingConfirm ? (
								<Button
									size="sm"
									variant="ghost"
									onClick={handleCancel}
									className="h-8 min-h-8 gap-1 px-2 text-error-fg hover:bg-error/10"
									aria-label="停止生成"
								>
									<SvgIcon name="stop" size={14} /> 停止
								</Button>
							) : null
						}
					/>
				) : null}

				{!isMobileWorkbench ? (
					<>
						{/* 工作台视图切换与协议枢纽开关条 */}
						<div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper-200 px-3 py-1">
							<div className="flex items-center gap-1" role="group" aria-label="工作台视图模式">
								<PlainButton
									onClick={() => setWorkbenchView("nodegraph")}
									aria-pressed={workbenchView === "nodegraph"}
									className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-fast ${
										workbenchView === "nodegraph"
											? "bg-primary text-primary-content"
											: "text-ink-muted hover:bg-surface hover:text-ink"
									}`}
								>
									节点终端台 (Option 3)
								</PlainButton>
								<PlainButton
									onClick={() => setWorkbenchView("storyboard")}
									aria-pressed={workbenchView === "storyboard"}
									className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-fast ${
										workbenchView === "storyboard"
											? "bg-primary text-primary-content"
											: "text-ink-muted hover:bg-surface hover:text-ink"
									}`}
								>
									分镜九宫格
								</PlainButton>
							</div>

							<div className="flex items-center gap-1.5">
								{workbenchView === "nodegraph" ? (
									<Button
										size="xs"
										variant={inspectorOpen ? "secondary" : "ghost"}
										onClick={() => setInspectorOpen(!inspectorOpen)}
										aria-expanded={inspectorOpen}
										aria-label={inspectorOpen ? "收起检查器" : "展开检查器"}
									>
										检查器
									</Button>
								) : null}
								<Button
									size="xs"
									variant="secondary"
									onClick={() => setHubDialogOpen(true)}
									aria-label="打开全局协议枢纽"
								>
									<SvgIcon name="sliders" size={12} />
									MCP &amp; CLI 枢纽
								</Button>
							</div>
						</div>

						{/* 主画布区 */}
						<div
							className={`relative isolate min-h-0 flex-1 overflow-hidden workbench-canvas-frame ${
								workbenchView === "nodegraph" ? "flex" : ""
							}`}
						>
							{workbenchView === "nodegraph" ? (
								<>
									<div className="min-w-0 flex-1 overflow-hidden">
										<Suspense
											fallback={
												<div className="flex h-full w-full items-center justify-center bg-paper-100 text-sm text-ink-muted">
													正在加载节点画布…
												</div>
											}
										>
											<NodeGraphCanvas
												project={project}
												characters={characters}
												shots={shots}
												runState={runState}
												chatState={chatState}
												mcpServers={mcpServers}
												cliTools={cliTools}
												selectedShotId={selectedShotId}
												activeNodeId={activeGraphNodeId}
												onSelectNode={handleSelectGraphNode}
												onOpenHub={(tab) => {
													if (tab) setHubTab(tab);
													setHubDialogOpen(true);
												}}
												onInspectNode={() => setInspectorOpen(true)}
												onTriggerNodeAction={handleTriggerGraphAction}
											/>
										</Suspense>
									</div>
									<InspectorPanel
										docked
										projectId={projectId}
										selectedNode={selectedWorkflowNode}
										selectedNodeIds={selectedNodeIds}
										structureLocked={hasActiveRun || runAwaitingConfirm}
										atGate={runAwaitingConfirm}
										universeId={project?.universe_id ?? null}
										briefNode={briefNode}
										open={inspectorOpen}
										onOpenChange={setInspectorOpen}
									/>
								</>
							) : (
								<>
									<Suspense
										fallback={
											<div className="flex h-full w-full items-center justify-center bg-paper-100 text-sm text-ink-muted">
												正在加载画布…
											</div>
										}
									>
										<WorkflowCanvas
											key={projectId}
											projectId={projectId}
											onSelectedNodeIdChange={handleSelectedNodeIdChange}
											onSelectedNodeIdsChange={handleSelectedNodeIdsChange}
											onOpenAssets={() => setAssetsOpen(true)}
											fitInsets={{
												left: agentCollapsed ? 0 : 372,
												right: inspectorOpen ? 332 : 0,
											}}
										/>
									</Suspense>
									<AgentPanel
										projectId={projectId}
										onCancel={handleCancel}
										isGenerating={hasActiveRun}
										collapsed={agentCollapsed}
										onCollapsedChange={setAgentCollapsed}
										tab={agentTab}
										onTabChange={setAgentTab}
										inboxItems={inboxItems}
										inboxActions={inboxActions}
									/>
									<PromptBar
										floating
										selection={selectionChips}
										onRemoveSelection={removeSelection}
										gateLabel={gateLabel}
										awaitingConfirm={runAwaitingConfirm}
										onSend={sendToAssistant}
									/>
									<InspectorPanel
										projectId={projectId}
										selectedNode={selectedWorkflowNode}
										selectedNodeIds={selectedNodeIds}
										structureLocked={hasActiveRun || runAwaitingConfirm}
										atGate={runAwaitingConfirm}
										universeId={project?.universe_id ?? null}
										briefNode={briefNode}
										open={inspectorOpen}
										onOpenChange={setInspectorOpen}
									/>
								</>
							)}
						</div>
					</>
				) : null}
			</main>

			{isMobileWorkbench ? (
				<PromptBar
					selection={selectionChips}
					gateLabel={gateLabel}
					awaitingConfirm={runAwaitingConfirm}
					onSend={handleChat}
				/>
			) : null}

			{hubDialogOpen ? (
				<Suspense fallback={null}>
					<ProtocolHubDialog
						projectId={projectId}
						open={hubDialogOpen}
						onClose={() => setHubDialogOpen(false)}
						mcpServers={mcpServers}
						cliTools={cliTools}
						onToggleMcpServer={(id, enabled) => {
							setLocalMcpOverrides((prev) => ({
								...prev,
								[id]: {
									...prev[id],
									enabled,
									status: enabled ? "online" : "offline",
								},
							}));
							void mcpApi.toggleServer(id, enabled).catch(() => undefined);
						}}
						onToggleMcpPolicy={(id, policy) => {
							setLocalMcpOverrides((prev) => ({
								...prev,
								[id]: { ...prev[id], policy },
							}));
							void mcpApi.updatePolicy(id, policy).catch(() => undefined);
						}}
						onPingMcpServer={handlePingMcp}
						onDryRunCliTool={handleDryRunCli}
					/>
				</Suspense>
			) : null}

			{assetsOpen ? (
				<Suspense fallback={null}>
					<AssetDrawer open projectId={projectId} onClose={() => setAssetsOpen(false)} />
				</Suspense>
			) : null}

			<RegenerateDialog
				open={regenerateOpen}
				projectId={projectId}
				pending={generatePending}
				onClose={() => setRegenerateOpen(false)}
				onConfirm={() => {
					handleGenerate();
					setRegenerateOpen(false);
				}}
			/>

			<ConfirmModal
				isOpen={restoreConfirmOpen}
				onClose={() => setRestoreConfirmOpen(false)}
				onConfirm={() => {
					if (previousVersion) handleRestorePrevious(previousVersion.run_id);
					setRestoreConfirmOpen(false);
				}}
				title="恢复上一版？"
				message={`成片、大纲和画布（${previousVersion?.character_count ?? 0} 个角色、${previousVersion?.shot_count ?? 0} 个分镜）会回到这次重新生成之前；重新生成得到的这一版会被替换。`}
				confirmText="恢复上一版"
				variant="warning"
				isLoading={restorePending}
			/>

			{versionOpen && (
				<Suspense fallback={null}>
					<VersionCompareDrawer
						open
						projectId={project.id}
						initialEntityType={versionTarget?.entityType}
						initialEntityId={versionTarget?.entityId ?? null}
						onClose={() => setVersionOpen(false)}
					/>
				</Suspense>
			)}
		</div>
	);
}
