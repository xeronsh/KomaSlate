"""Transactional Outbox for durable project/run events and 14-day compaction."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = ("completed", "succeeded", "failed", "cancelled")

_CREATE_OUTBOX_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS engine_run_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)
"""


async def _ensure_outbox_table(session: AsyncSession) -> None:
    bind = session.get_bind()
    if bind is None or bind.dialect.name != "sqlite":
        return
    exists = await session.execute(
        text(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engine_run_events'"
        )
    )
    if exists.first() is None:
        await session.execute(text(_CREATE_OUTBOX_TABLE_SQL))


async def emit_project_event(
    session: AsyncSession,
    *,
    project_id: int,
    event_type: str,
    payload: dict[str, Any],
    run_id: int = 0,
) -> None:
    """Persist a domain event into ``engine_run_events`` in the caller's transaction."""
    await _ensure_outbox_table(session)
    stmt = text(
        "INSERT INTO engine_run_events (run_id, project_id, type, payload) "
        "VALUES (:run_id, :project_id, :type, :payload)"
    )
    await session.execute(
        stmt,
        {
            "run_id": int(run_id),
            "project_id": int(project_id),
            "type": event_type,
            "payload": json.dumps(payload, ensure_ascii=False, default=str),
        },
    )


async def prune_terminal_events(
    session: AsyncSession,
    *,
    days: int = 14,
    min_active_cursor: int | None = None,
) -> int:
    """Delete terminal-run outbox events older than ``days`` days safely."""
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        exists = await session.execute(
            text(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engine_run_events'"
            )
        )
        if exists.first() is None:
            return 0

    days_clamped = max(1, int(days))
    params: dict[str, Any] = {"age": f"-{days_clamped} days"}
    cursor_clause = ""
    if min_active_cursor is not None and min_active_cursor > 0:
        cursor_clause = " AND seq < :min_cursor"
        params["min_cursor"] = int(min_active_cursor)

    stmt = text(
        "DELETE FROM engine_run_events "
        "WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', :age) "
        "AND run_id IN ("
        "  SELECT id FROM agentrun WHERE status IN ('completed', 'succeeded', 'failed', 'cancelled')"
        ")"
        f"{cursor_clause}"
    )
    result = await session.execute(stmt, params)
    return int(getattr(result, "rowcount", 0) or 0)
