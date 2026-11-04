import type { ArtifactVersion } from "~/types";

export const DISPLAY_FIELDS = [
	"name",
	"description",
	"scene",
	"action",
	"dialogue",
	"camera",
	"lighting",
	"expression",
	"prompt",
	"image_prompt",
	"visual_notes",
	"character_ids",
];

/** 参与对比的字段：展示字段 + 图片 + 视频 */
export const COMPARE_FIELDS = [...DISPLAY_FIELDS, "image_url", "video_url"];

export type Snapshot = Record<string, unknown>;
export type FieldDiff = { field: string; before: unknown; after: unknown };

export function blank(value: unknown): boolean {
	return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** 两份快照在对比字段上的差异；空值彼此相等 */
export function diffSnapshots(before: Snapshot | undefined, after: Snapshot | undefined): FieldDiff[] {
	if (!before || !after) return [];
	return COMPARE_FIELDS.flatMap((field) => {
		const a = before[field];
		const b = after[field];
		if (blank(a) && blank(b)) return [];
		if (JSON.stringify(a) === JSON.stringify(b)) return [];
		return [{ field, before: a, after: b }];
	});
}

/**
 * 默认对比「当前 vs 上一版」：上一版是最新的、和当前确实不同的快照。
 * 都和当前相同（或没有快照）时返回 null，抽屉给出提示而不是空对比。
 */
export function defaultPrevious(current: Snapshot | undefined, versions: ArtifactVersion[]): number | null {
	const differing = versions.find((version) => diffSnapshots(version.snapshot, current).length > 0);
	return differing?.version ?? null;
}
