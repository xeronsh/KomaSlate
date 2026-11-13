"""Feedback at an approval gate means "request changes", never "approve"."""

from __future__ import annotations

import pytest
from sqlmodel import select

from app.models.agent_run import AgentRun
from app.models.message import Message
from tests.factories import create_project, create_run, read_outbox_events

GATE_PAYLOAD = {
    "run_id": 0,
    "agent": "outline",
    "gate": "outline",
    "current_stage": "outline_approval",
    "stage": "outline_approval",
    "next_stage": "plan_characters",
    "recovery_summary": {"current_stage": "outline_approval"},
    "message": "大纲已完成",
}


async def _gate_run(session, project_id: int) -> AgentRun:
    run = await create_run(session, project_id=project_id, status="waiting_for_approval")
    run.awaiting_payload = {**GATE_PAYLOAD, "run_id": run.id, "project_id": project_id}
    run.current_agent = "outline"
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


@pytest.fixture()
def _shared_maker(monkeypatch, shared_session_maker):
    monkeypatch.setattr("app.db.session.async_session_maker", shared_session_maker)
    monkeypatch.setattr("app.db.session.async_readonly_session_maker", shared_session_maker)


@pytest.mark.asyncio
async def test_runs_current_carries_the_pending_gate(async_client, test_session):
    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    res = await async_client.get(f"/api/v1/projects/{project.id}/runs/current")
    assert res.status_code == 200
    body = res.json()
    assert body["state"] == "active"
    assert body["active_run"]["status"] == "waiting_for_approval"
    # A reload rebuilds the approval card from this, not from a WS replay.
    assert body["awaiting_gate"]["current_stage"] == "outline_approval"
    assert body["awaiting_gate"]["run_id"] == run.id
    assert body["pending_gate_feedback"] is None


@pytest.mark.asyncio
async def test_gate_feedback_requests_changes_without_approving(
    async_client, test_session, ws_manager, _shared_maker
):
    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    res = await async_client.post(
        f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "  结局更温暖  "}
    )
    assert res.status_code == 202, res.text
    feedback_id = res.json()["feedback_id"]

    stored = (
        await test_session.execute(
            select(AgentRun).where(AgentRun.id == run.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored.confirm_requested is False
    assert stored.status == "waiting_for_approval"
    assert stored.gate_feedback["content"] == "结局更温暖"
    assert stored.gate_feedback["id"] == feedback_id

    messages = (await test_session.execute(select(Message).where(Message.run_id == run.id))).scalars().all()
    assert [m.content for m in messages if m.role == "user"] == ["结局更温暖"]
    assert [m.summary for m in messages if m.role == "feedback_receipt"] == [feedback_id]

    receipts = await read_outbox_events(test_session, "run_feedback")
    assert receipts and receipts[-1]["data"]["state"] == "received"
    assert receipts[-1]["data"]["stage"] == "outline_approval"

    current = (await async_client.get(f"/api/v1/projects/{project.id}/runs/current")).json()
    assert current["pending_gate_feedback"]["id"] == feedback_id

    # A second request while the first is unread is refused, not merged silently.
    again = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "再改"})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "GATE_FEEDBACK_PENDING"


@pytest.mark.asyncio
async def test_gate_feedback_refused_when_not_at_a_gate(async_client, test_session, _shared_maker):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id, status="running")

    res = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "改"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "RUN_NOT_AT_GATE"


@pytest.mark.asyncio
async def test_gate_feedback_validates_input(async_client, test_session, _shared_maker):
    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    blank = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "   "})
    assert blank.status_code == 422
    untyped = await async_client.post(
        f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "改", "entity_ids": [1]}
    )
    assert untyped.status_code == 422
    missing = await async_client.post("/api/v1/runs/987654/gate-feedback", json={"content": "改"})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_rest_confirm_approves_the_gate(async_client, test_session, _shared_maker):
    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    res = await async_client.post(f"/api/v1/runs/{run.id}/confirm")
    assert res.status_code == 202, res.text
    stored = (
        await test_session.execute(
            select(AgentRun).where(AgentRun.id == run.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored.confirm_requested is True


@pytest.mark.asyncio
async def test_rest_confirm_refused_while_changes_are_pending(
    async_client, test_session, ws_manager, _shared_maker
):
    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)
    res = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "换个结局"})
    assert res.status_code == 202

    res = await async_client.post(f"/api/v1/runs/{run.id}/confirm")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "GATE_FEEDBACK_PENDING"
    stored = (
        await test_session.execute(
            select(AgentRun).where(AgentRun.id == run.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored.confirm_requested is False


@pytest.mark.asyncio
async def test_rest_confirm_refused_when_not_at_a_gate(async_client, test_session, _shared_maker):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id, status="running")
    res = await async_client.post(f"/api/v1/runs/{run.id}/confirm")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "RUN_NOT_AT_GATE"


@pytest.mark.asyncio
async def test_feedback_receipt_is_persisted_and_rounds_count_from_the_db(
    async_client, test_session, ws_manager, _shared_maker
):
    """A reload must still show every earlier round; the counter is not in memory."""
    import json

    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    first = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "更悬疑一点"})
    assert first.status_code == 202
    # The engine finished that round and came back to the gate.
    await test_session.refresh(run)
    run.gate_feedback = None
    test_session.add(run)
    await test_session.commit()
    second = await async_client.post(f"/api/v1/runs/{run.id}/gate-feedback", json={"content": "结局反转"})
    assert second.status_code == 202

    rows = (
        await test_session.execute(
            select(Message).where(Message.run_id == run.id).where(Message.role == "feedback_receipt").order_by(Message.id)
        )
    ).scalars().all()
    receipts = [json.loads(row.content) for row in rows]
    assert [(r["round"], r["content"], r["state"], r["stage"]) for r in receipts] == [
        (1, "更悬疑一点", "received", "outline_approval"),
        (2, "结局反转", "received", "outline_approval"),
    ]
    assert rows[0].summary == first.json()["feedback_id"]
    rounds = [e["data"]["round"] for e in await read_outbox_events(test_session, "run_feedback")]
    assert rounds == [1, 2]
    await test_session.refresh(run)
    assert run.gate_feedback["round"] == 2

    # The receipt row is ordered after the user's words and before any redo output.
    listed = (await async_client.get(f"/api/v1/projects/{project.id}/messages")).json()
    roles = [m["role"] for m in listed]
    assert roles == ["user", "feedback_receipt", "user", "feedback_receipt"]


@pytest.mark.asyncio
async def test_mcp_gate_approval_requires_single_use_human_auth_token(
    async_client, test_session, shared_session_maker, _shared_maker
):
    from app.mcp.server import handle_jsonrpc_message

    project = await create_project(test_session)
    run = await _gate_run(test_session, project.id)

    tools_res = await handle_jsonrpc_message(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        session_maker=shared_session_maker,
        readonly_session_maker=shared_session_maker,
    )
    tool_names = [t["name"] for t in tools_res["result"]["tools"]]
    assert "approve_gate" not in tool_names
    assert "submit_gate_approval" in tool_names

    # Missing / bogus token is rejected
    bad_res = await handle_jsonrpc_message(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "submit_gate_approval",
                "arguments": {"run_id": run.id, "human_auth_token": "forged-token-00000000"},
            },
        },
        session_maker=shared_session_maker,
        readonly_session_maker=shared_session_maker,
    )
    assert bad_res["result"]["isError"] is True

    # Mint 60s single-use token via UI human-auth-token endpoint
    tok_res = await async_client.post(f"/api/v1/runs/{run.id}/human-auth-token")
    assert tok_res.status_code == 200
    token = tok_res.json()["human_auth_token"]

    ok_res = await handle_jsonrpc_message(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "submit_gate_approval",
                "arguments": {"run_id": run.id, "human_auth_token": token},
            },
        },
        session_maker=shared_session_maker,
        readonly_session_maker=shared_session_maker,
    )
    assert not ok_res["result"].get("isError")

    # Replay of the same token is rejected (single-use)
    replay_res = await handle_jsonrpc_message(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "submit_gate_approval",
                "arguments": {"run_id": run.id, "human_auth_token": token},
            },
        },
        session_maker=shared_session_maker,
        readonly_session_maker=shared_session_maker,
    )
    assert replay_res["result"]["isError"] is True
