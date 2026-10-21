import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BASE = `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-60 ${RING}`;

/** Buttons are 44px tall so a thumb can hit them. */
export const btn = {
  primary: `${BASE} bg-primary font-semibold text-primary-foreground hover:opacity-90`,
  ghost: `${BASE} border border-[#262626] text-foreground hover:bg-white/5`,
  danger: `${BASE} bg-destructive font-semibold text-white hover:opacity-90`,
  quiet: `${BASE} text-muted-foreground hover:bg-white/5 hover:text-foreground`,
  dangerQuiet: `${BASE} text-destructive hover:bg-destructive/10`,
} as const;

export const field =
  "h-11 w-full rounded-xl border border-[#262626] bg-background px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50";

/** 16px text so phones do not zoom in when the field is tapped. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <i aria-hidden className="bx bx-search pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-muted-foreground" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(field, "pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className={cn("absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground", RING)}
        >
          <i aria-hidden className="bx bx-x text-2xl" />
        </button>
      )}
    </div>
  );
}

export type TabTone = "default" | "warning" | "info";

export type TabItem<K extends string> = {
  key: K;
  label: string;
  count?: number | undefined;
  tone?: TabTone;
};

const COUNT_TONE: Record<TabTone, string> = {
  default: "bg-white/10 text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
};

/** The filters of a list as pills that scroll sideways on a phone. */
export function FilterTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  wrap = false,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  /** In a narrow side panel: break into rows on tablet and desktop instead of scrolling sideways. */
  wrap?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        wrap && "md:flex-wrap md:overflow-visible md:pb-0",
      )}
    >
      {items.map((it) => {
        const active = it.key === value;
        const tone = it.tone ?? "default";
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.key)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors",
              RING,
              active
                ? "border-foreground/60 bg-white/10 text-foreground"
                : "border-[#262626] text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn("min-w-6 rounded-full px-1.5 text-center text-xs font-semibold leading-5", it.count > 0 ? COUNT_TONE[tone] : "bg-white/5 text-muted-foreground")}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Actions for the rows that are ticked. Sits above the phone's tab bar. */
export function ActionBar({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      inert={!show}
      className={cn(
        "fixed inset-x-0 z-30 px-3 transition-all duration-200 motion-reduce:transition-none",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 md:left-20 lg:left-64",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-[#262626] bg-[#0a0a0a] p-3 shadow-2xl shadow-black/60">
        {children}
      </div>
    </div>
  );
}

/** One value with a small label above it, for the detail screens. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}
