import { useSyncExternalStore } from "react";

export type ProtocolLogChannel = "RPC" | "STDIO" | "ERROR";
export type ProtocolFilter = "ALL" | ProtocolLogChannel;

export interface ProtocolLogEntry {
	id: string;
	timestamp: string;
	channel: ProtocolLogChannel;
	direction: "OUT" | "IN" | "SYS";
	source: string;
	summary: string;
	latencyMs?: number | null;
	payload?: unknown;
}

const MAX_LOGS_PER_PROJECT = 500;
const EMPTY_LOGS: ProtocolLogEntry[] = [];

const logsByProject = new Map<number, ProtocolLogEntry[]>();
const listeners = new Set<() => void>();
let seqCounter = 0;

function emitChange(): void {
	for (const listener of listeners) listener();
}

export function appendProtocolLog(
	projectId: number,
	entry: Omit<ProtocolLogEntry, "id" | "timestamp"> & {
		id?: string;
		timestamp?: string;
	},
): void {
	if (!projectId) return;
	const prev = logsByProject.get(projectId) ?? [];
	const id = entry.id ?? `plog_${Date.now()}_${++seqCounter}`;
	if (prev.some((item) => item.id === id)) return;
	const now = new Date();
	const ts =
		entry.timestamp ??
		`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
	const nextEntry: ProtocolLogEntry = {
		...entry,
		id,
		timestamp: ts,
	};
	const next =
		prev.length >= MAX_LOGS_PER_PROJECT
			? [...prev.slice(prev.length - MAX_LOGS_PER_PROJECT + 1), nextEntry]
			: [...prev, nextEntry];
	logsByProject.set(projectId, next);
	emitChange();
}

export function clearProtocolLogs(projectId: number): void {
	if (!logsByProject.has(projectId)) return;
	logsByProject.delete(projectId);
	emitChange();
}

export function getProtocolLogsSnapshot(projectId: number): ProtocolLogEntry[] {
	return logsByProject.get(projectId) ?? EMPTY_LOGS;
}

function subscribeProtocolLogs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useProtocolLogs(projectId: number): ProtocolLogEntry[] {
	return useSyncExternalStore(
		subscribeProtocolLogs,
		() => getProtocolLogsSnapshot(projectId),
		() => EMPTY_LOGS,
	);
}
