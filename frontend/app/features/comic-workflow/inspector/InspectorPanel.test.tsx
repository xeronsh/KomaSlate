import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComicWorkflowNode } from "../graph/types";
import { InspectorPanel } from "./InspectorPanel";

vi.mock("./WorkflowInspector", () => ({
	WorkflowInspector: ({ selectedNode }: { selectedNode: ComicWorkflowNode | null }) => (
		<div data-testid="workflow-inspector">{selectedNode?.id}</div>
	),
}));
vi.mock("./UniverseTimelinePanel", () => ({
	UniverseTimelinePanel: () => <div data-testid="universe-timeline" />,
}));

const brief = { id: "brief" } as ComicWorkflowNode;
const shot = { id: "shot:1" } as ComicWorkflowNode;
const base = { projectId: 1, structureLocked: false, briefNode: brief, onOpenChange: vi.fn() };

describe("InspectorPanel", () => {
	it("shows the project view with the universe timeline when nothing is selected", () => {
		render(<InspectorPanel {...base} selectedNode={null} universeId={3} open />);

		// 面板标题始终是「检查器」：「项目」只由内容头部（项目概要 · 标题）说一次
		expect(screen.getByRole("heading", { name: "检查器" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "项目" })).toBeNull();
		expect(screen.getByTestId("workflow-inspector")).toHaveTextContent("brief");
		expect(screen.getByTestId("universe-timeline")).toBeInTheDocument();
	});

	it("shows the selection without the timeline", () => {
		render(<InspectorPanel {...base} selectedNode={shot} universeId={3} open />);

		expect(screen.getByTestId("workflow-inspector")).toHaveTextContent("shot:1");
		expect(screen.queryByTestId("universe-timeline")).not.toBeInTheDocument();
	});

	it("collapses into a pill and reopens", async () => {
		const onOpenChange = vi.fn();
		const { rerender } = render(<InspectorPanel {...base} selectedNode={shot} open onOpenChange={onOpenChange} />);

		await userEvent.click(screen.getByRole("button", { name: "收起检查器" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);

		rerender(<InspectorPanel {...base} selectedNode={shot} open={false} onOpenChange={onOpenChange} />);
		expect(screen.queryByTestId("workflow-inspector")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "展开检查器" }));
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});

	it("collapses on Escape", async () => {
		const onOpenChange = vi.fn();
		render(<InspectorPanel {...base} selectedNode={shot} open onOpenChange={onOpenChange} />);

		screen.getByRole("button", { name: "收起检查器" }).focus();
		await userEvent.keyboard("{Escape}");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("renders as a non-floating docked sidebar and omits the floating pill when docked", () => {
		const { rerender } = render(
			<InspectorPanel {...base} selectedNode={shot} open={false} docked />,
		);
		expect(screen.queryByRole("button", { name: "展开检查器" })).toBeNull();
		expect(screen.queryByRole("complementary", { name: "检查器" })).toBeNull();

		rerender(<InspectorPanel {...base} selectedNode={shot} open docked />);
		const aside = screen.getByRole("complementary", { name: "检查器" });
		expect(aside.className).not.toContain("absolute");
		expect(aside).toHaveClass("shrink-0", "border-l");
	});
});
