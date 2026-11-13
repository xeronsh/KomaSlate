import * as TabsPrimitive from "@radix-ui/react-tabs";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: "underline" | "pill" | "segment";
}

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(function TabsList({ className, variant = "underline", ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={clsx(
        "flex items-center",
        variant === "underline" && "gap-1 border-b border-line",
        variant === "pill" && "gap-1.5",
        variant === "segment" && "gap-0.5 border-b border-line p-0.5",
        className,
      )}
      {...props}
    />
  );
});

export interface TabsTriggerProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  variant?: "underline" | "pill" | "segment";
}

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(function TabsTrigger({ className, variant = "underline", ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={clsx(
        "touch-target-dense inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors duration-fast select-none disabled:pointer-events-none disabled:opacity-50",
        variant === "underline" &&
          "ui-tab-trigger border-b-2 border-transparent px-2.5 py-1.5 text-ink-muted hover:text-ink",
        variant === "pill" &&
          "ui-tab-pill rounded-md border border-line-strong bg-paper-200 px-2.5 text-ink hover:bg-paper-300",
        variant === "segment" &&
          "ui-tab-pill flex-1 rounded-sm px-2 text-ink-muted hover:bg-paper-200",
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={clsx("min-h-0", className)}
      {...props}
    />
  );
});
