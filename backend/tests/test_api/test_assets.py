"""Asset API route tests."""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.models.asset import Asset
from app.services import file_cleaner
from tests.factories import create_character, create_project, create_shot


# ── helpers ───────────────────────────────────────────────────


def _make_png_bytes() -> bytes:
    img = Image.new("RGB", (10, 10), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _make_png_file() -> tuple[bytes, str, str]:
    data = _make_png_bytes()
    return data, "test.png", "image/png"


# ── list ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_assets_empty(async_client):
    res = await async_client.get("/api/v1/assets")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_assets_with_data(async_client, test_session):
    asset = Asset(name="TestChar", asset_type="character", description="A test")
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.get("/api/v1/assets")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "TestChar"
    assert data["items"][0]["asset_type"] == "character"


@pytest.mark.asyncio
async def test_list_assets_filter_by_type(async_client, test_session):
    char_asset = Asset(name="Char", asset_type="character")
    scene_asset = Asset(name="Scene", asset_type="scene")
    test_session.add(char_asset)
    test_session.add(scene_asset)
    await test_session.commit()

    res = await async_client.get("/api/v1/assets?asset_type=character")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["items"][0]["asset_type"] == "character"

    res2 = await async_client.get("/api/v1/assets?asset_type=scene")
    assert res2.status_code == 200
    assert res2.json()["total"] == 1


@pytest.mark.asyncio
async def test_list_assets_search(async_client, test_session):
    asset = Asset(name="独角兽", asset_type="character", description="一只神秘的独角兽")
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.get("/api/v1/assets?search=独角")
    assert res.status_code == 200
    assert res.json()["total"] == 1

    res2 = await async_client.get("/api/v1/assets?search=不存在的")
    assert res2.status_code == 200
    assert res2.json()["total"] == 0


# ── create ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_asset(async_client, test_session):
    payload = {
        "name": "New Asset",
        "asset_type": "character",
        "description": "Created via API",
    }
    res = await async_client.post("/api/v1/assets", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "New Asset"
    assert data["asset_type"] == "character"
    assert data["description"] == "Created via API"
    assert data["image_url"] is None
    assert isinstance(data["id"], int)

    # Verify persisted
    asset = await test_session.get(Asset, data["id"])
    assert asset is not None
    assert asset.name == "New Asset"


@pytest.mark.asyncio
async def test_create_asset_with_image_url(async_client, test_session):
    payload = {
        "name": "Image Asset",
        "asset_type": "scene",
        "image_url": "/static/assets/test.png",
    }
    res = await async_client.post("/api/v1/assets", json=payload)
    assert res.status_code == 201
    assert res.json()["image_url"] == "/static/assets/test.png"


@pytest.mark.asyncio
async def test_create_asset_missing_name(async_client):
    payload = {"asset_type": "character"}
    res = await async_client.post("/api/v1/assets", json=payload)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_create_asset_missing_type(async_client):
    payload = {"name": "No Type"}
    res = await async_client.post("/api/v1/assets", json=payload)
    assert res.status_code == 422


# ── upload-image ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_asset_image(async_client, monkeypatch, tmp_path):
    monkeypatch.setattr(file_cleaner, "STATIC_DIR", tmp_path)
    data, filename, content_type = _make_png_file()
    res = await async_client.post(
        "/api/v1/assets/upload-image",
        files={"file": (filename, data, content_type)},
    )
    assert res.status_code == 200
    result = res.json()
    assert "url" in result
    assert result["url"].startswith("/static/assets/")
    assert result["url"].endswith(".png")
    saved_path = tmp_path / result["url"].removeprefix("/static/")
    assert saved_path.read_bytes() == data


@pytest.mark.asyncio
async def test_upload_asset_image_rejects_non_image(async_client):
    res = await async_client.post(
        "/api/v1/assets/upload-image",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 400


# ── from-character ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_asset_from_character(async_client, test_session):
    project = await create_project(test_session, title="Char Asset Test")
    character = await create_character(
        test_session,
        project_id=project.id,
        name="小白",
        description="一只白猫",
        image_url="/static/images/cat.png",
    )

    res = await async_client.post(f"/api/v1/assets/from-character/{character.id}")
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "小白"
    assert data["asset_type"] == "character"
    assert data["description"] == "一只白猫"
    assert data["image_url"] == "/static/images/cat.png"
    assert data["source_project_id"] == project.id


@pytest.mark.asyncio
async def test_create_asset_from_character_not_found(async_client):
    res = await async_client.post("/api/v1/assets/from-character/99999")
    assert res.status_code == 404


# ── from-shot ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_asset_from_shot(async_client, test_session):
    project = await create_project(test_session, title="Shot Asset Test")
    shot = await create_shot(
        test_session,
        project_id=project.id,
        order=1,
        description="日落场景",
        image_url="/static/images/sunset.png",
    )
    shot.scene = "日落"
    test_session.add(shot)
    await test_session.commit()

    res = await async_client.post(f"/api/v1/assets/from-shot/{shot.id}")
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "日落"
    assert data["asset_type"] == "scene"
    assert data["description"] == "日落场景"
    assert data["image_url"] == "/static/images/sunset.png"
    assert data["source_project_id"] == project.id


@pytest.mark.asyncio
async def test_create_asset_from_shot_not_found(async_client):
    res = await async_client.post("/api/v1/assets/from-shot/99999")
    assert res.status_code == 404


# ── get by id ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_asset(async_client, test_session):
    asset = Asset(name="GetMe", asset_type="character")
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.get(f"/api/v1/assets/{asset.id}")
    assert res.status_code == 200
    assert res.json()["name"] == "GetMe"


@pytest.mark.asyncio
async def test_get_asset_not_found(async_client):
    res = await async_client.get("/api/v1/assets/99999")
    assert res.status_code == 404


# ── delete ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_asset(async_client, test_session):
    asset = Asset(name="DeleteMe", asset_type="scene")
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.delete(f"/api/v1/assets/{asset.id}")
    assert res.status_code == 204

    # Verify deleted
    deleted = await test_session.get(Asset, asset.id)
    assert deleted is None


@pytest.mark.asyncio
async def test_delete_asset_not_found(async_client):
    res = await async_client.delete("/api/v1/assets/99999")
    assert res.status_code == 404


# ── use-in-project ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_use_character_asset_in_project(async_client, test_session):
    project = await create_project(test_session, title="Target Project")
    asset = Asset(
        name="可复用角色",
        asset_type="character",
        description="从资产库拉入",
        image_url="/static/assets/reuse.png",
    )
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.post(
        f"/api/v1/assets/{asset.id}/use-in-project",
        json={"project_id": project.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "可复用角色"
    assert data["project_id"] == project.id
    assert data["image_url"] == "/static/assets/reuse.png"
    assert data["approval_state"] == "approved"


@pytest.mark.asyncio
async def test_use_scene_asset_in_project(async_client, test_session):
    project = await create_project(test_session, title="Scene Target")
    asset = Asset(
        name="可复用场景",
        asset_type="scene",
        description="美丽的风景",
        image_url="/static/assets/scene.png",
    )
    test_session.add(asset)
    await test_session.commit()

    res = await async_client.post(
        f"/api/v1/assets/{asset.id}/use-in-project",
        json={"project_id": project.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["description"] == "美丽的风景"
    assert data["project_id"] == project.id
    # Scene assets become shots
    assert "order" in data


@pytest.mark.asyncio
async def test_use_asset_not_found(async_client):
    res = await async_client.post(
        "/api/v1/assets/99999/use-in-project",
        json={"project_id": 1},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_update_asset_enforces_cas_expected_revision(async_client, test_session):
    asset = Asset(name="Orig", asset_type="character")
    test_session.add(asset)
    await test_session.commit()
    await test_session.refresh(asset)
    initial_rev = asset.revision

    ok = await async_client.patch(
        f"/api/v1/assets/{asset.id}",
        json={"name": "Updated", "expected_revision": initial_rev},
    )
    assert ok.status_code == 200
    assert ok.json()["revision"] == initial_rev + 1

    stale = await async_client.patch(
        f"/api/v1/assets/{asset.id}",
        json={"name": "Conflict", "expected_revision": initial_rev},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CONCURRENT_MODIFICATION"
