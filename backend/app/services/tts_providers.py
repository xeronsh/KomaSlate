"""云端 / 本地 TTS 服务商（配音）。

每个服务商只负责「文本 + 音色 → mp3 字节」；重试、落盘、混音都在 AudioService。
接口均按官方文档实现，来源见 docs/providers.md 的「配音」一节。密钥只放进请求头，
不写日志、不进错误信息。
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from xml.sax.saxutils import escape

import httpx

TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# 每个服务商的默认值：选预设时前端会写入，这里兜底
DEFAULTS: dict[str, dict[str, str]] = {
    "edge": {"voice": "zh-CN-XiaoxiaoNeural"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini-tts", "voice": "marin"},
    "elevenlabs": {
        "base_url": "https://api.elevenlabs.io/v1",
        "model": "eleven_multilingual_v2",
        "voice": "JBFqnCBsd6RMkjVDRZzb",
    },
    "azure": {"base_url": "https://eastasia.tts.speech.microsoft.com", "voice": "zh-CN-XiaoxiaoNeural"},
    "minimax": {
        "base_url": "https://api.minimaxi.com/v1",
        "model": "speech-2.8-hd",
        "voice": "Chinese (Mandarin)_Lyrical_Voice",
    },
    "cosyvoice": {
        "base_url": "https://dashscope.aliyuncs.com/api/v1",
        "model": "cosyvoice-v3-flash",
        "voice": "longanyang",
    },
    "doubao": {
        "base_url": "https://openspeech.bytedance.com/api/v3",
        "model": "seed-tts-2.0",
        "voice": "zh_female_vv_uranus_bigtts",
    },
}

PROVIDERS = tuple(DEFAULTS)


class TTSProviderError(RuntimeError):
    """服务商返回错误；message 已是中文、不含密钥。"""


@dataclass(frozen=True)
class TTSConfig:
    provider: str
    base_url: str
    api_key: str
    model: str

    @classmethod
    def build(cls, provider: str, base_url: str | None, api_key: str | None, model: str | None) -> "TTSConfig":
        provider = (provider or "edge").lower()
        defaults = DEFAULTS.get(provider, {})
        return cls(
            provider=provider,
            base_url=(base_url or defaults.get("base_url", "")).rstrip("/"),
            api_key=api_key or "",
            model=model or defaults.get("model", ""),
        )


def default_voice(provider: str) -> str:
    return DEFAULTS.get(provider, DEFAULTS["edge"])["voice"]


def _raise_for(label: str, response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    if response.status_code in (401, 403):
        raise TTSProviderError(f"{label}拒绝了密钥（HTTP {response.status_code}）")
    raise TTSProviderError(f"{label}返回 HTTP {response.status_code}：{response.text[:200]}")


async def synthesize(config: TTSConfig, text: str, voice: str) -> bytes:
    """返回 mp3 字节。edge 由 AudioService 直接用 edge-tts 处理，不走这里。"""
    if config.provider != "edge" and not config.api_key:
        raise TTSProviderError("配音服务商需要 TTS_API_KEY")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if config.provider == "openai":
            return await _openai(client, config, text, voice)
        if config.provider == "elevenlabs":
            return await _elevenlabs(client, config, text, voice)
        if config.provider == "azure":
            return await _azure(client, config, text, voice)
        if config.provider == "minimax":
            return await _minimax(client, config, text, voice)
        if config.provider == "cosyvoice":
            return await _cosyvoice(client, config, text, voice)
        if config.provider == "doubao":
            return await _doubao(client, config, text, voice)
    raise TTSProviderError(f"不支持的配音服务商：{config.provider}")


async def _openai(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    # POST /audio/speech（OpenAI 及兼容服务）
    response = await client.post(
        f"{config.base_url}/audio/speech",
        headers={"Authorization": f"Bearer {config.api_key}"},
        json={"model": config.model, "input": text, "voice": voice, "response_format": "mp3"},
    )
    _raise_for("OpenAI 配音", response)
    return response.content


async def _elevenlabs(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    response = await client.post(
        f"{config.base_url}/text-to-speech/{voice}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": config.api_key},
        json={"text": text, "model_id": config.model},
    )
    _raise_for("ElevenLabs 配音", response)
    return response.content


async def _azure(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    lang = "-".join(voice.split("-")[:2]) or "zh-CN"
    ssml = (
        f"<speak version='1.0' xml:lang='{lang}'>"
        f"<voice name='{escape(voice)}'>{escape(text)}</voice></speak>"
    )
    response = await client.post(
        f"{config.base_url}/cognitiveservices/v1",
        headers={
            "Ocp-Apim-Subscription-Key": config.api_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "KomaSlate",
        },
        content=ssml.encode("utf-8"),
    )
    _raise_for("Azure 语音", response)
    return response.content


async def _minimax(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    response = await client.post(
        f"{config.base_url}/t2a_v2",
        headers={"Authorization": f"Bearer {config.api_key}"},
        json={
            "model": config.model,
            "text": text,
            "stream": False,
            "voice_setting": {"voice_id": voice, "speed": 1, "vol": 1, "pitch": 0},
            "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
            "output_format": "hex",
        },
    )
    _raise_for("MiniMax 配音", response)
    body = response.json()
    status = (body.get("base_resp") or {}).get("status_code", 0)
    if status:
        if status == 1004:
            raise TTSProviderError("MiniMax 配音拒绝了密钥（1004）")
        raise TTSProviderError(f"MiniMax 配音失败：{(body.get('base_resp') or {}).get('status_msg', status)}")
    audio = ((body.get("data") or {}).get("audio")) or ""
    if not audio:
        raise TTSProviderError("MiniMax 配音没有返回音频")
    return bytes.fromhex(audio)


async def _cosyvoice(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    # 非流式：不带 X-DashScope-SSE，返回 24 小时有效的音频 URL
    response = await client.post(
        f"{config.base_url}/services/audio/tts/SpeechSynthesizer",
        headers={"Authorization": f"Bearer {config.api_key}"},
        json={
            "model": config.model,
            "input": {"text": text, "voice": voice, "format": "mp3", "sample_rate": 24000},
        },
    )
    _raise_for("CosyVoice 配音", response)
    body = response.json()
    url = ((body.get("output") or {}).get("audio") or {}).get("url")
    if not url:
        raise TTSProviderError(f"CosyVoice 没有返回音频：{body.get('message') or body.get('code') or ''}"[:200])
    audio = await client.get(url)
    _raise_for("CosyVoice 音频下载", audio)
    return audio.content


async def _doubao(client: httpx.AsyncClient, config: TTSConfig, text: str, voice: str) -> bytes:
    # 单向流式 HTTP：逐行 JSON，data 为 base64 音频片段；code 20000000 表示结束
    chunks: list[bytes] = []
    async with client.stream(
        "POST",
        f"{config.base_url}/tts/unidirectional",
        headers={"X-Api-Key": config.api_key, "X-Api-Resource-Id": config.model},
        json={
            "user": {"uid": "komaslate"},
            "req_params": {
                "text": text,
                "speaker": voice,
                "audio_params": {"format": "mp3", "sample_rate": 24000},
            },
        },
    ) as response:
        if response.status_code >= 400:
            await response.aread()
            _raise_for("豆包语音", response)
        async for line in response.aiter_lines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except ValueError:
                continue
            code = item.get("code", 0)
            if item.get("data"):
                chunks.append(base64.b64decode(item["data"]))
            if code not in (0, 20000000):
                raise TTSProviderError(f"豆包语音失败：{item.get('message', code)}"[:200])
    if not chunks:
        raise TTSProviderError("豆包语音没有返回音频")
    return b"".join(chunks)


async def probe(config: TTSConfig, voice: str):
    """设置页「测试连接」：只读探测，不合成任何音频、不计费。"""
    from app.services.connection_probe import (
        PROBE_TIMEOUT_S,
        ProbeOutcome,
        describe_exception,
        describe_http_status,
        probe_openai_compatible,
    )

    if config.provider == "edge":
        try:
            import edge_tts

            voices = await edge_tts.list_voices()
        except Exception as exc:  # noqa: BLE001
            failure = describe_exception(exc)
            return ProbeOutcome(False, "invalid", "Edge 配音服务连不上", failure.hint)
        names = {item.get("ShortName") for item in voices}
        if voice and voice not in names:
            return ProbeOutcome(True, "degraded", "Edge 配音可用，但没有这个音色", f"音色列表里没有「{voice}」。")
        return ProbeOutcome(True, "valid", "配音服务连接成功", f"Edge TTS 可用，共 {len(names)} 个音色。")
    if not config.api_key:
        return ProbeOutcome(False, "invalid", "缺少 API Key", "填写配音服务的 API Key 后再测试。")
    if config.provider == "openai":
        return await probe_openai_compatible(
            label="配音",
            base_url=config.base_url,
            endpoint="/audio/speech",
            api_key=config.api_key,
            model=config.model,
        )
    if config.provider == "doubao":
        return ProbeOutcome(
            True,
            "degraded",
            "豆包语音无法免费验证密钥",
            "火山引擎语音没有只读的查询接口；保存后生成一次即可确认。",
        )

    request: tuple[str, str, dict[str, str], dict | None]
    if config.provider == "elevenlabs":
        request = ("GET", f"{config.base_url}/voices", {"xi-api-key": config.api_key}, None)
    elif config.provider == "azure":
        request = (
            "GET",
            f"{config.base_url}/cognitiveservices/voices/list",
            {"Ocp-Apim-Subscription-Key": config.api_key},
            None,
        )
    elif config.provider == "minimax":
        request = (
            "POST",
            f"{config.base_url}/get_voice",
            {"Authorization": f"Bearer {config.api_key}"},
            {"voice_type": "system"},
        )
    elif config.provider == "cosyvoice":
        root = config.base_url.split("/api/")[0]
        request = (
            "GET",
            f"{root}/compatible-mode/v1/models",
            {"Authorization": f"Bearer {config.api_key}"},
            None,
        )
    else:
        return ProbeOutcome(False, "invalid", "不支持的配音服务商", config.provider)

    method, url, headers, body = request
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_S) as client:
        try:
            response = await client.request(method, url, headers=headers, json=body)
        except Exception as exc:  # noqa: BLE001
            failure = describe_exception(exc)
            return ProbeOutcome(False, "invalid", failure.message, failure.hint)
    if response.status_code >= 400:
        failure = describe_http_status(response.status_code)
        return ProbeOutcome(False, "invalid", failure.message, failure.hint)
    if config.provider == "minimax":
        try:
            status = (response.json().get("base_resp") or {}).get("status_code", 0)
        except ValueError:
            status = 0
        if status:
            return ProbeOutcome(False, "invalid", "MiniMax 拒绝了请求", f"状态码 {status}，检查密钥和接入地址。")
    return ProbeOutcome(True, "valid", "配音服务连接成功", "地址和密钥有效。")
