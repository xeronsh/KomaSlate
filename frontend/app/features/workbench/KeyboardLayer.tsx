import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Dialog } from "~/components/ui/Dialog";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { projectQueryKeys } from "~/query/queryKeys";
import { projectsApi } from "~/services/api";
import type { Character, Shot } from "~/types";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

export const SHORTCUTS: [keys: string, action: string][] = [
	["?", "打开这张快捷键表"],
	[`${MOD} K`, "命令面板：跳到某格、某个角色或切换项目"],
	["Enter", "在输入栏发送意见"],
	["Shift Enter", "输入栏换行"],
	["Esc", "关闭弹层或面板"],
	["Shift / ⌘ / Ctrl 点击", "多选卡片"],
	["Alt ← → ↑ ↓", "排序模式下移动选中的分镜"],
	["拖动空白 / 滚轮", "框选 / 平移画布"],
];

function isTyping(target: EventTarget | null) {
	const el = target as HTMLElement | null;
	return Boolean(el?.closest("input, textarea, select, [contenteditable='true']"));
}

export interface PaletteItem {
	id: string;
	group: string;
	label: string;
	hint?: string;
	run: () => void;
}

export function paletteItems(
	shots: Shot[],
	characters: Character[],
	projects: { id: number; title: string }[],
	currentProjectId: number,
	go: (path: string) => void,
): PaletteItem[] {
	const focus = (nodeId: string) => () => canvasEvents.emit("focus-workflow-node", { nodeId });
	return [
		...[...shots]
			.sort((a, b) => a.order - b.order)
			.map((shot) => ({
				id: `shot:${shot.id}`,
				group: "分镜",
				label: `S${String(shot.order).padStart(2, "0")}`,
				hint: shot.description ?? undefined,
				run: focus(`shot:${shot.id}`),
			})),
		...characters.map((character) => ({
			id: `character:${character.id}`,
			group: "角色",
			label: character.name,
			hint: character.description ?? undefined,
			run: focus(`character:${character.id}`),
		})),
		...projects
			.filter((project) => project.id !== currentProjectId)
			.map((project) => ({
				id: `project:${project.id}`,
				group: "切换项目",
				label: project.title || `项目 ${project.id}`,
				run: () => go(`/project/${project.id}`),
			})),
	];
}

export function matches(item: PaletteItem, query: string) {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return `${item.group} ${item.label} ${item.hint ?? ""}`.toLowerCase().includes(q);
}

/** 工作台的全局键盘层：? 快捷键表，⌘/Ctrl+K 命令面板。 */
export function KeyboardLayer({
	projectId,
	shots,
	characters,
}: {
	projectId: number;
	shots: Shot[];
	characters: Character[];
}) {
	const [open, setOpen] = useState<"help" | "palette" | null>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((current) => (current === "palette" ? null : "palette"));
				return;
			}
			if (event.key === "?" && !event.metaKey && !event.ctrlKey && !isTyping(event.target)) {
				event.preventDefault();
				setOpen("help");
			}
		};
		const offPalette = canvasEvents.on("open-command-palette", () => setOpen("palette"));
		window.addEventListener("keydown", onKey);
		return () => {
			offPalette();
			window.removeEventListener("keydown", onKey);
		};
	}, []);

	return (
		<>
			<Dialog open={open === "help"} onClose={() => setOpen(null)} labelledBy="shortcut-sheet-title" className="w-full max-w-md p-4">
				<h2 id="shortcut-sheet-title" className="m-0 mb-3 text-md font-bold">
					键盘快捷键
				</h2>
				<dl className="m-0 flex flex-col gap-2 text-sm">
					{SHORTCUTS.map(([keys, action]) => (
						<div key={keys} className="flex items-baseline gap-4">
							<dt className="w-36 shrink-0">
								<kbd className="rounded-sm border border-line-strong bg-paper-200 px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
							</dt>
							<dd className="m-0 text-ink-muted">{action}</dd>
						</div>
					))}
				</dl>
			</Dialog>
			{open === "palette" ? (
				<CommandPalette projectId={projectId} shots={shots} characters={characters} onClose={() => setOpen(null)} />
			) : null}
		</>
	);
}

function CommandPalette({
	projectId,
	shots,
	characters,
	onClose,
}: {
	projectId: number;
	shots: Shot[];
	characters: Character[];
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const { data: projects = [] } = useQuery({
		queryKey: projectQueryKeys.projects(),
		queryFn: projectsApi.list,
	});
	const items = useMemo(
		() => paletteItems(shots, characters, projects, projectId, navigate).filter((item) => matches(item, query)),
		[characters, navigate, projectId, projects, query, shots],
	);
	const current = Math.min(active, Math.max(0, items.length - 1));

	const choose = (item: PaletteItem | undefined) => {
		if (!item) return;
		onClose();
		item.run();
	};

	return (
		<Dialog open onClose={onClose} label="命令面板" initialFocusRef={inputRef} className="w-full max-w-lg p-0">
			<input
				ref={inputRef}
				role="combobox"
				aria-expanded
				aria-controls="command-palette-list"
				aria-activedescendant={items[current] ? `cmd-${items[current].id}` : undefined}
				aria-label="搜索分镜、角色或项目"
				placeholder="跳到分镜、角色，或切换项目…"
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
					setActive(0);
				}}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						const step = event.key === "ArrowDown" ? 1 : -1;
						setActive((current + step + items.length) % Math.max(1, items.length));
					} else if (event.key === "Enter") {
						event.preventDefault();
						choose(items[current]);
					}
				}}
				className="w-full border-0 border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
			/>
			<ul id="command-palette-list" role="listbox" aria-label="结果" className="m-0 max-h-80 list-none overflow-y-auto p-1">
				{items.length === 0 ? <li className="px-3 py-2 text-sm text-ink-muted">没有匹配的结果</li> : null}
				{items.map((item, index) => (
					<li
						key={item.id}
						id={`cmd-${item.id}`}
						role="option"
						aria-selected={index === current}
						onMouseEnter={() => setActive(index)}
						onClick={() => choose(item)}
						className={`flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-2 text-sm ${index === current ? "bg-primary/10 text-ink" : "text-ink"}`}
					>
						<span className="w-14 shrink-0 text-xs text-ink-muted">{item.group}</span>
						<span className="shrink-0 font-semibold">{item.label}</span>
						{item.hint ? <span className="min-w-0 truncate text-xs text-ink-muted">{item.hint}</span> : null}
					</li>
				))}
			</ul>
		</Dialog>
	);
}
