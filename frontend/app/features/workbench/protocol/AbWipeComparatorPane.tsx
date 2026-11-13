import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { PlainButton } from "~/components/ui/PlainButton";
import { Slider } from "~/components/ui/Slider";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { projectQueryKeys } from "~/query/queryKeys";
import { getStaticUrl, shotsApi, versionsApi } from "~/services/api";
import { useEditorStore } from "~/stores/editorStore";
import type { ArtifactVersion, Shot } from "~/types";
import { ApiError } from "~/types/errors";
import { toast } from "~/utils/toast";
import { appendProtocolLog } from "./protocolLogStore";

interface AbWipeComparatorPaneProps {
	projectId: number;
	shots: Shot[];
	selectedShotId: number | null;
}

function snapshotImageUrl(version: ArtifactVersion | undefined): string | null {
	if (!version) return null;
	const raw = version.snapshot?.image_url;
	return typeof raw === "string" && raw.trim() ? raw : null;
}

export function AbWipeComparatorPane({
	projectId,
	shots,
	selectedShotId,
}: AbWipeComparatorPaneProps) {
	const queryClient = useQueryClient();
	const wipeShotId = useEditorStore((s) => s.wipeShotId);
	const setWipeShotId = useEditorStore((s) => s.setWipeShotId);
	const wipePct = useEditorStore((s) => s.wipePct);
	const setWipePct = useEditorStore((s) => s.setWipePct);

	const [conflictMessage, setConflictMessage] = useState<string | null>(null);
	const [reverting, setReverting] = useState(false);
	const viewportRef = useRef<HTMLDivElement>(null);
	const wipingRef = useRef(false);

	const updateWipeFromClientX = (clientX: number) => {
		const el = viewportRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0) return;
		const pct = ((clientX - rect.left) / rect.width) * 100;
		setWipePct(pct);
	};

	const orderedShots = useMemo(
		() => [...shots].sort((a, b) => a.order - b.order || a.id - b.id),
		[shots],
	);

	const activeShot = useMemo(() => {
		if (wipeShotId != null) {
			const picked = orderedShots.find((s) => s.id === wipeShotId);
			if (picked) return picked;
		}
		if (selectedShotId != null) {
			const picked = orderedShots.find((s) => s.id === selectedShotId);
			if (picked) return picked;
		}
		return (
			orderedShots.find(
				(s) => s.review_status === "failed" || s.review_status === "unchecked",
			) ??
			orderedShots.find((s) => Boolean(s.image_url)) ??
			orderedShots[0] ??
			null
		);
	}, [orderedShots, selectedShotId, wipeShotId]);

	const { data: versionData } = useQuery({
		queryKey: ["versions", projectId, "shot", activeShot?.id ?? 0],
		queryFn: () => versionsApi.list(projectId, "shot", activeShot!.id),
		enabled: Boolean(projectId > 0 && activeShot?.id),
	});

	const versions = versionData?.versions ?? [];
	const currentVersion = versions[0];
	const previousVersion =
		versions.find((v, idx) => idx > 0 && snapshotImageUrl(v) !== activeShot?.image_url) ??
		versions[1] ??
		null;

	const currentImg = getStaticUrl(activeShot?.image_url ?? snapshotImageUrl(currentVersion));
	const prevRawUrl = snapshotImageUrl(previousVersion ?? undefined);
	const prevImg = getStaticUrl(prevRawUrl);

	const handleCasRevert = async () => {
		if (!activeShot || reverting) return;
		const expectedRevision = activeShot.revision ?? 1;
		setReverting(true);
		setConflictMessage(null);
		try {
			await shotsApi.patch(activeShot.id, {
				expected_revision: expectedRevision,
				...(prevRawUrl ? { image_url: prevRawUrl } : {}),
			});
			if (previousVersion) {
				await versionsApi.rollback("shot", activeShot.id, previousVersion.version);
			}
			appendProtocolLog(projectId, {
				channel: "RPC",
				direction: "SYS",
				source: "CAS",
				summary: `PATCH /shots/${activeShot.id} expected_revision=${expectedRevision} 回退成功`,
				payload: {
					shot_id: activeShot.id,
					expected_revision: expectedRevision,
					target_version: previousVersion?.version ?? null,
					image_url: prevRawUrl,
				},
			});
			await queryClient.invalidateQueries({ queryKey: projectQueryKeys.shots(projectId) });
			await queryClient.invalidateQueries({
				queryKey: ["versions", projectId, "shot", activeShot.id],
			});
			toast.success({
				title: "CAS 版本回退成功",
				message: `S${String(activeShot.order).padStart(2, "0")} 已安全回退`,
			});
		} catch (error) {
			const apiError = error instanceof ApiError ? error : null;
			if (apiError?.status === 409) {
				const detail =
					apiError.message ||
					`版本冲突（409）：预期 rev=${expectedRevision}，服务端已被其他操作更新`;
				setConflictMessage(detail);
				appendProtocolLog(projectId, {
					channel: "ERROR",
					direction: "IN",
					source: "CAS 409",
					summary: detail,
					payload: {
						shot_id: activeShot.id,
						expected_revision: expectedRevision,
						status: 409,
						response: apiError.response,
					},
				});
				toast.error({ title: "409 版本冲突", message: detail });
			} else {
				const msg = apiError?.message || (error instanceof Error ? error.message : "回退失败");
				toast.error({ title: "CAS 回退失败", message: msg });
			}
		} finally {
			setReverting(false);
		}
	};

	const handleRefreshShot = () => {
		setConflictMessage(null);
		void queryClient.invalidateQueries({ queryKey: projectQueryKeys.shots(projectId) });
		if (activeShot) {
			void queryClient.invalidateQueries({
				queryKey: ["versions", projectId, "shot", activeShot.id],
			});
		}
	};

	return (
		<section
			className="flex min-h-0 flex-col overflow-hidden border-r border-line bg-surface"
			aria-label="A/B Wipe 对比器"
			data-testid="ab-wipe-pane"
		>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper-200 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-xs font-semibold text-ink">A/B Wipe 对比</span>
					{activeShot ? (
						<span className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">
							S{String(activeShot.order).padStart(2, "0")} · rev={activeShot.revision ?? 1}
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-1">
					{orderedShots.length > 1 && activeShot ? (
						<div className="flex items-center gap-0.5">
							{orderedShots.slice(0, 5).map((shot) => (
								<PlainButton
									key={shot.id}
									onClick={() => {
										setConflictMessage(null);
										setWipeShotId(shot.id);
									}}
									className={`rounded-sm px-1.5 py-0.5 font-mono text-xs transition-colors duration-fast ${
										shot.id === activeShot.id
											? "bg-primary text-primary-content"
											: "text-ink-muted hover:bg-surface hover:text-ink"
									}`}
									aria-label={`对比分镜 S${String(shot.order).padStart(2, "0")}`}
								>
									S{String(shot.order).padStart(2, "0")}
								</PlainButton>
							))}
						</div>
					) : null}
					<Button
						size="xs"
						variant="secondary"
						disabled={!activeShot || reverting || (!previousVersion && !prevRawUrl)}
						onClick={() => void handleCasRevert()}
						aria-label="CAS 回退到上一版本"
					>
						<SvgIcon name="refresh-cw" size={12} />
						CAS 回退
					</Button>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
				{conflictMessage ? (
					<div
						className="flex items-center justify-between gap-2 rounded-md border border-error/40 bg-error-bg px-2.5 py-1.5 text-xs text-error-fg"
						role="alert"
						data-testid="cas-conflict-alert"
					>
						<span className="min-w-0 flex-1 truncate">{conflictMessage}</span>
						<Button size="xs" variant="danger" onClick={handleRefreshShot}>
							刷新最新
						</Button>
					</div>
				) : null}

				{!activeShot ? (
					<div className="corner-marks flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong bg-paper-100 p-4 text-center text-xs text-ink-muted">
						生成分镜首帧后，可在此对比版本并执行 CAS 回退
					</div>
				) : (
					<>
						<div
							ref={viewportRef}
							className="relative min-h-40 flex-1 touch-none select-none overflow-hidden rounded-md border border-line bg-paper-200 cursor-ew-resize"
							data-testid="ab-wipe-viewport"
							onPointerDown={(event) => {
								wipingRef.current = true;
								event.currentTarget.setPointerCapture?.(event.pointerId);
								updateWipeFromClientX(event.clientX);
							}}
							onPointerMove={(event) => {
								if (!wipingRef.current) return;
								updateWipeFromClientX(event.clientX);
							}}
							onPointerUp={(event) => {
								wipingRef.current = false;
								event.currentTarget.releasePointerCapture?.(event.pointerId);
							}}
							onPointerCancel={() => {
								wipingRef.current = false;
							}}
						>
							{currentImg ? (
								<img
									src={currentImg}
									alt={`S${String(activeShot.order).padStart(2, "0")} 当前版本 B`}
									className="h-full w-full object-cover"
									draggable={false}
								/>
							) : (
								<div className="media-blank flex h-full w-full items-center justify-center text-xs text-ink-muted">
									当前版本 B 暂无图像
								</div>
							)}

							<div
								className="pointer-events-none absolute inset-0 overflow-hidden"
								style={{ clipPath: `inset(0 ${100 - wipePct}% 0 0)` }}
								data-testid="ab-wipe-overlay"
							>
								{prevImg ? (
									<img
										src={prevImg}
										alt={`S${String(activeShot.order).padStart(2, "0")} 原稿版本 A`}
										className="h-full w-full object-cover"
										draggable={false}
									/>
								) : (
									<div className="flex h-full w-full items-center justify-center bg-paper-300 text-xs text-ink-muted">
										{currentImg ? "暂无上一版图像快照" : "原稿 A 暂无图像"}
									</div>
								)}
							</div>

							{/* 分割线 */}
							<div
								className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-primary"
								style={{ left: `${wipePct}%` }}
								aria-hidden="true"
							/>

							<span className="absolute left-2 top-2 rounded-sm bg-ink/80 px-1.5 py-0.5 text-xs text-paper-100">
								{previousVersion ? `A · v${previousVersion.version}` : "A · 原稿"}
							</span>
							<span className="absolute right-2 top-2 rounded-sm bg-primary/90 px-1.5 py-0.5 text-xs text-primary-content">
								{currentVersion ? `B · v${currentVersion.version}` : "B · 当前"}
							</span>
						</div>

						<div className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
							<span className="shrink-0 font-mono">Wipe {wipePct}%</span>
							<Slider
								min={0}
								max={100}
								step={1}
								value={[wipePct]}
								onValueChange={([val]) => setWipePct(val ?? 50)}
								aria-label="A/B 对比分隔线位置"
								className="flex-1"
							/>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
