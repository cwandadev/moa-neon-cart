import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A round checkbox with a 44px touch target. */
export function SelectCheck({
  checked,
  disabled,
  onToggle,
  label,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn("grid size-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed", className)}
    >
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full border-2 transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60 bg-background/80",
          disabled && "opacity-40",
        )}
      >
        {checked && <i className="bx bx-check text-base" />}
      </span>
    </button>
  );
}

/** The bar with the live count and the actions, always in view while items are selected. */
export function SelectionBar({
  count,
  onExit,
  children,
}: {
  count: number;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Actions for the selected items"
      className="fixed inset-x-3 bottom-24 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200 md:inset-x-auto md:bottom-6 md:left-1/2 md:-translate-x-1/2"
    >
      <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-2xl">
        <button
          type="button"
          aria-label="Exit selection"
          onClick={onExit}
          className="grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <i className="bx bx-x text-2xl" />
        </button>
        <span aria-live="polite" className="px-1 font-body text-sm font-medium">
          {count} selected
        </span>
        {children}
      </div>
    </div>
  );
}

export type SelectOption = { label: string; count: number; onPick: () => void };

/** The strip above the list in selection mode: tri-state checkbox, count, and quick "select" choices. */
export function SelectionStrip({
  total,
  picked,
  onToggleAll,
  options,
  noun,
}: {
  total: number;
  picked: number;
  onToggleAll: () => void;
  options: SelectOption[];
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const all = total > 0 && picked >= total;
  const some = picked > 0 && !all;
  const shown = options.filter((o) => o.count > 0);

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-1.5 py-1">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          role="checkbox"
          aria-checked={all ? true : some ? "mixed" : false}
          aria-label={all ? `Deselect all ${noun}` : `Select all ${noun} in this view`}
          onClick={onToggleAll}
          className="grid size-11 shrink-0 place-items-center rounded-full"
        >
          <span
            className={cn(
              "grid size-6 place-items-center rounded-md border-2 transition-colors",
              all || some ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
            )}
          >
            {all ? <i className="bx bx-check text-base" /> : some ? <i className="bx bx-minus text-base" /> : null}
          </span>
        </button>
        <span aria-live="polite" className="truncate font-body text-sm">
          {picked === 0 ? `Tap ${noun} to select them` : `${picked} selected`}
        </span>
      </div>

      {shown.length > 0 && (
        <div ref={ref} className="relative shrink-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 items-center gap-1 rounded-xl px-3 font-body text-sm text-primary transition-colors hover:bg-primary/10"
          >
            Select <i className="bx bx-chevron-down text-lg" />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-2xl border border-border bg-popover p-1.5 shadow-lg">
              {shown.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    o.onPick();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors hover:bg-secondary"
                >
                  <span>{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
