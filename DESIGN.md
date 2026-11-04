---
name: openOii
description: "AI 漫剧生成平台：故事创意 → 3 Agent 协作 → 可视化漫剧成片"
colors:
  # light（:root）
  primary: "#2F4BC3"
  primary-hover: "#243BB2"
  primary-pressed: "#1B2C9D"
  primary-content: "#FFFFFF"
  neutral: "#1C1C22"
  neutral-content: "#ECECF1"
  surface: "#FFFFFF"
  paper-100: "#F7F7F4"
  paper-200: "#EFEEE9"
  paper-300: "#DEDDD6"
  border-strong: "#8A8A94"
  ink: "#1C1C22"
  ink-muted: "#5B5B66"
  info: "#0B6E7F"
  success: "#1B6F45"
  warning: "#8A5200"
  error: "#B42318"
  # dark（[data-theme="dark"]）
  dark-primary: "#96ACFE"
  dark-primary-hover: "#A6BCFF"
  dark-primary-pressed: "#8499E9"
  dark-primary-content: "#0F1018"
  dark-surface: "#181A26"
  dark-paper-100: "#0F1018"
  dark-paper-200: "#212434"
  dark-paper-300: "#2F3348"
  dark-border-strong: "#6C7191"
  dark-ink: "#ECEDF5"
  dark-ink-muted: "#A5A8BD"
  dark-info: "#5FCFE0"
  dark-success: "#6FD3A0"
  dark-warning: "#F2B35A"
  dark-error: "#FF8A80"
typography:
  wordmark:
    note: "openOii in Instrument Serif Italic, inlined as SVG outlines (open = ink, Oii = primary); no webfont load"
  display:
    fontFamily: "openOii Display (Smiley Sans 得意黑 subset, CJK + Latin), sans fallback"
    note: "fixed headings only, text-lg (18px) and up, weight 400, no tracking"
  sans:
    fontFamily: "Schibsted Grotesk (Latin/numerals) → system CJK stack: PingFang SC, Hiragino, Microsoft YaHei, Noto Sans CJK SC"
  mono:
    fontFamily: "IBM Plex Mono 400/500 → ui-monospace, SF Mono, Menlo, Consolas"
    note: "ids (S01), durations, technical fields only"
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  xl: "10px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
alpha:
  rule: "5 的倍数；/8 /12 /65 这类随手档已收敛"
  common: "5 10 15 20 30 40 50 70 90"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-content}"
    rounded: "{rounded.md}"
    hoverBackgroundColor: "{colors.primary-hover}"
    activeBackgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.paper-100}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.paper-100}"
    rounded: "{rounded.md}"
---

# Design System: openOii

## 0. Design Contract (executable)

**Authority:** `frontend/app/styles/tokens.css` is the source of truth. This document is human-readable; update it in the **same PR** when tokens change (ADR 0002).

**Direction (ADR 0010, supersedes D2):** professional creation studio with light comic accents. Light **and** dark themes (default follows the system). Comic accents are print-craft marks: crop and registration marks on the canvas, and halftone in waiting states. They appear only on the wordmark, the canvas cards, the final-video card and moment, and empty states (`docs/research/craft-direction.md`). Not cold SaaS grey; not heavy comic. Spec: `docs/specs/frontend-studio-redesign.md`.

**Shell geometry (tokens):**

| Token | Role |
|-------|------|
| `--workbench-header` | TopBar (2.75rem); on the workbench its centre holds the status pill and run actions |
| (none) | Agent 面板浮在画布左侧，固定 `w-[360px]`，可收成胶囊 |
| (none) | 检查器浮在画布右侧，固定 `w-80`（320px），可收成胶囊 |

**Studio 布局：全幅画布 + 浮层面板（ADR 0010，spec §5）：**

```
┌────────────────────────────────────────────────────────┐
│ TopBar  ·  状态胶囊 + 生成/停止                          │
├────────────────────────────────────────────────────────┤
│ ┌Agent 面板┐        Canvas 全幅            ┌检查器────┐ │
│ │活动/待处理│                              │选中项属性 │ │
│ └──────────┘        [画布工具条]            └─────────┘ │
│              ┌ PromptBar（≤720，居中）┐                 │
│              └────────────────────────┘                 │
└────────────────────────────────────────────────────────┘
```

1. **画布占满，面板浮在上面。** Agent 面板在左（360px），检查器在右（320px），都能收成胶囊。
   窄于 1440px 时 Agent 面板默认收起；窄于 1280px 时两者互斥，开一个就收另一个。
   **画板只画在两面板之间：** 点阵铺满整屏，但 xyflow 的根只占面板之间那一栏（`--canvas-cover-left/right`），
   节点不会压在面板底下，也不会在面板外沿露出半截字；靠面板一侧淡入 24px。适配、缩放中心、拖拽换算都按这一栏算；
   左栏开合时视口同帧反向平移，画上的东西不跳。守卫：`comic-workflow-canvas.spec.ts`（画板边 = 面板边、节点文字不被遮挡）。
   手机（`<sm`）上没有画布：单列显示状态、待处理（同一个 InboxPanel）、成片/分镜预览和最近 5 条动态，
   底部提示用桌面端编辑完整画布。重试只在待处理和 TopBar。
2. **检查器承载一切属性面**，包括 Brief。未选中任何卡片时显示“项目”视图（Brief + 宇宙时间线）；
   换选中目标时自动展开，手动收起后同一选中不再弹开。
   **每件事只说一次：** 面板标题始终是「检查器」；内容头部是 类型眉题（项目概要 / 角色 / 分镜 / 成片）· 名称 · 一行副标题；
   第一个标签页对所有类型都叫「概览」，只列头部没说的字段（值与头部名称或副标题相同的行一律不列：项目标题、风格、角色名、分镜场景、成片状态；镜头序号即 S01 也不列）；副标题最多两行，全文在 `title`。
   守卫：`SelectionSection.test.tsx`、`InspectorPanel.test.tsx`。
3. **PromptBar 浮在画布底部居中**（最宽 720px），是唯一的文本输入入口，「选中 → 提示 → 定点重跑」默认可见。
   - 左侧是 `逐步确认 / 自动确认` 开关；后面是上下文 chip：每个选中对象一个（可移除，画布选区同步），
     无选区时 `整个项目`，处于审批门时 `规划 · 待确认`。
   - Enter 发送，Shift+Enter 换行；占位文字随上下文变化。
   - 画布工具条叠在 PromptBar 上方，固定 9 个常驻按钮：`[选择 V · 抓手 H] | [− 缩放% + 适应] | [整理 · 资产] [⋯]`。
     视图控件只用图标；「整理」「资产」两个常用动作永远带文字；排序分镜、补齐缺失首帧/视频收进 `⋯`（向上展开）。
     排序是模式：进入后「完成排序」顶替「整理」常驻可见，退出才回来。不许用文字假装图标（如 `3×N`/`图`/`视`）。
     守卫：`ComicCanvasToolbar.test.tsx`（≤9 个、每个有 SVG、无重复入口）。

**画布（React Flow，`@xyflow/react`）：** `canvas/flow/FlowWorkflowView.tsx` 渲染，
`toFlowNodes.ts` 把工作流图转成节点：每个 section 是一个 frame 父节点，卡片相对 frame 定位并限制在其内。
选择工具框选、滚轮平移；Shift/⌘/Ctrl 多选；分镜排序模式下只有镜头可拖（松手即 `reorderShots`），
自由布局模式只拖 frame（位置存 `localStorage`，「重置布局」清空）。适配视图避开两侧浮层和底部 PromptBar，
板子放得下就居中，否则从左上角开始。保留 React Flow 署名。

画布几何（卡片尺寸、九宫格列数、frame 内距 gap）的 SSOT 是
`app/features/comic-workflow/graph/layoutComicWorkflow.ts`——React Flow 消费的是
px 数值，tokens.css 不保留 rem 副本（避免两套数字漂移）。

**Token → Utility 映射（强制）：**

`tailwind.config.ts` 的 `theme.extend` 把 token 映射成裸类，**源码里必须写裸类**：

| token | 写字 | 禁止写 |
|-------|------|--------|
| `--text-sm` | `text-sm` | ~~`text-[length:var(--text-sm)]`~~ |
| `--radius-md` | `rounded-md` | ~~`rounded-[var(--radius-md)]`~~ |
| `--z-popover` | `z-popover` | ~~`z-[var(--z-popover)]`~~、~~`z-50`~~ |
| `--duration-fast` | `duration-fast` | ~~`duration-[var(--duration-fast)]`~~、~~`duration-150`~~ |
| `--duration-press` | `duration-press` | ~~`duration-[var(--duration-press)]`~~、~~`duration-100`~~ |
| `--leading-tight` | `leading-tight` | ~~`leading-4`~~ |
| `--rhythm-zone` | `gap-5` | ~~`gap-[var(--rhythm-zone)]`~~ |

不透明度阶梯只允许 5 的倍数（`ink/8` 这类随手档已收敛）。
focus ring 不手写：全局 `:focus-visible` 已是 2px primary outline，别再加 `focus-visible:outline-*` / `ring-*`。
执行者：`app/styles/designContract.test.ts`（几何）+ `themeContrast.test.ts`（颜色）。

**Layout rules:**

1. **No document scroll** — `html`/`body`/`#root` overflow hidden; only `.page-body` / panel panes scroll.
2. **Interaction soft freeze** — selection binding, the activity timeline and inbox, cell regenerate, generate/confirm/cancel keep meaning (ADR 0003).
3. **No display face in chrome or data** — the wordmark is inlined SVG outlines and `.display` is only for fixed headings; `font-brand` is banned.
4. **Dense chrome** — header/toolbar use `--touch-target-dense` for chips; primary actions keep `--touch-target-min` (44px).
5. **Shell classes** — TopBar → `.chrome-row` + `data-shell="topbar"`; StudioControls (status pill, run actions) → TopBar `center` slot, `data-shell="studio-controls"`; pages → `.page-shell` / `.page-body`.
6. **常驻非浮动面上限 3** — 第 4 个功能面一律走浮层/抽屉（yuuvis viewport architecture）。各面最小宽之和放不下时必须换布局模式，**不许按百分比切完再让面板重叠**。

**Program:** Full UI domains land in batches (`docs/frontend-redesign-program.md`).

## 1. Overview

**North star: a calm creation studio with a light comic accent.**

openOii is a tool for making comic videos, so the work (the storyboard) gets the screen and the chrome stays quiet.
The workbench is a full-bleed React Flow canvas; the agent panel, the inspector and the PromptBar float over it.
Warm grey paper and ink neutrals, one ultramarine (群青) brand hue, the system CJK font stack.
The comic identity survives only as print-craft marks: crop marks on the selected panel, registration marks on
the final-video card and its completion moment, halftone while waiting, and corner marks on empty slots.

It rejects three looks: cold grey SaaS (Jira), the generic AI generator (white card grids and purple gradients),
and heavy comic everywhere (offset shadows, halftone and display type on every surface).

**Key characteristics:**
- Full-bleed canvas, floating panels that collapse to pills (§0 layout).
- Borders and paper tones carry hierarchy; shadows are only for things that float.
- One place for each job: decisions in the 待处理 inbox, text input in the PromptBar, properties in the inspector.
- Light and dark themes (ADR 0010); every text token meets WCAG AA on every surface.
- Mobile is a read-and-decide view, not a canvas editor.

## 2. Colors

One brand hue (ultramarine, 群青) on calm warm-grey neutrals. Light and dark themes; the first visit follows `prefers-color-scheme`, the toggle persists (`data-theme="light" | "dark"`).

- **Primary** `#2F4BC3` (dark `#96ACFE`): primary actions, selection, focus ring, links, the `Slate` of the wordmark and the favicon. Also legal as text on every surface (≥ 6:1 light, ≥ 7:1 dark).
- **Primary ramp**: `primary-hover` `#243BB2` / `primary-pressed` `#1B2C9D` (dark `#A6BCFF` / `#8499E9`, lighter on dark). Filled primary controls use `hover:bg-primary-hover active:bg-primary-pressed`, not alpha. `primary-content` stays ≥ 4.5:1 on all three; `themeContrast.test.ts` checks it.
- Ultramarine was chosen to stay clear of the teal `info` and storyboard accents and of the `error` red. The CMYK `--cmyk-magenta` plate on the final-video card is a print-registration accent, not the brand.
- **Neutrals**: `paper-100` page bg, `paper-200` sunken panes, `paper-300` sunken-on-sunken fills, `line` (ink 12%) hairline borders and dividers, `line-strong` (ink 22%) dashed drop zones, `surface` raised cards/dialogs, `border-strong` input/control borders (≥ 3:1).
- **Text**: `ink` (≥ 7:1), `ink-muted` (hex, ≥ 4.5:1 on every surface), `ink-subtle` (alpha, ≥ 3:1, placeholders/meta only).
- **Status**: `info` / `success` / `warning` / `error`. Text uses `text-{k}-fg`; tinted backgrounds use `bg-{k}-bg` (alpha from `--status-bg-alpha`); filled badges use `bg-{k} text-{k}-content`.
- **Card states** (`canvas/nodeStatus.tsx`, one source for canvas cards and the inspector): 生成中 `info` · 待确认 `primary` · 审查中 neutral (`paper-200` + `ink`) · 需重合成 `warning` · 失败/阻塞 `error` · 完成/可用 `success`, each tinted with `bg-{k}-bg` (待确认 uses `primary/10`). Colour is never the only cue: every state has its own shape (pulsing dot, `approve-gate`, `eye`, `refresh-cw`, `warning-circle`, `check`). Under colour-blind simulation (Machado 2009), 需重合成 vs 失败 (red-green) and 生成中 vs 完成 (blue-yellow) move close in hue, and the shape carries the difference. `stateColors.test.ts` checks badge text ≥ 4.5:1 on its tint over `surface` and `paper-100` in both themes, ΔE ≥ 20 between states for typical vision, and that any pair closer than ΔE 12 under protan/deutan/tritan simulation has different shapes. The sheet renders at `/dev/state-colors` (dev builds only).
- **Removed**: `secondary`, `accent`, `primary-ink`, `text-2xs`. The contract test fails if they come back.

### Scales

- **Type**: xs 12 / sm 14 / base 16 / md / lg / xl / 2xl 24. 12px is the floor.
- **Radius**: sm 4 (chips), md 6 (controls), lg 10 (cards, panels, dialogs).
- **Elevation**: `shadow-panel` (floating panels, popovers), `shadow-dialog` (dialogs).
- **Z**: `z-panel` 20 → `z-popover` 40 → `z-toast` 60 → `z-tooltip` 70.

Executable checks: `themeContrast.test.ts` (both themes) and `designContract.test.ts`.

## 3. Typography

- **Sans** (`font-sans`, the default): **Schibsted Grotesk** (variable 400–900, SIL OFL 1.1) for Latin and numerals, falling back to the system CJK stack (PingFang SC → Hiragino → YaHei → Source Han / Noto Sans CJK). It is a grotesque designed for a newspaper house, so it has more bite than Inter or Geist and holds its weight next to CJK. A metric-matched local fallback (`"Schibsted Grotesk Fallback"`: Arial / Helvetica / Liberation Sans with `size-adjust: 104.92%`, `ascent-override: 93.07%`, `descent-override: 24.57%`, derived from the woff2 with fontTools) sits right behind it, so the swap does not reflow lines.
- **Chinese labels** use `.label` (sans, xs, 500, no tracking, no uppercase). Only Latin or numeric parts get `font-mono` (for example `格 <span class="font-mono">{n}</span>`); `.label-caps` is for Latin-only eyebrows. The design contract test fails on literal CJK inside `label-caps` / `font-mono` / `uppercase` / `tracking-wide*`. It cannot see dynamic `{label}` text. For runtime text that mixes numbers and Chinese (meta lines, dates, progress ETA, activity detail), render the container in sans and use `<MonoRuns text={…} />`, which puts only the Latin/numeric runs in `font-mono`. Legacy feed messages with three periods are normalised to `…` in `deriveActivityTimeline`.
- **Display** (`.display`, `--font-display`): **Smiley Sans 得意黑** 2.0.1 (SIL OFL 1.1, © atelierAnchor), one family for Chinese *and* Latin/numerals. The licence reserves the names "Smiley" and "得意黑", so the subset ships renamed as **`openOii Display`** (`public/fonts/oii-display.woff2`; name table, file and CSS family; OFL §3), with the original licence in `OFL-SmileySans.txt`. Why: it is a slanted, narrow title face made for posters and video titles, which is what 漫剧 headings are, and its forward lean rhymes with the Instrument Serif *italic* wordmark, so brand voice is one gesture (italic wordmark + oblique headings) instead of three unrelated faces (serif wordmark, wide geometric Unbounded, rounded 庆科黄油体). It also cut 12 KB. **Size floor: `.display` only at `text-lg` (18px) and above**; at 12–16px the strokes clot, so small titles (EmptyState, card heads) use sans 600. Only for fixed headings: `PageHeader` and `DeskSection` titles (on by default), canvas frame titles, the version-compare and outline-review headings. Titles that carry user content (a universe name) pass `plainTitle` and fall back to sans. The face ships only the characters listed in `public/fonts/display-cjk.chars.txt` plus Basic Latin; `app/styles/displayGlyphs.test.ts` collects every fixed `.display` / header title string from the source and fails if a character is missing, fails on new dynamic text inside `.display`, and fails if a `.display` className has no size or one below `text-lg`. To add a heading with new characters: add them to the chars file and run `python3 scripts/subset-display-fonts.py` (fontTools + brotli; it refuses if the font lacks a glyph). Single weight: `font-weight` 400, no tracking, `font-synthesis: none` (never fake bold or a second slant).
- **Mono** (`font-mono`): **IBM Plex Mono** (400 / 500, SIL OFL 1.1) for frame numbers, timecodes, durations and ids. Never for Chinese labels.
- **Files:** self-hosted in `public/fonts`, subset to Basic Latin, Latin-1 and common punctuation, with `font-display: swap` and `unicode-range`. Sans and mono 400 are preloaded in `index.html`. Licences: `public/fonts/OFL-*.txt`. The display face is not preloaded (it swaps in after first paint).
- **Budget:** at most 120 KB of woff2 in total (75.4 KB today: sans 36.4 + mono 11.4 + 11.7 + display 15.9). `scripts/check-bundle-budget.mjs` enforces it on `pnpm build`.
- **No CJK body webfont:** a subset of even ~300 glyphs would cost ~75 KB, and user text would then mix two CJK faces. Body text uses the system stack; only the fixed display headings use the small `openOii Display` subset.
- **Scale and tracking:**
  - `text-xl` and `text-2xl` use `--tracking-display` (−0.022em);
  - h1–h6 use `--tracking-heading` (−0.012em) at weight 600;
  - body has no tracking;
  - `.label-caps` is 12px mono 500, uppercase, `--tracking-label` 0.14em, for section labels such as BRIEF or `universe / 3`.
- **Line-height:** `--leading-normal` 1.6 for CJK body text; `--leading-snug` 1.35 and `--leading-tight` 1.15 for headings and chrome.
- **Numerals:** the whole app uses `tabular-nums` so progress, durations and counts don't jitter.
- **Wordmark** (`components/layout/Wordmark.tsx`): `Koma` in ink and `Slate` in `primary`, set in **Instrument Serif Italic** (SIL OFL 1.1, notice in `public/fonts/OFL-InstrumentSerif.txt`). Plain type, no marks or offsets. The glyphs are inlined as SVG outlines, so no font file loads; K→o is closed by 25/1000 em, a→S opened by 10/1000 em, and t→e closed by 8/1000 em. Static copies: `public/brand/komaslate-wordmark-{light,dark}.svg`. `public/favicon.svg` is an italic `Ks` monogram in `primary` on a paper tile with a 0.35px same-colour stroke for weight at 16px, and it follows `prefers-color-scheme`.
- Chinese text has no letter-spacing and no italics. `text-autospace` adds the CJK/Latin gap where the browser supports it.
- **Browser surfaces:** a selection tinted with `primary`, a `primary` caret, thin ink scrollbars, `color-scheme` and a `theme-color` meta that follow the theme. See `docs/research/craft-direction.md`.

### Icons

- **One component:** `ui/SvgIcon` (`name`, `size`, `className`). It renders on a 24 grid with a 1.5 stroke, round caps and joins, and `currentColor`. Sizes stay on ICON_SCALE {8, 12, 14, 16, 20, 24, 32}; the contract test enforces both the scale and the ban on `@heroicons/*`.
- **Generic glyphs:** Iconoir v7 (MIT, © Luca Burgio). The path data is copied into the registry, so there is no runtime dependency.
- **Domain glyphs**, drawn for openOii:
  - `shot`: a viewfinder with crop corners;
  - `storyboard`: 2×2 panels with caption lines;
  - `render`: a film frame with sprocket holes and play;
  - `approve-gate`: posts, a beam and a check;
  - `registration`, `crop` and `screentone` (fit view uses Iconoir `expand`, not `crop`);
  - `stop`, `layers` and `arrow-down-to-line`.
- **Size floor for affordances:** a 1.5 stroke on the 24 grid draws 0.75px at 12px, which vanishes on a 1× screen. Disclosure chevrons that are the only sign a control opens a menu (the project switcher) use 16px and `text-ink-muted`; 12px chevrons are fine only beside a text label that already says what happens ("N 项细节"). On phones the switcher drops its decorative `storyboard` icon so the title keeps the room.
- **Canvas card headers:** brief `lightbulb`, character `user`, shot `shot`, output `render`. The project switcher uses `storyboard`.
- Icon sheet: `.devdata/screens/craft2-icon-sheet.png`.

## 4. Elevation

- **Flat elements** (cards, list rows, inline buttons): 1px border only (`border-line`, or `border-border-strong` for controls). 2px is reserved for selection, active-tab underlines and left accent bars. No shadow.
- **Floating panels, popovers, toasts, the canvas toolbar:** `shadow-panel`, a layered ink-tinted shadow (a short contact layer plus a soft ambient one). In dark mode it opens with a 1px white 6% hairline.
- **Dialogs:** `shadow-dialog` on `.dialog-panel`.
- **Comic accent** (spec §7.6): `.comic-frame` — a 2px ink border plus two registration marks (⊕) centred above and below the card. Only on the final-video card. There are no hard offset shadows. `designContract.test.ts` bans `shadow-brutal*`, `shadow-comic*`, `halftone*` and keeps `comic-frame` in its whitelist file.
- **Selected canvas card:** the 2px primary ring plus `.crop-marks`, which puts printer's crop marks at the four corners. Canvas cards use `rounded-sm` (4px), like cut paper.
- **Waiting and empty:** `.media-placeholder` is a 6px halftone with an ink sweep; `.media-blank` is a still halftone; `.corner-marks` draws storyboard-sheet corners on empty slots and `EmptyState`. The output's registration marks sit misregistered (with a cyan ghost) until the video is ready, then register and turn primary.
- No hover lift. Pressing a button scales it to 0.97 for 120ms, with no bounce.
- **Motion:** one easing, `--ease-standard` = `cubic-bezier(0.22, 1, 0.36, 1)`. Only transform, opacity, filter and colours animate. Reduced motion makes every change instant and drops the press scale.
- **Press:** one recipe per size of target, all on `--duration-press` (120ms). Buttons (`.btn-doodle`) scale to 0.97. Selectable cards and prompt chips carry `.press`, which scales to 0.98 because a bigger surface needs less travel. Rows that sit inside a container (menu items, list rows) do not move; they darken to `bg-ink/10` while held. Under reduced motion nothing scales, only the colour changes.

## 5. Components

### Buttons
- **Shape:** `rounded-md` (6px), 1px border, `font-semibold`, no uppercase.
- **Primary:** `bg-primary text-primary-content`.
- **Secondary:** `bg-surface text-ink border-border-strong`, hover `bg-paper-200`.
- **Ghost:** transparent, no border; hover `bg-paper-200`.
- **Danger:** `bg-error text-error-content`.
- **Components:** `ui/Button` (variant `primary/secondary/ghost/danger`, size `sm/md/lg`), `ui/IconButton` (required `aria-label`), `ui/PlainButton` (unstyled, for tabs, menu items, selectable cards and rows). Native `<button` is only allowed in `components/ui` and the canvas cards; the contract test enforces it.
- **Disabled:** 50% opacity, `cursor-not-allowed`.
- **Links that look like buttons:** use `ui/ButtonLink` (same `buttonClass` recipe, renders one `<a>`). Never wrap a `Button` in a `Link` or the other way round: that is two tab stops and invalid HTML. `interactiveNesting.test.ts` scans every TSX file for nested interactive elements.
- **Tactile:** filled variants carry `.btn-tactile`, which adds a hairline top highlight and a bottom ink edge. On `:active` it turns into an inset press shadow (adapted from rareui.com).

### Cards / Containers
- **card-doodle:** `rounded-lg` (10px), 1px `border-paper-300`, `bg-paper-100`; hover border `border-strong`. No shadow.
- **Final-video card:** `.comic-frame` (see §4).

### Inputs / Fields
- **input-doodle:** 1px `border-border-strong`, `rounded-md`, `bg-paper-100`. Focus: border turns primary plus the global focus ring.

### Chips / Tags
- **Style:** Rounded-full, thin border, paper-200 surface. Selected state uses a primary tint.
- **One line:** a pill never wraps. Long content (camera notes, cast lists) uses `inline-block max-w-full truncate` with the full text in `title`; `inline-flex` does not ellipsise, and a wrapped pill turns into a blob cut by the card edge.
- **State:** Unselected: paper-200 background, ink text. Selected: primary/10 background, primary text and border.

### Navigation
- **Sidebar:** 288px overlay panel (18rem, `--workbench-sidebar`), `bg-paper-100`. Active project uses a primary tint. Delete button revealed on hover only.
- **TopBar:** 44px (2.75rem, `--workbench-header`), 1px bottom border. Nav items have no fill: inactive is `ink-muted`, hover and active go to `ink`, and the active item (`aria-current="page"`) adds a 1px `primary` underline at 70% opacity. Focus uses the global focus ring. On the workbench the centre holds the status pill (stage, progress, elapsed time) and 生成 / 停止.

### Activity timeline
- No chat bubbles. The agent panel shows a step timeline: a status dot (running pulses in primary, error in error), agent label, title, duration on the right, and a "N 项细节" disclosure for tool rows.
- Follows the newest entry; scrolling up stops following and shows "跳到最新".
- The detail disclosure uses `.collapse-rows`, a `grid-template-rows` 0fr→1fr transition (from transitions.dev). It is `inert` while closed and instant under reduced motion.
- **Repeated warnings fold.** Two or more consecutive warnings from the same agent become one row: the warning icon, `{agent} · 提醒` with a mono `×N` on the right (screen readers hear "共 N 条"), one summary line, and a "逐条查看 N 条" disclosure (`aria-expanded` + `aria-controls`, same `.collapse-rows`) that lists each warning in its original order. When only the subject differs ("阿岚 …" / "橘猫 …"), the summary merges the subjects ("阿岚、橘猫 …"); otherwise it reads "S01、S02：2 条提醒". A single warning, or warnings split by a step, stays as it is. `groupRepeatedWarnings` in `activityTimeline.ts`.

### Overflow menus
- 只有一个实现：`components/ui/Menu.tsx`（`MenuButton` + `MenuItem` / `MenuLink`），顶栏「工作台工具」和画布「更多画布操作」共用。
- 打开即聚焦第一项；↑↓/Home/End 移动（跳过禁用项）；Esc 或点外面收起，焦点回到触发按钮；选中一项自动收起。
- 外观：`rounded-md border-line bg-surface shadow-panel p-1`，项 `text-xs` + 14px 图标，hover/focus 同为 `bg-paper-200`，按住为 `bg-ink/10`（不缩放）。不另起菜单样式。

### States: loading, empty, error
- **Loading a list:** skeleton rows in the list's own column grid and row height (`.skeleton-line`: the media wait-state halftone sweep as thin `radius-sm` bars), wrapped in `role="status" aria-busy` with a sr-only label. Swapping in the data must not shift the layout. A spinner (`spinner-doodle`) is for buttons and small, unknown-shape areas only. (Linear / Raycast list loading.)
- **Empty:** `ui/EmptyState` with corner marks, a sentence that says what to do next (not "暂无数据"), and one primary action.
- **Error:** never shown as empty. A tinted error block names what failed ("项目列表加载失败"), reassures that data is safe, and has an inline 重试. A toast may repeat the retry, but the inline one stays.

### Destructive actions
- Row-level delete / remove icons sit at `ink-muted` and turn `error-fg` on `bg-error-bg` only on hover or `focus-visible`. A column of red icons reads as an alarm and outweighs the row content (Linear, Figma file browser). Confirmation stays in `ConfirmModal`, and the confirm button there uses `danger`.

### Labels for stored ids
- Never print a backend id (style `anime`, mode `review`) in the UI. Map it with the shared helper (`styleLabel`, the creation-mode labels), and use a phrase rather than a dangling unit when a value is unset ("镜头数自动", not "计划 自动 镜头").

### Dialogs
- Native `<dialog>` via `showModal()`, so the top layer sits above every floating panel. `.dialog-panel` with `shadow-dialog`.

### Approval inbox
- Every decision lives in the agent panel's 待处理 tab: approval gate (确认继续 / 提修改意见), interrupted run (继续 / 取消), blocking shots, last failure (从失败阶段重试). The top bar, prompt bar and cards don't repeat these buttons.
- A new item opens the panel on 待处理; clearing the inbox returns to 活动. In 自动确认 mode gates don't interrupt.

## 6. Do's and Don'ts

### Do:
- **Do** keep comic accents to the places listed in spec §7.6: the wordmark, the final-video card and its completion moment, and empty states.
- **Do** use borders and the paper tones for hierarchy; shadows are for things that float.
- **Do** use mono only for ids, durations and technical fields.
- **Do** keep one entry point per job (inbox for decisions, PromptBar for text, inspector for properties).
- **Do** run `impeccable detect` against the live pages before landing UI work: zero `low-contrast` and `undersized-ui-text`.

### Don't:
- **Don't** use pure #000 or #fff for any element. Every neutral must be tinted toward the brand hue.
- **Don't** create cold grey SaaS panels. Neutrals stay on the warm paper scale.
- **Don't** use generic AI tool aesthetics: white card grids with purple gradients are the opposite of this studio.
- **Don't** apply childlike doodle aesthetics: over-rounded corners, candy colors, infantile typography. This is a professional workshop, not a sticker chart.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe. Use full borders, background tints, or nothing.
- **Don't** use gradient text (`background-clip: text` with gradient). Solid colors only.
- **Don't** use glassmorphism (blurs, glass cards) as default surface treatment.
- **Don't** add offset hard shadows or halftone outside spec §7.6.
- **Don't** bring back a display font (the old Bangers wordmark) for labels, buttons or data.
- **Don't** reinvent standard affordances (custom scrollbars, weird form controls, non-standard modals). The workbench has familiar tools.
- **Don't** pin a fourth always-on surface over the canvas; it goes into a panel tab, a popover or a dialog.
- **Don't** put text under 12px anywhere, including canvas labels.
