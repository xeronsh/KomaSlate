"""Remediation: chat confirmation, run/asset revisions, and concurrency indices.

Revision ID: 0036_remediation_persistence_concurrency
Revises: 0035_retire_noop_config
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0036_remediation_persistence_concurrency"
down_revision = "0035_retire_noop_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()

    # 1. 创建 chat_confirmation 表
    if "chat_confirmation" not in tables:
        op.create_table(
            "chat_confirmation",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "project_id",
                sa.Integer(),
                sa.ForeignKey("project.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("tool_call_id", sa.String(length=128), nullable=False, unique=True),
            sa.Column("tool_name", sa.String(length=128), nullable=False),
            sa.Column("tool_label", sa.String(length=128), nullable=False),
            sa.Column("parameters_json", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column(
                "created_at",
                sa.String(),
                nullable=False,
                server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            ),
            sa.Column("resolved_at", sa.String(), nullable=True),
            sa.Column("resolved_by", sa.String(length=64), nullable=True),
        )
        op.create_index(
            "ix_chat_confirmation_project_status",
            "chat_confirmation",
            ["project_id", "status"],
            unique=False,
        )

    # 2. 为 agentrun 补充乐观并发 revision 列
    if "agentrun" in tables:
        run_cols = [c["name"] for c in inspector.get_columns("agentrun")]
        if "revision" not in run_cols:
            op.add_column(
                "agentrun",
                sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            )

    # 3. 为 asset 补充乐观并发 revision 列
    if "asset" in tables:
        asset_cols = [c["name"] for c in inspector.get_columns("asset")]
        if "revision" not in asset_cols:
            op.add_column(
                "asset",
                sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            )

    # 4. 为 engine_run_events 补充高性能检索复合索引
    if "engine_run_events" in tables:
        existing_indices = [idx["name"] for idx in inspector.get_indexes("engine_run_events")]
        if "idx_engine_run_events_project_type_seq" not in existing_indices:
            op.create_index(
                "idx_engine_run_events_project_type_seq",
                "engine_run_events",
                ["project_id", "type", "seq"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()

    if "engine_run_events" in tables:
        idx_names = [idx["name"] for idx in inspector.get_indexes("engine_run_events")]
        if "idx_engine_run_events_project_type_seq" in idx_names:
            op.drop_index(
                "idx_engine_run_events_project_type_seq",
                table_name="engine_run_events",
            )

    if "asset" in tables:
        asset_cols = [c["name"] for c in inspector.get_columns("asset")]
        if "revision" in asset_cols:
            with op.batch_alter_table("asset") as batch:
                batch.drop_column("revision")

    if "agentrun" in tables:
        run_cols = [c["name"] for c in inspector.get_columns("agentrun")]
        if "revision" in run_cols:
            with op.batch_alter_table("agentrun") as batch:
                batch.drop_column("revision")

    if "chat_confirmation" in tables:
        idx_names = [idx["name"] for idx in inspector.get_indexes("chat_confirmation")]
        if "ix_chat_confirmation_project_status" in idx_names:
            op.drop_index(
                "ix_chat_confirmation_project_status",
                table_name="chat_confirmation",
            )
        op.drop_table("chat_confirmation")
