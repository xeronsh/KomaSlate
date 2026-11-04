import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { EngineDatabase } from "../src/db.js";
import { SharedDb } from "../src/shared-db.js";
import { PipelineEmitter } from "../src/pipeline/emitter.js";
import { installEngineRuntimeSchema, installExecutionLeaseColumns, leaseRun } from "./test-db.js";

const SCHEMA = readFileSync(resolve(import.meta.dirname, "fixtures/app-schema.sql"), "utf8");

describe("gateSignals / stream frame replace", () => {
  let dir: string;
  let edb: EngineDatabase;
  let shared: SharedDb;
  let fenced: SharedDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "komaslate-gate-"));
    const file = join(dir, "o.db");
    const raw = new SqliteDatabase(file);
    raw.exec(SCHEMA);
    installExecutionLeaseColumns(raw);
    installEngineRuntimeSchema(raw);
    raw.close();
    edb = new EngineDatabase(file);
    shared = new SharedDb(edb.db);
    edb.db
      .prepare(
        `INSERT INTO project (title, story, style, status, updated_at, created_at)
         VALUES ('p', 's', 'anime', 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run();
    edb.db
      .prepare(
        `INSERT INTO agentrun (project_id, status, current_agent, progress, confirm_requested, created_at, updated_at)
         VALUES (1, 'waiting_for_approval', 'plan', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .run();
    fenced = leaseRun(shared, 1);
  });

  afterEach(() => {
    edb.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports nothing pending at a fresh gate", () => {
    expect(fenced.gateSignals(1)).toEqual({
      leaseOwned: true,
      cancelRequested: false,
      confirmRequested: false,
      feedbackPending: false,
    });
  });

  it("sees approval, feedback and cancel in one read", () => {
    shared.updateRun(1, { confirm_requested: 1, gate_feedback: JSON.stringify({ round: 1, content: "x" }) });
    expect(fenced.gateSignals(1)).toMatchObject({ confirmRequested: true, feedbackPending: true });
    shared.requestRunCancel(1);
    expect(fenced.gateSignals(1).cancelRequested).toBe(true);
  });

  it("treats a JSON null feedback as nothing pending", () => {
    shared.updateRun(1, { gate_feedback: "null" });
    expect(fenced.gateSignals(1).feedbackPending).toBe(false);
  });

  it("notices a lost lease", () => {
    edb.db.prepare("UPDATE agentrun SET lease_token = 'someone-else' WHERE id = 1").run();
    expect(fenced.gateSignals(1).leaseOwned).toBe(false);
    expect(() => fenced.assertExecutionFence()).toThrow(/lease lost/);
  });

  it("keeps exactly one streaming frame per run, written atomically", () => {
    const emitter = new PipelineEmitter(edb, fenced, 1, 1, {} as never);
    const sink = emitter.llmStream("plan");
    let t = 0;
    const timed = sink as unknown as { now: () => number };
    timed.now = () => (t += 1000);
    sink.update({ thinking: "", text: "第一段故事内容" });
    sink.update({ thinking: "", text: "第一段故事内容，第二段" });
    sink.end("done");
    const frames = edb.eventsForRun(1).filter((e) => e.type === "llm_stream");
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!.payload)).toMatchObject({ status: "done" });
  });
});
