import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { EngineDatabase } from "../src/db.js";
import { ConcurrentModificationError, SharedDb } from "../src/shared-db.js";
import { installEngineRuntimeSchema, installExecutionLeaseColumns } from "./test-db.js";

/**
 * The engine and the HTTP API both write project/character/shot. These tests
 * drive the engine side the way the pipeline does: a stage reads a revision,
 * another writer commits, and the engine's write must then fail instead of
 * silently overwriting the user's edit.
 */
describe("entity revision compare-and-set", () => {
  let dir: string;
  let path: string;
  let edb: EngineDatabase;
  let shared: SharedDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "komaslate-revision-"));
    path = join(dir, "test.db");
    const raw = new SqliteDatabase(path);
    raw.exec(`
      CREATE TABLE agentrun (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL);
      CREATE TABLE project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, story TEXT, style TEXT, summary TEXT, status TEXT, video_url TEXT,
        visual_bible TEXT, story_outline TEXT, outline_approved INTEGER DEFAULT 0,
        updated_at TEXT, created_at TEXT
      );
      CREATE TABLE character (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, image_url TEXT,
        reference_images TEXT, visual_notes TEXT, approval_version INTEGER DEFAULT 0
      );
      CREATE TABLE shot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL, "order" INTEGER NOT NULL, description TEXT,
        image_url TEXT, video_url TEXT, character_ids TEXT,
        approval_version INTEGER DEFAULT 0
      );
    `);
    installExecutionLeaseColumns(raw);
    installEngineRuntimeSchema(raw);
    raw.close();
    edb = new EngineDatabase(path);
    shared = new SharedDb(edb.db);
  });

  afterEach(() => {
    edb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("increments the revision on every successful write", () => {
    edb.db.prepare("INSERT INTO project (title, status) VALUES ('P', 'draft')").run();
    expect(shared.getProject(1)?.revision).toBe(1);

    shared.updateProject(1, { status: "ready" });
    expect(shared.getProject(1)?.revision).toBe(2);
  });

  it("rejects a project write based on a snapshot another writer replaced", () => {
    edb.db.prepare("INSERT INTO project (title, status) VALUES ('P', 'draft')").run();

    // The stage reads revision 1 and freezes it as its stage input.
    const frozen = shared.getProject(1)!;
    const stage = shared.withFrozenStageInput({
      project: frozen,
      characters: [],
      shots: [],
    });

    // The HTTP API commits a user edit first (revision 1 -> 2).
    edb.db.prepare("UPDATE project SET title = 'user edit', revision = 2 WHERE id = 1").run();

    expect(() => stage.updateProject(1, { status: "ready" })).toThrow(ConcurrentModificationError);
    expect(shared.getProject(1)?.title).toBe("user edit");
    expect(shared.getProject(1)?.status).toBe("draft");
  });

  it("a stage can write the same project twice: its own write is not a concurrent edit", () => {
    // Regenerating a finished project: every rendered shot marks the old cut
    // superseded. Reads come from the frozen snapshot (revision 1, status ready),
    // so the second write used to compare against revision 1 after the first
    // one had already moved the row to 2 and fail with "modified concurrently".
    edb.db.prepare("INSERT INTO project (title, status, video_url) VALUES ('P', 'ready', '/cut.mp4')").run();
    const stage = shared.withFrozenStageInput({ project: shared.getProject(1)!, characters: [], shots: [] });

    stage.updateProject(1, { status: "superseded" });
    expect(() => stage.updateProject(1, { status: "superseded" })).not.toThrow();
    expect(shared.getProject(1)?.revision).toBe(3);
    // the snapshot itself stays frozen for deterministic retries
    expect(stage.getProject(1)?.status).toBe("ready");
  });

  it("still rejects a user edit that lands between two writes of the same stage", () => {
    edb.db.prepare("INSERT INTO project (title, status) VALUES ('P', 'ready')").run();
    const stage = shared.withFrozenStageInput({ project: shared.getProject(1)!, characters: [], shots: [] });
    stage.updateProject(1, { status: "superseded" });
    edb.db.prepare("UPDATE project SET title = 'user edit', revision = revision + 1 WHERE id = 1").run();
    expect(() => stage.updateProject(1, { status: "superseded" })).toThrow(ConcurrentModificationError);
    expect(shared.getProject(1)?.title).toBe("user edit");
  });

  it("rejects a character write based on a superseded snapshot", () => {
    edb.db
      .prepare("INSERT INTO character (project_id, name, description) VALUES (1, 'Mika', 'draft')")
      .run();
    const frozen = shared.getCharacter(1)!;
    const stage = shared.withFrozenStageInput({
      project: null,
      characters: [frozen],
      shots: [],
    });

    edb.db.prepare("UPDATE character SET description = 'user edit', revision = 2 WHERE id = 1").run();

    expect(() => stage.updateCharacter(1, { image_url: "/static/images/mika.png" })).toThrow(
      ConcurrentModificationError,
    );
    expect(shared.getCharacter(1)?.description).toBe("user edit");
    expect(shared.getCharacter(1)?.image_url).toBeNull();
  });

  it("a re-plan that deletes a frozen shot can write the row that reuses its id", () => {
    // The backend's shot table has a plain INTEGER PRIMARY KEY, so rowids are reused.
    const { sql } = edb.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'shot'").get() as { sql: string };
    edb.db.exec(`DROP TABLE shot; ${sql.replace(" AUTOINCREMENT", "")}`);
    edb.db
      .prepare('INSERT INTO shot (project_id, "order", description, revision) VALUES (1, 1, \'old\', 2)')
      .run();
    const stage = shared.withFrozenStageInput({
      project: null,
      characters: [],
      shots: [shared.getShot(1)!],
    });

    stage.deleteShot(1);
    const id = stage.insertShot(1, 1, { description: "new", character_ids: [] });
    expect(id).toBe(1); // SQLite hands the freed rowid back
    stage.updateShot(id, { image_url: "/static/images/new.png" });

    expect(shared.getShot(1)?.description).toBe("new");
    expect(shared.getShot(1)?.image_url).toBe("/static/images/new.png");
    expect(stage.shotsForProject(1).map((shot) => shot.id)).not.toContain(1);
  });

  it("rejects a shot write based on a superseded snapshot", () => {
    edb.db
      .prepare('INSERT INTO shot (project_id, "order", description) VALUES (1, 1, \'shot\')')
      .run();
    const frozen = shared.getShot(1)!;
    const stage = shared.withFrozenStageInput({
      project: null,
      characters: [],
      shots: [frozen],
    });

    edb.db.prepare("UPDATE shot SET description = 'user edit', revision = 5 WHERE id = 1").run();

    expect(() => stage.updateShot(1, { image_url: "/static/images/s.png" })).toThrow(
      ConcurrentModificationError,
    );
    expect(shared.getShot(1)?.description).toBe("user edit");
  });

  it("succeeds when the snapshot still owns the current revision", () => {
    edb.db
      .prepare("INSERT INTO character (project_id, name, description) VALUES (1, 'Mika', 'draft')")
      .run();
    const stage = shared.withFrozenStageInput({
      project: null,
      characters: [shared.getCharacter(1)!],
      shots: [],
    });

    stage.updateCharacter(1, { image_url: "/static/images/mika.png" });
    expect(shared.getCharacter(1)?.image_url).toBe("/static/images/mika.png");
    expect(shared.getCharacter(1)?.revision).toBe(2);
  });

  it("never lets a caller set the revision column directly", () => {
    edb.db.prepare("INSERT INTO project (title, status) VALUES ('P', 'draft')").run();
    shared.updateProject(1, { status: "ready", revision: 999 });
    expect(shared.getProject(1)?.revision).toBe(2);
  });
});
