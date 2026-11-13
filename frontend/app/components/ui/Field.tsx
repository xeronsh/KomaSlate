import { clsx } from "clsx";
import { memo, useId, type ReactNode } from "react";

export interface FieldProps {
  label?: string;
  htmlFor?: string;
  error?: string;
  help?: string;
  required?: boolean;
  layout?: "stack" | "inline";
  className?: string;
  children: ReactNode | ((ids: { inputId: string; describedBy?: string }) => ReactNode);
}

/** 统一表单字段包裹器：绑定 label、帮助说明、错误提示与 ARIA 描述关系。 */
export const Field = memo(function Field({
  label,
  htmlFor,
  error,
  help,
  required,
  layout = "stack",
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const inputId = htmlFor ?? autoId;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  const content =
    typeof children === "function" ? children({ inputId, describedBy }) : children;

  if (layout === "inline") {
    return (
      <div className={clsx("flex flex-col gap-1", className)}>
        <div className="flex items-center justify-between gap-3 text-sm">
          {label ? (
            <label htmlFor={inputId} className="label shrink-0 text-ink-muted">
              {label}
              {required ? (
                <span className="ml-0.5 text-error-fg" aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>
          ) : null}
          {content}
        </div>
        {help ? (
          <p id={helpId} className="m-0 text-xs text-ink-muted">
            {help}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="m-0 text-xs text-error-fg" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={clsx("flex w-full flex-col gap-1", className)}>
      {label ? (
        <label htmlFor={inputId} className="block min-h-0 p-0">
          <span className="label text-ink-muted">
            {label}
            {required ? (
              <span className="ml-0.5 text-error-fg" aria-hidden="true">
                *
              </span>
            ) : null}
          </span>
        </label>
      ) : null}
      {content}
      {help ? (
        <p id={helpId} className="m-0 text-xs text-ink-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 text-xs text-error-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
