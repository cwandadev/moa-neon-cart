import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shop/ConfirmDialog";
import { Header } from "@/components/shop/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  dismiss,
  markAllRead,
  markMany,
  markRead,
  markUnread,
  restore,
  SEV,
  timeAgo,
  useNotifications,
  type Notif,
} from "@/lib/notifications";
import { usePersistedState } from "@/lib/persist";
import { SelectCheck, SelectionBar, SelectionStrip } from "@/components/shop/SelectionBar";
import { useLongPress } from "@/lib/longPress";
import { notificationSelectionActions } from "@/lib/selection";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart" }] }),
  component: NotificationsPage,
});

type Filter = "all" | "unread" | "orders" | "payments" | "other";
type Category = "orders" | "payments" | "other";

const categoryOf = (kind: string): Category =>
  kind.startsWith("order_") ? "orders" : kind.startsWith("payment_") || kind.startsWith("refund_") ? "payments" : "other";

const actionLabel = (n: Notif) =>
  n.kind === "payment_failed"
    ? "Try again"
    : n.kind.startsWith("payment_") || n.kind.startsWith("refund_")
      ? "View order"
      : n.kind.startsWith("order_")
        ? "Track order"
        : "Open";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const menuItem =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors hover:bg-secondary";

function Menu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <i className="bx bx-dots-horizontal-rounded text-xl" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Row({
  n,
  canDismiss,
  onOpen,
  onToggle,
  onDelete,
  selecting,
  picked,
  onPick,
  onStartSelect,
}: {
  n: Notif;
  canDismiss: boolean;
  onOpen: (n: Notif) => void;
  onToggle: (n: Notif) => void;
  onDelete: (n: Notif) => void;
  selecting: boolean;
  picked: boolean;
  onPick: (id: string) => void;
  onStartSelect: (id: string) => void;
}) {
  const t = SEV[n.severity] ?? SEV.info;
  const unread = !n.read_at;
  const toggleText = unread ? "Mark as read" : "Mark as unread";
  const lp = useLongPress(() => onStartSelect(n.id), !selecting);
  // The click that follows a long press must not open the notification.
  const open = () => {
    if (lp.consumeLongPress()) return;
    onOpen(n);
  };
  return (
    <li
      {...lp.handlers}
      className={cn(
        "group rounded-2xl border p-4 transition-colors",
        unread ? cn(t.border, t.bg) : "border-border bg-card/40",
        selecting && "select-none",
        picked && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      <div className="flex gap-3">
        {selecting ? (
          <SelectCheck
            checked={picked}
            onToggle={() => onPick(n.id)}
            label={`Select notification: ${n.title}`}
            className="-ml-1"
          />
        ) : (
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
            <i className={`bx ${t.icon} text-xl`} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
              <p
                className={cn(
                  "font-display text-sm leading-snug",
                  unread ? "font-semibold" : "font-medium text-foreground/80",
                )}
              >
                {n.title}
              </p>
              {n.body && <p className="mt-0.5 line-clamp-2 font-body text-xs text-muted-foreground">{n.body}</p>}
            </button>
            {unread && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
          </div>

          <div className={cn("mt-2 flex items-center justify-between gap-2", selecting && "pointer-events-none opacity-40")}>
            <span className="font-body text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
            <div className="flex items-center gap-1">
              {n.link && (
                <button
                  type="button"
                  onClick={open}
                  className="rounded-lg px-2.5 py-1.5 font-body text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {actionLabel(n)}
                </button>
              )}
              {/* Desktop: quick buttons appear on hover */}
              <div className="hidden items-center gap-0.5 lg:flex lg:opacity-0 lg:transition-opacity lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={toggleText}
                  title={toggleText}
                  onClick={() => onToggle(n)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <i className={cn("bx text-lg", unread ? "bx-check" : "bx-envelope")} />
                </button>
                {canDismiss && (
                  <button
                    type="button"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => onDelete(n)}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <i className="bx bx-trash text-lg" />
                  </button>
                )}
              </div>
              {/* Phones: one menu */}
              <div className="lg:hidden">
                <Menu label="More actions">
                  {(close) => (
                    <>
                      <button
                        type="button"
                        className={menuItem}
                        onClick={() => {
                          close();
                          onToggle(n);
                        }}
                      >
                        <i className={cn("bx text-lg", unread ? "bx-check" : "bx-envelope")} /> {toggleText}
                      </button>
                      {canDismiss && (
                        <button
                          type="button"
                          className={cn(menuItem, "text-destructive")}
                          onClick={() => {
                            close();
                            onDelete(n);
                          }}
                        >
                          <i className="bx bx-trash text-lg" /> Delete
                        </button>
                      )}
                    </>
                  )}
                </Menu>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

const categoryLabel = (kind: string) => {
  const c = categoryOf(kind);
  return c === "orders" ? "Order" : c === "payments" ? "Payment" : "Update";
};

/** Desktop: a notification as a card, two across. (Phones keep the compact row above.) */
function Card({
  n,
  canDismiss,
  onOpen,
  onToggle,
  onDelete,
  selecting,
  picked,
  onPick,
  onStartSelect,
}: {
  n: Notif;
  canDismiss: boolean;
  onOpen: (n: Notif) => void;
  onToggle: (n: Notif) => void;
  onDelete: (n: Notif) => void;
  selecting: boolean;
  picked: boolean;
  onPick: (id: string) => void;
  onStartSelect: (id: string) => void;
}) {
  const t = SEV[n.severity] ?? SEV.info;
  const unread = !n.read_at;
  const toggleText = unread ? "Mark as read" : "Mark as unread";
  const lp = useLongPress(() => onStartSelect(n.id), !selecting);
  // The click that follows a long press must not open the notification.
  const open = () => {
    if (lp.consumeLongPress()) return;
    onOpen(n);
  };
  return (
    <li
      {...lp.handlers}
      className={cn(
        "group relative flex min-h-[11.5rem] flex-col rounded-2xl border p-5 transition-all hover:-translate-y-0.5",
        unread ? cn(t.border, t.bg) : "border-border bg-card/40 hover:border-primary/40",
        selecting && "select-none",
        picked && "border-primary bg-primary/5 ring-2 ring-primary",
      )}
    >
      {!selecting && (
        <SelectCheck
          checked={false}
          onToggle={() => onStartSelect(n.id)}
          label={`Select notification: ${n.title}`}
          className="absolute right-1 top-1 z-10 hidden opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:grid"
        />
      )}
      <div className="flex items-start gap-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", t.bg, t.text)}>
          <i className={`bx ${t.icon} text-2xl`} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="font-body text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {categoryLabel(n.kind)}
          </p>
          <p className="font-body text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
        </div>
        {selecting ? (
          <SelectCheck
            checked={picked}
            onToggle={() => onPick(n.id)}
            label={`Select notification: ${n.title}`}
            className="-mr-2 -mt-2"
          />
        ) : (
          unread && <span aria-label="Unread" className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" />
        )}
      </div>

      <button type="button" onClick={open} className="mt-4 text-left">
        <p
          className={cn(
            "font-display text-base leading-snug",
            unread ? "font-semibold" : "font-medium text-foreground/80",
          )}
        >
          {n.title}
        </p>
        {n.body && <p className="mt-1.5 line-clamp-3 font-body text-sm text-muted-foreground">{n.body}</p>}
      </button>

      <div className={cn("mt-auto flex items-center justify-between gap-2 pt-4", selecting && "pointer-events-none opacity-40")}>
        {n.link ? (
          <button
            type="button"
            onClick={open}
            className="-ml-2.5 flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-body text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {actionLabel(n)} <i className="bx bx-right-arrow-alt text-lg" />
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-0.5 transition-opacity group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <button
            type="button"
            aria-label={toggleText}
            title={toggleText}
            onClick={() => onToggle(n)}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <i className={cn("bx text-lg", unread ? "bx-check" : "bx-envelope")} />
          </button>
          {canDismiss && (
            <button
              type="button"
              aria-label="Delete"
              title="Delete"
              onClick={() => onDelete(n)}
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
            >
              <i className="bx bx-trash text-lg" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function NotificationsPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const { items, unread, loaded, canDismiss } = useNotifications();
  const [filter, setFilter] = usePersistedState<Filter>("moa:notifs:filter", "all");
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const stopSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  // Leave selection mode with Escape, and forget notifications that are gone.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelecting(false);
        setPicked(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);
  useEffect(() => {
    setPicked((prev) => {
      const keep = new Set([...prev].filter((id) => items.some((n) => n.id === id)));
      return keep.size === prev.size ? prev : keep;
    });
  }, [items]);

  useEffect(() => {
    if (ready && !user) void navigate({ to: "/login" });
  }, [ready, user, navigate]);

  const counts = useMemo(() => {
    const c = { all: items.length, unread, orders: 0, payments: 0, other: 0 };
    for (const n of items) c[categoryOf(n.kind)] += 1;
    return c;
  }, [items, unread]);

  // If the chosen filter has nothing left (for example "Other" after clearing), go back to All.
  useEffect(() => {
    if (loaded && filter !== "all" && counts[filter] === 0) setFilter("all");
  }, [loaded, filter, counts, setFilter]);

  const filtered = items.filter((n) =>
    filter === "all" ? true : filter === "unread" ? !n.read_at : categoryOf(n.kind) === filter,
  );

  const groups = useMemo(() => {
    const out: { label: string; rows: Notif[] }[] = [];
    for (const n of filtered) {
      const label = dayLabel(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(n);
      else out.push({ label, rows: [n] });
    }
    return out;
  }, [filtered]);

  if (!ready || !user) return null;

  const readItems = items.filter((n) => n.read_at);

  // Selection: what the chosen notifications allow.
  const selectedRows = items.filter((n) => picked.has(n.id));
  const { markRead: toRead, markUnread: toUnread, deletable } = notificationSelectionActions(selectedRows, canDismiss);
  const toggleOne = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startSelect = (id?: string) => {
    setSelecting(true);
    if (id) setPicked(new Set([id]));
  };
  const pickMany = (list: Notif[]) => setPicked(new Set(list.map((n) => n.id)));
  const markSelected = (list: Notif[], read: boolean) => {
    const ids = list.map((n) => n.id);
    if (ids.length === 0) return;
    void markMany(ids, read);
    stopSelect();
    toast(`Marked ${ids.length} as ${read ? "read" : "unread"}`, {
      action: { label: "Undo", onClick: () => void markMany(ids, !read) },
    });
  };

  const open = (n: Notif) => {
    void markRead(n.id);
    if (n.link) void navigate({ to: n.link as never });
  };
  const toggle = (n: Notif) => void (n.read_at ? markUnread(n.id) : markRead(n.id));

  const remove = (list: Notif[], text: string) => {
    if (list.length === 0) return;
    void dismiss(list.map((n) => n.id));
    toast(text, { action: { label: "Undo", onClick: () => void restore(list) } });
  };

  const tabs: { id: Filter; label: string; icon: string }[] = [
    { id: "all", label: "All", icon: "bx-bell" },
    { id: "unread", label: "Unread", icon: "bx-envelope" },
    { id: "orders", label: "Orders", icon: "bx-package" },
    { id: "payments", label: "Payments", icon: "bx-wallet" },
    ...(counts.other > 0 ? [{ id: "other" as Filter, label: "Other", icon: "bx-dots-horizontal-rounded" }] : []),
  ];

  const actions = (
    <>
      <button
        type="button"
        disabled={unread === 0}
        onClick={() => void markAllRead()}
        className={cn(menuItem, "disabled:opacity-40")}
      >
        <i className="bx bx-check-double text-lg" /> Mark all as read
      </button>
      {canDismiss && (
        <>
          <button
            type="button"
            disabled={readItems.length === 0}
            onClick={() => remove(readItems, `Cleared ${readItems.length} read`)}
            className={cn(menuItem, "disabled:opacity-40")}
          >
            <i className="bx bx-brush text-lg" /> Clear read ({readItems.length})
          </button>
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => setClearAllOpen(true)}
            className={cn(menuItem, "text-destructive disabled:opacity-40")}
          >
            <i className="bx bx-trash text-lg" /> Clear all ({items.length})
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className={cn("mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 lg:pt-8", selecting ? "pb-48 lg:pb-32" : "pb-28 lg:pb-14")}>
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <aside className="lg:sticky lg:top-28">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Notifications</h1>
                <p className="mt-1 font-body text-sm text-muted-foreground">
                  {unread > 0 ? `${unread} unread` : "You are all caught up"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {items.length > 0 && (
                  <Button
                    variant={selecting ? "neon" : "glass"}
                    className="h-10 rounded-xl px-4"
                    onClick={() => (selecting ? stopSelect() : startSelect())}
                  >
                    {selecting ? "Done" : "Select"}
                  </Button>
                )}
                {/* Phones: actions in a menu */}
                <div className="lg:hidden">
                  <Menu label="Notification actions">{() => actions}</Menu>
                </div>
              </div>
            </div>

            {/* Phones: chips */}
            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 font-body text-sm transition-colors",
                    filter === t.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {t.label}
                  <span className="ml-1.5 text-xs opacity-70">{counts[t.id]}</span>
                </button>
              ))}
            </div>

            {/* Desktop: list down the side, with the actions under it */}
            <nav className="mt-5 hidden gap-1 lg:grid">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors",
                    filter === t.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  <i className={cn("bx text-lg", t.icon, filter === t.id && "text-primary")} />
                  <span className="flex-1">{t.label}</span>
                  <span className="text-xs opacity-70">{counts[t.id]}</span>
                </button>
              ))}
            </nav>
            <div className="mt-4 hidden gap-1 border-t border-border pt-4 lg:grid">{actions}</div>
          </aside>

          <section className="mt-5 min-w-0 lg:mt-0">
            {selecting && items.length > 0 && (
              <SelectionStrip
                noun="notifications"
                total={filtered.length}
                picked={picked.size}
                onToggleAll={() => pickMany(picked.size >= filtered.length ? [] : filtered)}
                options={[
                  { label: "All in this view", count: filtered.length, onPick: () => pickMany(filtered) },
                  {
                    label: "Unread",
                    count: filtered.filter((n) => !n.read_at).length,
                    onPick: () => pickMany(filtered.filter((n) => !n.read_at)),
                  },
                  {
                    label: "Read",
                    count: filtered.filter((n) => n.read_at).length,
                    onPick: () => pickMany(filtered.filter((n) => n.read_at)),
                  },
                  { label: "None", count: picked.size, onPick: () => pickMany([]) },
                ]}
              />
            )}
            {!loaded ? (
              <ul className="grid gap-3 md:grid-cols-2 md:gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-card/40 md:h-48" />
                ))}
              </ul>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <i className="bx bx-bell text-5xl text-muted-foreground" />
                <p className="mt-3 font-display text-base font-semibold">No notifications</p>
                <p className="mx-auto mt-1 max-w-xs font-body text-sm text-muted-foreground">
                  Updates about your orders and payments show up here as they happen.
                </p>
                <Button variant="neon" className="mt-5 rounded-xl" onClick={() => void navigate({ to: "/" })}>
                  Browse the shop
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-14 text-center">
                <i className="bx bx-check-circle text-4xl text-success" />
                <p className="mt-3 font-display text-base font-semibold">
                  {filter === "unread" ? "Nothing unread" : "Nothing here"}
                </p>
                <Button variant="glass" className="mt-4 rounded-xl" onClick={() => setFilter("all")}>
                  Show all notifications
                </Button>
              </div>
            ) : (
              <div className="grid gap-6">
                {groups.map((g) => (
                  <div key={g.label}>
                    <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </h2>
                    <ul className="grid gap-2.5 md:hidden">
                      {g.rows.map((n) => (
                        <Row
                          key={n.id}
                          n={n}
                          canDismiss={canDismiss}
                          onOpen={selecting ? (x) => toggleOne(x.id) : open}
                          selecting={selecting}
                          picked={picked.has(n.id)}
                          onPick={toggleOne}
                          onStartSelect={startSelect}
                          onToggle={toggle}
                          onDelete={(x) => remove([x], "Notification deleted")}
                        />
                      ))}
                    </ul>
                    <ul className="hidden gap-4 md:grid md:grid-cols-2">
                      {g.rows.map((n) => (
                        <Card
                          key={n.id}
                          n={n}
                          canDismiss={canDismiss}
                          onOpen={selecting ? (x) => toggleOne(x.id) : open}
                          selecting={selecting}
                          picked={picked.has(n.id)}
                          onPick={toggleOne}
                          onStartSelect={startSelect}
                          onToggle={toggle}
                          onDelete={(x) => remove([x], "Notification deleted")}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                {items.length >= 50 && (
                  <p className="text-center font-body text-xs text-muted-foreground">Showing your latest 50.</p>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {selecting && picked.size > 0 && (
        <SelectionBar count={picked.size} onExit={stopSelect}>
          {toRead.length > 0 && (
            <Button variant="glass" className="h-11 rounded-xl" onClick={() => markSelected(toRead, true)}>
              Mark read {toRead.length}
            </Button>
          )}
          {toUnread.length > 0 && (
            <Button variant="glass" className="h-11 rounded-xl" onClick={() => markSelected(toUnread, false)}>
              Mark unread {toUnread.length}
            </Button>
          )}
          {deletable.length > 0 && (
            <Button
              variant="destructive"
              className="h-11 rounded-xl"
              onClick={() => {
                remove(deletable, `Deleted ${deletable.length}`);
                stopSelect();
              }}
            >
              Delete {deletable.length}
            </Button>
          )}
        </SelectionBar>
      )}

      <ConfirmDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title="Clear all notifications?"
        text={`${items.length} ${items.length === 1 ? "notification is" : "notifications are"} removed from your list. You can undo this right after.`}
        confirmLabel="Clear all"
        danger
        onConfirm={() => remove(items, `Cleared ${items.length}`)}
      />
    </div>
  );
}
