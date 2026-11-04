/**
 * Google Veo（Gemini Enterprise Agent Platform / Vertex AI）：
 * POST {base}/publishers/google/models/{model}:predictLongRunning，
 * POST …:fetchPredictOperation 轮询；不设 storageUri 时视频字节直接在响应里。
 * Gemini API 里的 Veo 3.1 Preview 已于 2026-10-22 下线，这里只接 GA 模型。
 * 密钥：express 模式 API Key 走 x-goog-api-key；ya29. 开头的 OAuth 访问令牌走 Bearer。
 * https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text （2026-10-30 核对）
 */
import { fitRatio, joinUrl, splitDataUrl } from "./duration.js";
import { VideoJobError, readJson, record, text } from "./errors.js";
import { jsonInit } from "./http.js";
import type { VideoJobAdapter, VideoJobHttp } from "./types.js";

const label = "Google Veo";

export function veoAuth(http: VideoJobHttp): Record<string, string> {
  return http.apiKey.startsWith("ya29.") ? { Authorization: `Bearer ${http.apiKey}` } : { "x-goog-api-key": http.apiKey };
}

const modelUrl = (http: VideoJobHttp, model: string, method: string) =>
  joinUrl(http.baseUrl, `publishers/google/models/${encodeURIComponent(model)}:${method}`);

export const veo: VideoJobAdapter = {
  id: "veo",
  label,
  durations: () => [4, 6, 8],
  async submit(http, req) {
    const instance: Record<string, unknown> = { prompt: req.prompt };
    if (req.image) {
      const inline = splitDataUrl(req.image);
      if (!inline) throw new VideoJobError(`${label}只接受内联图片：请打开「内联本地图片」`);
      instance.image = { bytesBase64Encoded: inline.base64, mimeType: inline.mime };
    }
    const payload = {
      instances: [instance],
      parameters: {
        sampleCount: 1,
        durationSeconds: req.duration,
        aspectRatio: fitRatio(["16:9", "9:16"], req.ratio),
        ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
      },
    };
    const body = await readJson({ label }, "提交任务", await http.post(modelUrl(http, req.model, "predictLongRunning"), jsonInit(veoAuth(http), payload)));
    const name = text(body.name);
    if (!name) throw new VideoJobError(`${label}没有返回 operation 名称`);
    return name;
  },
  async poll(http, operationName, req) {
    const response = await http.request(modelUrl(http, req.model, "fetchPredictOperation"), jsonInit(veoAuth(http), { operationName }));
    const body = await readJson({ label }, "查询任务", response);
    if (!body.done) return { state: "pending" };
    const error = record(body.error);
    if (Object.keys(error).length) return { state: "failed", message: `${label}生成失败：${text(error.message).slice(0, 200)}` };
    const result = record(body.response);
    const video = Array.isArray(result.videos) ? record(result.videos[0]) : {};
    const bytes = text(video.bytesBase64Encoded);
    if (bytes) return { state: "done", result: { bytes: Buffer.from(bytes, "base64") } };
    if (text(video.gcsUri)) return { state: "failed", message: `${label}把结果写到了 Cloud Storage，KomaSlate 不读取 gs:// 地址` };
    if (Number(result.raiMediaFilteredCount ?? 0) > 0) return { state: "failed", message: `${label}结果被安全策略过滤` };
    return { state: "failed", message: `${label}任务完成但没有视频` };
  },
};
