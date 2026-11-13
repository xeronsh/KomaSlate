from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.db import session as session_module


def test_build_engine_uses_current_settings(monkeypatch):
    fake_settings = SimpleNamespace(database_url="sqlite+aiosqlite:///:memory:", db_echo=True)
    monkeypatch.setattr(session_module, "get_settings", lambda: fake_settings)

    engine = session_module._build_engine()

    assert str(engine.url) == "sqlite+aiosqlite:///:memory:"


@pytest.mark.asyncio
async def test_init_db_runs_schema_check_and_config(monkeypatch):
    calls = {
        "alembic_upgrade": False,
        "ensure_initialized": False,
        "ensure_provider_configs": False,
        "apply_overrides": False,
    }

    class FakeConfigService:
        def __init__(self, session):
            self.session = session

        async def ensure_initialized(self):
            calls["ensure_initialized"] = True

        async def ensure_provider_configs_initialized(self):
            calls["ensure_provider_configs"] = True

        async def apply_settings_overrides(self):
            calls["apply_overrides"] = True

    class FakeResult:
        def scalar_one_or_none(self):
            return None  # No existing templates

    class FakeSessionCtx:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, *args, **kwargs):
            return FakeResult()

        async def commit(self):
            return None

        def add(self, obj):
            pass

    monkeypatch.setattr(session_module, "async_session_maker", lambda: FakeSessionCtx())
    monkeypatch.setattr(session_module, "get_settings", lambda: SimpleNamespace(database_url="sqlite+aiosqlite:///:memory:"))
    monkeypatch.setattr("app.services.config_service.ConfigService", FakeConfigService)
    def fake_alembic_upgrade():
        calls["alembic_upgrade"] = True
    monkeypatch.setattr(session_module, "_run_alembic_upgrade", fake_alembic_upgrade)
    await session_module.init_db()

    assert calls == {
        "alembic_upgrade": True,
        "ensure_initialized": False,
        "ensure_provider_configs": False,
        "apply_overrides": True,
    }


@pytest.mark.asyncio
async def test_sqlite_wal_begin_immediate_concurrent_reads_and_writes(tmp_path, monkeypatch):
    """BE-02: 50 concurrent read/write tasks complete with 0 database-is-locked errors."""
    import asyncio
    from sqlalchemy import text
    from app.models.project import Project

    db_file = tmp_path / "concurrent.db"
    fake_settings = SimpleNamespace(database_url=f"sqlite+aiosqlite:///{db_file}", db_echo=False)
    monkeypatch.setattr(session_module, "get_settings", lambda: fake_settings)

    eng = session_module._build_engine()
    from sqlmodel import SQLModel
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

    async with eng.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    rw_maker = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    ro_maker = async_sessionmaker(eng.execution_options(readonly=True), class_=AsyncSession, expire_on_commit=False)

    async def worker(idx: int) -> None:
        if idx % 2 == 0:
            async with rw_maker() as s:
                s.add(Project(title=f"P{idx}", story="s", style="anime"))
                await s.commit()
        else:
            async with ro_maker() as s:
                await s.execute(text("SELECT COUNT(*) FROM project"))

    await asyncio.gather(*(worker(i) for i in range(50)))
    async with ro_maker() as s:
        total = (await s.execute(text("SELECT COUNT(*) FROM project"))).scalar()
    assert total == 25
    await eng.dispose()


@pytest.mark.asyncio
async def test_get_session_yields_async_session():
    async for session in session_module.get_session():
        assert session is not None
        break
