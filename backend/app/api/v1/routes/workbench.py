"""Northbound gateway endpoints for the Option 3 Node-Graph & Protocol Workbench."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ReadonlySessionDep, SessionDep, SettingsDep, get_or_404
from app.config import Settings
from app.generated.workflow_contract import PHASE2_STAGE_ORDER
from app.models.agent_run import AgentRun
from app.models.project import Project
from app.services.engine_client import EngineUnavailableError, engine_health, engine_proxy_json
from app.services.human_auth import HUMAN_AUTH_TTL_SECONDS, issue_human_auth_token

router = APIRouter()

_BACKEND_DIR = Path(__file__).resolve().parents[4]
_PROTOCOL_EVENT_TYPES = (
    "mcp_server_status",
    "mcp_rpc_request",
    "mcp_rpc_response",
    "mcp_tool_called",
    "cli_process_started",
    "cli_stdout",
    "cli_process_exited",
    "agent_thought",
    "chat_agent_thought",
    "shot_invalidation_cascaded",
    "chat_confirmation_created",
    "chat_confirmation_resolved",
    "chat_confirmation_expired",
)


class HumanAuthTokenResponse(BaseModel):
    run_id: int
    human_auth_token: str
    expires_at: str
    expires_in: int = HUMAN_AUTH_TTL_SECONDS
    ttl_seconds: int = HUMAN_AUTH_TTL_SECONDS


class McpServerRead(BaseModel):
    id: str
    name: str
    transport: str
    enabled: bool = True
    status: Literal["online", "offline", "error"] = "offline"
    latency_ms: float | None = None
    policy: Literal["auto_readonly", "confirm_writes"] = "confirm_writes"
    tools_count: int = 0


class McpServerListResponse(BaseModel):
    servers: list[McpServerRead]


class McpPingResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    error: str | None = None
    server: McpServerRead | None = None


class McpPolicyUpdateRequest(BaseModel):
    policy: Literal["auto_readonly", "read_only_auto", "readonly_auto", "confirm_writes"]


class McpServerToggleRequest(BaseModel):
    enabled: bool


class CliToolRead(BaseModel):
    name: str
    version: str
    description: str
    sample_command: str
    available: bool = True


class CliToolListResponse(BaseModel):
    tools: list[CliToolRead]


class CliDryRunRequest(BaseModel):
    tool: Literal[
        "komaslate",
        "komaslate-media",
        "engine_media_cli",
        "dreamina",
        "ffmpeg",
        "python",
        "node",
    ]
    command: str | None = None
    args: list[str] = Field(default_factory=list)


class CliDryRunResponse(BaseModel):
    tool: str
    command: str | None = None
    ok: bool = True
    exit_code: int
    stdout: str
    stderr: str | None = None
    duration_ms: float | None = None


def _normalize_mcp_server(raw: dict[str, Any]) -> McpServerRead:
    raw_status = str(raw.get("status") or "offline")
    if raw_status in ("connected", "online"):
        mapped_status: Literal["online", "offline", "error"] = "online"
    elif raw_status in ("unhealthy", "error"):
        mapped_status = "error"
    else:
        mapped_status = "offline"

    raw_policy = str(raw.get("policy") or "confirm_writes")
    mapped_policy: Literal["auto_readonly", "confirm_writes"] = (
        "auto_readonly"
        if raw_policy in ("auto_readonly", "read_only_auto", "readonly_auto")
        else "confirm_writes"
    )
    name = str(raw.get("name") or raw.get("server_name") or raw.get("id") or "")
    server_id = str(raw.get("id") or name)
    tools = raw.get("tools")
    tools_count = (
        int(raw["tools_count"])
        if isinstance(raw.get("tools_count"), (int, float))
        else len(tools)
        if isinstance(tools, list)
        else 0
    )
    latency = raw.get("latency_ms")
    return McpServerRead(
        id=server_id,
        name=name,
        transport=str(raw.get("transport") or "stdio"),
        enabled=bool(raw.get("enabled", True)),
        status=mapped_status,
        latency_ms=float(latency) if isinstance(latency, (int, float)) else None,
        policy=mapped_policy,
        tools_count=tools_count,
    )


def _default_cli_tools() -> list[CliToolRead]:
    return [
        CliToolRead(
            name="komaslate",
            version="0.1.0",
            description="KomaSlate 统一命令行入口 (run / inspect / mcp / dev / media / gate)",
            sample_command="komaslate inspect 1 --shots --json",
            available=True,
        ),
        CliToolRead(
            name="komaslate-media",
            version="0.1.0",
            description="KomaSlate 常驻媒体零拷贝工作进程 (InsightFace / 九宫格 / TTS)",
            sample_command="komaslate media mcp",
            available=True,
        ),
        CliToolRead(
            name="dreamina",
            version="cli",
            description="即梦 CLI 图像与图生视频工具",
            sample_command="dreamina --help",
            available=shutil.which("dreamina") is not None,
        ),
        CliToolRead(
            name="ffmpeg",
            version="system",
            description="音视频混流与转场合成引擎",
            sample_command="ffmpeg -version",
            available=shutil.which("ffmpeg") is not None,
        ),
    ]


@router.post("/runs/{run_id}/human-auth-token", response_model=HumanAuthTokenResponse)
async def create_human_auth_token(
    run_id: int,
    session: AsyncSession = SessionDep,
) -> HumanAuthTokenResponse:
    """Mint a 60s single-use token from an explicit human UI click."""
    await get_or_404(session, AgentRun, run_id)
    token, expires_at = await issue_human_auth_token(session, run_id=run_id)
    return HumanAuthTokenResponse(
        run_id=run_id,
        human_auth_token=token,
        expires_at=expires_at,
        expires_in=HUMAN_AUTH_TTL_SECONDS,
        ttl_seconds=HUMAN_AUTH_TTL_SECONDS,
    )


@router.get("/projects/{project_id}/workbench/state")
async def get_workbench_state(
    project_id: int,
    session: AsyncSession = ReadonlySessionDep,
) -> dict[str, Any]:
    """Read-only projection of pending chat confirmations and recent protocol events."""
    await get_or_404(session, Project, project_id)

    pending_confirmations: list[dict[str, Any]] = []
    try:
        rows = await session.execute(
            text(
                "SELECT id, project_id, tool_call_id, tool_name, tool_label, "
                "parameters_json, summary, status, created_at "
                "FROM chat_confirmation "
                "WHERE project_id = :pid AND status = 'pending' "
                "ORDER BY id ASC"
            ),
            {"pid": project_id},
        )
        for row in rows.mappings().all():
            item = dict(row)
            try:
                item["parameters"] = json.loads(str(item.get("parameters_json") or "{}"))
            except (TypeError, ValueError):
                item["parameters"] = {}
            pending_confirmations.append(item)
    except Exception:
        pending_confirmations = []

    protocol_events: list[dict[str, Any]] = []
    try:
        placeholders = ", ".join(f":t{i}" for i in range(len(_PROTOCOL_EVENT_TYPES)))
        params: dict[str, Any] = {"pid": project_id}
        for i, etype in enumerate(_PROTOCOL_EVENT_TYPES):
            params[f"t{i}"] = etype
        evt_rows = await session.execute(
            text(
                f"SELECT seq, run_id, type, payload, created_at "
                f"FROM engine_run_events "
                f"WHERE project_id = :pid AND type IN ({placeholders}) "
                f"ORDER BY seq DESC LIMIT 100"
            ),
            params,
        )
        for seq, run_id, etype, payload_raw, created_at in evt_rows.all():
            try:
                payload = json.loads(str(payload_raw or "{}"))
            except (TypeError, ValueError):
                payload = {}
            protocol_events.append(
                {
                    "seq": int(seq),
                    "run_id": int(run_id),
                    "type": str(etype),
                    "data": payload,
                    "created_at": str(created_at),
                }
            )
        protocol_events.reverse()
    except Exception:
        protocol_events = []

    return {
        "project_id": project_id,
        "stages": list(PHASE2_STAGE_ORDER),
        "pending_confirmations": pending_confirmations,
        "protocol_events": protocol_events,
    }


@router.get("/mcp/servers", response_model=McpServerListResponse)
async def list_mcp_servers(settings: Settings = SettingsDep) -> McpServerListResponse:
    """List outbound MCP servers registered in the Engine."""
    health = await engine_health(settings.engine_url)
    if health is None:
        return McpServerListResponse(servers=[])
    try:
        code, payload = await engine_proxy_json(settings.engine_url, "GET", "/mcp/servers")
    except EngineUnavailableError:
        return McpServerListResponse(servers=[])
    if code != 200 or not isinstance(payload.get("servers"), list):
        return McpServerListResponse(servers=[])
    return McpServerListResponse(
        servers=[_normalize_mcp_server(s) for s in payload["servers"] if isinstance(s, dict)]
    )


@router.post("/mcp/servers/{server_id}/ping", response_model=McpPingResponse)
@router.post("/workbench/mcp/{server_id}/ping", response_model=McpPingResponse)
async def ping_outbound_mcp(
    server_id: str,
    settings: Settings = SettingsDep,
) -> McpPingResponse:
    try:
        code, payload = await engine_proxy_json(
            settings.engine_url, "POST", f"/mcp/servers/{server_id}/ping"
        )
    except EngineUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if code >= 400:
        raise HTTPException(status_code=code, detail=payload)
    server_raw = payload.get("server")
    return McpPingResponse(
        ok=bool(payload.get("ok", False)),
        latency_ms=payload.get("latency_ms"),
        error=payload.get("error"),
        server=_normalize_mcp_server(server_raw) if isinstance(server_raw, dict) else None,
    )


@router.patch("/mcp/servers/{server_id}/policy", response_model=McpServerRead)
@router.patch("/workbench/mcp/{server_id}/policy", response_model=McpServerRead)
async def update_outbound_mcp_policy(
    server_id: str,
    payload: McpPolicyUpdateRequest,
    settings: Settings = SettingsDep,
) -> McpServerRead:
    engine_policy = (
        "read_only_auto"
        if payload.policy in ("auto_readonly", "read_only_auto", "readonly_auto")
        else "confirm_writes"
    )
    try:
        code, body = await engine_proxy_json(
            settings.engine_url,
            "PATCH",
            f"/mcp/servers/{server_id}/policy",
            {"policy": engine_policy},
        )
    except EngineUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if code >= 400:
        raise HTTPException(status_code=code, detail=body)
    return _normalize_mcp_server(body)


@router.patch("/mcp/servers/{server_id}", response_model=McpServerRead)
@router.patch("/workbench/mcp/{server_id}", response_model=McpServerRead)
async def toggle_outbound_mcp_server(
    server_id: str,
    payload: McpServerToggleRequest,
    settings: Settings = SettingsDep,
) -> McpServerRead:
    try:
        code, body = await engine_proxy_json(
            settings.engine_url,
            "PATCH",
            f"/mcp/servers/{server_id}",
            {"enabled": payload.enabled},
        )
    except EngineUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if code >= 400:
        raise HTTPException(status_code=code, detail=body)
    return _normalize_mcp_server(body)


@router.get("/cli/tools", response_model=CliToolListResponse)
async def list_cli_tools(settings: Settings = SettingsDep) -> CliToolListResponse:
    """List local CLI tools available to KomaSlate and Engine."""
    tools_by_name: dict[str, CliToolRead] = {t.name: t for t in _default_cli_tools()}
    health = await engine_health(settings.engine_url)
    if health is not None:
        try:
            cli_code, cli_payload = await engine_proxy_json(settings.engine_url, "GET", "/cli/tools")
            if cli_code == 200 and isinstance(cli_payload.get("tools"), list):
                for raw in cli_payload["tools"]:
                    if not isinstance(raw, dict):
                        continue
                    name = str(raw.get("name") or raw.get("id") or "")
                    if not name:
                        continue
                    tools_by_name[name] = CliToolRead(
                        name=name,
                        version=str(raw.get("version") or "engine"),
                        description=str(raw.get("description") or raw.get("label") or name),
                        sample_command=str(raw.get("sample_command") or raw.get("command") or name),
                        available=bool(raw.get("available", True)),
                    )
        except EngineUnavailableError:
            pass
    return CliToolListResponse(tools=list(tools_by_name.values()))


@router.post("/cli/dry-run", response_model=CliDryRunResponse)
@router.post("/workbench/cli/dry-run", response_model=CliDryRunResponse)
async def dry_run_cli_tool(
    payload: CliDryRunRequest,
    settings: Settings = SettingsDep,
) -> CliDryRunResponse:
    """Run an allowlisted non-destructive CLI inspection/version check."""
    try:
        code, body = await engine_proxy_json(
            settings.engine_url,
            "POST",
            "/cli/dry-run",
            {"tool": payload.tool, "command": payload.command, "args": payload.args},
        )
        if code == 200 and isinstance(body, dict) and "exit_code" in body:
            exit_code = int(body["exit_code"])
            return CliDryRunResponse(
                tool=payload.tool,
                command=body.get("command") or payload.command,
                ok=exit_code == 0,
                exit_code=exit_code,
                stdout=str(body.get("stdout") or ""),
                stderr=body.get("stderr"),
                duration_ms=body.get("duration_ms"),
            )
    except EngineUnavailableError:
        pass

    if payload.tool in ("komaslate", "komaslate-media"):
        cmd = [sys.executable, "-m", "app.cli.main", "--help"]
    elif payload.tool == "engine_media_cli":
        cmd = [
            sys.executable,
            "-c",
            "import app.services.engine_media_cli as m; print('engine_media_cli ready')",
        ]
    elif payload.tool == "python":
        cmd = [sys.executable, "--version"]
    elif payload.tool == "node":
        binary = shutil.which("node")
        if not binary:
            return CliDryRunResponse(
                tool="node",
                ok=False,
                exit_code=127,
                stdout="",
                stderr="node not found in PATH",
                duration_ms=0.0,
            )
        cmd = [binary, "--version"]
    elif payload.tool == "ffmpeg":
        binary = shutil.which("ffmpeg")
        if not binary:
            return CliDryRunResponse(
                tool="ffmpeg",
                ok=False,
                exit_code=127,
                stdout="",
                stderr="ffmpeg not found in PATH",
                duration_ms=0.0,
            )
        cmd = [binary, "-version"]
    else:
        binary = shutil.which("dreamina")
        if not binary:
            return CliDryRunResponse(
                tool="dreamina",
                ok=False,
                exit_code=127,
                stdout="",
                stderr="dreamina not found in PATH",
                duration_ms=0.0,
            )
        cmd = [binary, "--help"]

    started = time.monotonic()
    proc = await asyncio.to_thread(
        subprocess.run,
        cmd,
        cwd=str(_BACKEND_DIR),
        capture_output=True,
        text=True,
        timeout=5,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000, 2)
    return CliDryRunResponse(
        tool=payload.tool,
        command=" ".join(cmd),
        ok=proc.returncode == 0,
        exit_code=proc.returncode,
        stdout=proc.stdout[:4000],
        stderr=proc.stderr[:2000] if proc.stderr else None,
        duration_ms=elapsed_ms,
    )


@router.get("/workbench/protocol-hub")
async def get_protocol_hub(settings: Settings = SettingsDep) -> dict[str, Any]:
    """Aggregate Outbound MCP, local CLI tools, and Inbound MCP config for #hubDialog."""
    servers_resp = await list_mcp_servers(settings=settings)
    cli_resp = await list_cli_tools(settings=settings)
    health = await engine_health(settings.engine_url)

    inbound_config = {
        "mcpServers": {
            "komaslate": {
                "command": "uv",
                "args": [
                    "run",
                    "--directory",
                    str(_BACKEND_DIR),
                    "komaslate",
                    "mcp",
                    "serve",
                ],
                "env": {
                    "ENGINE_URL": settings.engine_url,
                    "KOMASLATE_GATEWAY": "http://127.0.0.1:18765",
                },
            }
        }
    }

    return {
        "engine_online": health is not None,
        "outbound_mcp": [s.model_dump() for s in servers_resp.servers],
        "cli_tools": [t.model_dump() for t in cli_resp.tools],
        "inbound_mcp": {
            "transport": ["stdio", "http"],
            "http_default_port": 18768,
            "config_snippet": inbound_config,
            "resources": [
                "komaslate://projects/{id}",
                "komaslate://runs/{id}",
                "komaslate://nodes/{kind}/{id}",
                "komaslate://gates/{run_id}",
            ],
            "tools": [
                "inspect_project",
                "trigger_run",
                "resume_run",
                "cancel_run",
                "submit_gate_feedback",
                "submit_gate_approval",
                "update_shot",
            ],
        },
    }
