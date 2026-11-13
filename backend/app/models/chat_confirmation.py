from __future__ import annotations

from typing import Optional

from sqlalchemy import Column, Index, String, Text, text
from sqlmodel import Field, SQLModel


class ChatConfirmation(SQLModel, table=True):
    """Persisted write-tool confirmation card for the chat agent (migration 0036)."""

    __tablename__ = "chat_confirmation"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (
        Index("ix_chat_confirmation_project_status", "project_id", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    tool_call_id: str = Field(max_length=128, unique=True)
    tool_name: str = Field(max_length=128)
    tool_label: str = Field(max_length=128)
    parameters_json: str = Field(sa_column=Column(Text, nullable=False))
    summary: str = Field(sa_column=Column(Text, nullable=False))
    status: str = Field(default="pending", max_length=32)
    created_at: Optional[str] = Field(
        default=None,
        sa_column=Column(
            String,
            nullable=False,
            server_default=text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
        ),
    )
    resolved_at: Optional[str] = Field(default=None, nullable=True)
    resolved_by: Optional[str] = Field(default=None, max_length=64)
