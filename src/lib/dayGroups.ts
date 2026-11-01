import { addDays, rangeText, todayKigali, type Range } from "@/lib/analytics";

/**
 * Days, the way the admin pages show them: a list is cut into days (Today, Yesterday, Monday 26 October ...) that can be folded away, and a row of
 * small date "stamps" jumps to one. All days are days in Kigali, whatever the phone's own clock zone says, the same as Analytics and Finance.
 */
export type DayFilter = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";
/** The shortcuts, in the order they are shown. "Pick dates" (a day or a range on the calendar) comes after them. */
export const DAY_FILTERS: Array<[Exclude<DayFilter, "custom">, string]> = [
  ["all", "Any time"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The Kigali day (yyyy-mm-dd) of a moment. */
export const dayOf = (iso: string): string => todayKigali(new Date(iso));

const parts = (key: string) => {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
const utc = (key: string): number => {
  const p = parts(key);
  return Date.UTC(p.y, p.m - 1, p.d);
};
/** How many days from a to b (negative when b is earlier). */
const between = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86_400_000);

/** "Today", "Yesterday", "Monday 26 October", or with the year when it is not this year. */
export function dayLabel(key: string, today: string = todayKigali()): string {
  const gap = between(key, today);
  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  const p = parts(key);
  const base = `${WEEKDAYS_LONG[p.dow]} ${p.d} ${MONTHS_LONG[p.m - 1]}`;
  return p.y === parts(today).y ? base : `${base} ${p.y}`;
}

/** The short form for the jump row: "Today", "Yesterday", "Mon 26" this week, "26 Oct" this year, "26 Oct 25" before. */
export function stampOf(key: string, today: string = todayKigali()): string {
  const gap = between(key, today);
  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  const p = parts(key);
  if (gap > 1 && gap < 7) return `${WEEKDAYS[p.dow]} ${p.d}`;
  return p.y === parts(today).y ? `${p.d} ${MONTHS[p.m - 1]}` : `${p.d} ${MONTHS[p.m - 1]} ${String(p.y).slice(2)}`;
}

export type DayGroup<T> = { key: string; label: string; stamp: string; rows: T[] };

/** Cuts a list into days, in the order the days first appear (so a newest-first list stays newest-first). */
export function groupByDay<T>(rows: readonly T[], when: (r: T) => string, today: string = todayKigali()): Array<DayGroup<T>> {
  const out: Array<DayGroup<T>> = [];
  const at = new Map<string, DayGroup<T>>();
  for (const r of rows) {
    const key = dayOf(when(r));
    let g = at.get(key);
    if (!g) {
      g = { key, label: dayLabel(key, today), stamp: stampOf(key, today), rows: [] };
      at.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

/** The days a shortcut stands for, or null for "any time". "Last 7 days" is today and the six before it. */
export function rangeFor(filter: DayFilter, custom: Range | null, today: string = todayKigali()): Range | null {
  switch (filter) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "custom":
      return custom;
    default:
      return null;
  }
}

/** The moment a day starts, and the moment the next one starts (Kigali is UTC+2 all year). For asking the database for a range. */
export const startOfDay = (key: string): string => new Date(`${key}T00:00:00+02:00`).toISOString();
export const startOfNextDay = (key: string): string => startOfDay(addDays(key, 1));
export const inRange = (iso: string, r: Range | null): boolean => !r || (dayOf(iso) >= r.from && dayOf(iso) <= r.to);

/** What the active choice says, for a chip or an empty message. */
export function filterText(filter: DayFilter, custom: Range | null): string {
  if (filter === "custom") return custom ? rangeText(custom) : "Pick dates";
  return DAY_FILTERS.find(([k]) => k === filter)?.[1] ?? "Any time";
}
