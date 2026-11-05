import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, universesApi } from "~/services/api";
import { Button } from "~/components/ui/Button";
import { TopBar } from "~/components/layout/TopBar";
import { PageBody, PageShell } from "~/components/layout/PageShell";
import { PageContent, PageHeader } from "~/components/layout/PageHeader";
import { DeskSection } from "~/components/layout/DeskSection";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { CreationSettings, type CreationSettingsValue } from "~/features/projects/CreationSettings";
import { toast } from "~/utils/toast";
import type { CreateProjectPayload } from "~/types";
import { PlainButton } from "~/components/ui/PlainButton";
import { getProjectStatusMeta } from "~/features/projects/statusMeta";

const AssetDrawer = lazy(() =>
	import("~/components/panels/AssetDrawer").then((module) => ({ default: module.AssetDrawer })),
);
const HistoryDrawer = lazy(() =>
	import("~/components/panels/HistoryDrawer").then((module) => ({ default: module.HistoryDrawer })),
);

const DEFAULT_SKILL_ID = "story-anime";
const DEFAULT_STYLE = "anime";

const EXAMPLE_PROMPTS = [
	"一个灯塔管理员发现了一张会发光的地图，地图上的岛屿每晚都会移动",
	"雨夜阁楼里，老修表匠在暖黄台灯下修复一枚停摆多年的铜怀表，桌角蜷着银白小猫",
	"末班地铁上，一只橘猫带着失忆的女孩寻找她丢失的名字",
];

export function HomePage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const queryClient = useQueryClient();
	const requestedUniverseId = Number(searchParams.get("universeId"));
	const requestedChapterNumber = Number(searchParams.get("chapterNumber"));
	const [story, setStory] = useState("");
	const [creationMode, setCreationMode] = useState<"review" | "quick">("review");
	const [settings, setSettings] = useState<CreationSettingsValue>(() => ({
		style: DEFAULT_STYLE,
		universeId: Number.isFinite(requestedUniverseId) && requestedUniverseId > 0 ? requestedUniverseId : null,
		characterHints: "",
		referenceFiles: [],
	}));
	const selectedUniverseId = settings.universeId;
	const [assetsOpen, setAssetsOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);

	useEffect(() => {
		setSettings((current) => ({
			...current,
			universeId: Number.isFinite(requestedUniverseId) && requestedUniverseId > 0 ? requestedUniverseId : null,
		}));
	}, [requestedUniverseId]);

	const { data: projects = [] } = useQuery({
		queryKey: ["projects"],
		queryFn: () => projectsApi.list(),
	});
	const recentProjects = [...projects]
		.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
		.slice(0, 3);

	const { data: universes = [] } = useQuery({
		queryKey: ["universes"],
		queryFn: () => universesApi.list(),
	});
	const selectedUniverse = universes.find((universe) => universe.id === selectedUniverseId);
	const chapterNumber = selectedUniverseId == null
		? null
		: Number.isFinite(requestedChapterNumber) && requestedChapterNumber > 0
			? requestedChapterNumber
			: (selectedUniverse?.projects_count ?? 0) + 1;

	const createMutation = useMutation({
		mutationFn: async (payload: CreateProjectPayload) => {
			const project = await projectsApi.create(payload);
			try {
				await Promise.all(
					settings.referenceFiles.map((file) => projectsApi.uploadReference(project.id, file)),
				);
			} catch (cause) {
				// The project exists; don't fail the whole creation over a reference image.
				toast.error({
					title: "参考图上传失败",
					message: cause instanceof Error ? cause.message : "可稍后在项目中重新上传。",
				});
			}
			return project;
		},
		onSuccess: (project) => {
			void queryClient.invalidateQueries({ queryKey: ["projects"] });
			navigate("/project/" + project.id + "?autoStart=true&skill=" + DEFAULT_SKILL_ID);
		},
	});

	const createProject = () => {
		const trimmed = story.trim();
		if (!trimmed || createMutation.isPending) return;
		const title = trimmed.split("\n")[0].slice(0, 50) || "未命名项目";
		createMutation.mutate({
			title,
			story: trimmed,
			style: settings.style,
			target_shot_count: settings.shotCount,
			character_hints: settings.characterHints.split("\n").map((hint) => hint.trim()).filter(Boolean),
			creation_mode: creationMode,
			universe_id: selectedUniverseId,
			chapter_number: chapterNumber,
			chapter_title: selectedUniverseId && chapterNumber ? title : null,
			skill_id: DEFAULT_SKILL_ID,
			text_provider_override: null,
			image_provider_override: null,
			video_provider_override: null,
		});
	};

	const navChip = "press touch-target-dense inline-flex items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors duration-fast ";

	return (
		<PageShell data-shell="home">
			<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
				<TopBar />
				{assetsOpen ? <Suspense fallback={null}><AssetDrawer open onClose={() => setAssetsOpen(false)} /></Suspense> : null}
				{historyOpen ? <Suspense fallback={null}><HistoryDrawer open onClose={() => setHistoryOpen(false)} onNavigate={(id) => navigate("/project/" + id)} /></Suspense> : null}
				<PageBody className="workbench-surface">
					<PageContent className="min-h-full gap-4 sm:py-5">
						<PageHeader
							title="把一句想法，拍成可精修的分镜台本"
							actionsAlign="title"
							actions={
							<div className="flex flex-wrap gap-1.5" aria-label="创作台工具">
								<PlainButton className={navChip + (historyOpen ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-ink-muted hover:border-border-strong hover:text-ink")} onClick={() => setHistoryOpen((open) => !open)} aria-pressed={historyOpen}>
									<SvgIcon name="clock-3" size={14} />历史
								</PlainButton>
								<PlainButton className={navChip + (assetsOpen ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-ink-muted hover:border-border-strong hover:text-ink")} onClick={() => setAssetsOpen((open) => !open)} aria-pressed={assetsOpen}>
									<SvgIcon name="archive" size={14} />资产
								</PlainButton>
							</div>
							}
						/>

						<div className="flex w-full flex-col gap-5" data-shell="create-desk">
							<DeskSection
								icon={<SvgIcon name="pencil" size={16} />}
								title="故事创意"
								meta={
									<span className="inline-flex items-center gap-2">
										<span className="font-mono tabular-nums">{story.length}/5000</span>
										<kbd className="hidden rounded-sm border border-line bg-paper-100 px-1.5 py-0.5 text-xs text-ink-muted sm:inline-block">
											<span className="font-mono">⌘/Ctrl+↵</span> 开始
										</kbd>
									</span>
								}
								className="card-doodle min-h-80 bg-surface p-3 sm:min-h-96 sm:p-4"
							>
								<div className="flex min-h-0 flex-1 flex-col">
									<textarea
										id="story-input"
										className="input-doodle min-h-32 w-full flex-1 resize-y bg-paper-100/90 p-3 text-base leading-normal sm:min-h-48 sm:p-4"
										placeholder="写下一个故事想法、人物、冲突或你脑海里的画面……"
										value={story}
										onChange={(event) => setStory(event.target.value)}
										onKeyDown={(event) => {
											if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
												event.preventDefault();
												createProject();
											}
										}}
										disabled={createMutation.isPending}
										aria-label="输入你的故事创意"
										maxLength={5000}
										rows={4}
										name="story"
										autoComplete="off"
										spellCheck
									/>
									{!story ? (
										<div className="mt-2.5 flex flex-col gap-1.5" aria-label="示例提示">
											<span className="text-xs text-ink-muted">试试这些开头：</span>
											<div className="grid gap-1.5 sm:grid-cols-3">
												{EXAMPLE_PROMPTS.map((prompt) => (
													<PlainButton
														key={prompt}
														className="press touch-target-dense rounded-md border border-line bg-paper-100/70 p-2.5 text-left text-xs leading-relaxed text-ink-muted transition-colors duration-fast hover:border-border-strong hover:bg-paper-200/50 hover:text-ink"
														onClick={() => setStory(prompt)}
													>
														{prompt}
													</PlainButton>
												))}
											</div>
										</div>
									) : null}
									{story.length > 4500 ? <p className="m-0 mt-1 text-xs font-bold text-warning-fg">还可输入 {5000 - story.length} 字</p> : null}
								</div>

								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
									<div className="flex min-w-0 flex-1 flex-col gap-1.5" aria-label="创作模式">
										<span className="label text-ink-muted">选择创作模式</span>
										<div className="grid grid-cols-2 gap-2">
											{[
												{ value: "review", label: "逐步确认", description: "每个阶段由你确认", icon: "check" },
												{ value: "quick", label: "自动确认", description: "阶段自动通过，一口气生成", icon: "zap" },
											].map((mode) => {
												const active = creationMode === mode.value;
												return (
													<PlainButton
														key={mode.value}
														className={"press flex min-h-14 min-w-0 flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-2.5 text-left text-xs font-bold sm:px-3 " + (active ? "border-primary bg-primary/10 text-primary ring-1 ring-inset ring-primary" : "border-line bg-surface text-ink-muted hover:border-border-strong hover:text-ink")}
														onClick={() => setCreationMode(mode.value as "review" | "quick")}
														aria-pressed={active}
													>
														<span className="inline-flex items-center gap-1.5 font-semibold text-sm"><SvgIcon name={mode.icon as "check" | "zap"} size={14} />{mode.label}</span>
														<span className={"text-left text-xs font-normal " + (active ? "text-ink" : "text-ink-muted")}>{mode.description}</span>
													</PlainButton>
												);
											})}
										</div>
									</div>
									<Button
										variant="primary"
										size="md"
										className="touch-target w-full shrink-0 justify-center gap-2 sm:w-auto"
										onClick={createProject}
										disabled={!story.trim() || createMutation.isPending}
										loading={createMutation.isPending}
									>
										{!createMutation.isPending ? <SvgIcon name="send" size={16} /> : null}
										开始创作
									</Button>
								</div>
								<CreationSettings
									value={settings}
									onChange={setSettings}
									universes={universes}
									disabled={createMutation.isPending}
								/>
								{selectedUniverse ? <p className="m-0 text-xs text-ink-muted">将加入「{selectedUniverse.name}」宇宙 · 第 {chapterNumber} 章</p> : null}
								{createMutation.error ? <p className="m-0 border-l-2 border-error bg-error/10 px-3 py-2 text-xs text-error-fg" role="alert">{createMutation.error.message || "创建项目失败，请重试。"}</p> : null}
							</DeskSection>
							{recentProjects.length > 0 ? (
								<section aria-labelledby="recent-projects" className="flex flex-col gap-2">
									<div className="flex items-center justify-between">
										<h2 id="recent-projects" className="m-0 text-sm text-ink-muted">最近项目</h2>
										<Link to="/projects" className="touch-target-dense inline-flex items-center px-2 text-sm text-primary hover:underline">全部项目</Link>
									</div>
									<ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
										{recentProjects.map((project) => {
											const status = getProjectStatusMeta(project.status);
											return (
												<li key={project.id}>
													<Link to={"/project/" + project.id} className="card-doodle press flex touch-target items-center justify-between gap-2 bg-surface px-3 py-2.5">
														<span className="truncate text-sm font-semibold text-ink">{project.title}</span>
														<span className={"shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold " + status.badgeCls}>{status.label}</span>
													</Link>
												</li>
											);
										})}
									</ul>
								</section>
							) : null}
						</div>
					</PageContent>
				</PageBody>
			</div>
		</PageShell>
	);
}
