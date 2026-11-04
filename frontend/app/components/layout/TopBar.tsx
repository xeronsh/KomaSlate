import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { projectsApi, universesApi } from "~/services/api";
import { useThemeStore } from "~/stores/themeStore";
import { useSettingsStore } from "~/stores/settingsStore";
import { projectQueryKeys } from "~/query/queryKeys";
import type { Project } from "~/types";
import { getProjectStatusMeta } from "~/features/projects/statusMeta";
import { Button } from "~/components/ui/Button";
import { clsx } from "clsx";
import { PlainButton } from "../../components/ui/PlainButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Wordmark } from "./Wordmark";

interface TopBarProps {
	projectId?: number;
	/** Centre slot (workbench status pill and run actions). */
	center?: ReactNode;
}

function ProjectDropdown({ currentId }: { currentId?: number }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// 整份项目列表（~55KB）只在用户要打开切换器时才拉：悬停/聚焦预取，标题来自已缓存的当前项目
	const [wanted, setWanted] = useState(false);
	const { data: projects } = useQuery({
		queryKey: projectQueryKeys.projects(),
		queryFn: () => projectsApi.list(),
		enabled: wanted || open,
	});
	const { data: currentProject } = useQuery({
		queryKey: projectQueryKeys.project(currentId ?? 0),
		queryFn: () => projectsApi.get(currentId as number),
		enabled: (currentId ?? 0) > 0,
	});

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	const list = (projects ?? []) as Project[];
	const currentTitle =
		(currentProject as Project | undefined)?.title || list.find((p) => p.id === currentId)?.title || "项目";

	return (
		// min-w-12 ≥ 按钮 min-content（两枚 shrink-0 图标 + gap + padding），
		// 否则窄屏下按钮盒溢出 wrapper 叠印到 nav 上并抢走命中测试
		<div className="relative min-w-12" ref={ref}>
			{/* overflow-hidden 只能包按钮：放到外层会把下拉面板一起裁掉 */}
			<div className="overflow-hidden">
				<PlainButton
					onClick={() => setOpen(!open)}
					onPointerEnter={() => setWanted(true)}
					onFocus={() => setWanted(true)}
					className="touch-target-dense flex w-full max-w-24 items-center gap-1 rounded-md px-1.5 text-sm font-bold transition-colors duration-fast hover:bg-paper-200 sm:max-w-56"
					aria-expanded={open}
					aria-haspopup="listbox"
				>
					{/* 手机上标题只剩两三个字：装饰图标让位给标题 */}
					<SvgIcon name="storyboard" size={14} className="hidden flex-shrink-0 text-primary sm:block" />
					<span className="min-w-0 truncate" title={currentTitle}>
						{currentTitle}
					</span>
					{/* 16px：1.5 描边在 24 网格上缩到 12px 只剩 0.75px，看不清 */}
					<SvgIcon name="chevron-down" size={16} className={`flex-shrink-0 text-ink-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`} />
				</PlainButton>
			</div>

			{open && (
				<div
					className="animate-enter absolute left-0 top-full z-popover mt-1 max-h-80 w-64 overflow-y-auto overscroll-contain rounded-lg border border-line bg-paper-200 py-1 shadow-panel"
					role="listbox"
					aria-label="项目列表"
				>
					<Link
						to="/projects"
						onClick={() => setOpen(false)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-paper-300"
					>
						<SvgIcon name="projects" size={12} />
						全部项目
					</Link>
					<div className="my-1 border-t border-line" />
					{list.map((p) => {
						const st = getProjectStatusMeta(p.status);
						return (
							<Link
								key={p.id}
								to={`/project/${p.id}`}
								onClick={() => setOpen(false)}
								role="option"
								aria-selected={p.id === currentId}
								className={`flex items-center justify-between px-3 py-1.5 text-xs transition-colors duration-fast hover:bg-paper-300 ${
									p.id === currentId
										? "bg-primary/10 font-bold text-primary"
										: ""
								}`}
							>
								<span className="min-w-0 flex-1 truncate">{p.title}</span>
								<span
									className={`ml-1.5 flex-shrink-0 text-xs ${st.textCls}`}
								>
									{st.label}
								</span>
							</Link>
						);
					})}
					<div className="my-1 border-t border-line" />
					<Link
						to="/"
						onClick={() => setOpen(false)}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary transition-colors duration-fast hover:bg-paper-300"
					>
						<SvgIcon name="plus" size={12} />
						新建项目
					</Link>
				</div>
			)}
		</div>
	);
}

function UniverseChip({ projectId }: { projectId: number }) {
	const { data: project } = useQuery({
		queryKey: projectQueryKeys.project(projectId),
		queryFn: () => projectsApi.get(projectId),
		enabled: projectId > 0,
	});
	const universeId = project?.universe_id ?? null;
	const chapterNumber = project?.chapter_number ?? null;
	const chapterTitle = project?.chapter_title ?? null;

	const { data: universe } = useQuery({
		queryKey: ["universe-chip", universeId],
		queryFn: () => universesApi.get(universeId!),
		enabled: Boolean(universeId),
		staleTime: 60_000,
	});

	if (!universeId) return null;

	const label =
		chapterNumber != null
			? `${universe?.name ?? "宇宙"} · 第${chapterNumber}章`
			: (universe?.name ?? "宇宙");

	return (
		<Link
			to={`/universes/${universeId}`}
			className="touch-target-dense hidden max-w-44 items-center gap-1 truncate rounded-full border border-primary/25 bg-primary/10 px-2 text-xs font-bold text-primary transition-colors duration-fast hover:bg-primary/15 sm:inline-flex"
			title={chapterTitle || universe?.name || "IP 宇宙"}
		>
			<SvgIcon name="sparks" size={12} className="shrink-0" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

function NavLink({
	to,
	label,
	icon,
	active,
}: {
	to: string;
	label: string;
	icon: ReactNode;
	active: boolean;
}) {
	return (
		<Link
			to={to}
			aria-current={active ? "page" : undefined}
			className={clsx(
				"touch-target-dense relative inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold transition-colors duration-fast",
				// 选中态不铺底：文字转为 ink，下方一条 1px 群青细线作颜色之外的第二通道
				"after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:h-px after:rounded-full after:bg-primary after:transition-opacity after:duration-fast",
				active ? "text-ink after:opacity-70" : "text-ink-muted after:opacity-0 hover:text-ink",
			)}
		>
			{icon}
			<span className="hidden sm:inline">{label}</span>
		</Link>
	);
}

export function TopBar({ projectId, center }: TopBarProps) {
	const { theme, toggleTheme } = useThemeStore();
	const isDark = theme === "dark";
	const { openModal: openSettingsModal } = useSettingsStore();
	const { pathname } = useLocation();

	const chromeBtn =
		"touch-target-dense !h-8 gap-1 !px-2 transition-colors duration-fast";

	const homeActive = pathname === "/";
	const projectsActive =
		pathname.startsWith("/projects") || pathname.startsWith("/project/");
	const universesActive = pathname.startsWith("/universes");

	return (
		<header
			className="chrome-row z-popover gap-1.5 border-b border-line bg-paper-100 px-2 sm:gap-2 sm:px-3"
			data-shell="topbar"
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<Link
					to="/"
					className="touch-target-dense inline-flex items-center gap-1.5 rounded-md px-1.5 text-base font-bold tracking-tight text-ink"
					aria-label="KomaSlate 首页"
				>
					<Wordmark className="h-5 w-auto" />
				</Link>

				{projectId ? (
					<>
						<span className="text-ink-faint" aria-hidden="true">
							/
						</span>
						<ProjectDropdown currentId={projectId} />
						<UniverseChip projectId={projectId} />
					</>
				) : null}

				<nav
					className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5"
					aria-label="主导航"
				>
					<NavLink
						to="/"
						label="创作"
						active={homeActive}
						icon={<SvgIcon name="home" size={14} />}
					/>
					<NavLink
						to="/projects"
						label="项目"
						active={projectsActive && !homeActive}
						icon={
							<SvgIcon name="projects" size={14} />
						}
					/>
					<NavLink
						to="/universes"
						label="宇宙"
						active={universesActive}
						icon={<SvgIcon name="globe" size={14} />}
					/>
				</nav>
			</div>

			<div className="flex min-w-0 flex-1 justify-center">{center}</div>

			<div className="flex shrink-0 items-center gap-0.5">
				<Button
					variant="ghost"
					size="sm"
					className={chromeBtn}
					onClick={toggleTheme}
					aria-label={isDark ? "切换亮色主题" : "切换暗色主题"}
					title={isDark ? "切换亮色" : "切换暗色"}
				>
					{isDark ? (
						<SvgIcon name="sun" size={16} />
					) : (
						<SvgIcon name="moon" size={16} />
					)}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className={chromeBtn}
					onClick={openSettingsModal}
					title="设置"
					aria-label="设置"
				>
					<SvgIcon name="settings" size={16} />
				</Button>
			</div>
		</header>
	);
}
