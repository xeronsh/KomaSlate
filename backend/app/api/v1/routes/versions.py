from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep, WsManagerDep
from app.models.project import Character, Project, Shot
from app.schemas.project import CharacterRead, ShotRead
from app.schemas.version import (
    ArtifactVersionRead,
    RollbackRequest,
    RollbackResponse,
    VersionCompareRead,
    VersionDiff,
    VersionListRead,
)
from app.services.revision import commit_versioned
from app.services.version_service import EntityType, VersionService
from app.ws.manager import ConnectionManager

router = APIRouter()
version_service = VersionService()


def _diff_snapshots(old: dict, new: dict) -> list[VersionDiff]:
    fields = sorted(set(old.keys()) | set(new.keys()))
    return [
        VersionDiff(field_name=field, old_value=old.get(field), new_value=new.get(field))
        for field in fields
        if old.get(field) != new.get(field)
    ]


@router.get("/projects/{project_id}/versions", response_model=VersionListRead)
async def list_versions(
    project_id: int,
    entity_type: EntityType = Query(...),
    entity_id: int = Query(...),
    session: AsyncSession = SessionDep,
) -> VersionListRead:
    versions = await version_service.get_versions(session, entity_type, entity_id)
    versions = [version for version in versions if version.project_id == project_id]
    return VersionListRead(entity_type=entity_type, entity_id=entity_id, versions=versions)


@router.get("/versions/{version_id}", response_model=ArtifactVersionRead)
async def get_version(version_id: int, session: AsyncSession = SessionDep) -> ArtifactVersionRead:
    version = await version_service.get_version(session, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return ArtifactVersionRead.model_validate(version)


@router.post("/versions/rollback", response_model=RollbackResponse)
async def rollback_version(
    payload: RollbackRequest,
    session: AsyncSession = SessionDep,
    ws: ConnectionManager = WsManagerDep,
) -> RollbackResponse:
    current_versions = await version_service.get_versions(
        session, payload.entity_type, payload.entity_id
    )
    from_version = current_versions[0].version if current_versions else 0
    new_version = await version_service.rollback(
        session, payload.entity_type, payload.entity_id, payload.target_version
    )
    await commit_versioned(session, new_version, entity=payload.entity_type)
    await session.refresh(new_version)

    if payload.entity_type == "character":
        entity = await session.get(Character, payload.entity_id)
        if entity is not None:
            await ws.send_event(
                entity.project_id,
                {
                    "type": "character_updated",
                    "data": {"character": CharacterRead.model_validate(entity).model_dump(mode="json")},
                },
            )
            shots = await session.execute(select(Shot).where(Shot.project_id == entity.project_id))
            for shot in shots.scalars():
                if payload.entity_id in shot.character_ids:
                    await ws.send_event(
                        entity.project_id,
                        {
                            "type": "shot_updated",
                            "data": {
                                "shot": ShotRead.model_validate(shot).model_dump(mode="json")
                            },
                        },
                    )
                    shot_versions = await version_service.get_versions(
                        session, "shot", int(shot.id)
                    )
                    if shot_versions:
                        await ws.send_event(
                            entity.project_id,
                            {
                                "type": "version_created",
                                "data": {
                                    "entity_type": "shot",
                                    "entity_id": shot.id,
                                    "version": shot_versions[0].version,
                                    "trigger": shot_versions[0].trigger,
                                },
                            },
                        )
            project_id = entity.project_id
    else:
        entity = await session.get(Shot, payload.entity_id)
        if entity is not None:
            await ws.send_event(
                entity.project_id,
                {
                    "type": "shot_updated",
                    "data": {"shot": ShotRead.model_validate(entity).model_dump(mode="json")},
                },
            )
            project_id = entity.project_id

    project = await session.get(Project, project_id) if entity is not None else None
    if project is not None:
        await ws.send_event(
            project_id,
            {
                "type": "project_updated",
                "data": {
                    "project": {
                        "id": project_id,
                        "revision": project.revision,
                        "status": project.status,
                        "video_url": project.video_url,
                    }
                },
            },
        )

    await ws.send_event(
        new_version.project_id,
        {
            "type": "version_rollback",
            "data": {
                "entity_type": payload.entity_type,
                "entity_id": payload.entity_id,
                "from_version": from_version,
                "to_version": payload.target_version,
            },
        },
    )
    await ws.send_event(
        new_version.project_id,
        {
            "type": "version_created",
            "data": {
                "entity_type": payload.entity_type,
                "entity_id": payload.entity_id,
                "version": new_version.version,
                "trigger": new_version.trigger,
            },
        },
    )

    return RollbackResponse(
        success=True,
        message=f"已回滚到版本 {payload.target_version}",
        new_version=ArtifactVersionRead.model_validate(new_version),
    )


@router.get("/projects/{project_id}/versions/compare", response_model=VersionCompareRead)
async def compare_versions(
    project_id: int,
    entity_type: EntityType = Query(...),
    entity_id: int = Query(...),
    v1: int = Query(..., ge=1),
    v2: int = Query(..., ge=1),
    session: AsyncSession = SessionDep,
) -> VersionCompareRead:
    from_version = await version_service.get_version_by_number(session, entity_type, entity_id, v1)
    to_version = await version_service.get_version_by_number(session, entity_type, entity_id, v2)
    if from_version is None or to_version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    if from_version.project_id != project_id or to_version.project_id != project_id:
        raise HTTPException(status_code=404, detail="Version not found")

    return VersionCompareRead(
        entity_type=entity_type,
        entity_id=entity_id,
        from_version=ArtifactVersionRead.model_validate(from_version),
        to_version=ArtifactVersionRead.model_validate(to_version),
        diffs=_diff_snapshots(from_version.snapshot, to_version.snapshot),
    )
