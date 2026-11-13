import { clsx } from "clsx";
import {
  forwardRef,
  lazy,
  memo,
  Suspense,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { ComboboxOption } from "./ComboboxCommand";
import { Field } from "./Field";
import { IconButton } from "./IconButton";
import { Popover, PopoverAnchor, PopoverContent } from "./Popover";
import { SvgIcon } from "./SvgIcon";

export type { ComboboxOption };

const LazyComboboxCommand = lazy(() => import("./ComboboxCommand"));

export interface ComboboxProps {
  id?: string;
  name?: string;
  label?: string;
  help?: string;
  error?: string;
  value: string;
  options: ReadonlyArray<string | ComboboxOption>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  density?: "compact" | "normal";
  inputClassName?: string;
  containerClassName?: string;
  onValueChange: (value: string) => void;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
}

function normalizeOptions(
  options: ReadonlyArray<string | ComboboxOption>,
): ComboboxOption[] {
  return options.map((opt) => (typeof opt === "string" ? { value: opt } : opt));
}

export const Combobox = memo(forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    id,
    name,
    label,
    help,
    error,
    value,
    options,
    placeholder,
    searchPlaceholder,
    emptyText,
    disabled = false,
    density = "normal",
    inputClassName,
    containerClassName,
    onValueChange,
    onChange,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const normalized = normalizeOptions(options);
  const compact = density === "compact";

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event);
    onValueChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && normalized.length > 0 && !disabled) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const renderControl = (inputId?: string, describedBy?: string) => (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full">
          <input
            ref={ref}
            id={inputId}
            name={name}
            type="text"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-expanded={normalized.length > 0 ? open : undefined}
            aria-autocomplete={normalized.length > 0 ? "list" : undefined}
            autoComplete="off"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className={clsx(
              "input-doodle w-full",
              compact ? "h-8 px-2 py-1 text-sm" : "h-9 touch-target-dense px-2.5 py-1.5 text-base",
              normalized.length > 0 && "pr-9",
              error && "border-error",
              inputClassName,
            )}
          />
          {normalized.length > 0 ? (
            <IconButton
              size="xs"
              disabled={disabled}
              aria-label="展开候选项"
              title="选择候选项"
              onClick={() => setOpen((prev) => !prev)}
              className="absolute inset-y-0 right-1 my-auto text-ink-muted hover:text-ink"
            >
              <SvgIcon name={open ? "chevron-up" : "chevron-down"} size={14} />
            </IconButton>
          ) : null}
        </div>
      </PopoverAnchor>
      {open && normalized.length > 0 ? (
        <PopoverContent
          align="start"
          className="w-64 max-w-full p-0 sm:w-72"
          onOpenAutoFocus={(event) => {
            // Focus is handled by Command.Input autoFocus
            event.preventDefault();
          }}
        >
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-4 text-xs text-ink-muted">
                <span className="spinner-doodle mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                加载选项…
              </div>
            }
          >
            <LazyComboboxCommand
              options={normalized}
              value={value}
              searchPlaceholder={searchPlaceholder}
              emptyText={emptyText}
              onSelect={(selected) => {
                onValueChange(selected);
                setOpen(false);
              }}
            />
          </Suspense>
        </PopoverContent>
      ) : null}
    </Popover>
  );

  if (!label && !help && !error) {
    return (
      <div className={clsx("w-full", containerClassName)}>
        {renderControl(id)}
      </div>
    );
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      help={help}
      error={error}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => renderControl(inputId, describedBy)}
    </Field>
  );
}));
