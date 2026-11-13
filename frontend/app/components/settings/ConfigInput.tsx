import { useState } from "react";
import { configApi } from "~/services/api";
import type { ConfigItem } from "~/types";
import { toast } from "~/utils/toast";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Switch } from "~/components/ui/Switch";
import { IconButton } from "../../components/ui/IconButton";
import "~/components/ui/icons/settingsIcons";

interface ConfigInputProps {
	item: ConfigItem;
	value: string;
	onChange: (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
	) => void;
}

export function ConfigInput({ item, value, onChange }: ConfigInputProps) {
	const [isRevealed, setIsRevealed] = useState(false);
	const [isRevealing, setIsRevealing] = useState(false);

	const isSensitive = item.is_sensitive;
	const isMasked = item.is_masked;

	const handleToggleReveal = async () => {
		if (isRevealed) {
			setIsRevealed(false);
		} else {
			setIsRevealing(true);
			try {
				const result = await configApi.revealValue(item.key);
				setIsRevealed(true);
				if (result.value !== null) {
					onChange({
						target: { name: item.key, value: result.value },
					} as React.ChangeEvent<HTMLInputElement>);
				}
			} catch (error) {
				console.error("Failed to reveal value:", error);
				toast.error({
					title: "获取真实值失败",
					message: "获取真实值失败，请检查网络连接",
				});
			} finally {
				setIsRevealing(false);
			}
		}
	};

	const fieldClass =
		"input-doodle h-9 touch-target-dense w-full border border-line-strong bg-paper-100 px-2.5 font-mono text-xs";

	const lowered = value.trim().toLowerCase();
	if (!isSensitive && (lowered === "true" || lowered === "false")) {
		const on = lowered === "true";
		return (
			<Switch
				id={item.key}
				checked={on}
				onCheckedChange={(checked) =>
					onChange({
						target: { name: item.key, value: checked ? "true" : "false" },
					} as React.ChangeEvent<HTMLInputElement>)
				}
				label={on ? "开启" : "关闭"}
			/>
		);
	}

	if (isSensitive) {
		const displayValue = isRevealed ? value : isMasked ? value : "••••••••";

		return (
			<div className="space-y-1.5">
				<div className="relative">
					<input
						id={item.key}
						name={item.key}
						type="text"
						value={displayValue}
						onChange={onChange}
						className={`${fieldClass} pr-10`}
						autoComplete="off"
						placeholder={isRevealed ? "输入新值…" : ""}
					/>
					<IconButton
						aria-label={isRevealed ? "隐藏真实值" : "显示真实值"}
						onClick={handleToggleReveal}
						disabled={isRevealing}
						className="absolute inset-y-0 right-0 my-auto text-ink-muted hover:text-ink"
						title={isRevealed ? "隐藏真实值" : "显示真实值"}
					>
						{isRevealing ? (
							<span className="spinner-doodle h-3 w-3" />
						) : isRevealed ? (
							<SvgIcon name="eye-closed" size={16} />
						) : (
							<SvgIcon name="eye" size={16} />
						)}
					</IconButton>
				</div>
				{!isRevealed && isMasked && (
					<p className="m-0 text-xs text-ink-muted">
						已配置（显示脱敏值），点击眼睛图标可查看真实值
					</p>
				)}
				{isRevealed && (
					<p className="m-0 inline-flex items-center gap-1 text-xs text-warning-fg">
						<SvgIcon name="triangle-alert" size={12} />
						真实值已显示，请注意保护隐私
					</p>
				)}
			</div>
		);
	}

	return (
		<input
			id={item.key}
			name={item.key}
			type="text"
			value={value}
			onChange={onChange}
			className={fieldClass}
			autoComplete="off"
		/>
	);
}
