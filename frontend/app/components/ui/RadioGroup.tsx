import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const RadioGroup = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      className={clsx("gap-2", className)}
      {...props}
    />
  );
});

export interface RadioGroupItemProps
  extends ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
  variant?: "card" | "pill" | "indicator";
}

export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(function RadioGroupItem({ className, variant = "card", children, ...props }, ref) {
  if (variant === "indicator") {
    return (
      <RadioGroupPrimitive.Item
        ref={ref}
        className={clsx(
          "ui-radio-item flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-paper-100 transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <span className="h-2 w-2 rounded-full bg-primary" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    );
  }

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={clsx(
        "touch-target-dense transition-colors duration-fast select-none disabled:cursor-not-allowed disabled:opacity-50",
        variant === "card" &&
          "ui-radio-item flex min-w-0 items-center gap-2 rounded-md border border-line-strong bg-paper-100 px-2 py-1.5 text-left hover:bg-paper-300",
        variant === "pill" &&
          "ui-radio-pill rounded-md border border-line-strong bg-paper-100 px-2 py-1 text-xs font-semibold hover:bg-paper-300",
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
});
