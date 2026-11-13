<div align="center">
  <br />
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./frontend/public/brand/komaslate-wordmark-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./frontend/public/brand/komaslate-wordmark-light.svg" />
    <img src="./frontend/public/brand/komaslate-wordmark-light.svg" width="320" alt="KomaSlate" />
  </picture>

  <p><strong>本地优先、可编辑、非破坏性的开源 AI 分镜与短片工作台</strong></p>
  <p><em>Local-first, editable, non-destructive AI storyboarding workspace</em></p>

  <p>
    <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.10+" />
    <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
    <img src="https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+" />
    <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=111827" alt="React 18" />
    <img src="https://img.shields.io/badge/SQLite-Local--First-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite Local-First" />
    <img src="https://img.shields.io/badge/FCPXML-v1.9-14151A?style=flat-square" alt="FCPXML v1.9" />
    <img src="https://img.shields.io/badge/License-MIT-F59E0B?style=flat-square" alt="MIT License" />
  </p>

  <p>
    <a href="#为什么选择-komaslate">核心特性</a> ·
    <a href="#界面预览">界面预览</a> ·
    <a href="#架构">架构</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#路线图">路线图</a>
  </p>
</div>

## ☁️ 赞助商 · Bloome

<table>
  <tr>
    <td align="center" width="58%" valign="top">
      <a href="https://bloome.im/app?utm_medium=github&utm_source=Xeron2000-openOii-ivor-202607">
        <img src="./doc/Bloome.png" alt="Bloome — 加速世界向人机协作团队转型" width="100%" />
      </a>
    </td>
    <td width="42%" valign="middle">
      <p>也在研究像 <strong>KomaSlate</strong> 这样的分阶段可控 AI 工作流？</p>
      <p>
        <a href="https://bloome.im/app?utm_medium=github&utm_source=Xeron2000-openOii-ivor-202607"><strong>Bloome</strong></a>
        让 Claude、ChatGPT、DeepSeek 等多个 AI 在同一对话里协作——互相质疑、交叉核对、一起把结果打磨到位
      </p>
      <ul>
        <li>零配置，云端即用</li>
        <li>网页与移动端均可使用</li>
        <li>配置好的 Agent 可分享给团队</li>
      </ul>
      <p><strong>👉 <a href="https://bloome.im/app?utm_medium=github&utm_source=Xeron2000-openOii-ivor-202607">免费试用 Bloome</a></strong></p>
    </td>
  </tr>
</table>

<sub>💼 面向 AI 视频/图像 API 网关与开发者工具开放包月合作展位（GitHub README 首屏 + 官网生态栏），欢迎通过 <a href="https://github.com/xeronsh/KomaSlate/issues">GitHub Issue</a> 洽谈</sub>

---

**KomaSlate**（取自日语分镜格 *Koma* 与影视场记板 *Slate*）是面向创作者与独立开发者的**本地优先、非破坏性开源 AI 分镜工作台**

不同于消耗黑盒积分、改一处重跑全片的闭源云端工具，KomaSlate 将剧本拆解、角色定妆卡、九宫格分镜台本、视频切片与多版本栈沉淀在**本地单文件 SQLite 与 React Flow 画布**中：随时停在审批门锁住已满意镜头（`LOCKED`），仅对不满意的单镜补充导演批注或增删出场角色定向重拍，并排对比图像与视频版本后一键回退，最终直出配音字幕成片或导出标准 **FCPXML v1.9** 时间线资产包进入非编软件精剪

## 为什么选择 KomaSlate

- **🎬 锁镜保护与单镜定向重拍**：已批准镜头在重新规划分镜或重拍兄弟镜头时自动原地保护，绝不误伤重画；支持携带导演修改批注对单镜画面或单镜视频定向重拍，每次写入自动留存历史快照，支持双栏图像/视频并排对比（Version Compare）与 CAS 乐观锁一键回退（同步恢复画面、提示词与角色绑定）
- **🎞️ 双轨交付：一键成片 + 标准 FCPXML v1.9 剪辑资产包**：内置多音色 TTS 配音、字幕烧录与背景音乐自动闪避混音（FFmpeg），可直出 MP4 成片、A4 漫画 PDF 与 Webtoon 长图；也可一键导出非编剪辑包（ZIP：按镜号命名的关键帧、视频切片、独立 TTS 干声、角色立绘、SRT 字幕与 `100/2400s` 帧对齐 `timeline.fcpxml`），直接拖入 DaVinci Resolve、Final Cut Pro、Premiere Pro 或剪映专业版精剪
- **🎭 可编辑角色绑定与双重一致性把关**：支持在分镜检查器内按镜头增删出场角色标签（微距特写或空镜可解绑角色直接放行审批，避免无关人物强行入镜导致比例穿帮），配合多参考图拼合注入、Vision Critique 视觉审查与本地 InsightFace 余弦特征评估拦截人物走形
- **🧭 15 阶段确定性工作流 + 6 道审批门**：`大纲 → 角色 → 分镜 → 角色立绘 → 分镜关键帧 → 视频片段 → 成片合成` 全链路契约驱动，支持「逐步确认」与「自动确认」双模式切换，依托 SQLite 租约（Lease）与事件表实现断线与重启断点续跑
- **🔑 本地优先（Local-First）与自备密钥（BYOK）**：所有工程数据与生成媒体落盘本地，零平台积分抽成；内置国内外主流文本、图像、视频、视觉审查、配音与背景音乐预设卡片及零扣费连通性探测，并提供 `Fake` 模式零成本跑通全链路，详见 [docs/providers.md](docs/providers.md)
- **💬 受控工作台对话助手**：基于 [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent) 内置项目助手，可查询状态、润色台本或发起局部重生成；所有计费与写操作强制经过人工确认卡片放行，阶段审批门仅由创作者本人操作

## 界面预览

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./doc/screenshots/home.webp" alt="KomaSlate 首页" />
      <br />
      <sub><strong>创作台首页 · 输入故事创意，自由切换逐步确认与自动确认</strong></sub>
    </td>
    <td align="center" width="50%">
      <img src="./doc/screenshots/projects.webp" alt="KomaSlate 项目库" />
      <br />
      <sub><strong>项目库 · 阶段状态与多章节进度一目了然</strong></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="./doc/screenshots/workbench.webp" alt="KomaSlate 分镜工作台" />
      <br />
      <sub><strong>分镜画布工作台 · 活动时间线、分镜卡片与出场角色/版本检查器</strong></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./doc/screenshots/export-menu.webp" alt="导出剪辑素材包与下载成片" />
      <br />
      <sub><strong>交付菜单 · 下载成片、导出剪辑素材包与 Webtoon 长图</strong></sub>
    </td>
    <td align="center" width="50%">
      <img src="./doc/screenshots/production-options.webp" alt="成片选项：配音、字幕、背景音乐" width="320" />
      <br />
      <sub><strong>成片合成选项 · 配音 / 字幕烧录 / 背景音乐混音</strong></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="./doc/screenshots/settings-video-presets.webp" alt="设置：视频服务商预设" />
      <br />
      <sub><strong>模型服务商配置 · 内置主流文本、图像、视频、视觉审查与配音预设及连通性检测</strong></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./doc/screenshots/workbench-dark.webp" alt="深色印版工作台" />
      <br />
      <sub><strong>深色印版主题 · 分镜工作台</strong></sub>
    </td>
    <td align="center" width="50%">
      <img src="./doc/screenshots/home-dark.webp" alt="深色印版首页" />
      <br />
      <sub><strong>深色印版主题 · 创作台首页</strong></sub>
    </td>
  </tr>
</table>

## 架构

**确定性阶段工作流 + 受控对话助手**，共享同一个 TypeScript 引擎与单文件本地 SQLite：

- **工作流引擎**（`engine/src/pipeline`）：15 个阶段按唯一契约（`contracts/workflow.json`）确定性推进——文本规划与审查经 [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai) 解析结构化输出，图像与视频阶段支持全量执行与单资产定向重跑（Targeted Run），精准计算下游失效范围而不波及兄弟镜头
- **项目对话助手**（`engine/src/agent`）：基于 [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent) 的受控工具循环，仅调用后端产品 API，写操作须人工确认，无法越权替用户通过审批门
- **产品后端与媒体工具**（`backend/`）：FastAPI 承载 HTTP/WebSocket 契约、CAS 版本回退、FCPXML 剪辑包打包与引擎网关，并提供参考图拼合、TTS/BGM 混音与 InsightFace 人脸特征向量计算

```text
frontend/ (React 18 + React Flow)  ──HTTP/WS──▶  backend/ (FastAPI 网关)  ──loopback──▶  engine/ (Workflow + Agent)
                                                               └────── 共享 SQLite（WAL）+ /static 本地媒体 ──────┘
```

详细架构约束见 [AGENTS.md](AGENTS.md)，关键设计决策见 [docs/adr](docs/adr) 与 [docs/spec/non-destructive-storyboard.md](docs/spec/non-destructive-storyboard.md)

## 快速开始

### 方式一：Docker Compose 一键启动

```bash
cp backend/.env.example backend/.env   # 默认 Fake 模式可零成本体验完整流程
docker compose up -d
```

启动后访问 `http://localhost:15173` 进入工作台，在右上角「设置」中填入自有模型 API Key 即可切换真实生成

### 方式二：本地源码运行（零容器）

环境要求：Python 3.10+ 与 [uv](https://docs.astral.sh/uv/)、Node.js 22.19+ 与 `pnpm`、系统已安装 `ffmpeg`

```bash
cp backend/.env.example backend/.env   # 先零成本跑通全链路可保持 TEXT/IMAGE/VIDEO_PROVIDER=fake

# 1. 安装引擎依赖（首次触发生成时后端会自动在 127.0.0.1:18766 拉起引擎 sidecar）
cd engine && pnpm install && cd ..

# 2. 启动后端 API（:18765，启动时自动执行 SQLite Alembic 迁移）
cd backend && uv sync && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 18765

# 3. 另开终端启动前端工作台（:15173）
cd frontend && pnpm install && pnpm dev
```

如需单独调试引擎进程，也可手动启动：

```bash
cd engine && \
ENGINE_DB_PATH=../backend/data/komaslate.db ENGINE_BACKEND_DIR=../backend \
ENGINE_STATIC_DIR=../backend/app/static ENGINE_PYTHON=../backend/.venv/bin/python pnpm dev
```

打开 `http://localhost:15173` 开始创作，接口文档位于 `http://localhost:18765/docs`

开发验证命令：`backend` 下 `uv run pytest`，`engine` 下 `pnpm test`，`frontend` 下 `pnpm test` / `pnpm e2e`

## 路线图

- [x] 15 阶段确定性生成流水线、6 道人工审批门与 SQLite 租约断点恢复
- [x] 锁镜保护重规划、单镜附带导演批注定向重拍、双栏图像/视频 Diff 对比与 CAS 一键回退
- [x] 分镜角色绑定可视化增删与无角色空镜审批放行
- [x] 通用剪辑资产包导出（ZIP：分镜帧 / 视频切片 / 独立 TTS / SRT 字幕 + 标准 **FCPXML v1.9** 时间线）
- [x] 国内外主流模型 BYOK 预设卡片、零扣费连通性探测与内置成片合成（配音 / 字幕 / BGM / PDF / Webtoon）
- [x] **KomaSlate** 印版分镜稿 × 导演场记板品牌与双主题界面升级
- [ ] 多镜头候选 Take 矩阵横向试片台与时间码帧级批注
- [ ] OpenTimelineIO（`.otio`）交换格式与更多非编预设扩展

## 🙏 致谢

- [Linux.do](https://linux.do/) — 高质量技术社区，感谢佬友们的公益站与热心支持 ❤️

## License

MIT
