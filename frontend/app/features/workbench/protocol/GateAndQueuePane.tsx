import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Textarea } from "~/components/ui/Textarea";
import { PromptBar, type PromptChip } from "~/features/workbench/PromptBar";
import { projectQueryKeys } from "~/query/queryKeys";
import { chatApi } from "~/services/api";
import type {
	ChatState,
	FeedbackReceipt,
	RunAwaitingConfirmEventData,
} from "~/types";
import { toast } from "~/utils/toast";
import { useAgentThoughts } from "./thoughtStreamStore";

interface GateAndQueuePaneProps {
	projectId: number;
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
}

export function GateAndQueuePane({
	projectId,
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
}: GateAndQueuePaneProps) {
	const queryClient = useQueryClient();
	const thoughts = useAgentThoughts(projectId);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const [feedbackDraft, setFeedbackDraft] = useState("");
	const [confirmBusy, setConfirmBusy] = useState(false);

	const pendingToolConfirm = chatState?.pending ?? null;

	const handleSubmitFeedback = async () => {
		const text = feedbackDraft.trim();
		if (!text || gateDecisionPending) return;
		const ok = await onConfirmGate(text);
		if (ok !== false) {
			setFeedbackDraft("");
			setFeedbackOpen(false);
		}
	};

	const handleChatConfirmation = async (approved: boolean) => {
		if (!pendingToolConfirm || confirmBusy) return;
		setConfirmBusy(true);
		try {
			await chatApi.confirm(projectId, pendingToolConfirm.tool_call_id, approved);
			await queryClient.invalidateQueries({ queryKey: projectQueryKeys.chat(projectId) });
		} catch {
			toast.error({
				title: "确认未提交",
				message: "该写操作确认卡可能已过期或已处理",
			});
		} finally {
			setConfirmBusy(false);
		}
	};

	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden border-r border-line bg-surface"
			aria-label="人工审批门与智能体协作队列"
			data-testid="gate-queue-pane"
		>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper-200 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-xs font-semibold text-ink">审批门 &amp; Agent 队列</span>
					<span className="rounded-sm border border-warning/40 bg-warning-bg px-1.5 py-0.5 font-mono text-xs font-semibold text-warning-fg">
						HUMAN-ONLY
					</span>
				</div>
				<span className="font-mono text-xs text-ink-muted">
					{awaitingConfirm ? "1 GATE" : pendingToolConfirm ? "1 TOOL" : "IDLE"}
				</span>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2.5">
				{/* 物理隔离的人工审批门专属卡片 */}
				{awaitingConfirm ? (
					<div
						className="rounded-lg border border-warning/50 bg-warning-bg p-2.5"
						data-testid="human-only-gate-card"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="inline-flex items-center gap-1 text-xs font-semibold text-warning-fg">
								<SvgIcon name="approve-gate" size={14} />
								人工审批门 · 仅限人类决策放行
							</span>
							<span className="font-mono text-xs text-warning-fg">
								run #{recoveryGate?.run_id ?? "—"}
							</span>
						</div>
						<p className="m-0 mt-1 text-xs font-semibold text-ink">
							{gateLabel ? `${gateLabel} · 等待人类放行` : "当前阶段等待人类放行"}
						</p>
						<p className="m-0 mt-0.5 text-xs text-ink-muted">
							{recoveryGate?.question ||
								recoveryGate?.completed ||
								"pi-agent-core 无权自批或绕过此门，请人工核对产出后决定。"}
						</p>
						{feedbackReceipt ? (
							<p className="m-0 mt-1 rounded-sm border border-line bg-surface px-2 py-1 text-xs text-ink-muted">
								第 <span className="font-mono">{feedbackReceipt.round}</span> 轮意见（
								{feedbackReceipt.state}）：{feedbackReceipt.content}
							</p>
						) : null}

						{feedbackOpen ? (
							<div className="mt-2 flex flex-col gap-1.5">
								<Textarea
									rows={2}
									value={feedbackDraft}
									onChange={(e) => setFeedbackDraft(e.target.value)}
									placeholder="输入驳回与修改意见…"
									aria-label="审批门修改意见"
								/>
								<div className="flex justify-end gap-1.5">
									<Button
										size="xs"
										variant="ghost"
										onClick={() => setFeedbackOpen(false)}
									>
										取消
									</Button>
									<Button
										size="xs"
										variant="primary"
										disabled={!feedbackDraft.trim() || gateDecisionPending}
										onClick={() => void handleSubmitFeedback()}
									>
										提交驳回意见
									</Button>
								</div>
							</div>
						) : (
							<div className="mt-2 flex items-center gap-1.5">
								<Button
									size="xs"
									variant="primary"
									disabled={gateDecisionPending}
									onClick={() => void onConfirmGate(undefined)}
									aria-label="批准放行审批门"
								>
									<SvgIcon name="check" size={12} />
									批准放行
								</Button>
								<Button
									size="xs"
									variant="secondary"
									disabled={gateDecisionPending}
									onClick={() => setFeedbackOpen(true)}
									aria-label="驳回重提审批门"
								>
									<SvgIcon name="pencil" size={12} />
									驳回重提
								</Button>
							</div>
						)}
					</div>
				) : (
					<div className="rounded-md border border-line bg-paper-100 px-2.5 py-2 text-xs text-ink-muted">
						<span className="font-mono text-ink">Gate</span>：当前无挂起人工审批门（仅人类可执行批准）
					</div>
				)}

				{/* SQLite 持久化 chat_confirmation 确认卡 */}
				{pendingToolConfirm ? (
					<div
						className="rounded-lg border border-primary/40 bg-primary/5 p-2.5"
						data-testid="persistent-chat-confirm-card"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-semibold text-primary">
								待确认写操作（SQLite 持久化）
							</span>
							<span className="font-mono text-xs text-ink-muted">
								{pendingToolConfirm.tool}
							</span>
						</div>
						<p className="m-0 mt-1 text-xs text-ink">{pendingToolConfirm.summary}</p>
						<div className="mt-2 flex justify-end gap-1.5">
							<Button
								size="xs"
								variant="ghost"
								disabled={confirmBusy}
								onClick={() => void handleChatConfirmation(false)}
							>
								拒绝
							</Button>
							<Button
								size="xs"
								variant="primary"
								disabled={confirmBusy}
								onClick={() => void handleChatConfirmation(true)}
							>
								确认执行
							</Button>
						</div>
					</div>
				) : null}

				{/* pi-agent-core 实时思考流 */}
				<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-md border border-line bg-paper-100 p-2">
					<div className="flex items-center justify-between text-xs text-ink-muted">
						<span className="font-mono font-semibold text-ink">pi-agent-core</span>
						<span>{chatState?.busy ? "推理中…" : "空闲"}</span>
					</div>

					{thoughts.length === 0 && !chatState?.text ? (
						<p className="m-0 text-xs text-ink-muted">
							实时思考流与工具调度记录将显示在这里；下方输入框始终直连助手。
						</p>
					) : (
						<ul className="m-0 list-none space-y-1.5 p-0">
							{thoughts.slice(-8).map((item) => (
								<li
									key={item.id}
									className="rounded-sm border border-line bg-surface px-2 py-1 text-xs"
								>
									<div className="flex items-center justify-between font-mono text-xs text-ink-muted">
										<span>
											{item.agent} · {item.phase}
										</span>
										<span>{item.done ? "done" : "stream"}</span>
									</div>
									<p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-ink">
										{item.content}
									</p>
								</li>
							))}
							{chatState?.busy && chatState.text ? (
								<li className="rounded-sm border border-primary/30 bg-surface px-2 py-1 text-xs text-ink">
									{chatState.text}
								</li>
							) : null}
						</ul>
					)}
				</div>

				{/* 解耦的 PromptBar：任何时候（含审批门挂起）都自由直连 pi-agent-core */}
				<PromptBar
					embedded
					selection={selectionChips}
					onRemoveSelection={onRemoveSelection}
					gateLabel={gateLabel}
					awaitingConfirm={awaitingConfirm}
					onSend={onSendChat}
				/>
			</div>
		</section>
	);
}
