import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComicWorkflowNode } from "../../graph/types";
import { CardContextMenu, menuPosition } from "./CardContextMenu";

vi.mock("../../inspector/GenerationSection", () => ({
	GenerationSection: ({ compact }: { compact?: boolean }) => (
		<button type="button">{compact ? "重做首帧" : "full"}</button>
	),
}));

const node = { id: "shot:1", kind: "shot", title: "格 1" } as unknown as ComicWorkflowNode;

describe("CardContextMenu", () => {
	it("reuses the compact generation actions and focuses the first one", () => {
		render(
			<CardContextMenu menu={{ node, x: 10, y: 10 }} projectId={1} structureLocked={false} onClose={vi.fn()} />,
		);
		expect(screen.getByRole("region", { name: "格 1 的操作" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重做首帧" })).toHaveFocus();
	});

	it("closes on Escape and on an outside pointer", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(
			<CardContextMenu menu={{ node, x: 10, y: 10 }} projectId={1} structureLocked={false} onClose={onClose} />,
		);
		await user.keyboard("{Escape}");
		await user.click(document.body);
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("keeps the menu inside the canvas near the edges", () => {
		const box = { left: 100, top: 50, width: 800, height: 600 };
		expect(menuPosition({ x: 150, y: 80 }, box)).toEqual({ x: 50, y: 30 });
		expect(menuPosition({ x: 890, y: 640 }, box)).toEqual({ x: 552, y: 272 });
	});
});
