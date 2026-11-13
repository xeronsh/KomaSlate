import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BUTTON_BASE, BUTTON_VARIANTS, type ButtonVariant } from "./Button";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** 只有图标的按钮必须有可读名称（spec §7.7），类型上强制。 */
  "aria-label": string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "xs" | "sm" | "md";
}

const SIZES = {
  // touch-target-dense 在触屏 (pointer:coarse) 下把命中区升到 44px
  xs: "h-7 w-7 touch-target-dense p-0",
  sm: "h-8 w-8 touch-target-dense p-0",
  md: "h-9 w-9 touch-target-dense p-0",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "sm", className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {children}
    </button>
  );
});
