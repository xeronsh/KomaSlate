"""Small JSON-lines bridge for Engine-owned media helpers."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import TextIO
from urllib.parse import urlsplit

from app.config import get_settings
from app.services.audio_service import AudioService
from app.services.character_bible import compute_face_embedding_from_bytes
from app.services.file_cleaner import STATIC_DIR, get_local_path
from app.services.image_composer import ImageComposer
from app.services.tts_providers import default_voice
from app.services.tts_voices import get_voice_for_character

logger = logging.getLogger(__name__)

_COMPOSER: ImageComposer | None = None


def _get_composer() -> ImageComposer:
    global _COMPOSER
    if _COMPOSER is None:
        _COMPOSER = ImageComposer()
    return _COMPOSER


def _allowed_media_roots() -> list[Path]:
    roots = [STATIC_DIR.resolve()]
    extra = os.environ.get("ENGINE_STATIC_DIR")
    if extra:
        roots.append(Path(extra).resolve())
    return roots


def _resolve_safe_media_path(raw_path: str) -> Path:
    if raw_path.startswith("/static/"):
        local = get_local_path(raw_path)
        if local is not None:
            return local
    candidate = Path(raw_path).resolve()
    for root in _allowed_media_roots():
        try:
            candidate.relative_to(root)
            return candidate
        except ValueError:
            continue
    raise ValueError(f"Security violation: media path outside allowed boundaries: {raw_path}")


def _to_static_url(path: Path) -> str:
    for root in _allowed_media_roots():
        try:
            rel = path.resolve().relative_to(root)
            return f"/static/{rel.as_posix()}"
        except ValueError:
            continue
    return str(path)


async def handle(request: object) -> object:
    if not isinstance(request, dict):
        raise ValueError("request must be an object")

    action = request.get("action")
    if action == "face_embedding":
        local_path_raw = request.get("image_path") or request.get("path")
        if isinstance(local_path_raw, str) and local_path_raw:
            safe_path = _resolve_safe_media_path(local_path_raw)
            data = await asyncio.to_thread(safe_path.read_bytes)
            return await asyncio.to_thread(compute_face_embedding_from_bytes, data)
        image = request.get("image")
        if not isinstance(image, str):
            return None
        raw = base64.b64decode(image, validate=True)
        return await asyncio.to_thread(compute_face_embedding_from_bytes, raw)

    composer = _get_composer()
    if action == "character_reference":
        urls = request.get("urls")
        if not isinstance(urls, list) or not urls:
            return None
        image = await composer.compose_character_reference_image(urls)
        output_path = request.get("output_path")
        if isinstance(output_path, str) and output_path:
            dest = _resolve_safe_media_path(output_path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(dest.write_bytes, image)
            return {"file_path": str(dest), "path": str(dest), "url": _to_static_url(dest)}
        if request.get("return_path"):
            dest = (STATIC_DIR / "managed-v1" / f"char-ref-{uuid.uuid4().hex[:12]}.png").resolve()
            dest.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(dest.write_bytes, image)
            return {"file_path": str(dest), "path": str(dest), "url": _to_static_url(dest)}
        return base64.b64encode(image).decode("ascii")

    if action == "nine_grid_reference":
        current = request.get("current")
        if not isinstance(current, str) or not current:
            raise ValueError("current image is required")
        image = await composer.compose_nine_grid_reference_image(
            current_image_url=current,
            previous_image_url=request.get("previous"),
            next_image_url=request.get("next"),
            character_image_urls=request.get("characters"),
        )
        output_path = request.get("output_path")
        if isinstance(output_path, str) and output_path:
            dest = _resolve_safe_media_path(output_path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(dest.write_bytes, image)
            return {"file_path": str(dest), "path": str(dest), "url": _to_static_url(dest)}
        if request.get("return_path"):
            dest = (STATIC_DIR / "managed-v1" / f"nine-grid-{uuid.uuid4().hex[:12]}.png").resolve()
            dest.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(dest.write_bytes, image)
            return {"file_path": str(dest), "path": str(dest), "url": _to_static_url(dest)}
        return base64.b64encode(image).decode("ascii")

    if action == "process_audio":
        policy = request.get("settings")
        allowed = {
            "text_provider",
            "image_provider",
            "video_provider",
            "tts_enabled",
            "tts_provider",
            "tts_base_url",
            "tts_api_key",
            "tts_model",
            "tts_default_voice",
            "tts_volume",
            "bgm_enabled",
            "bgm_volume",
            "bgm_directory",
        }
        updates = {
            key: value
            for key, value in policy.items()
            if key in allowed
        } if isinstance(policy, dict) else {}
        settings = get_settings().model_copy(update=updates)
        audio = AudioService(settings)

        dialogue = request.get("dialogue")
        tts_url = None
        tts_error = None
        if settings.tts_enabled and isinstance(dialogue, str) and dialogue.strip():
            speaker = request.get("speaker")
            voice = request.get("voice")
            if not isinstance(voice, str) or not voice.strip():
                voice = settings.tts_default_voice or default_voice(settings.tts_provider)
                # The description-based pick only knows Edge voices.
                if isinstance(speaker, dict) and settings.tts_provider == "edge":
                    voice = get_voice_for_character(
                        SimpleNamespace(
                            name=str(speaker.get("name") or ""),
                            description=speaker.get("description"),
                        )
                    )
            tts_url = await audio.generate_tts(dialogue, voice=voice.strip())
            tts_error = audio.last_error

        scene = request.get("scene")
        expression = request.get("expression")
        genre = request.get("genre")
        bgm_url = audio.match_bgm(
            scene=scene if isinstance(scene, str) else None,
            expression=expression if isinstance(expression, str) else None,
            genre=genre if isinstance(genre, str) else None,
        )
        video_url = request.get("video_url")
        if not isinstance(video_url, str):
            raise ValueError("video_url is required")
        video_url = await audio.mix_audio_into_video(
            video_url,
            tts_path=tts_url,
            bgm_path=bgm_url,
            tts_volume=settings.tts_volume,
            bgm_volume=settings.bgm_volume,
        )
        return {
            "video_url": video_url,
            "tts_url": tts_url,
            "bgm_type": Path(urlsplit(bgm_url).path).stem if bgm_url else None,
            "tts_error": tts_error,
        }

    if action == "bgm_track":
        policy = request.get("settings")
        allowed = {"bgm_provider", "bgm_base_url", "bgm_api_key", "bgm_model", "bgm_directory"}
        updates = {key: value for key, value in policy.items() if key in allowed} if isinstance(policy, dict) else {}
        settings = get_settings().model_copy(update=updates)
        audio = AudioService(settings)
        texts = request.get("texts")
        genre = request.get("genre")
        genre = genre if isinstance(genre, str) else None
        mood = audio.pick_mood([t for t in texts if isinstance(t, str)] if isinstance(texts, list) else [], genre)
        duration = request.get("duration")
        return await audio.film_bgm_track(
            mood, genre, float(duration) if isinstance(duration, (int, float)) and duration > 0 else 30.0
        )

    raise ValueError(f"unknown action: {action}")


def _protocol_stdout():
    """Keep stdout for protocol lines only.

    Libraries print to stdout while loading (InsightFace prints a line per
    ONNX model on the first face-aware request). The engine reads the first
    stdout line as the reply, so that chatter used to fail the first request
    of every worker and the shot silently lost its character reference.
    Anything else written to stdout, from Python or native code, now goes to
    stderr.
    """
    sys.stdout.flush()
    protocol = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return protocol


async def _serve_loop(out: TextIO) -> None:
    """Single long-lived asyncio event loop reading newline-delimited JSON requests."""
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        stripped = line.strip()
        if not stripped:
            continue
        try:
            result = await handle(json.loads(stripped))
        except Exception as error:
            logger.exception("Engine media operation failed")
            result = {"error": str(error)}
        out.write(json.dumps(result) + "\n")
        out.flush()


def main() -> None:
    out = _protocol_stdout()
    asyncio.run(_serve_loop(out))


if __name__ == "__main__":
    main()
