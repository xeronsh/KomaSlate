import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";
import { useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  const id = useId();

  return (
    <div className="flex flex-col w-full gap-1">
      {label && (
        <label htmlFor={id} className="block min-h-0 p-0">
          <span className="label text-ink">
            {label}
          </span>
        </label>
      )}
      <input
        id={id}
        className={clsx(
          "input-doodle h-9 touch-target-dense w-full px-2.5 py-1.5 text-base",
          error && "border-error",
          className,
        )}
        {...props}
      />
      {error && (
        <p className="m-0 text-xs text-error-fg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
