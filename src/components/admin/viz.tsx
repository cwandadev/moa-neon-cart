import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { btn } from "@/components/admin/controls";
import { compact } from "@/components/admin/charts";
import { Panel } from "@/components/moa/ui";
import { labelFor, longLabel, type Grain } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * One visual language for every chart: white and grey on black, a soft gradient under the line, a donut with gaps
 * between its slices, bars with rounded tops, and quiet axes. Colour is kept for the words (up and down), not the charts.
 */
export const INK = ["#ffffff", "#a3a3a3", "#737373", "#525252", "#404040", "#d4d4d4"];
export const tooltipStyle = { background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12, fontSize: 12 } as const;
const AXIS = { stroke: "#6b7280", fontSize: 11, tickLine: false, axisLine: false } as const;

// ---------- motion ----------
// Timing follows what dashboards usually do: about 700ms when a chart first appears, about 450ms when its data changes.
export const MOTION = { enter: 700, update: 450, easing: "ease-out" } as const;

/** True when the person asked their device for less motion: then everything just appears in its final state. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Starts at 0 and settles on the target one frame later, so a CSS transition can play on the way in and on every change. */
function useSettled(target: number): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const id = requestAnimationFrame(() => setValue(target));
    return () => cancelAnimationFrame(id);
  }, [target, reduced]);
  return value;
}

/** A number that counts to its target (from 0 the first time, from what it shows after that). It always ends on the exact value. */
export function useTween(target: number, ms: number = MOTION.update): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const shown = useRef(value);
  shown.current = value;
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const from = shown.current;
    const duration = from === 0 ? MOTION.enter : ms;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setValue(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, ms]);
  return value;
}

export function AnimatedNumber({ n, format }: { n: number; format: (n: number) => string }) {
  const v = useTween(n);
  return <>{format(Math.round(v))}</>;
}

/**
 * Keeps what is showing while newer numbers load: it dims a little and a thin line runs along the top.
 * Nothing is thrown away, so the charts below can move to the new values.
 */
export function Refreshing({ busy, children }: { busy: boolean; children: ReactNode }) {
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  useEffect(() => {
    if (busy) {
      setPhase("run");
      return;
    }
    setPhase((p) => (p === "run" ? "done" : p));
    const t = setTimeout(() => setPhase("idle"), 700);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <div className="relative" aria-busy={busy}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-3 h-0.5 overflow-hidden rounded-full">
        <div
          className="h-full origin-left rounded-full bg-white/70"
          style={{
            transform: `scaleX(${phase === "run" ? 0.85 : phase === "done" ? 1 : 0})`,
            opacity: phase === "idle" ? 0 : phase === "done" ? 0 : 1,
            transition: phase === "run" ? "transform 1400ms cubic-bezier(.2,.8,.2,1)" : phase === "done" ? "transform 250ms ease-out, opacity 400ms ease-out 250ms" : "none",
          }}
        />
      </div>
      <div className={cn("transition-opacity duration-300 motion-reduce:transition-none", busy && "opacity-60")}>{children}</div>
    </div>
  );
}

/** The biggest few as they are, the rest together as "Other": a donut stays readable with five or six slices. */
export function topWithOther<T extends { name: string; value: number }>(rows: T[], keep = 5): { name: string; value: number }[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep) return sorted.map((r) => ({ name: r.name, value: r.value }));
  const head = sorted.slice(0, keep - 1).map((r) => ({ name: r.name, value: r.value }));
  return [...head, { name: "Other", value: sorted.slice(keep - 1).reduce((n, r) => n + r.value, 0) }];
}

export function ChartCard({ title, hint, action, className, children }: { title: string; hint?: string | undefined; action?: ReactNode; className?: string | undefined; children: ReactNode }) {
  return (
    <Panel title={title} action={action} className={className ?? ""}>
      {hint && <p className="-mt-2 mb-3 text-sm text-muted-foreground">{hint}</p>}
      {children}
    </Panel>
  );
}

export function ChartSkeleton({ h = 240 }: { h?: number }) {
  return <div aria-hidden className="w-full animate-pulse rounded-xl bg-white/[0.06]" style={{ height: h }} />;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
      <p className="text-destructive">{message}</p>
      <button type="button" onClick={onRetry} className={cn(btn.ghost, "mt-3")}>
        Try again
      </button>
    </div>
  );
}

// ---------- the numbers at the top ----------

/** True from this width up (same as Tailwind's `sm`). */
function useWide(px = 640): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [px]);
  return wide;
}

export function Spark({ values }: { values: number[] }) {
  const id = useId();
  const reduced = useReducedMotion();
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-9 w-24" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke="#ffffff" strokeWidth={1.5} fill={`url(#${id})`} dot={false} isAnimationActive={!reduced} animationDuration={MOTION.enter} animationEasing={MOTION.easing} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Stat({
  label,
  value,
  short,
  n,
  format,
  shortFormat,
  delta,
  hint,
  spark,
}: {
  label: string;
  /** The value as text. When `n` is given it counts up to it; this is what it shows without motion. */
  value: string;
  /** A shorter way to write the value on a phone ("7.6M RWF" for "7,644,249 RWF"). */
  short?: string | undefined;
  /** The number behind the text, so it can count up. */
  n?: number | undefined;
  format?: ((n: number) => string) | undefined;
  shortFormat?: ((n: number) => string) | undefined;
  delta?: { text: string; tone: "up" | "down" | "flat" } | null | undefined;
  hint?: string | undefined;
  spark?: number[] | undefined;
}) {
  const wide = useWide();
  return (
    <div className="rounded-2xl border border-[#262626] bg-card p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {spark && spark.length > 1 && wide && <Spark values={spark} />}
      </div>
      <p className="mt-1 break-words font-display text-xl font-semibold tracking-tight sm:text-2xl">
        {short ? (
          <>
            <span className="sm:hidden">{n !== undefined && shortFormat ? <AnimatedNumber n={n} format={shortFormat} /> : short}</span>
            <span className="hidden sm:inline">{n !== undefined && format ? <AnimatedNumber n={n} format={format} /> : value}</span>
          </>
        ) : n !== undefined && format ? (
          <AnimatedNumber n={n} format={format} />
        ) : (
          value
        )}
      </p>
      {delta ? (
        <p className={cn("mt-1.5 text-xs", delta.tone === "up" ? "text-success" : delta.tone === "down" ? "text-destructive" : "text-muted-foreground")}>{delta.text}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------- over time ----------

export type TrendSeries = { key: string; label: string };

type TipProps = { active?: boolean; payload?: { dataKey: string; value: number; payload: Record<string, unknown> }[]; label?: string };

/** A line over time with a soft fill. A dashed line is the window before, for comparison. */
export function Trend({
  rows,
  series,
  prev,
  grain,
  format,
  height = 256,
  summary,
}: {
  rows: Record<string, number | string | null>[];
  series: TrendSeries[];
  prev?: (number | null)[] | undefined;
  grain: Grain;
  format: (n: number) => string;
  height?: number;
  summary: string;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const anim = { isAnimationActive: !reduced, animationDuration: MOTION.enter, animationEasing: MOTION.easing } as const;
  const data = rows.map((r, i) => ({ ...r, _label: labelFor(String(r["t"]), grain), _full: longLabel(String(r["t"]), grain), _prev: prev?.[i] ?? null }));
  const first = series[0]!;
  const Tip = ({ active, payload }: TipProps) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]!.payload;
    return (
      <div style={tooltipStyle} className="px-3 py-2 text-xs">
        <p className="mb-1 text-muted-foreground">{String(row["_full"])}</p>
        {series.map((s, i) => (
          <p key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: INK[i] }} />
            {s.label}: <span className="font-medium">{format(Number(row[s.key] ?? 0))}</span>
          </p>
        ))}
        {prev && row["_prev"] !== null && (
          <p className="mt-1 text-muted-foreground">Before: {format(Number(row["_prev"]))}</p>
        )}
      </div>
    );
  };
  return (
    <div role="img" aria-label={summary} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#262626" vertical={false} />
          <XAxis dataKey="_label" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
          <YAxis {...AXIS} width={42} tickFormatter={(v: number) => compact(v)} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={{ stroke: "#525252", strokeDasharray: "3 3" }} />
          {prev && <Line type="monotone" dataKey="_prev" stroke="#737373" strokeWidth={1.5} strokeDasharray="5 5" dot={false} {...anim} />}
          <Area type="monotone" dataKey={first.key} stroke="#ffffff" fill={`url(#${id})`} strokeWidth={2} dot={false} {...anim} />
          {series.slice(1).map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={INK[i + 1]} strokeWidth={2} dot={false} {...anim} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend for a trend with more than one line. */
export function LineKey({ series }: { series: TrendSeries[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: INK[i] }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// ---------- parts of a whole ----------

/**
 * A donut with gaps between the slices and the total in the middle. It is drawn here, not by the chart library, because the
 * library's donut fans its slices out from one point and misplaces them while it measures its box. Here each slice grows along
 * the ring in turn, and glides to its new size when the numbers change. Pointing at a slice (or its line below) shows it in the middle.
 * The legend gives the real numbers, so nothing depends on telling greys apart.
 */
export function Donut({
  items,
  format,
  centerValue,
  centerLabel,
  summary,
  side = false,
}: {
  items: { name: string; value: number }[];
  format: (n: number) => string;
  centerValue: ReactNode;
  centerLabel: string;
  summary: string;
  /** In a wide card: the legend sits beside the donut instead of under it. */
  side?: boolean;
}) {
  const total = items.reduce((n, i) => n + i.value, 0);
  const reduced = useReducedMotion();
  const grown = useSettled(1);
  const [hover, setHover] = useState<number | null>(null);
  // The same ring as before: from 55 to 90 out of a 190 box. The gap is 3 degrees.
  const R = 72.5;
  const W = 35;
  const C = 2 * Math.PI * R;
  const gap = items.length > 1 ? (3 / 360) * C : 0;
  let used = 0;
  const slices = items.map((it, i) => {
    const share = total > 0 ? it.value / total : 0;
    const len = Math.max(0, share * C - gap);
    const start = used * C + gap / 2;
    used += share;
    return { ...it, i, len, start };
  });
  const active = hover !== null ? slices[hover] : undefined;
  const move = reduced ? "none" : undefined;
  return (
    <div className={cn("flex flex-col items-center gap-4", side && "md:flex-row md:items-center")}>
      <div role="img" aria-label={summary} className="relative size-[190px] shrink-0">
        <svg viewBox="0 0 190 190" className="size-full" aria-hidden>
          {/* mirrored, so the slices run the same way round as the rest of the charts */}
          <g transform="translate(95 95) scale(1 -1)">
            <circle r={R} fill="none" stroke="#ffffff" strokeOpacity={0.05} strokeWidth={W} />
            {slices.map((s) => (
              <circle
                key={s.name}
                r={R}
                fill="none"
                stroke={INK[s.i % INK.length]}
                strokeWidth={hover === s.i ? W + 4 : W}
                strokeDasharray={`${grown ? s.len : 0} ${C}`}
                strokeDashoffset={-s.start}
                style={{ transition: move ?? `stroke-dasharray ${MOTION.enter}ms ease-out ${s.i * 90}ms, stroke-dashoffset ${MOTION.update}ms ease-out, stroke-width 150ms ease-out` }}
                onMouseEnter={() => setHover(s.i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${s.name}: ${format(s.value)}`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-[96px]">
            {active ? (
              <>
                <p className="font-display text-xl font-semibold leading-none">{format(active.value)}</p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{active.name}</p>
              </>
            ) : (
              <>
                <p className="font-display text-xl font-semibold leading-none">{centerValue}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{centerLabel}</p>
              </>
            )}
          </div>
        </div>
      </div>
      <ul className="grid w-full min-w-0 flex-1 gap-2 text-sm">
        {items.map((it, i) => (
          <li key={it.name} className={cn("-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-0.5 transition-colors", hover === i && "bg-white/[0.06]")} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: INK[i % INK.length] }} />
            <span className="min-w-0 flex-1 truncate">{it.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{format(it.value)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground">{total > 0 ? Math.round((it.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- comparing ----------

/** Vertical bars with rounded tops. The tallest one is the brightest. */
export function Columns({
  data,
  format,
  height = 220,
  summary,
  yFormat,
}: {
  data: { label: string; value: number }[];
  format: (n: number) => string;
  height?: number;
  summary: string;
  /** How the numbers on the left edge are written (default: 1.2k style). */
  yFormat?: ((n: number) => string) | undefined;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={summary} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#262626" vertical={false} />
          <XAxis dataKey="label" {...AXIS} interval={0} />
          <YAxis {...AXIS} width={40} allowDecimals={false} tickFormatter={(v: number) => (yFormat ? yFormat(v) : compact(v))} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} formatter={(v: number) => format(v)} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} isAnimationActive={!reduced} animationDuration={MOTION.enter} animationEasing={MOTION.easing}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value === max && max > 0 ? "#ffffff" : "#737373"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A bar that grows from the left to its share, and moves when the share changes. */
function GrowBar({ share, delay = 0, tall = false, gradient }: { share: number; delay?: number; tall?: boolean; gradient: string }) {
  const shown = useSettled(share);
  return (
    <div className={cn("overflow-hidden bg-white/10", tall ? "mt-1.5 h-9 rounded-xl bg-white/[0.06]" : "mt-1.5 h-2 rounded-full")} aria-hidden>
      <div
        className={cn("h-full w-full origin-left transition-transform ease-out motion-reduce:transition-none", tall ? "rounded-xl" : "rounded-full")}
        style={{ transform: `scaleX(${Math.max(0.02, shown)})`, transitionDuration: `${MOTION.enter}ms`, transitionDelay: `${delay}ms`, background: gradient }}
      />
    </div>
  );
}

/** A ranked list with a soft bar behind each name: easy to read on a phone, and the exact number is always written. */
export function RankBars({ rows, format, empty = "Nothing to show yet." }: { rows: { name: string; value: number; note?: string | undefined }[]; format: (n: number) => string; empty?: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="grid gap-3.5">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="mr-2 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              {r.name}
            </span>
            <span className="shrink-0 tabular-nums">{format(r.value)}</span>
          </div>
          <GrowBar share={r.value / max} delay={Math.min(i, 6) * 45} gradient="linear-gradient(90deg,#ffffff,#a3a3a3)" />
          {r.note && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** From order to delivery: each step is a bar, and the words say how many carried on. */
export function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  const top = Math.max(stages[0]?.value ?? 0, 1);
  return (
    <ol className="grid gap-3">
      {stages.map((s, i) => {
        const before = i === 0 ? null : stages[i - 1]!.value;
        const kept = before === null || before === 0 ? null : Math.round((s.value / before) * 100);
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums">
                {s.value}
                {kept !== null && <span className="ml-2 text-xs text-muted-foreground">{kept}% of the step before</span>}
              </span>
            </div>
            <GrowBar tall share={s.value / top} delay={i * 90} gradient={`linear-gradient(90deg,${INK[0]},${["#d4d4d4", "#a3a3a3", "#737373"][Math.min(i, 2)]})`} />
          </li>
        );
      })}
    </ol>
  );
}

/** 24 hours as a strip: the brighter the cell, the busier the hour. */
export function HeatStrip({ values, unit }: { values: number[]; unit: string }) {
  const max = Math.max(...values, 0);
  const peak = max > 0 ? values.indexOf(max) : -1;
  const lit = useSettled(1);
  return (
    <div>
      <ol className="grid grid-cols-12 gap-1 sm:[grid-template-columns:repeat(24,minmax(0,1fr))]" aria-label={`${unit} by hour of the day`}>
        {values.map((v, h) => (
          <li
            key={h}
            title={`${String(h).padStart(2, "0")}h: ${v} ${unit}`}
            className="grid h-10 place-items-center rounded-md text-[10px] tabular-nums transition-colors motion-reduce:transition-none"
            style={{ background: `rgba(255,255,255,${(0.06 + (max > 0 ? (v / max) * 0.94 * lit : 0)).toFixed(2)})`, color: max > 0 && v / max > 0.55 && lit > 0.5 ? "#0a0a0a" : "#9ca3af", transitionDuration: `${MOTION.enter}ms`, transitionDelay: `${h * 14}ms` }}
          >
            {h}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        {peak >= 0 ? `Busiest hour: ${String(peak).padStart(2, "0")}h to ${String((peak + 1) % 24).padStart(2, "0")}h (${max} ${unit}). ` : "No activity in this period. "}
        Brighter means busier. Hours are Kigali time.
      </p>
    </div>
  );
}

/** A short list where each line is a name and a small fact on the right. */
export function FactList({ rows, empty }: { rows: { name: string; value: string; note?: string | undefined }[]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-[#262626]">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
          <span className="min-w-0 truncate">{r.name}</span>
          <span className="shrink-0 tabular-nums">
            {r.value}
            {r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
