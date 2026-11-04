# 质感方向：印版与分镜稿

- 日期：2026-10-29
- 起因：现在的界面干净，但看起来像通用的 AI SaaS / shadcn 模板，到处是同样的圆角卡片、灰底配灰字和默认阴影。
- 范围：只改细节，不重做布局。品牌主色仍是群青，密度仍是 D2（Dense Comic Workbench）。

## 一句话

**KomaSlate 是一张摆在制版台上的分镜稿。** 纸是暖白的；深色主题是一块蘸了群青的油墨版，而不是灰色。卡片就是分镜格，带格号；被选中的那格出现裁切线和对位标。等待的时候，画面里是印刷网点。漫画元素只出现在标号、裁切线、网点这类「工艺痕迹」里，正文和控件保持专业、安静。

## 灵感来源与取用

| 来源 | 取什么 | 用在哪 |
|---|---|---|
| 日本 / 中国的印刷与编辑传统（版心、标号、对位标、裁切线、网点） | 只把「工艺痕迹」当装饰。标号一律用等宽数字，像页码 | 卡片格号、选中时的裁切角、骨架屏网点、favicon |
| 漫画分镜稿用纸（コマ割り用紙） | 细黑框、格号写在左上角、留白 | 分镜卡片、成片卡 |
| Teenage Engineering | 数字和标签用小号等宽，加一点字距，克制地给一个强调色 | 计数、时长、格号 |
| Linear | 发丝线代替大面积底色，层级靠明度而不是阴影；深色是带色相的黑 | 分区框、深色主题 |
| Things / Arc | 按下有实体感（轻微缩小），但不弹跳 | 按钮按压态 |
| Are.na / Readymag | 编辑感：标题字重对比大，正文安静 | 分区标题 |
| Rauno Freiberg 的 craft 笔记、Vercel Web Interface Guidelines | 浏览器表面也要设计（选区、光标、滚动条、color-scheme）；数字用 tabular-nums；不写 `transition: all`；尊重 reduced-motion；层叠阴影 | 全局 base 层 |
| **transitions.dev** | ① 一条缓动 `cubic-bezier(0.22, 1, 0.36, 1)`（类似 ease-out-quint），所有进入、展开都用它；② 文字切换用 opacity + 轻微 blur + 位移；③ 高度展开动 `grid-template-rows: 0fr → 1fr`，不动 height；④ 按压 `scale(.97)`，约 120ms；⑤ 只列出要动的属性，并加 reduced-motion 兜底；⑥ 时长做成令牌，不在组件里写死 | 动效令牌、按钮、活动流展开、toast |
| **beautifului.dev** | ① 「像素格加载器 + 已用时间」：等待时既有点动，又有个数字；② 可展开的轨迹行用 grid-rows 动画；③ 深色表面用 `0 0 0 1px` 的白色 8% 内描边，代替灰色边框 | 网点加载器（换成印刷网点，配秒数）、深色面板描边 |
| **beui.dev** | 组件自带 reduced-motion 分支；悬停时卡片只抬 1px，不放大 | 卡片悬停 |
| **rareui.com** | 「触感」按钮：顶部 1px 内高光、底部 1px 内暗边（inset），用来代替外投影 | 主按钮、工具条按钮 |
| **ui.shadcn.com** | 只参考交互质量和无障碍：focus-visible 环（主色约 50% 透明度、3px）、Radix 式的键盘与 aria 模式。**不用**它的默认外观（中性灰、统一圆角、`transition: all`） | 焦点环 |

以上都是看了效果之后用自己的 CSS / TSX 重新实现的，没有照抄任何站点的源码，也没有新增依赖。

## 要去掉的「模板味」

1. 到处都是同样圆角的卡片：卡片改成分镜格，圆角从 10px 收到 4px，像裁好的纸；浮层面板保留 10px
2. 灰底配灰字：次要文字从墨色取透明度，深色主题整体带群青色相
3. 默认阴影 `0 4px 16px rgba(0,0,0,.08)`：改成层叠阴影（1px 描边环 + 近处短影 + 远处柔影），不再「1px 边框 + 大片软影」叠在一起
4. 成片卡的 3px / 6px 硬投影（Impeccable 的硬投影反模式）：换成对位标
5. 居中的空状态大图标：改成写在格子里的一行说明，配裁切角
6. 转圈的 spinner 和闪光骨架：改成网点骨架
7. 选区、光标、滚动条都是浏览器默认：改用品牌色
8. Bangers 漫画字标：太像玩具。改成「对位标 + 字标」的组合，字标用系统无衬线，靠字重和字距建立识别，同时去掉一个字体包
9. emoji、渐变色块、渐变字：保持为 0（现在已经没有）

## 规则（落地时遵守）

- **字体**：数字一律 `tabular-nums`。标号、时长、计数用等宽小字，字距 0.04em；中文正文不加字距。中西文之间的间距用 `text-autospace`（浏览器不支持时就退回原样）。标题 700，正文 400，中间档只有 500
- **表面**：亮色是纸，深色是油墨版。网点只出现在等待态和空格里，透明度 ≤ 8%，纯 CSS `radial-gradient` 实现。不用 `feTurbulence` 噪点，也不铺满整页纹理
- **层级**：平面元素只用 1px 发丝线；浮层用层叠阴影；同一个元素不同时用边框和大软影
- **动效**：两档时长（120ms 按压、200ms 状态）加一条缓动，只动 transform、opacity、filter。按压缩到 0.97，不回弹。reduced-motion 下全部瞬时完成
- **焦点**：2px 主色实线，偏移 2px。画布卡片选中时再加裁切角
- **无障碍**：所有改动保持 AA；装饰元素一律 `aria-hidden`
- **性能**：纹理全部用 CSS 或内联 SVG，不新增图片资源；去掉 Bangers 后字体包变小

## 分 PR

1. 浏览器表面与字体细节：选区、光标、滚动条、color-scheme、tabular-nums、字距、text-autospace、动效令牌、按压态、焦点环
2. 表面：深色主题改成群青墨色，层叠阴影，触感按钮
3. 分镜卡：格号、选中时的裁切角，成片卡用对位标代替硬投影，圆角收到 4px
4. 等待与空状态：网点骨架、网点加载器配秒数、空格里的裁切角说明
5. 字标与 favicon：对位标 + 字标，去掉 Bangers
6. 字体：Schibsted Grotesk + IBM Plex Mono（见下）
7. 图标：Iconoir 加自绘领域图标，替换 Heroicons（见下）

## 字体决定（第二轮）

看过的参考站：

| 站点 | 字体 |
| --- | --- |
| beautifului.dev | Inter + JetBrains Mono，标题 −0.02em |
| beui.dev | Geist + Geist Mono，小号大写标签 +0.22em |
| rareui.com | 正文 Inter，展示用 openRunde，等宽 Geist Mono |
| transitions.dev | Inter，展示用 Saans 500，等宽 Roboto Mono |
| ui.shadcn.com | Geist |

取用的是做法，不是字体：标题收紧字距、等宽小号大写标签放开字距、展示字和正文拉开字重。Inter 和 Geist 到处都是，用了反而没有辨识度。

- **无衬线：Schibsted Grotesk**（SIL OFL 1.1）。它是为报业集团设计的怪诞体，有印刷和报刊的来历，和「印版与分镜稿」的方向一致；字重够厚，和中文黑体放在一起不发虚。
  - 落选的有：Bricolage Grotesque（41 KB，太花哨）、Instrument Sans（30 KB，太接近 Inter）。
- **等宽：IBM Plex Mono**（SIL OFL 1.1）。它有打字机和工程图纸的气质，用在帧号、时间码和 ID 上像分镜表上的打字标注。
  - 落选的有：Geist Mono，太像 Vercel 系。
- **中文：不加载网络字体。** 子集化约 300 字也要约 75 KB，超出预算；用户输入的文字还会落回系统字体，同一段里会混出两种中文字形。所以只整理系统中文字体的顺序，并把正文行距调到 1.6。
- **预算：** 首次加载的字体不超过 120 KB，现在是 59.5 KB。`check-bundle-budget.mjs` 会检查。

## 标题字体与字标（第三轮）

做了 4 个字标方向和 6 组标题字体对比（对比图在 `.devdata/screens/logo-options.png`、`display-type-options.png`），选定：

- **字标 C「套版错位」（第四轮已换掉）：** 只有「Oii」印成青、群青两版并错开 0.042em，「open」保持单色。这样小到顶栏 16px 高时「open」仍然清楚，错位只落在品牌名的那半边。favicon 用同样的两版错位圆环。
- **2026-10 更新：** 标题字体换成得意黑 Smiley Sans（子集改名 openOii Display），中文和拉丁同一族；理由和字号下限见 DESIGN.md §3。下面是 P5 的原始记录。
- **标题字体 P5：** 拉丁用 Unbounded 700，中文用站酷庆科黄油体。两者都是方正、宽、带一点圆角的几何字，放在一起像同一套印刷标题字。
  - 中文只子集化标题用到的字（约 70 字，18.2 KB），字表在 `public/fonts/display-cjk.chars.txt`，测试会拦住缺字的新标题。
  - 只给固定文案用；含用户内容的标题用 `plainTitle` 退回正文字体，避免缺字时混出两种中文字形。
  - Unbounded 很宽，所以只用在短标题上，字距收 −0.01em。
- **预算：** 字体共 87.4 KB，仍在 120 KB 内；标题字体不预加载。

## 字标字体（第四轮）

字标 C 的错位在顶栏尺寸下显得单调又多余。对比了 6 种只含字的字标（`.devdata/screens/logo-type-options.png`：Unbounded 500、Syne 800、Bricolage Grotesque 窄体、Instrument Serif Italic、Fraunces、Darker Grotesque），选定 **Instrument Serif Italic**：

- 「open」墨色、「Oii」群青，只有字，去掉了青版错位和相关样式。
- 方正宽大的庆科黄油体 / Unbounded 标题配一个细的衬线斜体字标，对比很强：标题像分镜稿上的大字，字标像片头的署名。
- 字形转成路径内联，不加载字体。favicon 用斜体「Oi」：单个斜体 O 在 16px 下像数字 0。

## 图标决定（第二轮）

参考站上的图标：beui.dev 和 ui.shadcn.com 用 Lucide；transitions.dev 是自绘图标，描边 1.4–1.5；rareui.com 和 beautifului.dev 的图标都很少，靠字和线撑场面。

- **评估过的图标库：**
  - Lucide 和 Heroicons：到处都在用，正是「模板味」的来源；
  - Phosphor：粗细档位多，但默认偏圆胖；
  - Tabler：2px 描边，太重；
  - Radix：15 网格，和 24 网格对不齐；
  - Huge Icons：免费版限制多。
- **选 Iconoir（MIT）：** 原生就是 24 网格、1.5 描边，线条偏几何，像绘图仪画出来的，和「印版与分镜稿」的方向一致；而且很少见。
  - 只把路径数据拷进 `SvgIcon` 的注册表，并在注释里写明出处，不加运行时依赖。
  - `@heroicons/react` 已经移除，JS 总量从 231.2 KB 降到 225.2 KB（gzip）。
- **自绘领域图标**，用同一网格和描边：
  - 镜头：取景框加四角裁切标；
  - 分镜稿：2×2 格；
  - 渲染：胶片框加片孔加播放；
  - 审批关卡：门柱加横梁加勾；
  - 对位标、裁切标、网点（screentone）。

  画布卡片头、项目切换和「适配视图」都换成了这些领域图标，不再借用星星、灯泡、场记板这类通用隐喻。

- **中文标签不走等宽大写：** 中文没有大小写，等宽字体和字距只会把字撑散。
  - 中文标签用 `.label`：无衬线、不加字距；
  - 只有数字或拉丁部分包 `font-mono`，比如「格 {n}」；
  - 设计契约测试会拦住写死在 `label-caps` / `font-mono` / `uppercase` / `tracking-wide*` 里的中文。动态 `{label}` 拦不到，靠评审。
- **字体换入不跳行：** Schibsted Grotesk 后面紧跟一个按其量度校准的本地兜底（Arial / Helvetica / Liberation Sans）：
  - `size-adjust: 104.92%`
  - `ascent-override: 93.07%`
  - `descent-override: 24.57%`
  - `line-gap-override: 0%`

  数值用 fontTools 从 woff2 算出，方法同 capsize：按英文字频加权平均字宽，0.463em 对 0.441em。
