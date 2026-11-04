/**
 * ModelScope API-Inference only generates images asynchronously: the submit
 * call needs X-ModelScope-Async-Mode and returns a task_id that is polled at
 * {base}/v1/tasks/{id} (X-ModelScope-Task-Type: image_generation) until
 * task_status is SUCCEED with output_images. Without this the ModelScope
 * preset failed in the engine with "image provider returned no URL".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaService, modelScopeTaskUrl, type MediaSettings } from "../src/media/media.js";

const WEBP = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1"), Buffer.alloc(24)]);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

describe("modelScopeTaskUrl", () => {
  it("adds /v1 once whether or not the base already has it", () => {
    expect(modelScopeTaskUrl("https://api-inference.modelscope.cn", "t 1")).toBe(
      "https://api-inference.modelscope.cn/v1/tasks/t%201",
    );
    expect(modelScopeTaskUrl("https://api-inference.modelscope.cn/v1/", "t1")).toBe(
      "https://api-inference.modelscope.cn/v1/tasks/t1",
    );
  });
});

describe("ModelScope async image generation", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let seen: Array<{ method: string; path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }>;
  let polls: number;
  let finalState: Record<string, unknown>;

  beforeEach(async () => {
    vi.stubEnv("KOMASLATE_IMAGE_POLL_MS", "5");
    dir = mkdtempSync(join(tmpdir(), "komaslate-ms-"));
    seen = [];
    polls = 0;
    finalState = { task_status: "SUCCEED", output_images: ["/media/out.webp"] };
    server = createServer(async (req, res) => {
      const raw = await readBody(req);
      const path = req.url ?? "";
      seen.push({ method: req.method ?? "", path, headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      if (path === "/v1/images/generations") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ task_id: "ms_1", request_id: "r" }));
      } else if (path === "/v1/tasks/ms_1") {
        polls += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(polls < 2 ? { task_status: "RUNNING" } : finalState));
      } else if (path === "/media/out.webp") {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(WEBP);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  function service(provider: "modelscope" | "openai" = "modelscope"): MediaService {
    const media = new MediaService({
      staticDir: dir,
      imageProvider: provider,
      imageApiKey: "k",
      imageBaseUrl: base,
      imageEndpoint: "/v1/images/generations",
      imageModel: "Qwen/Qwen-Image",
      enableImageToImage: true,
      fakeImageFixtureUrl: null,
      videoProvider: "fake",
      videoApiKey: "",
      videoBaseUrl: base,
      videoEndpoint: "/v1/videos/generations",
      videoModel: "",
      enableImageToVideo: false,
      videoInlineLocalImages: true,
      publicBaseUrl: null,
      fakeVideoFixtureUrl: null,
    } as MediaSettings);
    media.setMediaRegistrar(() => undefined);
    return media;
  }

  it("submits with the async header, polls the task and stores the image", async () => {
    const url = await service().generateImageUrl({ prompt: "lantern", imageBytes: WEBP });
    const submit = seen.find((s) => s.path === "/v1/images/generations")!;
    expect(submit.headers["x-modelscope-async-mode"]).toBe("true");
    expect(submit.body.image_url).toMatch(/^data:image\/webp;base64,/);
    expect(submit.body.image).toBeUndefined();
    const poll = seen.find((s) => s.path === "/v1/tasks/ms_1")!;
    expect(poll.headers["x-modelscope-task-type"]).toBe("image_generation");
    expect(polls).toBe(2);
    expect(url).toMatch(/^\/static\/managed-v1\/[\w-]+\.webp$/);
    expect(readFileSync(join(dir, url.slice("/static/".length)))).toEqual(WEBP);
  });

  it("reports a FAILED task instead of returning no URL", async () => {
    finalState = { task_status: "FAILED", errors: { message: "content blocked" } };
    await expect(service().generateImageUrl({ prompt: "x" })).rejects.toThrow(
      "image task failed: content blocked",
    );
  });

  it("leaves other providers untouched (no async header, no polling)", async () => {
    await expect(service("openai").generateImageUrl({ prompt: "x" })).rejects.toThrow(
      "image provider returned no URL",
    );
    expect(seen[0]!.headers["x-modelscope-async-mode"]).toBeUndefined();
    expect(polls).toBe(0);
  });
});
