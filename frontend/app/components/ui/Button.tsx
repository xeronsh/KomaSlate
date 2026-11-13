import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "btn-tactile bg-primary text-primary-content border-primary hover:bg-primary-hover active:bg-primary-pressed",
  secondary:
    "btn-tactile bg-surface text-ink border-border-strong hover:bg-paper-200 active:bg-paper-300",
  ghost:
    "bg-transparent border-transparent text-ink hover:bg-paper-200 active:bg-paper-300 shadow-none",
  danger:
    "btn-tactile bg-error text-error-content border-error hover:bg-error/90 active:bg-error/80",
  outline:
    "bg-transparent border-line text-ink hover:bg-paper-100",
};

export const BUTTON_BASE =
  "btn-doodle cursor-pointer inline-flex items-center justify-center select-none disabled:opacity-50";

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  // 不设 min-h-*：让 touch-target-dense 的 min-height 在触屏 (pointer:coarse)
  // 下升到 44px，也允许调用方用 min-h-[...] 覆盖
  xs: "h-7 touch-target-dense gap-1 px-2 py-0.5 text-xs rounded-sm",
  sm: "h-8 touch-target-dense gap-1 px-2.5 py-1 text-sm rounded-md",
  md: "h-9 touch-target-dense gap-1.5 px-3.5 py-1.5 text-base rounded-md",
  lg: "h-11 touch-target gap-2 px-5 py-2 text-lg rounded-lg",
};

export const buttonVariants = cva(BUTTON_BASE, {
  variants: {
    variant: BUTTON_VARIANTS,
    size: BUTTON_SIZES,
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

/** 按钮外观的唯一来源：Button 和 ButtonLink（导航用的 <a>）共用，避免 <a><button> 嵌套。 */
export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return clsx(buttonVariants({ variant, size }), className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    className,
    children,
    disabled,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (loading || disabled) return;
    await onClick?.(e);
  };

  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      className={buttonClass({
        variant,
        size,
        className: clsx(isDisabled && "opacity-50 cursor-not-allowed", className),
      })}
      disabled={isDisabled}
      onClick={handleClick}
      type={type}
      {...props}
    >
      {loading ? (
        <span className="spinner-doodle h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        children
      )}
    </button>
  );
});
