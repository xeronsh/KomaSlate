import { clsx } from "clsx";
import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: "default" | "primary";
}

export function Card({
  title,
  children,
  className,
  style,
  variant = "default",
}: CardProps) {
  const variantStyles = {
    default: "bg-paper-100",
    primary: "bg-primary/10 border-primary",
  };

  return (
    <div
      className={clsx(
        "card-doodle p-3 sm:p-4",
        variantStyles[variant],
        className,
      )}
      style={style}
    >
      {title && (
        <h3 className="mb-2.5 flex items-center gap-1.5 border-b border-line pb-2 text-md font-semibold text-ink">
          {typeof title === "string" ? <span>{title}</span> : title}
        </h3>
      )}
      {children}
    </div>
  );
}
