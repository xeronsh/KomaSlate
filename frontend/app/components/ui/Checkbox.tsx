import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { SvgIcon } from "./SvgIcon";

export interface CheckboxProps
  extends Omit<ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "asChild"> {
  size?: "xs" | "sm";
}

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, size = "sm", ...props }, ref) {
  const boxSize = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const iconSize = size === "xs" ? 12 : 14;

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={clsx("ui-checkbox shrink-0", boxSize, className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <SvgIcon name="check" size={iconSize} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
