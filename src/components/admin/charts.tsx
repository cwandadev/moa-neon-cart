import { cn } from "@/lib/utils";

export type BarRow = { label: string; value: number; note?: string | undefined };

/**
 * A list of horizontal bars: readable on a phone, where a column chart's labels collide.
 * Each row shows the label, a bar sized against the largest value, and the value.
 */
export function BarList({
  rows,
  format = (n) => String(n),
  tone = "bg-foreground/70",
  label,
}: {
  rows: BarRow[];
  format?: (n: number) => string;
  tone?: string;
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-4" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-medium">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }} />
          </div>
          {r.note && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export const compact = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

/** "+12% vs the 30 days before", for a number compared with the period before it. */
export function change(now: number, before: number, asPercent: boolean, unit: string): { text: string; tone: "up" | "down" | "flat" } | undefined {
  if (now === 0 && before === 0) return undefined;
  if (before === 0) return { text: `New: nothing ${unit}`, tone: "up" };
  const diff = now - before;
  if (diff === 0) return { text: `Same as ${unit}`, tone: "flat" };
  const sign = diff > 0 ? "+" : "−";
  const amount = asPercent ? `${Math.abs(Math.round((diff / before) * 100))}%` : String(Math.abs(diff));
  return { text: `${sign}${amount} vs ${unit}`, tone: diff > 0 ? "up" : "down" };
}
