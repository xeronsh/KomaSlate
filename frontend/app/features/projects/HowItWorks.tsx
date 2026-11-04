import { SvgIcon } from "~/components/ui/SvgIcon";

const STEPS = [
	{ code: "01", title: "剧本拆解与定妆", body: "输入故事梗概，按阶段展开大纲、角色定妆卡与九宫格分镜台本。" },
	{ code: "02", title: "锁镜定点重拍", body: "已批准镜头自动锁定保护；选中任意单镜可定向微调重绘，并双栏对比回退历史版本。" },
	{ code: "03", title: "成片或剪辑包交付", body: "既可直接合成配音字幕成片，也可导出含 FCPXML 时间线的专业剪辑资产包。" },
];

const TERMS = [
	{ term: "宇宙", body: "多部作品共享的角色立绘与世界观；新项目可作为其中一章延续形象。" },
	{ term: "自动确认", body: "阶段自动通过，一口气生成到成片；随时可在底部提示栏切回逐步确认。" },
	{ term: "待处理", body: "所有需要你拍板的节点都收在左栏「待处理」标签：确认、重拍、回退。" },
];

/** 首次使用引导：没有项目时默认展开，之后收成一行 */
export function HowItWorks({ defaultOpen }: { defaultOpen: boolean }) {
	return (
		<details
			open={defaultOpen}
			className="group rounded-lg border border-line bg-surface px-3 py-2.5 sm:px-4"
		>
			<summary className="touch-target-dense flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
				<SvgIcon name="lightbulb" size={16} />
				场记台工作流
				<span className="text-xs font-normal text-ink-muted">非破坏性分镜 · 三步交付</span>
				<SvgIcon
					name="chevron-right"
					size={14}
					className="ml-auto text-ink-muted transition-transform duration-fast group-open:rotate-90"
				/>
			</summary>
			<ol className="m-0 mt-2.5 grid list-none gap-3 p-0 sm:grid-cols-3">
				{STEPS.map((step) => (
					<li key={step.code} className="flex gap-2.5 rounded-md border border-line bg-paper-100/70 p-2.5">
						<span className="flex h-6 shrink-0 items-center justify-center rounded-sm border border-primary/25 bg-primary/10 px-1.5 font-mono text-xs font-bold text-primary">
							{step.code}
						</span>
						<div className="min-w-0">
							<p className="m-0 text-sm font-semibold text-ink">{step.title}</p>
							<p className="m-0 mt-0.5 text-xs leading-relaxed text-ink-muted">{step.body}</p>
						</div>
					</li>
				))}
			</ol>
			<dl className="m-0 mt-3 grid gap-2 border-t border-line pt-3 pb-1 sm:grid-cols-3">
				{TERMS.map((item) => (
					<div key={item.term} className="min-w-0">
						<dt className="text-xs font-semibold text-ink">{item.term}</dt>
						<dd className="m-0 text-xs leading-relaxed text-ink-muted">{item.body}</dd>
					</div>
				))}
			</dl>
		</details>
	);
}
