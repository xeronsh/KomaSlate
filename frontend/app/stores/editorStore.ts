import { create } from "zustand";
import { devtools } from "zustand/middleware";

// 生产环境 devtools 本就是直通（enabled: DEV）；这里在构建期直接去掉它，让 tree-shaking 删掉整段中间件代码
const withDevtools = (import.meta.env.DEV ? devtools : (fn: unknown) => fn) as typeof devtools;

export type RunMode = "manual" | "yolo";
export type AgentPanelTab = "chat" | "activity" | "inbox";
export type WorkbenchViewMode = "nodegraph" | "storyboard";
export type ProtocolHubTab = "outbound" | "cli" | "inbound";

const LAYOUT_STORAGE_KEY = "komaslate.workbench.layout.v1";

interface PersistedWorkbenchPrefs {
	workbenchView?: WorkbenchViewMode;
	hubTab?: ProtocolHubTab;
}

function readPersistedPrefs(): PersistedWorkbenchPrefs {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as PersistedWorkbenchPrefs;
	} catch {
		return {};
	}
}

function writePersistedPrefs(prefs: PersistedWorkbenchPrefs): void {
	if (typeof window === "undefined") return;
	try {
		const prev = readPersistedPrefs();
		window.localStorage.setItem(
			LAYOUT_STORAGE_KEY,
			JSON.stringify({ ...prev, ...prefs }),
		);
	} catch {
		// Ignore storage quota or private mode failures
	}
}

function currentWindowWidth(): number {
	return typeof window !== "undefined" ? window.innerWidth : 1440;
}

/**
 * Client-owned workbench state only.
 *
 * Everything the server owns (project fields, characters, shots, the chat
 * feed and the live run UI) lives in the TanStack Query cache — see
 * `~/query` (ADR 0007). This store keeps selection, highlighted message,
 * manual/yolo run-mode preference, and responsive workbench panel layout
 * synchronized via ResizeObserver (AUD-UI-15).
 */
interface EditorState {
	selectedShotId: number | null;
	selectedCharacterId: number | null;
	highlightedMessageIndex: number | null;
	runMode: RunMode;

	// Workbench layout & Option 3 protocol state (AUD-UI-15)
	viewportWidth: number;
	agentCollapsed: boolean;
	inspectorOpen: boolean;
	agentTab: AgentPanelTab;
	workbenchView: WorkbenchViewMode;
	activeGraphNodeId: string | null;
	hubDialogOpen: boolean;
	hubTab: ProtocolHubTab;

	setSelectedShot: (id: number | null) => void;
	setSelectedCharacter: (id: number | null) => void;
	setHighlightedMessage: (index: number | null) => void;
	setRunMode: (mode: RunMode) => void;

	syncViewportWidth: (width: number, opts?: { initial?: boolean }) => void;
	setAgentCollapsed: (collapsed: boolean) => void;
	setInspectorOpen: (open: boolean) => void;
	setAgentTab: (tab: AgentPanelTab) => void;
	setWorkbenchView: (view: WorkbenchViewMode) => void;
	setActiveGraphNodeId: (nodeId: string | null) => void;
	setHubDialogOpen: (open: boolean) => void;
	setHubTab: (tab: ProtocolHubTab) => void;
	reset: () => void;
}

const persisted = readPersistedPrefs();
const initialWidth = currentWindowWidth();

const initialState = {
	selectedShotId: null as number | null,
	selectedCharacterId: null as number | null,
	highlightedMessageIndex: null as number | null,
	runMode: "manual" as RunMode,

	viewportWidth: initialWidth,
	agentCollapsed: initialWidth < 1440,
	inspectorOpen: initialWidth >= 1280,
	agentTab: "activity" as AgentPanelTab,
	workbenchView: (persisted.workbenchView ?? "nodegraph") as WorkbenchViewMode,
	activeGraphNodeId: "agent_core" as string | null,
	hubDialogOpen: false,
	hubTab: (persisted.hubTab ?? "outbound") as ProtocolHubTab,
};

export const useEditorStore = create<EditorState>()(
	withDevtools(
		(set, get) => ({
			...initialState,

			setSelectedShot: (id) =>
				set({ selectedShotId: id }, false, "setSelectedShot"),
			setSelectedCharacter: (id) =>
				set({ selectedCharacterId: id }, false, "setSelectedCharacter"),
			setHighlightedMessage: (index) =>
				set({ highlightedMessageIndex: index }, false, "setHighlightedMessage"),
			setRunMode: (mode) => set({ runMode: mode }, false, "setRunMode"),

			syncViewportWidth: (width, opts) => {
				if (!Number.isFinite(width) || width <= 0) return;
				const narrow = width < 1280;
				if (opts?.initial) {
					set(
						{
							viewportWidth: width,
							agentCollapsed: width < 1440,
							inspectorOpen: !narrow,
						},
						false,
						"syncViewportWidth:initial",
					);
					return;
				}
				const state = get();
				if (narrow && !state.agentCollapsed && state.inspectorOpen) {
					set(
						{ viewportWidth: width, agentCollapsed: true },
						false,
						"syncViewportWidth:narrow",
					);
					return;
				}
				if (state.viewportWidth !== width) {
					set({ viewportWidth: width }, false, "syncViewportWidth");
				}
			},

			setAgentCollapsed: (collapsed) => {
				const narrow = get().viewportWidth < 1280;
				set(
					{
						agentCollapsed: collapsed,
						...(!collapsed && narrow ? { inspectorOpen: false } : {}),
					},
					false,
					"setAgentCollapsed",
				);
			},

			setInspectorOpen: (open) => {
				const narrow = get().viewportWidth < 1280;
				set(
					{
						inspectorOpen: open,
						...(open && narrow ? { agentCollapsed: true } : {}),
					},
					false,
					"setInspectorOpen",
				);
			},

			setAgentTab: (tab) => set({ agentTab: tab }, false, "setAgentTab"),

			setWorkbenchView: (view) => {
				writePersistedPrefs({ workbenchView: view });
				set({ workbenchView: view }, false, "setWorkbenchView");
			},

			setActiveGraphNodeId: (nodeId) =>
				set({ activeGraphNodeId: nodeId }, false, "setActiveGraphNodeId"),

			setHubDialogOpen: (open) =>
				set({ hubDialogOpen: open }, false, "setHubDialogOpen"),

			setHubTab: (tab) => {
				writePersistedPrefs({ hubTab: tab });
				set({ hubTab: tab }, false, "setHubTab");
			},

			reset: () => {
				const w = currentWindowWidth();
				set(
					{
						...initialState,
						viewportWidth: w,
						agentCollapsed: w < 1440,
						inspectorOpen: w >= 1280,
					},
					false,
					"reset",
				);
			},
		}),
		{ name: "EditorStore", enabled: import.meta.env.DEV },
	),
);
