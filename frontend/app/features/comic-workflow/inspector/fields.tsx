/** 检查器各分区共用的小部件。 */
import { type ReactNode, useEffect } from "react";
import { Button } from "~/components/ui/Button";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { ApiError } from "~/types/errors";

export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return fallback;
}

export function FieldList({ items }: { items: Array<[string, string | number]> }) {
	return (
		<div className="space-y-1">
			{items.map(([label, value]) => (
				<div
					key={label}
					className="flex items-start justify-between gap-3 border-b border-line pb-1.5 text-sm"
				>
					<span className="label shrink-0 whitespace-nowrap text-ink-muted">
						{label}
					</span>
					<span className="min-w-0 text-right text-ink-muted">{value}</span>
				</div>
			))}
		</div>
	);
}

export function ActionStack({ children }: { children: ReactNode }) {
	return <div className="space-y-1.5">{children}</div>;
}

/**
 * 写操作为什么不能点。运行中整体锁；停在审批门时只锁重做（它会另起一个运行），
 * 并告诉用户这时该怎么改：提修改意见，或直接改属性。
 */
export function LockNotice({ atGate, what = "结构写入操作" }: { atGate: boolean; what?: string }) {
	return (
		<div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs leading-relaxed text-ink" role="note">
			{atGate
				? "正在等你确认这一步：要改结果，选中卡片后在下方输入框提修改意见；属性可以直接改，单格重做在确认后可用。"
				: `生成运行中，${what}已锁定。`}
		</div>
	);
}

export function lockReason(atGate: boolean): string {
	return atGate ? "审批门待确认：请用修改意见，确认后可单独重做" : "生成运行中，暂不可用";
}

export function ActionButton({
	icon,
	label,
	disabled,
	loading,
	danger,
	primary,
	onClick,
	disabledReason,
}: {
	icon: Parameters<typeof SvgIcon>[0]["name"];
	label: string;
	disabled?: boolean;
	loading?: boolean;
	danger?: boolean;
	primary?: boolean;
	onClick: () => void;
	/** 禁用时悬停看到的原因（禁用按钮收不到 hover，挂在外层） */
	disabledReason?: string;
}) {
	return (
		<span className="block" title={disabled ? disabledReason : undefined}>
		<Button
			// 危险操作用红字的安静按钮（填充红底时红字会看不见）
			variant={primary && !danger ? "primary" : "ghost"}
			size="sm"
			className={`w-full justify-start gap-1.5 text-xs ${danger ? "text-error-fg hover:bg-error/10" : ""}`}
			disabled={disabled}
			loading={loading}
			onClick={onClick}
		>
			<SvgIcon name={icon} size={12} />
			{label}
		</Button>
		</span>
	);
}

/**
 * 表单外壳。dirty 时：焦点离开表单（点别的卡片、切页签）就自动保存；
 * 关页面前浏览器会提示。像 Figma / Linear 一样，改了不会静默丢失。
 */
export function FormShell({
	disabled,
	children,
	dirty = false,
	onAutoSave,
}: {
	disabled: boolean;
	children: ReactNode;
	dirty?: boolean;
	onAutoSave?: () => void;
}) {
	useEffect(() => {
		if (!dirty || disabled) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty, disabled]);

	return (
		<fieldset
			className="space-y-3"
			disabled={disabled}
			onBlur={(event) => {
				if (!dirty || disabled || !onAutoSave) return;
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				onAutoSave();
			}}
		>
			{disabled ? (
				<div className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-xs text-warning-fg">
					生成运行中，保存操作已锁定。
				</div>
			) : null}
			{children}
			{dirty && !disabled ? (
				<p className="m-0 text-xs text-ink-muted" role="status">
					有未保存的修改，离开这张表单时会自动保存。
				</p>
			) : null}
		</fieldset>
	);
}

export function TextInput({
	label,
	value,
	onChange,
	list,
	placeholder,
	help,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	/** datalist id：给出推荐值，仍可自由输入 */
	list?: string;
	placeholder?: string;
	help?: string;
}) {
	return (
		<label className="block">
			<span className="mb-1 block label text-ink-muted">
				{label}
			</span>
			<input
				className="input-doodle w-full px-2 py-1 text-sm"
				value={value}
				list={list}
				placeholder={placeholder}
				autoComplete={list ? "off" : undefined}
				onChange={(event) => onChange(event.target.value)}
			/>
			{help ? <span className="mt-1 block text-xs text-ink-muted">{help}</span> : null}
		</label>
	);
}

export function SelectInput<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
}: {
	label: string;
	value: T;
	options: ReadonlyArray<readonly [T, string]>;
	onChange: (value: T) => void;
	disabled?: boolean;
}) {
	return (
		<label className="flex items-center justify-between gap-3 text-sm">
			<span className="label shrink-0 text-ink-muted">{label}</span>
			<select
				className="input-doodle min-w-0 px-2 py-1 text-sm"
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value as T)}
			>
				{options.map(([v, text]) => (
					<option key={v} value={v}>
						{text}
					</option>
				))}
			</select>
		</label>
	);
}

export function NumberInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number | null;
	onChange: (value: number | null) => void;
}) {
	return (
		<label className="block">
			<span className="mb-1 block label text-ink-muted">
				{label}
			</span>
			<input
				type="number"
				min="0"
				step="1"
				className="input-doodle w-full px-2 py-1 text-sm"
				value={value ?? ""}
				onChange={(event) =>
					onChange(event.target.value ? Number(event.target.value) : null)
				}
			/>
		</label>
	);
}

export function TextArea({
	label,
	value,
	rows,
	onChange,
}: {
	label: string;
	value: string;
	rows: number;
	onChange: (value: string) => void;
}) {
	return (
		<label className="block">
			<span className="mb-1 block label text-ink-muted">
				{label}
			</span>
			<textarea
				className="input-doodle w-full resize-none px-2 py-1 text-sm"
				rows={rows}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}

export function SaveButton({
	disabled,
	loading,
	onClick,
}: {
	disabled: boolean;
	loading: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant="primary"
			size="sm"
			className="w-full"
			disabled={disabled}
			loading={loading}
			onClick={onClick}
		>
			保存
		</Button>
	);
}

export function textOrNull(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}
