import { useState } from "react";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { RangeCalendar, type DraftRange } from "@/components/admin/RangeCalendar";
import { btn } from "@/components/admin/controls";
import { daysIn, lastMonth, rangeText, thisMonth, todayKigali, validateRange, yearToDate, type Range } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Pick a first and a last day on a calendar (days are counted in Kigali time). The same sheet Analytics uses, so both pages work alike. */
export function CustomRangeSheet({ open, onClose, initial, onApply }: { open: boolean; onClose: () => void; initial: Range; onApply: (r: Range) => void }) {
  const today = todayKigali();
  const [draft, setDraft] = useState<DraftRange>({ from: initial.from, to: initial.to });
  const done = draft.from !== null && draft.to !== null;
  const waitingForEnd = draft.from !== null && draft.to === null;
  const problem = done ? validateRange(draft.from!, draft.to!, today) : null;
  const days = done ? daysIn({ from: draft.from!, to: draft.to! }) : 0;
  const shortcut = (r: Range) => setDraft({ from: r.from, to: r.to });
  const box = (label: string, value: string | null, active: boolean) => (
    <div className={cn("rounded-2xl border p-3 transition-colors", active ? "border-white/60 bg-white/[0.06]" : "border-[#262626]")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-base", value ? "font-medium" : "text-muted-foreground")}>{value ? rangeText({ from: value, to: value }) : "Pick a day"}</p>
    </div>
  );
  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title="Custom range"
      subtitle="Tap the first day, then the last day. Days are counted in Kigali time."
      fullOnPhone
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} disabled={!done || problem !== null} onClick={() => done && onApply({ from: draft.from!, to: draft.to! })}>
            Show this range
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Shortcuts">
          {([["This month", thisMonth(today)], ["Last month", lastMonth(today)], ["Year to date", yearToDate(today)]] as [string, Range][]).map(([label, r]) => (
            <button key={label} type="button" className="min-h-11 whitespace-nowrap rounded-full border border-[#262626] px-3 text-[13px] text-muted-foreground transition-colors hover:border-white/40 hover:text-foreground" onClick={() => shortcut(r)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {box("From", draft.from, draft.from === null)}
          {box("To", draft.to, waitingForEnd)}
        </div>
        <div className="-mt-3 flex min-h-9 items-center justify-between gap-3 text-sm" aria-live="polite">
          <p className="text-muted-foreground">{done ? `${days} day${days === 1 ? "" : "s"} selected` : waitingForEnd ? "Now tap the last day" : "Tap the first day"}</p>
          {draft.from !== null && (
            <button type="button" className="min-h-9 px-2 text-foreground underline-offset-4 hover:underline" onClick={() => setDraft({ from: null, to: null })}>
              Clear
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-[#262626] p-3">
          <RangeCalendar value={draft} onChange={setDraft} max={today} />
        </div>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    </AdminSheet>
  );
}
