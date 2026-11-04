---
id: spec.non-destructive-storyboard
type: spec
title: 非破坏性分镜编辑与通用剪辑包导出
status: active
---

## 为什么存在
创作者重画或重规划单个镜头时，已批准的镜头与资产不得被静默清空，且产物需能无损交接至专业 NLE 剪辑器。

## 边界与不变量
- **负责**：分镜重规划保活、单镜定向微调指令透传、角色绑定与空镜批准、回滚同步与版本号递增、ZIP + FCPXML v1.9 剪辑包导出。
- **不负责**：重度 Web 时间线剪辑器、私有加密剪映 6.0+ 草稿格式、重写 15 阶段确定性流水线。
- **不变量**：
  1. `approved_at != null && approval_version > 0` 的已批准镜头在非 `forceRegenerate` 重规划中严禁删除或覆盖。
  2. 回滚必须递增 `revision` 并同步 `shotcharacterbinding` 关联表，保持乐观锁与绑定一致。
  3. FastAPI 仅做校验、持久化、导出与网关转发，编排决策唯一归属 `engine/`（ADR 0008）。

## 对外契约
- `POST /api/v1/shots/{id}/regenerate`：新增可选 `feedback`，经 `TargetedRunSpec.user_feedback` 透传至 Engine。
- `POST /api/v1/projects/{id}/export/editorial-pack`：异步生成含编号图/视频/TTS、`subtitles.srt`、`manifest.json` 与 `timeline.fcpxml` 的 ZIP 包。

## 代码与决策
- 代码：`engine/src/agents/index.ts`、`backend/app/api/v1/routes/shots.py`、`backend/app/services/version_service.py`、`backend/app/services/export_service.py`、`frontend/app/features/comic-workflow/`
- 决策：[ADR-0012](../adr/0012-non-destructive-storyboard-editorial-pack.md) / [0012](../decisions/0012-non-destructive-storyboard-editorial-pack.md)
