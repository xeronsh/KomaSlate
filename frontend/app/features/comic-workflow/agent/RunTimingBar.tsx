import { useRunNotify, useRunTiming } from "~/hooks/useRunTiming";
import { PlainButton } from "~/components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Tooltip } from "~/components/ui/Tooltip";
import { formatElapsed, formatRemaining } from "~/utils/runTiming";
import "~/components/ui/icons/workbenchIcons";

/**
 * 运行中的时间条（P1-8）：本步已用 · 共已用 · 剩余约 N 分钟，外加「完成后通知我」。
 * 没有历史可估时只显示已用时；闸门上不计时本步，剩余是「确认后」还要多久。
 */
export function RunTimingBar({ projectId, inline = false }: { projectId: number; /** 放在卡片里：不画分隔线 */ inline?: boolean }) {
	const timing = useRunTiming(projectId);
	const notify = useRunNotify(projectId);
	if (!timing) return null;
	const remaining = formatRemaining(timing.remainingSeconds);
	const breakdown = timing.steps.map((step) => `${step.label} ${formatElapsed(step.seconds)}`).join("\n");
	const blocked = notify.availability === "denied" || notify.availability === "unsupported";
	const notifyTitle = blocked
		? notify.availability === "denied"
			? "浏览器已拦截本站通知：切到别的标签页时，标题会提示待确认、完成或失败"
			: "这个浏览器不支持通知：切到别的标签页时，标题会提示待确认、完成或失败"
		: notify.enabled
			? "到确认点、完成或失败时发一条浏览器通知；再点关闭"
			: "到确认点、完成或失败时发一条浏览器通知（第一次会请求权限）";
	return (
		<div
			className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-ink-muted ${
				inline ? "mt-1" : "border-b border-line px-2 py-0.5"
			}`}
			data-testid="run-timing"
		>
			<Tooltip content={breakdown || undefined}>
				<span className="inline-flex min-w-0 items-center gap-1 tabular-nums">
					<SvgIcon name="clock-3" size={12} className="shrink-0" />
					{timing.stepSeconds !== null && timing.stepLabel ? (
						<span data-testid="run-timing-step">
							本步 {formatElapsed(timing.stepSeconds)}
							<span aria-hidden="true"> · </span>
						</span>
					) : null}
					<span data-testid="run-timing-total">共 {formatElapsed(timing.overallSeconds)}</span>
					{remaining ? (
						<span data-testid="run-timing-remaining">
							<span aria-hidden="true"> · </span>
							{timing.atGate ? `确认后还要${remaining}` : `剩余${remaining}`}
						</span>
					) : null}
				</span>
			</Tooltip>
			<PlainButton
				className={`touch-target-dense inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-fast disabled:cursor-not-allowed ${
					notify.enabled ? "bg-primary/10 font-semibold text-primary" : "text-ink-muted hover:text-ink"
				}`}
				aria-pressed={notify.enabled}
				disabled={blocked}
				title={notifyTitle}
				onClick={notify.toggle}
			>
				<SvgIcon name="bell" size={12} />
				{notify.enabled ? "完成后会通知你" : "完成后通知我"}
			</PlainButton>
		</div>
	);
}
