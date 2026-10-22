import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Grain = "hour" | "day" | "week" | "month";
/** Dates are plain yyyy-mm-dd strings: days in Kigali, whatever the phone's own clock zone says. */
export type Range = { from: string; to: string };
export type Preset = "today" | "7d" | "30d" | "90d" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
export const addDays = (s: string, n: number): string => {
  const d = fromIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
export const daysIn = (r: Range): number => Math.round((fromIso(r.to).getTime() - fromIso(r.from).getTime()) / 86_400_000) + 1;

/** Today's date in Kigali. */
export function todayKigali(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function presetRange(p: Exclude<Preset, "custom">, today: string = todayKigali()): Range {
  const days = p === "today" ? 1 : p === "7d" ? 7 : p === "30d" ? 30 : 90;
  return { from: addDays(today, -(days - 1)), to: today };
}
/** Shortcuts for the custom sheet. */
export const thisMonth = (today: string = todayKigali()): Range => ({ from: `${today.slice(0, 7)}-01`, to: today });
export function lastMonth(today: string = todayKigali()): Range {
  const first = `${today.slice(0, 7)}-01`;
  const to = addDays(first, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}
export const yearToDate = (today: string = todayKigali()): Range => ({ from: `${today.slice(0, 4)}-01-01`, to: today });

/** The window of the same length right before this one: what everything is compared with. */
export function previousRange(r: Range): Range {
  const n = daysIn(r);
  const to = addDays(r.from, -1);
  return { from: addDays(to, -(n - 1)), to };
}

/** One day is shown by the hour, up to about three months by the day, a year by the week, longer by the month. */
export function grainFor(r: Range): Grain {
  const n = daysIn(r);
  return n === 1 ? "hour" : n <= 92 ? "day" : n <= 370 ? "week" : "month";
}

export function validateRange(from: string, to: string, today: string = todayKigali()): string | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(fromIso(s)) === s;
  if (!ok(from) || !ok(to)) return "Choose both dates.";
  if (from > to) return "The start date must be on or before the end date.";
  if (to > today) return "The end date cannot be in the future.";
  if (daysIn({ from, to }) > 800) return "Please choose at most 800 days.";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parts = (t: string) => ({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)), d: Number(t.slice(8, 10)), h: Number(t.slice(11, 13) || "0") });

/** The short label under the chart: "09h", "10 Oct", "Oct". */
export function labelFor(t: string, grain: Grain): string {
  const { m, d, h } = parts(t);
  if (grain === "hour") return `${pad(h)}h`;
  if (grain === "month") return MONTHS[m - 1]!;
  return `${d} ${MONTHS[m - 1]}`;
}
/** The full label in the tooltip. */
export function longLabel(t: string, grain: Grain): string {
  const { y, m, d, h } = parts(t);
  const dow = DAYS[fromIso(t.slice(0, 10)).getUTCDay()]!;
  if (grain === "hour") return `${dow} ${d} ${MONTHS[m - 1]}, ${pad(h)}:00 to ${pad((h + 1) % 24)}:00`;
  if (grain === "week") return `Week of ${d} ${MONTHS[m - 1]} ${y}`;
  if (grain === "month") return `${MONTHS_LONG[m - 1]} ${y}`;
  return `${dow} ${d} ${MONTHS[m - 1]} ${y}`;
}
/** "10 Oct to 8 Nov 2026", or "Sat 10 Oct 2026" for one day. */
export function rangeText(r: Range): string {
  const a = parts(r.from);
  const b = parts(r.to);
  if (r.from === r.to) return `${DAYS[fromIso(r.from).getUTCDay()]} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  const left = a.y === b.y ? `${a.d} ${MONTHS[a.m - 1]}` : `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  return `${left} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

export const weekdayShort = (t: string): string => DAYS[fromIso(t.slice(0, 10)).getUTCDay()]!;

/** How the database's order statuses and payment methods are called on screen. */
export const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting payment",
  confirmed: "To dispatch",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
export const METHOD_LABEL: Record<string, string> = { mtn: "MTN MoMo", airtel: "Airtel Money", unknown: "Not recorded" };

export function fmtMinutes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "No data";
  if (n < 1) return "Under 1 min";
  if (n < 60) return `${Math.round(n)} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ---------- what the database returns ----------
export type SalesData = {
  series: { t: string; orders: number; revenue: number | null }[];
  totals: { orders: number; cancelled: number; paid_orders: number; revenue: number | null; avg_order: number | null; units: number };
  status: { key: string; n: number }[];
  methods: { key: string; n: number; revenue: number | null }[];
  by_weekday: number[];
  by_hour: number[];
  funnel: { placed: number; paid: number; delivered: number };
  top_products: { name: string; units: number; revenue: number | null }[];
  by_category: { name: string; units: number; revenue: number | null }[];
};
export type ProductsData = {
  top: { name: string; units: number; revenue: number | null }[];
  slow: { name: string; stock: number }[];
  options: { name: string; units: number }[];
  saved: { name: string; saved: number; units: number }[];
  totals: { units: number; products_sold: number; active_products: number };
};
export type InventoryData = {
  snapshot: { active: number; out: number; low: number; healthy: number; value_cost: number | null; value_retail: number | null };
  at_risk: { name: string; stock: number; days_left: number }[];
  lost_sales: { name: string; units: number }[];
  movements: { sold: number; returned: number; added: number; removed: number };
};
export type CustomersData = {
  series: { t: string; new: number }[];
  totals: { new: number; total: number; buyers: number; returning: number; orders_per_buyer: number };
  split: { key: string; n: number }[];
  top: { name: string; orders: number; spent: number }[] | null;
};
export type SupportData = {
  series: { t: string; chats: number }[];
  by_hour: number[];
  response: { median_min: number | null; p90_min: number | null; answered: number; unanswered: number };
  now: { waiting: number; oldest_min: number };
  by_staff: { name: string; chats: number }[];
  totals: { chats: number; closed: number };
};
export type FinanceData = {
  series: { t: string; revenue: number; cost: number; profit: number }[];
  totals: { revenue: number; cost: number; profit: number; margin_pct: number; refunded: number };
  by_category: { name: string; revenue: number; profit: number; margin_pct: number }[];
  by_method: { key: string; revenue: number }[];
};

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
/** The analytics functions are new, so they are not in any generated database types: call them by name. */
const call = (fn: string, args: Record<string, unknown>): RpcResult => (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => RpcResult }).rpc(fn, args);

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/could not find the function|does not exist|schema cache/i.test(msg)) return "The analytics update (migration 000019) has not been run yet.";
  return msg || "Something went wrong.";
}

/**
 * Loads one analytics function for a range (and, if asked, for the window right before it, to compare).
 * `grain: null` is for functions that take no grouping. A slower answer for an old range never overwrites a newer one.
 */
export function useAnalytics<T>(fn: string, range: Range, opts: { compare?: boolean; grain?: Grain | null } = {}) {
  // What is on the screen stays on the screen while the next answer loads, so the charts can move to the new values
  // instead of being thrown away. `grain` belongs to the data that is showing, not to the range that was just asked for.
  const [state, setState] = useState<{ data: T | null; prev: T | null; grain: Grain | null; loading: boolean; error: string }>({ data: null, prev: null, grain: null, loading: true, error: "" });
  const latest = useRef(0);
  const compare = Boolean(opts.compare);
  const grain = opts.grain === undefined ? grainFor(range) : opts.grain;

  const load = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const args = (r: Range) => ({ p_from: r.from, p_to: r.to, ...(grain ? { p_grain: grain } : {}) });
    try {
      const jobs = [call(fn, args(range))];
      if (compare) jobs.push(call(fn, args(previousRange(range))));
      const [cur, prev] = await Promise.all(jobs);
      if (id !== latest.current) return;
      if (cur?.error) throw cur.error;
      if (prev?.error) throw prev.error;
      setState({ data: (cur?.data ?? null) as T | null, prev: prev ? ((prev.data ?? null) as T | null) : null, grain, loading: false, error: "" });
    } catch (e) {
      if (id !== latest.current) return;
      setState({ data: null, prev: null, grain: null, loading: false, error: friendly(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, range.from, range.to, compare, grain]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, grain: (state.grain ?? grain ?? "day") as Grain, reload: load };
}
