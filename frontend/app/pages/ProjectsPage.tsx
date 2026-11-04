import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "~/components/layout/TopBar";
import { Button } from "~/components/ui/Button";
import { EmptyState as SharedEmptyState } from "~/components/ui/EmptyState";
import { PageBody, PageShell } from "~/components/layout/PageShell";
import { PageContent, PageHeader } from "~/components/layout/PageHeader";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import { projectsApi, type ProjectListPage } from "~/services/api";
import { cleanupDeletedProjectCaches } from "~/features/projects/deleteProject";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";
import type { Project } from "~/types";
import { getProjectStatusMeta } from "~/features/projects/statusMeta";
import { IconButton } from "../components/ui/IconButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { MonoRuns } from "~/components/ui/MonoRuns";
import { styleLabel } from "~/features/projects/styleCategories";


function formatDate(value: string | null | undefined) {
	if (!value) return "未知";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "未知";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function errorMessage(error: unknown, fallback: string) {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return fallback;
}

export function ProjectsPage() {
	const queryClient = useQueryClient();
	const [deleteTarget, setDeleteTarget] = useState<number[] | null>(null);
	const [selectedIds, setSelectedIds] = useState<number[]>([]);
	const [selecting, setSelecting] = useState(false);

	const [pageLimit, setPageLimit] = useState(PAGE_SIZE);

	const {
		data: projects,
		isLoading,
		isFetching,
		error,
	} = useQuery<ProjectListPage>({
		// 前缀仍是 ["projects"]：所有 invalidate(["projects"]) 都会刷新当前页
		queryKey: ["projects", { limit: pageLimit }],
		queryFn: () => projectsApi.listPage(pageLimit),
		// 加载更多时保留已显示的行，避免整表闪回骨架
		placeholderData: (previous) => previous,
		retry: 1,
	});

	const visibleProjects = projects ?? [];
	const totalCount = projects?.total ?? visibleProjects.length;
	const loadedReadyCount = useMemo(
		() => visibleProjects.filter((project) => project.status === "ready").length,
		[visibleProjects],
	);
	const completedCount = projects?.readyTotal ?? loadedReadyCount;
	const hasMore = totalCount > visibleProjects.length;
	const loadingMore = Boolean(isFetching) && hasMore;
	const loadMore = () => {
		if (loadingMore) return;
		setPageLimit((limit) => limit + PAGE_SIZE);
	};
	const loadMoreRef = useRef(loadMore);
	loadMoreRef.current = loadMore;
	const sentinelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const node = sentinelRef.current;
		if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
			},
			{ rootMargin: "320px 0px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [hasMore, visibleProjects.length]);
	const selectedCount = selectedIds.length;
	const allSelected =
		visibleProjects.length > 0 && selectedCount === visibleProjects.length;

	useEffect(() => {
		if (!error) return;
		toast.error({
			title: "加载项目列表失败",
			message: errorMessage(error, "无法获取项目列表"),
			actions: [
				{
					label: "重试",
					onClick: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
				},
			],
		});
	}, [error, queryClient]);

	useEffect(() => {
		if (!projects) return;
		const ids = new Set(projects.map((project) => project.id));
		setSelectedIds((current) => current.filter((id) => ids.has(id)));
	}, [projects]);

	const deleteMutation = useMutation({
		mutationFn: (ids: number[]) => projectsApi.deleteMany(ids),
		onSuccess: (_, deletedIds) => {
			cleanupDeletedProjectCaches(queryClient, deletedIds);
			setSelectedIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
			setDeleteTarget(null);
			toast.success({
				title: "删除成功",
				message: deletedIds.length > 1 ? "项目已批量删除" : "项目已删除",
			});
		},
		onError: (error: Error | ApiError) => {
			toast.error({
				title: "删除失败",
				message: errorMessage(error, "未知错误"),
			});
		},
	});

	const handleDeleteClick = (id: number) => {
		if (deleteMutation.isPending) return;
		setDeleteTarget([id]);
	};

	const handleBatchDeleteClick = () => {
		if (deleteMutation.isPending || selectedCount === 0) return;
		setDeleteTarget([...selectedIds]);
	};

	const handleToggleSelect = (projectId: number, checked: boolean) => {
		setSelectedIds((prev) =>
			checked
				? Array.from(new Set([...prev, projectId]))
				: prev.filter((id) => id !== projectId),
		);
	};

	const handleToggleSelectAll = (checked: boolean) => {
		setSelectedIds(checked ? visibleProjects.map((project) => project.id) : []);
	};

	const toggleSelecting = () => {
		setSelecting((on) => !on);
		setSelectedIds([]);
	};

	const handleConfirmDelete = () => {
		if (deleteTarget && deleteTarget.length > 0) {
			deleteMutation.mutate(deleteTarget);
		}
	};

	return (
		<PageShell className="text-ink" data-shell="projects-list">
			<TopBar />

			<PageBody className="workbench-surface">
				<PageContent className="gap-4 sm:gap-5 sm:py-5">
				<PageHeader
					eyebrow="作品库 · 项目"
					title="项目库"
					description="继续制作中的分镜工程，或从新想法开始拍摄"
					// 数据归标题（和宇宙页的「N 个」同一处、同一样式），右侧只放动作
					meta={visibleProjects.length > 0 ? `${totalCount} 个 · ${completedCount} 部成片` : undefined}
					actions={
						<>
							<Button
								variant="secondary"
								size="sm"
								onClick={toggleSelecting}
								disabled={visibleProjects.length === 0}
								aria-pressed={selecting}
							>
								{selecting ? "完成" : "选择"}
							</Button>
							<ButtonLink to="/" size="sm">
								<SvgIcon name="plus" size={14} />
								新建
							</ButtonLink>
						</>
					}
				/>

				{selecting ? (
				<section
					className="rounded-lg border border-line bg-surface"
					aria-label="项目批量操作"
				>
					<div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:justify-between">
						<label className="touch-target flex cursor-pointer select-none items-center gap-2 px-1.5 text-xs font-semibold text-ink-muted">
							<input
								type="checkbox"
								checked={allSelected}
								onChange={(event) => handleToggleSelectAll(event.target.checked)}
								disabled={visibleProjects.length === 0}
								className="checkbox checkbox-sm"
							/>
							<span>全选</span>
						</label>
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="border border-line bg-paper-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">
								{selectedCount > 0
									? `已选 ${selectedCount}`
									: "未选择"}
							</span>
							<Button variant="danger" size="sm"
								onClick={handleBatchDeleteClick}
								disabled={selectedCount === 0 || deleteMutation.isPending}
							>
								<SvgIcon name="trash-2" size={14} />
								批量删除（{selectedCount}）
							</Button>
						</div>
					</div>
				</section>
				) : null}

				<section className="min-h-0 flex-1" aria-label="项目列表">
					{isLoading ? (
						<LoadingState />
					) : error ? (
						<ErrorState
							onRetry={() =>
								queryClient.invalidateQueries({ queryKey: ["projects"] })
							}
						/>
					) : visibleProjects.length === 0 ? (
						<EmptyState />
					) : (
						<div className="overflow-hidden rounded-lg border border-line bg-surface">
							{/* 表头只服务 sm+ 的表格网格；<sm 是卡片式行，表头隐藏 */}
							<div className={HEADER_CLASS + (selecting ? ROW_COLS_SELECTING : ROW_COLS)}>
								{selecting ? <span /> : null}
								<span>项目</span>
								<span>状态</span>
								<span>更新</span>
								<span className="text-right">操作</span>
							</div>
							<div className="divide-y divide-ink/10">
								{visibleProjects.map((project) => (
									<ProjectRow
										key={project.id}
										project={project}
										selecting={selecting}
										selected={selectedIds.includes(project.id)}
										onSelectedChange={(checked) =>
											handleToggleSelect(project.id, checked)
										}
										onDelete={() => handleDeleteClick(project.id)}
									/>
								))}
							</div>
							{hasMore ? (
								<div
									ref={sentinelRef}
									className="flex items-center justify-center border-t border-line px-3 py-2"
								>
									<Button
										variant="secondary"
										size="sm"
										onClick={loadMore}
										disabled={loadingMore}
										aria-busy={loadingMore}
									>
										{loadingMore
											? "加载中…"
											: `加载更多（还有 ${totalCount - visibleProjects.length} 个）`}
									</Button>
								</div>
							) : null}
						</div>
					)}
				</section>
				</PageContent>
			</PageBody>

			<ConfirmModal
				isOpen={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				onConfirm={handleConfirmDelete}
				title="删除项目"
				message={`确定要删除选中的${deleteTarget ? deleteTarget.length : 0}个项目吗？删除后将无法恢复。`}
				confirmText="删除"
				cancelText="取消"
				variant="danger"
				isLoading={deleteMutation.isPending}
			/>
		</PageShell>
	);
}

const ROW_COLS = "sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2.75rem]";
const ROW_COLS_SELECTING = "sm:grid-cols-[2.75rem_minmax(0,1fr)_7rem_7rem_2.75rem]";
// 真实行与骨架行共用：骨架用同一套网格、内边距和行内元素（文字透明），两者高度天然一致
const PAGE_SIZE = 20;
const ROW_CLASS = "grid min-h-20 items-start gap-x-2 gap-y-1 px-2 py-3 sm:items-center sm:gap-3 sm:px-3 sm:py-4 ";
const HEADER_CLASS = "hidden border-b border-line bg-paper-200/70 py-1.5 label text-ink-muted sm:grid sm:gap-3 sm:px-3 ";

function ProjectRow({
	project,
	selecting,
	selected,
	onSelectedChange,
	onDelete,
}: {
	project: Project;
	selecting: boolean;
	selected: boolean;
	onSelectedChange: (checked: boolean) => void;
	onDelete: () => void;
}) {
	const status = getProjectStatusMeta(project.status);
	const story = project.story?.trim();

	return (
		// <sm 卡片式三列（勾选｜内容｜删除，状态行落到第二行）；sm+ 维持五列表格网格
		<article className={ROW_CLASS + " transition-colors duration-fast hover:bg-paper-200/55 " + (selecting ? "grid-cols-[auto_minmax(0,1fr)_auto] " + ROW_COLS_SELECTING : "grid-cols-[minmax(0,1fr)_auto] " + ROW_COLS)}>
			{selecting ? (
			<label className="touch-target flex cursor-pointer items-center justify-center rounded-md hover:bg-paper-200">
				<input
					type="checkbox"
					aria-label={`选择项目 ${project.title}`}
					checked={selected}
					onChange={(event) => onSelectedChange(event.target.checked)}
					className="checkbox checkbox-sm"
				/>
			</label>
			) : null}

			<Link
				to={`/project/${project.id}`}
				className="min-w-0 py-0.5 pr-2"
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<SvgIcon name="folder" size={14} className="shrink-0 text-primary" />
					{/* <sm 标题完整换行展示，sm+ 才单行截断 */}
					<h2 className="m-0 break-words text-sm font-bold sm:truncate">
						{project.title}
					</h2>
				</div>
				<p className="m-0 mt-0.5 truncate text-xs text-ink-muted">
					{story || "尚未填写故事内容"}
				</p>
				<div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold text-ink-muted">
					<span>{styleLabel(project.style) ?? "未设风格"}</span>
					<span className="tabular-nums">
						{project.target_shot_count ? `计划 ${project.target_shot_count} 镜头` : "镜头数自动"}
					</span>
					{project.creation_mode ? (
						<span>{/* 与 useRunController 一致：只有 quick 自动过关，其余（review / 旧数据 story）都逐步确认 */}
							{project.creation_mode === "quick" ? "自动确认" : "逐步确认"}</span>
					) : null}
				</div>
			</Link>

			{/* <sm 状态胶囊+时间戳合并为一行小字；sm+ 用 contents 还原为两个独立网格单元 */}
			<div className={(selecting ? "col-start-2" : "col-start-1") + " row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:contents"}>
				<span
					className={`inline-flex min-h-7 items-center justify-center rounded-full border px-2 text-xs font-bold ${status.badgeCls}`}
				>
					{status.label}
				</span>

				<span className="text-xs text-ink-muted">
					<MonoRuns text={formatDate(project.updated_at)} />
				</span>
			</div>

			<IconButton
				className={(selecting ? "col-start-3" : "col-start-2") + " row-start-1 justify-self-end text-ink-muted hover:bg-error-bg hover:text-error-fg focus-visible:text-error-fg sm:col-auto sm:row-auto"}
				onClick={onDelete}
				aria-label={`删除项目 ${project.title}`}
				title="删除"
			>
				<SvgIcon name="trash-2" size={16} />
			</IconButton>
		</article>
	);
}

/**
 * 骨架行：与 ProjectRow 同结构（同网格、同字号行盒、同胶囊和按钮尺寸），文字透明、
 * 换成网点条。数据到达时表头、行高都不变，零布局位移（DESIGN.md §5 States）。
 */
function LoadingState() {
	return (
		<div
			className="overflow-hidden rounded-lg border border-line bg-surface"
			role="status"
			aria-busy="true"
			data-testid="projects-skeleton"
		>
			<span className="sr-only">正在加载项目…</span>
			<div aria-hidden="true">
				<div className={HEADER_CLASS + ROW_COLS}>
					<span>项目</span>
					<span>状态</span>
					<span>更新</span>
					<span className="text-right">操作</span>
				</div>
				<div className="divide-y divide-ink/10">
					{SKELETON_ROWS.map((width, row) => (
						<div key={row} className={ROW_CLASS + "grid-cols-[minmax(0,1fr)_auto] " + ROW_COLS}>
							<div className="min-w-0 py-0.5 pr-2">
								<div className="flex min-w-0 items-center gap-1.5">
									<span className="skeleton-line h-3.5 w-3.5 shrink-0" />
									<p className="m-0 text-sm font-bold">
										<SkeletonText className={width.title} />
									</p>
								</div>
								<p className="m-0 mt-0.5 text-xs">
									<SkeletonText className={width.story} />
								</p>
								<div className="mt-1 flex gap-1.5 text-xs font-semibold">
									<SkeletonText className="w-8" />
									<SkeletonText className="w-16" />
								</div>
							</div>
							<div className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:contents">
								<span className="skeleton-line inline-flex min-h-7 w-16 rounded-full text-xs" />
								<span className="text-xs">
									<SkeletonText className="w-20" />
								</span>
							</div>
							<span className="skeleton-line col-start-2 row-start-1 h-8 w-8 justify-self-end sm:col-auto sm:row-auto" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

const SKELETON_ROWS = [
	{ title: "w-24", story: "w-3/4" },
	{ title: "w-20", story: "w-2/3" },
	{ title: "w-28", story: "w-4/5" },
	{ title: "w-16", story: "w-3/5" },
];

/** 一行透明文字撑出真实行盒高度，条本身只占字高的中段 */
function SkeletonText({ className }: { className: string }) {
	return (
		<span className={"skeleton-line inline-block max-w-full align-top text-transparent select-none " + className}>
			占位
		</span>
	);
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
	return (
		<div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-error/25 bg-error/5 px-3 text-center">
			<div>
				<p className="m-0 text-md font-bold text-error-fg">
					项目列表加载失败
				</p>
				<p className="m-0 mt-0.5 text-xs text-ink-muted">
					服务暂时不可用，项目都还在，稍后重试
				</p>
			</div>
			<Button size="sm" onClick={onRetry}>
				重试
			</Button>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="min-h-40 rounded-lg border border-dashed border-line bg-paper-200/35">
			<SharedEmptyState
				icon={<SvgIcon name="page" size={20} />}
				title="还没有项目"
				description="写下一段故事，生成你的第一部漫剧"
				action={
					<ButtonLink to="/" size="sm">
						<SvgIcon name="plus" size={14} />
						新建项目
					</ButtonLink>
				}
			/>
		</div>
	);
}
