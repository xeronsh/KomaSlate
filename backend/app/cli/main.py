"""Unified KomaSlate CLI: run / inspect / mcp / dev / media / prune-events / gate."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select, text

from app.config import get_settings
from app.db.session import async_readonly_session_maker, async_session_maker
from app.models.agent_run import AgentRun
from app.models.project import Character, Project, Shot

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_DIR.parent


async def _cmd_run(args: argparse.Namespace) -> int:
    gateway = args.gateway.rstrip("/")
    project_id = int(args.project_id)
    async with httpx.AsyncClient(timeout=30.0) as client:
        if args.stage == "full":
            resp = await client.post(
                f"{gateway}/api/v1/projects/{project_id}/runs",
                json={"auto_mode": bool(args.auto)},
            )
            if resp.status_code >= 400:
                print(f"Error ({resp.status_code}): {resp.text}", file=sys.stderr)
                return 1
            run = resp.json()
            run_id = int(run["id"])
        else:
            from app.generated.workflow_contract import WORKFLOW_VERSION
            from app.services.engine_client import (
                EngineUnavailableError,
                engine_start_run,
                ensure_engine_running,
            )
            from app.services.file_cleaner import STATIC_DIR
            from app.services.project_versions import capture_project_version
            from app.services.provider_resolution import resolve_project_provider_settings_async
            from app.services.run_context import build_run_context_snapshot

            settings = get_settings()
            try:
                await ensure_engine_running(settings.engine_url, settings.database_url, STATIC_DIR)
            except EngineUnavailableError as exc:
                print(f"Engine unavailable: {exc}", file=sys.stderr)
                return 1

            async with async_session_maker() as session:
                project = await session.get(Project, project_id)
                if project is None:
                    print(f"Project {project_id} not found", file=sys.stderr)
                    return 1
                resolution = await resolve_project_provider_settings_async(project, settings)
                if not resolution.valid:
                    print("Provider configuration invalid; cannot start run", file=sys.stderr)
                    return 1
                previous_version = await capture_project_version(session, project_id)
                ctx = await build_run_context_snapshot(
                    session=session,
                    settings=settings,
                    project=project,
                    provider_resolution=resolution,
                )
                run_obj = AgentRun(
                    project_id=project_id,
                    status="queued",
                    current_agent="orchestrator",
                    progress=0.0,
                    provider_snapshot=resolution.as_project_provider_settings().model_dump(mode="json"),
                    workflow_version=WORKFLOW_VERSION,
                    context_snapshot={
                        **ctx,
                        **({"previous_version": previous_version} if previous_version else {}),
                        "execution_command": {
                            "version": 1,
                            "stage": args.stage,
                            "auto_mode": bool(args.auto),
                            "user_feedback": "",
                            "target_character_ids": [],
                            "target_shot_ids": [],
                        },
                    },
                )
                session.add(run_obj)
                await session.commit()
                await session.refresh(run_obj)
                assert run_obj.id is not None
                run_id = run_obj.id
            await engine_start_run(
                settings.engine_url,
                project_id=project_id,
                run_id=run_id,
                stage=args.stage,
                auto_mode=bool(args.auto),
            )

        print(f"Run {run_id} started (project={project_id}, stage={args.stage}, auto={args.auto})")
        if not args.watch:
            return 0

        last_seq = 0
        while True:
            async with async_readonly_session_maker() as session:
                rows = (
                    await session.execute(
                        text(
                            "SELECT seq, type, payload FROM engine_run_events "
                            "WHERE run_id = :rid AND seq > :seq ORDER BY seq LIMIT 100"
                        ),
                        {"rid": run_id, "seq": last_seq},
                    )
                ).all()
                for seq, etype, payload in rows:
                    last_seq = int(seq)
                    print(f"[{last_seq}] {etype}: {payload}")
                run_row = await session.get(AgentRun, run_id)
                if run_row is not None and run_row.status in ("succeeded", "failed", "cancelled"):
                    print(f"Run {run_id} finished with status={run_row.status}")
                    return 0 if run_row.status == "succeeded" else 1
            await asyncio.sleep(0.5)


async def _cmd_inspect(args: argparse.Namespace) -> int:
    target_id = int(args.target)
    kind = args.type
    async with async_readonly_session_maker() as session:
        if kind == "auto":
            proj = await session.get(Project, target_id)
            kind = "project" if proj is not None else "run"

        out: dict[str, Any] = {}
        if kind == "project":
            proj = await session.get(Project, target_id)
            if proj is None:
                print(f"Project {target_id} not found", file=sys.stderr)
                return 1
            chars = (
                await session.execute(select(Character).where(Character.project_id == target_id))
            ).scalars().all()
            runs = (
                await session.execute(
                    select(AgentRun)
                    .where(AgentRun.project_id == target_id)
                    .order_by(AgentRun.id.desc())
                    .limit(5)
                )
            ).scalars().all()
            out["project"] = {
                "id": proj.id,
                "revision": proj.revision,
                "title": proj.title,
                "status": proj.status,
                "style": proj.style,
                "character_count": len(chars),
            }
            out["recent_runs"] = [
                {
                    "id": r.id,
                    "revision": r.revision,
                    "status": r.status,
                    "current_agent": r.current_agent,
                    "progress": r.progress,
                }
                for r in runs
            ]
            if args.shots:
                shots = (
                    await session.execute(
                        select(Shot).where(Shot.project_id == target_id).order_by(Shot.order.asc())
                    )
                ).scalars().all()
                out["shots"] = [
                    {
                        "id": s.id,
                        "order": s.order,
                        "revision": s.revision,
                        "review_status": s.review_status,
                        "description": s.description,
                        "image_url": s.image_url,
                        "video_url": s.video_url,
                    }
                    for s in shots
                ]
            if args.events:
                evt_rows = (
                    await session.execute(
                        text(
                            "SELECT seq, run_id, type, payload, created_at FROM engine_run_events "
                            "WHERE project_id = :pid ORDER BY seq DESC LIMIT 50"
                        ),
                        {"pid": target_id},
                    )
                ).all()
                out["events"] = [
                    {"seq": seq, "run_id": rid, "type": etype, "payload": payload, "created_at": ts}
                    for seq, rid, etype, payload, ts in reversed(evt_rows)
                ]
        else:
            run = await session.get(AgentRun, target_id)
            if run is None:
                print(f"Run {target_id} not found", file=sys.stderr)
                return 1
            out["run"] = {
                "id": run.id,
                "revision": run.revision,
                "project_id": run.project_id,
                "status": run.status,
                "current_agent": run.current_agent,
                "progress": run.progress,
                "error": run.error,
            }
            cp_rows = (
                await session.execute(
                    text("SELECT stage, updated_at FROM engine_checkpoints WHERE run_id = :rid"),
                    {"rid": target_id},
                )
            ).all()
            out["checkpoints"] = [{"stage": st, "updated_at": ts} for st, ts in cp_rows]
            if args.events:
                evt_rows = (
                    await session.execute(
                        text(
                            "SELECT seq, type, payload, created_at FROM engine_run_events "
                            "WHERE run_id = :rid ORDER BY seq DESC LIMIT 50"
                        ),
                        {"rid": target_id},
                    )
                ).all()
                out["events"] = [
                    {"seq": seq, "type": etype, "payload": payload, "created_at": ts}
                    for seq, etype, payload, ts in reversed(evt_rows)
                ]

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


def _cmd_mcp_serve(args: argparse.Namespace) -> int:
    from app.mcp.server import run_mcp_http, run_mcp_stdio

    if args.transport == "http":
        run_mcp_http(host=args.host, port=int(args.port))
    else:
        run_mcp_stdio()
    return 0


def _stream_prefixed(pipe: Any, label: str, color_code: str) -> None:
    if pipe is None:
        return
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            sys.stdout.write(f"\033[{color_code}m[{label}]\033[0m {line}")
            sys.stdout.flush()
    finally:
        pipe.close()


def _cmd_dev(args: argparse.Namespace) -> int:
    """Launch backend, engine sidecar, and Vite frontend under one process supervisor."""
    settings = get_settings()
    from app.services.engine_client import engine_db_path
    from app.services.file_cleaner import STATIC_DIR

    db_path = engine_db_path(settings.database_url) or str((_BACKEND_DIR / "data" / "komaslate.db").resolve())
    backend_port = str(args.port)
    engine_port = str(args.engine_port)
    frontend_port = str(args.frontend_port)

    env_base = os.environ.copy()
    env_base["PORT"] = backend_port
    env_base["ENGINE_DB_PATH"] = db_path
    env_base["ENGINE_STATIC_DIR"] = str(STATIC_DIR)
    env_base["ENGINE_PORT"] = engine_port
    env_base["KOMASLATE_BACKEND_URL"] = f"http://127.0.0.1:{backend_port}"

    specs: list[tuple[str, str, list[str], Path]] = [
        (
            "backend",
            "34",
            [sys.executable, "-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", backend_port],
            _BACKEND_DIR,
        ),
    ]
    pnpm = shutil.which("pnpm")
    if pnpm:
        if (_REPO_ROOT / "engine").is_dir():
            specs.append(("engine", "36", [pnpm, "dev"], _REPO_ROOT / "engine"))
        if (_REPO_ROOT / "frontend").is_dir():
            specs.append(
                ("frontend", "35", [pnpm, "dev", "--", "--port", frontend_port], _REPO_ROOT / "frontend")
            )

    procs: list[subprocess.Popen[str]] = []
    threads: list[threading.Thread] = []

    def _shutdown(*_a: Any) -> None:
        for proc in procs:
            if proc.poll() is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except OSError:
                    proc.terminate()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        for label, color, cmd, cwd in specs:
            proc = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                env=env_base,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            procs.append(proc)
            t = threading.Thread(target=_stream_prefixed, args=(proc.stdout, label, color), daemon=True)
            t.start()
            threads.append(t)

        while all(p.poll() is None for p in procs):
            signal.pause() if hasattr(signal, "pause") else threading.Event().wait(0.5)
    except KeyboardInterrupt:
        _shutdown()
    finally:
        _shutdown()
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except OSError:
                    proc.kill()
    return 0


async def _cmd_media(args: argparse.Namespace) -> int:
    from app.services import engine_media_cli

    if args.media_cmd == "mcp":
        engine_media_cli.main()
        return 0
    if args.media_cmd == "face-embedding":
        res = await engine_media_cli.handle({"action": "face_embedding", "path": args.path})
        print(json.dumps(res))
        return 0
    if args.media_cmd == "character-reference":
        res = await engine_media_cli.handle(
            {
                "action": "character_reference",
                "urls": args.urls,
                "output_path": args.output,
                "return_path": bool(args.output is None),
            }
        )
        print(json.dumps(res))
        return 0
    if args.media_cmd == "nine-grid":
        res = await engine_media_cli.handle(
            {
                "action": "nine_grid_reference",
                "current": args.current,
                "previous": args.previous,
                "next": args.next,
                "characters": args.characters or [],
                "output_path": args.output,
                "return_path": bool(args.output is None),
            }
        )
        print(json.dumps(res))
        return 0
    if args.media_cmd == "process-audio":
        res = await engine_media_cli.handle(
            {
                "action": "process_audio",
                "video_url": args.video_url,
                "dialogue": args.dialogue,
                "scene": args.scene,
            }
        )
        print(json.dumps(res))
        return 0
    return 1


async def _cmd_prune_events(args: argparse.Namespace) -> int:
    from app.services.event_outbox import prune_terminal_events

    async with async_session_maker() as session:
        deleted = await prune_terminal_events(session, days=int(args.days))
        await session.commit()
        try:
            await session.execute(text("PRAGMA wal_checkpoint(PASSIVE)"))
        except Exception:
            pass
    print(f"Pruned {deleted} terminal event(s) older than {args.days} day(s).")
    return 0


async def _cmd_gate(args: argparse.Namespace) -> int:
    from app.services.human_auth import consume_human_auth_token, issue_human_auth_token
    from app.services.run_signals import GateFeedbackRejected, approve_gate, submit_gate_feedback

    run_id = int(args.run_id)
    async with async_readonly_session_maker() as session:
        run = await session.get(AgentRun, run_id)
        if run is None:
            print(f"Run {run_id} not found", file=sys.stderr)
            return 1
        project_id = run.project_id

    if args.gate_action == "feedback":
        text_val = (args.feedback or "").strip()
        if not text_val:
            print("--feedback text is required for feedback action", file=sys.stderr)
            return 1
        try:
            fb = await submit_gate_feedback(run_id, project_id=project_id, content=text_val)
            print(json.dumps({"run_id": run_id, "feedback_id": fb["id"], "round": fb.get("round")}))
            return 0
        except GateFeedbackRejected as exc:
            print(f"Gate feedback rejected ({exc.code}): {exc}", file=sys.stderr)
            return 1

    # Human-only interactive TTY approval
    if not sys.stdin.isatty():
        print(
            "Refused: 'komaslate gate <run_id> approve' requires an interactive human TTY.",
            file=sys.stderr,
        )
        return 2
    answer = input(f"Type 'APPROVE' to confirm gate approval for run {run_id}: ").strip()
    if answer != "APPROVE":
        print("Approval aborted.", file=sys.stderr)
        return 1

    async with async_session_maker() as session:
        token, _ = await issue_human_auth_token(session, run_id=run_id)
        ok = await consume_human_auth_token(session, run_id=run_id, token=token)
        if not ok:
            print("Human authorization token failed.", file=sys.stderr)
            return 1
    try:
        await approve_gate(run_id, project_id=project_id)
    except GateFeedbackRejected as exc:
        print(f"Gate approval rejected ({exc.code}): {exc}", file=sys.stderr)
        return 1
    print(f"Gate approved for run {run_id}.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="komaslate", description="KomaSlate unified CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run workflow pipeline headlessly")
    p_run.add_argument("project_id", type=int)
    p_run.add_argument("--stage", default="full")
    p_run.add_argument("--auto", action="store_true")
    p_run.add_argument("--watch", action="store_true")
    p_run.add_argument("--gateway", default="http://127.0.0.1:18765")

    p_inspect = sub.add_parser("inspect", help="Inspect project or run state")
    p_inspect.add_argument("target", type=int)
    p_inspect.add_argument("--type", choices=["auto", "project", "run"], default="auto")
    p_inspect.add_argument("--shots", action="store_true")
    p_inspect.add_argument("--events", action="store_true")
    p_inspect.add_argument("--json", action="store_true")

    p_mcp = sub.add_parser("mcp", help="MCP server commands")
    mcp_sub = p_mcp.add_subparsers(dest="mcp_cmd", required=True)
    p_mcp_serve = mcp_sub.add_parser("serve", help="Start inbound MCP server")
    p_mcp_serve.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    p_mcp_serve.add_argument("--host", default="127.0.0.1")
    p_mcp_serve.add_argument("--port", type=int, default=18768)

    p_dev = sub.add_parser("dev", help="Start backend, engine, and frontend dev servers")
    p_dev.add_argument("--port", type=int, default=18765)
    p_dev.add_argument("--engine-port", type=int, default=18766)
    p_dev.add_argument("--frontend-port", type=int, default=5173)

    p_media = sub.add_parser("media", help="Media helper tools")
    media_sub = p_media.add_subparsers(dest="media_cmd", required=True)
    p_m_face = media_sub.add_parser("face-embedding")
    p_m_face.add_argument("path")
    p_m_char = media_sub.add_parser("character-reference")
    p_m_char.add_argument("urls", nargs="+")
    p_m_char.add_argument("--output", default=None)
    p_m_grid = media_sub.add_parser("nine-grid")
    p_m_grid.add_argument("--current", required=True)
    p_m_grid.add_argument("--previous", default=None)
    p_m_grid.add_argument("--next", default=None)
    p_m_grid.add_argument("--characters", nargs="*", default=None)
    p_m_grid.add_argument("--output", default=None)
    p_m_audio = media_sub.add_parser("process-audio")
    p_m_audio.add_argument("--video-url", required=True)
    p_m_audio.add_argument("--dialogue", default=None)
    p_m_audio.add_argument("--scene", default=None)
    media_sub.add_parser("mcp", help="Start stdio JSON-lines media worker")

    p_prune = sub.add_parser("prune-events", help="Prune terminal outbox events")
    p_prune.add_argument("--days", type=int, default=14)

    p_gate = sub.add_parser("gate", help="Human-only gate confirmation or feedback")
    p_gate.add_argument("run_id", type=int)
    p_gate.add_argument("gate_action", choices=["approve", "feedback"])
    p_gate.add_argument("--feedback", default="")

    return parser


def cli(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "run":
        return asyncio.run(_cmd_run(args))
    if args.command == "inspect":
        return asyncio.run(_cmd_inspect(args))
    if args.command == "mcp" and args.mcp_cmd == "serve":
        return _cmd_mcp_serve(args)
    if args.command == "dev":
        return _cmd_dev(args)
    if args.command == "media":
        return asyncio.run(_cmd_media(args))
    if args.command == "prune-events":
        return asyncio.run(_cmd_prune_events(args))
    if args.command == "gate":
        return asyncio.run(_cmd_gate(args))
    return 1


if __name__ == "__main__":
    raise SystemExit(cli())
