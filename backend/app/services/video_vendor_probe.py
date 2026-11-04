"""服务商原生视频接口的「测试连接」：只读或只鉴权，绝不提交生成任务。

- 可灵：GET /account/costs（账户资源包查询，只读）
- Vidu：GET /ent/v2/tasks?pager.pagesz=1（任务列表，只读）
- 智谱 CogVideoX：GET /async-result/<不存在的 id>（只验证鉴权）
- MiniMax：GET /query/video_generation?task_id=<不存在的 id>（看 base_resp 鉴权码）
- 通义万相：GET /tasks/<不存在的 id>（只验证鉴权）
- Google Veo：POST :fetchPredictOperation（不存在的 operation，只验证鉴权）

密钥只放请求头，不写进 details 或日志。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import httpx

from app.services.connection_probe import (
    PROBE_TIMEOUT_S,
    ProbeOutcome,
    describe_exception,
    describe_http_status,
)

PROBE_TASK_ID = "komaslate-connection-probe"
VIDEO_VENDOR_LABELS = {
    "kling": "可灵",
    "vidu": "Vidu",
    "zhipu": "智谱 CogVideoX",
    "minimax": "MiniMax 海螺",
    "dashscope": "通义万相",
    "veo": "Google Veo",
}


@dataclass(frozen=True)
class _Probe:
    method: str
    path: str
    headers: dict[str, str]
    params: dict[str, str] | None = None
    json: dict | None = None
    # 认为「鉴权已通过」的非 2xx 状态码（查不存在的任务时服务会回 400 / 404）
    auth_ok: tuple[int, ...] = ()
    # 业务码判定：返回中文失败原因或 None
    business: Callable[[dict], str | None] | None = None


def _bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def _kling_business(body: dict) -> str | None:
    code = body.get("code")
    if isinstance(code, int) and 1000 <= code < 1100:
        return "API Key 无效"
    return None


def _minimax_business(body: dict) -> str | None:
    base = body.get("base_resp") if isinstance(body.get("base_resp"), dict) else {}
    code = base.get("status_code")
    if code in (1004, 2049):
        return "API Key 无效"
    if code == 1008:
        return "余额不足"
    return None


def _veo_business(body: dict) -> str | None:
    text = str(body).lower()
    if "api_key_invalid" in text or "api key not valid" in text:
        return "API Key 无效"
    return None


def _probe_for(provider: str, key: str, model: str | None) -> _Probe:
    if provider == "kling":
        now = int(time.time() * 1000)
        return _Probe(
            "GET",
            "account/costs",
            _bearer(key),
            params={"start_time": str(now - 86_400_000), "end_time": str(now)},
            business=_kling_business,
        )
    if provider == "vidu":
        return _Probe("GET", "ent/v2/tasks", {"Authorization": f"Token {key}"}, params={"pager.pagesz": "1"})
    if provider == "zhipu":
        return _Probe("GET", f"async-result/{PROBE_TASK_ID}", _bearer(key), auth_ok=(400, 404))
    if provider == "minimax":
        return _Probe(
            "GET",
            "query/video_generation",
            _bearer(key),
            params={"task_id": PROBE_TASK_ID},
            auth_ok=(400, 404),
            business=_minimax_business,
        )
    if provider == "dashscope":
        return _Probe("GET", f"tasks/{PROBE_TASK_ID}", _bearer(key), auth_ok=(400, 404))
    if provider == "veo":
        headers = _bearer(key) if key.startswith("ya29.") else {"x-goog-api-key": key}
        name = model or "veo-3.1-generate-001"
        return _Probe(
            "POST",
            f"publishers/google/models/{name}:fetchPredictOperation",
            headers,
            json={"operationName": f"publishers/google/models/{name}/operations/{PROBE_TASK_ID}"},
            auth_ok=(400, 404),
            business=_veo_business,
        )
    raise ValueError(provider)


async def probe_video_vendor(
    *,
    provider: str,
    base_url: str | None,
    api_key: str | None,
    model: str | None,
    timeout_s: float = PROBE_TIMEOUT_S,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProbeOutcome:
    label = VIDEO_VENDOR_LABELS.get(provider, provider)
    if not api_key:
        return ProbeOutcome(False, "invalid", "缺少 API Key", f"填写{label}的 API Key 后再测试。")
    if not base_url:
        return ProbeOutcome(False, "invalid", "缺少 Base URL", f"选择{label}的地域预设或填写 Base URL。")
    probe = _probe_for(provider, api_key, model)
    url = f"{base_url.rstrip('/')}/{probe.path}"
    async with httpx.AsyncClient(timeout=timeout_s, transport=transport) as client:
        try:
            response = await client.request(
                probe.method, url, params=probe.params, headers=probe.headers, json=probe.json
            )
        except Exception as exc:  # noqa: BLE001
            failure = describe_exception(exc)
            return ProbeOutcome(False, "invalid", failure.message, failure.hint)
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if probe.business:
        reason = probe.business(body)
        if reason:
            return ProbeOutcome(False, "invalid", reason, f"{label}拒绝了这个密钥：检查密钥和所选地域是否一致。")
    status = response.status_code
    if status >= 400 and status not in probe.auth_ok:
        failure = describe_http_status(status)
        return ProbeOutcome(False, "invalid", failure.message, failure.hint)
    detail = f"{label}密钥已通过鉴权（只读探测，未提交生成任务）。"
    if provider == "veo":
        detail += "Veo 接入为实验性：express 模式 API Key 是否可用于视频生成未经验证。"
    return ProbeOutcome(True, "valid", "视频服务连接成功", detail)
