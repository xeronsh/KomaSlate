import { MEDIA, imageReady, videoReady } from "~/components/ui/media";
import { createContext, useContext, useRef, useState } from "react";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Tooltip } from "~/components/ui/Tooltip";
import type { SemanticLodTier } from "~/features/workbench/nodegraph/bezierWires";
import { getStaticUrl } from "~/services/api";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { NodeStatusBadge } from "./nodeStatus";
import {
	addCharacterReference,
	computeCharacterEmbedding,
	removeCharacterReference,
	saveShotPatch,
} from "./cardActions";
import type {
	ComicWorkflowNode,
	ComicWorkflowSection,
	WorkflowNodeStatus,
} from "../graph/types";
import "~/components/ui/icons/workbenchIcons";

/** 卡片底部的标签：一行，过长省略，完整内容放 title。多行的胶囊会撑破卡片底边。 */
const TAG_PILL = "inline-block max-w-full truncate rounded-full border px-1.5 py-0.5 text-xs";

const SECTION_STYLE = {
	brief: {
		surface: "bg-paper-200/45",
	},
	elements: {
		surface: "bg-paper-200/45",
	},
	shotline: {
		surface: "bg-surface/60",
	},
	output: {
		surface: "bg-paper-200/45",
	},
} as const;

export { nodeStatusLabel } from "./nodeStatus";

function stopCanvasPointer(e: React.PointerEvent<HTMLElement>) {
	e.stopPropagation();
}

/** 卡内交互控件：阻止冒泡到卡片 onClick（选中节点）与画布手势 */
function stopAll(e: React.SyntheticEvent) {
	e.stopPropagation();
}

/**
 * 就地编辑文本：点击进入编辑，Enter / 失焦保存，Esc 取消。
 * 编辑态是组件本地 state——store 更新只在保存成功后发生，
 * 因此输入过程不会被 graph 投影重建打断。
 */
function InlineEditableText({
	value,
	placeholder,
	displayClassName,
	rows = 2,
	disabled = false,
	ariaLabel,
	save,
}: {
	value: string | null | undefined;
	placeholder: string;
	displayClassName: string;
	rows?: number;
	disabled?: boolean;
	ariaLabel: string;
	save: (next: string) => Promise<boolean>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);

	const commit = async () => {
		const next = draft.trim();
		if (next === (value ?? "").trim()) {
			setEditing(false);
			return;
		}
		setSaving(true);
		const ok = await save(next);
		setSaving(false);
		if (ok) setEditing(false);
	};

	if (!editing) {
		return (
			<button
				type="button"
				disabled={disabled}
				aria-label={`编辑${ariaLabel}`}
				// 卡片上截成两行，完整内容放在悬停提示里
				title={value || (disabled ? undefined : "点击编辑")}
				onPointerDown={stopAll}
				onClick={(e) => {
					stopAll(e);
					if (disabled) return;
					setDraft(value ?? "");
					setEditing(true);
				}}
				className={`block w-full cursor-text rounded-sm text-left transition-colors duration-fast hover:bg-ink/5 ${displayClassName}`}
			>
				{value ? (
					value
				) : (
					<span className="italic text-ink-subtle">{placeholder}</span>
				)}
			</button>
		);
	}

	return (
		<textarea
			autoFocus
			rows={rows}
			value={draft}
			disabled={saving}
			aria-label={ariaLabel}
			onPointerDown={stopAll}
			onClick={stopAll}
			onChange={(e) => setDraft(e.target.value)}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					void commit();
				}
				if (e.key === "Escape") setEditing(false);
			}}
			onBlur={() => void commit()}
			className="w-full resize-none rounded-sm border-2 border-primary bg-paper-100 p-1.5 text-xs leading-relaxed text-ink"
		/>
	);
}

function statusBadge(status: WorkflowNodeStatus) {
	// 空闲时的草稿不再挂「未确认」：审批门过了之后它只是噪音，待确认 / 已批准才需要提示
	if (status === "unconfirmed") return null;
	return <NodeStatusBadge status={status} />;
}

function MediaPreviewButton({
	src,
	title,
	type,
}: {
	src: string | null;
	title: string;
	type: "image" | "video";
}) {
	if (!src) return null;

	return (
		<button
			type="button"
			className="btn-doodle touch-target pointer-events-auto h-12 min-h-12 w-12 bg-paper-100/90 text-ink hover:bg-primary hover:text-primary-content"
			aria-label={type === "image" ? "预览图片" : "预览视频"}
			title={type === "image" ? "预览图片" : "预览视频"}
			onPointerDown={stopCanvasPointer}
			onClick={() => {
				if (type === "image") {
					canvasEvents.emit("preview-image", { src, alt: title });
				} else {
					canvasEvents.emit("preview-video", { src, title });
				}
			}}
		>
			<SvgIcon name={type === "image" ? "image" : "play"} size={16} />
		</button>
	);
}

function EmptyMedia({ label, busy = false }: { label: string; busy?: boolean }) {
	// 生成中：同一套媒体微光占位，告诉用户“图正在来”而不是“没有图”
	return (
		<div
			className={`flex h-full w-full items-center justify-center text-xs text-ink-muted ${busy ? MEDIA : "media-blank"}`}
			data-busy={busy || undefined}
		>
			{busy ? "生成中…" : label}
		</div>
	);
}

/** 参考图管理条：缩略图 + 上传 + 删除 + 特征重算，全部就地完成 */
function CharacterRefStrip({
	node,
}: {
	node: Extract<ComicWorkflowNode, { kind: "character" }>;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState<"upload" | "embed" | number | null>(null);
	const refs = node.character.reference_images ?? [];
	const projectId = node.character.project_id;

	const upload = async (file: File | undefined) => {
		if (!file) return;
		setBusy("upload");
		await addCharacterReference(node.entityId, projectId, file);
		setBusy(null);
		if (fileRef.current) fileRef.current.value = "";
	};

	return (
		<div className="mt-1.5 flex items-center gap-1" onPointerDown={stopAll}>
			<span className="shrink-0 label text-ink-muted">
				参考 <span className="font-mono">{refs.length}</span>
			</span>
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
				{refs.slice(0, 3).map((url, index) => (
					<span key={`${url}-${index}`} className="group relative shrink-0">
						<img
							src={getStaticUrl(url) ?? url}
							alt={`参考图 ${index + 1}`}
							className={`${MEDIA} h-7 w-7 rounded-sm border border-line-strong object-cover`}
							width={28}
							height={28}
							loading="lazy"
							decoding="async"
							draggable={false}
							{...imageReady}
						/>
						<button
							type="button"
							aria-label={`删除参考图 ${index + 1}`}
							disabled={busy !== null}
							onClick={(e) => {
								stopAll(e);
								setBusy(index);
								void removeCharacterReference(
									node.entityId,
									projectId,
									index,
								).finally(() => setBusy(null));
							}}
							className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-error text-error-content group-hover:flex"
						>
							{busy === index ? (
								<span className="spinner-doodle h-2 w-2" aria-hidden="true" />
							) : (
								<SvgIcon name="x" size={8} />
							)}
						</button>
					</span>
				))}
				<button
					type="button"
					aria-label="上传参考图"
					disabled={busy !== null}
					onClick={(e) => {
						stopAll(e);
						fileRef.current?.click();
					}}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-ink-muted transition-colors duration-fast hover:border-primary/50 hover:text-primary"
				>
					{busy === "upload" ? (
						<span className="spinner-doodle h-3 w-3" aria-hidden="true" />
					) : (
						<SvgIcon name="plus" size={12} />
					)}
				</button>
			</div>
			{refs.length > 0 ? (
				<button
					type="button"
					aria-label="重算角色特征"
					title="用当前参考图重算一致性特征"
					disabled={busy !== null}
					onClick={(e) => {
						stopAll(e);
						setBusy("embed");
						void computeCharacterEmbedding(node.entityId).finally(() =>
							setBusy(null),
						);
					}}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-ink/10 hover:text-ink"
				>
					{busy === "embed" ? (
						<span className="spinner-doodle h-3 w-3" aria-hidden="true" />
					) : (
						<SvgIcon name="refresh-cw" size={12} />
					)}
				</button>
			) : null}
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(e) => void upload(e.target.files?.[0])}
			/>
		</div>
	);
}

function CharacterCard({
	node,
}: {
	node: Extract<ComicWorkflowNode, { kind: "character" }>;
}) {
	const imageUrl = getStaticUrl(node.imageUrl);
	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="relative aspect-[4/3] border-b border-line bg-paper-300">
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={node.title}
						draggable={false}
						decoding="async"
						loading="eager"
						className={`${MEDIA} h-full w-full object-cover`}
						{...imageReady}
					/>
				) : (
					<EmptyMedia label="等待角色图" busy={node.status === "generating"} />
				)}
				<div className="absolute right-2 top-2">
					<MediaPreviewButton src={imageUrl} title={node.title} type="image" />
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col p-3">
				<CardHeader node={node} icon="user" compact />
				{node.character.description ? (
					<p
						className="m-0 mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-muted"
						title={node.character.description}
					>
						{node.character.description}
					</p>
				) : null}
				<CharacterRefStrip node={node} />
				<div className="mt-auto flex flex-wrap gap-1 pt-1.5">
					{node.character.has_embedding ? (
							<span className={`${TAG_PILL} border-primary/25 bg-primary/10 text-primary`}>资产一致性</span>
					) : null}
					{node.character.visual_notes ? (
							<span className={`${TAG_PILL} border-line bg-paper-100/80 text-ink-muted`}>视觉笔记</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

function ShotCard({ node }: { node: Extract<ComicWorkflowNode, { kind: "shot" }> }) {
	const imageUrl = getStaticUrl(node.imageUrl);
	const videoUrl = getStaticUrl(node.videoUrl);
	const previewType = videoUrl ? "video" : "image";
	const previewUrl = videoUrl || imageUrl;
	const isFirstShot = node.shot.order === 1;
	const cell = node.gridCell ?? node.shot.order;
	const editLocked = node.status === "generating";

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="relative h-32 shrink-0 border-b border-line bg-paper-300">
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={node.title}
						draggable={false}
						decoding="async"
						loading="eager"
						{...(isFirstShot
							? ({ fetchpriority: "high" } as { fetchpriority: "high" })
							: {})}
						className={`${MEDIA} h-full w-full object-cover`}
						{...imageReady}
					/>
				) : (
					<EmptyMedia label="等待分镜图" busy={node.status === "generating"} />
				)}
				{/* 九宫格 cell index */}
				<span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-sm bg-ink/90 px-1.5 font-mono text-xs font-bold text-paper-100">
					{cell}
				</span>
				<span className="absolute bottom-1.5 left-1.5 inline-flex rounded-sm border border-line bg-paper-100/90 px-1.5 py-0.5 text-xs">
					{node.shot.duration ? <span className="font-mono">{node.shot.duration}s</span> : "未定时长"}
				</span>
				<div className="absolute right-2 top-2">
					<MediaPreviewButton
						src={previewUrl}
						title={node.title}
						type={previewType}
					/>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col p-3">
				<CardHeader node={node} icon="shot" compact />
				<div className="mt-1.5">
					<InlineEditableText
						value={node.shot.description}
						placeholder="添加画面描述"
						ariaLabel={`${node.title} 画面描述`}
						rows={3}
						disabled={editLocked}
						displayClassName="line-clamp-3 p-0.5 text-xs leading-relaxed text-ink-muted"
						save={(next) =>
							saveShotPatch(node.entityId, {
								expected_revision: node.shot.revision,
								description: next || null,
							})
						}
					/>
				</div>
				<div className="mt-1">
					<InlineEditableText
						value={node.shot.dialogue}
						placeholder="添加对白"
						ariaLabel={`${node.title} 对白`}
						rows={2}
						disabled={editLocked}
						displayClassName="line-clamp-2 p-0.5 text-xs italic text-primary"
						save={(next) =>
							saveShotPatch(node.entityId, {
								expected_revision: node.shot.revision,
								dialogue: next || null,
							})
						}
					/>
				</div>
				<div className="mt-auto flex flex-wrap gap-1 pt-1.5">
					{node.characterNames.length > 0 ? (
						<Tooltip content={node.characterNames.join("、")}>
							<span
								className={`${TAG_PILL} border-primary/25 bg-primary/10 font-medium text-primary`}
							>
								{node.characterNames.join("、")}
							</span>
						</Tooltip>
					) : null}
					{node.shot.camera ? (
						<Tooltip content={node.shot.camera}>
							<span className={`${TAG_PILL} border-line bg-paper-100/80 text-ink-muted`}>
								{node.shot.camera}
							</span>
						</Tooltip>
					) : null}
					<ReviewPill status={node.shot.review_status} note={node.shot.review_note} />
				</div>
			</div>
		</div>
	);
}

/** 视觉审查结果：没看过的镜头明说「未检查」，不和通过的混在一起 */
function ReviewPill({ status, note }: { status?: string | null; note?: string | null }) {
	if (status === "unchecked") {
		return (
			<Tooltip content={note || "视觉审查没有运行"}>
				<span className={`${TAG_PILL} border-transparent bg-warning-bg text-warning-fg`}>
					未检查
				</span>
			</Tooltip>
		);
	}
	if (status === "failed") {
		return (
			<Tooltip content={note || "未通过检查"}>
				<span className={`${TAG_PILL} border-transparent bg-error-bg text-error-fg`}>
					未通过
				</span>
			</Tooltip>
		);
	}
	if (status === "passed") {
		return <span className={`${TAG_PILL} border-transparent bg-success-bg text-success-fg`}>已检查</span>;
	}
	return null;
}

function OutputCard({
	node,
}: {
	node: Extract<ComicWorkflowNode, { kind: "output" }>;
}) {
	const videoUrl = getStaticUrl(node.videoUrl);
	const statusText = outputStateLabel(node.outputState);
	const needsRecompose =
		node.outputState === "needs_recompose" || node.outputState === "blocked";

	return (
		<div className="flex h-full flex-col p-4">
			<CardHeader node={node} icon="render" />

			{/* 内联播放器：交付台上直接看，不用先开弹窗 */}
			<div
				className="relative mt-3 aspect-video shrink-0 overflow-hidden rounded-lg bg-paper-300"
				onPointerDown={stopAll}
			>
				{videoUrl ? (
					<video
						src={videoUrl}
						className={`${MEDIA} h-full w-full object-cover`}
						{...videoReady}
						controls
						preload="metadata"
						playsInline
					/>
				) : (
					<EmptyMedia label={statusText} />
				)}
			</div>

			{videoUrl || needsRecompose ? (
				<div className="mt-2 flex gap-1.5" onPointerDown={stopAll}>
					{videoUrl ? (
						<a
							// 成片在另一个源上，download 属性会被忽略；跟顶栏、移动端一样走 final-video
							// 端点（attachment），浏览器直接存盘而不是在新标签里播放。新标签只兜底出错页
							href={getStaticUrl(`/api/v1/projects/${node.projectId}/final-video`) ?? videoUrl}
							download
							target="_blank"
							rel="noopener"
							onClick={stopAll}
							className="btn-doodle touch-target-dense h-7 min-h-7 flex-1 px-2 text-xs bg-primary text-primary-content hover:bg-primary-hover active:bg-primary-pressed"
						>
							<SvgIcon name="download" size={12} />
							下载成片
						</a>
					) : null}
					{needsRecompose ? (
						<button
							type="button"
							onClick={(e) => {
								stopAll(e);
								canvasEvents.emit("request-regenerate", {
									source: "output-card",
									// 只差成片：分镜视频都在，只重新拼接；有阻塞项才走完整重新生成
									...(node.outputState === "needs_recompose" ? { mode: "recompose" as const } : {}),
								});
							}}
							className="btn-doodle touch-target-dense h-7 min-h-7 flex-1 px-2 text-xs bg-transparent text-ink hover:bg-paper-200"
						>
							<SvgIcon name="refresh-cw" size={12} />
							重新合成
						</button>
					) : null}
				</div>
			) : null}

			{node.blockingClips.length > 0 ? (
				<div className="mt-2 min-h-0 overflow-y-auto rounded-lg border border-warning/25 bg-warning/10 p-2">
					<p className="m-0 label text-warning-fg">
						阻塞项 <span className="font-mono">{node.blockingClips.length}</span>
					</p>
					<ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-xs leading-relaxed text-ink">
						{node.blockingClips.map((clip) => (
							<li key={clip.shot_id}>
								S{String(clip.order).padStart(2, "0")} · {clip.reason}
							</li>
						))}
					</ul>
				</div>
			) : (
				<p className="m-0 mt-2 text-xs text-ink-muted">{statusText}</p>
			)}

			{node.exports.length > 0 ? (
				<div className="mt-auto pt-2" onPointerDown={stopAll}>
					<p className="m-0 label text-ink-muted">
						导出记录 <span className="font-mono">{node.exports.length}</span>
					</p>
					<div className="mt-1 flex flex-col gap-0.5">
						{node.exports.slice(-3).map((url, index) => (
							<a
								key={`${url}-${index}`}
								href={getStaticUrl(url) ?? url}
								download
								onClick={stopAll}
								className="flex items-center gap-1 truncate text-xs text-ink-muted transition-colors duration-fast hover:text-ink"
							>
								<SvgIcon name="arrow-down-to-line" size={12} />
								<span className="truncate">
									{url.split("/").pop() ?? `导出 ${index + 1}`}
								</span>
							</a>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function outputStateLabel(state: Extract<ComicWorkflowNode, { kind: "output" }>["outputState"]) {
	if (state === "ready") return "成片可用";
	if (state === "needs_recompose") return "需要重新合成";
	if (state === "blocked") return "阻塞";
	return "等待合成";
}

function CardHeader({
	node,
	icon,
	compact = false,
}: {
	node: ComicWorkflowNode;
	icon: "lightbulb" | "user" | "shot" | "render";
	compact?: boolean;
}) {
	return (
		<div className="flex items-start gap-2">
			{/* 图标只是线描标记，不再垫彩色方块 */}
			<span className="mt-0.5 shrink-0 text-ink-muted">
				<SvgIcon name={icon} size={compact ? 14 : 16} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<p className="m-0 truncate text-sm font-bold">
						{node.title}
					</p>
					{statusBadge(node.status)}
				</div>
				<p className="m-0 truncate label text-ink-muted">
					{node.subtitle}
				</p>
			</div>
		</div>
	);
}

export interface WorkflowFrameViewProps {
	section: ComicWorkflowSection;
	title: string;
	eyebrow: string;
	countLabel: string;
	draggable?: boolean;
	empty?: boolean;
}

/** 空分区的引导：告诉第一次用的人这里会出现什么、下一步做什么 */
const EMPTY_HINT: Partial<Record<ComicWorkflowSection, string>> = {
	elements: "规划完成后，角色会出现在这里。",
	shotline: "规划完成后，分镜会出现在这里。",
	output: "分镜都有了视频后，成片会出现在这里。",
};

/** 对位标（⊕）：成片卡上下居中各一个，代替原来的硬投影。 */
function RegistrationMark({ className, done }: { className: string; done: boolean }) {
	// 未就绪：青版偏出一点（没套准）；成片就绪：两版合一、转成群青——完成时唯一的“仪式感”
	const mark = (
		<>
			<circle cx="7" cy="7" r="3.5" fill="none" stroke="currentColor" strokeWidth="1" />
			<path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="1" />
		</>
	);
	return (
		<svg
			aria-hidden="true"
			viewBox="-2 -2 18 18"
			data-done={done || undefined}
			className={`registration-mark pointer-events-none absolute left-1/2 h-4 w-4 -translate-x-1/2 ${className}`}
		>
			<g className="registration-mark-ghost">{mark}</g>
			<g>{mark}</g>
		</svg>
	);
}

/** 分区框（React Flow 父节点）。 */
export function WorkflowFrameView({
	section,
	title,
	eyebrow,
	countLabel,
	draggable = true,
	empty = false,
}: WorkflowFrameViewProps) {
	const hint = empty ? EMPTY_HINT[section] : undefined;
	const style = SECTION_STYLE[section];
	return (
		<section
			aria-label={title}
			className={`flex h-full w-full flex-col rounded-lg border border-line p-3 text-ink ${
				draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
			} ${style.surface}`}
		>
			{/* 标号 + 标题一行：01–04 是管线顺序，作为印刷标号放在标题前，而不是标题上方的 eyebrow */}
			<div className="flex min-w-0 items-baseline gap-2 border-b border-line pb-2">
				<span className="shrink-0 rounded-sm border border-line-strong bg-paper-100/80 px-1.5 py-0.5 font-mono text-xs text-ink-muted">
					{eyebrow}
				</span>
				<p className="display m-0 truncate text-lg font-bold leading-tight">{title}</p>
				{countLabel ? (
					<p className="m-0 ml-auto shrink-0 label text-ink-muted">{countLabel}</p>
				) : null}
			</div>
			{hint ? (
				<p className="corner-marks m-0 mt-3 flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
					{hint}
				</p>
			) : null}
		</section>
	);
}

/** 卡片边框随状态：默认 hairline，悬停加深；生成中/阻塞用状态色提示。 */
const CARD_TONE: Partial<Record<WorkflowNodeStatus, string>> & { draft: string } = {
	draft: "border-line hover:border-border-strong",
	generating: "border-warning/50",
	blocked: "border-error/50",
};

export const WorkflowLodContext = createContext<SemanticLodTier>("mid");

export function useWorkflowLod(): SemanticLodTier {
	return useContext(WorkflowLodContext);
}

function MacroCapsuleCard({ node }: { node: ComicWorkflowNode }) {
	const icon =
		node.kind === "character"
			? "user"
			: node.kind === "shot"
				? "shot"
				: node.kind === "output"
					? "render"
					: "lightbulb";
	const kindLabel =
		node.kind === "character"
			? "CHAR"
			: node.kind === "shot"
				? "SHOT"
				: node.kind === "output"
					? "OUTPUT"
					: "BRIEF";
	return (
		<div
			className="flex h-full flex-col justify-between bg-paper-100 p-4"
			data-lod-view="macro"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-200 px-2.5 py-1 font-mono text-sm font-semibold text-ink-muted">
					<SvgIcon name={icon} size={16} />
					{kindLabel}
				</span>
				{statusBadge(node.status)}
			</div>
			<div className="my-auto flex flex-col gap-1">
				<p className="m-0 truncate text-2xl font-bold leading-tight text-ink">
					{node.title}
				</p>
				<p className="m-0 truncate text-base text-ink-muted">
					{node.subtitle}
				</p>
			</div>
			<div className="flex items-center justify-between border-t border-line pt-2 font-mono text-sm text-ink-muted">
				<span>
					{node.kind === "shot"
						? `rev=${node.shot.revision ?? 1}`
						: node.kind === "character"
							? `rev=${node.character.revision ?? 1}`
							: "stage"}
				</span>
				<span>MACRO</span>
			</div>
		</div>
	);
}

function MicroPortStrip({ node }: { node: ComicWorkflowNode }) {
	const rev =
		node.kind === "shot"
			? node.shot.revision ?? 1
			: node.kind === "character"
				? node.character.revision ?? 1
				: null;
	const ports =
		node.kind === "shot"
			? `in: cast(${node.characterNames.length}) -> out: frame/clip`
			: node.kind === "character"
				? `in: ref(${node.character.reference_images?.length ?? 0}) -> out: bible`
				: "in: shots -> out: final.mp4";
	return (
		<div
			className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-paper-200 px-2.5 py-1 font-mono text-xs text-ink-muted"
			data-lod-view="micro"
		>
			<span className="truncate">{ports}</span>
			{rev != null ? (
				<span className="shrink-0 rounded-sm bg-surface px-1 text-ink">rev={rev}</span>
			) : null}
		</div>
	);
}

/** 业务卡片（React Flow 节点）。选中由 React Flow 管理。 */
export function WorkflowCardView({
	node,
	draggable = false,
	selected = false,
}: {
	node: ComicWorkflowNode;
	draggable?: boolean;
	selected?: boolean;
}) {
	const output = node.kind === "output";
	const lod = useWorkflowLod();
	return (
		<div className="panel-marks relative h-full" data-selected={selected || undefined} data-lod={lod}>
			<article
				aria-label={node.title}
				data-status={node.status}
				className={`flex h-full select-none flex-col overflow-hidden rounded-sm bg-paper-100 text-ink transition duration-fast ease-standard ${
					output ? "comic-frame" : `border ${CARD_TONE[node.status] ?? CARD_TONE.draft}`
				} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-paper-100" : ""}`}
			>
				{lod === "macro" ? (
					<MacroCapsuleCard node={node} />
				) : (
					<>
						<div className="min-h-0 flex-1 overflow-hidden">
							{node.kind === "character" ? <CharacterCard node={node} /> : null}
							{node.kind === "shot" ? <ShotCard node={node} /> : null}
							{output ? <OutputCard node={node} /> : null}
						</div>
						{lod === "micro" ? <MicroPortStrip node={node} /> : null}
					</>
				)}
			</article>
			{/* 选中：四角裁切线（印刷裁切标记），纯装饰 */}
			<span className="crop-marks" aria-hidden="true" />
			{output ? (
				<>
					<RegistrationMark className="-top-3.5" done={node.status === "ready"} />
					<RegistrationMark className="-bottom-3.5" done={node.status === "ready"} />
				</>
			) : null}
		</div>
	);
}
