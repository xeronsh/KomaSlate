import { describe, expect, it, vi } from "vitest";
import { applyInvalidationPlan, cascadeShotInvalidation, type RerunIntent } from "../src/invalidation.js";
import type { SharedDb, ShotRow } from "../src/shared-db.js";

/**
 * Rerun intent only resolves the entry stage. Existing media stays visible until
 * the replacement commits, so resolving an intent must never clear artifacts.
 */
function fakeShared() {
  const updateCharacter = vi.fn();
  const updateShot = vi.fn();
  const updateProject = vi.fn();
  const shared = { updateCharacter, updateShot, updateProject } as unknown as SharedDb;
  return { shared, writes: [updateCharacter, updateShot, updateProject] };
}

function intent(overrides: Partial<RerunIntent> = {}): RerunIntent {
  return {
    version: 1,
    start_stage: "render_characters",
    scope: { entity_type: "character", entity_ids: [1] },
    ...overrides,
  };
}

describe("rerun intent resolution", () => {
  it("returns the requested stage without clearing existing media", () => {
    const { shared, writes } = fakeShared();

    expect(applyInvalidationPlan(shared, 99, intent())).toBe("render_characters");
    expect(
      applyInvalidationPlan(
        shared,
        99,
        intent({ start_stage: "render_shots", scope: { entity_type: "shot", entity_ids: [11] } }),
      ),
    ).toBe("render_shots");
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it("falls back to the first stage for an unknown stage", () => {
    const { shared, writes } = fakeShared();

    expect(applyInvalidationPlan(shared, 99, intent({ start_stage: "unknown" }))).toBe(
      "plan_outline",
    );
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it("rejects an unsupported intent version", () => {
    const { shared } = fakeShared();

    expect(() => applyInvalidationPlan(shared, 99, intent({ version: 2 }))).toThrow(
      /unsupported rerun intent version 2/,
    );
  });
});

describe("cascading shot invalidation (ENG-05)", () => {
  function makeShot(id: number, order: number, overrides: Partial<ShotRow> = {}): ShotRow {
    return {
      id,
      project_id: 1,
      order,
      description: `Shot ${order}`,
      prompt: null,
      image_prompt: null,
      image_url: `/static/s${order}.png`,
      video_url: null,
      duration: 5,
      camera: null,
      motion_note: null,
      scene: null,
      action: null,
      expression: null,
      lighting: null,
      dialogue: null,
      sfx: null,
      tts_url: null,
      bgm_type: null,
      review_status: "passed",
      review_note: null,
      seed: null,
      character_ids: "[]",
      approved_description: null,
      approved_prompt: null,
      approved_image_prompt: null,
      approved_duration: null,
      approved_camera: null,
      approved_motion_note: null,
      approved_scene: null,
      approved_action: null,
      approved_expression: null,
      approved_lighting: null,
      approved_dialogue: null,
      approved_sfx: null,
      approved_character_ids: null,
      approved_at: null,
      approval_version: 0,
      revision: 1,
      ...overrides,
    };
  }

  it("marks unlocked downstream shots unchecked and emits shot_invalidation_cascaded", () => {
    const shots = [
      makeShot(1, 1),
      makeShot(2, 2),
      makeShot(3, 3),
      makeShot(4, 4, {
        approval_version: 1,
        approved_at: "2026-11-13T00:00:00Z",
        approved_description: "Shot 4",
        approved_duration: 5,
        approved_character_ids: "[]",
      }),
    ];
    const updates: Array<{ id: number; fields: Record<string, unknown>; expectedRevision?: number }> = [];
    const emitted: Array<{ type: string; data: Record<string, unknown> }> = [];
    const shared = {
      getLiveShotsForProject: () => shots,
      updateShot: (id: number, fields: Record<string, unknown>, expectedRevision?: number) => {
        updates.push({ id, fields, expectedRevision });
      },
    } as unknown as SharedDb;
    const emitter = {
      emit: (type: string, data: Record<string, unknown>) => emitted.push({ type, data }),
    };

    const result = cascadeShotInvalidation(shared, emitter, 1, 7, 1);

    expect(result).toEqual({ sourceShotId: 1, invalidatedShotIds: [2, 3] });
    expect(updates.map((u) => [u.id, u.fields.review_status, u.expectedRevision])).toEqual([
      [2, "unchecked", 1],
      [3, "unchecked", 1],
    ]);
    const cascaded = emitted.find((e) => e.type === "shot_invalidation_cascaded");
    expect(cascaded?.data).toMatchObject({
      project_id: 1,
      run_id: 7,
      source_shot_id: 1,
      invalidated_shot_ids: [2, 3],
    });
    expect(emitted.filter((e) => e.type === "shot_updated")).toHaveLength(2);
  });
});
