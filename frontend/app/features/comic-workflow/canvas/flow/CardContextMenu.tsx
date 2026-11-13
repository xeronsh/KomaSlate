import { useRef } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/Popover";
import type { ComicWorkflowNode } from "../../graph/types";
import { GenerationSection } from "../../inspector/GenerationSection";

export interface CardMenuState {
	node: ComicWorkflowNode;
	x: number;
	y: number;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT = 320;

/** 把菜单锚点夹在画布容器里，配合 Popover Popper 自动避让视口边界。 */
export function menuPosition(
	point: { x: number; y: number },
	box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
	return {
		x: Math.max(8, Math.min(point.x - box.left, box.width - MENU_WIDTH - 8)),
		y: Math.max(8, Math.min(point.y - box.top, box.height - MENU_HEIGHT - 8)),
	};
}

/** 右键菜单：基于 Radix Popover 自动处理视口碰撞翻转与焦点管理，复用检查器「生成」页动作。 */
export function CardContextMenu({
	menu,
	projectId,
	structureLocked,
	onClose,
}: {
	menu: CardMenuState;
	projectId: number;
	structureLocked: boolean;
	onClose: () => void;
}) {
	const anchorRef = useRef<HTMLSpanElement>(null);

	return (
		<>
			<span
				ref={anchorRef}
				aria-hidden="true"
				className="pointer-events-none absolute h-0 w-0"
				style={{ left: menu.x, top: menu.y }}
			/>
			<Popover
				open
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
			>
				<PopoverAnchor virtualRef={anchorRef} />
				<PopoverContent
					side="bottom"
					align="start"
					sideOffset={0}
					collisionPadding={8}
					className="w-60 p-2"
				>
					<section aria-label={`${menu.node.title} 的操作`}>
						<GenerationSection
							projectId={projectId}
							node={menu.node}
							structureLocked={structureLocked}
							compact
							onActionDone={onClose}
						/>
					</section>
				</PopoverContent>
			</Popover>
		</>
	);
}
