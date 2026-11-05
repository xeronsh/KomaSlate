import { MEDIA, imageReady } from "~/components/ui/media";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { assetsApi, getStaticUrl } from "~/services/api";
import { Button } from "~/components/ui/Button";
import { SvgIcon, type IconName } from "~/components/ui/SvgIcon";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import { Dialog } from "~/components/ui/Dialog";
import { toast } from "~/utils/toast";
import type { Asset, AssetCreatePayload } from "~/types";
import { IconButton } from "../../components/ui/IconButton";
import { PlainButton } from "../../components/ui/PlainButton";

type AssetType = "character" | "scene";

const ASSET_TABS: { key: AssetType | "all"; label: string; icon: IconName }[] =
	[
		{ key: "all", label: "全部", icon: "layers" },
		{ key: "character", label: "角色", icon: "user" },
		{ key: "scene", label: "场景", icon: "image" },
	];

interface AssetDrawerProps {
	open: boolean;
	onClose: () => void;
	/** 当前项目 ID — 传入时显示"使用"按钮 */
	projectId?: number;
}

/* ---------- Create Asset Form ---------- */

interface CreateAssetFormProps {
	isOpen: boolean;
	onClose: () => void;
	onCreated: () => void;
}

function CreateAssetForm({ isOpen, onClose, onCreated }: CreateAssetFormProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [assetType, setAssetType] = useState<AssetType | "">("");
	const [description, setDescription] = useState("");
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (!file.type.startsWith("image/")) {
				setError("仅支持图片文件");
				return;
			}
			if (file.size > 10 * 1024 * 1024) {
				setError("图片大小不能超过 10MB");
				return;
			}
			setImageFile(file);
			setError(null);
			const reader = new FileReader();
			reader.onload = (ev) => setImagePreview(ev.target?.result as string);
			reader.readAsDataURL(file);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) {
			if (!file.type.startsWith("image/")) {
				setError("仅支持图片文件");
				return;
			}
			if (file.size > 10 * 1024 * 1024) {
				setError("图片大小不能超过 10MB");
				return;
			}
			setImageFile(file);
			setError(null);
			const reader = new FileReader();
			reader.onload = (ev) => setImagePreview(ev.target?.result as string);
			reader.readAsDataURL(file);
		}
	};

	const handleSubmit = async () => {
		if (!name.trim()) {
			setError("请输入资产名称");
			return;
		}
		if (!assetType) {
			setError("请选择资产类型");
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			let imageUrl: string | null = null;
			if (imageFile) {
				const result = await assetsApi.uploadImage(imageFile);
				imageUrl = result.url;
			}

			const payload: AssetCreatePayload = {
				name: name.trim(),
				asset_type: assetType,
				description: description.trim() || null,
				image_url: imageUrl,
			};

			await assetsApi.create(payload);
			queryClient.invalidateQueries({ queryKey: ["assets"] });
			resetForm();
			onCreated();
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建失败");
		} finally {
			setIsSubmitting(false);
		}
	};

	const resetForm = () => {
		setName("");
		setAssetType("");
		setDescription("");
		setImageFile(null);
		setImagePreview(null);
		setError(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const handleClose = () => {
		resetForm();
		onClose();
	};

	return (
		<Dialog
			open={isOpen}
			onClose={handleClose}
			variant="sheet-right"
			labelledBy="create-asset-title"
			className="flex w-72 flex-col"
		>
				<div className="flex items-center justify-between border-b border-line px-2.5 py-2">
					<div className="flex items-center gap-1.5">
						<SvgIcon name="plus" size={14} className="text-primary" />
						<h3 id="create-asset-title" className="m-0 text-sm font-bold">
							新建资产
						</h3>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="!h-7 !px-1"
						onClick={handleClose}
						aria-label="关闭新建资产"
					>
						<SvgIcon name="x" size={14} />
					</Button>
				</div>

				<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
					{/* Name */}
					<div className="flex flex-col gap-1">
						<label htmlFor="create-asset-name" className="label text-ink">
							名称 <span className="text-error-fg">*</span>
						</label>
						<input
							id="create-asset-name"
							type="text"
							placeholder="输入资产名称"
							className="input-doodle h-8 w-full px-2.5 text-xs"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
						/>
					</div>

					{/* Type */}
					<div className="flex flex-col gap-1">
						<span className="label text-ink">
							类型 <span className="text-error-fg">*</span>
						</span>
						<div className="flex gap-2">
							<PlainButton
								className={`flex-1 btn-doodle h-8 touch-target-dense justify-center gap-1 px-2 text-xs ${
									assetType === "character"
										? "border-primary bg-primary text-primary-content"
										: "border-line bg-paper-100 text-ink-muted hover:border-border-strong hover:text-ink"
								}`}
								onClick={() => setAssetType("character")}
							>
								<SvgIcon name="star" size={12} />
								角色
							</PlainButton>
							<PlainButton
								className={`flex-1 btn-doodle h-8 touch-target-dense justify-center gap-1 px-2 text-xs ${
									assetType === "scene"
										? "border-primary bg-primary text-primary-content"
										: "border-line bg-paper-100 text-ink-muted hover:border-border-strong hover:text-ink"
								}`}
								onClick={() => setAssetType("scene")}
							>
								<SvgIcon name="image" size={12} />
								场景
							</PlainButton>
						</div>
					</div>

					{/* Description */}
					<div className="flex flex-col gap-1">
						<label htmlFor="create-asset-description" className="label text-ink">
							描述
						</label>
						<textarea
							id="create-asset-description"
							placeholder="输入资产描述（可选）"
							className="input-doodle h-16 w-full resize-y p-2 text-xs"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>

					{/* Image upload */}
					<div className="flex flex-col gap-1">
						<span className="label text-ink">图片</span>
						{imagePreview ? (
							<div className="relative group">
								<img
									src={imagePreview}
									alt="预览"
									className="w-full h-28 object-cover rounded-lg border border-line"
								/>
								<IconButton
									className="absolute top-1 right-1 rounded-full bg-paper-100/90 text-ink-muted hover:bg-error-bg hover:text-error-fg focus-visible:text-error-fg"
									onClick={() => {
										setImageFile(null);
										setImagePreview(null);
										if (fileInputRef.current)
											fileInputRef.current.value = "";
									}}
									aria-label="移除图片"
								>
									<SvgIcon name="x" size={12} />
								</IconButton>
							</div>
						) : (
							<Button
								variant="ghost"
								size="sm"
								className="!h-20 !min-h-0 w-full flex-col rounded-lg border border-dashed border-line-strong hover:border-primary/40 transition-colors duration-fast"
								onClick={() => fileInputRef.current?.click()}
								onDragOver={(e) => e.preventDefault()}
								onDrop={handleDrop}
								aria-label="上传资产图片"
							>
								<SvgIcon
									name="image"
									size={20}
									className="text-ink-faint mb-1"
								/>
								<span className="text-xs text-ink-muted">
									点击上传或拖拽图片
								</span>
							</Button>
						)}
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							className="hidden"
							onChange={handleFileChange}
						/>
					</div>

					{/* Error */}
					{error && (
						<div className="text-xs text-error-fg flex items-center gap-1">
							<SvgIcon name="triangle-alert" size={12} />
							{error}
						</div>
					)}

					{/* Actions */}
					<div className="flex gap-2 mt-auto border-t border-line pt-3">
						<Button
							variant="ghost"
							size="sm"
							className="flex-1"
							onClick={handleClose}
							disabled={isSubmitting}
						>
							取消
						</Button>
						<Button
							variant="primary"
							size="sm"
							className="flex-1"
							onClick={handleSubmit}
							loading={isSubmitting}
							disabled={!name.trim() || !assetType}
						>
							确认创建
						</Button>
					</div>
				</div>
		</Dialog>
	);
}

/* ---------- Asset Card ---------- */

function AssetCard({
	asset,
	projectId,
	onDelete,
	onUse,
	isUsing,
}: {
	asset: Asset;
	projectId?: number;
	onDelete: (asset: Asset) => void;
	onUse: (asset: Asset) => void;
	isUsing: boolean;
}) {
	return (
		<div className="card-doodle flex flex-col p-2 bg-paper-100 border border-line hover:border-primary/40 transition-colors duration-fast">
			<figure className="m-0 h-28 overflow-hidden rounded-sm border border-line bg-paper-200">
				{asset.image_url ? (
					<img
						src={getStaticUrl(asset.image_url) ?? undefined}
						alt={asset.name}
						className={`${MEDIA} w-full h-full object-cover`}
						loading="lazy"
						{...imageReady}
					/>
				) : (
					<div className="media-blank flex items-center justify-center w-full h-full text-ink-faint">
						<SvgIcon name="image" size={24} />
					</div>
				)}
			</figure>
			<div className="flex flex-1 flex-col gap-1.5 pt-2">
				<div className="flex items-center gap-1">
					<span className="badge-doodle text-xs px-1.5 py-0.5 bg-paper-200 text-ink-muted border-line shrink-0">
						{asset.asset_type === "character"
							? "角色"
							: asset.asset_type === "scene"
								? "场景"
								: "风格"}
					</span>
					<h4 className="m-0 text-xs font-semibold text-ink flex-1 truncate">{asset.name}</h4>
				</div>
				{asset.description && (
					<p className="m-0 text-xs text-ink-muted line-clamp-2">
						{asset.description}
					</p>
				)}
				<div className="mt-auto flex items-center justify-end gap-1 pt-1">
					{projectId &&
						(asset.asset_type === "character" ||
							asset.asset_type === "scene") && (
							<Button
								variant="ghost"
								size="sm"
								className="!px-1.5 !py-0 !min-h-0 !h-6 text-xs text-primary"
								onClick={() => onUse(asset)}
								disabled={isUsing}
								title="添加到当前项目"
							>
								<SvgIcon name="plus" size={12} className="mr-0.5" />
								使用
							</Button>
						)}
					<Button
						variant="ghost"
						size="sm"
						className="!px-1 !py-0 !min-h-0 !h-6 text-xs text-ink-muted hover:bg-error-bg hover:text-error-fg focus-visible:text-error-fg"
						onClick={() => onDelete(asset)}
						aria-label={`删除资产 ${asset.name}`}
						title="删除资产"
					>
						<SvgIcon name="x" size={12} />
					</Button>
				</div>
			</div>
		</div>
	);
}

/* ---------- Asset Drawer ---------- */

export function AssetDrawer({ open, onClose, projectId }: AssetDrawerProps) {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<AssetType | "all">("all");
	const [search, setSearch] = useState("");
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

	const assetType = activeTab === "all" ? undefined : activeTab;

	const { data, isLoading } = useQuery({
		queryKey: ["assets", assetType, search],
		queryFn: () => assetsApi.list({ assetType, search: search || undefined }),
		enabled: open,
	});

	const deleteMutation = useMutation({
		mutationFn: (asset: Asset) => assetsApi.delete(asset.id),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["assets"] });
			setDeleteTarget(null);
		},
		onError: (error: Error) => {
			toast.error({
				title: "删除失败",
				message: error.message || "未知错误",
			});
		},
	});

	const useMutation_ = useMutation({
		mutationFn: (asset: Asset) => assetsApi.useInProject(asset.id, projectId!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["assets"] });
			if (projectId) {
				queryClient.invalidateQueries({
					queryKey: ["project", projectId, "characters"],
				});
				queryClient.invalidateQueries({
					queryKey: ["project", projectId, "shots"],
				});
			}
		},
	});

	const items = data?.items ?? [];

	return (
		<>
			<Dialog
				open={open}
				onClose={onClose}
				variant="sheet-right"
				labelledBy="asset-drawer-title"
				className="flex w-72 flex-col"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
					<div className="flex items-center gap-1.5">
						<SvgIcon name="archive" size={14} className="text-primary" />
						<h3 id="asset-drawer-title" className="m-0 text-sm font-bold">
							资产库
						</h3>
						<span className="badge-doodle text-xs px-1.5 py-0.5 bg-paper-200 text-ink-muted border-line tabular-nums">
							{data?.total ?? 0}
						</span>
					</div>
					<div className="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="sm"
							className="!h-7 !px-1.5 text-primary"
							onClick={() => setShowCreateForm(true)}
							title="新建资产"
							aria-label="新建资产"
						>
							<SvgIcon name="plus" size={14} />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="!h-7 !px-1.5"
							onClick={onClose}
							aria-label="关闭资产库"
						>
							<SvgIcon name="x" size={14} />
						</Button>
					</div>
				</div>

				<div className="flex shrink-0 border-b border-line bg-paper-200/50">
					{ASSET_TABS.map((tab) => (
						<PlainButton
							key={tab.key}
							className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors duration-fast border-b-2 -mb-px ${
								activeTab === tab.key
									? "border-primary bg-surface text-primary font-semibold"
									: "border-transparent text-ink-muted hover:text-ink"
							}`}
							onClick={() => setActiveTab(tab.key)}
						>
							<SvgIcon name={tab.icon} size={12} />
							{tab.label}
						</PlainButton>
					))}
				</div>

				{/* Search */}
				<div className="shrink-0 border-b border-line px-3 py-2">
					<input
						type="search"
						placeholder="搜索资产名称…"
						aria-label="搜索资产名称"
						className="input-doodle h-8 w-full px-2.5 text-xs"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				{/* Content */}
				<div className="min-h-0 flex-1 overflow-y-auto p-3">
					{isLoading ? (
						<div className="grid grid-cols-2 gap-2" role="status" aria-busy="true" aria-label="正在加载资产">
							{[0, 1, 2, 3].map((idx) => (
								<div key={idx} className="card-doodle p-2" aria-hidden="true">
									<div className="skeleton-line h-28 w-full rounded-sm" />
									<div className="skeleton-line mt-2 h-3.5 w-2/3" />
									<div className="skeleton-line mt-1.5 h-3 w-full" />
								</div>
							))}
						</div>
					) : items.length === 0 ? (
						<div className="corner-marks rounded-md border border-dashed border-line bg-paper-100/60 px-3 py-8 text-center text-xs text-ink-muted">
							<SvgIcon
								name="layers"
								size={24}
								className="mx-auto mb-2 text-ink-faint"
							/>
							{search ? (
								<p className="m-0 font-semibold text-ink">没有匹配的资产</p>
							) : (
								<>
									<p className="m-0 font-semibold text-ink">还没有保存的资产</p>
									<p className="m-0 mt-1 text-ink-muted">
										点击右上角{" "}
										<SvgIcon name="plus" size={12} className="inline" />{" "}
										新建，或在画布角色卡片点击{" "}
										<SvgIcon name="star" size={12} className="inline" />{" "}
										收藏复用
									</p>
								</>
							)}
						</div>
					) : (
						<div className="grid grid-cols-2 gap-2">
							{items.map((a) => (
								<AssetCard
									key={a.id}
									asset={a}
									projectId={projectId}
									onDelete={setDeleteTarget}
									onUse={(asset) => useMutation_.mutate(asset)}
									isUsing={useMutation_.isPending}
								/>
							))}
						</div>
					)}
				</div>
			</Dialog>

			{/* Create Asset Form — overlays the drawer */}
			<CreateAssetForm
				isOpen={showCreateForm}
				onClose={() => setShowCreateForm(false)}
				onCreated={() => setShowCreateForm(false)}
			/>
			<ConfirmModal
				isOpen={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				onConfirm={() => {
					if (deleteTarget) deleteMutation.mutate(deleteTarget);
				}}
				title="删除资产"
				message={`确定要删除资产“${deleteTarget?.name ?? ""}”吗？删除后将无法恢复。`}
				confirmText="删除"
				cancelText="取消"
				variant="danger"
				isLoading={deleteMutation.isPending}
			/>
		</>
	);
}
