import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { canvasEvents } from "~/components/canvas/canvasEvents";
import { versionsApi } from "~/services/api";
import type { Character } from "~/types";
import type { ComicWorkflowNode } from "../graph/types";
import { WorkflowInspector } from "./WorkflowInspector";

function renderWithClient(ui: React.ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function character(): Character {
	return {
		id: 1,
		project_id: 15,
		name: "阿一",
		description: "主角",
		image_url: null,
		reference_images: [],
		has_embedding: false,
		visual_notes: null,
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_name: null,
		approved_description: null,
		approved_image_url: null,
	};
}

function characterNode(): ComicWorkflowNode {
	const entity = character();
	return {
		id: "character:1",
		kind: "character",
		section: "elements",
		title: "阿一",
		subtitle: "角色设定",
		status: "review",
		entityId: 1,
		character: entity,
		imageUrl: null,
	};
}

describe("WorkflowInspector", () => {
	it("shows an empty state when nothing is selected", () => {
		render(
			<WorkflowInspector
				projectId={15}
				selectedNode={null}
				structureLocked={false}
			/>,
		);

		expect(screen.getByText("选择画布卡片")).toBeInTheDocument();
		expect(screen.getByText("可多选分镜格 · 批量重做本格")).toBeInTheDocument();
	});

	it("locks write actions while generation is active", async () => {
		const user = userEvent.setup();
		renderWithClient(
			<WorkflowInspector
				projectId={15}
				selectedNode={characterNode()}
				structureLocked
			/>,
		);

		await user.click(screen.getByRole("tab", { name: "生成" }));

		expect(screen.getByText("生成运行中，结构写入操作已锁定。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /批准/ })).toBeDisabled();
	});

	it("splits the inspector into four sections, starting at 概览", async () => {
		const user = userEvent.setup();
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked={false} />);

		for (const name of ["概览", "属性", "生成", "历史"]) {
			expect(screen.getByRole("tab", { name })).toBeInTheDocument();
		}
		// 和卡片同一个词：卡片是「待确认」，这里也是
		expect(screen.getByText("待确认")).toBeInTheDocument();
		expect(screen.queryByText("审阅状态")).toBeNull();

		await user.click(screen.getByRole("tab", { name: "属性" }));
		expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
	});

	it("names the node kind in Chinese instead of the internal enum", () => {
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked={false} />);
		expect(screen.getByText("角色", { selector: "p" })).toBeInTheDocument();
		expect(screen.queryByText("character")).toBeNull();
	});

	it("at a gate lets you edit properties, and says how to change results instead of a bare lock", async () => {
		const user = userEvent.setup();
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked atGate />);

		await user.click(screen.getByRole("tab", { name: "生成" }));
		expect(screen.getByRole("note")).toHaveTextContent("提修改意见");
		expect(screen.queryByText(/结构写入操作已锁定/)).toBeNull();
		const redo = screen.getByRole("button", { name: "重新生成当前角色" });
		expect(redo).toBeDisabled();

		await user.click(screen.getByRole("tab", { name: "属性" }));
		expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled();
	});

	it("while running, properties stay locked", async () => {
		const user = userEvent.setup();
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked />);
		await user.click(screen.getByRole("tab", { name: "生成" }));
		expect(screen.getByRole("note")).toHaveTextContent("生成运行中");
	});

	it("opens the version compare drawer for the selection from 历史", async () => {
		const user = userEvent.setup();
		const seen = vi.fn();
		const off = canvasEvents.on("version-history", seen);
		vi.spyOn(versionsApi, "list").mockResolvedValue({
			entity_type: "character",
			entity_id: 1,
			versions: [{ id: 1, entity_type: "character", entity_id: 1, version: 1, snapshot: { name: "旧名" }, trigger: "generation", created_at: "" }],
		});
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked={false} />);

		await user.click(screen.getByRole("tab", { name: "历史" }));
		expect(screen.getByText("1 次")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "对比生成版本" }));
		expect(seen).toHaveBeenCalledWith({ entityType: "character", entityId: 1 });
		off();
	});

	it("disables 对比 when the only snapshot equals the current entity", async () => {
		const user = userEvent.setup();
		vi.spyOn(versionsApi, "list").mockResolvedValue({ entity_type: "character", entity_id: 1, versions: [{ id: 1, entity_type: "character", entity_id: 1, version: 1, snapshot: { name: "阿一", description: "主角" }, trigger: "generation", created_at: "" }] });
		renderWithClient(<WorkflowInspector projectId={15} selectedNode={characterNode()} structureLocked={false} />);
		await user.click(screen.getByRole("tab", { name: "历史" }));
		expect(await screen.findByText("只有一个版本，重新生成或修改后才能对比。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "对比生成版本" })).toBeDisabled();
	});
});
