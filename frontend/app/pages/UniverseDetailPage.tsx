import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { universesApi } from "~/services/api";
import { SharedCharacterCard } from "~/components/universe/SharedCharacterCard";
import { EmptyState } from "~/components/ui/EmptyState";
import { DeskSection } from "~/components/layout/DeskSection";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { Input } from "~/components/ui/Input";
import { Modal } from "~/components/ui/Modal";
import { Select } from "~/components/ui/Select";
import { toast } from "~/utils/toast";
import { ApiError } from "~/types/errors";
import type { SharedCharacterRead, UniverseDetail } from "~/types";
import { PageBody, PageShell } from "~/components/layout/PageShell";
import { PageContent, PageHeader } from "~/components/layout/PageHeader";
import { TopBar } from "~/components/layout/TopBar";
import { IconButton } from "../components/ui/IconButton";
import { SvgIcon } from "~/components/ui/SvgIcon";

export function UniverseDetailPage() {
	const { universeId } = useParams<{ universeId: string }>();
	const queryClient = useQueryClient();
	const id = Number(universeId);
	const [editOpen, setEditOpen] = useState(false);
	const [createCharOpen, setCreateCharOpen] = useState(false);
	const [importProjectId, setImportProjectId] = useState("");
	const [editForm, setEditForm] = useState({
		name: "",
		description: "",
		world_setting: "",
		style_rules: "",
	});
	const [charForm, setCharForm] = useState({
		name: "",
		description: "",
		visual_notes: "",
		character_tags: "",
	});

	const { data: universe, isLoading, isError, error } = useQuery({
		queryKey: ["universe", id],
		queryFn: () => universesApi.get(id),
		enabled: !isNaN(id),
	});

	const removeProjectMutation = useMutation({
		mutationFn: (projectId: number) =>
			universesApi.removeProject(id, projectId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["universe", id] });
			queryClient.invalidateQueries({ queryKey: ["universes"] });
			toast.success({ title: "已移除", message: "项目已从宇宙移除" });
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			universesApi.update(id, {
				name: editForm.name.trim() || null,
				description: editForm.description || null,
				world_setting: editForm.world_setting || null,
				style_rules: editForm.style_rules || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["universe", id] });
			queryClient.invalidateQueries({ queryKey: ["universes"] });
			setEditOpen(false);
			toast.success({ title: "已保存", message: "宇宙设定已更新" });
		},
		onError: (error: Error) => {
			toast.error({ title: "保存失败", message: error.message });
		},
	});

	const createCharMutation = useMutation({
		mutationFn: () =>
			universesApi.createSharedCharacter(id, {
				name: charForm.name.trim(),
				description: charForm.description || null,
				visual_notes: charForm.visual_notes || null,
				character_tags: charForm.character_tags || null,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["universe", id] });
			setCreateCharOpen(false);
			setCharForm({
				name: "",
				description: "",
				visual_notes: "",
				character_tags: "",
			});
			toast.success({ title: "已创建", message: "共享角色已加入宇宙库" });
		},
		onError: (error: Error) => {
			toast.error({ title: "创建失败", message: error.message });
		},
	});

	const importMutation = useMutation({
		mutationFn: ({
			projectId,
			sharedId,
		}: {
			projectId: number;
			sharedId: number;
		}) => universesApi.importCharacter(projectId, sharedId),
		onSuccess: (char) => {
			toast.success({
				title: "已导入角色",
				message: `角色「${char.name}」已写入目标章节`,
			});
			queryClient.invalidateQueries({
				queryKey: ["characters", char.project_id],
			});
		},
		onError: (error: Error) => {
			toast.error({ title: "导入失败", message: error.message });
		},
	});

	if (isLoading) {
		return (
			<PageShell data-shell="universe-detail-loading">
				<TopBar />
				<div className="flex flex-1 items-center justify-center">
					<span className="spinner-doodle h-5 w-5 text-primary" aria-label="加载中" />
				</div>
			</PageShell>
		);
	}

	// 「宇宙不存在」只对应 404；其余失败是服务故障，给重试入口
	const isNotFound =
		isNaN(id) || (isError && error instanceof ApiError && error.status === 404);

	if (isNotFound) {
		return (
			<PageShell data-shell="universe-detail-missing">
				<TopBar />
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					<p className="m-0 text-sm text-ink-muted">宇宙不存在</p>
					<ButtonLink to="/universes" size="sm" variant="secondary">返回宇宙列表</ButtonLink>
				</div>
			</PageShell>
		);
	}

	if (isError || !universe) {
		return (
			<PageShell data-shell="universe-detail-error">
				<TopBar />
				<div className="flex flex-1 items-center justify-center p-4">
					<div className="flex min-h-40 w-full max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-error/25 bg-error/5 px-4 text-center">
						<div>
							<p className="m-0 text-md font-bold text-error-fg">
								宇宙加载失败
							</p>
							<p className="m-0 mt-0.5 text-xs text-ink-muted">
								服务暂时不可用，数据还在，稍后重试
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								onClick={() =>
									queryClient.invalidateQueries({ queryKey: ["universe", id] })
								}
							>
								重试
							</Button>
							<ButtonLink to="/universes" size="sm" variant="ghost">返回宇宙列表</ButtonLink>
						</div>
					</div>
				</div>
			</PageShell>
		);
	}

	const u = universe as UniverseDetail;
	const nextChapterNumber =
		u.chapters.length > 0
			? Math.max(...u.chapters.map((chapter) => chapter.chapter_number ?? 0)) + 1
			: 1;
	const createChapterHref = `/?universeId=${u.id}&chapterNumber=${nextChapterNumber}`;
	const defaultImportProjectId =
		u.chapters[0]?.project_id != null ? String(u.chapters[0].project_id) : "";

	const openEdit = () => {
		setEditForm({
			name: u.name,
			description: u.description || "",
			world_setting: u.world_setting || "",
			style_rules: u.style_rules || "",
		});
		setEditOpen(true);
	};

	const handleImport = (character: SharedCharacterRead) => {
		const projectId = Number(importProjectId || defaultImportProjectId);
		if (!Number.isFinite(projectId) || projectId <= 0) {
			toast.error({
				title: "请选择章节",
				message: "先在「导入到」下拉框选择目标章节",
			});
			return;
		}
		importMutation.mutate({ projectId, sharedId: character.id });
	};

	const chapterOptionLabel = (ch: (typeof u.chapters)[number]) =>
		`${ch.chapter_number != null ? `第${ch.chapter_number}章` : "未编号"} · ${
			ch.chapter_title || ch.project_title || "未命名"
		}`;

	return (
		<PageShell data-shell="universe-detail">
			<TopBar />

			<PageBody className="workbench-surface">
				<PageContent>
				<PageHeader
					eyebrow="宇宙详情"
					title={u.name}
					plainTitle
					description={
						u.description ||
						"尚未填写简介 · 可在右侧编辑设定"
					}
					meta={`${u.chapters.length} 章节 · ${u.shared_characters.length} 角色`}
					actions={
						<>
							<ButtonLink to="/universes" size="sm" variant="ghost">
								← 列表
							</ButtonLink>
							<Button size="sm" variant="ghost" onClick={openEdit}>
								<SvgIcon name="pencil" size={14} />
								编辑
							</Button>
							<ButtonLink to={createChapterHref} size="sm">
								<SvgIcon name="plus" size={14} />
								新建章节
							</ButtonLink>
						</>
					}
				/>


				{u.world_setting || u.style_rules ? (
					<div
						className={clsx(
							"grid gap-5",
							// 两段设定并存时桌面端并排，避免全宽长行难读
							u.world_setting && u.style_rules && "lg:grid-cols-2",
						)}
					>
						{u.world_setting ? (
							<DeskSection
								title="世界观设定"
								icon={<SvgIcon name="globe" size={16} />}
							>
								<p className="m-0 whitespace-pre-wrap text-sm text-ink-muted">
									{u.world_setting}
								</p>
							</DeskSection>
						) : null}

						{u.style_rules ? (
							<DeskSection
								title="统一风格规则"
								icon={<SvgIcon name="brush" size={16} />}
							>
								<p className="m-0 whitespace-pre-wrap text-sm text-ink-muted">
									{u.style_rules}
								</p>
							</DeskSection>
						) : null}
					</div>
				) : null}

				{/* 桌面端双栏：章节列表 7fr | 共享角色库 5fr；<lg 回落单列堆叠 */}
				<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
					<DeskSection
						title="章节列表"
						icon={<SvgIcon name="book-open" size={16} />}
						meta={`${u.chapters.length} 章节`}
					>
						{u.chapters.length === 0 ? (
							<EmptyState
								compact
								title="还没有章节"
								description="章节是宇宙里的一部作品，创建后进入画布开始生成"
								action={
									<ButtonLink to={createChapterHref} size="sm">新建章节</ButtonLink>
								}
							/>
						) : (
							<div className="flex flex-col gap-2">
								{[...u.chapters]
									.sort(
										(a, b) =>
											(a.chapter_number ?? 999) - (b.chapter_number ?? 999),
									)
									.map((ch) => (
										<div
											key={ch.id}
											className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-line bg-paper-200/50 px-2 py-1.5 transition-colors duration-fast hover:bg-paper-200"
										>
											<div className="flex min-w-0 items-center gap-2">
												{ch.chapter_number != null ? (
													<span className="badge-doodle bg-primary text-primary-content border-primary/30 text-xs px-2 py-0.5 shrink-0 font-bold tabular-nums">
														第{ch.chapter_number}章
													</span>
												) : (
													<span className="badge-doodle bg-paper-100/80 text-ink-muted border-line text-xs px-2 py-0.5 shrink-0">
														未编号
													</span>
												)}
												<Link
													to={`/project/${ch.project_id}`}
													className="truncate text-sm font-bold transition-colors duration-fast hover:text-primary"
												>
													{ch.chapter_title || ch.project_title || "未命名"}
												</Link>
												<span className="font-mono text-xs text-ink-muted">
													#{ch.project_id}
												</span>
												{!ch.is_main_story ? (
													<span className="badge-doodle bg-paper-100/80 text-ink-muted border-line text-xs px-1.5 py-0.5 shrink-0">
														外传
													</span>
												) : null}
											</div>
											<IconButton
								className="text-ink-muted hover:bg-error-bg hover:text-error-fg focus-visible:text-error-fg"
												aria-label={`从宇宙移除${ch.chapter_title || ch.project_title || "未命名项目"}`}
												title="从宇宙移除"
												onClick={() =>
													removeProjectMutation.mutate(ch.project_id)
												}
											>
												<SvgIcon name="trash-2" size={14} />
											</IconButton>
										</div>
									))}
							</div>
						)}
					</DeskSection>

					<DeskSection
						title="共享角色库"
						icon={<SvgIcon name="group" size={16} />}
						meta={`${u.shared_characters.length} 个`}
						actions={
							<>
								<label className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-muted">
									导入到
									<Select
										density="compact"
										containerClassName="max-w-40"
										className="bg-paper-200"
										value={importProjectId || defaultImportProjectId}
										onChange={(e) => setImportProjectId(e.target.value)}
										disabled={u.chapters.length === 0}
										aria-label="导入到章节"
										title={
											u.chapters.length === 0
												? "先创建章节，才能把共享角色导入进去"
												: undefined
										}
									>
										{u.chapters.length === 0 ? (
											<option value="">暂无章节可导入</option>
										) : (
											u.chapters.map((ch) => (
												<option key={ch.project_id} value={String(ch.project_id)}>
													{chapterOptionLabel(ch)}
												</option>
											))
										)}
									</Select>
								</label>
								<Button size="sm" onClick={() => setCreateCharOpen(true)}>
									+ 手动创建
								</Button>
							</>
						}
					>
						{u.shared_characters.length === 0 ? (
							<EmptyState
								compact
								title="还没有共享角色"
								description="可在章节工作台把角色「提升到宇宙」，或在此手动创建"
								action={
									<Button size="sm" onClick={() => setCreateCharOpen(true)}>
										手动创建
									</Button>
								}
							/>
						) : (
							// lg 下坐在 5fr 窄栏里，收窄为两列
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
								{u.shared_characters.map((sc) => (
									<SharedCharacterCard
										key={sc.id}
										character={sc}
										showImport={u.chapters.length > 0}
										onImport={handleImport}
									/>
								))}
							</div>
						)}
					</DeskSection>
				</div>
				</PageContent>
			</PageBody>

			<Modal
				isOpen={editOpen}
				onClose={() => setEditOpen(false)}
				title="编辑宇宙设定"
				actions={
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setEditOpen(false)}
						>
							取消
						</Button>
						<Button
							size="sm"
							loading={updateMutation.isPending}
							onClick={() => updateMutation.mutate()}
							disabled={!editForm.name.trim()}
						>
							保存
						</Button>
					</>
				}
			>
				<div className="space-y-3">
					<Input
						label="名称"
						value={editForm.name}
						onChange={(e) =>
							setEditForm((s) => ({ ...s, name: e.target.value }))
						}
					/>
					<label className="flex flex-col">
						<span className="text-xs font-bold">简介</span>
						<textarea
							className="input-doodle mt-1 min-h-16 resize-y bg-paper-100 p-2.5 text-sm"
							value={editForm.description}
							onChange={(e) =>
								setEditForm((s) => ({ ...s, description: e.target.value }))
							}
						/>
					</label>
					<label className="flex flex-col">
						<span className="text-xs font-bold">世界观</span>
						<textarea
							className="input-doodle mt-1 min-h-20 resize-y bg-paper-100 p-2.5 text-sm"
							value={editForm.world_setting}
							onChange={(e) =>
								setEditForm((s) => ({ ...s, world_setting: e.target.value }))
							}
						/>
					</label>
					<label className="flex flex-col">
						<span className="text-xs font-bold">风格规则</span>
						<textarea
							className="input-doodle mt-1 min-h-16 resize-y bg-paper-100 p-2.5 text-sm"
							value={editForm.style_rules}
							onChange={(e) =>
								setEditForm((s) => ({ ...s, style_rules: e.target.value }))
							}
						/>
					</label>
				</div>
			</Modal>

			<Modal
				isOpen={createCharOpen}
				onClose={() => setCreateCharOpen(false)}
				title="手动创建共享角色"
				actions={
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCreateCharOpen(false)}
						>
							取消
						</Button>
						<Button
							size="sm"
							loading={createCharMutation.isPending}
							disabled={!charForm.name.trim()}
							onClick={() => createCharMutation.mutate()}
						>
							创建
						</Button>
					</>
				}
			>
				<div className="space-y-3">
					<Input
						label="名称"
						value={charForm.name}
						onChange={(e) =>
							setCharForm((s) => ({ ...s, name: e.target.value }))
						}
					/>
					<label className="flex flex-col">
						<span className="text-xs font-bold">描述</span>
						<textarea
							className="input-doodle mt-1 min-h-16 resize-y bg-paper-100 p-2.5 text-sm"
							value={charForm.description}
							onChange={(e) =>
								setCharForm((s) => ({ ...s, description: e.target.value }))
							}
						/>
					</label>
					<label className="flex flex-col">
						<span className="text-xs font-bold">视觉笔记</span>
						<textarea
							className="input-doodle mt-1 min-h-16 resize-y bg-paper-100 p-2.5 text-sm"
							value={charForm.visual_notes}
							onChange={(e) =>
								setCharForm((s) => ({ ...s, visual_notes: e.target.value }))
							}
						/>
					</label>
					<Input
						label="标签（逗号分隔）"
						value={charForm.character_tags}
						onChange={(e) =>
							setCharForm((s) => ({ ...s, character_tags: e.target.value }))
						}
					/>
				</div>
			</Modal>
		</PageShell>
	);
}
