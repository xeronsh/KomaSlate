# ADR-0012: 非破坏性分镜重规划与通用 NLE 剪辑包导出

Status: accepted · 2026-04-17

## 背景
1. `engine/src/agents/index.ts:applyShotPlan` 仍沿用早期全量 `deleteShot` 重建逻辑，导致分镜阶段重规划会抹掉未改动或已批准镜头的媒体产物与版本链路。
2. 单镜头重生成缺少微调指令（`feedback`）入口，空镜（无角色）被 `_validate_shot_approval_ready` 拦截无法批准，回滚未递增 `revision` 也未同步 `shotcharacterbinding`。
3. 剪映 6.0+ 已加密 `draft_content.json`，维护私有逆向格式脆弱且跨平台受限，而创作者仍需将分镜产物导入剪映/DaVinci/Premiere/Final Cut 精剪。

## 决策
1. **分镜计划增量合并**：`applyShotPlan` 对齐 `applyCharacterPlan`，保护 `preserve_ids.shots` 与已批准镜头（非 `forceRegenerate`），命中已有 `id` 时先写 `artifactversion` 再通过 CAS `updateShot` 原地更新。
2. **单镜微调与回滚闭环**：`RegenerateRequest.feedback` 经 `TargetedRunSpec.user_feedback` 透传至 Engine 现有 `ctx.userFeedback`；移除批准时的角色非空硬门槛；`VersionService.rollback` 同步 `shotcharacterbinding` 并递增 `revision`。
3. **通用剪辑包替代私有草稿**：新增 `editorial-pack` 导出（编号 PNG/MP4/TTS + `subtitles.srt` + `manifest.json` + FCPXML v1.9 `timeline.fcpxml`），放弃剪映私有草稿直出。

## 后果
- 保留 15 阶段确定性流水线与既有 SQLite schema（零迁移），创作者可局部重画、对比视频版本、回退镜头并一键导出标准 NLE 时间线。
- 剪映用户采用「导入编号素材包 + SRT」工作流；DaVinci / Premiere / Final Cut 用户直接导入 `timeline.fcpxml`。
