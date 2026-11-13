import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { SvgIcon, type IconName } from "./SvgIcon";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

export const ContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, collisionPadding = 8, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        collisionPadding={collisionPadding}
        className={clsx(
          "animate-enter z-popover min-w-44 rounded-lg border border-line bg-surface p-1 text-ink shadow-panel",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export interface ContextMenuItemProps
  extends ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  icon?: IconName;
  danger?: boolean;
}

export const ContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(function ContextMenuItem({ className, icon, danger, children, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={clsx(
        "ui-menu-item flex touch-target-dense cursor-pointer items-center gap-2 rounded-md px-2 text-xs select-none",
        danger ? "text-error-fg" : "text-ink",
        className,
      )}
      {...props}
    >
      {icon ? <SvgIcon name={icon} size={14} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ContextMenuPrimitive.Item>
  );
});

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={clsx("my-1 h-px bg-line", className)}
      {...props}
    />
  );
});

export const ContextMenuLabel = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(function ContextMenuLabel({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Label
      ref={ref}
      className={clsx("px-2 py-1 text-xs font-semibold text-ink-muted", className)}
      {...props}
    />
  );
});

export const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & { icon?: IconName }
>(function ContextMenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={clsx(
        "ui-menu-item flex touch-target-dense cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-ink select-none",
        className,
      )}
      {...props}
    >
      {icon ? <SvgIcon name={icon} size={14} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SvgIcon name="chevron-right" size={14} className="ml-auto shrink-0 text-ink-muted" />
    </ContextMenuPrimitive.SubTrigger>
  );
});

export const ContextMenuSubContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(function ContextMenuSubContent({ className, collisionPadding = 8, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        ref={ref}
        collisionPadding={collisionPadding}
        className={clsx(
          "animate-enter z-popover min-w-40 rounded-lg border border-line bg-surface p-1 text-ink shadow-panel",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
