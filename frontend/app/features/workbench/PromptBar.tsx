import { useState } from "react";
import { MessageInput } from "~/components/chat/MessageInput";
import { PlainButton } from "~/components/ui/PlainButton";
import { useEditorStore } from "~/stores/editorStore";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Tooltip } from "~/components/ui/Tooltip";

export interface PromptChip {
	id: string;
	label: string;
}

interface PromptBarProps {
	/** 画布选区；空数组时显示 [整个项目]。 */
	selection: PromptChip[];
	onRemoveSelection?: (id: string) => void;
	/** 审批门名称（如"规划"）；仅作只读状态提示，不劫持对话输入。 */
	gateLabel: string | null;
	awaitingConfirm: boolean;
	/** 发给项目助手（pi-agent-core，ADR 0011）；返回 false 表示没发出去，草稿会放回输入框 */
	onSend: (content: string) => Promise<boolean> | void;
	/** 桌面：浮在画布底部居中；手机：留在页面底部；内嵌：放在工作台抽屉中栏。 */
	floating?: boolean;
	embedded?: boolean;
}

const chipClass =
	"inline-flex max-w-48 shrink-0 items-center gap-0.5 truncate rounded-full border px-2 py-0.5 text-xs font-semibold";

/**
 * 项目对话助手统一输入条（AUD-UI-16 解耦后）：
 * - 始终直连 pi-agent-core（`onSend` -> `POST /chat`），即使处于人工审批门期间也不劫持用户输入；
 * - 切换至自动确认模式（yolo）仅更新客户端偏好，绝不静默批准当前挂起的人工审批门；
 * - 人类审批门决策仅在专属 `[HUMAN-ONLY]` 决策卡与待处理收件箱内完成。
 */
export function PromptBar({
	selection,
	onRemoveSelection,
	gateLabel,
	awaitingConfirm,
	onSend,
	floating = false,
	embedded = false,
}: PromptBarProps) {
	const [input, setInput] = useState("");
	const runMode = useEditorStore((s) => s.runMode);
	const setRunMode = useEditorStore((s) => s.setRunMode);
	const isAuto = runMode === "yolo";

	const toggleRunMode = () => {
		const next = isAuto ? "manual" : "yolo";
		setRunMode(next);
	};

	const handleSend = () => {
		if (!input.trim()) return;
		const draft = input;
		setInput("");
		void Promise.resolve(onSend(draft)).then((sent) => {
			if (sent === false) setInput((current) => current || draft);
		});
	};

	const placeholder =
		selection.length > 0
			? "向助手提问或调整所选内容…"
			: "向 pi-agent-core 助手提问，或让它重画、修改…";

	const containerClass = embedded
		? "shrink-0 rounded-md border border-line bg-surface p-1.5"
		: floating
			? "absolute bottom-3 left-1/2 z-panel w-[min(720px,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-line bg-surface p-1.5 shadow-panel"
			: "z-panel shrink-0 border-t border-line bg-surface px-2 py-1.5";

	return (
		<footer className={containerClass} data-shell="prompt-bar">
			<div className="mb-1 flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="上下文">
				<PlainButton
					className="inline-flex touch-target-dense shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-ink-muted transition-colors duration-fast hover:bg-paper-200 hover:text-ink"
					onClick={toggleRunMode}
					aria-label={isAuto ? "切换逐步确认" : "切换自动确认"}
					title={isAuto ? "自动确认：后续新建阶段自动通过" : "逐步确认：每个阶段由你确认"}
				>
					{isAuto ? (
						<SvgIcon name="zap" size={14} className="text-primary" />
					) : (
						<SvgIcon name="sliders" size={14} />
					)}
					{isAuto ? "自动确认" : "逐步确认"}
				</PlainButton>
				<span className="h-4 w-px shrink-0 bg-ink/15" aria-hidden="true" />
				{awaitingConfirm && gateLabel ? (
					<span
						className={`${chipClass} border-warning/40 bg-warning-bg text-warning-fg`}
						data-testid="prompt-gate-indicator"
					>
						{gateLabel} · 审批门挂起（自由对话）
					</span>
				) : null}
				{selection.length > 0 ? (
					selection.map((chip) => (
						<Tooltip key={chip.id} content={chip.label}>
							<span className={`${chipClass} border-primary/30 bg-primary/10 text-primary`}>
								<span className="truncate">{chip.label}</span>
								{onRemoveSelection ? (
									<PlainButton
										className="-my-1 -mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/15"
										onClick={() => onRemoveSelection(chip.id)}
										aria-label={`移除 ${chip.label}`}
									>
										<SvgIcon name="x" size={12} />
									</PlainButton>
								) : null}
							</span>
						</Tooltip>
					))
				) : (
					<span className={`${chipClass} border-line text-ink-muted`}>整个项目</span>
				)}
			</div>
			<MessageInput
				value={input}
				onChange={setInput}
				onSend={handleSend}
				placeholder={placeholder}
				sendLabel="发送"
			/>
		</footer>
	);
}
