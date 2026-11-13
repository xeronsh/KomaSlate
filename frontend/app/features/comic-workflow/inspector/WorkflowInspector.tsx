import { useState } from "react";
import { EmptyState } from "~/components/ui/EmptyState";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/Tabs";
import type { ComicWorkflowNode } from "../graph/types";
import { GenerationSection } from "./GenerationSection";
import { HistorySection } from "./HistorySection";
import { MultiShotActions } from "./MultiShotActions";
import { PropertiesSection } from "./PropertiesSection";
import { SelectionSection } from "./SelectionSection";

type InspectorTab = "selection" | "properties" | "generation" | "history";

interface WorkflowInspectorProps {
	projectId: number;
	selectedNode: ComicWorkflowNode | null;
	selectedNodeIds?: string[];
	structureLocked: boolean;
	atGate?: boolean;
	universeId?: number | null;
}

/** 检查器眉题：节点类型的中文名（原先直接露出 brief / shot 这类内部枚举）。 */
const KIND_LABELS: Record<ComicWorkflowNode["kind"], string> = {
	brief: "项目概要",
	character: "角色",
	shot: "分镜",
	output: "成片",
};

const TAB_LABELS: Record<InspectorTab, string> = {
	selection: "概览",
	properties: "属性",
	generation: "生成",
	history: "历史",
};

export function WorkflowInspector({
	projectId,
	selectedNode,
	selectedNodeIds = [],
	structureLocked,
	atGate = false,
	universeId = null,
}: WorkflowInspectorProps) {
	// 切换卡片时保留当前页签（如连续逐格改「属性」或点「生成」），不再强行踢回「概览」
	const [activeTab, setActiveTab] = useState<InspectorTab>("selection");

	const multiShotIds = selectedNodeIds
		.filter((id) => id.startsWith("shot:"))
		.map((id) => Number(id.split(":")[1]))
		.filter((n) => Number.isFinite(n));

	if (!selectedNode && multiShotIds.length === 0) {
		return (
			<EmptyState
				compact
				icon={<SvgIcon name="layers" size={24} />}
				title="选择画布卡片"
				description="可多选分镜格 · 批量重做本格"
				className="h-full"
			/>
		);
	}

	if (!selectedNode && multiShotIds.length > 0) {
		return (
			<MultiShotActions
				projectId={projectId}
				shotIds={multiShotIds}
				structureLocked={structureLocked}
				atGate={atGate}
			/>
		);
	}

	if (!selectedNode) return null;

	return (
		<div className="flex h-full min-h-0 flex-col bg-paper-100" data-shell="inspector">
			<div className="border-b border-line px-2 py-1.5">
				<p className="m-0 label text-ink-muted">{KIND_LABELS[selectedNode.kind]}</p>
				<h2 className="m-0 truncate text-sm font-bold" title={selectedNode.title}>
					{selectedNode.title}
				</h2>
				{/* 概览不再重复副标题（如分镜场景），这里两行内说完，全文在 title 里 */}
				<p className="m-0 line-clamp-2 text-xs text-ink-muted" title={selectedNode.subtitle}>
					{selectedNode.subtitle}
				</p>
			</div>

			<Tabs
				value={activeTab}
				onValueChange={(value) => setActiveTab(value as InspectorTab)}
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList variant="segment" aria-label="检查器分区">
					{(Object.keys(TAB_LABELS) as InspectorTab[]).map((tab) => (
						<TabsTrigger key={tab} value={tab} variant="segment">
							{TAB_LABELS[tab]}
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent
					value="selection"
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
				>
					<SelectionSection node={selectedNode} />
				</TabsContent>
				<TabsContent
					value="properties"
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
				>
					<PropertiesSection
						projectId={projectId}
						node={selectedNode}
						structureLocked={structureLocked}
						atGate={atGate}
					/>
				</TabsContent>
				<TabsContent
					value="generation"
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
				>
					<GenerationSection
						projectId={projectId}
						node={selectedNode}
						structureLocked={structureLocked}
						atGate={atGate}
						universeId={universeId}
						multiShotIds={multiShotIds}
					/>
				</TabsContent>
				<TabsContent
					value="history"
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
				>
					<HistorySection node={selectedNode} projectId={projectId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
