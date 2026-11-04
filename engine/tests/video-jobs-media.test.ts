/**
 * MediaService 接入服务商原生视频接口：本地假服务器模拟 CogVideoX 和 Veo，
 * 检查 VIDEO_PROVIDER / VIDEO_RATIO 解析、时长取整、首帧内联、结果落盘，
 * 以及错误信息里不出现密钥。不发任何真实请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaService, resolveMediaSettings, type MediaSettings } from "../src/media/media.js";
import type { EngineDatabase } from "../src/db.js";

const KEY = "vendor-key-DO-NOT-LEAK";
const WEBP = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1"), Buffer.alloc(24)]);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fakeDb(values: Record<string, string>): EngineDatabase {
  return { configValue: (key: string, _env: string, fallback?: string) => values[key] ?? fallback ?? null } as unknown as EngineDatabase;
}

describe("resolveMediaSettings for vendor-native video", () => {
  it("accepts vendor providers, reads VIDEO_API_KEY and VIDEO_RATIO", () => {
    const settings = resolveMediaSettings(
      fakeDb({ VIDEO_PROVIDER: "kling", VIDEO_API_KEY: KEY, VIDEO_RATIO: "9:16", VIDEO_BASE_URL: "https://api-beijing.klingai.com", VIDEO_MODEL: "kling-3.0" }),
    );
    expect(settings.videoProvider).toBe("kling");
    expect(settings.videoApiKey).toBe(KEY);
    expect(settings.videoRatio).toBe("9:16");
  });

  it("takes the ratio from a run snapshot and defaults to 16:9", () => {
    const db = fakeDb({ VIDEO_API_KEY: KEY });
    const pinned = resolveMediaSettings(db, {
      video: { provider: "vidu", base_url: "https://api.vidu.cn", model: "viduq3-pro", ratio: "1:1", credential_keys: ["VIDEO_API_KEY"] },
    } as never);
    expect(pinned.videoProvider).toBe("vidu");
    expect(pinned.videoRatio).toBe("1:1");
    expect(pinned.videoApiKey).toBe(KEY);
    expect(resolveMediaSettings(fakeDb({ VIDEO_PROVIDER: "nope" })).videoProvider).toBe("fake");
    expect(resolveMediaSettings(fakeDb({ VIDEO_PROVIDER: "veo" })).videoRatio).toBe("16:9");
  });
});

describe("MediaService vendor video", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let seen: Array<{ method: string; path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }>;
  let polls: number;
  let createStatus: number;

  beforeEach(async () => {
    vi.stubEnv("KOMASLATE_VIDEO_POLL_MS", "2");
    dir = mkdtempSync(join(tmpdir(), "komaslate-vj-"));
    seen = [];
    polls = 0;
    createStatus = 200;
    server = createServer(async (req, res) => {
      const raw = await readBody(req);
      const path = req.url ?? "";
      seen.push({ method: req.method ?? "", path, headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (path === "/v4/videos/generations") json(createStatus, createStatus === 200 ? { id: "z1", task_status: "PROCESSING" } : { error: { message: "令牌已过期" } });
      else if (path === "/v4/async-result/z1") {
        polls += 1;
        json(200, polls < 2 ? { task_status: "PROCESSING" } : { task_status: "SUCCESS", video_result: [{ url: `${base}/files/v.mp4` }] });
      } else if (path === "/files/v.mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end(Buffer.from("zhipu-mp4"));
      } else if (path === "/media/frame.webp") {
        res.writeHead(200, { "Content-Type": "image/webp" });
        res.end(WEBP);
      } else if (path.endsWith(":predictLongRunning")) json(200, { name: "operations/op1" });
      else if (path.endsWith(":fetchPredictOperation"))
        json(200, { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from("veo-mp4").toString("base64") }] } });
      else res.writeHead(404).end();
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

  function service(over: Partial<MediaSettings>): MediaService {
    const media = new MediaService({
      staticDir: dir,
      imageProvider: "fake",
      imageApiKey: null,
      imageBaseUrl: base,
      imageEndpoint: "/images/generations",
      imageModel: "",
      enableImageToImage: false,
      fakeImageFixtureUrl: null,
      videoApiKey: KEY,
      videoEndpoint: "",
      enableImageToVideo: true,
      videoInlineLocalImages: true,
      videoRatio: "9:16",
      publicBaseUrl: null,
      fakeVideoFixtureUrl: null,
      ...over,
    } as MediaSettings);
    media.setMediaRegistrar(() => undefined);
    return media;
  }

  it("CogVideoX: inlines the first frame, snaps duration, stores the mp4", async () => {
    const media = service({ videoProvider: "zhipu", videoBaseUrl: `${base}/v4`, videoModel: "cogvideox-3" });
    const url = await media.generateVideoUrl({ prompt: "灯笼", imageUrl: `${base}/media/frame.webp`, duration: 8 });
    const create = seen.find((s) => s.path === "/v4/videos/generations")!;
    expect(create.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(create.body).toMatchObject({ model: "cogvideox-3", duration: 10, image_url: `data:image/webp;base64,${WEBP.toString("base64")}` });
    expect(polls).toBe(2);
    expect(url).toMatch(/^\/static\/managed-v1\/[\w-]+\.mp4$/);
    expect(readFileSync(join(dir, url.slice("/static/".length))).toString()).toBe("zhipu-mp4");
  });

  it("Veo: writes inline bytes to disk", async () => {
    const media = service({ videoProvider: "veo", videoBaseUrl: base, videoModel: "veo-3.1-generate-001", enableImageToVideo: false });
    const url = await media.generateVideoUrl({ prompt: "灯笼", duration: 5 });
    const create = seen.find((s) => s.path.endsWith(":predictLongRunning"))!;
    expect(create.body).toMatchObject({ parameters: { durationSeconds: 6, aspectRatio: "9:16" } });
    expect(existsSync(join(dir, url.slice("/static/".length)))).toBe(true);
    expect(readFileSync(join(dir, url.slice("/static/".length))).toString()).toBe("veo-mp4");
  });

  it("reports vendor errors in Chinese without the key", async () => {
    createStatus = 401;
    const media = service({ videoProvider: "zhipu", videoBaseUrl: `${base}/v4`, videoModel: "cogvideox-3" });
    const error = await media.generateVideoUrl({ prompt: "灯笼" }).catch((e: Error) => e);
    expect((error as Error).message).toContain("API Key 无效");
    expect((error as Error).message).toContain("令牌已过期");
    expect((error as Error).message).not.toContain(KEY);
  });

  it("requires a key", async () => {
    const media = service({ videoProvider: "kling", videoBaseUrl: base, videoModel: "kling-3.0", videoApiKey: null });
    await expect(media.generateVideoUrl({ prompt: "x" })).rejects.toThrow("可灵需要 VIDEO_API_KEY");
  });
});
