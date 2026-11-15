import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { timeAgo, type Notif, type Severity } from "@/lib/notifications";
import { markOrdersSeen, SEVERITY_RANK, updateWords, useOrderAlerts } from "@/lib/orderAlerts";
import { plural } from "@/lib/reviews";
import { cn } from "@/lib/utils";

// The colour of the news: red for cancelled or failed, orange for a warning, green for good news, the shop colour for the rest.
const TONE: Record<Severity, { pill: string; dot: string; box: string; icon: string }> = {
  critical: { pill: "bg-destructive/15 text-destructive", dot: "bg-destructive", box: "border-destructive/40 bg-destructive/10", icon: "text-destructive" },
  warning: { pill: "bg-warning/15 text-warning", dot: "bg-warning", box: "border-warning/40 bg-warning/10", icon: "text-warning" },
  success: { pill: "bg-success/15 text-success", dot: "bg-success", box: "border-success/40 bg-success/10", icon: "text-success" },
  info: { pill: "bg-primary/15 text-primary", dot: "bg-primary", box: "border-primary/30 bg-primary/10", icon: "text-primary" },
};
const toneOf = (s: Severity | undefined) => TONE[s ?? "info"] ?? TONE.info;
const worst = (list: Array<{ severity: Severity }>): Severity => list.reduce<Severity>((w, n) => (SEVERITY_RANK[n.severity] > SEVERITY_RANK[w] ? n.severity : w), "info");

// Where the full list is. (Cast so a project whose route list does not know "/notifications" yet still type-checks.)
const ALL = "/notifications" as never;

/** On an order's card: what is new about it. Nothing at all when there is nothing new. */
export function OrderUpdateBadge({ code, className }: { code: string; className?: string }) {
  const { by } = useOrderAlerts();
  const a = by.get(code);
  if (!a) return null;
  const more = a.unread - 1;
  const tone = toneOf(a.top.severity);
  return (
    <span data-order-update data-tone={a.top.severity} role="status" aria-label={`New about this order: ${updateWords(a.top)}${more > 0 ? `, and ${plural(more, "other update", "other updates")}` : ""}`} className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-[11px] font-medium", tone.pill, className)}>
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className={cn("absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping", tone.dot)} />
        <span className={cn("relative inline-flex size-2 rounded-full", tone.dot)} />
      </span>
      <span className="truncate">New: {updateWords(a.top)}</span>
      {more > 0 && <span className="shrink-0 opacity-70">+{more}</span>}
    </span>
  );
}

/** At the top of My orders: how many orders have something new, with a way to clear them and a way to the full list. */
export function OrderUpdatesStrip() {
  const { by, orders, total } = useOrderAlerts();
  if (orders === 0) return null;
  const tone = toneOf(worst([...by.values()].map((a) => a.top)));
  return (
    <div data-order-updates className={cn("mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 font-body text-sm", tone.box)}>
      <i aria-hidden className={cn("bx bx-bell text-xl", tone.icon)} />
      <p className="min-w-[11rem] flex-1">
        <strong className="font-semibold">{plural(orders, "order has", "orders have")}</strong> new updates
        {total > orders && <span className="text-muted-foreground"> ({total} in all)</span>}
      </p>
      <span className="ml-auto flex shrink-0 items-center gap-4 pl-8 sm:pl-0">
        <Link to={ALL} className={cn("py-1 underline-offset-4 hover:underline", tone.icon)}>
          See them
        </Link>
        <button type="button" onClick={() => markOrdersSeen(by.values())} className="py-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Mark all seen
        </button>
      </span>
    </div>
  );
}

/**
 * On the order itself: "What's new", the updates that arrived since it was last looked at. They stay on screen while the order is open (so they
 * can be read), and are marked seen a moment after it opens, which clears the badges everywhere else. Updates that arrive while it is open appear too.
 */
export function OrderWhatsNew({ code, delay = 1500 }: { code: string; delay?: number }) {
  const { by } = useOrderAlerts();
  const a = by.get(code);
  const [shown, setShown] = useState<Notif[]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!a) return undefined;
    setShown((cur) => {
      const have = new Set(cur.map((n) => n.id));
      const add = a.items.filter((n) => !have.has(n.id));
      return add.length === 0 ? cur : [...add, ...cur].sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    });
    const t = window.setTimeout(() => markOrdersSeen([a]), delay);
    return () => window.clearTimeout(t);
  }, [a, delay]);
  if (hidden || shown.length === 0) return null;
  const tone = toneOf(worst(shown));
  return (
    <section data-whats-new data-tone={worst(shown)} aria-label="What is new about this order" className={cn("mt-4 rounded-2xl border p-4", tone.box)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <i aria-hidden className={cn("bx bx-bell text-lg", tone.icon)} /> What is new
        </h2>
        <button type="button" onClick={() => setHidden(true)} aria-label="Hide what is new" className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground">
          <i aria-hidden className="bx bx-x text-xl" />
        </button>
      </div>
      <ul className="mt-2 grid gap-2">
        {shown.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-3 font-body text-sm">
            <span className="min-w-0">
              <span className="block font-medium">{updateWords(n)}</span>
              {n.body && <span className="block text-muted-foreground">{n.body}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
