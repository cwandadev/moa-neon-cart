import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { SwipeRow } from "@/components/notifications/SwipeRow";
import { Header } from "@/components/shop/Header";
import { useAuth } from "@/lib/auth";
import { dayLabel, dayOf } from "@/lib/dayGroups";
import { categoryOf, URGENCY } from "@/lib/notificationKinds";
import { dismiss, loadMore, markAllRead, markRead, markUnread, restore, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";
import { orderCodeOf } from "@/lib/orderAlerts";
import { usePersistedState } from "@/lib/persist";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart" }, { name: "robots", content: "noindex" }] }),
  component: Notifications,
});

const PAGE = 20;
// The sign-in and shop pages. (Cast so a project whose route list is older still type-checks.)
const LOGIN = "/login" as never;
const SHOP = "/" as never;

/**
 * A shopper's notifications. The same inbox as the shop's own, in the shop's own layout: on a wide screen a side list (All, Unread, and each kind
 * that is really there, with counts) and the list beside it; on a phone a row of chips you can swipe. The list is one panel under day headings.
 * A row opens what it is about (usually the order) and is marked read. On a phone a row can be swiped: right to mark it read, left to remove it.
 */
function Notifications() {
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const { items, loaded, unread, canDismiss, hasMore, loadingMore } = useNotifications();
  const [view, setView] = usePersistedState<string>("moa:cnotifs:view", "all");
  const [visible, setVisible] = useState(PAGE);

  const types = useMemo(() => {
    const m = new Map<string, { key: string; label: string; icon: string; n: number }>();
    for (const n of items) {
      const c = categoryOf(n.kind);
      const e = m.get(c.key) ?? { ...c, n: 0 };
      e.n += 1;
      m.set(c.key, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [items]);
  // A kind with nothing left in it (everything was removed, say) is no longer a choice.
  const current = view === "all" || view === "unread" || types.some((t) => t.key === view) ? view : "all";
  const shown = useMemo(() => (current === "all" ? items : current === "unread" ? items.filter((n) => !n.read_at) : items.filter((n) => categoryOf(n.kind).key === current)), [items, current]);
  const page = shown.slice(0, visible);
  const remaining = shown.length - page.length;

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; list: Notif[] }> = [];
    for (const n of page) {
      const k = dayOf(n.created_at);
      const g = out.find((x) => x.key === k);
      if (g) g.list.push(n);
      else out.push({ key: k, label: dayLabel(k), list: [n] });
    }
    return out;
  }, [page]);

  const choose = (key: string) => {
    setView(key);
    setVisible(PAGE);
  };
  const open = (n: Notif) => {
    void markRead(n.id);
    if (n.link) void navigate({ to: n.link as never });
  };
  const remove = (n: Notif) => {
    void dismiss([n.id]);
    toast("Notification removed.", { action: { label: "Undo", onClick: () => void restore([n]) } });
  };
  const menuFor = (n: Notif): MenuItem[] => [
    n.read_at ? { label: "Mark as unread", icon: "bx-envelope", onSelect: () => void markUnread(n.id) } : { label: "Mark as read", icon: "bx-envelope-open", onSelect: () => void markRead(n.id) },
    ...(canDismiss ? [{ label: "Remove", icon: "bx-trash", danger: true, onSelect: () => remove(n) }] : []),
  ];

  const filters = [
    { key: "all", label: "All", icon: "bx-bell", n: items.length },
    { key: "unread", label: "Unread", icon: "bx-envelope", n: unread },
    ...types.map((t) => ({ key: t.key, label: t.label, icon: t.icon, n: t.n })),
  ];

  const row = (n: Notif) => {
    const t = SEV[n.severity] ?? SEV.info;
    const isNew = !n.read_at;
    const code = orderCodeOf(n.link);
    const urgency = URGENCY[n.severity];
    return (
      <li key={n.id} className="group relative transition-colors hover:bg-white/[0.03]">
        <SwipeRow
          right={{ label: isNew ? "Mark read" : "Mark unread", icon: isNew ? "bx-envelope-open" : "bx-envelope", tone: "bg-info", run: () => void (isNew ? markRead(n.id) : markUnread(n.id)) }}
          left={canDismiss ? { label: "Remove", icon: "bx-trash", tone: "bg-destructive", run: () => remove(n) } : undefined}
        >
          <div className={cn("flex items-start border-l-2", isNew && n.severity === "critical" ? "border-l-destructive" : isNew && n.severity === "warning" ? "border-l-warning" : "border-l-transparent")}>
            <button type="button" onClick={() => open(n)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4">
              <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
                <i aria-hidden className={`bx ${t.icon} text-xl`} />
              </span>
              <span className="min-w-0 flex-1 font-body">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("block min-w-0 break-words text-sm sm:text-base", isNew ? "font-semibold" : "font-medium text-foreground/90")}>
                    {isNew && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {timeAgo(n.created_at)}
                    {isNew && <span aria-hidden className={cn("size-2 rounded-full bg-current", t.text)} />}
                  </span>
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.body}</span>}
                {(code || urgency || n.link) && (
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {code && <span className="font-medium text-primary">{code}</span>}
                    {urgency && <span className={cn("font-medium", t.text)}>{urgency}</span>}
                    {n.link && (
                      <span className="inline-flex items-center">
                        {code ? "View order" : "Open"} <i aria-hidden className="bx bx-chevron-right text-base" />
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
            <div className="flex items-start pr-1 pt-2" data-no-swipe>
              <ActionMenu label={`Actions for ${n.title}`} items={menuFor(n)} />
            </div>
          </div>
        </SwipeRow>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-14 lg:pt-8">
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <aside className="lg:sticky lg:top-28">
            <div className="flex items-start justify-between gap-3 lg:flex-col lg:items-stretch">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Notifications</h1>
                <p className="mt-1 font-body text-sm text-muted-foreground" aria-live="polite">
                  {!user || !loaded ? "Updates about your orders" : unread > 0 ? `${unread} unread` : "You are all caught up"}
                </p>
              </div>
              {unread > 0 && (
                <button type="button" onClick={() => void markAllRead()} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 font-body text-sm transition-colors hover:bg-secondary/60 lg:w-full lg:justify-center">
                  <i aria-hidden className="bx bx-check-double text-lg" /> Mark all read
                </button>
              )}
            </div>

            {user && items.length > 0 && (
              <>
                {/* Phones: chips you can swipe sideways */}
                <div role="group" aria-label="Show" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {filters.map((f) => (
                    <button key={f.key} type="button" aria-pressed={current === f.key} onClick={() => choose(f.key)} className={cn("shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 font-body text-sm transition-colors", current === f.key ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
                      {f.label}
                      <span className="ml-1.5 text-xs opacity-70">{f.n}</span>
                    </button>
                  ))}
                </div>
                {/* Desktop: a list down the side */}
                <nav aria-label="Filter notifications" className="mt-5 hidden gap-1 lg:grid">
                  {filters.map((f) => (
                    <button key={f.key} type="button" aria-pressed={current === f.key} onClick={() => choose(f.key)} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors", current === f.key ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/60")}>
                      <i aria-hidden className={cn("bx text-lg", f.icon, current === f.key && "text-primary")} />
                      <span className="flex-1">{f.label}</span>
                      <span className="text-xs opacity-70">{f.n}</span>
                    </button>
                  ))}
                </nav>
              </>
            )}
          </aside>

          <section aria-label="Your notifications" className="mt-5 min-w-0 lg:mt-0">
            {ready && !user ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <i aria-hidden className="bx bx-bell text-5xl text-muted-foreground" />
                <p className="mt-3 font-display text-base font-semibold">Log in to see your notifications</p>
                <p className="mx-auto mt-1 max-w-xs font-body text-sm text-muted-foreground">Updates about your orders and payments show up here.</p>
                <Link to={LOGIN} className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-6 font-display text-sm font-semibold text-primary-foreground">
                  Log in
                </Link>
              </div>
            ) : !loaded ? (
              <ul aria-label="Loading notifications" className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} aria-hidden className="flex gap-3 p-4">
                    <span className="size-10 animate-pulse rounded-full bg-white/[0.06]" />
                    <span className="grid flex-1 gap-2">
                      <span className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <span className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <i aria-hidden className="bx bx-bell text-5xl text-muted-foreground" />
                <p className="mt-3 font-display text-base font-semibold">No notifications yet</p>
                <p className="mx-auto mt-1 max-w-xs font-body text-sm text-muted-foreground">When your order is paid, on its way or delivered, you will see it here.</p>
                <Link to={SHOP} className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-6 font-display text-sm font-semibold text-primary-foreground">
                  Browse the shop
                </Link>
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-14 text-center">
                <i aria-hidden className={cn("bx text-5xl text-muted-foreground", current === "unread" ? "bx-check-circle" : "bx-search")} />
                <p className="mt-3 font-display text-base font-semibold">{current === "unread" ? "You are all caught up" : "Nothing here"}</p>
                <button type="button" onClick={() => choose("all")} className="mt-4 inline-flex h-10 items-center rounded-xl border border-border px-4 font-body text-sm hover:bg-secondary/60">
                  Show all
                </button>
              </div>
            ) : (
              <div className="overflow-clip rounded-2xl border border-border bg-card/60">
                {groups.map((g) => (
                  <section key={g.key} aria-label={g.label}>
                    <h2 className="flex items-center justify-between border-b border-t border-border bg-secondary/30 px-4 py-2 font-body text-xs font-medium uppercase tracking-wider text-muted-foreground first:border-t-0">
                      <span>{g.label}</span>
                      <span className="tabular-nums normal-case tracking-normal">{g.list.length}</span>
                    </h2>
                    <ul className="divide-y divide-border">{g.list.map(row)}</ul>
                  </section>
                ))}
                <div className="grid justify-items-center gap-2 border-t border-border px-4 py-4 font-body text-sm">
                  {remaining > 0 ? (
                    <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-4 hover:bg-secondary/60">
                      Show {Math.min(PAGE, remaining)} more <span className="text-muted-foreground">({remaining} left)</span>
                    </button>
                  ) : hasMore ? (
                    <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-secondary/60 disabled:opacity-60">
                      {loadingMore ? "Loading…" : "Load older notifications"}
                    </button>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <i aria-hidden className="bx bx-check-circle text-base" /> That is all of them
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
