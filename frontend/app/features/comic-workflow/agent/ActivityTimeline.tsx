import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Button } from "~/components/ui/Button";
import { PlainButton } from "~/components/ui/PlainButton";
import type { ActivityEntry, WarningGroup } from "./activityTimeline";
import { attachLiveStream, formatDuration, groupRepeatedWarnings } from "./activityTimeline";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { MonoRuns } from "~/components/ui/MonoRuns";
import type { LiveStream } from "./liveStream";
import { LiveCharCount, LiveStreamBody, LiveStreamRow, liveStatusLabel } from "./LiveStreamRow";
import { FeedbackReceiptCard } from "./FeedbackReceiptCard";
import "~/components/ui/icons/workbenchIcons";

/** 距底部小于这个值就算“在底部”，继续跟随。 */
const FOLLOW_SLACK = 24;

function StatusDot({ status }: { status: ActivityEntry["status"] }) {
	return (
		<span
			className={clsx(
				"mt-1.5 h-2 w-2 shrink-0 rounded-full",
				status === "running" && "animate-pulse bg-primary",
				status === "done" && "bg-ink/25",
				status === "error" && "bg-error",
			)}
			aria-hidden="true"
		/>
	);
}

/** `live`: this step's LLM call is streaming; its output shows inside the step. */
const EntryRow = memo(function EntryRow({ entry, live }: { entry: ActivityEntry; live?: LiveStream }) {
	const [open, setOpen] = useState(false);
	const expanded = open || entry.status === "running";

	if (entry.kind === "feedback" && entry.receipt) {
		return (
			<li className="py-1" data-activity="feedback">
				<FeedbackReceiptCard receipt={entry.receipt} />
			</li>
		);
	}

	if (entry.kind === "run" || entry.kind === "handoff") {
		return (
			<li className="flex items-center gap-2 py-1 text-xs text-ink-muted" data-activity={entry.kind}>
				<span className="h-px flex-1 bg-line" aria-hidden="true" />
				{entry.title}
				<span className="h-px flex-1 bg-line" aria-hidden="true" />
			</li>
		);
	}

	return (
		<li
			className="flex gap-2 py-1"
			data-activity={entry.kind}
			data-status={entry.status}
			{...(live ? { "data-testid": "live-stream", "aria-busy": true } : {})}
		>
			{entry.kind === "warning" ? (
				<SvgIcon name="triangle-alert" size={14} className="mt-0.5 shrink-0 text-warning-fg" />
			) : (
				<StatusDot status={entry.status} />
			)}
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-xs font-semibold text-ink-muted">
						{entry.kind === "user" ? "你" : entry.agentLabel}
						{live ? ` · ${liveStatusLabel(live)}` : entry.status === "running" ? " · 进行中" : entry.kind === "warning" ? " · 提醒" : null}
					</span>
					{live ? (
						<LiveCharCount stream={live} />
					) : entry.durationMs !== undefined ? (
						<span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
							{formatDuration(entry.durationMs)}
						</span>
					) : null}
				</div>
				<p
					className={clsx(
						"m-0 select-text whitespace-pre-wrap break-words text-sm",
						entry.kind === "error" ? "text-error-fg" : entry.kind === "step" || entry.kind === "warning" ? "font-medium" : "text-ink-muted",
					)}
				>
					{entry.title}
				</p>
				{entry.detail ? (
					<p className="m-0 text-xs text-ink-muted">
						<MonoRuns text={entry.detail} />
					</p>
				) : null}
				{entry.children.length > 0 ? (
					<>
						<PlainButton
							className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink"
							onClick={() => setOpen((v) => !v)}
							aria-expanded={expanded}
						>
							<SvgIcon name="chevron-right" size={12} className={clsx("transition-transform duration-fast", expanded && "rotate-90")} />
							{entry.children.length} 项细节
						</PlainButton>
						{/* 常驻 DOM，用 grid-rows 展开；收起时 inert，读屏与 Tab 都跳过 */}
						<div className="collapse-rows" data-open={expanded || undefined} {...(expanded ? {} : { inert: "" })}>
							<ul className="m-0 list-none space-y-0.5 border-l border-line pl-2">
								{entry.children.map((child) => (
									<li key={child.id} className="text-xs text-ink-muted first:mt-0.5">
										<span className="font-semibold">{child.label}</span>
										{child.content ? ` · ${child.content}` : null}
									</li>
								))}
							</ul>
						</div>
					</>
				) : null}
				{live ? <LiveStreamBody key={live.streamId} stream={live} /> : null}
			</div>
		</li>
	);
});

/** 连续的同类提醒：一行摘要 + ×N，展开逐条看。默认收起，顺序与原文不变。 */
const WarningGroupRow = memo(function WarningGroupRow({ group }: { group: WarningGroup }) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const count = group.items.length;
	return (
		<li className="flex gap-2 py-1" data-activity="warning-group" data-count={count}>
			<SvgIcon name="triangle-alert" size={14} className="mt-0.5 shrink-0 text-warning-fg" />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-xs font-semibold text-ink-muted">
						{group.agentLabel} · 提醒<span className="sr-only">，共 {count} 条</span>
					</span>
					<span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted" aria-hidden="true" data-testid="warning-count">
						×{count}
					</span>
				</div>
				<p className="m-0 select-text whitespace-pre-wrap break-words text-sm font-medium">{group.summary}</p>
				<PlainButton
					className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					aria-controls={listId}
				>
					<SvgIcon name="chevron-right" size={12} className={clsx("transition-transform duration-fast", open && "rotate-90")} />
					逐条查看 {count} 条
				</PlainButton>
				<div id={listId} className="collapse-rows" data-open={open || undefined} {...(open ? {} : { inert: "" })}>
					<ul className="m-0 list-none space-y-0.5 border-l border-line pl-2">
						{group.items.map((item) => (
							<li key={item.id} className="select-text text-xs text-ink-muted first:mt-0.5" data-activity="warning-item">
								{item.title}
							</li>
						))}
					</ul>
				</div>
			</div>
		</li>
	);
});

/**
 * 步骤时间线。默认跟随最新；用户上滑后停止跟随，出现“跳到最新”。
 */
export function ActivityTimeline({
	entries,
	live = null,
}: {
	entries: ActivityEntry[];
	live?: LiveStream | null;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [following, setFollowing] = useState(true);
	// 只依赖 live 的 agent/状态：流式文字逐帧变化时，已完成的行保持同一引用，memo 行不重渲
	const liveAgent = live?.agent ?? null;
	const liveStatus = live?.status ?? null;
	const { rows, host } = useMemo(() => {
		const attached = attachLiveStream(
			entries,
			liveAgent === null || liveStatus === null ? null : { agent: liveAgent, status: liveStatus },
		);
		return { rows: groupRepeatedWarnings(attached.entries), host: attached.host };
	}, [entries, liveAgent, liveStatus]);

	const scrollToBottom = () => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	};

	useLayoutEffect(() => {
		if (following) scrollToBottom();
	}, [entries, live, following]);

	// 流式文字逐帧长高时也跟随；用户上滑后（following=false）不打扰
	useEffect(() => {
		const el = scrollRef.current?.firstElementChild;
		if (!el || !following || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => scrollToBottom());
		observer.observe(el);
		return () => observer.disconnect();
	}, [following]);

	// 内容变化（如展开细节）不影响跟随判断；只看用户滚动
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				className="h-full overflow-y-auto overscroll-contain px-3 py-1.5"
				data-testid="activity-scroll"
			>
				<ol className="m-0 list-none p-0" aria-label="活动时间线">
					{rows.map((row) =>
						row.kind === "warning-group" ? (
							<WarningGroupRow key={row.id} group={row} />
						) : (
							<EntryRow key={row.id} entry={row} />
						),
					)}
					{host && live ? (
						<EntryRow key={host.id} entry={host} live={live} />
					) : live ? (
						<LiveStreamRow key={live.streamId} stream={live} />
					) : null}
				</ol>
			</div>
			{following ? null : (
				<Button
					size="sm"
					variant="secondary"
					className="animate-fade-in absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 shadow-panel"
					onClick={() => {
						setFollowing(true);
						scrollToBottom();
					}}
				>
					<SvgIcon name="arrow-down" size={14} />
					跳到最新
				</Button>
			)}
		</div>
	);
}
