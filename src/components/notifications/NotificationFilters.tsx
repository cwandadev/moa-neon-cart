import { DateBar } from "@/components/admin/DayFolds";
import type { Range } from "@/lib/analytics";
import type { DayFilter } from "@/lib/dayGroups";
import { cn } from "@/lib/utils";

export type TypeChoice = { key: string; label: string; icon: string; n: number };
export type GroupBy = "day" | "type";

/**
 * The filters, in one place. On a wide screen this is the sidebar and is always on screen; on a tablet or a phone it is what the Filters button
 * opens (a dialog, or a sheet from the bottom). The same piece in both, so they can never disagree. A choice applies at once.
 */
export function FilterPanel({ types, total, type, onType, dateFilter, custom, onDate, onPick, group, onGroup }: { types: TypeChoice[]; total: number; type: string; onType: (key: string) => void; dateFilter: DayFilter; custom: Range | null; onDate: (v: Exclude<DayFilter, "custom">) => void; onPick: () => void; group: GroupBy; onGroup: (g: GroupBy) => void }) {
  const row = (key: string, label: string, n: number, icon?: string) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={type === key}
        onClick={() => onType(key)}
        className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", type === key ? "bg-white font-medium text-black" : "hover:bg-white/[0.06]")}
      >
        {icon && <i aria-hidden className={cn("bx text-lg", icon)} />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cn("text-xs tabular-nums", type === key ? "text-black/60" : "text-muted-foreground")}>{n}</span>
      </button>
    </li>
  );
  return (
    <div className="grid gap-6">
      <section aria-labelledby="nf-type">
        <h3 id="nf-type" className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Type
        </h3>
        <ul className="grid gap-1">
          {row("all", "All types", total, "bx-bell")}
          {types.map((t) => row(t.key, t.label, t.n, t.icon))}
        </ul>
      </section>
      <section aria-labelledby="nf-date">
        <h3 id="nf-date" className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Date
        </h3>
        <DateBar value={dateFilter} custom={custom} onChange={onDate} onPick={onPick} label="Notification date" stacked />
      </section>
      <section aria-labelledby="nf-group">
        <h3 id="nf-group" className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Group by
        </h3>
        <div role="group" aria-label="Group by" className="inline-grid w-full grid-cols-2 gap-1 rounded-xl border border-[#262626] p-1">
          {(["day", "type"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => onGroup(g)}
              className={cn("min-h-9 rounded-lg px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", group === g ? "bg-white font-medium text-black" : "hover:text-foreground")}
            >
              {g === "day" ? "Day" : "Type"}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
