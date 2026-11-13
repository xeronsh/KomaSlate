import * as SwitchPrimitive from "@radix-ui/react-switch";
import { clsx } from "clsx";
import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";

export interface SwitchProps
  extends Omit<ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, "asChild"> {
  label?: ReactNode;
}

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, label, id, ...props }, ref) {
  const autoId = useId();
  const controlId = id ?? autoId;

  const root = (
    <SwitchPrimitive.Root
      ref={ref}
      id={controlId}
      className={clsx("ui-switch", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );

  if (!label) return root;

  return (
    <div className="touch-target-dense inline-flex h-9 items-center gap-2">
      {root}
      <label
        htmlFor={controlId}
        className="cursor-pointer select-none text-xs font-semibold text-ink"
      >
        {label}
      </label>
    </div>
  );
});
