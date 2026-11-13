import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { EngineDatabase } from "../src/db.js";
import {
  buildStructuredResponseFormat,
  computeBackoffDelayMs,
  isTransientLlmError,
  parseJsonObjectText,
  TextLlmService,
} from "../src/llm.js";
import { installEngineRuntimeSchema } from "./test-db.js";

const SCHEMA = readFileSync(resolve(import.meta.dirname, "fixtures/app-schema.sql"), "utf8");

describe("structured LLM output", () => {
  it("accepts a plain JSON object", () => {
    expect(parseJsonObjectText('{"shots":[]}')).toEqual({ shots: [] });
  });

  it("accepts a fenced JSON object without weakening object validation", () => {
    expect(parseJsonObjectText('```json\n{"score":8}\n```')).toEqual({ score: 8 });
  });

  it("rejects invalid text instead of manufacturing an empty object", () => {
    expect(() => parseJsonObjectText("not json at all")).toThrow(/valid JSON object/);
  });

  it("rejects JSON arrays because workflow stage contracts require objects", () => {
    expect(() => parseJsonObjectText("[]")).toThrow(/valid JSON object/);
  });

  it("resilience: retries 429 with bounded exponential backoff + jitter and repairs missing required fields (ENG-10)", async () => {
    expect(buildStructuredResponseFormat("openai")).toEqual({ type: "json_object" });
    expect(
      buildStructuredResponseFormat("openai", {
        name: "critic_verdict",
        schema: { type: "object", properties: { score: { type: "number" } } },
      }),
    ).toMatchObject({ type: "json_schema", json_schema: { name: "critic_verdict", strict: true } });
    expect(buildStructuredResponseFormat("anthropic")).toBeUndefined();
    expect(isTransientLlmError("llm error: HTTP 429 rate limit exceeded")).toBe(true);
    expect(isTransientLlmError("llm error: 400 invalid api key")).toBe(false);
    expect(computeBackoffDelayMs(0, 100, 4000, () => 0.5)).toBe(115);

    const dir = mkdtempSync(join(tmpdir(), "komaslate-llm-resilience-"));
    const dbPath = join(dir, "o.db");
    const raw = new SqliteDatabase(dbPath);
    raw.exec(SCHEMA);
    installEngineRuntimeSchema(raw);
    raw.close();
    const db = new EngineDatabase(dbPath);
    try {
      const llm = new TextLlmService(db, { provider: "fake", model: "fake" });
      let callCount = 0;
      (llm as unknown as { generateOnce: unknown }).generateOnce = vi.fn(async () => {
        callCount += 1;
        if (callCount <= 2) {
          throw new Error("llm error: HTTP 429 Too Many Requests");
        }
        if (callCount === 3) {
          // First non-429 answer is valid JSON but missing required `score` field.
          return { text: JSON.stringify({ issues: ["缺少评分"] }), provider: "fake", model: "fake" };
        }
        // Repair prompt supplies the missing `score`.
        return { text: JSON.stringify({ score: 8.5, issues: ["缺少评分"] }), provider: "fake", model: "fake" };
      });

      const started = Date.now();
      const res = await llm.generate({
        system: "critic",
        prompt: "review",
        requiredFields: ["score"],
        retryBaseMs: 25,
        maxRetries: 3,
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(2000);
      expect(callCount).toBe(4);
      expect(JSON.parse(res.text)).toEqual({ score: 8.5, issues: ["缺少评分"] });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
