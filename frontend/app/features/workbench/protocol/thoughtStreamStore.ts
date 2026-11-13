import { useSyncExternalStore } from "react";

export interface AgentThoughtEntry {
	id: string;
	agent: string;
	phase: string;
	content: string;
	done: boolean;
	timestamp: string;
}

const MAX_THOUGHTS = 60;
const EMPTY_THOUGHTS: AgentThoughtEntry[] = [];
const thoughtsByProject = new Map<number, AgentThoughtEntry[]>();
const listeners = new Set<() => void>();
let thoughtSeq = 0;

function emitChange(): void {
	for (const listener of listeners) listener();
}

export function applyAgentThoughtFragment(
	projectId: number,
	fragment: {
		agent?: string;
		phase?: string | null;
		content?: string;
		delta?: string | null;
		done?: boolean;
		timestamp?: string | null;
	},
): void {
	if (!projectId) return;
	const prev = thoughtsByProject.get(projectId) ?? [];
	const agent = fragment.agent || "pi-agent-core";
	const phase = fragment.phase || "reasoning";
	const ts = fragment.timestamp || new Date().toISOString();
	const last = prev[prev.length - 1];

	// Merge streaming delta into the open thought entry for the same agent
	if (last && !last.done && last.agent === agent && fragment.delta) {
		const updated: AgentThoughtEntry = {
			...last,
			content: `${last.content}${fragment.delta}`,
			done: Boolean(fragment.done),
			timestamp: ts,
		};
		thoughtsByProject.set(projectId, [...prev.slice(0, -1), updated]);
		emitChange();
		return;
	}

	const text = fragment.content || fragment.delta || "";
	if (!text.trim() && !fragment.done) return;

	if (last && !last.done && last.agent === agent && fragment.done && !fragment.content) {
		thoughtsByProject.set(projectId, [
			...prev.slice(0, -1),
			{ ...last, done: true, timestamp: ts },
		]);
		emitChange();
		return;
	}

	const entry: AgentThoughtEntry = {
		id: `thought_${Date.now()}_${++thoughtSeq}`,
		agent,
		phase,
		content: text,
		done: Boolean(fragment.done),
		timestamp: ts,
	};
	const next =
		prev.length >= MAX_THOUGHTS
			? [...prev.slice(prev.length - MAX_THOUGHTS + 1), entry]
			: [...prev, entry];
	thoughtsByProject.set(projectId, next);
	emitChange();
}

export function clearAgentThoughts(projectId: number): void {
	if (!thoughtsByProject.has(projectId)) return;
	thoughtsByProject.delete(projectId);
	emitChange();
}

function subscribeThoughts(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useAgentThoughts(projectId: number): AgentThoughtEntry[] {
	return useSyncExternalStore(
		subscribeThoughts,
		() => thoughtsByProject.get(projectId) ?? EMPTY_THOUGHTS,
		() => EMPTY_THOUGHTS,
	);
}
