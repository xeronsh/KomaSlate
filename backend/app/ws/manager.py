from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any
from weakref import WeakKeyDictionary

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.generated.events_contract import EVENT_PAYLOAD_MODELS
from app.schemas.chat import ChatMessageEventData, ChatStatusEventData
from app.schemas.export import ExportCompletedEventData
from app.schemas.ws import (
    AgentThinkingEventData,
    LlmStreamEventData,
    AudioGeneratedEventData,
    BibleUpdatedEventData,
    CharacterCreatedEventData,
    CharacterDeletedEventData,
    CharacterUpdatedEventData,
    ConsistencyEvalCompletedEventData,
    CritiqueResultEventData,
    DataClearedEventData,
    ErrorEventData,
    OutlineUpdatedEventData,
    ProjectRestoredEventData,
    ProjectUpdatedEventData,
    RunAwaitingConfirmEventData,
    RunCancelledEventData,
    RunCompletedEventData,
    RunConfirmedEventData,
    RunFailedEventData,
    RunFeedbackEventData,
    RunMessageEventData,
    RunProgressEventData,
    RunStartedEventData,
    ShotCreatedEventData,
    ShotDeletedEventData,
    ShotsReorderedEventData,
    ShotUpdatedEventData,
    VersionCreatedEventData,
    VersionRollbackEventData,
    WsEvent,
)


_EVENT_DATA_MODELS: dict[str, type[Any]] = {
    "run_started": RunStartedEventData,
    "run_progress": RunProgressEventData,
    "run_message": RunMessageEventData,
    "run_completed": RunCompletedEventData,
    "run_failed": RunFailedEventData,
    "run_cancelled": RunCancelledEventData,
    "run_awaiting_confirm": RunAwaitingConfirmEventData,
    "run_confirmed": RunConfirmedEventData,
    "run_feedback": RunFeedbackEventData,
    "character_created": CharacterCreatedEventData,
    "character_updated": CharacterUpdatedEventData,
    "character_deleted": CharacterDeletedEventData,
    "shot_created": ShotCreatedEventData,
    "shot_updated": ShotUpdatedEventData,
    "shots_reordered": ShotsReorderedEventData,
    "shot_deleted": ShotDeletedEventData,
    "outline_updated": OutlineUpdatedEventData,
    "project_updated": ProjectUpdatedEventData,
    "data_cleared": DataClearedEventData,
    "error": ErrorEventData,
    "critique_result": CritiqueResultEventData,
    "bible_updated": BibleUpdatedEventData,
    "agent_thinking": AgentThinkingEventData,
    "llm_stream": LlmStreamEventData,
    "audio_generated": AudioGeneratedEventData,
    "version_created": VersionCreatedEventData,
    "version_rollback": VersionRollbackEventData,
    "project_restored": ProjectRestoredEventData,
    "export_completed": ExportCompletedEventData,
    "consistency_eval_completed": ConsistencyEvalCompletedEventData,
    "chat_message": ChatMessageEventData,
    "chat_status": ChatStatusEventData,
}


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        # Per-connection send lock prevents interleaved JSON frames when
        # tailer, hydration, and ping/pong respond concurrently.
        self._ws_locks: WeakKeyDictionary[WebSocket, asyncio.Lock] = WeakKeyDictionary()
        self._client_cursors: WeakKeyDictionary[WebSocket, int] = WeakKeyDictionary()

    def _get_ws_lock(self, websocket: WebSocket) -> asyncio.Lock:
        lock = self._ws_locks.get(websocket)
        if lock is None:
            lock = asyncio.Lock()
            self._ws_locks[websocket] = lock
        return lock

    def update_client_cursor(self, websocket: WebSocket, seq: int) -> None:
        prev = self._client_cursors.get(websocket, 0)
        if seq > prev:
            self._client_cursors[websocket] = seq

    def min_active_cursor(self) -> int | None:
        cursors = [c for c in self._client_cursors.values() if c > 0]
        return min(cursors) if cursors else None

    async def connect(self, project_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._conns[project_id].add(websocket)
            self._get_ws_lock(websocket)

    async def disconnect(self, project_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if project_id in self._conns:
                self._conns[project_id].discard(websocket)
                if not self._conns[project_id]:
                    self._conns.pop(project_id, None)
            self._ws_locks.pop(websocket, None)
            self._client_cursors.pop(websocket, None)

    @staticmethod
    def _validated_payload(event: dict[str, Any] | WsEvent) -> dict[str, Any]:
        if isinstance(event, dict):
            event = WsEvent.model_validate(event)

        data_model = _EVENT_DATA_MODELS.get(event.type) or EVENT_PAYLOAD_MODELS.get(event.type)
        if data_model is not None:
            validated_data = data_model.model_validate(event.data)
            # project_updated 是局部补丁：只发送真正带上的字段，免得默认的 None 覆盖前端缓存
            partial = event.type == "project_updated"
            event = WsEvent(
                type=event.type,
                data=validated_data.model_dump(mode="json", exclude_unset=partial),
            )
        return event.model_dump()

    async def send_event_to(self, websocket: WebSocket, event: dict[str, Any] | WsEvent) -> None:
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        payload = self._validated_payload(event)
        async with self._get_ws_lock(websocket):
            if websocket.client_state != WebSocketState.CONNECTED:
                return
            await websocket.send_json(payload)

    async def send_durable_event_to(
        self,
        websocket: WebSocket,
        *,
        event_id: int,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        """Validate event data, then attach transport-level durable cursor.

        ``event_id`` is transport metadata rather than business payload. Keeping
        it outside the Pydantic event-data models means generated/replayed
        events retain the exact same domain schema while clients still get a
        monotonic cursor for dedupe and reconnect replay.
        """
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        event = WsEvent.model_validate({"type": event_type, "data": data})
        payload = self._validated_payload(event)
        payload["event_id"] = event_id
        async with self._get_ws_lock(websocket):
            if websocket.client_state != WebSocketState.CONNECTED:
                return
            await websocket.send_json(payload)
        self.update_client_cursor(websocket, event_id)

    async def send_event(self, project_id: int, event: dict[str, Any] | WsEvent) -> None:
        payload = self._validated_payload(event)
        conns = list(self._conns.get(project_id, set()))
        for ws in conns:
            if ws.client_state != WebSocketState.CONNECTED:
                continue
            try:
                async with self._get_ws_lock(ws):
                    if ws.client_state != WebSocketState.CONNECTED:
                        continue
                    await ws.send_json(payload)
            except Exception:
                await self.disconnect(project_id, ws)


ws_manager = ConnectionManager()
