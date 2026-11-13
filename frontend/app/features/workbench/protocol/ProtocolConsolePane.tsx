import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Dialog";
import { PlainButton } from "~/components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { useEditorStore } from "~/stores/editorStore";
import {
	clearProtocolLogs,
	useProtocolLogs,
	type ProtocolFilter,
	type ProtocolLogChannel,
	type ProtocolLogEntry,
} from "./protocolLogStore";

interface ProtocolConsolePaneProps {
	projectId: number;
	onOpenHub?: () => void;
	onPingMcp?: () => void;
}

const FILTER_OPTIONS: ProtocolFilter[] = ["ALL", "RPC", "STDIO", "ERROR"];
const ROW_HEIGHT = 28;
const OVERSCAN = 8;

const CHANNEL_BADGE_CLASS: Record<ProtocolLogChannel, string> = {
	RPC: "bg-info-bg text-info-fg",
	STDIO: "bg-success-bg text-success-fg",
	ERROR: "bg-error-bg text-error-fg",
};

export function ProtocolConsolePane({
	projectId,
	onOpenHub,
	onPingMcp,
}: ProtocolConsolePaneProps) {
	const logs = useProtocolLogs(projectId);
	const filter = useEditorStore((s) => s.protocolFilter);
	const setFilter = useEditorStore((s) => s.setProtocolFilter);
	const [selectedEntry, setSelectedEntry] = useState<ProtocolLogEntry | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(220);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const h = entries[0]?.contentRect?.height;
			if (h && h > 0) setViewportHeight(h);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const filtered = useMemo(
		() => (filter === "ALL" ? logs : logs.filter((entry) => entry.channel === filter)),
		[filter, logs],
	);

	const totalHeight = filtered.length * ROW_HEIGHT;
	const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
	const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
	const endIndex = Math.min(filtered.length, startIndex + visibleCount);
	const visibleRows = filtered.slice(startIndex, endIndex);

	const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
		const el = event.currentTarget;
		setScrollTop(el.scrollTop);
		if (el.clientHeight > 0 && el.clientHeight !== viewportHeight) {
			setViewportHeight(el.clientHeight);
		}
	};

	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden bg-surface"
			aria-label="MCP JSON-RPC 与 CLI 协议终端"
			data-testid="protocol-console-pane"
		>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper-200 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="font-mono text-xs font-semibold text-ink">MCP &amp; CLI</span>
					<span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-muted">
						{filtered.length}
					</span>
				</div>

				<div className="flex items-center gap-1">
					<div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
						{FILTER_OPTIONS.map((option) => (
							<PlainButton
								key={option}
								onClick={() => setFilter(option)}
								aria-pressed={filter === option}
								className={`rounded-sm px-1.5 py-0.5 font-mono text-xs transition-colors duration-fast ${
									filter === option
										? "bg-primary text-primary-content"
										: "text-ink-muted hover:bg-paper-200 hover:text-ink"
								}`}
							>
								{option}
							</PlainButton>
						))}
					</div>
					{onPingMcp ? (
						<Button size="xs" variant="ghost" onClick={onPingMcp} aria-label="探测 MCP 服务">
							Ping
						</Button>
					) : null}
					{onOpenHub ? (
						<Button size="xs" variant="ghost" onClick={onOpenHub} aria-label="协议枢纽">
							<SvgIcon name="settings" size={12} />
						</Button>
					) : null}
					<Button
						size="xs"
						variant="ghost"
						onClick={() => clearProtocolLogs(projectId)}
						aria-label="清空协议日志"
					>
						清空
					</Button>
				</div>
			</div>

			{/* 虚拟滚动日志流 */}
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-paper-100 px-2 py-1"
				data-testid="protocol-virtual-list"
			>
				{filtered.length === 0 ? (
					<div className="flex h-full items-center justify-center text-xs text-ink-muted">
						暂无匹配的协议日志，触发运行、MCP 调用或 CLI 后将实时显示
					</div>
				) : (
					<div className="relative w-full" style={{ height: totalHeight }}>
						<div
							className="absolute left-0 right-0 top-0"
							style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}
						>
							{visibleRows.map((entry) => (
								<div
									key={entry.id}
									className="flex items-center border-b border-line"
									style={{ height: ROW_HEIGHT }}
								>
									<PlainButton
										onClick={() => setSelectedEntry(entry)}
										className="flex h-full w-full items-center gap-2 rounded-sm px-1.5 text-left transition-colors duration-fast hover:bg-paper-200"
										aria-label={`查看协议详情 ${entry.source} ${entry.summary}`}
									>
										<span className="shrink-0 font-mono text-xs text-ink-muted">
											{entry.timestamp}
										</span>
										<span
											className={`shrink-0 rounded-sm px-1 py-0.5 font-mono text-xs font-semibold ${CHANNEL_BADGE_CLASS[entry.channel]}`}
										>
											{entry.channel}
										</span>
										<span className="shrink-0 font-mono text-xs text-primary">
											{entry.source}
										</span>
										<span className="min-w-0 flex-1 truncate text-xs text-ink">
											{entry.summary}
										</span>
										{entry.latencyMs != null ? (
											<span className="shrink-0 font-mono text-xs text-ink-muted">
												{entry.latencyMs}ms
											</span>
										) : null}
									</PlainButton>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* JSON-RPC 详情抽屉（复用 ui/Dialog.tsx） */}
			<Dialog
				open={selectedEntry !== null}
				onClose={() => setSelectedEntry(null)}
				variant="sheet-right"
				labelledBy="protocol-entry-detail-title"
				className="flex w-full max-w-md flex-col p-4"
			>
				{selectedEntry ? (
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						<div className="flex items-center justify-between gap-2 border-b border-line pb-2">
							<div className="min-w-0">
								<h3 id="protocol-entry-detail-title" className="m-0 text-md font-semibold">
									协议报文详情
								</h3>
								<p className="m-0 font-mono text-xs text-ink-muted">
									{selectedEntry.timestamp} · {selectedEntry.channel} · {selectedEntry.source}
								</p>
							</div>
							<Button size="xs" variant="ghost" onClick={() => setSelectedEntry(null)}>
								关闭
							</Button>
						</div>
						<p className="m-0 text-sm text-ink">{selectedEntry.summary}</p>
						<pre className="m-0 min-h-0 flex-1 overflow-auto rounded-md border border-line bg-paper-200 p-3 font-mono text-xs text-ink">
							{JSON.stringify(selectedEntry.payload ?? { summary: selectedEntry.summary }, null, 2)}
						</pre>
					</div>
				) : null}
			</Dialog>
		</section>
	);
}
