import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
	getStudioStatusMeta,
	type StudioStatus,
	type StudioStatusState,
} from "~/features/comic-workflow/state/deriveStudioStatus";
import { StudioControls } from "./StudioControls";

function renderControls(props: Partial<Parameters<typeof StudioControls>[0]> = {}) {
	return render(
		<StudioControls
			isGenerating={false}
			studioStatus={getStudioStatusMeta("idle")}
			awaitingConfirm={false}
			hasRecovery={false}
			onGenerate={vi.fn()}
			onCancel={vi.fn()}
			{...props}
		/>,
	);
}

const pill = () => screen.getByRole("button", { name: /^状态：/ });

describe("StudioControls", () => {
	it.each<[StudioStatusState, string]>([
		["idle", "待启动"],
		["ready", "成片可用"],
		["failed", getStudioStatusMeta("failed").label],
		["cancelled", getStudioStatusMeta("cancelled").label],
	])("shows the %s status label in the pill", (state, label) => {
		renderControls({ studioStatus: getStudioStatusMeta(state) });
		expect(pill()).toHaveTextContent(label);
		expect(screen.getByText(`工作台状态：${label}`)).toBeInTheDocument();
	});

	it("makes 下载成片 the primary action once the final cut exists", () => {
		renderControls({ studioStatus: getStudioStatusMeta("ready"), downloadUrl: "http://x/final.mp4" });
		const download = screen.getByRole("link", { name: "下载成片" });
		expect(download).toHaveAttribute("target", "_blank");
		expect(download.className).toContain("bg-primary");
		expect(screen.getByRole("button", { name: "重新生成" }).className).not.toContain("bg-primary");
	});

	it("names the stage and progress while generating, with a stop action", async () => {
		const user = userEvent.setup();
		const onCancel = vi.fn();
		const status: StudioStatus = {
			...getStudioStatusMeta("generating"),
			stage: "render",
			progress: 0.42,
			step: { index: 4, label: "分镜画面", atGate: false },
		};
		renderControls({ isGenerating: true, studioStatus: status, onCancel });

		// 步骤计数，不是会卡在 50% 的百分比
		expect(pill()).toHaveTextContent("生成中 · 分镜画面 · 5/6");
		expect(pill()).not.toHaveTextContent("%");
		expect(screen.queryByRole("button", { name: /开始生成|重新生成/ })).toBeNull();
		await user.click(screen.getByRole("button", { name: "停止" }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("says why 开始生成 is busy, and admits it is slow after 10 s", () => {
		vi.useFakeTimers();
		try {
			renderControls({ generatePending: true, generateDisabled: true });
			const button = screen.getByRole("button", { name: /正在创建/ });
			expect(button).toBeDisabled();
			expect(button).toHaveAttribute("aria-busy", "true");
			expect(screen.getByText("正在创建运行")).toBeInTheDocument();
			act(() => {
				vi.advanceTimersByTime(12_000);
			});
			expect(screen.getByRole("button", { name: /仍在连接模型… 12s/ })).toBeInTheDocument();
			expect(screen.getAllByText(/刷新页面后重试/).length).toBeGreaterThanOrEqual(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("offers the right generate label per state", () => {
		const { rerender } = renderControls();
		expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
		rerender(
			<StudioControls isGenerating={false} studioStatus={getStudioStatusMeta("ready")} awaitingConfirm={false} hasRecovery={false} onGenerate={vi.fn()} onCancel={vi.fn()} />,
		);
		expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
		rerender(
			<StudioControls isGenerating={false} studioStatus={getStudioStatusMeta("failed")} awaitingConfirm={false} hasRecovery={false} onGenerate={vi.fn()} onCancel={vi.fn()} />,
		);
		expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "重试失败阶段" })).toBeNull();
	});

	it("leaves resume and cancel to the inbox for a recoverable run", () => {
		renderControls({ hasRecovery: true, studioStatus: getStudioStatusMeta("recoverable") });
		expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
		expect(screen.queryByRole("button", { name: "停止当前任务" })).toBeNull();
		expect(screen.queryByRole("button", { name: "开始生成" })).toBeNull();
	});

	it("opens the inbox from the pill and highlights it while awaiting confirmation", async () => {
		const user = userEvent.setup();
		const onOpenInbox = vi.fn();
		renderControls({ awaitingConfirm: true, studioStatus: getStudioStatusMeta("awaitingConfirm"), onOpenInbox });

		expect(pill()).toHaveClass("bg-primary");
		expect(pill()).toHaveAttribute("title", "正在等待创作者确认后继续");
		expect(screen.queryByRole("button", { name: /开始生成|重新生成/ })).toBeNull();
		await user.click(pill());
		expect(onOpenInbox).toHaveBeenCalledTimes(1);
	});

	it("exposes versions and export through the tools menu", async () => {
		const user = userEvent.setup();
		const onOpenVersions = vi.fn();
		const onExport = vi.fn();
		renderControls({ onOpenVersions, onExport });

		const trigger = screen.getByRole("button", { name: "工作台工具" });
		await user.click(trigger);
		await user.click(screen.getByRole("menuitem", { name: "打开版本对比" }));
		await user.click(trigger);
		await user.click(screen.getByRole("menuitem", { name: "导出 Webtoon 长图" }));

		expect(onOpenVersions).toHaveBeenCalledTimes(1);
		expect(onExport).toHaveBeenCalledTimes(1);
	});

	it("omits the tools menu without handlers and disables export while generating", async () => {
		const user = userEvent.setup();
		const { unmount } = renderControls();
		expect(screen.queryByRole("button", { name: "工作台工具" })).toBeNull();
		unmount();

		const onExport = vi.fn();
		renderControls({ onExport, isGenerating: true, studioStatus: getStudioStatusMeta("generating") });
		await user.click(screen.getByRole("button", { name: "工作台工具" }));
		const exportItem = screen.getByRole("menuitem", { name: "导出 Webtoon 长图" });
		expect(exportItem).toBeDisabled();
		await user.click(exportItem);
		expect(onExport).not.toHaveBeenCalled();
	});

	describe("regenerate behind the ··· menu", () => {
		const finished = { studioStatus: getStudioStatusMeta("ready"), downloadUrl: "http://x/final.mp4" };

		it("moves 重新生成 into the menu and opens the confirm step instead of starting", async () => {
			const user = userEvent.setup();
			const onGenerate = vi.fn();
			const onRegenerate = vi.fn();
			renderControls({ ...finished, onGenerate, onRegenerate });

			expect(screen.queryByRole("button", { name: "重新生成" })).toBeNull();
			await user.click(screen.getByRole("button", { name: "工作台工具" }));
			await user.click(screen.getByRole("menuitem", { name: "重新生成（先确认）" }));
			expect(onRegenerate).toHaveBeenCalledTimes(1);
			expect(onGenerate).not.toHaveBeenCalled();
		});

		it("offers 恢复上一版 and the previous cut download from the menu", async () => {
			const user = userEvent.setup();
			const onRestorePrevious = vi.fn();
			renderControls({ ...finished, onRegenerate: vi.fn(), onRestorePrevious, previousDownloadUrl: "http://x/old.mp4" });

			await user.click(screen.getByRole("button", { name: "工作台工具" }));
			expect(screen.getByRole("menuitem", { name: /下载上一版成片/ })).toHaveAttribute("href", "http://x/old.mp4");
			await user.click(screen.getByRole("menuitem", { name: "恢复上一版" }));
			expect(onRestorePrevious).toHaveBeenCalledTimes(1);
		});

		it("shows a busy 开始生成 button while the run is being created", () => {
			renderControls({ generatePending: true, generateDisabled: true });
			const busy = screen.getByRole("button", { name: /正在创建/ });
			expect(busy).toBeDisabled();
			expect(busy).toHaveAttribute("aria-busy", "true");
		});
	});
});
