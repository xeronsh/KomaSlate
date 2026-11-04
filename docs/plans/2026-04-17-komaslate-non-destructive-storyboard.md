# KomaSlate 非破坏性分镜工作台与剪辑包导出实施计划

> **给执行者：** 按任务逐步落实，严格遵守文件边界（4 个并行 worktree 零文件重叠）。按仓库 `AGENTS.md` 约定：**默认不跑测试命令（不执行 pytest / vitest / tsc / pnpm build / ruff），不新增或修改测试文件，不 git push**。每个 worktree 完成后在各自分支做一次英文 Conventional Commit（`<=72` 字符）。

**目标：** 补齐 KomaSlate（原 openOii）单镜头非破坏性编辑、重规划保活、回滚一致性、视频版本对比与通用剪辑包（ZIP + SRT + FCPXML v1.9）导出闭环。

**架构：** 保持 ADR 0008 边界——`engine/` 持有分镜重规划保活与渲染/合成提示词拼接；`backend/` 负责参数透传、空镜审批放行、回滚事务同步与 ZIP/FCPXML 打包；`frontend/` 暴露角色芯片绑定、单镜重画微调输入、双栏视频对比与剪辑包导出按钮。

**技术栈：** TypeScript (`engine/`), Python FastAPI + SQLModel (`backend/`), React 19 + TanStack Query (`frontend/`), SQLite.

**相关规格：** `docs/spec/non-destructive-storyboard.md` · `docs/adr/0012-non-destructive-storyboard-editorial-pack.md`

---

## Worktree 拆分与零冲突矩阵

| Worktree | 分支 | 目录 | 独占修改文件 |
| --- | --- | --- | --- |
| WT-1 Engine | `feat/engine-preserve-shots` | `/tmp/komaslate-wt-engine` | `engine/src/shared-db.ts`, `engine/src/agents/index.ts` |
| WT-2 Backend Shots & Rollback | `feat/backend-shot-editing-rollback` | `/tmp/komaslate-wt-backend-shots` | `backend/app/schemas/project.py`, `backend/app/services/run_lifecycle.py`, `backend/app/api/v1/routes/shots.py`, `backend/app/services/version_service.py` |
| WT-3 Backend Editorial Pack | `feat/backend-editorial-pack` | `/tmp/komaslate-wt-editorial` | `backend/app/services/export_service.py`, `backend/app/api/v1/routes/export.py` |
| WT-4 Frontend Workbench | `feat/frontend-workbench-controls` | `/tmp/komaslate-wt-frontend` | `frontend/app/services/api.ts`, `frontend/app/features/comic-workflow/inspector/PropertiesSection.tsx`, `frontend/app/features/comic-workflow/inspector/GenerationSection.tsx`, `frontend/app/components/panels/versionDiff.ts`, `frontend/app/components/panels/VersionCompareDrawer.tsx`, `frontend/app/components/layout/StudioControls.tsx`, `frontend/app/features/workbench/ProjectWorkbench.tsx`, `frontend/app/hooks/applyWsEvent.ts` |

---

### 任务 1（WT-1）：Engine 分镜重规划保活与 CAS `order` 支持

**涉及：**
- 改：`engine/src/shared-db.ts:449-475` (`casWrite`), `engine/src/shared-db.ts:970-993` (`updateShot`)
- 改：`engine/src/agents/index.ts:348-378` (`planBasePayload`), `engine/src/agents/index.ts:519-563` (`applyShotPlan`)

**步骤：**
1. 在 `engine/src/shared-db.ts` 的 `casWrite` 中对 SQL 保留字 `order` 加双引号（`k === "order" ? '"order"' : k`），并在 `updateShot` 的过滤条件中允许 `order` 字段通过 CAS 更新。
2. 在 `engine/src/agents/index.ts:planBasePayload` 的 `existing_state.shots` 中补充 `approved: Boolean(s.approved_at && s.approval_version > 0)`。
3. 重写 `engine/src/agents/index.ts:applyShotPlan` 对齐 `applyCharacterPlan`：
   - 读取 `preserve = new Set<number>((data.preserve_ids as { shots?: number[] } | undefined)?.shots ?? [])`。
   - 判定 `isFrozen(existing)`：`!ctx.forceRegenerate && Boolean(existing.approved_at && existing.approval_version > 0)`。
   - 仅删除既不在 `mentionedIds`、又不在 `preserve`、且非 `isFrozen` 的旧分镜，并发出 `shot_deleted`。
   - 遍历 `rawShots`：
     - 若 `s.id` 命中同项目已有镜头：若 `isFrozen(existing)`，仅在 `existing.order !== index + 1` 时更新 `order` 并保留其全部已批准文案与媒体；否则先调用 `ctx.shared.createVersion(ctx.projectId, "shot", existing.id, existing, ctx.runId, "generation")` + `ctx.emitter.versionCreated("shot", existing.id, version, "generation")`，比较核心画面/台词字段是否变化以决定是否清空旧 `image_url`/`video_url`/`tts_url`，调用 `ctx.shared.updateShot` 更新字段，并用 `ctx.shared.getLiveShot(existing.id)` 发出 `ctx.emitter.shotUpdated(shotReadPayload(updated))`。
     - 若无 `s.id` 或未命中已有镜头：`insertShot` + `updateShot`，用 `ctx.shared.getLiveShot(id)` 发出 `ctx.emitter.shotCreated(shotReadPayload(row))`。
4. 提交：`feat(engine): preserve approved and matched shots in shot planning`。

**验证者：** 独立 `reviewer` subagent 逐行审查 CAS revision、frozen input 读取（`getLiveShot`）与冻结镜头保护不变量。

---

### 任务 2（WT-2）：Backend 单镜微调透传、空镜批准放行与回滚同步

**涉及：**
- 改：`backend/app/schemas/project.py:310-315` (`RegenerateRequest`)
- 改：`backend/app/services/run_lifecycle.py:48-145` (`TargetedRunSpec`, `create_local_run`)
- 改：`backend/app/api/v1/routes/shots.py:32-47` (`_validate_shot_approval_ready`), `backend/app/api/v1/routes/shots.py:170-220` (`regenerate_shot`)
- 改：`backend/app/services/version_service.py:68-85` (`ROLLBACK_FIELDS`), `backend/app/services/version_service.py:194-256` (`VersionService.rollback`)

**步骤：**
1. `RegenerateRequest` 增加 `feedback: str | None = Field(default=None, max_length=2000)`。
2. `TargetedRunSpec` 增加 `user_feedback: str = ""`；在 `create_local_run` 写入 `context_snapshot["user_feedback"] = spec.user_feedback`，并传给 `engine_start_run(..., user_feedback=spec.user_feedback)`。
3. `routes/shots.py`：
   - `_validate_shot_approval_ready` 移除 `if not shot.character_ids: missing.append("出场角色")`，允许纯空镜/转场镜通过批准。
   - `regenerate_shot` 将 `user_feedback=(payload.feedback or "").strip()` 传入 `TargetedRunSpec`。
4. `version_service.py`：
   - `ROLLBACK_FIELDS["shot"]` 加入 `"character_ids"`。
   - `VersionService.rollback`：当 `entity_type == "shot"` 时，归一化 `character_ids`（过滤仅保留同项目仍存在的 `Character.id`），删除旧 `ShotCharacterBinding` 并插入新绑定；对 `character` 与 `shot` 回滚均执行 `entity.revision = int(entity.revision or 0) + 1`；若关联项目存在成片且回滚改变了镜头/角色，标记项目需要重合成或更新 `project.revision`。
5. 提交：`fix(backend): support shot feedback, empty-cast approval and rollback sync`。

**验证者：** 独立 `reviewer` subagent 审查 SQLAlchemy 异步 session 刷新、绑定表唯一约束与 revision CAS 兼容性。

---

### 任务 3（WT-3）：Backend 通用剪辑包导出（ZIP + SRT + FCPXML v1.9）

**涉及：**
- 改：`backend/app/services/export_service.py`
- 改：`backend/app/api/v1/routes/export.py`

**步骤：**
1. 在 `ExportService` 新增 `export_editorial_pack(self, project: Project, shots: list[Shot], characters: list[Character]) -> str`：
   - 按 `shot.order` 排序，计算每镜时长（优先 `shot.duration` > 0，否则默认 `5.0` 秒）与起止时间码。
   - 收集本地静态文件（通过已有路径解析安全限制在 `STATIC_DIR` 内，防路径穿越）：`shots/{idx:02d}_shot_{shot.id}{img_ext}`、`shots/{idx:02d}_shot_{shot.id}{vid_ext}`、`audio/{idx:02d}_shot_{shot.id}_tts{aud_ext}`、角色设定图 `characters/{char.id}_{safe_name}{ext}` 及项目成片（如有）。
   - 生成 UTF-8 `subtitles.srt`（含序号、`HH:MM:SS,mmm --> HH:MM:SS,mmm` 时间轴与台词/旁白）。
   - 生成 `manifest.json`（项目元数据、角色表、分镜参数、提示词、相对媒体路径）。
   - 生成标准 FCPXML v1.9 `timeline.fcpxml`（`<fcpxml version="1.9">`，24fps `100/2400s` 格式定义、`<resources>` 相对路径 `./shots/...` 与 `./audio/...`、`<library><event><project><sequence><spine>` 顺序挂载每镜视频或静帧 `<asset-clip>` / `<video>` 及嵌套对白音频通道，XML 转义安全）。
   - 用 `asyncio.to_thread` 写入 `STATIC_DIR / "exports" / f"editorial_{project.id}_{uuid4().hex[:8]}.zip"`，返回 `/static/exports/...`。
2. 在 `backend/app/api/v1/routes/export.py`：
   - `_run_export_task` 增加 `elif format == "editorial": download_url = await _export_service.export_editorial_pack(project=project, shots=shots, characters=characters)`。
   - 新增 `POST /projects/{project_id}/export/editorial-pack` 路由（校验项目与至少 1 个分镜，复用后台任务与 WS `export_completed` 事件）。
3. 提交：`feat(export): add editorial asset pack with srt and fcpxml v1.9`。

**验证者：** 独立 `oracle` subagent 校验 FCPXML v1.9 结构合法性（有理数时间分数 `s`、XML 转义、ZIP 路径防穿越）。

---

### 任务 4（WT-4）：Frontend 分镜角色绑定、重画微调、视频版本对比与剪辑包入口

**涉及：**
- 改：`frontend/app/services/api.ts`
- 改：`frontend/app/features/comic-workflow/inspector/PropertiesSection.tsx`
- 改：`frontend/app/features/comic-workflow/inspector/GenerationSection.tsx`
- 改：`frontend/app/components/panels/versionDiff.ts`
- 改：`frontend/app/components/panels/VersionCompareDrawer.tsx`
- 改：`frontend/app/components/layout/StudioControls.tsx`
- 改：`frontend/app/features/workbench/ProjectWorkbench.tsx`
- 改：`frontend/app/hooks/applyWsEvent.ts`

**步骤：**
1. `services/api.ts`：
   - `shotsApi.regenerate(id, type, feedback?)` 请求体带上非空 `feedback`。
   - `exportApi.triggerEditorialPack(projectId)` 调用 `POST /api/v1/projects/${projectId}/export/editorial-pack`。
2. `PropertiesSection.tsx` (`ShotDraftForm`)：
   - 使用 `useQuery({ queryKey: ["characters", shot.project_id], queryFn: () => projectsApi.getCharacters(shot.project_id) })` 读取角色列表。
   - 增加「出场角色」可多选芯片组（切换 `character_ids`，支持全部取消即空镜），纳入 `dirty` 判断并在保存时随 `shotsApi.update` 提交 `character_ids`。
3. `GenerationSection.tsx`：
   - 为分镜节点增加单行轻量输入框「微调指令（可选，仅作用于本镜重画/重拍）」，调用 `shotsApi.regenerate(shot.id, type, feedback)`，成功后清空输入。
4. `versionDiff.ts` & `VersionCompareDrawer.tsx`：
   - `DISPLAY_FIELDS` 增加 `character_ids`，`COMPARE_FIELDS` 增加 `video_url`。
   - `LABELS` 增加 `video_url: "视频"`、`character_ids: "出场角色 ID"`；`diffText` 处理 `video_url`。
   - `VersionColumn` 在 `snapshot?.video_url` 存在时渲染 `<video src={videoUrl} controls preload="metadata" className="mt-1.5 aspect-video w-full rounded-sm border ..." />`，支持双栏直接预览两版视频。
5. `StudioControls.tsx`、`ProjectWorkbench.tsx`、`applyWsEvent.ts`：
   - `StudioControlsProps` 增加 `onExportEditorial?: () => void`，溢出菜单增加「导出剪辑包 (ZIP + FCPXML)」。
   - `ProjectWorkbench.tsx` 抽取出通用 `runExport(trigger, pendingMsg, doneMsg)`，接入 `handleExportEditorial` 并传给 `StudioControls`。
   - `applyWsEvent.ts` 中 `export_completed` 识别 `editorial` 格式文案为「剪辑素材包」。
6. 提交：`feat(frontend): add shot cast chips, regen feedback, video diff and editorial export`。

**验证者：** 独立 `reviewer` subagent 逐文件核对 TypeScript 类型签名、React Query key 一致性与 props 透传完整性。
