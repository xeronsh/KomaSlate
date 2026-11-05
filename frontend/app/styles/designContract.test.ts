/**
 * Design Contract 守卫（ADR 0002）。
 *
 * tokens.css 是 SSOT；tailwind.config.ts 把 token 映射成裸类。
 * 因此代码里**不许**再出现绕过映射的写法：
 *   text-[length:var(--text-sm)]  →  text-sm
 *   rounded-[var(--radius-md)]    →  rounded-md
 *   z-[var(--z-toast)]            →  z-toast
 *   duration-[var(--duration-fast)] → duration-fast
 * 以及不许脱离尺子：text-[11px]、z-9999、rounded-2xl、裸 hex 颜色。
 *
 * themeContrast.test.ts 管颜色对比度，这个文件管几何。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";

const root = resolve(__dirname, "../..");
const sources = globSync("app/**/*.{ts,tsx}", { cwd: root })
	.filter((f) => !f.includes(".test."))
	.map((f) => ({ file: f, text: readFileSync(resolve(root, f), "utf-8") }));

const config = tailwindConfig as unknown as {
	theme: { extend: Record<string, Record<string, string> | undefined> };
};
const extend = config.theme.extend;

/** 禁止的写法 → 替换建议 */
const BANNED: Array<[RegExp, string]> = [
	[/\[(?:length:)?var\(--text-/, "用裸类 text-sm / text-xs（已在 tailwind.config.ts 映射）"],
	[/\[var\(--radius-/, "用裸类 rounded-md / rounded-lg（已在 tailwind.config.ts 映射）"],
	[/z-\[var\(--z-/, "用裸类 z-toast / z-popover（已在 tailwind.config.ts 映射）"],
	[/duration-\[var\(--duration-/, "用裸类 duration-fast（已在 tailwind.config.ts 映射）"],
	[/leading-\[var\(--leading-/, "用裸类 leading-tight / leading-normal（已在 tailwind.config.ts 映射）"],
	[/\btext-\[\d+px\]/, "脱离 type scale：用 text-xs(12) / text-sm"],
	[/\bz-\[\d{3,}\]/, "脱离 z scale：tokens.css 的 --z-* 才是唯一分层来源"],
	[/\bz-[1-9]\d\b/, "脱离 z scale：用 z-popover / z-panel / z-toast 等命名层"],
	[/\brounded-(?:2xl|3xl|none)\b/, "超出 --radius-* 四档：用 rounded-sm/md/lg/xl"],
	[/#[0-9a-fA-F]{6}\b/, "裸 hex：颜色只能来自 tokens.css 的语义令牌"],
	[/gap-\[var\(--rhythm-/, "用裸类 gap-2/3/5（= --rhythm-item/block/zone）"],
	[/\b(?:p|m|gap|space)-\[var\(--space-/, "用裸类 p-2 / gap-3（已在 tailwind.config.ts 映射）"],
	[/\bleading-(?:[0-9]|\[)/, "脱离 leading 三档：leading-tight(1.15) / snug(1.35) / normal(1.5)"],
	[/\btext-(?:default|inherit)\b/, "字体尺寸必须来自 type scale"],
	[/\bshadow-(?:brutal|comic)/, "硬偏移阴影已删除：浮层用 shadow-panel，成片卡用 comic-frame"],
	[/\bfont-(?:heading|comic|sketch|brand)\b/, "字体只有 font-sans / font-mono；字标是对位标 + 系统无衬线"],
	[/\bhalftone/, "网点只用于 spec §7.6 的位置"],
	[/className="[^"]*\b(?:label-caps|font-mono|uppercase|tracking-wid[a-z]*)\b[^"]*"[^>]*(?<!=)>[^<{]*[\u4e00-\u9fff]/, "中文标签不用等宽、不转大写、不加字距：用 .label，数字部分再包 font-mono"],
	[/\beyebrow="[^"]*[A-Za-z]/, "页眉 eyebrow 用中文栏目名（如「作品库 · 项目」），不写英文路径"],
	[/\blabel-caps\b/, "英文大写栏目名已退役：栏目名用中文 .label，编号再包 font-mono"],
	[/@heroicons\//, "图标只走 SvgIcon（Iconoir + 自绘领域图标），不再引 Heroicons"],
	[/[\u4e00-\u9fff]\.\.\.|"\.\.\."/, "三个点：文案里的省略用 …（Vercel guidelines）"],
	// polish pass（docs/research/polish-pass.md）
	[/\brounded-xl\b/, "卡片/面板用 rounded-lg（xl 与 lg 同值，只留一种写法）"],
	[/["'`\s]rounded(?=["'`\s])/, "裸 rounded：写明 rounded-sm / md / lg / full"],
	[/\bborder-ink\/\d/, "边框颜色用 border-line / border-line-strong / border-border-strong"],
	[/\btext-ink\/\d/, "文字颜色用 text-ink / ink-muted / ink-subtle；装饰图形 ink-faint"],
	[/\bborder-3\b/, "边框 1px；2px 只用于选中、tab 下划线、左侧强调条"],
	[/\bfocus:outline-none\b/, "不许去掉焦点环（:focus-visible 全局 2px primary）"],
	[/animate-spin rounded-full border/, "转圈用 spinner-doodle"],
	[/\bunderline-sketch\b/, "黄色波浪线已退役：卡片标题用 border-b border-line 细线分隔"],
	[/\bcheckbox-(?:xs|sm|md|lg)\b/, "DaisyUI 复选框类已退役：统一使用 .checkbox-doodle"],
];

/**
 * 任意值白名单：新增 *-[…] 必须先在这里登记（或改成 token）。
 * 只放一次性的布局几何；重复出现的值请进 tokens.css。
 */
const ARBITRARY_ALLOWED = new Set([
	"[field-sizing:content]",
	"aspect-[4/3]",
	"grid-cols-[2.75rem_minmax(0,1fr)_7rem_7rem_2.75rem]",
	"grid-cols-[auto_minmax(0,1fr)_auto]",
	"grid-cols-[minmax(0,1fr)_7rem_7rem_2.75rem]",
	"grid-cols-[minmax(0,1fr)_auto]",
	"grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
	"max-h-[45%]",
	"max-h-[90vh]",
	"max-h-[92dvh]",
	"max-w-[22rem]",
	"min-[1400px]",
	"min-h-[...]",
	"min-w-[3.25rem]",
	"w-[min(720px,calc(100%-1.5rem))]",
	"w-[min(96vw,76rem)]",
]);
const ARBITRARY = /(?<![\w\-[])-?[a-z][a-z0-9-]*-\[[^\]\s"'`]+\]|(?<![\w-])\[[a-z-]+:[a-z-]+\]/g;

/** 漫画点缀白名单（spec §7.6）：CMYK 偏移框只在成片卡上 */
const COMIC_FRAME_OWNERS = ["app/features/comic-workflow/canvas/WorkflowCards.tsx"];

/** 弹层只有一个原语：ui/Dialog（原生 <dialog> 顶层），其余文件不许手搓 */
const DIALOG_OWNERS = ["app/components/ui/Dialog.tsx", "app/setupTests.ts"];
const HAND_ROLLED_DIALOG: Array<[RegExp, string]> = [
	[/role=["{]["']?dialog/, "role=dialog"],
	[/aria-modal/, "aria-modal"],
	[/dialog-overlay|z-modal-backdrop/, "自绘遮罩"],
	[/<dialog\b/, "直接写 <dialog>"],
];

/** alpha 阶梯：只允许 5 的倍数，防止 /8 /12 /65 /85 这类随手档 */
const ALPHA = /\b(?:border|bg|text|from|to|via|ring|outline|divide|decoration|placeholder)-[a-z0-9-]+\/(\d{1,3})\b/g;

describe("Design Contract: geometry 走 token 映射", () => {
	it.each(BANNED)("源码不含 %s", (pattern, hint) => {
		const hits = sources
			.filter(({ text }) => pattern.test(text))
			.map(({ file }) => file);
		expect(hits, `${hint}\n违规文件：\n${hits.join("\n")}`).toEqual([]);
	});
});

describe("Design Contract: 任意值只来自白名单", () => {
	it("没有未登记的 *-[…]", () => {
		const bad: string[] = [];
		for (const { file, text } of sources) {
			for (const m of text.matchAll(ARBITRARY)) {
				if (!ARBITRARY_ALLOWED.has(m[0])) bad.push(`${file}: ${m[0]}`);
			}
		}
		expect(bad, `改用 token，或有意登记到 ARBITRARY_ALLOWED：\n${bad.join("\n")}`).toEqual([]);
	});
});

describe("Design Contract: 图标尺寸走刻度", () => {
	// 12 行内元信息 · 14 密集 chrome · 16 默认 · 20 醒目 · 24/32 空状态；8 只给 14px 角标
	const ICON_SCALE = new Set([8, 12, 14, 16, 20, 24, 32]);
	it("SvgIcon size 只取刻度值", () => {
		const bad: string[] = [];
		for (const { file, text } of sources) {
			for (const m of text.matchAll(/<SvgIcon\b[^>]*\bsize=\{(\d+)\}/g)) {
				if (!ICON_SCALE.has(Number(m[1]))) bad.push(`${file}: size=${m[1]}`);
			}
		}
		expect(bad).toEqual([]);
	});
});

describe("Design Contract: 弹层统一走 ui/Dialog", () => {
	it("comic-frame 只出现在白名单文件", () => {
		const hits = sources
			.filter(({ file, text }) => /\bcomic-frame\b/.test(text) && !COMIC_FRAME_OWNERS.includes(file))
			.map(({ file }) => file);
		expect(hits).toEqual([]);
	});

	it("原生 <button 只在 components/ui 与画布内部出现（其余用 Button / IconButton / PlainButton）", () => {
		const hits = sources
			.filter(
				({ file, text }) =>
					/<button\b/.test(text) &&
					!file.startsWith("app/components/ui/") &&
					!file.startsWith("app/features/comic-workflow/canvas/"),
			)
			.map(({ file }) => file);
		expect(hits).toEqual([]);
	});

	it.each(HAND_ROLLED_DIALOG)("源码不含 %s（%s）", (pattern) => {
		const hits = sources
			.filter(({ file, text }) => !DIALOG_OWNERS.includes(file) && pattern.test(text))
			.map(({ file }) => file);
		expect(hits, `用 ~/components/ui/Dialog：\n${hits.join("\n")}`).toEqual([]);
	});
});

describe("Design Contract: 运行进度只经 deriveStudioStatus 读取", () => {
	// 进度条只能吃 StudioStatus.progress（运行不活跃时为 null），避免"成片可用 + 8%"
	it("组件不直接接收或读取 run progress", () => {
		const hits = sources
			.filter(({ file, text }) =>
				/\bprogress=\{/.test(text) ||
				(file !== "app/features/workbench/ProjectWorkbench.tsx" && /\brunProgress\b/.test(text)),
			)
			.map(({ file }) => file);
		expect(hits, `用 deriveStudioStatus(...).progress：\n${hits.join("\n")}`).toEqual([]);
	});

	it("ProjectWorkbench 只把 runProgress 交给 deriveStudioStatus", () => {
		const text = sources.find(({ file }) => file === "app/features/workbench/ProjectWorkbench.tsx")!.text;
		const uses = text.match(/\brunProgress\b/g) ?? [];
		// 解构、deriveStudioStatus 入参、useMemo 依赖
		expect(uses).toHaveLength(3);
		expect(text).toMatch(/deriveStudioStatus\(\{[^}]*progress: runProgress/);
	});
});

describe("Design Contract: 不透明度阶梯是 5 的倍数", () => {
	it("源码不含 /8 /12 /65 这类随手档", () => {
		const bad: string[] = [];
		for (const { file, text } of sources) {
			for (const m of text.matchAll(ALPHA)) {
				if (Number(m[1]) % 5 !== 0) bad.push(`${file}: ${m[0]}`);
			}
		}
		expect(bad, `超纲档位：\n${bad.join("\n")}`).toEqual([]);
	});
});

describe("Design Contract: tailwind 映射与 tokens.css 一致", () => {
	const tokens = readFileSync(resolve(root, "app/styles/tokens.css"), "utf-8");

	/** tokens.css 里 --name 的值（第一个匹配，即 :root 块） */
	function token(name: string): string {
		const m = tokens.slice(0, tokens.indexOf('[data-theme="dark"]')).match(
			new RegExp(`\\${name}:\\s*([^;]+);`),
		);
		if (!m) throw new Error(`tokens.css 缺 ${name}`);
		return m[1].trim();
	}

	it("radius 四档全部映射到 --radius-*", () => {
		const scale = extend.borderRadius as Record<string, string>;
		for (const key of ["sm", "md", "lg", "xl"] as const) {
			expect(scale[key], `borderRadius.${key}`).toBe(`var(--radius-${key})`);
		}
	});

	it("type scale 全部映射到 --text-*", () => {
		const scale = extend.fontSize as Record<string, string>;
		for (const key of ["xs", "sm", "base", "md", "lg", "xl", "2xl"] as const) {
			expect(scale[key], `fontSize.${key}`).toBe(`var(--text-${key})`);
		}
	});

	it("字号下限 12px：--text-2xs 与 text-2xs 不再存在", () => {
		expect(tokens).not.toContain("--text-2xs");
		expect(extend.fontSize).not.toHaveProperty("2xs");
		const hits = sources.filter(({ text }) => /\btext-2xs\b/.test(text)).map(({ file }) => file);
		expect(hits).toEqual([]);
	});

	it("状态色作文字只用 *-fg；secondary / accent / primary-ink 已删除", () => {
		const hits = sources
			.filter(({ text }) =>
				/(?<![\w-])text-(?:success|warning|error|info)(?![\w-])|\b(?:bg|text|border)-(?:secondary|accent)\b|primary-ink/.test(text),
			)
			.map(({ file }) => file);
		expect(hits).toEqual([]);
		expect(tokens).not.toMatch(/--color-(?:secondary|accent)|--primary-ink/);
	});

	it("spacing 档位与 --space-* 同名同值（8px 栅格）", () => {
		const scale = extend.spacing as Record<string, string>;
		for (const [key, value] of Object.entries(scale)) {
			expect(value, `spacing.${key}`).toBe(`var(--space-${key})`);
			// --space-1: 0.25rem → 4px，栅格必须是 4 的整数倍
			const rem = parseFloat(token(`--space-${key}`).replace("rem", ""));
			expect(rem % 0.25, `--space-${key} = ${rem}rem 不在 4px 栅格上`).toBe(0);
		}
	});

	it("z-index 分层只来自 --z-*", () => {
		const scale = extend.zIndex as Record<string, string>;
		const declared = [...tokens.matchAll(/--(z-[a-z-]+):/g)].map((m) => m[1]);
		for (const name of declared) {
			const key = name.replace(/^z-/, "");
			expect(scale?.[key], `zIndex.${key} 未映射`).toBe(`var(--${name})`);
		}
	});

	it("每个映射的 token 都真实存在于 tokens.css", () => {
		for (const [group, scale] of Object.entries(extend)) {
			if (!scale) continue;
			for (const value of Object.values(scale)) {
				const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
				if (!m) continue;
				expect(tokens, `${group} → ${m[1]} 未定义`).toContain(`${m[1]}:`);
			}
		}
	});
});
