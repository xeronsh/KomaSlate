/**
 * SVG Cubic Bezier wiring & Semantic LOD geometry for the Option 3
 * Hybrid Node-Graph Workbench.
 *
 * Math spec (§3.2):
 *   dx = x2 - x1
 *   curvature = max(dx * 0.5, 48)
 *   P1 = (x1 + curvature, y1), P2 = (x2 - curvature, y2)
 *   d = M x1 y1 C cx1 cy1, cx2 cy2, x2 y2
 */

export type HybridNodeKind =
	| "wf_stage"
	| "wf_gate"
	| "agent_core"
	| "mcp_out"
	| "cli_runner"
	| "mcp_inbound";

export type HybridNodeStatus =
	| "idle"
	| "running"
	| "waiting"
	| "ready"
	| "warn"
	| "error";

export type SemanticLodTier = "macro" | "mid" | "micro";

export interface NodeDimensions {
	width: number;
	height: number;
}

export const LOD_THRESHOLDS = {
	MACRO_MAX: 0.5,
	MICRO_MIN: 1.2,
} as const;

export const LOD_DIMENSIONS: Record<SemanticLodTier, NodeDimensions> = {
	macro: { width: 128, height: 44 },
	mid: { width: 208, height: 80 },
	micro: { width: 240, height: 128 },
};

/** Default Mid-LOD card footprint used for rank layout spacing (§3.2). */
export const GRAPH_NODE_WIDTH = 208;
export const GRAPH_NODE_HEIGHT = 80;
export const GRAPH_RANK_GAP_X = 104;
export const GRAPH_ROW_GAP_Y = 70;

export function getSemanticLod(zoom: number): SemanticLodTier {
	if (zoom < LOD_THRESHOLDS.MACRO_MAX) return "macro";
	if (zoom >= LOD_THRESHOLDS.MICRO_MIN) return "micro";
	return "mid";
}

/**
 * Compute horizontal-tangent cubic Bezier SVG path string between two ports.
 */
export function computeCubicBezierPath(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): string {
	const dx = x2 - x1;
	const curvature = Math.max(dx * 0.5, 48);
	const cx1 = x1 + curvature;
	const cy1 = y1;
	const cx2 = x2 - curvature;
	const cy2 = y2;
	return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

export interface HybridPortSpec {
	name: string;
	type: string;
}

export interface HybridGraphNode {
	id: string;
	kind: HybridNodeKind;
	rank: 0 | 1 | 2 | 3 | 4;
	x: number;
	y: number;
	badge: string;
	title: string;
	subtitle: string;
	status: HybridNodeStatus;
	latencyMs?: number | null;
	progressPct?: number | null;
	revision?: number | null;
	inputs: HybridPortSpec[];
	outputs: HybridPortSpec[];
	/** Associated entity or workflow stage identifier for quick actions. */
	targetRef?: {
		kind: "stage" | "gate" | "agent" | "mcp" | "cli" | "inbound";
		id: string;
	};
}

export interface HybridGraphEdge {
	id: string;
	sourceId: string;
	targetId: string;
	kind: HybridNodeKind;
	active?: boolean;
}

/**
 * Compute source (right-center) and target (left-center) port coordinates for a node.
 */
export function getNodePorts(
	node: Pick<HybridGraphNode, "x" | "y">,
	dims: NodeDimensions = { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT },
): { srcX: number; srcY: number; dstX: number; dstY: number } {
	return {
		srcX: node.x + dims.width,
		srcY: node.y + dims.height / 2,
		dstX: node.x,
		dstY: node.y + dims.height / 2,
	};
}
