import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/Tabs";
import type { PromptChip } from "~/features/workbench/PromptBar";
import { useEditorStore } from "~/stores/editorStore";
import type {
	ChatState,
	FeedbackReceipt,
	RunAwaitingConfirmEventData,
	Shot,
} from "~/types";
import { AbWipeComparatorPane } from "./AbWipeComparatorPane";
import { GateAndQueuePane } from "./GateAndQueuePane";
import { ProtocolConsolePane } from "./ProtocolConsolePane";

interface ProtocolWorkbenchDrawerProps {
	projectId: number;
	shots: Shot[];
	selectedShotId: number | null;
	awaitingConfirm: boolean;
	gateLabel: string | null;
	recoveryGate: RunAwaitingConfirmEventData | null;
	feedbackReceipt: FeedbackReceipt | null;
	gateDecisionPending: boolean;
	onConfirmGate: (feedback?: string) => Promise<boolean> | void;
	chatState: ChatState | null | undefined;
	selectionChips: PromptChip[];
	onRemoveSelection?: (id: string) => void;
	onSendChat: (content: string) => Promise<boolean> | void;
	onOpenHub: () => void;
	onPingMcp: () => void;
}

/**
 * Option 3 底部三栏协议抽屉（42% 高度）：
 * - ≥1024px：35% / 30% / 35% 三栏并行（A/B Wipe、审批与队列、协议终端）
 * - <1024px：自动切换为单栏 Tab 切换（防止窄屏三栏挤压或横向溢出）
 */
export function ProtocolWorkbenchDrawer({
	projectId,
	shots,
	selectedShotId,
	awaitingConfirm,
	gateLabel,
	recoveryGate,
	feedbackReceipt,
	gateDecisionPending,
	onConfirmGate,
	chatState,
	selectionChips,
	onRemoveSelection,
	onSendChat,
	onOpenHub,
	onPingMcp,
}: ProtocolWorkbenchDrawerProps) {
	const viewportWidth = useEditorStore((s) => s.viewportWidth);
	const [compactTab, setCompactTab] = useState<"wipe" | "gate" | "console">("gate");
	const isCompact = viewportWidth < 1024;

	const wipePane = (
		<AbWipeComparatorPane
			projectId={projectId}
			shots={shots}
			selectedShotId={selectedShotId}
		/>
	);
	const gatePane = (
		<GateAndQueuePane
			projectId={projectId}
			awaitingConfirm={awaitingConfirm}
			gateLabel={gateLabel}
			recoveryGate={recoveryGate}
			feedbackReceipt={feedbackReceipt}
			gateDecisionPending={gateDecisionPending}
			onConfirmGate={onConfirmGate}
			chatState={chatState}
			selectionChips={selectionChips}
			onRemoveSelection={onRemoveSelection}
			onSendChat={onSendChat}
		/>
	);
	const consolePane = (
		<ProtocolConsolePane
			projectId={projectId}
			onOpenHub={onOpenHub}
			onPingMcp={onPingMcp}
		/>
	);

	if (isCompact) {
		return (
			<aside
				className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-line bg-surface"
				style={{ height: "46%" }}
				aria-label="底部协议工作台"
				data-testid="protocol-workbench-drawer"
				data-layout="compact-tabs"
			>
				<Tabs
					value={compactTab}
					onValueChange={(v) => setCompactTab(v as "wipe" | "gate" | "console")}
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
				>
					<TabsList variant="segment" aria-label="协议工作台分区">
						<TabsTrigger value="wipe" variant="segment">
							A/B 对比
						</TabsTrigger>
						<TabsTrigger value="gate" variant="segment">
							审批与队列
						</TabsTrigger>
						<TabsTrigger value="console" variant="segment">
							协议终端
						</TabsTrigger>
					</TabsList>
					<TabsContent value="wipe" className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{wipePane}
					</TabsContent>
					<TabsContent value="gate" className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{gatePane}
					</TabsContent>
					<TabsContent value="console" className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{consolePane}
					</TabsContent>
				</Tabs>
			</aside>
		);
	}

	return (
		<aside
			className="grid min-h-0 shrink-0 overflow-hidden border-t border-line bg-surface"
			style={{
				height: "42%",
				gridTemplateColumns: "minmax(0, 35%) minmax(0, 30%) minmax(0, 35%)",
			}}
			aria-label="底部三栏协议工作台"
			data-testid="protocol-workbench-drawer"
			data-layout="three-pane"
		>
			{wipePane}
			{gatePane}
			{consolePane}
		</aside>
	);
}
