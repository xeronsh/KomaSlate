"""Run lifecycle: stop / cancel / regenerate-as-a-new-version / restore."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from sqlmodel import select

from app.api.v1.routes import runs as generation_routes
from app.db.utils import utcnow
from app.models.agent_run import AgentRun
from app.models.message import Message
from app.models.project import Character, Project, Shot
from app.schemas.project import ProjectProviderEntry
from app.services import engine_client, provider_resolution
from app.services.text_capabilities import TextProviderCapability
from tests.factories import create_character, create_project, create_run, create_shot, read_outbox_events


def _resolution() -> generation_routes.ProviderResolution:
    entry = lambda key: ProjectProviderEntry(  # noqa: E731
        selected_key=key, source="default", resolved_key=key, valid=True, reason_code=None, reason_message=None
    )
    return generation_routes.ProviderResolution(
        valid=True, text=entry("anthropic"), image=entry("openai"), video=entry("openai")
    )


@pytest.fixture()
def valid_providers(monkeypatch):
    async def _resolve(project, settings):
        return _resolution()

    monkeypatch.setattr(generation_routes, "resolve_project_provider_settings_async", _resolve)


class _Ids:
    def __init__(self, id: int) -> None:
        self.id = id


async def _finished_project(session):
    """Returns plain id holders so tests can expire the session freely."""
    project_row, character_row, shot_row = await _finished_rows(session)
    return _Ids(project_row.id), _Ids(character_row.id), _Ids(shot_row.id)


async def _finished_rows(session):
    project = await create_project(session, status="ready")
    project.video_url = "/static/managed-v1/old-cut.mp4"
    project.summary = "旧摘要"
    project.story_outline = {"title": "旧大纲"}
    session.add(project)
    await session.commit()
    await session.refresh(project)
    character = await create_character(session, project.id, name="橘猫", image_url="/static/managed-v1/cat.png")
    shot = await create_shot(session, project.id, order=1, description="站台", video_url="/static/managed-v1/s1.mp4")
    return project, character, shot


async def _simulate_regenerate_progress(session, project_id: int) -> None:
    """What the engine does early in a full rerun: new cast, new shots, no cut."""
    for row in (await session.execute(select(Shot).where(Shot.project_id == project_id))).scalars().all():
        await session.delete(row)
    for row in (await session.execute(select(Character).where(Character.project_id == project_id))).scalars().all():
        await session.delete(row)
    project = await session.get(Project, project_id)
    project.video_url = None
    project.status = "superseded"
    project.summary = "新摘要"
    session.add(project)
    await session.commit()
    await create_character(session, project_id, name="黑猫")


# --- 取消 / 停止 semantics -------------------------------------------------


@pytest.mark.asyncio
async def test_stopped_run_is_not_offered_as_recoverable(async_client, test_session):
    """Project #20: a run the user stopped must not keep the project in 可恢复."""
    project, _, _ = await _finished_project(test_session)
    run = await create_run(test_session, project.id, status="cancelled", live_lease=False)
    run.cancel_requested_at = utcnow()
    test_session.add(run)
    await test_session.commit()

    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert res.status_code == 200
    assert res.json() is None
    project_res = await async_client.get(f"/api/v1/projects/{project.id}")
    assert project_res.json()["status"] == "ready"
    assert project_res.json()["video_url"] == "/static/managed-v1/old-cut.mp4"


@pytest.mark.asyncio
async def test_old_failure_does_not_resurface_after_later_run(async_client, test_session):
    project = await create_project(test_session)
    failed = await create_run(test_session, project.id, status="failed", live_lease=False)
    failed.created_at = utcnow() - timedelta(minutes=10)
    test_session.add(failed)
    await test_session.commit()
    await create_run(test_session, project.id, status="succeeded", live_lease=False)

    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert res.json() is None


@pytest.mark.asyncio
async def test_failed_run_is_still_recoverable(async_client, test_session):
    project = await create_project(test_session)
    run = await create_run(test_session, project.id, status="failed", live_lease=False)
    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert res.json()["state"] == "recoverable"
    assert res.json()["active_run"]["id"] == run.id


@pytest.mark.asyncio
async def test_cancel_on_interrupted_run_dismisses_it(async_client, test_session):
    project = await create_project(test_session)
    run = await create_run(test_session, project.id, status="failed", live_lease=False)

    res = await async_client.post(f"/api/v1/runs/{run.id}/cancel")
    assert res.status_code == 200
    assert res.json() == {"status": "cancelled", "cancelled": 1, "run_ids": [run.id]}
    await test_session.refresh(run)
    assert run.status == "cancelled"
    assert run.cancel_requested_at is not None
    assert await read_outbox_events(test_session, "run_cancelled")

    current = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert current.json() is None
    # A second cancel is a no-op, not an error.
    again = await async_client.post(f"/api/v1/runs/{run.id}/cancel")
    assert again.json()["status"] == "no_active_run"


# --- regenerate as a new version ---------------------------------------------


@pytest.mark.asyncio
async def test_regenerate_keeps_previous_version_and_stop_restores_it(
    async_client, test_session, valid_providers
):
    project, character, shot = await _finished_project(test_session)

    res = await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})
    assert res.status_code == 201
    run = await test_session.get(AgentRun, res.json()["id"])
    previous = run.context_snapshot["previous_version"]
    assert previous["project"]["video_url"] == "/static/managed-v1/old-cut.mp4"
    assert [c["id"] for c in previous["characters"]] == [character.id]
    assert [s["id"] for s in previous["shots"]] == [shot.id]

    await _simulate_regenerate_progress(test_session, project.id)

    # The dispatched run never got a lease in tests: cancel terminalises now.
    stop = await async_client.post(f"/api/v1/runs/{run.id}/cancel")
    assert stop.json()["status"] == "cancelled"

    test_session.expire_all()
    restored = await test_session.get(Project, project.id)
    assert restored.video_url == "/static/managed-v1/old-cut.mp4"
    assert restored.status == "ready"
    assert restored.summary == "旧摘要"
    chars = (await test_session.execute(select(Character).where(Character.project_id == project.id))).scalars().all()
    shots = (await test_session.execute(select(Shot).where(Shot.project_id == project.id))).scalars().all()
    assert [(c.id, c.name) for c in chars] == [(character.id, "橘猫")]
    assert [(s.id, s.description) for s in shots] == [(shot.id, "站台")]
    assert await read_outbox_events(test_session, "project_restored")
    # 活动流里有一条落库的说明，刷新后还在
    notes = (
        await test_session.execute(
            select(Message.content).where(Message.project_id == project.id, Message.agent == "version")
        )
    ).scalars().all()
    assert notes == ["已停止，项目放回了重新生成之前的版本（成片、角色、分镜都还在）"]

    current = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert current.json() is None


@pytest.mark.asyncio
async def test_engine_side_stop_restores_on_next_read(async_client, test_session, valid_providers):
    project, character, _ = await _finished_project(test_session)
    res = await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})
    run = await test_session.get(AgentRun, res.json()["id"])
    await _simulate_regenerate_progress(test_session, project.id)
    # The engine observed the cancel flag and terminalised the run itself.
    run.status = "cancelled"
    run.cancel_requested_at = utcnow()
    test_session.add(run)
    await test_session.commit()

    current = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert current.json() is None
    # P2-3: GET /runs/current is strictly read-only; explicit reconcile settles stopped runs.
    reconciled = await async_client.post(f"/api/v1/projects/{project.id}/runs/reconcile")
    assert reconciled.status_code == 200
    assert reconciled.json() is None
    test_session.expire_all()
    assert (await test_session.get(Project, project.id)).video_url == "/static/managed-v1/old-cut.mp4"
    await test_session.refresh(run)
    assert run.context_snapshot["previous_version"]["restored_by"] == "stopped"

    # Applied once: later edits are not overwritten by a second read.
    edited = await test_session.get(Character, character.id)
    edited.name = "改名的橘猫"
    test_session.add(edited)
    await test_session.commit()
    await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    test_session.expire_all()
    assert (await test_session.get(Character, character.id)).name == "改名的橘猫"


@pytest.mark.asyncio
async def test_restore_previous_after_success(async_client, test_session, valid_providers):
    project, character, _ = await _finished_project(test_session)
    res = await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})
    run_id = res.json()["id"]

    # Still active (queued): restore must refuse and say to stop instead.
    early = await async_client.post(f"/api/v1/runs/{run_id}/restore-previous")
    assert early.status_code == 409
    assert early.json()["error"]["code"] == "RUN_STILL_ACTIVE"

    await _simulate_regenerate_progress(test_session, project.id)
    run = await test_session.get(AgentRun, run_id)
    run.status = "succeeded"
    test_session.add(run)
    project_row = await test_session.get(Project, project.id)
    project_row.video_url = "/static/managed-v1/new-cut.mp4"
    project_row.status = "ready"
    test_session.add(project_row)
    await test_session.commit()

    plan = await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan")
    assert plan.status_code == 200
    previous = plan.json()["previous_version"]
    assert previous["run_id"] == run_id
    assert previous["restorable"] is True
    assert previous["video_url"] == "/static/managed-v1/old-cut.mp4"

    restored = await async_client.post(f"/api/v1/runs/{run_id}/restore-previous")
    assert restored.status_code == 200
    assert restored.json() == {"run_id": run_id, "restored": True}
    test_session.expire_all()
    assert (await test_session.get(Project, project.id)).video_url == "/static/managed-v1/old-cut.mp4"
    names = [c.name for c in (await test_session.execute(select(Character).where(Character.project_id == project.id))).scalars()]
    assert names == ["橘猫"]

    plan_after = await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan")
    assert plan_after.json()["previous_version"]["restorable"] is False


@pytest.mark.asyncio
async def test_restore_refuses_a_stale_capture(async_client, test_session, valid_providers):
    project, _, _ = await _finished_project(test_session)
    first = (await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})).json()["id"]
    run = await test_session.get(AgentRun, first)
    run.status = "succeeded"
    run.created_at = utcnow() - timedelta(minutes=5)
    test_session.add(run)
    await test_session.commit()
    second = (await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})).json()["id"]
    run2 = await test_session.get(AgentRun, second)
    run2.status = "succeeded"
    test_session.add(run2)
    await test_session.commit()

    res = await async_client.post(f"/api/v1/runs/{first}/restore-previous")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "PREVIOUS_VERSION_STALE"


@pytest.mark.asyncio
async def test_regenerate_plan_reads_engine_written_timestamps(async_client, test_session, valid_providers):
    """The engine stamps agentrun.updated_at as ISO-8601 with a trailing Z (tz-aware)
    while the backend writes created_at naive UTC. Subtracting the two used to 500
    the plan, which also hid 恢复上一版 after a finished regenerate."""
    from sqlalchemy import text

    project, _, _ = await _finished_project(test_session)
    run_id = (await async_client.post(f"/api/v1/projects/{project.id}/runs", json={"auto_mode": True})).json()["id"]
    run = await test_session.get(AgentRun, run_id)
    run.status = "succeeded"
    run.created_at = utcnow() - timedelta(minutes=20)
    test_session.add(run)
    await test_session.commit()
    finished = (utcnow() - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    await test_session.execute(text("UPDATE agentrun SET updated_at = :t WHERE id = :id"), {"t": finished, "id": run_id})
    await test_session.commit()
    test_session.expire_all()

    plan = await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan")
    assert plan.status_code == 200, plan.text
    body = plan.json()
    assert body["previous_version"]["restorable"] is True
    assert body["estimate"]["basis"] == "history"


@pytest.mark.asyncio
async def test_regenerate_plan_for_empty_project(async_client, test_session):
    project = await create_project(test_session)
    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan")
    assert res.status_code == 200
    body = res.json()
    assert body["has_content"] is False
    assert body["previous_version"] is None
    assert body["estimate"]["image_calls"] == 6  # 2 characters + 4 shots by default
    assert body["estimate"]["seconds_low"] < body["estimate"]["seconds_high"]
    assert body["stages"][0] == "故事大纲"


@pytest.mark.asyncio
async def test_new_project_start_captures_nothing(async_client, test_session, valid_providers):
    project = await create_project(test_session)
    res = await async_client.post(f"/api/v1/projects/{project.id}/runs", json={})
    run = await test_session.get(AgentRun, res.json()["id"])
    assert "previous_version" not in run.context_snapshot


# --- 运行中断 card stage ------------------------------------------------------


@pytest.mark.asyncio
async def test_run_interrupted_at_gate_reports_the_gate_stage(async_client, test_session):
    project = await create_project(test_session)
    run = await create_run(test_session, project.id, status="failed", live_lease=False)
    run.error = "Execution lease expired; run is safe to resume"
    run.awaiting_payload = {"current_stage": "shots_approval", "stage": "shots_approval", "next_stage": "render_characters"}
    test_session.add(run)
    await test_session.commit()

    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    summary = res.json()["recovery_summary"]
    assert summary["current_stage"] == "shots_approval"


# --- engine death at a gate ---------------------------------------------------


@pytest.mark.asyncio
async def test_engine_restart_releases_gate_run_before_lease_expiry(async_client, test_session, monkeypatch):
    project = await create_project(test_session)
    run = await create_run(test_session, project.id, status="waiting_for_approval", live_lease=True)
    run.lease_owner = "engine-999999-123e4567-e89b-12d3-a456-426614174000"
    test_session.add(run)
    await test_session.commit()

    async def _health(_url):
        return {"status": "ok", "owner_id": "engine-1-123e4567-e89b-12d3-a456-426614174999"}

    monkeypatch.setattr(engine_client, "engine_health", _health)
    monkeypatch.setattr(engine_client, "_pid_alive", lambda pid: False)

    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    body = res.json()
    assert body["state"] == "recoverable"
    assert body["active_run"]["status"] == "failed"
    assert body["active_run"]["error"] == generation_routes.EXECUTOR_GONE_ERROR


@pytest.mark.asyncio
async def test_engine_owner_gone_is_conservative(monkeypatch):
    owner = "engine-4242-123e4567-e89b-12d3-a456-426614174000"

    async def _same(_url):
        return {"owner_id": owner}

    async def _other(_url):
        return {"owner_id": "engine-1-123e4567-e89b-12d3-a456-426614174999"}

    async def _down(_url):
        return None

    monkeypatch.setattr(engine_client, "_pid_alive", lambda pid: False)
    monkeypatch.setattr(engine_client, "engine_health", _same)
    assert await engine_client.engine_owner_gone("http://e", owner) is False
    monkeypatch.setattr(engine_client, "engine_health", _down)
    assert await engine_client.engine_owner_gone("http://e", owner) is False
    monkeypatch.setattr(engine_client, "engine_health", _other)
    assert await engine_client.engine_owner_gone("http://e", "test-engine") is False
    assert await engine_client.engine_owner_gone("http://e", owner) is True
    monkeypatch.setattr(engine_client, "_pid_alive", lambda pid: True)
    assert await engine_client.engine_owner_gone("http://e", owner) is False


# --- start latency --------------------------------------------------------------


@pytest.mark.asyncio
async def test_cold_provider_probe_does_not_block_start(monkeypatch, test_settings):
    calls = 0

    async def _slow_probe(settings):
        nonlocal calls
        calls += 1
        await asyncio.sleep(5)
        return TextProviderCapability(status="valid", generate=True, stream=True)

    monkeypatch.setattr(provider_resolution, "probe_text_provider", _slow_probe)
    monkeypatch.setattr(provider_resolution, "get_cached_text_provider_probe", lambda settings: None)
    monkeypatch.setattr(provider_resolution, "TEXT_PROBE_START_BUDGET_S", 0.05)
    project = Project(title="p", story="s")

    loop = asyncio.get_running_loop()
    started = loop.time()
    resolution = await provider_resolution.resolve_project_provider_settings_async(project, test_settings)
    assert loop.time() - started < 1.0
    assert resolution.valid is True
    # A second start while the probe is still running reuses it.
    await provider_resolution.resolve_project_provider_settings_async(project, test_settings)
    assert calls == 1
    for task in list(provider_resolution._probe_tasks.values()):
        task.cancel()


@pytest.mark.asyncio
async def test_fast_probe_result_still_blocks_a_broken_provider(monkeypatch, test_settings):
    async def _broken(settings):
        return TextProviderCapability(
            status="invalid", generate=False, stream=False, reason_code="provider_generate_unavailable",
            reason_message="down",
        )

    monkeypatch.setattr(provider_resolution, "probe_text_provider", _broken)
    monkeypatch.setattr(provider_resolution, "get_cached_text_provider_probe", lambda settings: None)
    resolution = await provider_resolution.resolve_project_provider_settings_async(
        Project(title="p", story="s"), test_settings
    )
    assert resolution.valid is False


@pytest.mark.asyncio
async def test_regenerate_plan_warms_the_probe_only_when_asked(async_client, test_session, monkeypatch):
    warmed: list[int] = []
    monkeypatch.setattr(generation_routes, "warm_project_text_probe", lambda project, settings: warmed.append(project.id))
    project = await create_project(test_session)
    await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan")
    assert warmed == []
    await async_client.get(f"/api/v1/projects/{project.id}/runs/regenerate-plan?warm=true")
    assert warmed == [project.id]
