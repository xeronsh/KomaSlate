import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { ConfirmModal } from "~/components/ui/ConfirmModal";
import { Input } from "~/components/ui/Input";
import { assetsApi, charactersApi, getStaticUrl, shotsApi, universesApi, versionsApi } from "~/services/api";
import { removeCharacterFromCache, removeShotFromCache, upsertCharacterInCache, upsertShotInCache } from "~/query/applyServerEvent";
import { toast } from "~/utils/toast";
import type { ArtifactVersion } from "~/types";
import type { ComicWorkflowNode } from "../graph/types";
import { ActionButton, ActionStack, errorMessage, LockNotice, lockReason } from "./fields";
import { MultiShotActions } from "./MultiShotActions";
import "~/components/ui/icons/workbenchIcons";

/** 生成：批准、重做、资产与宇宙同步、删除。 */
export function GenerationSection({
	projectId,
	node,
	structureLocked,
	atGate = false,
	universeId = null,
	multiShotIds = [],
	compact = false,
	onActionDone,
}: {
	projectId: number;
	node: ComicWorkflowNode;
	structureLocked: boolean;
	/** 停在审批门：锁定说明改成"该怎么改" */
	atGate?: boolean;
	universeId?: number | null;
	multiShotIds?: number[];
	/** 右键菜单里用：省掉说明文字 */
	compact?: boolean;
	/** 动作触发完成后的回调（例如关闭右键浮层） */
	onActionDone?: () => void;
}) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	// 单镜微调指令：只作用于这一次重做，成功后清空
	const [feedback, setFeedback] = useState("");
	useEffect(() => {
		setFeedback("");
		setConfirmDeleteOpen(false);
	}, [projectId, node.kind, node.entityId]);
	const writeDisabled = structureLocked || Boolean(busy);

	if (multiShotIds.length > 1) {
		return (
			<MultiShotActions
				projectId={projectId}
				shotIds={multiShotIds}
				structureLocked={structureLocked}
			/>
		);
	}

	const invalidateProjectData = () => {
		queryClient.invalidateQueries({ queryKey: ["project", projectId] });
		queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
		queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
		queryClient.invalidateQueries({ queryKey: ["assets"] });
	};

	const runAction = async (key: string, action: () => Promise<void>) => {
		setBusy(key);
		try {
			await action();
			invalidateProjectData();
		} catch (error) {
			toast.error({ title: "操作失败", message: errorMessage(error, "操作失败") });
		} finally {
			setBusy(null);
		}
	};

	if (node.kind === "brief") {
		return (
			<ActionStack>
				<p className="m-0 text-sm text-ink-muted">
					Brief 只在内容页编辑。生成、恢复和停止由对话面板控制。
				</p>
			</ActionStack>
		);
	}

	if (node.kind === "output") {
		const videoUrl = getStaticUrl(node.videoUrl);
		return (
			<ActionStack>
				<ActionButton
					icon="play"
					label="预览成片"
					disabled={!videoUrl}
					onClick={() => {
						if (!videoUrl) return;
						canvasEvents.emit("preview-video", {
							src: videoUrl,
							title: "最终成片",
						});
						onActionDone?.();
					}}
				/>
				<p className="m-0 text-xs text-ink-muted">
					输出节点状态由镜头和合成结果决定，不在画布里手动改写。
				</p>
			</ActionStack>
		);
	}

	const entityId = node.entityId;

	const approve = () => {
		onActionDone?.();
		return runAction("approve", async () => {
			if (node.kind === "character") {
				const updated = await charactersApi.approve(entityId);
				upsertCharacterInCache(queryClient, updated.project_id, updated);
			} else {
				const updated = await shotsApi.approve(entityId);
				upsertShotInCache(queryClient, updated.project_id, updated);
			}
			toast.success({ title: "审阅", message: "已批准" });
		});
	};

	const regenerate = (type: "image" | "video" = "image") => {
		onActionDone?.();
		return runAction(type === "image" ? "regenerate" : "regenerate-video", async () => {
			if (node.kind === "character") {
				await charactersApi.regenerate(entityId);
			} else {
				const trimmed = feedback.trim();
				if (trimmed) {
					await shotsApi.regenerate(entityId, type, trimmed);
				} else {
					await shotsApi.regenerate(entityId, type);
				}
				setFeedback("");
			}
			const cell =
				node.kind === "shot" ? node.title : "当前角色";
			toast.success({
				title:
					node.kind === "character"
						? "重新生成当前角色"
						: type === "image"
							? `重做本格 · 首帧（${cell}）`
							: `重做本格 · 视频（${cell}）`,
				message: "任务已启动，仅影响选中实体",
			});
		});
	};

	// 版本切换：回到上一版本身也会记成新版本，所以再点一次就切回来
	const swapToPrevious = () => {
		onActionDone?.();
		return runAction("previous", async () => {
			const kind = node.kind === "character" ? "character" : "shot";
			const { versions } = await versionsApi.list(projectId, kind, entityId);
			const target = previousVersion(versions);
			if (!target) {
				toast.info({ title: "版本", message: "还没有上一版，重做一次之后才能切换" });
				return;
			}
			await versionsApi.rollback(kind, entityId, target.version);
			toast.success({ title: "已换回上一版", message: `内容来自 v${target.version}，再点一次可切回` });
		});
	};

	const addToAssets = () => {
		onActionDone?.();
		return runAction("asset", async () => {
			if (node.kind === "character") {
				await assetsApi.createFromCharacter(entityId);
			} else {
				await assetsApi.createFromShot(entityId);
			}
			toast.success({ title: "资产库", message: "已保存" });
		});
	};

	const promoteToUniverse = () => {
		onActionDone?.();
		return runAction("promote", async () => {
			if (!universeId || node.kind !== "character") return;
			await universesApi.promoteCharacter(universeId, entityId);
			queryClient.invalidateQueries({ queryKey: ["universe", universeId] });
			toast.success({
				title: "已提升到宇宙",
				message: "共享角色库已更新，后续章节可沿用",
			});
		});
	};

	const syncToUniverse = () => {
		onActionDone?.();
		return runAction("sync", async () => {
			if (node.kind !== "character") return;
			await universesApi.syncCharacter(entityId);
			if (universeId) {
				queryClient.invalidateQueries({ queryKey: ["universe", universeId] });
			}
			toast.success({
				title: "已同步回宇宙",
				message: "共享角色圣经版本 +1",
			});
		});
	};

	const confirmDelete = () =>
		runAction("delete", async () => {
			if (node.kind === "character") {
				await charactersApi.delete(entityId);
				removeCharacterFromCache(queryClient, projectId, entityId);
			} else {
				await shotsApi.delete(entityId);
				removeShotFromCache(queryClient, projectId, entityId);
			}
			setConfirmDeleteOpen(false);
			onActionDone?.();
			toast.success({ title: "删除", message: "已删除" });
		});

	const shotCellLabel =
		node.kind === "shot" ? node.title : null;

	return (
		<ActionStack>
			{structureLocked ? <LockNotice atGate={atGate} /> : null}
			{shotCellLabel && !compact && !structureLocked ? (
				<div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs leading-relaxed text-ink-muted">
					<strong className="text-primary">{shotCellLabel}</strong>
					{" · "}
					重做只刷新这一格，不影响其他分镜与角色资产。也可在对话里绑定本格发反馈；可多选多格批量重做。
				</div>
			) : null}
			<ActionButton
				icon="check"
				label={node.status === "approved" ? "已批准" : "批准此节点"}
				primary
				disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled || node.status === "approved"}
				loading={busy === "approve"}
				onClick={approve}
			/>
			{node.kind === "shot" ? (
				<>
					<Input
						density="compact"
						label="单镜微调指令（可选）"
						value={feedback}
						placeholder="如：改用仰拍、加强逆光"
						disabled={writeDisabled}
						onChange={(event) => setFeedback(event.target.value)}
					/>
					<ActionButton
						icon="refresh-cw"
						label={`重做首帧 · ${shotCellLabel}`}
						disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
						loading={busy === "regenerate"}
						onClick={() => regenerate("image")}
					/>
					<ActionButton
						icon="play"
						label={`重做视频 · ${shotCellLabel}`}
						disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
						loading={busy === "regenerate-video"}
						onClick={() => regenerate("video")}
					/>
				</>
			) : (
				<>
					<ActionButton
						icon="refresh-cw"
						label="重新生成当前角色"
						disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
						loading={busy === "regenerate"}
						onClick={() => regenerate("image")}
					/>
					{universeId ? (
						<>
							<ActionButton
								icon="star"
								label="提升到宇宙共享角色"
								disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
								loading={busy === "promote"}
								onClick={promoteToUniverse}
							/>
							<ActionButton
								icon="refresh-cw"
								label="同步变更回宇宙"
								disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
								loading={busy === "sync"}
								onClick={syncToUniverse}
							/>
						</>
					) : null}
				</>
			)}
			<ActionButton
				icon="clock-3"
				label="换回上一版"
				disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
				loading={busy === "previous"}
				onClick={swapToPrevious}
			/>
			<ActionButton
				icon="archive"
				label="保存到资产库"
				disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
				loading={busy === "asset"}
				onClick={addToAssets}
			/>
			<div className="border-t border-line pt-3">
				<ActionButton
					icon="trash-2"
					label="删除"
					danger
					disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
					loading={busy === "delete"}
					onClick={() => setConfirmDeleteOpen(true)}
				/>
			</div>
			<ConfirmModal
				isOpen={confirmDeleteOpen}
				onClose={() => {
					setConfirmDeleteOpen(false);
					onActionDone?.();
				}}
				onConfirm={confirmDelete}
				title={node.kind === "character" ? "删除角色" : "删除镜头"}
				message={deleteMessage(node)}
				confirmText="删除"
				cancelText="取消"
				variant="danger"
				isLoading={busy === "delete"}
			/>
		</ActionStack>
	);
}

function deleteMessage(node: ComicWorkflowNode): string {
	if (node.kind === "character") {
		return "确定删除这个角色吗？引用它的镜头会失去角色关联。";
	}
	if (node.kind === "shot") {
		return "确定删除这个镜头吗？镜头顺序和最终合成需要重新确认。";
	}
	return "确定删除吗？";
}

/** 上一版：列表按新到旧排，第二条就是当前之前的那一版。 */
export function previousVersion(versions: ArtifactVersion[]): ArtifactVersion | null {
	const sorted = [...versions].sort((a, b) => b.version - a.version);
	return sorted[1] ?? null;
}
