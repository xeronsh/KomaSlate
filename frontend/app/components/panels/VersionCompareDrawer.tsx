import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Dialog";
import { Select } from "~/components/ui/Select";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { projectQueryKeys } from "~/query/queryKeys";
import { getStaticUrl, projectsApi, versionsApi } from "~/services/api";
import type { ArtifactVersion, VersionEntityType } from "~/types";
import { toast } from "~/utils/toast";
import { IconButton } from "../../components/ui/IconButton";
import { blank, DISPLAY_FIELDS, defaultPrevious, diffSnapshots, type FieldDiff, type Snapshot } from "./versionDiff";

export { defaultPrevious, diffSnapshots };

interface VersionCompareDrawerProps {
	open: boolean;
	projectId: number;
	initialEntityType?: VersionEntityType;
	initialEntityId?: number | null;
	onClose: () => void;
}

const LABELS: Record<string, string> = {
	name: "名称",
	description: "描述",
	image_url: "图片",
	video_url: "视频",
	character_ids: "出场角色 ID",
	prompt: "视频提示词",
	image_prompt: "图片提示词",
	dialogue: "对白",
	action: "动作",
	scene: "场景",
	camera: "镜头",
	lighting: "光线",
	expression: "表情",
	sfx: "音效",
	visual_notes: "视觉设定",
};

/** 右侧默认是「当前」：实体此刻的样子，不是某个快照 */
const CURRENT = 0;

function valueToText(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}

const TRIGGER_LABEL: Record<string, string> = { generation: "生成", rollback: "回滚" };

function versionLabel(version: ArtifactVersion): string {
	return `v${version.version} · ${TRIGGER_LABEL[version.trigger] ?? version.trigger}`;
}

function VersionColumn({ title, snapshot, changed }: { title: string; snapshot?: Snapshot; changed: Set<string> }) {
	const imageUrl = getStaticUrl(snapshot?.image_url as string | null | undefined);
	const videoUrl = getStaticUrl(snapshot?.video_url as string | null | undefined);
	return (
		<section className="min-w-0 rounded-md border border-line bg-paper-200/60 p-2.5">
			<h3 className="m-0 text-xs font-bold">{title}</h3>
			<div
				className={`mt-1.5 aspect-video overflow-hidden rounded-sm border bg-paper-300 ${changed.has("image_url") ? "border-primary" : "border-line"}`}
			>
				{imageUrl ? (
					<img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
				) : (
					<div className="flex h-full items-center justify-center text-xs text-ink-muted">
						这一版还没有图
					</div>
				)}
			</div>
			{videoUrl ? (
				<video
					src={videoUrl}
					controls
					preload="metadata"
					className={`mt-1.5 aspect-video w-full rounded-sm border bg-paper-300 object-cover ${changed.has("video_url") ? "border-primary" : "border-line"}`}
				/>
			) : null}
			<div className="mt-2 space-y-1.5">
				{DISPLAY_FIELDS.map((field) => {
					const value = snapshot?.[field];
					if (blank(value)) return null;
					const isChanged = changed.has(field);
					return (
						<div
							key={field}
							className={`text-xs ${isChanged ? "-mx-1 rounded-sm bg-primary/10 px-1" : ""}`}
						>
							<div className="font-semibold text-ink-muted">
								{LABELS[field] || field}
								{isChanged && <span className="ml-1 text-primary">· 有变化</span>}
							</div>
							<div className="whitespace-pre-wrap break-words">{valueToText(value)}</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function diffText(field: string, value: unknown): string {
	if (field === "image_url") return blank(value) ? "没有图" : "有图（见上方对比）";
	if (field === "video_url") return blank(value) ? "没有视频" : "有视频（见上方对比）";
	return valueToText(value);
}

function DiffRow({ diff }: { diff: FieldDiff }) {
	return (
		<li className="rounded-sm border border-line bg-paper-100 p-2 text-xs">
			<div className="mb-1 font-semibold">{LABELS[diff.field] || diff.field}</div>
			<div className="grid gap-2 md:grid-cols-2">
				<div className="rounded-sm bg-error/10 p-2">
					<div className="mb-1 text-error-fg">旧</div>
					<pre className="whitespace-pre-wrap break-words font-sans">{diffText(diff.field, diff.before)}</pre>
				</div>
				<div className="rounded-sm bg-success/10 p-2">
					<div className="mb-1 text-success-fg">新</div>
					<pre className="whitespace-pre-wrap break-words font-sans">{diffText(diff.field, diff.after)}</pre>
				</div>
			</div>
		</li>
	);
}

export function VersionCompareDrawer({
	open,
	projectId,
	initialEntityType = "character",
	initialEntityId = null,
	onClose,
}: VersionCompareDrawerProps) {
	const [entityType, setEntityType] = useState<VersionEntityType>(initialEntityType);
	const [entityId, setEntityId] = useState<number | null>(initialEntityId);
	const queryClient = useQueryClient();
	const { data: characters = [] } = useQuery({
		queryKey: projectQueryKeys.characters(projectId),
		queryFn: () => projectsApi.getCharacters(projectId),
		enabled: open && projectId > 0,
	});
	const { data: shots = [] } = useQuery({
		queryKey: projectQueryKeys.shots(projectId),
		queryFn: () => projectsApi.getShots(projectId),
		enabled: open && projectId > 0,
	});

	useEffect(() => {
		if (!open) return;
		setEntityType(initialEntityType);
		setEntityId(initialEntityId ?? null);
		setLeftVersion(null);
		setRightVersion(null);
	}, [initialEntityId, initialEntityType, open]);

	const characterEntities = entityType === "character" ? characters : [];
	const shotEntities = entityType === "shot" ? shots : [];
	const entities = entityType === "character" ? characterEntities : shotEntities;
	const selectedEntityId = entityId ?? entities[0]?.id ?? null;
	const versionsQuery = useQuery({
		queryKey: ["versions", projectId, entityType, selectedEntityId],
		queryFn: () => versionsApi.list(projectId, entityType, selectedEntityId ?? 0),
		enabled: open && projectId > 0 && Boolean(selectedEntityId),
	});
	const versions = versionsQuery.data?.versions ?? [];
	const [leftVersion, setLeftVersion] = useState<number | null>(null);
	const [rightVersion, setRightVersion] = useState<number | null>(null);
	const currentSnapshot = useMemo(
		() =>
			(entities as unknown as Snapshot[]).find((entity) => entity.id === selectedEntityId),
		[entities, selectedEntityId],
	);
	const previous = useMemo(() => defaultPrevious(currentSnapshot, versions), [currentSnapshot, versions]);
	const effectiveLeft = leftVersion ?? previous ?? versions[0]?.version ?? null;
	const effectiveRight = rightVersion ?? CURRENT;
	const versionByNumber = useMemo(
		() => new Map(versions.map((version) => [version.version, version])),
		[versions],
	);
	const snapshotOf = (n: number | null): Snapshot | undefined =>
		n === CURRENT ? currentSnapshot : n === null ? undefined : versionByNumber.get(n)?.snapshot;
	const leftSnapshot = snapshotOf(effectiveLeft);
	const rightSnapshot = snapshotOf(effectiveRight);
	const diffs = diffSnapshots(leftSnapshot, rightSnapshot);
	const changed = new Set(diffs.map((diff) => diff.field));
	const nothingToCompare = versions.length > 0 && previous === null && leftVersion === null && rightVersion === null;
	const sideLabel = (n: number | null) =>
		n === CURRENT ? "当前" : n === null ? "—" : versionByNumber.get(n) ? versionLabel(versionByNumber.get(n)!) : `v${n}`;
	const rollbackMutation = useMutation({
		mutationFn: (targetVersion: number) =>
			versionsApi.rollback(entityType, selectedEntityId ?? 0, targetVersion),
		onSuccess: (result) => {
			toast.success({ title: "版本回滚", message: result.message });
			queryClient.invalidateQueries({ queryKey: ["versions"] });
			queryClient.invalidateQueries({ queryKey: projectQueryKeys.project(projectId) });
			queryClient.invalidateQueries({ queryKey: projectQueryKeys.characters(projectId) });
			queryClient.invalidateQueries({ queryKey: projectQueryKeys.shots(projectId) });
		},
		onError: () => toast.error({ title: "版本回滚", message: "回滚失败" }),
	});

	const handleEntityTypeChange = (nextType: VersionEntityType) => {
		setEntityType(nextType);
		const nextEntities = nextType === "character" ? characters : shots;
		setEntityId(nextEntities[0]?.id ?? null);
		setLeftVersion(null);
		setRightVersion(null);
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			variant="sheet-right"
			labelledBy="version-compare-title"
			className="w-full max-w-5xl"
		>
			<div className="sticky top-0 z-panel flex items-center gap-2 border-b border-line bg-paper-100 px-3 py-2">
				<SvgIcon name="clock-3" size={16} />
				<h2 id="version-compare-title" className="display m-0 text-lg font-bold">版本对比</h2>
				<IconButton
					className="ml-auto rounded-full"
					onClick={onClose}
					aria-label="关闭版本对比"
					title="关闭版本对比"
				>
					<SvgIcon name="x" size={14} />
				</IconButton>
			</div>

			<div className="space-y-3 p-3">
				<div className="grid gap-2 md:grid-cols-4">
					<Select
						density="compact"
						aria-label="比较对象类型"
						value={entityType}
						onChange={(e) => handleEntityTypeChange(e.currentTarget.value as VersionEntityType)}
					>
						<option value="character">角色</option>
						<option value="shot">分镜</option>
					</Select>
					<Select
						density="compact"
						containerClassName="md:col-span-3"
						aria-label="选择要比较的实体"
						value={selectedEntityId ?? ""}
						onChange={(e) => setEntityId(Number(e.currentTarget.value))}
					>
						{entityType === "character"
							? characterEntities.map((entity) => (
								<option key={entity.id} value={entity.id}>{entity.name}</option>
							))
							: shotEntities.map((entity) => (
								<option key={entity.id} value={entity.id}>{`镜头 ${entity.order}`}</option>
							))}
					</Select>
				</div>

				{versionsQuery.isLoading && <div className="text-xs text-ink-muted">加载版本中…</div>}
				{!versionsQuery.isLoading && versions.length === 0 && (
					<div className="rounded-md border border-line p-4 text-xs text-ink-muted">
						暂无版本快照。生成或重新生成后会自动记录。
					</div>
				)}

				{nothingToCompare && (
					<div className="rounded-md border border-line bg-paper-200/40 p-3 text-xs text-ink-muted" role="note">
						只有一个版本：历史快照和当前内容相同，重新生成或修改后才有可对比的内容。
					</div>
				)}

				{versions.length > 0 && !nothingToCompare && (
					<>
						<div className="grid gap-2 md:grid-cols-2">
							<Select
								density="compact"
								aria-label="旧版本"
								value={effectiveLeft ?? ""}
								onChange={(e) => setLeftVersion(Number(e.currentTarget.value))}
							>
								{versions.map((version) => (
									<option key={version.id} value={version.version}>{versionLabel(version)}</option>
								))}
							</Select>
							<Select
								density="compact"
								aria-label="新版本"
								value={effectiveRight}
								onChange={(e) => setRightVersion(Number(e.currentTarget.value))}
							>
								<option value={CURRENT}>当前</option>
								{versions.map((version) => (
									<option key={version.id} value={version.version}>{versionLabel(version)}</option>
								))}
							</Select>
						</div>

						<div className="grid gap-3 lg:grid-cols-2">
							<VersionColumn title={`旧 · ${sideLabel(effectiveLeft)}`} snapshot={leftSnapshot} changed={changed} />
							<VersionColumn title={`新 · ${sideLabel(effectiveRight)}`} snapshot={rightSnapshot} changed={changed} />
						</div>

						<section className="rounded-md border border-line bg-paper-200/40 p-2.5">
							<h3 className="mb-1.5 text-xs font-bold">差异</h3>
							{diffs.length === 0 && (
								<div className="text-xs text-ink-muted">这两边内容相同，换一个版本看看。</div>
							)}
							<ul className="space-y-1.5">
								{diffs.map((diff) => (
									<DiffRow key={diff.field} diff={diff} />
								))}
							</ul>
						</section>

						<div className="flex justify-end">
							<Button
								variant="secondary"
								size="sm"
								loading={rollbackMutation.isPending}
								disabled={!effectiveLeft || rollbackMutation.isPending}
								onClick={() => {
									if (!effectiveLeft) return;
									if (window.confirm(`回滚到版本 v${effectiveLeft}？后续版本不会删除。`)) {
										rollbackMutation.mutate(effectiveLeft);
									}
								}}
							>
								回滚到左侧版本
							</Button>
						</div>
					</>
				)}
			</div>
		</Dialog>
	);
}
