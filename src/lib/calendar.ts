import { addDays } from "@/lib/analytics";

/** Months are "yyyy-mm" strings, days are "yyyy-mm-dd": the same plain dates the rest of Analytics uses (Kigali days). */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d ?? 1));
};

export const monthOf = (iso: string): string => iso.slice(0, 7);
export const monthName = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1]!;
export const yearOf = (ym: string): number => Number(ym.slice(0, 4));

export function addMonths(ym: string, n: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Monday is 1 and Sunday is 7. */
export function isoWeekday(iso: string): number {
  const d = utc(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The same day number in another month, or its last day when that month is shorter (31 Jan plus a month is 28 Feb). */
export function shiftMonth(iso: string, n: number): string {
  const ym = addMonths(monthOf(iso), n);
  const last = new Date(Date.UTC(yearOf(ym), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return `${ym}-${String(Math.min(Number(iso.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** Six weeks, Monday first, so the calendar never changes height: the days of the month and the days around it. */
export function monthGrid(ym: string): string[] {
  const first = `${ym}-01`;
  const start = addDays(first, -(isoWeekday(first) - 1));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "Saturday 10 October 2026": what a screen reader says for a day. */
export function longDay(iso: string): string {
  const d = utc(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
