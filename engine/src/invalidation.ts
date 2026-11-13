import { STAGE_ORDER, type StageId } from "./contract.js";
import { shotApprovalState, shotReadPayload, type SharedDb } from "./shared-db.js";

export interface RerunIntent {
  version: number;
  start_stage: string;
  scope: {
    entity_type: "character" | "shot" | null;
    entity_ids: number[];
  };
}

export interface CascadeInvalidationResult {
  sourceShotId: number;
  invalidatedShotIds: number[];
}

/** Resolve the rerun entry stage; media stays available until replacement succeeds. */
export function applyInvalidationPlan(
  shared: SharedDb,
  projectId: number,
  intent: RerunIntent,
): StageId {
  void shared;
  void projectId;
  if (intent.version !== 1) throw new Error(`unsupported rerun intent version ${intent.version}`);
  return (STAGE_ORDER as readonly string[]).includes(intent.start_stage)
    ? (intent.start_stage as StageId)
    : "plan_outline";
}

/**
 * Keyframe chaining invalidation: when shot k is redrawn, traverse downstream
 * shots k+1..N along the continuity chain, mark any unlocked shots that already
 * have rendered media or review state as `unchecked`, and emit
 * `shot_invalidation_cascaded` via the durable Outbox.
 */
export function cascadeShotInvalidation(
  shared: SharedDb,
  emitter: { emit: (type: string, data: Record<string, unknown>) => void },
  projectId: number,
  runId: number | null,
  sourceShotId: number,
  options: { excludeShotIds?: ReadonlySet<number>; reason?: string } = {},
): CascadeInvalidationResult {
  const allShots = shared.getLiveShotsForProject(projectId);
  const sourceIndex = allShots.findIndex((shot) => shot.id === sourceShotId);
  if (sourceIndex < 0) return { sourceShotId, invalidatedShotIds: [] };

  const sourceShot = allShots[sourceIndex]!;
  const sourceLabel = `S${String(sourceShot.order).padStart(2, "0")}`;
  const reason = options.reason ?? `上游分镜 ${sourceLabel} 画面已重绘，需重新检查连续性`;
  const invalidatedShotIds: number[] = [];

  for (let i = sourceIndex + 1; i < allShots.length; i += 1) {
    const downstream = allShots[i]!;
    if (options.excludeShotIds?.has(downstream.id)) continue;
    if (shotApprovalState(downstream) === "approved") continue;
    const hasRenderedOrReviewed = Boolean(
      downstream.image_url || downstream.video_url || downstream.review_status,
    );
    if (!hasRenderedOrReviewed) continue;

    if (downstream.review_status !== "unchecked" || downstream.review_note !== reason) {
      shared.updateShot(
        downstream.id,
        { review_status: "unchecked", review_note: reason },
        downstream.revision,
      );
      emitter.emit("shot_updated", {
        shot: shotReadPayload({
          ...downstream,
          review_status: "unchecked",
          review_note: reason,
          revision: downstream.revision + 1,
        }),
      });
    }
    invalidatedShotIds.push(downstream.id);
  }

  if (invalidatedShotIds.length > 0) {
    emitter.emit("shot_invalidation_cascaded", {
      project_id: projectId,
      run_id: runId,
      source_shot_id: sourceShotId,
      invalidated_shot_ids: invalidatedShotIds,
      reason,
    });
  }

  return { sourceShotId, invalidatedShotIds };
}
