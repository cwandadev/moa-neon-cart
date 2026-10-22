import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays } from "@/lib/analytics";
import { addMonths, isoWeekday, longDay, monthGrid, monthName, monthOf, shiftMonth, yearOf } from "@/lib/calendar";
import { cn } from "@/lib/utils";

export type DraftRange = { from: string | null; to: string | null };

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * A range calendar. The first tap sets the start, the second sets the end (an earlier second tap swaps them), a quick
 * preview follows the pointer, and the days that cannot be chosen are dimmed: tomorrow onwards, and anything too far from the start.
 * Keyboard: arrows move by day and week, Home and End go to the start and end of the week, PageUp and PageDown change the month
 * (with Shift, the year), Enter or Space chooses. The title opens a grid of months for a fast jump.
 */
export function RangeCalendar({
  value,
  onChange,
  max,
  maxDays = 800,
  today = max,
}: {
  value: DraftRange;
  onChange: (r: DraftRange) => void;
  /** The last day that can be chosen. */
  max: string;
  maxDays?: number;
  /** Marked in green. */
  today?: string;
}) {
  const [view, setView] = useState(monthOf(value.to ?? value.from ?? max));
  const [mode, setMode] = useState<"days" | "months">("days");
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState(value.to ?? value.from ?? max);
  const [monthsYear, setMonthsYear] = useState(yearOf(view));
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const pending = value.from !== null && value.to === null;
  const low = pending ? addDays(value.from!, -(maxDays - 1)) : "";
  const high = pending ? addDays(value.from!, maxDays - 1) : "";
  const blocked = (d: string) => d > max || (pending && (d < low || d > high));

  // What is highlighted: the chosen range, or, while choosing, the range up to the day the pointer is on.
  const preview = pending && hover !== null && !blocked(hover);
  const [a, b]: [string | null, string | null] = pending
    ? preview
      ? hover! < value.from!
        ? [hover!, value.from!]
        : [value.from!, hover!]
      : [value.from, value.from]
    : [value.from, value.to];

  const pick = (d: string) => {
    if (blocked(d)) return;
    setFocus(d);
    if (!pending) onChange({ from: d, to: null });
    else onChange(d >= value.from! ? { from: value.from, to: d } : { from: d, to: value.from });
    setHover(null);
  };

  const grid = monthGrid(view);
  const lastMonth = monthOf(max);

  // Keep the focused day on the screen, and move the real focus to it after a key press.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`button[data-date="${focus}"]`)?.focus();
  }, [focus, view]);

  const go = (next: string) => {
    const d = next > max ? max : next;
    moveFocus.current = true;
    setFocus(d);
    if (monthOf(d) !== view) setView(monthOf(d));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, string> = {
      ArrowLeft: addDays(focus, -1),
      ArrowRight: addDays(focus, 1),
      ArrowUp: addDays(focus, -7),
      ArrowDown: addDays(focus, 7),
      Home: addDays(focus, -(isoWeekday(focus) - 1)),
      End: addDays(focus, 7 - isoWeekday(focus)),
      PageUp: shiftMonth(focus, e.shiftKey ? -12 : -1),
      PageDown: shiftMonth(focus, e.shiftKey ? 12 : 1),
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    go(next);
  };

  const chevron = "grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="select-none" onMouseLeave={() => setHover(null)}>
      <div className="mb-2 flex items-center justify-between">
        {mode === "days" ? (
          <button type="button" aria-label="Choose month and year" aria-expanded={false} onClick={() => { setMonthsYear(yearOf(view)); setMode("months"); }} className="flex min-h-10 items-center gap-1.5 rounded-xl px-2 font-display text-base font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {monthName(view)} {yearOf(view)}
            <i aria-hidden className="bx bx-chevron-down text-lg text-muted-foreground" />
          </button>
        ) : (
          <button type="button" aria-label="Back to the days" aria-expanded onClick={() => setMode("days")} className="flex min-h-10 items-center gap-1.5 rounded-xl px-2 font-display text-base font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {monthsYear}
            <i aria-hidden className="bx bx-chevron-up text-lg text-muted-foreground" />
          </button>
        )}
        <div className="flex gap-1">
          <button type="button" aria-label={mode === "days" ? "Previous month" : "Previous year"} className={chevron} onClick={() => (mode === "days" ? setView(addMonths(view, -1)) : setMonthsYear((y) => y - 1))}>
            <i aria-hidden className="bx bx-chevron-left text-2xl" />
          </button>
          <button
            type="button"
            aria-label={mode === "days" ? "Next month" : "Next year"}
            className={chevron}
            disabled={mode === "days" ? view >= lastMonth : monthsYear >= yearOf(lastMonth)}
            onClick={() => (mode === "days" ? setView(addMonths(view, 1)) : setMonthsYear((y) => y + 1))}
          >
            <i aria-hidden className="bx bx-chevron-right text-2xl" />
          </button>
        </div>
      </div>

      {mode === "months" ? (
        <div className="grid grid-cols-3 gap-2 py-2 animate-in fade-in-0 duration-200 motion-reduce:animate-none" role="group" aria-label={`Months of ${monthsYear}`}>
          {Array.from({ length: 12 }, (_, i) => {
            const ym = `${monthsYear}-${String(i + 1).padStart(2, "0")}`;
            const off = ym > lastMonth;
            return (
              <button
                key={ym}
                type="button"
                disabled={off}
                aria-pressed={ym === view}
                onClick={() => { setView(ym); setFocus(`${ym}-01`); setMode("days"); }}
                className={cn("min-h-12 rounded-xl border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30", ym === view ? "border-white bg-white font-medium text-black" : "border-[#262626] hover:bg-white/10")}
              >
                {monthName(ym).slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : (
        <div role="grid" aria-label="Choose dates" ref={gridRef} onKeyDown={onKey} key={view} className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <div role="row" className="grid grid-cols-7">
            {WEEK.map((w) => (
              <div key={w} role="columnheader" className="grid h-9 place-items-center text-xs font-medium text-muted-foreground">
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div role="row" key={row} className="grid grid-cols-7">
              {grid.slice(row * 7, row * 7 + 7).map((d) => {
                const wd = isoWeekday(d);
                const inMonth = monthOf(d) === view;
                const off = blocked(d);
                const isStart = d === a;
                const isEnd = d === b;
                const edge = isStart || isEnd;
                const inBand = a !== null && b !== null && d >= a && d <= b && a !== b;
                const isToday = d === today;
                return (
                  <div key={d} role="gridcell" aria-selected={edge || inBand} className="relative grid h-11 place-items-center" onMouseEnter={() => pending && !off && setHover(d)}>
                    {inBand && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-1 inset-x-0",
                          preview ? "bg-white/[0.07]" : "bg-white/[0.12]",
                          (d === a || wd === 1) && "rounded-l-full",
                          (d === b || wd === 7) && "rounded-r-full",
                        )}
                      />
                    )}
                    <button
                      type="button"
                      data-date={d}
                      tabIndex={d === focus ? 0 : -1}
                      aria-label={longDay(d)}
                      aria-current={isToday ? "date" : undefined}
                      aria-pressed={edge}
                      aria-disabled={off || undefined}
                      onClick={() => pick(d)}
                      onFocus={() => setFocus(d)}
                      className={cn(
                        "relative z-10 grid size-10 place-items-center rounded-full text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        edge ? "bg-white font-semibold text-black" : off ? "cursor-not-allowed text-muted-foreground/30" : inMonth ? "text-foreground hover:bg-white/10" : "text-muted-foreground/60 hover:bg-white/10",
                        isToday && !edge && "font-semibold text-success",
                      )}
                    >
                      {Number(d.slice(8, 10))}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
