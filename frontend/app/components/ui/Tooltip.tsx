import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { clsx } from "clsx";
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from "react";

const HasTooltipProvider = createContext(false);

export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export function TooltipProvider({
  children,
  delayDuration = 250,
  skipDelayDuration = 150,
}: {
  children: ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}) {
  return (
    <HasTooltipProvider.Provider value={true}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
      >
        {children}
      </TooltipPrimitive.Provider>
    </HasTooltipProvider.Provider>
  );
}

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={clsx(
          "animate-fade-in z-tooltip max-w-xs rounded-md border border-line bg-neutral px-2.5 py-1.5 text-xs text-neutral-content shadow-panel",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export interface TooltipProps {
  content?: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** 禁用态按钮内部包一层 span 以响应悬停/焦点；块级容器可传 fullWidth */
  fullWidth?: boolean;
  delayDuration?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  fullWidth = false,
  delayDuration,
}: TooltipProps) {
  const hasProvider = useContext(HasTooltipProvider);

  if (content === undefined || content === null || content === "") {
    return <>{children}</>;
  }

  const inner = (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>
        <span className={fullWidth ? "block w-full" : "inline-flex"}>
          {children}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );

  if (hasProvider) return inner;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration ?? 250}>
      {inner}
    </TooltipPrimitive.Provider>
  );
}
