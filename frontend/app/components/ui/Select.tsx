import { clsx } from "clsx";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { SvgIcon } from "~/components/ui/SvgIcon";
import { Field } from "./Field";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  help?: string;
  layout?: "stack" | "inline";
  density?: "compact" | "normal";
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    error,
    help,
    layout = "stack",
    className,
    containerClassName,
    density = "normal",
    id,
    required,
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const compact = density === "compact";

  const renderControl = (inputId?: string, describedBy?: string) => (
    <div
      className={clsx(
        "relative",
        layout === "inline" ? "min-w-0" : "w-full",
        !label && !error && !help && containerClassName,
      )}
    >
      <select
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [ariaDescribedBy, describedBy].filter(Boolean).join(" ") || undefined
        }
        {...props}
        className={clsx(
          "input-doodle w-full appearance-none bg-paper-100 pr-8 text-ink",
          compact
            ? "h-8 min-h-8 px-2 py-1 text-xs"
            : "h-9 touch-target-dense px-2.5 py-1.5 text-base",
          error && "border-error",
          className,
        )}
      />
      <SvgIcon
        name="chevron-down"
        size={compact ? 14 : 16}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );

  if (!label && !error && !help) {
    return renderControl(id);
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      help={help}
      required={required}
      layout={layout}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => renderControl(inputId, describedBy)}
    </Field>
  );
});
