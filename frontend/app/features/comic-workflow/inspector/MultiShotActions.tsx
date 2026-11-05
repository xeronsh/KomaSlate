import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { shotsApi } from "~/services/api";
import { toast } from "~/utils/toast";
import { ActionButton, errorMessage, LockNotice, lockReason } from "./fields";
import "~/components/ui/icons/workbenchIcons";

/** 多选分镜：批量重做。 */
export function MultiShotActions({
	projectId,
	shotIds,
	structureLocked,
	atGate = false,
}: {
	projectId: number;
	shotIds: number[];
	structureLocked: boolean;
	/** 停在审批门：锁定说明改成"该怎么改" */
	atGate?: boolean;
}) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const writeDisabled = structureLocked || Boolean(busy);

	const batchRegen = (type: "image" | "video") =>
		void (async () => {
			setBusy(type);
			try {
				const settled = await Promise.allSettled(
					shotIds.map((id) => shotsApi.regenerate(id, type)),
				);
				const succeeded = settled.filter((r) => r.status === "fulfilled").length;
				const failed = shotIds.length - succeeded;
				if (succeeded > 0) {
					queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
				}
				if (failed === 0) {
					toast.success({
						title: type === "image" ? "批量重做首帧" : "批量重做视频",
						message: `已为 ${shotIds.length} 格启动任务`,
					});
				} else if (succeeded > 0) {
					toast.warning({
						title: "部分分镜重做已启动",
						message: `已启动 ${succeeded} 格，${failed} 格失败`,
					});
				} else {
					const firstReason = settled.find(
						(r): r is PromiseRejectedResult => r.status === "rejected",
					)?.reason;
					toast.error({
						title: "批量重做失败",
						message: errorMessage(firstReason, "请重试"),
					});
				}
			} finally {
				setBusy(null);
			}
		})();

	return (
		<div className="flex h-full min-h-0 flex-col bg-paper-100 p-2" data-shell="inspector-multi">
			<p className="m-0 label text-ink-muted">
				批量操作
			</p>
			<h2 className="m-0 text-sm font-bold">
				已选 {shotIds.length} 格
			</h2>
			<p className="m-0 mt-1 text-xs text-ink-muted">
				批量只动选中格 · 不改其他分镜
			</p>
			<div className="mt-2 space-y-1.5">
				{structureLocked ? <LockNotice atGate={atGate} what="批量操作" /> : null}
				<ActionButton
					icon="refresh-cw"
					label={`重做首帧 · ${shotIds.length} 格`}
					primary
					disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
					loading={busy === "image"}
					onClick={() => batchRegen("image")}
				/>
				<ActionButton
					icon="play"
					label={`重做视频 · ${shotIds.length} 格`}
					disabledReason={structureLocked ? lockReason(atGate) : undefined} disabled={writeDisabled}
					loading={busy === "video"}
					onClick={() => batchRegen("video")}
				/>
			</div>
		</div>
	);
}
