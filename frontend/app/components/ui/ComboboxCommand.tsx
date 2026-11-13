import { Command } from "cmdk";
import { clsx } from "clsx";
import { SvgIcon } from "./SvgIcon";

export interface ComboboxOption {
  value: string;
  label?: string;
  description?: string;
  group?: string;
  keywords?: string[];
}

export interface ComboboxCommandProps {
  options: ComboboxOption[];
  value: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onSelect: (value: string) => void;
}

export default function ComboboxCommand({
  options,
  value,
  searchPlaceholder = "搜索选项…",
  emptyText = "没有匹配项",
  onSelect,
}: ComboboxCommandProps) {
  const groups = new Map<string, ComboboxOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }

  return (
    <Command className="flex w-full flex-col overflow-hidden rounded-md bg-surface text-ink">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <SvgIcon name="search" size={14} className="shrink-0 text-ink-muted" />
        <Command.Input
          autoFocus
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-xs text-ink placeholder:text-ink-muted"
        />
      </div>
      <Command.List className="max-h-60 overflow-y-auto overscroll-contain p-1">
        <Command.Empty className="py-4 text-center text-xs text-ink-muted">
          {emptyText}
        </Command.Empty>
        {Array.from(groups.entries()).map(([groupName, groupOptions]) => {
          const items = groupOptions.map((opt) => {
            const selected = opt.value === value;
            return (
              <Command.Item
                key={opt.value}
                value={opt.value}
                keywords={opt.keywords ?? (opt.label ? [opt.label, opt.value] : [opt.value])}
                onSelect={() => onSelect(opt.value)}
                className={clsx(
                  "ui-menu-item flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs select-none",
                  selected && "bg-primary/10 font-semibold text-primary",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono">{opt.label ?? opt.value}</div>
                  {opt.description ? (
                    <div className="truncate text-xs text-ink-muted">{opt.description}</div>
                  ) : null}
                </div>
                {selected ? <SvgIcon name="check" size={14} className="shrink-0 text-primary" /> : null}
              </Command.Item>
            );
          });

          if (!groupName) return items;
          return (
            <Command.Group
              key={groupName}
              heading={groupName}
              className="py-1 text-xs font-semibold text-ink-muted"
            >
              {items}
            </Command.Group>
          );
        })}
      </Command.List>
    </Command>
  );
}
