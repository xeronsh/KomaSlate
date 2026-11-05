import { MenuButton, MenuItem, MenuLink } from "~/components/ui/Menu";
import { BUTTON_BASE, BUTTON_VARIANTS, Button } from "~/components/ui/Button";
import {
	type StudioStatus,
	studioStatusDotClass,
	studioStatusText,
} from "~/features/comic-workflow/state/deriveStudioStatus";
import { useEffect, useState } from "react";
import { PlainButton } from "~/components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { WORKFLOW_STEPS } from "~/utils/workflowSteps";
import "~/components/ui/icons/workbenchIcons";

/** 创建运行在途的秒数；不在途时为 0。超过 10 秒就要说清楚还在等什么（P1-1）。 */
function usePendingSeconds(pending: boolean): number {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		if (!pending) {
			setSeconds(0);
			return;
		}
		const started = Date.now();
		const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
		return () => window.clearInterval(timer);
	}, [pending]);
	return seconds;
}

const SLOW_START_SECONDS = 10;

interface StudioControlsProps {
	isGenerating: boolean;
	studioStatus: StudioStatus;
	awaitingConfirm: boolean;
	hasRecovery: boolean;
	onGenerate?: () => void;
	onCancel: () => void;
	/** Status pill click: open the pending / chat panel. */
	onOpenInbox?: () => void;
	generateDisabled?: boolean;
	/** Open version history / compare drawer. */
	onOpenVersions?: () => void;
	/** Trigger export (e.g. webtoon). */
	onExport?: () => void;
	/** 导出剪辑素材包（ZIP + FCPXML） */
	onExportEditorial?: () => void;
	exportBusy?: boolean;
	/** 成片下载地址；完成后它是顶栏主按钮（CapCut / Runway 的「导出」位置） */
	downloadUrl?: string | null;
	/** 正在创建运行（POST runs 在途）：按钮立刻进入忙碌态 */
	generatePending?: boolean;
	/**
	 * 已有产物时的「重新生成」：收进 ··· 菜单，先弹确认（重做什么、多久、多少调用）。
	 * 不传时退回旧行为（顶栏主按钮直接重新生成）。
	 */
	onRegenerate?: () => void;
	/** 恢复重新生成之前的那一版 */
	onRestorePrevious?: () => void;
	restoreBusy?: boolean;
	/** 重新生成进行中时，上一版成片仍可下载 */
	previousDownloadUrl?: string | null;
}

const chromeBtn =
	"gap-1 !px-2 text-xs";

/**
 * Top-bar centre for the workbench: one status pill (opens the inbox) and the
 * run actions. The old stage row is gone; the pill names the stage instead.
 */
export function StudioControls({
	isGenerating,
	studioStatus,
	awaitingConfirm,
	hasRecovery,
	onGenerate,
	onCancel,
	onOpenInbox,
	generateDisabled,
	onOpenVersions,
	onExport,
	onExportEditorial,
	exportBusy = false,
	downloadUrl = null,
	generatePending = false,
	onRegenerate,
	onRestorePrevious,
	restoreBusy = false,
	previousDownloadUrl = null,
}: StudioControlsProps) {
	const pendingSeconds = usePendingSeconds(Boolean(generatePending));
	// “从失败阶段重试”只在收件箱；这里只有开始 / 重新生成
	const idle = studioStatus.state === "idle";
	const generateLabel = idle ? "开始生成" : "重新生成";
	const canStart = !isGenerating && !hasRecovery && !awaitingConfirm;
	// 有产物之后，重新生成不再是一个随手就点到的主按钮
	const regenerateInMenu = Boolean(onRegenerate) && !idle;
	const showMainGenerate = Boolean(onGenerate) && (generatePending || (canStart && !regenerateInMenu));
	const hasTools = Boolean(
		onOpenVersions || onExport || onExportEditorial || regenerateInMenu || onRestorePrevious || previousDownloadUrl,
	);
	// 成片可用时：下载是主操作，重新生成退为次要
	const finished = studioStatus.state === "ready" && Boolean(downloadUrl) && !isGenerating;
	const generateDisabledReason = generatePending
		? pendingSeconds >= SLOW_START_SECONDS
			? "模型响应较慢，运行还没建好：可以继续等，或刷新页面后重试"
			: "正在创建运行"
		: generateDisabled
			? "已有运行在进行中"
			: undefined;
	// 步骤只在运行活跃时出现：按六步计数，不再显示会卡在 50% 的百分比
	const pillText = studioStatusText(studioStatus);

	return (
		<>
		<span className="sr-only" aria-live="polite">
			工作台状态：{pillText}
		</span>
		{/* <sm 顶栏放不下：移动端的状态与重试在 MobileWorkbenchPreview 里 */}
		<div className="hidden min-w-0 items-center gap-1.5 sm:flex" data-shell="studio-controls">

			<PlainButton
				className={`touch-target-dense inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tabular-nums transition-colors duration-fast ${
					awaitingConfirm
						? "border-primary bg-primary text-primary-content"
						: "border-line bg-surface text-ink hover:border-primary"
				}`}
				onClick={onOpenInbox}
				title={studioStatus.description}
				aria-label={`状态：${pillText}，打开待处理`}
			>
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${awaitingConfirm ? "bg-primary-content" : studioStatusDotClass(studioStatus)}`}
					aria-hidden="true"
				/>
				<span className="truncate">{pillText}</span>
				{studioStatus.step ? (
					<span aria-hidden="true" className="ml-0.5 hidden items-center gap-0.5 md:inline-flex">
						{WORKFLOW_STEPS.map((s, idx) => {
							const done = idx < studioStatus.step!.index;
							const current = idx === studioStatus.step!.index;
							const tone = awaitingConfirm
								? done
									? "bg-primary-content"
									: current
										? "bg-primary-content/60"
										: "bg-primary-content/25"
								: done
									? "bg-primary"
									: current
										? "bg-primary/60"
										: "bg-paper-300";
							return (
								<span
									key={s.key}
									className={`h-1.5 w-1.5 rounded-full transition-colors duration-fast ${tone}`}
								/>
							);
						})}
					</span>
				) : null}
				{studioStatus.pendingCount > 0 ? (
					<span className="rounded-full bg-paper-100 px-1.5 text-ink">{studioStatus.pendingCount}</span>
				) : null}
			</PlainButton>

			<div className="flex shrink-0 items-center gap-1">
				{hasTools ? (
					// 版本/一致性/导出收进溢出菜单：所有视口可达（<sm 原先整组消失，导出无入口）
					<MenuButton label="工作台工具" menuLabel="工作台工具菜单" title="版本 / 一致性 / 导出">
						{regenerateInMenu && onRegenerate ? (
							<MenuItem
								icon="sparks"
								onClick={onRegenerate}
								disabled={!canStart || generatePending || generateDisabled}
								aria-label="重新生成（先确认）"
							>
								重新生成…
							</MenuItem>
						) : null}
						{onRestorePrevious ? (
							<MenuItem
								icon="refresh-cw"
								onClick={onRestorePrevious}
								disabled={restoreBusy || isGenerating}
								aria-label="恢复上一版"
							>
								{restoreBusy ? "恢复中…" : "恢复上一版"}
							</MenuItem>
						) : null}
						{previousDownloadUrl ? (
							<MenuLink icon="download" href={previousDownloadUrl} download target="_blank" rel="noopener">
								下载上一版成片
							</MenuLink>
						) : null}
						{onOpenVersions ? (
							<MenuItem icon="clock-3" onClick={onOpenVersions} aria-label="打开版本对比">
								版本对比
							</MenuItem>
						) : null}
						{onExport ? (
							<MenuItem
								icon="download"
								onClick={onExport}
								disabled={exportBusy || isGenerating}
								aria-label="导出 Webtoon 长图"
							>
								{exportBusy ? "导出中…" : "导出 Webtoon"}
							</MenuItem>
						) : null}
						{onExportEditorial ? (
							<MenuItem
								icon="download"
								onClick={onExportEditorial}
								disabled={exportBusy || isGenerating}
								aria-label="导出剪辑素材包"
							>
								{exportBusy ? "导出中…" : "导出剪辑包 (ZIP + FCPXML)"}
							</MenuItem>
						) : null}
					</MenuButton>
				) : null}

				{/* 恢复 / 取消只在收件箱；这里只放生成和停止 */}
				{isGenerating ? (
					<Button
						variant="ghost"
						size="sm"
						className={`${chromeBtn} text-error-fg`}
						onClick={onCancel}
					>
						<SvgIcon name="stop" size={14} />
						停止
					</Button>
				) : null}
				{showMainGenerate && onGenerate ? (
					// 禁用的按钮收不到 hover：原因挂在外层，悬停也能看到
					<span className="inline-flex" title={generateDisabledReason}>
						<Button
							variant={finished ? "secondary" : "primary"}
							size="sm"
							className={chromeBtn}
							onClick={onGenerate}
							disabled={generateDisabled || generatePending}
							aria-busy={generatePending}
							aria-describedby={generatePending ? "generate-pending-reason" : undefined}
						>
							{generatePending ? (
								<span className="spinner-doodle h-3.5 w-3.5" aria-hidden="true" />
							) : (
								<SvgIcon name="sparks" size={14} />
							)}
							{generatePending
								? pendingSeconds >= SLOW_START_SECONDS
									? `仍在连接模型… ${pendingSeconds}s`
									: "正在创建…"
								: generateLabel}
						</Button>
						{generatePending ? (
							<span id="generate-pending-reason" className="sr-only">
								{generateDisabledReason}
							</span>
						) : null}
					</span>
				) : null}
				{finished && downloadUrl ? (
					<a
						href={downloadUrl}
						download
						// 成片在另一个源上：新标签打开，工作台留在原处
						target="_blank"
						rel="noopener"
						className={`${BUTTON_BASE} ${BUTTON_VARIANTS.primary} h-8 touch-target-dense ${chromeBtn}`}
					>
						<SvgIcon name="download" size={14} />
						下载成片
					</a>
				) : null}
			</div>
		</div>
		</>
	);
}
