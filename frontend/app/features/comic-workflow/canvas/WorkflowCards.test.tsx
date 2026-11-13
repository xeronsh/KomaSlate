import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ComicWorkflowNode } from "../graph/types";
import { WorkflowCardView, WorkflowLodContext } from "./WorkflowCards";

const camera = "中景，缓慢推近至阿岚与橘猫并肩的近景，最后停在窗外的海面";
const names = "阿岚、橘猫、灯塔看守人、远处的渔船船长";

const shot = {
	id: "shot:1",
	kind: "shot",
	entityId: 1,
	title: "S01",
	subtitle: "镜头 1",
	status: "ready",
	imageUrl: null,
	videoUrl: null,
	gridCell: 1,
	characterNames: names.split("、"),
	shot: { id: 1, order: 1, revision: 3, description: "灯室", dialogue: null, camera, duration: 4 },
} as unknown as ComicWorkflowNode;

describe("WorkflowCardView tag pills", () => {
	it("keeps long camera and cast tags on one line inside Radix Tooltip", () => {
		render(<WorkflowCardView node={shot} />);
		for (const text of [camera, names]) {
			const pill = screen.getByText(text);
			expect(pill).toHaveTextContent(text);
			// inline-flex 不省略文字；inline-block + truncate 才会一行带省略号
			expect(pill).toHaveClass("inline-block", "max-w-full", "truncate", "rounded-full");
			expect(pill).not.toHaveClass("inline-flex");
		}
	});
});

describe("WorkflowCardView Semantic LOD (AUD-UI-10)", () => {
	it("collapses into a readable macro capsule when zoom < 0.5", () => {
		const { container } = render(
			<WorkflowLodContext.Provider value="macro">
				<WorkflowCardView node={shot} />
			</WorkflowLodContext.Provider>,
		);
		expect(container.querySelector('[data-lod-view="macro"]')).toBeInTheDocument();
		expect(screen.getByText("SHOT")).toBeInTheDocument();
		expect(screen.getByText("S01")).toBeInTheDocument();
		expect(screen.queryByText(camera)).not.toBeInTheDocument();
	});

	it("reveals CAS revision and port metadata in micro LOD when zoom >= 1.2", () => {
		const { container } = render(
			<WorkflowLodContext.Provider value="micro">
				<WorkflowCardView node={shot} />
			</WorkflowLodContext.Provider>,
		);
		expect(container.querySelector('[data-lod-view="micro"]')).toBeInTheDocument();
		expect(screen.getByText("rev=3")).toBeInTheDocument();
		expect(screen.getByText(/in: cast\(4\) -> out: frame\/clip/)).toBeInTheDocument();
	});
});
