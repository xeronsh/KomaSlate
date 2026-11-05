import { MEDIA, imageReady } from "~/components/ui/media";
import { Link } from "react-router-dom";
import { Card } from "~/components/ui/Card";
import type { Universe } from "~/types";
import { IconButton } from "../../components/ui/IconButton";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { MonoRuns } from "~/components/ui/MonoRuns";

interface UniverseCardProps {
	universe: Universe;
	onDelete: (universe: Universe) => void;
}

function formatDate(value: string | null | undefined) {
	if (!value) return "未知";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "未知";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

export function UniverseCard({ universe, onDelete }: UniverseCardProps) {
	return (
		<div className="group relative" data-shell="universe-card">
			<Link to={`/universes/${universe.id}`} className="block">
				<Card className="h-full !p-3 transition-colors duration-fast hover:border-primary sm:!p-4">
					{universe.cover_image_url ? (
						<div className="-mx-1 -mt-1 mb-3 h-24 overflow-hidden border border-line">
							<img
								src={universe.cover_image_url}
								alt={universe.name}
								className={`${MEDIA} h-full w-full object-cover`}
							{...imageReady}
								width={320}
								height={80}
								loading="lazy"
							/>
						</div>
					) : (
						<div className="-mx-1 -mt-1 mb-3 flex h-24 items-end border border-line bg-paper-200 p-2">
							<SvgIcon name="sparks" size={24} className="text-primary" />
						</div>
					)}

					{/* 更新时间留作轻量元信息，封面统一承接宇宙识别。 */}
					<p className="m-0 label text-ink-muted">
						更新 <MonoRuns text={formatDate(universe.updated_at)} />
					</p>
					<h2 className="m-0 mt-0.5 text-md font-bold leading-snug">
						{universe.name}
					</h2>

					{universe.description ? (
						<p className="m-0 mt-1 line-clamp-2 text-xs text-ink-muted">
							{universe.description}
						</p>
					) : (
						<p className="m-0 mt-1 text-xs text-ink-muted">
							尚未填写简介
						</p>
					)}

					<div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-muted">
						<span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-200 px-1.5 py-0.5 tabular-nums">
							<SvgIcon name="sparks" size={12} />
							{universe.projects_count} 章节
						</span>
						<span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-200 px-1.5 py-0.5 tabular-nums">
							<SvgIcon name="group" size={12} />
							{universe.shared_characters_count} 角色
						</span>
					</div>
				</Card>
			</Link>

			<IconButton
				className="absolute right-1.5 top-1.5 rounded-full bg-paper-100/95 text-ink-muted opacity-0 hover:bg-error-bg hover:text-error-fg group-hover:opacity-100 focus-visible:opacity-100"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onDelete(universe);
				}}
				title="删除宇宙"
				aria-label={`删除宇宙 ${universe.name}`}
			>
				<SvgIcon name="trash-2" size={14} />
			</IconButton>
		</div>
	);
}
