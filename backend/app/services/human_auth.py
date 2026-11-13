"""Single-use, short-lived (60s) human authorization tokens for gate approvals.

Satisfies AGENTS.md Invariant 3: autonomous agents and external MCP clients
cannot self-approve workflow gates. Only a physical human action (Web UI click
or interactive TTY CLI confirmation) may mint a token, which is consumed once
and bound to a specific ``run_id``.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.utils import utcnow
from app.models.export_cache import ExportCache

HUMAN_AUTH_TTL_SECONDS = 60
_KEY_PREFIX = "human_auth:"


def _token_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{_KEY_PREFIX}{digest}"


async def issue_human_auth_token(
    session: AsyncSession,
    *,
    run_id: int,
    ttl_seconds: int = HUMAN_AUTH_TTL_SECONDS,
) -> tuple[str, str]:
    """Mint and persist a 60s single-use token bound to ``run_id``.

    Returns ``(raw_token, expires_at_iso)``.
    """
    raw_token = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(seconds=max(1, min(ttl_seconds, HUMAN_AUTH_TTL_SECONDS)))
    payload = json.dumps({"run_id": int(run_id)})

    await session.merge(
        ExportCache(
            export_id=_token_key(raw_token),
            payload=payload,
            expires_at=expires_at,
        )
    )
    await session.commit()
    return raw_token, expires_at.isoformat()


async def consume_human_auth_token(
    session: AsyncSession,
    *,
    run_id: int,
    token: str | None,
) -> bool:
    """Atomically verify and consume a single-use human auth token.

    Returns True iff the token exists, is unexpired, matches ``run_id``,
    and was not already consumed.
    """
    if not token or not isinstance(token, str) or len(token.strip()) < 16:
        return False

    key = _token_key(token.strip())
    now = utcnow()
    row = await session.get(ExportCache, key)
    if row is None:
        return False

    try:
        meta = json.loads(row.payload)
    except (TypeError, ValueError):
        meta = {}

    if not isinstance(meta, dict) or meta.get("run_id") != int(run_id):
        return False

    # Atomic single-use deletion guarded by expiry check
    result = await session.execute(
        delete(ExportCache)
        .where(ExportCache.export_id == key)  # type: ignore[arg-type]
        .where(ExportCache.expires_at > now)  # type: ignore[operator]
    )
    await session.commit()
    return int(getattr(result, "rowcount", 0) or 0) == 1


async def purge_expired_human_tokens(session: AsyncSession) -> int:
    res = await session.execute(
        text("DELETE FROM exportcache WHERE export_id LIKE 'human_auth:%' AND expires_at <= :now"),
        {"now": utcnow().isoformat()},
    )
    return int(getattr(res, "rowcount", 0) or 0)
