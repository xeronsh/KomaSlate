import { clsx } from "clsx";
import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Field } from "./Field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  help?: string;
  density?: "compact" | "normal";
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    error,
    help,
    density = "normal",
    className,
    containerClassName,
    id,
    required,
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const compact = density === "compact";

  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      help={help}
      required={required}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => (
        <textarea
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [ariaDescribedBy, describedBy].filter(Boolean).join(" ") || undefined
          }
          className={clsx(
            "input-doodle w-full",
            compact ? "px-2 py-1 text-sm" : "px-2.5 py-1.5 text-base",
            error && "border-error",
            className,
          )}
          {...props}
        />
      )}
    </Field>
  );
});
