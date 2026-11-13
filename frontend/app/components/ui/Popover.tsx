import * as PopoverPrimitive from "@radix-ui/react-popover";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverPortal = PopoverPrimitive.Portal;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className, align = "start", sideOffset = 4, collisionPadding = 8, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={clsx(
          "animate-enter z-popover rounded-lg border border-line bg-surface p-1 text-ink shadow-panel",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
