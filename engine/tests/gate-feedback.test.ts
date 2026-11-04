import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { EngineDatabase } from "../src/db.js";
import { SharedDb, parseGateFeedback } from "../src/shared-db.js";
import { TextLlmService } from "../src/llm.js";
import { PipelineRunner, planGateFeedback } from "../src/pipeline/runner.js";
import { installEngineRuntimeSchema, installExecutionLeaseColumns, leaseRun } from "./test-db.js";

const SCHEMA = readFileSync(resolve(import.meta.dirname, "fixtures/app-schema.sql"), "utf8");

type Awaiting = {
  current_stage: string;
  feedback: null | { state: string; round: number; reason: string | null; content: string };
};

describe("planGateFeedback", () => {
  const signal = (entityType: "character" | "shot" | null, ids: number[] = []) => ({
    id: "fb",
    content: "改一下",
    entityType,
    entityIds: ids,
  });

  it("redoes the gate's produced stage", () => {
    expect(planGateFeedback("outline_approval", signal(null))).toMatchObject({
      kind: "redo",
      stages: ["plan_outline"],
    });
    expect(planGateFeedback("shots_approval", signal(null))).toMatchObject({ stages: ["plan_shots"] });
    expect(planGateFeedback("shot_images_approval", signal("shot", [3]))).toMatchObject({
      stages: ["render_shots"],
      shots: [3],
    });
    expect(planGateFeedback("shot_images_approval", signal(null))).toMatchObject({ shots: "all" });
    expect(planGateFeedback("compose_approval", signal("shot", [2]))).toMatchObject({
      stages: ["compose_videos", "compose_merge"],
      shots: [2],
      shotKind: "shot_video",
    });
  });

  it("explains instead of silently skipping when it cannot apply", () => {
    for (const [gate, feedback] of [
      ["character_images_approval", signal("shot", [1])],
      ["shot_images_approval", signal("character", [1])],
      ["compose_approval", signal(null)],
    ] as const) {
      const plan = planGateFeedback(gate, feedback);
      expect(plan.kind).toBe("not_applied");
      expect(plan.kind === "not_applied" && plan.reason.length).toBeGreaterThan(4);
    }
  });

  it("parses the gateway payload defensively", () => {
    expect(parseGateFeedback("not json")).toBeNull();
    expect(parseGateFeedback(JSON.stringify({ content: "  " }))).toBeNull();
    expect(
      parseGateFeedback(JSON.stringify({ id: "a", content: " x ", entity_type: "shot", entity_ids: [1, -2, "3"] })),
    ).toEqual({ id: "a", content: "x", entityType: "shot", entityIds: [1], round: null });
    expect(parseGateFeedback(JSON.stringify({ id: "a", content: "x", round: 3 }))?.round).toBe(3);
  });
});

describe("request changes at a gate (fake providers, manual mode)", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    process.env.TEXT_PROVIDER = "fake";
    process.env.IMAGE_PROVIDER = "fake";
    process.env.VIDEO_PROVIDER = "fake";
    process.env.TTS_ENABLED = "false";
    process.env.BGM_ENABLED = "false";
    process.env.CRITIQUE_ENABLED = "false";
    dir = mkdtempSync(join(tmpdir(), "komaslate-gate-feedback-"));
    dbFile = join(dir, "komaslate.db");
    const raw = new SqliteDatabase(dbFile);
    raw.exec(SCHEMA);
    installExecutionLeaseColumns(raw);
    installEngineRuntimeSchema(raw);
    raw.close();
  });

  afterEach(() => {
    delete process.env.CRITIQUE_ENABLED;
    rmSync(dir, { recursive: true, force: true });
  });

  it("redoes the stage with the feedback and returns to the SAME gate every time", async () => {
    const edb = new EngineDatabase(dbFile);
    const shared = new SharedDb(edb.db);
    const llm = new TextLlmService(edb);
    process.env.ENGINE_STATIC_DIR = join(dir, "static");
    edb.db
      .prepare(
        `INSERT INTO project (title, story, style, status, story_outline, outline_approved, updated_at, created_at)
         VALUES ('闸门', '主角在废弃灯塔中发现会说话的猫。', 'anime', 'draft', NULL, 0,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run();
    const projectId = Number((edb.db.prepare("SELECT MAX(id) AS id FROM project").get() as { id: number }).id);
    edb.db
      .prepare(
        `INSERT INTO agentrun (project_id, status, current_agent, progress, confirm_requested, created_at, updated_at)
         VALUES (?, 'queued', 'outline', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run(projectId);
    const runId = Number((edb.db.prepare("SELECT MAX(id) AS id FROM agentrun").get() as { id: number }).id);

    const requestChanges = (content: string, entityType: string | null = null, ids: number[] | null = null) =>
      shared.updateRun(runId, {
        gate_feedback: JSON.stringify({ id: `fb-${content}`, content, entity_type: entityType, entity_ids: ids }),
      });
    const approve = () => shared.updateRun(runId, { confirm_requested: 1 });

    // Script: what the user does at the n-th time the run waits at a gate.
    let firstShotId = 0;
    // What the gateway does: assign the round from persisted receipts and write
    // the receipt row up front, so it sorts before the redo output.
    const gatewayFeedback = (content: string, round: number) => {
      const id = `gw-${round}`;
      edb.db
        .prepare(
          `INSERT INTO message (project_id, run_id, agent, role, content, summary, progress, is_loading, created_at)
           VALUES (?, ?, 'outline', 'feedback_receipt', ?, ?, NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        )
        .run(projectId, runId, JSON.stringify({ id, round, state: "received", content, stage: "outline_approval" }), id);
      shared.updateRun(runId, { gate_feedback: JSON.stringify({ id, content, round }) });
    };
    const script: Array<(gate: Awaiting) => void> = [
      () => gatewayFeedback("结局更温暖一些", 2), // outline v1 → changes (round 2: an earlier round was persisted)
      () => approve(), // outline v2
      () => requestChanges("主角改成短发"), // characters v1 → changes
      () => approve(),
      () => approve(), // shots
      () => requestChanges("这个镜头太暗", "shot", [1]), // character images: wrong target → not applied
      () => approve(),
      () => {
        firstShotId = shared.shotsForProject(projectId)[0]!.id;
        requestChanges("画面更亮", "shot", [firstShotId]); // the shot path that used to jump to video
      },
      () => approve(),
      () => requestChanges("整体节奏快一点"), // compose without a selection → not applied
      () => approve(),
    ];
    const seen: Awaiting[] = [];
    let handled = 0;
    const driver = setInterval(() => {
      const events = edb.eventsForRun(runId).filter((e) => e.type === "run_awaiting_confirm");
      while (handled < events.length) {
        const gate = JSON.parse(events[handled]!.payload) as Awaiting;
        seen.push(gate);
        // The persisted gate is what a reload reads back.
        expect(shared.getRun(runId)?.status).toBe("waiting_for_approval");
        script[handled]?.(gate);
        handled += 1;
      }
    }, 20);

    const outcome = await new PipelineRunner(edb, leaseRun(shared, runId), llm).run({
      projectId,
      runId,
      autoMode: false,
      userFeedback: "",
    });
    clearInterval(driver);
    expect(outcome.status, outcome.error).toBe("completed");

    expect(seen.map((g) => g.current_stage)).toEqual([
      "outline_approval",
      "outline_approval",
      "characters_approval",
      "characters_approval",
      "shots_approval",
      "character_images_approval",
      "character_images_approval",
      "shot_images_approval",
      "shot_images_approval",
      "compose_approval",
      "compose_approval",
    ]);
    expect(seen.map((g) => g.feedback?.state ?? null)).toEqual([
      null, "revised", null, "revised", null, null, "not_applied", null, "revised", null, "not_applied",
    ]);
    expect(seen[6]!.feedback?.reason).toContain("角色形象");

    // Feedback never counts as an approval: each gate confirms exactly once.
    const all = edb.eventsForRun(runId);
    const confirmed = all.filter((e) => e.type === "run_confirmed").map((e) => JSON.parse(e.payload).gate);
    expect(confirmed).toEqual(["outline", "plan", "plan", "render", "render", "compose"]);

    // Receipts walk 已收到 → 重做中 → 新版本 (or a reason).
    const receipts = all
      .filter((e) => e.type === "run_feedback")
      .map((e) => JSON.parse(e.payload) as { stage: string; state: string });
    expect(receipts.filter((r) => r.stage === "shot_images_approval").map((r) => r.state)).toEqual([
      "received",
      "regenerating",
      "revised",
    ]);

    // The redo really used the feedback and only the selected shot.
    const attempts = edb.db
      .prepare("SELECT stage, input_snapshot FROM engine_stage_attempts WHERE run_id = ? ORDER BY rowid")
      .all(runId) as Array<{ stage: string; input_snapshot: string }>;
    const outlines = attempts.filter((a) => a.stage === "plan_outline");
    expect(outlines).toHaveLength(2);
    expect(JSON.parse(outlines[1]!.input_snapshot).user_feedback).toBe("结局更温暖一些");
    expect(attempts.filter((a) => a.stage === "render_shots")).toHaveLength(2);
    const shotSeqAfterFeedback = all.findIndex(
      (e) => e.type === "run_feedback" && JSON.parse(e.payload).state === "regenerating" && JSON.parse(e.payload).stage === "shot_images_approval",
    );
    const redrawn = all
      .slice(shotSeqAfterFeedback)
      .filter((e) => e.type === "shot_updated")
      .map((e) => JSON.parse(e.payload).shot?.id);
    expect(redrawn[0]).toBe(firstShotId);
    // No video work started before the shot gate was approved.
    const firstVideo = all.findIndex((e) => e.type === "run_progress" && JSON.parse(e.payload).current_stage === "compose_videos");
    const shotGateApproved = all.findIndex((e) => e.type === "run_confirmed" && JSON.parse(e.payload).gate === "render" && JSON.parse(e.payload).current_stage === "critique_shot_images");
    expect(shotGateApproved).toBeGreaterThan(0);
    expect(firstVideo === -1 || firstVideo > shotGateApproved).toBe(true);
    expect(shared.getRun(runId)?.gate_feedback ?? null).toBeNull();

    // Receipts are in the timeline table, one row per feedback, final state in place.
    const rows = edb.db
      .prepare("SELECT summary, content FROM message WHERE run_id = ? AND role = 'feedback_receipt' ORDER BY id")
      .all(runId) as Array<{ summary: string; content: string }>;
    const persisted = rows.map((row) => ({ id: row.summary, ...(JSON.parse(row.content) as { round: number; state: string; stage: string }) }));
    expect(persisted.map((r) => [r.id, r.stage, r.round, r.state])).toEqual([
      ["gw-2", "outline_approval", 2, "revised"],
      ["fb-主角改成短发", "characters_approval", 1, "revised"],
      ["fb-这个镜头太暗", "character_images_approval", 1, "not_applied"],
      ["fb-画面更亮", "shot_images_approval", 1, "revised"],
      ["fb-整体节奏快一点", "compose_approval", 1, "not_applied"],
    ]);
    expect(seen[1]!.feedback?.round).toBe(2);
    // The receipt row comes before the redo's own output.
    const firstReceipt = edb.db
      .prepare("SELECT id FROM message WHERE run_id = ? AND role = 'feedback_receipt' ORDER BY id LIMIT 1")
      .get(runId) as { id: number };
    const laterOutput = edb.db
      .prepare("SELECT COUNT(*) AS n FROM message WHERE run_id = ? AND id > ? AND role != 'feedback_receipt'")
      .get(runId, firstReceipt.id) as { n: number };
    expect(laterOutput.n).toBeGreaterThan(0);
  }, 60_000);
});
