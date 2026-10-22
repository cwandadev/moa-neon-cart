import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { ActionBar, btn, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead } from "@/components/moa/ui";
import { useLongPress } from "@/lib/adminTools";
import { categoryOf, URGENCY } from "@/lib/notificationKinds";
import { dismiss, loadMore, markAllRead, markMany, markRead, markUnread, restore, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart Suite" }] }),
  component: AdminNotifications,
});

type Status = "all" | "unread" | "attention";
type GroupBy = "day" | "type";
const PAGE = 30;
const PINNED_MAX = 5;

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};

const isAttention = (n: Notif) => !n.read_at && (n.severity === "critical" || n.severity === "warning");

function AdminNotifications() {
  const navigate = useNavigate();
  const { items, loaded, unread, canDismiss, hasMore, loadingMore } = useNotifications();
  const [status, setStatus] = useState<Status>("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<GroupBy>("day");
  const [visible, setVisible] = useState(PAGE);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const press = useLongPress((id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  });

  // ----- what is shown -----
  const term = q.trim().toLowerCase();
  const pool = useMemo(
    () =>
      items.filter(
        (n) =>
          (status === "all" || (status === "unread" ? !n.read_at : isAttention(n))) &&
          (term === "" || `${n.title} ${n.body} ${categoryOf(n.kind).label}`.toLowerCase().includes(term)),
      ),
    [items, status, term],
  );
  const types = useMemo(() => {
    const m = new Map<string, { key: string; label: string; icon: string; n: number }>();
    for (const n of pool) {
      const c = categoryOf(n.kind);
      const e = m.get(c.key) ?? { ...c, n: 0 };
      e.n += 1;
      m.set(c.key, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [pool]);
  // A type with nothing left in it (everything was read, say) is no longer a filter.
  const activeType = category !== "all" && types.some((t) => t.key === category) ? category : "all";
  const shown = activeType === "all" ? pool : pool.filter((n) => categoryOf(n.kind).key === activeType);
  const filtersOn = status !== "all" || activeType !== "all" || term !== "";

  // What needs you comes first, above the rest, until you start filtering.
  const pinned = filtersOn ? [] : shown.filter(isAttention).slice(0, PINNED_MAX);
  const pinnedIds = new Set(pinned.map((n) => n.id));
  const rest = shown.filter((n) => !pinnedIds.has(n.id));
  const page = rest.slice(0, visible);
  const remaining = rest.length - page.length;
  const showType = group === "day" && activeType === "all";

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; list: Notif[] }> = [];
    const add = (key: string, label: string, n: Notif) => {
      const g = out.find((x) => x.key === key);
      if (g) g.list.push(n);
      else out.push({ key, label, list: [n] });
    };
    for (const n of page) {
      if (group === "day") {
        const l = dayLabel(n.created_at);
        add(l, l, n);
      } else {
        const c = categoryOf(n.kind);
        add(c.key, c.label, n);
      }
    }
    return out;
  }, [page, group]);

  // ----- changing the view starts again at the top, with nothing selected -----
  const reset = () => {
    setVisible(PAGE);
    setSelected(new Set());
  };
  const clearFilters = () => {
    setStatus("all");
    setCategory("all");
    setQ("");
    reset();
  };

  // ----- selecting -----
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const picked = shown.filter((n) => selected.has(n.id));
  const pickedUnread = picked.filter((n) => !n.read_at).length;
  const pickedRead = picked.length - pickedUnread;
  const allPicked = shown.length > 0 && shown.every((n) => selected.has(n.id));
  const stopSelecting = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const removePicked = () => {
    const list = picked;
    if (list.length === 0) return;
    void dismiss(list.map((n) => n.id));
    stopSelecting();
    toast(`${list.length} notification${list.length === 1 ? "" : "s"} removed.`, { action: { label: "Undo", onClick: () => void restore(list) } });
  };

  // ----- one notification -----
  const open = (n: Notif) => {
    void markRead(n.id);
    if (n.link) void navigate({ to: n.link as never });
  };
  const remove = (n: Notif) => {
    void dismiss([n.id]);
    toast("Notification removed.", { action: { label: "Undo", onClick: () => void restore([n]) } });
  };
  const menuFor = (n: Notif): MenuItem[] => [
    n.read_at
      ? { label: "Mark as unread", icon: "bx-envelope", onSelect: () => void markUnread(n.id) }
      : { label: "Mark as read", icon: "bx-envelope-open", onSelect: () => void markRead(n.id) },
    ...(canDismiss ? [{ label: "Remove", icon: "bx-trash", danger: true, onSelect: () => remove(n) }] : []),
  ];

  const row = (n: Notif) => {
    const t = SEV[n.severity] ?? SEV.info;
    const isNew = !n.read_at;
    const isPicked = selected.has(n.id);
    const c = categoryOf(n.kind);
    const urgency = URGENCY[n.severity];
    return (
      <li key={n.id} className={cn("group flex items-start gap-1 rounded-2xl border transition-colors", isPicked ? "border-foreground/60 bg-white/5" : isNew ? `${t.border} ${t.bg}` : "border-[#262626] bg-card hover:bg-white/[0.03]")}>
        {selectMode && (
          <label className="grid min-h-11 min-w-11 shrink-0 place-items-center pl-2 pt-3">
            <input type="checkbox" className="size-5 accent-white" aria-label={`Select ${n.title}`} checked={isPicked} onChange={() => toggle(n.id)} />
          </label>
        )}
        <button
          type="button"
          onClick={() => (selectMode ? toggle(n.id) : open(n))}
          {...press(n.id)}
          className="flex min-w-0 flex-1 select-none items-start gap-3 rounded-2xl p-4 text-left [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
            <i aria-hidden className={`bx ${t.icon} text-xl`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className={cn("block min-w-0 break-words text-base", isNew && "font-semibold")}>
                {isNew && <span className="sr-only">Unread: </span>}
                {n.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
            </span>
            {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.body}</span>}
            {(showType || urgency || n.link) && (
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                {showType && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-muted-foreground">
                    <i aria-hidden className={`bx ${c.icon} text-sm`} />
                    {c.label}
                  </span>
                )}
                {urgency && <span className={cn("font-medium", t.text)}>{urgency}</span>}
                {n.link && (
                  <span className="inline-flex items-center text-muted-foreground">
                    Open <i aria-hidden className="bx bx-chevron-right text-base" />
                  </span>
                )}
              </span>
            )}
          </span>
          {isNew && <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full bg-current", t.text)} />}
        </button>
        {!selectMode && (
          <div className="flex items-start pr-1 pt-1.5">
            <button
              type="button"
              aria-label={isNew ? `Mark ${n.title} as read` : `Mark ${n.title} as unread`}
              onClick={() => void (isNew ? markRead(n.id) : markUnread(n.id))}
              className="hidden size-10 place-items-center rounded-xl text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 md:grid"
            >
              <i aria-hidden className={cn("bx text-xl", isNew ? "bx-envelope-open" : "bx-envelope")} />
            </button>
            <ActionMenu label={`Actions for ${n.title}`} items={menuFor(n)} />
          </div>
        )}
      </li>
    );
  };

  const sectionAction = (list: Notif[]) => {
    const ids = list.filter((n) => !n.read_at).map((n) => n.id);
    return ids.length > 0 ? (
      <button type="button" onClick={() => void markMany(ids, true)} className="min-h-9 px-2 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
        Mark {ids.length} read
      </button>
    ) : null;
  };

  const statusTabs: TabItem<Status>[] = [
    { key: "all", label: "All", count: items.length },
    { key: "unread", label: "Unread", count: unread, tone: "warning" },
    { key: "attention", label: "Needs attention", count: items.filter(isAttention).length, tone: "warning" },
  ];
  const typeTabs: TabItem<string>[] = [{ key: "all", label: "All types", count: pool.length }, ...types.map((t) => ({ key: t.key, label: t.label, count: t.n }))];

  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="New orders, payments, stock changes and chats. Search them, filter them, and clear them as you go."
        actions={
          <>
            {shown.length > 0 && (
              <button type="button" aria-pressed={selectMode} onClick={() => (selectMode ? stopSelecting() : setSelectMode(true))} className={cn(btn.ghost, selectMode && "border-foreground/60 bg-white/10")}>
                <i aria-hidden className="bx bx-check-square text-lg" /> {selectMode ? "Done" : "Select"}
              </button>
            )}
            {unread > 0 && !selectMode && (
              <button type="button" onClick={() => void markAllRead()} className={btn.ghost}>
                <i aria-hidden className="bx bx-check-double text-lg" /> Mark all as read
              </button>
            )}
          </>
        }
      />

      {loaded && items.length > 0 && (
        <div className="grid gap-3">
          <SearchField
            value={q}
            onChange={(v) => {
              setQ(v);
              reset();
            }}
            label="Search notifications"
            placeholder="Search notifications"
          />
          <FilterTabs
            items={statusTabs}
            value={status}
            onChange={(k) => {
              setStatus(k);
              reset();
            }}
            label="Show"
          />
          {types.length > 1 && (
            <FilterTabs
              items={typeTabs}
              value={activeType}
              onChange={(k) => {
                setCategory(k);
                reset();
              }}
              label="Type"
            />
          )}
        </div>
      )}

      {loaded && items.length > 0 && (
        <div className="mt-4 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <p aria-live="polite" className="flex flex-wrap items-center gap-x-3">
            <span>{shown.length === 0 ? "Nothing matches" : `Showing ${Math.min(shown.length, page.length + pinned.length)} of ${shown.length}`}</span>
            {filtersOn && (
              <button type="button" onClick={clearFilters} className="min-h-9 text-foreground underline-offset-4 hover:underline">
                Clear filters
              </button>
            )}
          </p>
          <div role="group" aria-label="Group by" className="inline-grid grid-cols-2 gap-1 rounded-xl border border-[#262626] p-1">
            {(["day", "type"] as const).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={group === g}
                onClick={() => {
                  setGroup(g);
                  reset();
                }}
                className={cn(
                  "min-h-9 whitespace-nowrap rounded-lg px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  group === g ? "bg-white font-medium text-black" : "hover:text-foreground",
                )}
              >
                {g === "day" ? "By day" : "By type"}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectMode && shown.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{selected.size === 0 ? "Tap notifications to select them" : `${picked.length} of ${shown.length} selected`}</span>
          <button type="button" onClick={() => setSelected(allPicked ? new Set() : new Set(shown.map((n) => n.id)))} className="min-h-11 px-2 text-foreground underline-offset-4 hover:underline">
            {allPicked ? "Clear selection" : `Select all ${shown.length}`}
          </button>
        </div>
      )}

      <div className="mt-4">
        {!loaded ? (
          <ul aria-label="Loading notifications" className="grid gap-2 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} aria-hidden className="h-24 animate-pulse rounded-2xl border border-[#262626] bg-white/[0.04]" />
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-[#262626] bg-card">
            {items.length === 0 ? (
              <EmptyState icon="bx-bell" title="Nothing here yet" hint="Orders, payments, stock alerts and chats show up here." />
            ) : (
              <EmptyState
                icon={status === "unread" && term === "" && activeType === "all" ? "bx-check-circle" : "bx-search"}
                title={status === "unread" && term === "" && activeType === "all" ? "You are all caught up" : "No notifications match"}
                hint={term !== "" && hasMore ? "Older notifications that are not loaded yet may match too." : "Try another word, or clear the filters."}
                action={
                  <button type="button" className={btn.ghost} onClick={clearFilters}>
                    Clear filters
                  </button>
                }
              />
            )}
          </div>
        ) : (
          <div className="grid gap-6">
            {pinned.length > 0 && (
              <section aria-label="Needs attention" className="rounded-2xl border border-warning/30 bg-warning/[0.04] p-3">
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <i aria-hidden className="bx bx-error text-lg text-warning" />
                    Needs attention
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">{pinned.length}</span>
                  </h2>
                  {sectionAction(pinned)}
                </div>
                <ul className="grid gap-2 xl:grid-cols-2">{pinned.map(row)}</ul>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {g.label} <span className="ml-1 text-xs tabular-nums">{g.list.length}</span>
                  </h2>
                  {sectionAction(g.list)}
                </div>
                <ul className="grid gap-2 xl:grid-cols-2">{g.list.map(row)}</ul>
              </section>
            ))}
            {(remaining > 0 || hasMore) && (
              <div className="grid justify-items-center gap-2 pb-2">
                {remaining > 0 ? (
                  <button type="button" onClick={() => setVisible((v) => v + PAGE)} className={btn.ghost}>
                    Show {Math.min(PAGE, remaining)} more
                    <span className="text-muted-foreground">({remaining} left)</span>
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={btn.ghost}>
                      {loadingMore ? "Loading…" : "Load older notifications"}
                    </button>
                    {filtersOn && <p className="text-xs text-muted-foreground">Older notifications that are not loaded yet may match too.</p>}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ActionBar show={selected.size > 0}>
        <span className="mr-auto px-1 text-sm text-foreground">{picked.length} selected</span>
        <button type="button" onClick={() => setSelected(new Set())} className={btn.quiet}>
          Clear
        </button>
        {pickedRead > 0 && (
          <button
            type="button"
            className={cn(btn.ghost, "flex-1")}
            onClick={() => {
              void markMany(picked.map((n) => n.id), false);
              stopSelecting();
            }}
          >
            Mark unread ({pickedRead})
          </button>
        )}
        {pickedUnread > 0 && (
          <button
            type="button"
            className={cn(btn.ghost, "flex-1")}
            onClick={() => {
              void markMany(picked.map((n) => n.id), true);
              stopSelecting();
            }}
          >
            Mark read ({pickedUnread})
          </button>
        )}
        {canDismiss && (
          <button type="button" className={cn(btn.danger, "flex-1")} onClick={removePicked}>
            Remove ({picked.length})
          </button>
        )}
      </ActionBar>
    </>
  );
}
