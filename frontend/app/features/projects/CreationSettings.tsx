import { useEffect, useMemo, useRef } from "react";
import { Select } from "~/components/ui/Select";
import type { Universe } from "~/types";
import { STYLE_CATEGORIES, styleLabel } from "./styleCategories";
import { Button } from "../../components/ui/Button";
import { PlainButton } from "../../components/ui/PlainButton";

export const MAX_REFERENCE_IMAGES = 7;

export interface CreationSettingsValue {
	style: string;
	universeId: number | null;
	shotCount?: number;
	/** one character hint per line */
	characterHints: string;
	referenceFiles: File[];
}

interface CreationSettingsProps {
	value: CreationSettingsValue;
	onChange: (next: CreationSettingsValue) => void;
	universes: Universe[];
	disabled?: boolean;
}

/** Optional project settings shown before the first run (style, universe, references, shots, characters). */
export function CreationSettings({ value, onChange, universes, disabled }: CreationSettingsProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const set = (patch: Partial<CreationSettingsValue>) => onChange({ ...value, ...patch });
	const previews = useMemo(
		() => value.referenceFiles.map((file) => URL.createObjectURL(file)),
		[value.referenceFiles],
	);
	useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

	const selectedUniverseName = universes.find((u) => u.id === value.universeId)?.name;

	return (
		<details className="border-t border-line pt-2">
			<summary className="touch-target-dense flex cursor-pointer flex-wrap items-center justify-between gap-2 py-2 text-xs font-bold">
				<span>画面设置（可选）· 风格、宇宙、参考图、镜头与角色</span>
				<span className="flex flex-wrap items-center gap-1.5 font-normal text-ink-muted" aria-label="当前画面设置摘要">
					<span className="rounded-full border border-line bg-paper-100 px-2 py-0.5 text-xs font-medium text-ink">
						{styleLabel(value.style) ?? value.style}
					</span>
					<span className="rounded-full border border-line bg-paper-100 px-2 py-0.5 text-xs tabular-nums text-ink-muted">
						{value.shotCount ? (
							<>
								<span className="font-mono">{value.shotCount}</span> 镜
							</>
						) : (
							"自动镜头"
						)}
					</span>
					{selectedUniverseName ? (
						<span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
							{selectedUniverseName}
						</span>
					) : null}
					{value.referenceFiles.length > 0 ? (
						<span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs tabular-nums text-primary">
							参考图 <span className="font-mono">{value.referenceFiles.length}</span>
						</span>
					) : null}
				</span>
			</summary>
			<div className="grid gap-3 pt-2 sm:grid-cols-2">
				<label className="block text-xs font-bold">
					画面风格
					<Select
						containerClassName="mt-1"
						value={value.style}
						onChange={(event) => set({ style: event.target.value })}
						disabled={disabled}
					>
						{STYLE_CATEGORIES.map((category) => (
							<optgroup key={category.group} label={category.group}>
								{category.styles.map((option) => (
									<option key={option.value} value={option.value}>{option.label}</option>
								))}
							</optgroup>
						))}
					</Select>
				</label>
				<label className="block text-xs font-bold">
					IP 宇宙
					<Select
						containerClassName="mt-1"
						value={value.universeId ?? ""}
						onChange={(event) => set({ universeId: event.target.value ? Number(event.target.value) : null })}
						disabled={disabled}
					>
						<option value="">不加入宇宙</option>
						{universes.map((universe) => (
							<option key={universe.id} value={universe.id}>{universe.name}</option>
						))}
					</Select>
				</label>
				<label className="block text-xs font-bold">
					镜头数
					<input
						type="number"
						min={1}
						max={20}
						value={value.shotCount ?? ""}
						placeholder="自动"
						onChange={(event) => set({ shotCount: event.target.value ? Number(event.target.value) : undefined })}
						className="input-doodle touch-target-dense mt-1 h-9 w-full bg-paper-100 text-sm"
						disabled={disabled}
					/>
				</label>
				<label className="block text-xs font-bold">
					角色提示（每行一个）
					<textarea
						value={value.characterHints}
						onChange={(event) => set({ characterHints: event.target.value })}
						className="input-doodle mt-1 min-h-9 w-full resize-y bg-paper-100 p-2 text-sm"
						rows={2}
						placeholder="例如：灯塔管理员，沉默寡言"
						disabled={disabled}
					/>
				</label>
				<section className="space-y-1.5 sm:col-span-2" aria-labelledby="creation-reference-heading">
					<div className="flex items-center justify-between">
						<h3 id="creation-reference-heading" className="m-0 text-xs font-bold">参考图</h3>
						<span className="font-mono text-xs tabular-nums text-ink-muted">
							{value.referenceFiles.length}/{MAX_REFERENCE_IMAGES}
						</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{previews.map((url, index) => (
							<PlainButton
								key={url}
								className="group relative h-10 w-10 border border-line"
								onClick={() => set({ referenceFiles: value.referenceFiles.filter((_, i) => i !== index) })}
								aria-label={`移除参考图 ${index + 1}`}
								disabled={disabled}
							>
								<img src={url} alt="" className="h-full w-full object-cover" width={40} height={40} loading="lazy" decoding="async" />
							</PlainButton>
						))}
						{value.referenceFiles.length < MAX_REFERENCE_IMAGES ? (
							<Button variant="secondary" size="sm"
								className="border-dashed"
								onClick={() => fileInputRef.current?.click()}
								disabled={disabled}
							>
								+ 添加
							</Button>
						) : null}
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="sr-only"
						aria-label="选择参考图"
						onChange={(event) => {
							const picked = Array.from(event.target.files ?? []);
							event.target.value = "";
							set({ referenceFiles: [...value.referenceFiles, ...picked].slice(0, MAX_REFERENCE_IMAGES) });
						}}
					/>
				</section>
			</div>
		</details>
	);
}
