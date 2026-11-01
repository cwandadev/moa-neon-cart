import { useCallback, useState, type ReactNode } from "react";
import { DAY_FILTERS, filterText, type DayFilter } from "@/lib/dayGroups";
import type { Range } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Which days are folded away. Everything starts open; it is forgotten when the page is left. */
export function useFolds() {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const isFolded = useCallback((key: string) => folded.has(key), [folded]);
  const toggle = useCallback((key: string) => setFolded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }), []);
  const open = useCallback((key: string) => setFolded((s) => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n; }), []);
  const foldAll = useCallback((keys: readonly string[]) => setFolded(new Set(keys)), []);
  const unfoldAll = useCallback(() => setFolded(new Set()), []);
  return { folded, isFolded, toggle, open, foldAll, unfoldAll };
}

/** A day's heading, and the button that folds it. The count is how many are inside; a badge says how many need attention. */
export function DayHeader({ id, label, count, noun, badge, folded, onToggle, controls, trailing }: { id?: string; label: string; count: number; noun: string; badge?: string | null; folded: boolean; onToggle: () => void; controls?: string; trailing?: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-20 items-center gap-2">
      <h2 className="min-w-0 flex-1 text-sm">
        <button
          type="button"
          aria-expanded={!folded}
          {...(controls ? { "aria-controls": controls } : {})}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className={cn("bx bx-chevron-down text-xl text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", folded && "-rotate-90")} />
          <span className="font-medium">{label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {count} {count === 1 ? noun : `${noun}s`}
          </span>
          {badge && <span className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">{badge}</span>}
        </button>
      </h2>
      {trailing}
    </div>
  );
}

/** The row of date stamps: a tap jumps to that day (and opens it if it was folded). At the end, fold or open every day at once. */
export function DayStamps({ stamps, onJump, allFolded, onFoldAll, onUnfoldAll }: { stamps: Array<{ key: string; stamp: string; count: number }>; onJump: (key: string) => void; allFolded: boolean; onFoldAll: () => void; onUnfoldAll: () => void }) {
  if (stamps.length < 2) return null;
  return (
    <nav aria-label="Jump to a day" className="mt-4 flex items-center gap-2">
      <ul className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {stamps.map((s) => (
          <li key={s.key} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(s.key)}
              aria-label={`Go to ${s.stamp}, ${s.count}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#262626] px-3 text-xs transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.stamp}
              <span className="tabular-nums text-muted-foreground">{s.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={allFolded ? onUnfoldAll : onFoldAll} className="min-h-9 shrink-0 whitespace-nowrap px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        {allFolded ? "Open all days" : "Fold all days"}
      </button>
    </nav>
  );
}

/** Scrolls to a day's heading, gently unless the person has asked their device for less motion. */
export function scrollToDay(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  el.querySelector("button")?.focus({ preventScroll: true });
}

/** Choose the days a list covers: a shortcut, or "Pick dates" for a day or a range on the calendar. */
export function DateBar({ value, custom, onChange, onPick, label = "Date" }: { value: DayFilter; custom: Range | null; onChange: (v: Exclude<DayFilter, "custom">) => void; onPick: () => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {DAY_FILTERS.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={cn("min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === k ? "border-transparent bg-white font-medium text-black" : "border-[#262626] hover:bg-white/[0.06]")}
        >
          {text}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={value === "custom"}
        onClick={onPick}
        className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === "custom" ? "border-transparent bg-white font-medium text-black" : "border-[#262626] hover:bg-white/[0.06]")}
      >
        <i aria-hidden className="bx bx-calendar text-base" />
        {value === "custom" ? filterText("custom", custom) : "Pick dates"}
      </button>
    </div>
  );
}
