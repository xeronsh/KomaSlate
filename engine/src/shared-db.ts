/**
 * Domain persistence on the app's shared SQLite schema.
 *
 * Column names/types mirror the SQLModel tables (backend/app/models). All
 * writes are parameterized prepared statements on better-sqlite3.
 *
 * A pipeline receives a fenced SharedDb instance. Every mutation checks the
 * run's durable lease token first, so an expired/orphan executor can finish an
 * external provider request but cannot commit stale data afterwards.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface ProjectRow {
  id: number;
  title: string | null;
  story: string | null;
  style: string | null;
  summary: string | null;
  status: string | null;
  video_url: string | null;
  target_shot_count: number | null;
  character_hints: string | null; // JSON
  creation_mode: string | null;
  reference_images: string | null; // JSON
  skill_id: string | null;
  story_outline: string | null; // JSON
  visual_bible: string | null;
  outline_approved: boolean | number | null;
  revision: number;
  /** JSON: per-project tts / subtitles / bgm switches; null follows settings */
  media_options?: string | null;
}

export interface AgentRunRow {
  id: number;
  project_id: number;
  status: string;
  current_agent: string | null;
  progress: number;
  error: string | null;
  confirm_requested: 0 | 1 | boolean | null;
  awaiting_payload: string | null;
  workflow_version: number;
  execution_attempt: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  cancel_requested_at: string | null;
  context_snapshot: string | null;
  /** Pending "request changes" at a gate (absent on pre-0029 schemas). */
  gate_feedback?: string | null;
}

export interface GateFeedbackSignal {
  id: string | null;
  content: string;
  entityType: "character" | "shot" | null;
  entityIds: number[];
  /** Round number assigned by the gateway from persisted receipts. */
  round?: number | null;
}

/** Timeline row role for a persisted gate feedback receipt. */
export const FEEDBACK_RECEIPT_ROLE = "feedback_receipt";

export interface FeedbackReceiptRecord {
  id: string;
  round: number;
  state: string;
  content: string;
  reason: string | null;
  gate: string | null;
  stage: string | null;
  entity_type: string | null;
  entity_ids: number[] | null;
}

export function parseGateFeedback(raw: string): GateFeedbackSignal | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content) return null;
  const entityType =
    record.entity_type === "character" || record.entity_type === "shot" ? record.entity_type : null;
  const entityIds = Array.isArray(record.entity_ids)
    ? record.entity_ids.filter((id): id is number => Number.isInteger(id) && (id as number) > 0)
    : [];
  return {
    id: typeof record.id === "string" ? record.id : null,
    content,
    entityType: entityIds.length ? entityType : null,
    entityIds: entityType ? entityIds : [],
    round: Number.isInteger(record.round) && (record.round as number) > 0 ? (record.round as number) : null,
  };
}

export interface CharacterRow {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  reference_images: string | null; // JSON
  face_embedding: string | null; // JSON
  visual_notes: string | null;
  /** 配音音色 ID；为空时按角色描述自动挑选 */
  voice?: string | null;
  approved_name: string | null;
  approved_description: string | null;
  approved_image_url: string | null;
  approved_at: string | null;
  approval_version: number;
  revision: number;
}

export interface ShotRow {
  id: number;
  project_id: number;
  order: number;
  description: string;
  prompt: string | null;
  image_prompt: string | null;
  image_url: string | null;
  video_url: string | null;
  duration: number | null;
  camera: string | null;
  motion_note: string | null;
  scene: string | null;
  action: string | null;
  expression: string | null;
  lighting: string | null;
  dialogue: string | null;
  sfx: string | null;
  tts_url: string | null;
  bgm_type: string | null;
  /** passed / failed / unchecked (vision critic could not run); null = not reviewed */
  review_status?: string | null;
  review_note?: string | null;
  seed: number | null;
  character_ids: string | null; // JSON
  approved_description: string | null;
  approved_prompt: string | null;
  approved_image_prompt: string | null;
  approved_duration: number | null;
  approved_camera: string | null;
  approved_motion_note: string | null;
  approved_scene: string | null;
  approved_action: string | null;
  approved_expression: string | null;
  approved_lighting: string | null;
  approved_dialogue: string | null;
  approved_sfx: string | null;
  approved_character_ids: string | null; // JSON
  approved_at: string | null;
  approval_version: number;
  revision: number;
}

export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function characterApprovalState(c: CharacterRow): "draft" | "approved" | "superseded" {
  if (c.approval_version <= 0 || c.approved_at === null) return "draft";
  if (
    c.name === c.approved_name &&
    c.description === c.approved_description &&
    c.image_url === c.approved_image_url
  )
    return "approved";
  return "superseded";
}

export function characterReadPayload(c: CharacterRow): Record<string, unknown> {
  return {
    id: c.id,
    revision: c.revision,
    project_id: c.project_id,
    name: c.name,
    description: c.description,
    image_url: c.image_url,
    reference_images: parseJsonColumn(c.reference_images, [] as string[]),
    has_embedding: Boolean(c.face_embedding),
    visual_notes: c.visual_notes,
    voice: c.voice ?? null,
    approval_state: characterApprovalState(c),
    approval_version: c.approval_version,
    approved_at: c.approved_at,
    approved_name: c.approved_name,
    approved_description: c.approved_description,
    approved_image_url: c.approved_image_url,
  };
}

export function shotApprovalState(s: ShotRow): "draft" | "approved" | "superseded" {
  if (s.approval_version <= 0 || s.approved_at === null) return "draft";
  const chars = parseJsonColumn(s.character_ids, [] as number[]);
  const approvedChars = parseJsonColumn(s.approved_character_ids, [] as number[]);
  const sameChars =
    chars.length === approvedChars.length && chars.every((id, idx) => id === approvedChars[idx]);
  if (
    s.description === s.approved_description &&
    s.prompt === s.approved_prompt &&
    s.image_prompt === s.approved_image_prompt &&
    s.duration === s.approved_duration &&
    s.camera === s.approved_camera &&
    s.motion_note === s.approved_motion_note &&
    s.scene === s.approved_scene &&
    s.action === s.approved_action &&
    s.expression === s.approved_expression &&
    s.lighting === s.approved_lighting &&
    s.dialogue === s.approved_dialogue &&
    s.sfx === s.approved_sfx &&
    sameChars
  )
    return "approved";
  return "superseded";
}

export function shotReadPayload(s: ShotRow): Record<string, unknown> {
  return {
    id: s.id,
    revision: s.revision,
    project_id: s.project_id,
    order: s.order,
    description: s.description,
    prompt: s.prompt,
    image_prompt: s.image_prompt,
    image_url: s.image_url,
    video_url: s.video_url,
    duration: s.duration,
    camera: s.camera,
    motion_note: s.motion_note,
    scene: s.scene,
    action: s.action,
    expression: s.expression,
    lighting: s.lighting,
    dialogue: s.dialogue,
    sfx: s.sfx,
    tts_url: s.tts_url,
    bgm_type: s.bgm_type,
    review_status: s.review_status ?? null,
    review_note: s.review_note ?? null,
    seed: s.seed,
    character_ids: parseJsonColumn(s.character_ids, [] as number[]),
    approval_state: shotApprovalState(s),
    approval_version: s.approval_version,
    approved_at: s.approved_at,
    approved_description: s.approved_description,
    approved_prompt: s.approved_prompt,
    approved_image_prompt: s.approved_image_prompt,
    approved_duration: s.approved_duration,
    approved_camera: s.approved_camera,
    approved_motion_note: s.approved_motion_note,
    approved_scene: s.approved_scene,
    approved_action: s.approved_action,
    approved_expression: s.approved_expression,
    approved_lighting: s.approved_lighting,
    approved_dialogue: s.approved_dialogue,
    approved_sfx: s.approved_sfx,
    approved_character_ids: parseJsonColumn(s.approved_character_ids, [] as number[]),
  };
}

const CHARACTER_SNAPSHOT_FIELDS = [
  "id",
  "project_id",
  "name",
  "description",
  "image_url",
  "reference_images",
  "face_embedding",
  "visual_notes",
  "approved_name",
  "approved_description",
  "approved_image_url",
  "approved_at",
  "approval_version",
  "revision",
] as const;

const SHOT_SNAPSHOT_FIELDS = [
  "id",
  "project_id",
  "order",
  "description",
  "prompt",
  "image_prompt",
  "image_url",
  "video_url",
  "duration",
  "camera",
  "motion_note",
  "scene",
  "action",
  "expression",
  "lighting",
  "dialogue",
  "sfx",
  "tts_url",
  "bgm_type",
  "seed",
  "character_ids",
  "approved_description",
  "approved_prompt",
  "approved_image_prompt",
  "approved_duration",
  "approved_camera",
  "approved_motion_note",
  "approved_scene",
  "approved_action",
  "approved_expression",
  "approved_lighting",
  "approved_dialogue",
  "approved_sfx",
  "approved_character_ids",
  "approved_at",
  "approval_version",
  "revision",
] as const;

function snapshotOf(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && (f.endsWith("_ids") || f === "reference_images")) {
      out[f] = parseJsonColumn(v, [] as unknown[]);
    } else {
      out[f] = v ?? null;
    }
  }
  return out;
}

interface ExecutionFence {
  runId: number;
  token: string;
}

export interface FrozenStageInput {
  project: ProjectRow | null;
  characters: CharacterRow[];
  shots: ShotRow[];
}

/**
 * Raised when a writer's revision no longer matches the stored row.
 *
 * Both the HTTP API and the engine write project/character/shot, so a stale
 * edit must be surfaced instead of silently overwriting the other writer.
 */
export class ConcurrentModificationError extends Error {
  constructor(
    readonly entity: string,
    readonly entityId: number,
    readonly expectedRevision: number,
  ) {
    super(
      `${entity} ${entityId} was modified concurrently ` +
        `(expected revision ${expectedRevision}); re-read and retry`,
    );
    this.name = "ConcurrentModificationError";
  }
}

function isInlineLocation(value: string): boolean {
  return /^(?:x'|X')/.test(value.trim());
}

export class SharedDb {
  constructor(
    private readonly db: Database.Database,
    private readonly fence?: ExecutionFence,
    /**
     * Input frozen before the current stage attempt's first side effect.
     *
     * A stage mutates project/character/shot as it runs, so a resume that
     * re-read them would regenerate against half-written state and issue a
     * *different* request under the *same* idempotency key. `executeStageAttempt`
     * installs this via `withFrozenStageInput`; entity reads then serve the
     * snapshot, while writes still hit the live database.
     */
    private readonly frozenInput?: FrozenStageInput,
    /**
     * Revisions this stage attempt produced itself, keyed `entity:id`.
     *
     * Reads keep serving the frozen snapshot, but once the stage has written a
     * row its next write must compare against the revision *it* left behind,
     * not the snapshot's: otherwise a stage that writes the same row twice
     * (every rendered shot marks a finished project superseded) trips over its
     * own first write. A write by anyone else still moves the row past this
     * revision and is rejected.
     */
    private readonly ownRevisions: Map<string, number> = new Map(),
  ) {}

  fenced(runId: number, token: string): SharedDb {
    return new SharedDb(this.db, { runId, token }, this.frozenInput, this.ownRevisions);
  }

  /** Install the frozen stage input for the duration of one stage attempt. */
  withFrozenStageInput(input: FrozenStageInput): SharedDb {
    this.assertExecutionFence();
    // a new attempt starts from its own snapshot, with no writes of its own yet
    return new SharedDb(this.db, this.fence, input, new Map());
  }

  assertExecutionFence(): void {
    if (!this.fence) return;
    if (!this.runLeaseOwned(this.fence.runId, this.fence.token)) {
      throw new Error(`execution lease lost for run ${this.fence.runId}`);
    }
  }

  registerMediaObject(relativePath: string): void {
    if (!this.fence) throw new Error("media registration requires an execution fence");
    const result = this.db.prepare(
      `INSERT INTO media_object (id, namespace, relative_path)
       SELECT ?, 'managed-v1', ?
       WHERE EXISTS (
         SELECT 1 FROM agentrun
         WHERE id = ? AND lease_token = ? AND lease_expires_at > datetime('now')
           AND cancel_requested_at IS NULL AND status NOT IN ('cancelling','cancelled')
       )`,
    ).run(randomUUID(), relativePath, this.fence.runId, this.fence.token);
    if (result.changes !== 1) {
      this.assertExecutionFence();
      throw new Error("media registration rejected because the run is cancelled");
    }
  }

  // ---- project ----

  getProject(projectId: number): ProjectRow | undefined {
    if (this.frozenInput && this.frozenInput.project?.id === projectId) {
      return this.frozenInput.project;
    }
    return this.db.prepare("SELECT * FROM project WHERE id = ?").get(projectId) as
      | ProjectRow
      | undefined;
  }

  /**
   * Compare-and-set on an explicit expected revision.
   *
   * The caller must pass the revision it actually read. Re-reading it here
   * would defeat the check entirely: the engine holds a stale snapshot of the
   * entity (it read it at stage start), so the write must state that snapshot's
   * revision or the concurrent HTTP edit goes unnoticed.
   */
  private casWrite(
    entity: "project" | "character" | "shot",
    entityId: number,
    expectedRevision: number,
    fields: Record<string, unknown>,
    extraSet = "",
  ): void {
    this.assertExecutionFence();
    const entries = Object.entries(fields).filter(([k]) => k !== "id" && k !== "revision");
    if (entries.length === 0) return;
    // "order" is a SQLite keyword; unquoted it is a syntax error in a SET list.
    const sets = entries.map(([k]) => `${k === "order" ? '"order"' : k} = ?`).join(", ");
    const info = this.db
      .prepare(
        `UPDATE ${entity} SET ${sets}, revision = revision + 1${extraSet}
         WHERE id = ? AND revision = ?`,
      )
      .run(
        ...entries.map(([, v]) =>
          v === undefined ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        ),
        entityId,
        expectedRevision,
      );
    if (info.changes === 0) {
      throw new ConcurrentModificationError(entity, entityId, expectedRevision);
    }
    // only a stage attempt (frozen reads) needs this; the long-lived root
    // instance reads live rows and must keep doing so
    if (this.frozenInput) this.ownRevisions.set(`${entity}:${entityId}`, expectedRevision + 1);
  }

  /**
   * Revision this writer read for the entity, i.e. the one it is allowed to
   * write against. Falls back to the live row so a caller that did not capture
   * a snapshot still compares against current state instead of blindly writing.
   */
  private expectedRevision(entity: "project" | "character" | "shot", entityId: number): number {
    const own = this.ownRevisions.get(`${entity}:${entityId}`);
    if (own !== undefined) return own;
    if (this.frozenInput) {
      if (entity === "project" && this.frozenInput.project?.id === entityId) {
        return this.frozenInput.project.revision;
      }
      if (entity === "character") {
        const frozen = this.frozenInput.characters.find((c) => c.id === entityId);
        if (frozen) return frozen.revision;
      }
      if (entity === "shot") {
        const frozen = this.frozenInput.shots.find((s) => s.id === entityId);
        if (frozen) return frozen.revision;
      }
    }
    const row = this.db.prepare(`SELECT revision FROM ${entity} WHERE id = ?`).get(entityId) as
      | { revision: number }
      | undefined;
    return row?.revision ?? -1;
  }

  updateProject(projectId: number, fields: Partial<ProjectRow> & Record<string, unknown>): void {
    this.casWrite(
      "project",
      projectId,
      this.expectedRevision("project", projectId),
      fields,
      ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    );
  }

  // ---- agentrun ----

  getRun(runId: number): AgentRunRow | undefined {
    return this.db.prepare("SELECT * FROM agentrun WHERE id = ?").get(runId) as
      | AgentRunRow
      | undefined;
  }

  updateRun(runId: number, fields: Record<string, unknown>): void {
    this.assertExecutionFence();
    const entries = Object.entries(fields);
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    this.db
      .prepare(
        `UPDATE agentrun SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(...entries.map(([, v]) => (v === undefined ? null : v)), runId);
  }

  /**
   * Stamp when execution began, once: a resume keeps the first start so the
   * elapsed time covers the whole run. Naive UTC, the format the backend writes.
   */
  markRunStarted(runId: number): void {
    this.assertExecutionFence();
    this.db
      .prepare(
        "UPDATE agentrun SET started_at = COALESCE(started_at, strftime('%Y-%m-%d %H:%M:%f','now')) WHERE id = ?",
      )
      .run(runId);
  }

  acquireRunLease(runId: number, owner: string, token: string, ttlSeconds: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE agentrun
         SET execution_attempt = COALESCE(execution_attempt, 0) + 1,
             lease_owner = ?, lease_token = ?,
             lease_expires_at = datetime('now', ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?
           AND cancel_requested_at IS NULL AND status NOT IN ('cancelling', 'cancelled')
           AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= datetime('now'))`,
      )
      .run(owner, token, `+${ttlSeconds} seconds`, runId);
    return info.changes === 1;
  }

  renewRunLease(runId: number, owner: string, token: string, ttlSeconds: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE agentrun
         SET lease_expires_at = datetime('now', ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND lease_owner = ? AND lease_token = ?`,
      )
      .run(`+${ttlSeconds} seconds`, runId, owner, token);
    return info.changes === 1;
  }

  /**
   * Take the lease back after a renewal missed (box suspend, wall-clock jump) when
   * nobody else holds it. A run the gateway already marked lease-expired returns
   * to running; a cancel, a finished run, a new owner or another active run of
   * the project wins.
   */
  reclaimRunLease(runId: number, owner: string, token: string, ttlSeconds: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE agentrun
         SET lease_owner = ?, lease_token = ?, lease_expires_at = datetime('now', ?),
             status = CASE WHEN status = 'failed' THEN 'running' ELSE status END,
             error = CASE WHEN status = 'failed' THEN NULL ELSE error END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?
           AND cancel_requested_at IS NULL
           AND (status IN ('queued', 'running', 'waiting_for_approval')
                OR (status = 'failed' AND error LIKE '%Execution lease%'))
           AND (lease_token IS NULL OR lease_token = ? OR lease_expires_at IS NULL
                OR lease_expires_at <= datetime('now'))
           AND NOT EXISTS (
             SELECT 1 FROM agentrun other
             WHERE other.project_id = agentrun.project_id AND other.id != agentrun.id
               AND other.status IN ('queued', 'running', 'waiting_for_approval', 'cancelling'))`,
      )
      .run(owner, token, `+${ttlSeconds} seconds`, runId, token);
    return info.changes === 1;
  }

  releaseRunLease(runId: number, owner: string, token: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE agentrun
         SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND lease_owner = ? AND lease_token = ?`,
      )
      .run(runId, owner, token);
    return info.changes === 1;
  }

  runLeaseOwned(runId: number, token: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS owned FROM agentrun
         WHERE id = ? AND lease_token = ?
           AND lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now')`,
      )
      .get(runId, token) as { owned: number } | undefined;
    return row?.owned === 1;
  }

  assertRunCommitAllowed(runId: number): void {
    const row = this.db
      .prepare(
        `SELECT status, cancel_requested_at FROM agentrun
         WHERE id = ? AND lease_token = ?
           AND lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now')`,
      )
      .get(runId, this.fence?.token) as
      | { status: string; cancel_requested_at: string | null }
      | undefined;
    if (!row) throw new Error(`execution lease lost for run ${runId}`);
    if (row.cancel_requested_at || row.status === "cancelling" || row.status === "cancelled") {
      throw new Error("run cancelled");
    }
  }

  runCancelRequested(runId: number): boolean {
    const row = this.db
      .prepare("SELECT status, cancel_requested_at FROM agentrun WHERE id = ?")
      .get(runId) as { status: string; cancel_requested_at: string | null } | undefined;
    return Boolean(
      row?.cancel_requested_at || row?.status === "cancelling" || row?.status === "cancelled",
    );
  }

  requestRunCancel(runId: number): void {
    this.db
      .prepare(
        `UPDATE agentrun
         SET cancel_requested_at = COALESCE(cancel_requested_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
             status = CASE WHEN status IN ('queued','running','waiting_for_approval') THEN 'cancelling' ELSE status END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND status IN ('queued','running','waiting_for_approval','cancelling')`,
      )
      .run(runId);
  }

  completeRun(runId: number, fields: Record<string, unknown>): void {
    const entries = Object.entries(fields);
    const sets = entries.map(([key]) => `${key} = ?`).join(", ");
    const info = this.db
      .prepare(
        `UPDATE agentrun SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND lease_token = ? AND lease_expires_at > datetime('now')
           AND cancel_requested_at IS NULL AND status NOT IN ('cancelling','cancelled')`,
      )
      .run(...entries.map(([, value]) => (value === undefined ? null : value)), runId, this.fence?.token);
    if (info.changes !== 1) {
      this.assertExecutionFence();
      throw new Error("run cancelled");
    }
  }

  consumeConfirmSignal(runId: number): boolean {
    const row = this.db
      .prepare("SELECT confirm_requested FROM agentrun WHERE id = ?")
      .get(runId) as { confirm_requested: 0 | 1 | null } | undefined;
    if (row?.confirm_requested) {
      this.updateRun(runId, { confirm_requested: 0 });
      return true;
    }
    return false;
  }

  clearConfirmSignal(runId: number): void {
    this.updateRun(runId, { confirm_requested: 0 });
  }

  /**
   * The pending "request changes" decision for a gate, if any. Written by the
   * API gateway (agentrun.gate_feedback). It stays set while the engine redoes
   * the stage, so a crash mid-redo resumes into the same request, and is
   * cleared with {@link clearGateFeedback} once the gate is back.
   */
  peekGateFeedback(runId: number): GateFeedbackSignal | null {
    if (!this.hasRunColumn("gate_feedback")) return null;
    const row = this.db
      .prepare("SELECT gate_feedback FROM agentrun WHERE id = ?")
      .get(runId) as { gate_feedback: string | null } | undefined;
    if (!row?.gate_feedback || row.gate_feedback === "null") return null;
    const parsed = parseGateFeedback(row.gate_feedback);
    // An unreadable payload must not wedge the gate: drop it.
    if (!parsed) this.updateRun(runId, { gate_feedback: null });
    return parsed;
  }

  /**
   * Everything a parked gate waits on, in one read: lease, cancel, approval and
   * "request changes". The wait loop polls this instead of four separate
   * SELECTs, and only calls the exact readers above when something is set.
   */
  gateSignals(runId: number): {
    leaseOwned: boolean;
    cancelRequested: boolean;
    confirmRequested: boolean;
    feedbackPending: boolean;
  } {
    const feedback = this.hasRunColumn("gate_feedback") ? "gate_feedback" : "NULL";
    const row = this.db
      .prepare(
        `SELECT status, cancel_requested_at, confirm_requested, ${feedback} AS gate_feedback,
                (lease_token = ? AND lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now')) AS owned
         FROM agentrun WHERE id = ?`,
      )
      .get(this.fence?.token ?? null, runId) as
      | {
          status: string;
          cancel_requested_at: string | null;
          confirm_requested: 0 | 1 | null;
          gate_feedback: string | null;
          owned: 0 | 1 | null;
        }
      | undefined;
    return {
      leaseOwned: !this.fence || (this.fence.runId === runId && row?.owned === 1),
      cancelRequested: Boolean(
        row?.cancel_requested_at || row?.status === "cancelling" || row?.status === "cancelled",
      ),
      confirmRequested: Boolean(row?.confirm_requested),
      feedbackPending: Boolean(row?.gate_feedback && row.gate_feedback !== "null"),
    };
  }

  clearGateFeedback(runId: number): void {
    if (!this.hasRunColumn("gate_feedback")) return;
    this.updateRun(runId, { gate_feedback: null });
  }

  private runColumns: Set<string> | null = null;

  private hasRunColumn(name: string): boolean {
    if (!this.runColumns) {
      this.runColumns = new Set(
        (this.db.prepare("PRAGMA table_info(agentrun)").all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
    }
    return this.runColumns.has(name);
  }

  setAwaitingPayload(runId: number, payload: unknown | null): void {
    this.updateRun(runId, {
      awaiting_payload: payload === null ? null : JSON.stringify(payload),
    });
  }

  // ---- messages ----

  insertMessage(
    projectId: number,
    runId: number | null,
    agent: string,
    role: string,
    content: string,
    summary?: string | null,
    progress?: number | null,
    isLoading?: boolean,
  ): void {
    this.assertExecutionFence();
    this.db
      .prepare(
        `INSERT INTO message (project_id, run_id, agent, role, content, summary, progress, is_loading, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run(
        projectId,
        runId,
        agent,
        role,
        content,
        summary ?? null,
        progress ?? null,
        isLoading ? 1 : 0,
      );
  }

  /**
   * Write the current state of a gate feedback receipt into the timeline.
   * The gateway inserts the row when the feedback arrives (so it sorts before
   * the redo output); later states update that same row in place.
   */
  upsertFeedbackReceipt(projectId: number, runId: number, agent: string, receipt: FeedbackReceiptRecord): void {
    this.assertExecutionFence();
    const content = JSON.stringify(receipt);
    const existing = this.db
      .prepare("SELECT id FROM message WHERE run_id = ? AND role = ? AND summary = ? ORDER BY id LIMIT 1")
      .get(runId, FEEDBACK_RECEIPT_ROLE, receipt.id) as { id: number } | undefined;
    if (existing) {
      this.db.prepare("UPDATE message SET content = ? WHERE id = ?").run(content, existing.id);
      return;
    }
    this.insertMessage(projectId, runId, agent, FEEDBACK_RECEIPT_ROLE, content, receipt.id);
  }

  /** Rounds of "request changes" this run already had at a gate stage. */
  countFeedbackReceipts(runId: number, stage: string): number {
    const rows = this.db
      .prepare("SELECT content FROM message WHERE run_id = ? AND role = ?")
      .all(runId, FEEDBACK_RECEIPT_ROLE) as Array<{ content: string }>;
    let count = 0;
    for (const row of rows) {
      try {
        const data = JSON.parse(row.content) as { stage?: unknown };
        if (data && data.stage === stage) count += 1;
      } catch {
        // ignore unreadable rows
      }
    }
    return count;
  }

  insertAgentMessage(runId: number, agent: string, role: string, content: string): void {
    this.assertExecutionFence();
    this.db
      .prepare(
        `INSERT INTO agentmessage (run_id, agent, role, content, created_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run(runId, agent, role, content);
  }

  // ---- characters ----

  charactersForProject(projectId: number): CharacterRow[] {
    if (this.frozenInput) {
      return this.frozenInput.characters.filter((c) => c.project_id === projectId);
    }
    return this.db
      .prepare("SELECT * FROM character WHERE project_id = ? ORDER BY id")
      .all(projectId) as CharacterRow[];
  }

  getCharacter(characterId: number): CharacterRow | undefined {
    const frozen = this.frozenInput?.characters.find((c) => c.id === characterId);
    if (frozen) return frozen;
    return this.db.prepare("SELECT * FROM character WHERE id = ?").get(characterId) as
      | CharacterRow
      | undefined;
  }

  /** Read live outputs so a replay skips results committed after its frozen input snapshot. */
  hasCharacterImage(characterId: number): boolean {
    const row = this.db.prepare("SELECT image_url FROM character WHERE id = ?").get(characterId) as
      | { image_url: string | null }
      | undefined;
    return Boolean(row?.image_url);
  }

  insertCharacter(
    projectId: number,
    name: string,
    description: string | null,
    visualNotes: string | null,
  ): number {
    this.assertExecutionFence();
    const info = this.db
      .prepare(
        "INSERT INTO character (project_id, name, description, visual_notes, reference_images, approval_version) VALUES (?, ?, ?, ?, '[]', 0)",
      )
      .run(projectId, name, description, visualNotes);
    const id = Number(info.lastInsertRowid);
    this.ownRevisions.delete(`character:${id}`); // a reused rowid starts fresh
    return id;
  }

  updateCharacter(
    characterId: number,
    fields: Record<string, unknown>,
    expectedRevision?: number,
  ): void {
    this.casWrite(
      "character",
      characterId,
      expectedRevision ?? this.expectedRevision("character", characterId),
      fields,
    );
  }

  deleteCharacter(characterId: number): void {
    this.assertExecutionFence();
    this.db.prepare("DELETE FROM character WHERE id = ?").run(characterId);
    this.forgetFrozen("character", characterId);
  }

  // ---- shots ----

  shotsForProject(projectId: number): ShotRow[] {
    if (this.frozenInput) {
      return this.frozenInput.shots.filter((s) => s.project_id === projectId);
    }
    return this.db
      .prepare('SELECT * FROM shot WHERE project_id = ? ORDER BY "order"')
      .all(projectId) as unknown as ShotRow[];
  }

  getShot(shotId: number): ShotRow | undefined {
    const frozen = this.frozenInput?.shots.find((s) => s.id === shotId);
    if (frozen) return frozen;
    return this.db.prepare("SELECT * FROM shot WHERE id = ?").get(shotId) as ShotRow | undefined;
  }

  getLiveShot(shotId: number): ShotRow | undefined {
    return this.db.prepare("SELECT * FROM shot WHERE id = ?").get(shotId) as ShotRow | undefined;
  }

  getLiveShotsForProject(projectId: number): ShotRow[] {
    return this.db
      .prepare('SELECT * FROM shot WHERE project_id = ? ORDER BY "order"')
      .all(projectId) as unknown as ShotRow[];
  }

  hasShotImage(shotId: number): boolean {
    const row = this.db.prepare("SELECT image_url FROM shot WHERE id = ?").get(shotId) as
      | { image_url: string | null }
      | undefined;
    return Boolean(row?.image_url);
  }

  hasShotVideo(shotId: number): boolean {
    const row = this.db.prepare("SELECT video_url FROM shot WHERE id = ?").get(shotId) as
      | { video_url: string | null }
      | undefined;
    return Boolean(row?.video_url);
  }

  insertShot(
    projectId: number,
    order: number,
    fields: Omit<Partial<ShotRow>, "character_ids"> & { character_ids?: number[] },
  ): number {
    this.assertExecutionFence();
    const info = this.db
      .prepare(
        `INSERT INTO shot (project_id, "order", description, character_ids, approval_version)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .run(projectId, order, fields.description ?? "", JSON.stringify(fields.character_ids ?? []));
    const id = Number(info.lastInsertRowid);
    this.ownRevisions.delete(`shot:${id}`); // a reused rowid starts fresh
    const extra = Object.entries(fields).filter(
      ([k]) => !["id", "project_id", "description", "character_ids"].includes(k),
    );
    if (extra.length > 0) this.updateShot(id, Object.fromEntries(extra));
    return id;
  }

  updateShot(
    shotId: number,
    fields: Record<string, unknown>,
    expectedRevision?: number,
  ): void {
    const prepared = Object.fromEntries(
      Object.entries(fields)
        .filter(([k]) => k !== "id" && k !== "revision")
        .map(([k, v]) =>
          typeof v === "object" && v !== null
            ? [k, JSON.stringify(v)]
            : v === undefined
              ? [k, null]
              : k.endsWith("_ids")
                ? [k, JSON.stringify(v)]
                : [k, v],
        ),
    );
    this.casWrite(
      "shot",
      shotId,
      expectedRevision ?? this.expectedRevision("shot", shotId),
      prepared,
    );
  }

  deleteShot(shotId: number): void {
    this.assertExecutionFence();
    this.db.prepare("DELETE FROM shot WHERE id = ?").run(shotId);
    this.forgetFrozen("shot", shotId);
  }

  /**
   * A deleted row leaves the frozen snapshot too. SQLite reuses the highest
   * rowid, so a re-plan that deletes shot N and inserts a new one gets id N
   * back; checking that new row against the old row's frozen revision would
   * fail every redo with a false ConcurrentModificationError.
   */
  private forgetFrozen(entity: "character" | "shot", entityId: number): void {
    this.ownRevisions.delete(`${entity}:${entityId}`);
    if (!this.frozenInput) return;
    const rows = entity === "shot" ? this.frozenInput.shots : this.frozenInput.characters;
    const index = rows.findIndex((row) => row.id === entityId);
    if (index >= 0) rows.splice(index, 1);
  }

  // ---- artifact versions ----

  createVersion(
    projectId: number,
    entityType: "character" | "shot",
    entityId: number,
    row: CharacterRow | ShotRow,
    runId: number | null,
    trigger: string,
  ): number {
    this.assertExecutionFence();
    const fields = entityType === "character" ? CHARACTER_SNAPSHOT_FIELDS : SHOT_SNAPSHOT_FIELDS;
    const snapshot = snapshotOf(row as unknown as Record<string, unknown>, fields);
    const maxRow = this.db
      .prepare(
        "SELECT MAX(version) AS v FROM artifactversion WHERE entity_type = ? AND entity_id = ?",
      )
      .get(entityType, entityId) as { v: number | null };
    const nextVersion = (maxRow.v ?? 0) + 1;
    const info = this.db
      .prepare(
        `INSERT INTO artifactversion (project_id, entity_type, entity_id, version, snapshot, run_id, trigger, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run(
        projectId,
        entityType,
        entityId,
        nextVersion,
        JSON.stringify(snapshot),
        runId,
        trigger,
      );
    void Number(info.lastInsertRowid);
    return nextVersion;
  }
}
