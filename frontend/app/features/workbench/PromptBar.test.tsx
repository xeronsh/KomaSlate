import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "~/stores/editorStore";
import { PromptBar } from "./PromptBar";

vi.mock("~/utils/toast", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const base = {
	selection: [],
	gateLabel: null,
	awaitingConfirm: false,
	onSend: vi.fn(),
};

describe("PromptBar", () => {
	beforeEach(() => {
		useEditorStore.getState().setRunMode("manual");
		vi.clearAllMocks();
	});

	it("shows [整个项目] without a selection", () => {
		render(<PromptBar {...base} />);
		expect(screen.getByText("整个项目")).toBeInTheDocument();
		expect(screen.getByRole("textbox")).toHaveAttribute(
			"placeholder",
			"向 pi-agent-core 助手提问，或让它重画、修改…",
		);
	});

	it("shows one chip per selected object and removes one", async () => {
		const onRemoveSelection = vi.fn();
		render(
			<PromptBar
				{...base}
				selection={[
					{ id: "shot:1", label: "分镜 S01" },
					{ id: "character:2", label: "角色 小猫" },
				]}
				onRemoveSelection={onRemoveSelection}
			/>,
		);

		expect(screen.queryByText("整个项目")).not.toBeInTheDocument();
		expect(screen.getByText("分镜 S01")).toBeInTheDocument();
		expect(screen.getByText("角色 小猫")).toBeInTheDocument();
		expect(screen.getByRole("textbox")).toHaveAttribute(
			"placeholder",
			"向助手提问或调整所选内容…",
		);

		await userEvent.click(screen.getByRole("button", { name: "移除 分镜 S01" }));
		expect(onRemoveSelection).toHaveBeenCalledWith("shot:1");
	});

	it("sends with Enter and keeps Shift+Enter for a new line", async () => {
		const onSend = vi.fn();
		render(<PromptBar {...base} onSend={onSend} />);

		await userEvent.type(screen.getByRole("textbox"), "第一行{Shift>}{Enter}{/Shift}第二行{Enter}");
		expect(onSend).toHaveBeenCalledWith("第一行\n第二行");
	});

	it("puts the draft back when the message was not sent", async () => {
		const onSend = vi.fn().mockResolvedValue(false);
		render(<PromptBar {...base} onSend={onSend} />);

		await userEvent.type(screen.getByRole("textbox"), "重画这一格{Enter}");
		expect(onSend).toHaveBeenCalledWith("重画这一格");
		expect(await screen.findByDisplayValue("重画这一格")).toBeInTheDocument();
	});

	it("decouples approval gate: delivers @助手 messages to onSend even while awaitingConfirm (AUD-UI-16 / ENG-07)", async () => {
		const onSend = vi.fn();
		render(<PromptBar {...base} awaitingConfirm gateLabel="规划" onSend={onSend} />);

		expect(screen.getByTestId("prompt-gate-indicator")).toHaveTextContent(
			"规划 · 审批门挂起（自由对话）",
		);
		expect(screen.queryByRole("button", { name: "确认继续" })).not.toBeInTheDocument();

		await userEvent.type(screen.getByRole("textbox"), "@助手 帮我看看第一镜节奏{Enter}");
		expect(onSend).toHaveBeenCalledWith("@助手 帮我看看第一镜节奏");
	});

	it("toggles 逐步确认 / 自动确认 without silently approving an open gate", async () => {
		const onSend = vi.fn();
		const { rerender } = render(<PromptBar {...base} onSend={onSend} />);

		await userEvent.click(screen.getByRole("button", { name: "切换自动确认" }));
		expect(useEditorStore.getState().runMode).toBe("yolo");
		expect(screen.getByText("自动确认")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "切换逐步确认" }));
		rerender(<PromptBar {...base} awaitingConfirm gateLabel="规划" onSend={onSend} />);
		await userEvent.click(screen.getByRole("button", { name: "切换自动确认" }));
		expect(useEditorStore.getState().runMode).toBe("yolo");
		expect(onSend).not.toHaveBeenCalled();
	});
});
