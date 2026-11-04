import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { EngineDatabase } from "../src/db.js";
import { TextLlmService, type LlmStreamUpdate } from "../src/llm.js";
import { FAKE_STREAM_ERROR_TOKEN } from "../src/fake-stream.js";
import {
  LlmStreamSink,
  readableStreamText,
  tailCodePoints,
  type LlmStreamEvent,
} from "../src/pipeline/llm-stream.js";
import { installEngineRuntimeSchema } from "./test-db.js";

const SCHEMA = readFileSync(resolve(import.meta.dirname, "fixtures/app-schema.sql"), "utf8");

describe("readableStreamText", () => {
  it("shows JSON string values, not keys or identifiers", () => {
    const raw = '{"title":"午后的猫","acts":[{"act":1,"style":"anime","summary":"小猫醒来，\\"口渴\\"';
    expect(readableStreamText(raw)).toBe('午后的猫 · 小猫醒来，"口渴"');
  });

  it("drops a dangling escape in the open value", () => {
    expect(readableStreamText('{"summary":"第一行\\')).toBe("第一行");
    expect(readableStreamText('{"summary":"三只猫\\u72')).toBe("三只猫");
  });

  it("hides short labels such as act titles", () => {
    const raw = '{"acts":[{"act":1,"title":"起","summary":"主角启动流程。"},{"title":"承转","summary":"逐步验证"';
    expect(readableStreamText(raw)).toBe("主角启动流程。 · 逐步验证");
  });

  it("passes plain text through", () => {
    expect(readableStreamText("就是一段话")).toBe("就是一段话");
  });
});

describe("tailCodePoints", () => {
  it("never splits a surrogate pair", () => {
    const text = "猫🐱".repeat(200);
    const tail = tailCodePoints(text, 3);
    expect(tail).toBe("🐱猫🐱");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(tail)).toBe(false);
  });
});

describe("LlmStreamSink", () => {
  it("throttles frames and each frame replaces the earlier ones", () => {
    const published: Array<LlmStreamEvent & { seq: number }> = [];
    const compacted: number[] = [];
    let now = 0;
    const sink = new LlmStreamSink(
      {
        publish: (event) => {
          published.push({ ...event, seq: published.length + 1 });
          return published.length;
        },
        compact: (keep) => compacted.push(keep),
      },
      "outline",
      () => now,
      100,
      (chars) => chars / 100,
    );
    const update = (u: LlmStreamUpdate) => sink.update(u);
    update({ thinking: "想", text: "" });
    now = 50;
    update({ thinking: "想一想", text: "" });
    now = 120;
    update({ thinking: "想一想", text: '{"title":"午后的猫' });
    sink.end("done");
    expect(published.map((e) => e.status)).toEqual(["streaming", "streaming", "done"]);
    expect(published[1]?.text).toBe("午后的猫");
    expect(compacted).toEqual([1, 2, 3]);
    expect(published.map((e) => e.progress)).toEqual([0, 0.14, 0.14]);
  });
});

describe("compactStreamEvents", () => {
  it("keeps the newest frame of the run and every error frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "komaslate-compact-"));
    try {
      const file = join(dir, "o.db");
      const raw = new SqliteDatabase(file);
      raw.exec(SCHEMA);
      installEngineRuntimeSchema(raw);
      raw.close();
      const db = new EngineDatabase(file);
      const frame = (stream_id: string, status: string) => ({ stream_id, agent: "plan", status });
      db.appendEvent(1, 1, "llm_stream", frame("a", "done"));
      db.appendEvent(1, 1, "llm_stream", frame("b", "error"));
      db.appendEvent(1, 1, "run_message", { content: "keep" });
      db.appendEvent(2, 1, "llm_stream", frame("other-run", "done"));
      const keep = db.appendEvent(1, 1, "llm_stream", frame("c", "streaming"));
      db.compactStreamEvents(1, keep);
      const left = db.eventsForRun(1).map((e) => [e.type, (JSON.parse(e.payload) as { stream_id?: string }).stream_id]);
      expect(left).toEqual([
        ["llm_stream", "b"],
        ["run_message", undefined],
        ["llm_stream", "c"],
      ]);
      expect(db.eventsForRun(2)).toHaveLength(1);
      db.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fake provider streaming", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function fakeLlm(): TextLlmService {
    dir = mkdtempSync(join(tmpdir(), "komaslate-stream-"));
    const file = join(dir, "o.db");
    const raw = new SqliteDatabase(file);
    raw.exec(SCHEMA);
    installEngineRuntimeSchema(raw);
    raw.close();
    return new TextLlmService(new EngineDatabase(file), {
      provider: "fake",
      model: "fake",
      base_url: null,
      reasoning_effort: null,
      credential_keys: [],
    } as never);
  }

  it("streams thinking then text deltas through pi-ai's event path", async () => {
    const updates: LlmStreamUpdate[] = [];
    const res = await fakeLlm().generate({
      system: "You are OutlineAgent.",
      prompt: JSON.stringify({ story: "猫" }),
      onStream: (u) => updates.push({ ...u }),
    });
    expect(updates.length).toBeGreaterThan(5);
    const last = updates.at(-1)!;
    expect(last.text).toBe(res.text);
    expect(last.thinking.length).toBeGreaterThan(0);
    // thinking arrives first and is complete before text starts
    const firstText = updates.findIndex((u) => u.text.length > 0);
    expect(updates[firstText]!.thinking).toBe(last.thinking);
    expect(JSON.parse(res.text)).toHaveProperty("agent", "outline");
  });

  it("can fail mid-stream after partial output", async () => {
    const updates: LlmStreamUpdate[] = [];
    await expect(
      fakeLlm().generate({
        system: "You are OutlineAgent.",
        prompt: JSON.stringify({ story: `猫 ${FAKE_STREAM_ERROR_TOKEN}` }),
        onStream: (u) => updates.push({ ...u }),
      }),
    ).rejects.toThrow(/fake 流式输出中断/);
    expect(updates.at(-1)!.text.length).toBeGreaterThan(0);
  });
});
