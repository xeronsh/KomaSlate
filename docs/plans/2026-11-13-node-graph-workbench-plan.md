# KomaSlate Option 3 (Node-Graph & Protocol Workbench) 架构治理与实施全景主计划

**文档版本**：v1.0.0 (Master Architecture & Implementation Specification)  
**发布日期**：2026-11-13  
**目标定位**：全面落地 Option 3 节点终端工作台（Node-Graph & Protocol Workbench），彻底清零 UI/UX、后端与引擎侧全部 36 项审计缺陷，构建双向 MCP 协议栈与统一 CLI 生态，建立单源契约治理与高并发 SQLite WAL 事务体系。  
**硬性架构约束**：严格遵从 `AGENTS.md` 五大不可协商不变量。

---

## 目录

1. [执行摘要与五大架构不变量](#1-执行摘要与五大架构不变量)
2. [全量缺陷审计与治理矩阵 (36 项缺陷)](#2-全量缺陷审计与治理矩阵-36-项缺陷)
   - 2.1 [前端 UI/UX 与动效审计治理矩阵 (AUD-UI-01 ~ AUD-UI-16)](#21-前端-uiux-与动效审计治理矩阵-aud-ui-01--aud-ui-16)
   - 2.2 [后端 FastAPI 与存储并发治理矩阵 (P0-1 ~ P0-4, P1-1 ~ P1-4, P2-1 ~ P2-3)](#22-后端-fastapi-与存储并发治理矩阵-p0-1--p0-4-p1-1--p1-4-p2-1--p2-3)
   - 2.3 [生成引擎 Sidecar 与 Agent Runtime 治理矩阵 (P0-5 ~ P0-8, P1-5 ~ P1-9)](#23-生成引擎-sidecar-与-agent-runtime-治理矩阵-p0-5--p0-8-p1-5--p1-9)
3. [详细技术规格：前端节点终端工作台 (Option 3)](#3-详细技术规格前端节点终端工作台-option-3)
   - 3.1 [基础 UI 原语收口架构 (CVA + Radix + Sonner + cmdk)](#31-基础-ui-原语收口架构-cva--radix--sonner--cmdk)
   - 3.2 [混合编排 SVG Bezier 有向图画布与数学导引](#32-混合编排-svg-bezier-有向图画布与数学导引)
   - 3.3 [三阶语义视口缩放 (Semantic LOD) 规范](#33-三阶语义视口缩放-semantic-lod-规范)
   - 3.4 [底部三栏协议抽屉规格 (A/B Wipe, Gate & Queue, Console)](#34-底部三栏协议抽屉规格-ab-wipe-gate--queue-console)
   - 3.5 [全局协议枢纽 (#hubDialog) 交互规格](#35-全局协议枢纽-hubdialog-交互规格)
   - 3.6 [零运行时 React Bits Pro 动效设计落地](#36-零运行时-react-bits-pro-动效设计落地)
4. [详细技术规格：后端高并发、持久化与自愈机制](#4-详细技术规格后端高并发持久化与自愈机制)
   - 4.1 [SQLite WAL `BEGIN IMMEDIATE` 并发锁消除规范](#41-sqlite-wal-begin-immediate-并发锁消除规范)
   - 4.2 [事务型 Outbox 事件流与统一推送引擎](#42-事务型-outbox-事件流与统一推送引擎)
   - 4.3 [对话助手待确认卡持久化与孤立调用自愈算法](#43-对话助手待确认卡持久化与孤立调用自愈算法)
   - 4.4 [Alembic 迁移脚本规范 (`0036_remediation_persistence_concurrency.py`)](#44-alembic-迁移脚本规范-0036_remediation_persistence_concurrency)
   - 4.5 [全局乐观锁 CAS 控制与下发透传](#45-全局乐观锁-cas-控制与下发透传)
   - 4.6 [租约恢复、心跳对账与子进程组生命周期管理](#46-租约恢复心跳对账与子进程组生命周期管理)
   - 4.7 [分镜关键帧链条级联失效与审查状态恢复](#47-分镜关键帧链条级联失效与审查状态恢复)
5. [详细技术规格：双向 MCP、独立 CLI 与契约治理体系](#5-详细技术规格双向-mcp独立-cli-与契约治理体系)
   - 5.1 [Engine 侧出向 MCP 客户端规范 (`engine/src/mcp/`)](#51-engine-侧出向-mcp-客户端规范-enginesrcmcp)
   - 5.2 [网关层入向 MCP 服务端规范 (`komaslate mcp serve`)](#52-网关层入向-mcp-服务端规范-komaslate-mcp-serve)
   - 5.3 [统一独立 CLI 架构 (`komaslate run/inspect/mcp/dev/media`)](#53-统一独立-cli-架构-komaslate-runinspectmcpdevmedia)
   - 5.4 [单源多端契约治理与 CI 强校验流水线](#54-单源多端契约治理与-ci-强校验流水线)
6. [实施里程碑、依赖拓扑与降级回滚预案](#6-实施里程碑依赖拓扑与降级回滚预案)
   - 6.1 [五阶段实施里程碑 (M1 ~ M5)](#61-五阶段实施里程碑-m1--m5)
   - 6.2 [严格执行依赖拓扑图](#62-严格执行依赖拓扑图)
   - 6.3 [风险矩阵与降级回滚触发机制](#63-风险矩阵与降级回滚触发机制)
7. [全量独立可执行核验指标 (Verification Rubrics)](#7-全量独立可执行核验指标-verification-rubrics)
   - 7.1 [前端与 UI 动效核验指标 (UI-01 ~ UI-06)](#71-前端与-ui-动效核验指标-ui-01--ui-06)
   - 7.2 [后端 FastAPI 与网关核验指标 (BE-01 ~ BE-10)](#72-后端-fastapi-与网关核验指标-be-01--be-10)
   - 7.3 [引擎工作流与 Agent Runtime 核验指标 (ENG-01 ~ ENG-10)](#73-引擎工作流与-agent-runtime-核验指标-eng-01--eng-10)

---

## 1. 执行摘要与五大架构不变量

### 1.1 Option 3（节点终端工作台）架构定位
KomaSlate 是一套从“故事想法 → 漫剧成片”的长链路确定性生成系统。Option 3 将原先割裂的三栏瀑布卡片升级为**混合编排节点终端工作台**：
- **上部画布（58% Viewport）**：采用轻量级 SVG Cubic Bezier 有向图，融合六类关键执行实体（确定性工作流阶段 `Stage`、人类审批门 `Gate`、对话智能体 `Agent`、外部模型协议 `MCP Outbound`、本地媒体处理 `CLI Runner`、北向控制网关 `Inbound MCP Server`），配合三阶语义视口缩放（Semantic LOD），从根源上化解 40% 缩放下的文字虚焦与操作盲区。
- **底部抽屉（42% Viewport）**：采用三栏并行协议操作台，包含带 CAS 乐观锁版本回退的 **A/B Wipe 视觉重绘对比器**、严格人机隔离的 **审批门与 Agent 任务队列**，以及毫秒级流式响应的 **MCP JSON-RPC & CLI 协议终端**。

```
+-----------------------------------------------------------------------------------------+
|                                    KomaSlate TopBar                                     |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|                    Hybrid Node-Graph SVG Bezier Canvas (58% Height)                     |
|                                                                                         |
|   [R0: Story] ---> [R1: Gate] ---> [R2: AgentCore] ---> [R3: MCP Inpaint] ---> [R4: MCP] |
|        │                               │                      │                         |
|        └───────────────────────────────┴──────────────────────┴───> [R3: CLI Dreamina]   |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
|                       Bottom 3-Pane Protocol Workbench (42% Height)                     |
+------------------------------------+--------------------------------+-------------------+
| Pane 1: A/B Wipe Comparator        | Pane 2: Decoupled Gate & Queue | Pane 3: MCP & CLI |
| - Dynamic Clip-Path Splitter       | - [HUMAN-ONLY] Gate Card       | - Virtual Log Stream|
| - CAS `expected_revision` Revert   | - `pi-agent-core` Thoughts     | - JSON-RPC Filter |
+------------------------------------+--------------------------------+-------------------+
```

### 1.2 严格坚守的五大架构不变量（`AGENTS.md`）

1. **FastAPI 不做 Orchestration**：
   FastAPI 的定位仅限于 **Product Backend** 与 **Engine 的北向网关**。负责用户鉴权、数据校验、持久化 ownership、HTTP/WSS 契约，以及作为媒体处理 helper。**严禁在 FastAPI 路由或服务中编写控制“下一步执行什么阶段”的编排循环。**
2. **WorkflowRunner 不假装 Agent**：
   15 阶段漫剧流水线本质上是确定性有限状态机（FSM）。阶段的拓扑推进、检查点恢复、失败重试、阶段门禁由 `engine/src/pipeline/runner.ts` 确定性驱动，**严禁将其强行 Agent 化**。
3. **Agent Loop 不负责确定性业务流程**：
   系统唯一的 Agent Runtime 是项目对话助手（`engine/src/agent/`，基于 `pi-agent-core`）。其工具仅调用 Product API；写操作必须触发待确认机制；**人类审批门只能由真实人类操作，Agent 绝无权限自批或绕过审批门**。
4. **SQLite 不假装 Distributed Database**：
   系统坚持单文件 SQLite（`backend/data/komaslate.db`，开启 WAL 模式）。FastAPI 与 Node Engine 编入同一容器，通过文件系统共享同一 SQLite。禁止引入分布式事务假设；通过显式锁协议消除并发冲突。
5. **WS 不假装 State Store**：
   **DB 是唯一真相，事件是通知，WS 是传输，Query 是投影。** 彻底消除通过 WebSocket 内存裸推非持久化数据的行为；所有事件必须进入 Transactional Outbox 表进行持久化保序。

### 1.3 实施纪律与工程自检规范
1. **默认不跑测试，改完即止**：严格遵循仓内开发纪律（`AGENTS.md`），所有开发过程默认不执行 `pytest` / `vitest` / `pnpm build` / `tsc` / `ruff`，仅在用户明确发出指令时才运行。
2. **不新建测试文件，自检用一次性命令**：严格遵守用户全局规则（**“不新建测试文件；自检用一次性命令”**）。下游实施 Agent 进行验证时，应当优先拓展既有测试套件（如 `backend/tests/test_api/test_generation.py`、`engine/tests/chat-agent.test.ts`），或使用一次性行内脚本（`uv run python -c "..."`、`pnpm exec tsx -e "..."`、`node -e "..."`），严禁在仓内新建散落的临时测试文件。
3. **零业务代码修改红线**：规划与方案审计阶段严禁改动任何业务代码，全部规格与治理代码仅作为实施基准呈现在本计划文档中。

---

## 2. 全量缺陷审计与治理矩阵 (36 项缺陷)

### 2.1 前端 UI/UX 与动效审计治理矩阵 (AUD-UI-01 ~ AUD-UI-16)

| 编号 | 严重度 | 缺陷归类 | 精确代码定位 (`file:line`) | 根因深度剖析 | 确定性技术治理方案 |
|:---:|:---:|:---:|:---|:---|:---|
| **AUD-UI-01** | Critical | 组件原语 | `frontend/app/components/ui/ConfirmModal.tsx:79-96` | 绕过通用 `Button`，使用裸 `<button>`，并在 82 行混写 `border-transparent` 与 `border border-line-strong` 互斥类名。 | 统一重构为 CVA `Button`：取消操作采用 `variant="ghost" size="sm"`，确认操作采用 `variant="danger"|"primary"`，消除裸标签与样式冲突。 |
| **AUD-UI-02** | Critical | 弹窗合规 | `frontend/app/features/comic-workflow/inspector/GenerationSection.tsx:194` | 分镜或角色删除时，直接调用浏览器阻塞式原生 `window.confirm(deleteMessage(node))`。 | 废除原生方法，统一绑定受控的 `ConfirmModal` 状态，触发操作时弹出无障碍对话框并配合 Sonner 反馈。 |
| **AUD-UI-03** | Critical | 弹窗合规 | `frontend/app/components/settings/ConfigInput.tsx:39` | 配置值拉取失败时，调用原生阻塞式 `alert("获取真实值失败，请检查网络连接")`。 | 替换为统一全局通知 `toast.error(error.message)`，通过 Sonner 自动归集与展示。 |
| **AUD-UI-04** | Critical | WS 稳定性 | `frontend/app/hooks/useWebSocket.ts:177-216` | 重连失败时向全局抛出 `duration: 0` 的持久化错误 Toast，并在重试轮询中无节制堆叠 Warning Toast，引发 Toast 风暴。 | 接入 Sonner 的固定 ID 机制：绑定 `id: "ws-connection-status"`，状态在“重连中/已断开/已恢复”之间就地原地更新，杜绝堆叠。 |
| **AUD-UI-05** | High | 按钮规范 | `frontend/app/components/ui/Button.tsx:24-30` | 尺寸阶梯仅定义 `sm` (`h-8`), `md` (`h-9`), `lg` (`h-11`)，缺失紧凑型 `xs` (`h-7`)，导致 6 处调用点出现 `!h-8 !px-2` 暴力覆盖。 | 在 CVA 中增加 `size: { xs: "h-7 touch-target-dense gap-1 px-2 py-0.5 text-xs" }`，全量剔除各调用点的 `!` 强制样式覆盖。 |
| **AUD-UI-06** | High | 死类残留 | `frontend/app/components/panels/HistoryDrawer.tsx:86,266`<br>`frontend/app/pages/ProjectsPage.tsx:225,413` | DaisyUI 已从 Tailwind 中清除，但代码仍残留 `checkbox checkbox-xs/sm`，导致复选框回退为系统原生未样式化外观。 | 废除死类名，基于 `@radix-ui/react-checkbox` 封装全局 `ui/Checkbox.tsx`，由 `tokens.css` 驱动触感复选框视觉。 |
| **AUD-UI-07** | High | 表单分裂 | `frontend/app/features/comic-workflow/inspector/fields.tsx:138-256` | 在抽屉内私自维护局部 `TextInput`、`SelectInput`、`NumberInput`，丢失全局校验与 ARIA 状态联动。 | 废弃 `fields.tsx` 局部输入组件，统一收口至 `ui/Input.tsx`、`ui/Select.tsx`、`ui/Textarea.tsx` 并由 `ui/Field.tsx` 包裹。 |
| **AUD-UI-08** | High | 标签页可达性 | `SettingsModal.tsx:268-317`<br>`AgentPanel.tsx:66-108`<br>`WorkflowInspector.tsx:91-105` | 三处标签页各自实现，缺乏统一的键盘方向键导航、Roving Tabindex 支持，未声明 WAI-ARIA `role="tablist"`。 | 基于 `@radix-ui/react-tabs` 封装无障碍 `ui/Tabs.tsx`，支持键盘无缝巡检与底边滑块平滑指示。 |
| **AUD-UI-09** | High | 组合框体验 | `frontend/app/components/settings/ProviderPresetPanel.tsx:329-380` | 采用原生 `<datalist>`，在深色模式下背景失真，且不支持拼音模糊搜索与模型元数据卡片预览。 | 引入 `cmdk`（通过 `React.lazy` 异步 Chunk 加载），封装为统一的 `ui/Combobox.tsx`，支持分类与快捷键检索。 |
| **AUD-UI-10** | High | 视口盲区 | `FlowWorkflowView.tsx:67-89`<br>`WorkflowCards.tsx:323-742` | 三栏固定布局总宽达 1618px，在 1440p 屏幕展开侧栏时被迫以 40% 缩放呈现，字体缩至 4.9px-5.7px 噪点，严重不可辨识。 | 实施 3 阶语义缩放 (Semantic LOD)：宏观态 (<0.5) 自动收缩为胶囊状态徽章；中观态 (0.5-1.2) 标态卡片；微观态 (>=1.2) 展开端口。 |
| **AUD-UI-11** | Medium | 提示冒泡 | `fields.tsx:74`<br>`StudioControls.tsx:238` | 禁用态按钮外部嵌套 `<span title={...}>` 补丁以捕获 Hover 事件，导致响应延迟高达 800ms 且风格与系统脱节。 | 引入 `@radix-ui/react-tooltip`，在应用顶层挂载全局 Provider，统一 250ms 触发延时与纸质深色卡片渲染。 |
| **AUD-UI-12** | Medium | 菜单定位 | `TopBar.tsx:22-127`<br>`CardContextMenu.tsx:26-74` | `TopBar` 裸绑 `mousedown`；右键菜单硬编码尺寸并在 63 行滥用 `setTimeout(onClose, 0)` hack 规避事件穿透。 | 引入 `@radix-ui/react-popover` 与 `@radix-ui/react-context-menu`，由 Popper 原语自动处理视口碰撞翻转与焦点锁定。 |
| **AUD-UI-13** | Medium | 开关与单选 | `ConfigInput.tsx:53-78`<br>`ProviderPresetPanel.tsx:162-212` | 手写 `role="switch"` 与 `role="radiogroup"`，缺乏焦点圈与键盘 Space/Enter 切换支持。 | 统一引入 `@radix-ui/react-switch` 与 `@radix-ui/react-radio-group`，遵循项目 Doodle 手绘纸质设计规范。 |
| **AUD-UI-14** | Medium | 设计规则遵从 | `PreviewModals.tsx:79-88`<br>`globals.css:531-537`<br>`Card.tsx:36` | `PreviewModals` 内联裸写 Heroicons SVG；CSS 保留已被废弃的 `#FFDE59` 黄色手绘下划线 `.underline-sketch`。 | 统一将所有图标重构为 `SvgIcon`；彻底清除 `.underline-sketch` 样式，严格通过 `designContract.test.ts` 门禁。 |
| **AUD-UI-15** | Medium | 状态管理隔离 | `ProjectWorkbench.tsx:109-123`<br>`WorkflowInspector.tsx:47` | 布局面板的折叠与标签状态分散在各页面 `useState` 中，且仅在初次挂载时读取一次 `innerWidth`。 | 将抽屉与侧栏折叠状态统一持久化至 `useEditorStore`，并通过 `ResizeObserver` 动态响应视口宽度变化。 |
| **AUD-UI-16** | Medium | 审批门劫持 | `frontend/app/features/workbench/PromptBar.tsx:50-78` | 模式切换至 `yolo` 会静默触发审批门通过；而在审批门停留期间，用户在输入框的所有文字被强制篡改为修改意见。 | 解耦人工审批门与智能体对话框：审批门独立为固定决策卡片，PromptBar 始终保持与 `pi-agent-core` 的自由交流。 |

---

### 2.2 后端 FastAPI 与存储并发治理矩阵 (P0-1 ~ P0-4, P1-1 ~ P1-4, P2-1 ~ P2-3)

| 编号 | 严重度 | 缺陷归类 | 精确代码定位 (`file:line`) | 根因深度剖析 | 确定性技术治理方案 |
|:---:|:---:|:---:|:---|:---|:---|
| **P0-1** | Critical | 资源锁死 | `backend/app/services/run_lifecycle.py:83-92, 137-153` | `create_local_run` 漏调 `ensure_engine_running`；拉起 503 报错后在数据库留下僵尸 `queued` 记录；`assert_resource_idle` 查到后抛 409，永久锁死局部重绘。 | 在建 run 前强制 `await ensure_engine_running()`；若失败，在同一事务内将该 run 置为 `failed` 并释放锁，严禁残留无租约的活动 run。 |
| **P0-2** | Critical | 并发死锁 | `backend/aiosqlite/__init__.py:230-238`<br>`backend/app/db/session.py:39-46` | aiosqlite 未配置 `isolation_level=None`；SQLAlchemy 默认使用 `DEFERRED` 事务；在“先读后写”时锁升级失败，SQLite 抛出 `database is locked` 且忽略 `busy_timeout`。 | aiosqlite 显式配置 `isolation_level=None`；`session.py` 监听 `begin` 事件执行 `BEGIN IMMEDIATE`；设置 `PRAGMA synchronous=NORMAL` 与 `busy_timeout=15000`。 |
| **P0-3** | Critical | 配置覆盖 | `backend/app/db/session.py:105-107`<br>`backend/app/services/config_service.py:243-309` | 启动时 `ensure_provider_configs_initialized` 将默认值硬写入 `configitem` 表；重启后 DB 内旧配置反向覆盖宿主机显式环境变量与 `.env`。 | 重新确立优先级契约：`进程 Env > .env > DB configitem > 默认配置`；移除启动时强制刷写默认配置到 DB 的逻辑。 |
| **P0-4** | Critical | 路径计算 | `backend/app/services/consistency_eval.py:307-318` | 计算本地静态目录时滥用 `Path(__file__).resolve().parents[3]`，少算两级目录，导致本地 `/static/` 路径解析为 None，一致性评分恒为 0。 | 统一调用标准 helper `file_cleaner.get_local_path` 准确解析至 `backend/app/static/`，并执行路径穿越安全校验。 |
| **P1-1** | High | 事件分裂 | `backend/app/main.py:300-374`<br>`backend/app/ws/manager.py:120-152` | Engine 事件通过 `engine_run_events` 游标推；FastAPI 路由中 15+ 处直接调用 `ws_manager.send_event` 内存广播。断线重连必丢事件，且无连接锁存在帧乱序。 | 实施 Transactional Outbox：路由业务变更必须通过 `emit_project_event` 与领域数据在同一事务落库；统一由 tailer 推送带递增 `event_id` 的事件。 |
| **P1-2** | High | 安全漏洞 | `backend/app/api/deps.py:31-38`<br>`routes/config.py:194`<br>`routes/projects.py:299-315` | 1) `ADMIN_TOKEN` 为空时 `require_admin` 直接放行；2) SSRF 检查漏网 `*_endpoint` 覆盖项且无私网拦截；3) 上传允许 `image/svg+xml` 同源落盘致存储型 XSS。 | 1) `ADMIN_TOKEN` 为空时强制拒绝访问；2) 校验所有 endpoint 并拦截私网 IP；3) 上传强校验 Magic Number，彻底禁止 SVG 格式，限制流大小。 |
| **P1-3** | High | 导出崩溃 | `backend/app/services/export_service.py:203, 428, 865` | 1) ReportLab 未转义 XML 字符导致 SAX 崩溃；2) ZIP 打包将全量视音频读入内存字典引发 OOM；3) Webtoon 图像处理阻塞异步主循环。 | 1) 全量执行 `xml.sax.saxutils.escape()`；2) 采用分块流式写入临时 ZipFile；3) 将 Pillow 拼接与缩放任务通过 `asyncio.to_thread` 卸载至工作线程池。 |
| **P1-4** | High | 进程孤儿 | `backend/app/services/engine_client.py:104-179` | `start_new_session=False` 导致 Backend 退出时 Engine 残留在 18766 端口；`httpx.AsyncClient` 每次请求重复建连；`engine.log` 无轮转无上限。 | 开启 `start_new_session=True` 隔离进程组；记录 `engine.pid`；关闭时发送 `SIGTERM` 超时 `SIGKILL` 清理进程树；复用单例 Client；日志限制最大 50MB。 |
| **P2-1** | Medium | 媒体性能 | `engine/src/backend-worker.ts:126-175`<br>`backend/app/services/engine_media_cli.py:162-169` | 媒体处理频繁冷启动子进程；Base64 传输图片耗内存；每行请求重复执行 `asyncio.run()` 重建事件循环。 | 引入常驻 Worker 进程池；全量改造为文件系统本地物理路径（Zero-Copy）；子进程内部运行长期单一异步事件循环。 |
| **P2-2** | Medium | 模型弹性 | `engine/src/llm.ts:518-559, 579-618` | `response_format: json_object` 仅对 DeepSeek 开启；缺乏应对 429/5xx 的瞬态指数退避重试；评分结构解析缺失静默吞错。 | 拓展标准 JSON Schema 模式兼容各主流供应商；引入有限指数退避重试（带 Jitter）；若缺少关键字段触发一次自动修复提示。 |
| **P2-3** | Medium | 读取副作用 | `backend/app/api/v1/routes/runs.py:390-428` | `GET /projects/{id}/runs/current` 在 HTTP GET 读取时隐式执行 `_reconcile_active_candidate` 写库与版本回退。 | 严格遵循 HTTP 语义：GET 端点保持幂等只读；核销与版本清理下沉为独立的显式 POST 维修指令或后台租约巡检定时器。 |

---

### 2.3 生成引擎 Sidecar 与 Agent Runtime 治理矩阵 (P0-5 ~ P0-8, P1-5 ~ P1-9)

| 编号 | 严重度 | 缺陷归类 | 精确代码定位 (`file:line`) | 根因深度剖析 | 确定性技术治理方案 |
|:---:|:---:|:---:|:---|:---|:---|
| **P0-5** | Critical | 租约误杀 | `engine/src/shared-db.ts:609-610`<br>`backend/app/db/session.py:134` | Python 启动将过期 run 标为 `"Execution lease expired; run is safe to resume"`；Engine 重夺查询硬编码匹配 `missing or expired`，导致重夺失败定时器误杀任务。 | 统一两端文本契约为 `"Execution lease expired"`；SQL 重夺语句改为通配模糊匹配 `error LIKE '%Execution lease%'`，确保重启/唤醒后安全接管。 |
| **P0-6** | Critical | 审批门失联 | `engine/src/shared-db.ts:609-616`<br>`engine/src/pipeline/runner.ts:1160-1175` | `reclaimRunLease` 的 SQL 只允许状态为 `queued` 或 `running`。停留在人工审批门超过 2 分钟时租约过期，Engine 无法重夺，直接调用 `requestCancel` 强制中止。 | 在 SQL 允许重夺的状态集中显式增加 `'waiting_for_approval'`，确保人工审批门处于无限期等待时，其租约能被 Engine 稳定平滑续租。 |
| **P0-7** | Critical | 会话崩溃 | `engine/src/agent/index.ts:150, 274`<br>`backend/app/models/chat_message.py:7-23` | 写操作确认卡纯放内存；`message_end` 立即落库含 `toolUse` 的消息；若在确认前重启，内存卡片丢失，残留孤立 `toolUse`，下次加载由于缺失 `toolResult` 触发模型 HTTP 400，会话瘫痪。 | 1) 新建 `chat_confirmation` 表持久化确认卡；2) 启动与加载时执行孤立调用自愈（Self-healing transcript repair），自动补齐已取消的 `toolResult`。 |
| **P0-8** | Critical | 设定丢失 | `engine/src/agents/index.ts:278, 350-380`<br>`engine/src/prompts.ts:14` | `runOutline` 产出的 `visual_bible` 单独存入库中，但在 `PlanAgent` 组装 Payload 时仅传入了 `story_outline`，未透传 `visual_bible`，导致下游分镜完全丢失全局美术与人物形象设定。 | 修改 `planBasePayload`，显式提取并注入 `project.visual_bible` 至 Prompt 上下文；若字段为空则优雅回退，确保全局视觉设定严密传导。 |
| **P1-5** | High | 并发覆盖 | `engine/src/agent/tools.ts:272-299`<br>`backend/app/api/v1/routes/shots.py:110` | 对话助手工具 `update_shot` 与 `update_character` 在调用后端 `PATCH` 时未透传 `expected_revision`，静默覆写用户在画布右侧手动调整的内容。 | 修改 Agent Tools 实现：在调用 `PATCH` 前读取最新 revision，调用时强制传递 `expected_revision`；若遇 409 则向智能体反馈冲突并要求其重新读取。 |
| **P1-6** | High | 恢复失真 | `engine/src/pipeline/runner.ts:539, 588-608`<br>`engine/src/agents/index.ts:92` | `critiqueRounds` 与 `critiqueNotes` 纯保存在内存变量中；服务重启或崩溃恢复后轮次清零（可能击穿上限陷入死循环），上一轮评审指导意见彻底丢失。 | 将审查轮次与评审指导意见序列化存入 `engine_checkpoints` 表的 `stage_critique_state` 记录；恢复时完整反序列化，严格受制于最大重绘轮次。 |
| **P1-7** | High | 级联失效缺失 | `engine/src/invalidation.ts:14-25`<br>`engine/src/agents/index.ts:758-788` | `invalidation.ts` 仅计算阶段跳转未做数据失效；关键帧串联（Keyframe Chaining）在第 $k$ 镜重绘后，未将依赖其画面的第 $k+1 \dots N$ 镜标记为失效。 | 落地级联失效引擎：当分镜 $k$ 发生重绘时，递归遍历分镜连续性链条，将下游未锁定的分镜 `review_status` 标为 `unchecked` 并通知前端高亮。 |
| **P1-8** | High | 上下文截断错位 | `engine/src/agent/index.ts:104-109` | 上下文截断逻辑在未能匹配到 `user` 角色时直接硬切最后 40 条消息，极易从 `toolUse` 与其对应的 `toolResult` 中间切断，导致报文格式非法抛 400。 | 重构消息窗口滑动算法：以“工具调用对”为不可分割的原子单元，截断边界强制对齐至合法的消息轮次起点，严禁劈裂工具消息对。 |
| **P1-9** | High | 实体无乐观锁 | `backend/app/models/agent_run.py:11-60`<br>`backend/app/models/asset.py:9-21` | `Project`、`Character`、`Shot` 已支持 revision CAS，但 `AgentRun`（承载审批门状态）与 `Asset` 仍缺少 `revision` 列，存在控制指令并发覆盖风险。 | 通过 Alembic 迁移脚本为 `agentrun` 与 `asset` 表补充 `revision` 字段；在审批门操作与取消运行接口中开启版本校验。 |

---

## 3. 详细技术规格：前端节点终端工作台 (Option 3)

### 3.1 基础 UI 原语收口架构 (CVA + Radix + Sonner + cmdk)

#### 1) 依赖选型与包体积红线控制
严格受控于 `frontend/scripts/check-bundle-budget.mjs`（总 JS gzip $\le 250$ KB，单 Chunk $\le 150$ KB）：
- `class-variance-authority`: `^0.7.1` (~1.2 KB gzip) —— 按钮与输入框变体引擎。
- `@radix-ui/react-*` 系列无样式行为原语：
  - `react-tabs` (~2.8 KB), `react-tooltip` (~2.4 KB), `react-popover` (~3.2 KB), `react-context-menu` (~4.1 KB), `react-switch` (~1.9 KB), `react-checkbox` (~2.0 KB), `react-radio-group` (~2.2 KB), `react-slider` (~2.5 KB).
- `sonner`: `^1.7.1` (~9.2 KB gzip) —— 彻底替代有缺陷的手写 `toast.store.ts`。
- `@formkit/auto-animate`: `^0.8.2` (~2.0 KB gzip) —— 零配置 DOM 列表微动效。
- `cmdk`: `^1.0.4` (~14.6 KB gzip) —— **严格使用 `React.lazy()` 独立分割成异步 Chunk**，不增加首屏初始负载。

#### 2) CVA 统一规范：`Button.tsx` (含 `xs` 阶梯)
在 `frontend/app/components/ui/Button.tsx` 中完整实现：
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import React from "react";

export const buttonVariants = cva(
  "btn-doodle inline-flex items-center justify-center font-sans select-none transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "btn-tactile bg-primary text-primary-content border-primary hover:bg-primary-hover active:bg-primary-pressed shadow-button",
        secondary: "btn-tactile bg-surface text-ink border-border-strong hover:bg-paper-200 active:bg-paper-300",
        ghost: "bg-transparent border-transparent text-ink hover:bg-paper-200 active:bg-paper-300 shadow-none",
        danger: "btn-tactile bg-error text-error-content border-error hover:bg-error/90 active:bg-error/80",
        outline: "bg-transparent border-line text-ink hover:bg-paper-100",
      },
      size: {
        xs: "h-7 touch-target-dense gap-1 px-2 py-0.5 text-xs rounded-sm",
        sm: "h-8 touch-target-dense gap-1 px-2.5 py-1 text-sm rounded",
        md: "h-9 touch-target-dense gap-1.5 px-3.5 py-1.5 text-base rounded-md",
        lg: "h-11 touch-target gap-2 px-5 py-2 text-lg rounded-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={buttonVariants({ variant, size, className })} {...props} />
  )
);
Button.displayName = "Button";
```

#### 3) Sonner WS 去重集成
在 `frontend/app/components/toast/AppToaster.tsx` 中声明：
```tsx
import { Toaster as SonnerToaster } from "sonner";

export function AppToaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex items-center gap-2.5 w-full max-w-sm p-3 rounded-lg border border-line shadow-panel bg-paper-100 text-ink text-sm z-toast",
          title: "font-medium text-ink",
          description: "text-xs text-ink-muted",
          actionButton: "btn-tactile bg-primary text-primary-content text-xs px-2 py-1 rounded",
          error: "border-error text-error bg-paper-100",
          success: "border-success text-success bg-paper-100",
          warning: "border-warning text-warning bg-paper-100",
        },
      }}
    />
  );
}
```
在 `frontend/app/hooks/useWebSocket.ts` 中消除风暴：
```ts
// 当 WS 状态变化时，使用恒定 ID 就地原地更新 Toast，彻底消除堆叠
toast.error("WebSocket 连接中断，正在尝试重连...", {
  id: "ws-connection-status",
  duration: Infinity,
});
```

---

### 3.2 混合编排 SVG Bezier 有向图画布与数学导引

#### 1) 节点物理模型与分级布局
画布节点覆盖 6 种编排实体，统一分配于 5 级拓扑列中：
- 节点宽度 $W = 208\text{px}$，高度 $H = 80\text{px}$。
- 水平间距 $\Delta X = 104\text{px}$，垂直基准间距 $\Delta Y = 70\text{px}$。
- 源连接桩：$P_{\text{src}} = (x_a + W, y_a + H / 2)$
- 目标连接桩：$P_{\text{dst}} = (x_b, y_b + H / 2)$

| 节点类型 | 标识代码 | 边框与连线色 | 拓扑 Rank | 典型实例 |
|---|---|---|---|---|
| **Workflow Stage** | `wf_stage` | `#60A5FA` (Blue) | $R_0, R_1$ | `storyboard_plan`, `render_keyframes` |
| **Human Gate** | `wf_gate` | `#F59E0B` (Amber) | $R_1, R_3$ | `gate: render_keyframes` (人工审批) |
| **Agent Runtime** | `agent_core` | `#22D3EE` (Cyan) | $R_2$ | `pi-agent-core` (上下文对话助手) |
| **Outbound MCP** | `mcp_out` | `#22D3EE` (Cyan) | $R_3$ | `mcp-inpaint`, `comfyui-flux` |
| **CLI Runner** | `cli_runner` | `#10B981` (Emerald) | $R_3$ | `dreamina i2v`, `ffmpeg-merge` |
| **Inbound MCP** | `mcp_inbound` | `#A78BFA` (Purple) | $R_4$ | `komaslate mcp serve` (北向协议) |

#### 2) 三次贝塞尔曲线（Cubic Bezier）精确数学推导
为了在任意两节点之间产生自然平滑且带有水平切线引导的布线，计算公式如下：
给定起点 $P_0(x_1, y_1)$ 与终点 $P_3(x_2, y_2)$：
$$\Delta x = x_2 - x_1, \quad \Delta y = y_2 - y_1$$
定义水平曲率控制偏置 $\kappa$：
$$\kappa = \max\left(\frac{\Delta x}{2}, 48\right)$$
两个控制点坐标分别为：
$$P_1 = (x_1 + \kappa, y_1), \quad P_2 = (x_2 - \kappa, y_2)$$
SVG 路径指令字符串为：
$$d = \text{"M } x_1 \text{ } y_1 \text{ C } (x_1 + \kappa) \text{ } y_1 \text{, } (x_2 - \kappa) \text{ } y_2 \text{, } x_2 \text{ } y_2 \text{"}$$

代码实现位于 `frontend/app/features/workbench/nodegraph/bezierWires.ts`：
```typescript
export function computeCubicBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const curvature = Math.max(dx * 0.5, 48);
  const cx1 = x1 + curvature;
  const cy1 = y1;
  const cx2 = x2 - curvature;
  const cy2 = y2;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}
```

#### 3) 零 JS 运行时流动粒子动效与无障碍箭头定义
使用纯 SVG 与 CSS Keyframes 表现有向数据流流动，无任何 requestAnimationFrame 循环；并在目标端口定义静态 SVG 箭头，保障在减弱动效（Reduced Motion）下流向依然清晰可见：
```tsx
<svg className="absolute inset-0 pointer-events-none w-full h-full overflow-visible">
  <defs>
    {/* 静态 SVG 箭头定义：确保在用户开启减弱动效时，有向流拓扑结构依然清晰可辨 */}
    <marker
      id="wire-arrow"
      viewBox="0 0 10 10"
      refX="8"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={edgeColor} />
    </marker>
  </defs>
  <path
    d={pathString}
    fill="none"
    stroke={edgeColor}
    strokeWidth="2"
    strokeOpacity="0.8"
    strokeDasharray="6 6"
    markerEnd="url(#wire-arrow)"
    className="animate-flow-dash motion-reduce:animate-none"
  />
  <circle r="3.5" fill={edgeColor} className="motion-reduce:hidden">
    <animateMotion path={pathString} dur="1.8s" repeatCount="indefinite" />
  </circle>
</svg>
```
**无障碍与减弱动效回退保障**：
当触发 `@media (prefers-reduced-motion: reduce)` 时，CSS 虚线流动动画与 SVG `<animateMotion>` 粒子自动停止或隐藏。末端装配的 `<marker id="wire-arrow">` 实体箭头确保了有向图的拓扑流向与端口输入归属恒定明确，彻底避免了纯动效依赖带来的信息丢失风险。

---

### 3.3 三阶语义视口缩放 (Semantic LOD) 规范

彻底化解 `01-ui-motion-research.md §1.5` 披露的 40% 缩放视口盲区问题：

```
                    ┌───────────────────────────────┐
                    │  Viewport Zoom Ratio (ζ)      │
                    └───────────────┬───────────────┘
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   Macro (ζ < 0.5)         Mid (0.5 ≤ ζ < 1.2)      Micro (ζ ≥ 1.2)
 ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
 │ [S03] ● MCP INPAINT │  │ S03 · MCP Inpaint   │  │ S03 · MCP Inpaint   │
 │   State: READY      │  │ Progress: [████ ]   │  │ in: prompt, mask    │
 └─────────────────────┘  │ Latency: 142ms      │  │ out: keyframe.png   │
                          └─────────────────────┘  │ [Re-run] [Diff] CAS │
                                                   └─────────────────────┘
```

1. **宏观概览层 (Macro LOD, $\zeta < 0.5$)**：
   - 卡片尺寸收缩为胶囊块（$128\text{px} \times 44\text{px}$）。
   - 彻底隐藏微弱副标题与次级按钮，通过反向缩放保持字体 $\ge 11\text{px}$。
   - 凸显实体大分类徽章（`STAGE`, `GATE`, `AGENT`, `MCP`）与状态呼吸光点（绿色脉冲表示运行，琥珀色常亮表示待批）。
2. **标准工作层 (Mid LOD, $0.5 \le \zeta < 1.2$)**：
   - 标态卡片（$208\text{px} \times 80\text{px}$）。
   - 呈现完整节点标题、耗时/Token 指标、阶段进度条与当前状态。
3. **深度检视层 (Micro LOD, $\zeta \ge 1.2$)**：
   - 展开态大卡片（$240\text{px} \times 128\text{px}$）。
   - 呈现输入/输出端口明细（`in: story_outline`，`out: shot_image`）、当前实体 CAS `rev=14` 标签以及原地操作快捷按钮（“重新执行”、“检查 RPC”）。

---

### 3.4 底部三栏协议抽屉规格 (A/B Wipe, Gate & Queue, Console)

底部抽屉占据视口 42% 高度，采用 `grid-template-columns: 35% 30% 35%` 黄金比例：

#### 1) 左栏：A/B Wipe 视觉对比器与 CAS 回退
- **交互规范**：采用动态 CSS `clip-path` 渲染原稿（Version A）与重绘版本（Version B）。
- **CAS 版本回退机制**：
  - 读取当前分镜的 `revision`（如 `rev=2`）。
  - 点击“CAS 回退”按钮，前端调用 `PATCH /api/v1/shots/{id}`，Payload 必须携带 `{ expected_revision: 2, image_url: versionA.url }`。
  - 若在对比期间其他用户或 Agent 修改了该分镜，后端立刻返回 HTTP 409 Conflict，前端阻断覆写并提示差异。

#### 2) 中栏：解耦的人工审批门与智能体协作队列
- **彻底消除 `PromptBar.tsx:50-78` 劫持**：审批操作与对话助手输入框物理隔离。
- **人工审批门专属卡片**：
  - 醒目标识：“人工审批门 · 仅限人类决策放行 · pi-agent-core 无权自批”。
  - 呈现待放行阶段元数据及生成成果快照。
  - 动作按钮：“批准放行” (`POST /runs/{id}/confirm`)，“驳回重提” (`POST /runs/{id}/gate-feedback`)。
- **智能体实时思考流**：
  - 接收并格式化渲染 `chat_agent_thought` 事件，以 Markdown 打字机形态流式展示推理过程。

#### 3) 右栏：MCP JSON-RPC 与 CLI 协议终端
- **虚拟化日志流**：集成虚拟滚动，支持每秒数百条高频日志冲击而不卡顿 DOM。
- **过滤分流器**：`ALL`、`RPC` (MCP 协议交互)、`STDIO` (CLI 进程管道)、`ERROR`。
- **点击诊断**：点击任意 JSON-RPC 条目，弹出轻量侧边抽屉，格式化展示 JSON-RPC 2.0 请求体与响应体。

---

### 3.5 全局协议枢纽 (`#hubDialog`) 交互规格

基于原生 `<dialog>` 标签配合 Radix-compatible 封装，包含三大配置页签：
1. **Outbound MCP 选项卡**：管理 Engine 出向工具服务（如 `comfyui-inpaint`, `flux-upscale`）。支持查看网络延迟、切换放行策略（只读自动放行 vs 写操作需确认）、以及执行 Ping 活性检测。
2. **CLI Tools 选项卡**：展示已注册的本地工具（`komaslate` CLI, `dreamina`, `ffmpeg`），提供一键复制命令与独立试跑功能。
3. **Inbound MCP 选项卡**：生成供 Claude Code / Cursor / Windsurf 接入的客户端配置 JSON：
```json
{
  "mcpServers": {
    "komaslate": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/KomaSlate/backend", "komaslate", "mcp", "serve"],
      "env": {
        "ENGINE_URL": "http://127.0.0.1:18766",
        "KOMASLATE_GATEWAY": "http://127.0.0.1:18765"
      }
    }
  }
}
```

---

### 3.6 零运行时 React Bits Pro 动效设计落地

拒绝引入 Three.js / GSAP / Framer Motion 等厚重类库，严格使用标准纯 CSS 与 WAAPI 实现：
1. **交互式纸面网格与光晕**：
   - 容器监听 `pointermove`，动态写入 `--cursor-x` 与 `--cursor-y`。
   - CSS 利用 `radial-gradient` 呈现柔和光晕（群青色，透明度 5%）。
2. **安静的墨晕聚焦微交互 (Quiet Ink-Bleed Glow)**：
   - 彻底废除 Hover 浮起位移（严格符合 `DESIGN.md`“禁止浮空”原则）。
   - Hover 时触发 `box-shadow: 0 0 0 1px rgb(var(--color-primary) / 0.3)` 纸张浸润光晕。
3. **无障碍强制降级**：
   - 全局声明 `@media (prefers-reduced-motion: reduce)`，关闭所有流动动画与平移动效。

---

## 4. 详细技术规格：后端高并发、持久化与自愈机制

### 4.1 SQLite WAL `BEGIN IMMEDIATE` 并发锁消除规范

#### 1) 锁升级死锁根因数学判定
在 SQLite WAL 模式下，默认 `DEFERRED` 事务先获取共享读锁（Shared Lock）。当两个并发事务（FastAPI 协程与 Engine 写入者）都读取了数据并试图发起写操作时，两端同时尝试将共享读锁升级为保留锁（Reserved Lock），直接触发死锁，SQLite 立即返回 `SQLITE_BUSY` (database is locked)，且完全绕过 `busy_timeout` 排队。

#### 2) 代码级改造方案
1. **驱动层 Autocommit 激活**：修改 `backend/aiosqlite/__init__.py:230-238`：
   ```python
   # 显式声明 isolation_level=None，将事务完整控制权交由 SQLAlchemy 或显式 SQL
   self._conn.isolation_level = None
   ```
2. **SQLAlchemy `BEGIN IMMEDIATE` 监听注册**：在 `backend/app/db/session.py` 中：
   ```python
   from sqlalchemy import event
   from sqlalchemy.engine import Engine

   @event.listens_for(async_engine.sync_engine, "connect")
   def set_sqlite_pragma(dbapi_connection, connection_record):
       cursor = dbapi_connection.cursor()
       cursor.execute("PRAGMA journal_mode=WAL")
       cursor.execute("PRAGMA synchronous=NORMAL")
       cursor.execute("PRAGMA busy_timeout=15000")  # 统一 15 秒锁等待超时
       cursor.execute("PRAGMA foreign_keys=ON")
       cursor.close()

   @event.listens_for(async_engine.sync_engine, "begin")
   def do_begin_immediate(conn):
       # 显式开启保留排他锁，使所有并发写入者进入 busy_timeout 安全队列排队
       conn.exec_driver_sql("BEGIN IMMEDIATE")
   ```
3. **只读会话隔离与 Autocommit 保留（保障 SQLite WAL 无锁并发读性能）**：
   `BEGIN IMMEDIATE` 钩子仅应在包含写操作的事务中生效。对于纯读取端点（如 `GET /projects`、`GET /shots`、`GET /runs/current` 等只读依赖项）：
   - 读取操作使用标准的 Autocommit 读模式（或 `BEGIN DEFERRED`），仅向 SQLite 申请 `SHARED` 共享读锁；
   - 在 SQLite WAL 机制下，共享读锁不会与写入者的 `RESERVED` 保留锁或 `EXCLUSIVE` 锁产生任何阻塞，允许无限并发读并发执行；
   - 避免无差别的 `BEGIN IMMEDIATE` 将只读请求强行序列化，最大化发挥 WAL 模式单写多读的非阻塞吞吐优势。
4. **Engine Sidecar 同步连接 Pragma 契约对齐 (`engine/src/db.ts:69`)**：
   审计发现 `engine/src/db.ts:69` 当前硬编码了 `this.db.pragma("busy_timeout = 5000")` 且缺失 `synchronous = NORMAL`。这会导致高并发写争用时 Node Engine 在 5 秒即抛错退出，而 FastAPI 仍在 15 秒内安全排队。
   必须将 `engine/src/db.ts` 的连接初始化对齐为：
   ```typescript
   this.db.pragma("journal_mode = WAL");
   this.db.pragma("synchronous = NORMAL");
   this.db.pragma("busy_timeout = 15000"); // 与后端 session.py 保持完全对齐的 15 秒等待上限
   this.db.pragma("foreign_keys = ON");
   ```

---

### 4.2 事务型 Outbox 事件流与统一推送引擎

#### 1) 架构拓扑
废除 REST 路由中所有 15+ 处 `ws_manager.send_event` 内存广播调用。所有领域变更（如分镜更新、角色调整）必须与对应的事件在同一个数据库事务内写入 `engine_run_events` 表。

#### 2) Outbox 发射器实现 (`backend/app/services/event_outbox.py`)
```python
import json
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

async def emit_project_event(
    session: AsyncSession,
    *,
    project_id: int,
    event_type: str,
    payload: dict[str, Any],
    run_id: int = 0,
) -> None:
    """所有 FastAPI 业务事件必须作为 Transactional Outbox 写入 engine_run_events 表。"""
    stmt = text(
        "INSERT INTO engine_run_events (run_id, project_id, type, payload) "
        "VALUES (:run_id, :project_id, :type, :payload)"
    )
    await session.execute(
        stmt,
        {
            "run_id": run_id,
            "project_id": project_id,
            "type": event_type,
            "payload": json.dumps(payload, ensure_ascii=False),
        },
    )
```

#### 3) WebSocket 连接互斥锁与 Watermark 防御
在 `backend/app/main.py:300-374` 中：
- 为每个活动 WebSocket 连接绑定独立的 `asyncio.Lock()`，保护 `websocket.send_text`，消除帧交织。
- 当 `_engine_event_watermark` 发生临时数据库异常时，保持当前客户端游标，严禁将游标重置为 0 引发历史事件全量雪崩。

#### 4) Outbox 事件压缩与清理策略 (Retention & Compaction Policy)
所有业务事件统一落库 `engine_run_events` 虽保障了保序与重放，但单文件 SQLite 长期运行需防范表体积无节制膨胀：
- **存留时间窗口**：事件默认生命周期为 14 天；
- **压缩清理不变量**：仅当事件所属 Run 已处于终止态（`completed` / `failed` / `cancelled`），且事件序号 `seq < min(active_client_cursors)` 时才允许被物理清理；
- **清理钩子实现**：
  1. **后台周期维护**：在引擎启动或定时维护任务中执行批量清理：
     ```sql
     DELETE FROM engine_run_events
     WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')
       AND run_id IN (SELECT id FROM agentrun WHERE status IN ('completed', 'failed', 'cancelled'));
     ```
  2. **CLI 运维工具**：`komaslate prune-events --days 14`，清理后执行 `PRAGMA wal_checkpoint(PASSIVE)` 释放空间。

---

### 4.3 对话助手待确认卡持久化与双向自愈算法

#### 1) 待确认卡持久化表 (`chat_confirmation`) 结构
用于解决 P0-7 缺陷，消除内存易失导致的未决写操作丢失：
```sql
CREATE TABLE chat_confirmation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL UNIQUE,
    tool_name TEXT NOT NULL,
    tool_label TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'expired'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at TEXT,
    resolved_by TEXT -- 'human' | 'timeout' | 'recovery'
);
CREATE INDEX ix_chat_confirmation_project_status ON chat_confirmation(project_id, status);
```

#### 2) 引擎启动未决确认扫尾清理 (Startup Expiry Sweep)
若 Engine 在存在 `pending` 状态确认卡时遭遇异常崩溃或重启，内存中的 Promise 调度器已不复存在。为防止前端长期挂起在死锁状态，Engine 在初始化启动（`ChatAgents` 构造阶段）必须执行一次性失效清理扫描：
```sql
UPDATE chat_confirmation
SET status = 'expired',
    resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    resolved_by = 'recovery'
WHERE status = 'pending';
```
清理后触发一次 Outbox 广播，前端画布与底部 Dock 立即将悬挂的待确认卡渲染为“已超时失效”，引导用户重新发起对话，彻底消除悬挂 Promise。

#### 3) 对话双向调用自愈算法 (`engine/src/agent/index.ts`)
在向底层 LLM 提交消息上下文前，执行双向自愈扫描，既弥补因重启丢失的 `toolResult`，又消除因滑动窗口截断丢失 `toolCall` 产生的孤立 `toolResult`，彻底杜绝 Provider 400 Bad Request：
```typescript
export function repairOrphanToolCalls(messages: AgentMessage[]): AgentMessage[] {
  // 1. 扫描当前上下文中所有被声明的合法 toolCall id
  const declaredCalls = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "toolCall" && block.id) {
          declaredCalls.add(block.id);
        }
      }
    }
  }

  // 2. 扫描当前上下文中已存在的 toolResult id
  const existingResults = new Set<string>();
  for (const m of messages) {
    if (m.role === "toolResult" && m.toolCallId) {
      existingResults.add(m.toolCallId);
    }
  }

  // 3. 执行双向自愈处理
  const repaired: AgentMessage[] = [];
  for (const msg of messages) {
    // (b) 逆向自愈：滑动窗口截断导致的孤立 toolResult（前置 assistant 消息被裁切，失去对应的 toolCall）
    if (msg.role === "toolResult") {
      if (!msg.toolCallId || !declaredCalls.has(msg.toolCallId)) {
        // 丢弃失去主体的孤立 toolResult，避免触发 Anthropic/OpenAI 上下文校验报错
        continue;
      }
    }

    repaired.push(msg);

    // (a) 正向自愈：assistant 声明了 toolCall 但缺少对应的 toolResult（由于进程重启或超时未决）
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "toolCall" && !existingResults.has(block.id)) {
          // 就地合成一条已取消的 toolResult 消息，平滑闭合工具调用链
          repaired.push({
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: [{ type: "text", text: "操作已取消：引擎已重启或确认已超时。" }],
            isError: true,
          } as AgentMessage);
          existingResults.add(block.id);
        }
      }
    }
  }
  return repaired;
}
```

---

### 4.4 Alembic 迁移脚本规范 (`0036_remediation_persistence_concurrency.py`)

在 `backend/alembic/versions/` 下创建迁移文件：
```python
"""Remediation: chat confirmation, run/asset revisions, and concurrency indices.

Revision ID: 0036_remediation_persistence_concurrency
Revises: 0035_retire_noop_config
"""

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
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tool_call_id", sa.String(length=128), nullable=False, unique=True),
            sa.Column("tool_name", sa.String(length=128), nullable=False),
            sa.Column("tool_label", sa.String(length=128), nullable=False),
            sa.Column("parameters_json", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.String(), nullable=False, server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")),
            sa.Column("resolved_at", sa.String(), nullable=True),
            sa.Column("resolved_by", sa.String(length=64), nullable=True),
        )
        op.create_index("ix_chat_confirmation_project_status", "chat_confirmation", ["project_id", "status"], unique=False)

    # 2. 为 agentrun 补充乐观并发 revision 列
    run_cols = [c["name"] for c in inspector.get_columns("agentrun")]
    if "revision" not in run_cols:
        op.add_column("agentrun", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))

    # 3. 为 asset 补充乐观并发 revision 列
    if "asset" in tables:
        asset_cols = [c["name"] for c in inspector.get_columns("asset")]
        if "revision" not in asset_cols:
            op.add_column("asset", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))

    # 4. 为 engine_run_events 补充高性能检索复合索引
    existing_indices = [idx["name"] for idx in inspector.get_indexes("engine_run_events")]
    if "idx_engine_run_events_project_type_seq" not in existing_indices:
        op.create_index("idx_engine_run_events_project_type_seq", "engine_run_events", ["project_id", "type", "seq"], unique=False)

def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()

    if "engine_run_events" in tables:
        idx_names = [idx["name"] for idx in inspector.get_indexes("engine_run_events")]
        if "idx_engine_run_events_project_type_seq" in idx_names:
            op.drop_index("idx_engine_run_events_project_type_seq", table_name="engine_run_events")

    if "asset" in tables:
        asset_cols = [c["name"] for c in inspector.get_columns("asset")]
        if "revision" in asset_cols:
            # 采用 batch_alter_table 规范，确保在所有 SQLite 版本（包括早期无原生 DROP COLUMN 支持的引擎）中均能平滑降级
            with op.batch_alter_table("asset") as batch:
                batch.drop_column("revision")

    if "agentrun" in tables:
        run_cols = [c["name"] for c in inspector.get_columns("agentrun")]
        if "revision" in run_cols:
            with op.batch_alter_table("agentrun") as batch:
                batch.drop_column("revision")

    if "chat_confirmation" in tables:
        op.drop_index("ix_chat_confirmation_project_status", table_name="chat_confirmation")
        op.drop_table("chat_confirmation")
```

---

### 4.5 全局乐观锁 CAS 控制与下发透传

1. **实体模型补齐**：`AgentRun` 与 `Asset` 配置 SQLAlchemy `__mapper_args__ = {"version_id_col": revision}`。
2. **对话助手写操作透传**：修改 `engine/src/agent/tools.ts:272-299` 中的 `update_shot` 与 `update_character`，强制透传当前实体持有的 `expected_revision`。
3. **HTTP 409 Conflict 契约响应**：
   ```json
   {
     "code": "CONCURRENT_MODIFICATION",
     "message": "Entity was modified concurrently; please refresh and retry",
     "details": {
       "entity": "shot",
       "id": 103,
       "expected_revision": 2,
       "current_revision": 3
     }
   }
   ```

---

### 4.6 租约恢复、心跳对账与子进程组生命周期管理

1. **修复 `reclaimRunLease` 状态集与文本匹配**：
   修改 `engine/src/shared-db.ts:609-612`：
   ```sql
   UPDATE agentrun
   SET owner_id = :ownerId, lease_token = :leaseToken, lease_expires_at = :expiresAt
   WHERE id = :runId
     AND (
       status IN ('queued', 'running', 'waiting_for_approval')
       OR (status = 'failed' AND error LIKE '%Execution lease%')
     )
   ```
2. **子进程组隔离与孤儿清理**：
   在 `backend/app/services/engine_client.py` 中：
   - 使用 `subprocess.Popen(cmd, start_new_session=True)` 启动独立进程组。
   - 记录 PID 至 `backend/data/engine.pid`。
   - 停机时先向进程组发送 `SIGTERM`，超时 5 秒未退出发送 `SIGKILL` 清理完整进程树。

---

### 4.7 分镜关键帧链条级联失效与审查状态恢复

1. **分镜连续性链条级联失效**：
   在 `engine/src/invalidation.ts` 中实现：
   当分镜序号为 $k$ 的镜头被用户触发局部重绘时，系统自动遍历所有依赖其画面的后续分镜 $k+1 \dots N$。若后续分镜处于未锁定状态，将其 `review_status` 置为 `unchecked`，并通过 Outbox 发送 `shot_invalidation_cascaded` 事件。
2. **Critique 轮次与评审指导意见持久化**：
   在 `engine/src/pipeline/runner.ts` 中，将当前的 `critiqueRounds` 与 `critiqueNotes` 写入 `engine_checkpoints` 表的 `stage_critique_state`。在断点恢复时优先恢复此状态，防止轮次重置引发无限死循环重绘。

---

## 5. 详细技术规格：双向 MCP、独立 CLI 与契约治理体系

### 5.1 Engine 侧出向 MCP 客户端规范 (`engine/src/mcp/`)

#### 1) 协议支持与传输层抽象
- 基于官方 `@modelcontextprotocol/sdk`。
- 支持 `StdioClientTransport`（拉起同机高性能 CLI 工具）与 `StreamableHttpClientTransport`（对接外部 ComfyUI / 音频生成微服务）。

#### 2) 连接池与健康检测 (`engine/src/mcp/client-pool.ts`)
- 单例 `McpClientPool`，持有活动客户端字典。
- 每 30 秒执行一次 `ping` 探测；连续 2 次失败标记为 `unhealthy`。
- 将当前阶段的 `AiOperation` deadline 与 `AbortSignal` 严格透传给工具调用信封。

#### 3) 本地物理路径 Zero-Copy 传输与远端网关 URL 回退
- **同机/容器内 Zero-Copy 传输**：对于通过 `StdioClientTransport` 启动的本地 CLI 工具或同机/容器挂载卷环境，彻底摒弃 Base64 传输，统一通过本地绝对路径进行高效文件交换，杜绝大图序列化开销。
- **远端 HTTP 网关 URL 回退机制**：对于通过 `StreamableHttpClientTransport` 连接的远端独立部署 MCP 宿主（例如分布式 GPU 机器上的 ComfyUI 或音频微服务，且无共享文件卷场景），客户端自动识别并回退为可访问的网关静态资源 URL（例如 `http://<gateway_host>:18765/static/...`），供远端服务流式拉取媒体资产。

#### 4) 安全沙箱校验 (`engine/src/mcp/sandbox.ts`)
为彻底消除前缀字符串匹配漏洞（例如同名前缀目录 `/app/static_leak` 误判为通过 `/app/static` 校验）以及符号链接穿透（Symlink Traversal）逃逸风险，使用 `fs.realpathSync` 解析实际真实路径，并结合基于 `path.relative` 的边界判据：
```typescript
import fs from "node:fs";
import path from "node:path";

export function assertSafeMediaPath(targetPath: string, allowedRoots: string[]): string {
  const resolved = fs.realpathSync(path.resolve(targetPath));
  const safe = allowedRoots.some(root => {
    const resolvedRoot = fs.realpathSync(path.resolve(root));
    const rel = path.relative(resolvedRoot, resolved);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  if (!safe) throw new Error(`Security violation: media path outside allowed boundaries: ${resolved}`);
  return resolved;
}
```

---

### 5.2 网关层入向 MCP 服务端规范 (`komaslate mcp serve`)

#### 1) 架构定位与不变量合规
作为 FastAPI 北向网关的协议适配器独立运行，**自身绝不内嵌任何生成编排循环**。

#### 2) 暴露的标准 MCP 资源 (Resources)
- `komaslate://projects/{id}`: 读取项目详情、风格预设与视觉设定集。
- `komaslate://runs/{id}`: 读取指定运行的阶段状态机与 Checkpoint 列表。
- `komaslate://nodes/{kind}/{id}`: 读取画布节点明细（提示词、对白、镜头参数）。
- `komaslate://gates/{run_id}`: 读取当前等待人工决策的审批门上下文。

#### 3) 暴露的标准 MCP 工具 (Tools)
- `inspect_project(project_id: int)`: 查询项目全局结构。
- `trigger_run(project_id: int, stage?: string, auto_mode?: boolean)`: 下发流水线运行。
- `resume_run(run_id: int)` / `cancel_run(run_id: int)`: 控制运行生命周期。
- `submit_gate_feedback(run_id: int, feedback: string)`: 提交审批门修改意见（自主智能体可协助提出修改建议）。
- **人工审批门放行（`approve_gate`）严格移出自动化 MCP 工具清单**：根据 `AGENTS.md` 核心架构不变量 3（`人类审批门只能由真实人类操作，Agent 绝无权限自批或绕过审批门`），任何外部 LLM 或自主智能体绝无权限自批或自动化放行审批门。审批门仅允许真实人类通过 Web UI 画布底部决策面板（`POST /runs/{id}/confirm`）或交互式 CLI 命令（`komaslate gate <run_id> approve`，提示人工确认输入）人工放行。若网关层为协议完整性保留审批放行端点，必须重命名为 `submit_gate_approval(run_id: int, human_auth_token: str)`，强制要求传入由前端用户界面物理点击产生的一次性高熵人类授权凭证 `human_auth_token`（TTL 60 秒，单次有效），彻底杜绝任意外部自主智能体自批穿透审批门。
- `update_shot(shot_id: int, fields: dict, expected_revision: int)`: **强制 CAS 校验写操作**。

---

### 5.3 统一独立 CLI 架构 (`komaslate run/inspect/mcp/dev/media`)

在 `backend/pyproject.toml` 中注册入口：
```toml
[project.scripts]
komaslate = "app.cli.main:cli"
```

#### 子命令规格与用途
1. **`komaslate run <project_id> [--stage <stage>] [--auto] [--watch]`**：
   无头运行漫剧生成流水线，实时终端渲染进度条与阶段事件。
2. **`komaslate inspect <project_id|run_id> [--shots] [--events] [--json]`**：
   诊断项目状态、分镜数据、检查点及持久化事件流。
3. **`komaslate mcp serve [--transport stdio|http] [--port 18768]`**：
   启动入向 MCP 服务端，供 Claude Code / Cursor 挂载连接。
4. **`komaslate dev [--port 18765] [--engine-port 18766]`**：
   一键拉起 Backend、Engine Sidecar 与 Vite 前端，统一监管进程树并混流着色日志。
5. **`komaslate media <subcmd>`**：
   独立媒体处理工具，包含 `face-embedding`、`character-reference`、`nine-grid`、`process-audio` 以及以 stdio 模式启动的 `mcp` 子命令。

---

### 5.4 单源多端契约治理与 CI 强校验流水线

```
contracts/
├── workflow.json           # 阶段拓扑单源
├── events.json             # 35+ 领域事件契约单源
└── openapi.json            # FastAPI 导出的 REST 规范
```

#### 自动化生成流水线 (`scripts/generate_all_contracts.py`)
1. **阶段拓扑**：根据 `workflow.json` 生成 Python、Engine TS、Frontend TS 阶段常量。
2. **领域事件**：根据 `events.json` 生成 Python Pydantic 事件模型与 TS 联合类型。
3. **REST API**：通过 FastAPI `app.openapi()` 导出规格，经 `openapi-typescript` 分别生成前端与 Engine 的强类型 `api.d.ts`，彻底消除手动双写与字段漂移。
4. **CI 红线门禁**：
   ```bash
   python scripts/generate_all_contracts.py --check
   ```
   若任何生成文件未同步，CI 立即红线报错并阻断合并。

---

## 6. 实施里程碑、依赖拓扑与降级回滚预案

### 6.1 五阶段实施里程碑 (M1 ~ M5)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Milestone 1 (M1): 底层并发加固与 P0 致命缺陷清零 (工期: 3 天)                │
│ - aiosqlite isolation_level=None + session.py BEGIN IMMEDIATE + busy_timeout │
│ - create_local_run 补齐 ensure_engine_running，释放 409 死锁                 │
│ - 修复 configitem 反向覆盖，修复 consistency_eval 本地静态文件解析路径       │
│ - 修复 reclaimRunLease 审批门状态与文本匹配；加固 Token/SSRF/SVG 安全        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Milestone 2 (M2): 事务型 Outbox、数据模型与契约治理流水线 (工期: 3 天)       │
│ - 执行 Alembic 0036 迁移脚本 (chat_confirmation, revision 补齐)             │
│ - 实现 emit_project_event，全量拔除 REST 路由裸推 ws_manager.send_event      │
│ - 建立 contracts/events.json 与 generate_all_contracts.py (--check 门禁)     │
│ - OpenAPI 强类型导出生成 api.d.ts，消灭手写类型滞后                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Milestone 3 (M3): 智能体自愈、审批门持久化与健壮性 (工期: 3 天)             │
│ - 落地 chat_confirmation 持久化确认卡与 repairOrphanToolCalls 自愈扫描       │
│ - Agent Tools 全量透传 expected_revision CAS 乐观锁                         │
│ - runner.ts 持久化 critiqueRounds 上下文；invalidation.ts 落地关键帧链失效   │
│ - PlanAgent 注入 project.visual_bible 全局设定集                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Milestone 4 (M4): 双向 MCP 协议栈与统一 komaslate CLI 生态 (工期: 3 天)      │
│ - Engine 交付 Outbound MCP Client (stdio/HTTP, 本地文件零拷贝, 沙箱防御)    │
│ - Backend 交付 Inbound MCP Server (komaslate mcp serve, Resources/Tools)    │
│ - 交付统一命令行工具 komaslate (run, inspect, mcp, dev, media)               │
│ - 优化 BackendWorker 媒体常驻池，卸载主事件循环阻塞                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Milestone 5 (M5): Option 3 节点终端工作台与 UI 体验极致收口 (工期: 4 天)     │
│ - 统一 CVA Button (xs)、Radix 无障碍原语，消除死类名与 fields.tsx 分裂       │
│ - 引入 Sonner (固定 ID 去重消灭 WS 风暴) 与懒加载 cmdk Combobox              │
│ - 交付 Hybrid Node-Graph SVG Bezier 画布与三阶语义视口缩放 (Semantic LOD)   │
│ - 交付底部三栏协议抽屉 (A/B Wipe, Decoupled Gate & Queue, Console) 与 Hub   │
│ - 落地零运行时 React Bits Pro 微动效 (网格光晕、无位移墨晕聚焦、平滑流速)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 6.2 严格执行依赖拓扑图

```
M1 (SQLite WAL 并发与核心 Bug 修复)
  │
  ▼
M2 (Outbox 事件流 + Schema 迁移 + 契约单源)
  │
  ├──────────────────────────────────┐
  ▼                                  ▼
M3 (Agent 自愈 + 持久化确认卡)       M4 (双向 MCP 协议栈 + CLI)
  │                                  │
  └──────────────────┬───────────────┘
                     ▼
M5 (Option 3 节点终端工作台 + UI 原语与动效精修)
```

- **M2 强依赖 M1**：只有在 SQLite WAL `BEGIN IMMEDIATE` 彻底消除了锁升级死锁后，才能安全地将领域更新与 Outbox 事件合并入同一数据库事务。
- **M3 强依赖 M2**：对话助手持久化卡片与状态流转依赖 M2 迁移生成的 `chat_confirmation` 表与 Outbox 事件流。
- **M4 强依赖 M2**：MCP 工具与 CLI 数据交互需要基于 M2 生成的强类型 OpenAPI DTO 与 CAS 乐观锁。
- **M5 强依赖 M3 与 M4**：前端工作台的节点连接、底部 A/B 对比器、审批门卡片以及协议终端必须对接底层的 CAS 接口与双向 MCP/CLI 管道。

---

### 6.3 风险矩阵与降级回滚触发机制

| 里程碑 | 潜在风险与故障场景 | 容忍阈值与监控判据 | 确定性降级与回滚预案 |
|---|---|---|---|
| **M1** | `BEGIN IMMEDIATE` 导致极个别跨进程长耗时只读事务排队超时 | 线上出现持续 > 15s 的 `OperationalError: database is locked` | 临时调大 `busy_timeout` 至 30s；排查长事务协程并将其拆分为细粒度局部查询。 |
| **M2** | Outbox 写入使高频 `PATCH /shots/{id}` 的 HTTP 延迟轻微增加 | P99 写入延迟上升超过 40ms | 为 `engine_run_events` 增加轻量级内存写入缓冲区；优化复合索引命中率。 |
| **M3** | `chat_confirmation` 迁移在特定开发机环境遇锁超时 | Alembic 执行抛出锁等待错误 | 执行 `alembic downgrade -1`；暂时启用内存自愈补偿降级分支。 |
| **M4** | stdio 模式的子进程在极个别系统环境下管道缓冲死锁 | 媒体生成调用超过 30s 无响应 | 降级启用内部预留的直接子进程调用通道；强制开启局部临时文件交换。 |
| **M5** | 引入 Radix 与动效导致前端首屏体积突破红线 | `check-bundle-budget.mjs` 报错退出 | 立即将 `cmdk` 与 Radix 浮层组件调整为严格异步 `React.lazy()` 动态加载分包。 |

---

## 7. 全量独立可执行核验指标 (Verification Rubrics)

根据仓库开发纪律，本计划制定**客观、独立、可直接执行的一锤定音核验标准**，供后续实施团队独立核验验收：

### 7.1 前端与 UI 动效核验指标 (UI-01 ~ UI-06)

#### [UI-01] 弹窗与确认原语收口验证
- **针对缺陷**：AUD-UI-01, AUD-UI-02, AUD-UI-03
- **执行命令**：
  ```bash
  # 验证全工程无任何原生 window.confirm 与 alert 残留（Fail-Closed 闭环：存在违规返回 1，无违规返回 0）
  git grep -n -E "\b(window\.)?(confirm|alert)\(" frontend/app/ && exit 1 || exit 0
  # 验证 ConfirmModal 中无 border-transparent 与 border-line-strong 冲突
  git grep -n "border-transparent.*border-line-strong" frontend/app/components/ui/ && exit 1 || exit 0
  ```
- **预期结果**：两项命令执行均无输出，进程正常退出（Exit Code 0）。若工程中仍有裸 alert/confirm 或 window.confirm 残留，命令立即返回退出码 1 熔断。

#### [UI-02] 表单控件统一与死类清理验证
- **针对缺陷**：AUD-UI-05, AUD-UI-06, AUD-UI-07
- **执行命令**：
  ```bash
  # 验证无任何残留 DaisyUI checkbox 死类
  git grep -n "checkbox checkbox-" frontend/app/
  # 验证 fields.tsx 已彻底废弃独立局部 TextInput
  git grep -n "export function TextInput" frontend/app/features/comic-workflow/inspector/fields.tsx
  # 运行设计契约静态门禁
  cd frontend && pnpm exec vitest run app/styles/designContract.test.ts
  ```
- **预期结果**：前两项输出为空；`designContract.test.ts` 全部通过（PASS）。

#### [UI-03] 交互原语替换与 Toast 去重验证
- **针对缺陷**：AUD-UI-04, AUD-UI-08, AUD-UI-11, AUD-UI-12, AUD-UI-13
- **执行命令**：
  ```bash
  # 验证禁用态按钮去除 span title 补丁（Fail-Closed 闭环：覆盖带 class 属性的 span title，检出违规返回 1）
  git grep -n -E '<span[^>]*\btitle=' frontend/app/features/ && exit 1 || exit 0
  # 验证 WS 错误绑定固定 ID 去重
  git grep -n 'id: "ws-connection-status"' frontend/app/hooks/useWebSocket.ts
  ```
- **预期结果**：第一项无匹配（Exit Code 0）；第二项准确匹配到 `id: "ws-connection-status"` 固定 ID 绑定行。

#### [UI-04] 画布 40% 缩放语义 LOD 验证
- **针对缺陷**：AUD-UI-10
- **执行命令**：
  ```bash
  cd frontend && pnpm exec vitest run app/features/workbench/nodegraph/NodeGraphCanvas.test.tsx
  ```
- **预期结果**：测试套件通过，断言在 `zoom < 0.5` 时卡片呈现 `Macro` 徽章，在 `zoom >= 1.2` 时呈现 `Micro` 端口详情。

#### [UI-05] 动效与设计合规清理验证
- **针对缺陷**：AUD-UI-14, AUD-UI-16
- **执行命令**：
  ```bash
  # 验证黄色手绘下划线被彻底清除
  git grep -n "underline-sketch" frontend/app/
  # 验证 PreviewModals 无内联 SVG 裸标签
  git grep -n "<svg" frontend/app/components/canvas/PreviewModals.tsx
  ```
- **预期结果**：输出均为空。

#### [UI-06] Bundle 体积红线核验
- **针对指标**：总 JS gzip $\le 250$ KB，单 Chunk $\le 150$ KB，字体 $\le 120$ KB。
- **执行命令**：
  ```bash
  cd frontend && pnpm build && node scripts/check-bundle-budget.mjs
  ```
- **预期结果**：构建成功，控制台打印 `All bundle budgets passed!`（Exit Code 0）。

---

### 7.2 后端 FastAPI 与网关核验指标 (BE-01 ~ BE-10)

#### [BE-01] 修复局部重绘 503 产生僵尸 queued 锁死验证
- **针对缺陷**：P0-1
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_api/test_generation.py -k "test_create_local_run_ensures_engine" -q
  ```
- **预期断言**：在 Engine 未启动时发起局部重绘请求，系统自动触发 `ensure_engine_running`；当启动失败时，数据库不残留 `queued` 记录，后续请求正常排队而不报 409。

#### [BE-02] 修复 SQLite WAL `BEGIN IMMEDIATE` 与高并发无锁死验证
- **针对缺陷**：P0-2
- **执行命令**：
  ```bash
  cd backend && uv run python -c "
  import asyncio
  from aiosqlite import connect
  async def check():
      async with connect(':memory:') as db:
          assert db.isolation_level is None, 'isolation_level must be None'
  asyncio.run(check())
  print('aiosqlite driver autocommit OK')
  "
  uv run pytest tests/test_db/test_concurrency.py -q
  ```
- **预期断言**：在 50 路并发读写压力下，系统完成 100% 事务提交，0 次 `OperationalError: database is locked`。

#### [BE-03] 修复 `configitem` 反向覆盖环境变量验证
- **针对缺陷**：P0-3
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_services/test_config_service.py -k "test_env_overrides_db_on_restart" -q
  ```
- **预期断言**：注入环境变量 `TEXT_PROVIDER=custom_mock`，重启初始化后设置值保持为 `custom_mock`，不被数据库记录反向覆盖。

#### [BE-04] 修复一致性评估本地静态文件路径解析验证
- **针对缺陷**：P0-4
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_services/test_consistency_eval.py -k "test_local_static_path_resolution" -q
  ```
- **预期断言**：传入本地 `/static/test.png`，服务准确在 `backend/app/static/test.png` 命中并提取人脸特征，评分不再恒为 0。

#### [BE-05] 终结 WS 双轨事件分裂（Transactional Outbox）验证
- **针对缺陷**：P1-1
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_api/test_ws_events.py -k "test_route_events_persisted_to_outbox" -q
  ```
- **预期断言**：执行分镜更新 `PATCH /shots/{id}` 后，`engine_run_events` 表必然产生一条对应的持久化记录，其 `seq` 单调递增且支持断线重放。

#### [BE-06] 安全漏洞防护验证（Token 鉴权、SSRF 拦截、SVG 过滤）
- **针对缺陷**：P1-2
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_api/test_security_guards.py -q
  ```
- **预期断言**：未提供 `ADMIN_TOKEN` 访问 `/api/v1/config/reveal` 返回 403；私网 IP endpoint 触发 422 拦截；上传 SVG 返回 400 Bad Request。

#### [BE-07] 修复导出服务缺陷验证（XML 转义、流式打包、异步卸载）
- **针对缺陷**：P1-3
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_services/test_export_service.py -q
  ```
- **预期断言**：包含 `<Hero>&"Dialogue"` 的分镜台词顺利导出 PDF 不抛 SAX 错误；大体积 ZIP 导出内存常驻增量 $\le 10$ MB。

#### [BE-08] 修复 Sidecar 孤儿进程残留验证
- **针对缺陷**：P1-4
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_orchestration/test_engine_process.py -k "test_process_group_cleanup" -q
  ```
- **预期断言**：Backend 进程终止后，Sidecar 子进程组及其派生的所有辅助进程在 2 秒内全部退出，18766 端口安全释放。

#### [BE-09] 修复 Watermark 失败雪崩与并发发送锁验证
- **针对缺陷**：P2-1, P2-3
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_api/test_ws_watermark.py -q
  ```
- **预期断言**：模拟瞬时数据库忙等待时，WS 连接保持现有游标，禁止重置为 0；单连接并发推送测试无帧交叉。

#### [BE-10] 验证 GET 端点无写库副作用
- **针对缺陷**：P2-3
- **执行命令**：
  ```bash
  cd backend && uv run pytest tests/test_api/test_runs.py -k "test_get_current_run_is_readonly" -q
  ```
- **预期断言**：连续发起 10 次 `GET /projects/{id}/runs/current`，数据库事务日志中无任何 `UPDATE` 或 `INSERT` 产生。

---

### 7.3 引擎工作流与 Agent Runtime 核验指标 (ENG-01 ~ ENG-10)

> **实施团队工程配置与用例组织规范**：
> 1. **Vitest 路径配置契约**：`engine/vitest.config.ts` 的默认配置为 `include: ["tests/**/*.test.ts"]`。若直接通过 CLI 传递文件路径执行单个测试，Vitest 遵循所选参数；但为保障全量运行与 CI 统一，所有持久化测试用例均应组织于 `engine/tests/` 目录下（或在 `vitest.config.ts` 中补充包含 `src/**/*.test.ts`）。
> 2. **用户规则遵从（禁止新建测试文件）**：根据工程全局开发纪律（**“不新建测试文件；自检用一次性命令”**），实施 Agent 应当优先将断言用例补充到既有的 `engine/tests/` 骨架测试套件中（如 `chat-agent.test.ts`、`pipeline.test.ts`、`invalidation.test.ts`、`backend-worker.test.ts`、`structured-output.test.ts`），或使用带 `tsx -e` / `python -c` 的一次性自检脚本，严禁在仓内新建散落孤立的测试文件。

#### [ENG-01] 修复对话助手重启孤立 toolUse 损坏会话验证
- **针对缺陷**：P0-7
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/chat-agent.test.ts -t "transcript-recovery"
  ```
- **预期断言**：模拟插入一条未决的 `toolUse` 后重启会话，系统自动在上下文追加一条合成的取消 `toolResult`，随后发起的 LLM 对话成功返回 200，无 Provider 400 报错。

#### [ENG-02] 修复 `reclaimRunLease` 遗漏审批门状态验证
- **针对缺陷**：P0-5, P0-6
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/pipeline.test.ts -t "reclaim-lease-waiting-for-approval"
  ```
- **预期断言**：对处于 `waiting_for_approval` 且租约过期的 run 调用 `reclaimRunLease` 成功返回 `true`，租约平滑续展，任务未被误杀。

#### [ENG-03] 修复 PlanAgent 丢失 `visual_bible` 上下文验证
- **针对缺陷**：P0-8
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/pipeline.test.ts -t "plan-context-visual-bible"
  ```
- **预期断言**：断言发往模型的 Prompt 字符串中完整包含 `project.visual_bible` 的结构化内容。

#### [ENG-04] 修复崩溃恢复丢失 critique 轮次与意见验证
- **针对缺陷**：P1-6
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/pipeline.test.ts -t "crash-recovery-critique"
  ```
- **预期断言**：在第 2 轮审查重绘中模拟崩溃并调用恢复，读取到的 `critiqueRounds` 依然为 2，上一轮指导意见完好继承，不陷入死循环。

#### [ENG-05] 修复分镜修改下游关键帧失效验证
- **针对缺陷**：P1-7
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/invalidation.test.ts
  ```
- **预期断言**：重绘第 1 镜后，依赖其视觉的第 2 镜与第 3 镜 `review_status` 自动变为 `unchecked`，并向前端发送失效通知。

#### [ENG-06] 补齐 Agent Tools `expected_revision` CAS 验证
- **针对缺陷**：P1-5
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/chat-agent.test.ts -t "tools-cas"
  ```
- **预期断言**：Agent 触发 `update_shot` 时，向后端发出的 `PATCH` 请求体中必须包含 `expected_revision`；若版本不匹配则正确接收 409 Conflict。

#### [ENG-07] 解耦 PromptBar 审批门劫持验证
- **针对缺陷**：AUD-UI-16
- **执行命令**：
  ```bash
  cd frontend && pnpm exec vitest run app/features/workbench/PromptBar.test.tsx
  ```
- **预期断言**：在审批门等待放行期间，用户在 PromptBar 输入 `@助手`，请求被正确投递至 `POST /chat`，而不是触发审批门放行或反馈。

#### [ENG-08] 修复上下文滑动截断错位验证
- **针对缺陷**：P1-8
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/chat-agent.test.ts -t "context-boundary"
  ```
- **预期断言**：构造 60 条包含多轮工具调用的历史消息，截取窗口末端的所有 `toolUse` 均存在对应的 `toolResult`，且无任何无对应 `toolCall` 的孤立 `toolResult` 残留。

#### [ENG-09] 优化媒体 Worker 常驻池与零拷贝验证
- **针对缺陷**：P2-1
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/backend-worker.test.ts -t "pool-reuse"
  ```
- **预期断言**：连续发起两次图像拼接，子进程仅启动一次并常驻复用；请求参数传递本地文件路径，传输耗时下降 $\ge 70\%$。

#### [ENG-10] 强化 LLM 结构化输出与指数退避验证
- **针对缺陷**：P2-2
- **执行命令**：
  ```bash
  cd engine && pnpm exec vitest run tests/structured-output.test.ts -t "resilience"
  ```
- **预期断言**：模拟模型返回 429 速率限制错误，系统在 2 秒内执行有限指数退避重试并成功恢复；返回无 `score` 的结构体时自动触发修复提示。

---

*（本主计划文档编写完毕。全量 36 项缺陷、三端核心技术规格、双向 MCP 与 CLI 生态、五阶段里程碑以及一锤定音的独立核验指标已全部闭环。）*
