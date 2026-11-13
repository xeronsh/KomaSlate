import { AssistantChat } from "~/components/chat/AssistantChat";
import { ChatPanel } from "~/components/chat/ChatPanel";
import { IconButton } from "~/components/ui/IconButton";
import { PlainButton } from "~/components/ui/PlainButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/Tabs";
import { InboxPanel, type InboxActions } from "./InboxPanel";
import type { InboxItem } from "./inboxItems";
import { SvgIcon } from "~/components/ui/SvgIcon";
import "~/components/ui/icons/workbenchIcons";

export type AgentPanelTab = "chat" | "activity" | "inbox";

interface AgentPanelProps {
	projectId: number;
	onCancel: () => void;
	isGenerating: boolean;
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	tab: AgentPanelTab;
	onTabChange: (tab: AgentPanelTab) => void;
	inboxItems: InboxItem[];
	inboxActions: InboxActions;
}

/**
 * Agent 面板：浮在画布左侧（360px），默认展开，可收成胶囊。
 * 三个页签：助手对话、活动流、待处理；采用 Radix Tabs 统一无障碍导航（AUD-UI-08）。
 */
export function AgentPanel({
	projectId,
	onCancel,
	isGenerating,
	collapsed,
	onCollapsedChange,
	tab,
	onTabChange,
	inboxItems,
	inboxActions,
}: AgentPanelProps) {
	const pendingCount = inboxItems.length;
	if (collapsed) {
		return (
			<PlainButton
				className="animate-enter absolute left-3 top-3 z-panel inline-flex touch-target-dense items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold shadow-panel transition-colors duration-fast hover:border-primary"
				onClick={() => onCollapsedChange(false)}
				aria-label="展开活动面板"
				aria-expanded={false}
				data-shell="agent-panel"
			>
				<SvgIcon name="sparks" size={14} className="text-primary" />
				活动
				{pendingCount > 0 ? (
					<span className="rounded-full bg-primary px-1.5 text-primary-content">{pendingCount}</span>
				) : null}
			</PlainButton>
		);
	}

	return (
		<aside
			className="animate-enter-left absolute bottom-24 left-3 top-3 z-panel flex w-panel-agent max-w-panel flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-panel"
			aria-label="工作流活动"
			data-shell="agent-panel"
		>
			<Tabs
				value={tab}
				onValueChange={(value) => onTabChange(value as AgentPanelTab)}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<div className="flex items-center justify-between gap-1 border-b border-line py-1 pl-3 pr-1">
					<TabsList variant="pill" aria-label="Agent 面板">
						{(
							[
								["chat", "助手"],
								["activity", "活动"],
								["inbox", "待处理"],
							] as const
						).map(([id, label]) => (
							<TabsTrigger
								key={id}
								value={id}
								variant="pill"
								id={`agent-tab-${id}`}
							>
								{label}
								{id === "inbox" && pendingCount > 0 ? (
									<span className="rounded-full bg-primary px-1.5 text-xs text-primary-content">
										{pendingCount}
									</span>
								) : null}
							</TabsTrigger>
						))}
					</TabsList>
					<IconButton
						className="text-ink-muted hover:text-ink"
						onClick={() => onCollapsedChange(true)}
						aria-label="收起活动面板"
						aria-expanded
						title="收起活动面板"
					>
						<SvgIcon name="chevrons-left" size={14} />
					</IconButton>
				</div>
				<TabsContent
					value="inbox"
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
					id="agent-tabpanel-inbox"
				>
					<InboxPanel items={inboxItems} actions={inboxActions} />
				</TabsContent>
				<TabsContent
					value="chat"
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
					id="agent-tabpanel-chat"
				>
					<AssistantChat projectId={projectId} />
				</TabsContent>
				<TabsContent
					value="activity"
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
					id="agent-tabpanel-activity"
				>
					<ChatPanel
						projectId={projectId}
						onCancel={onCancel}
						isGenerating={isGenerating}
					/>
				</TabsContent>
			</Tabs>
		</aside>
	);
}
