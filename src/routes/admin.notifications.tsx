import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { ActionBar, btn, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { CustomRangeSheet } from "@/components/admin/CustomRangeSheet";
import { DayHeader, scrollToDay, useFolds } from "@/components/admin/DayFolds";
import { EmptyState, PageHead } from "@/components/moa/ui";
import { FilterPanel, type GroupBy } from "@/components/notifications/NotificationFilters";
import { SwipeRow } from "@/components/notifications/SwipeRow";
import { useLongPress } from "@/lib/adminTools";
import { thisMonth, type Range as Days } from "@/lib/analytics";
import { dayLabel, dayOf, filterText, inRange, rangeFor, stampOf, type DayFilter } from "@/lib/dayGroups";
import { categoryOf, URGENCY } from "@/lib/notificationKinds";
import { dismiss, loadMore, markAllRead, markMany, markRead, markUnread, restore, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";
import { usePersistedState } from "@/lib/persist";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart Suite" }] }),
  component: AdminNotifications,
});

type Status = "all" | "unread" | "attention";
const PAGE = 30;

const isAttention = (n: Notif) => !n.read_at && (n.severity === "critical" || n.severity === "warning");

/**
 * The inbox. One row of tabs (All, Unread, Needs attention) with their counts is the main control. The rest (type, date, how to group) are
 * filters: a sidebar that is always on screen on a wide display, and one Filters button on a tablet or a phone. What is applied shows as small
 * chips you can remove, and only when something is applied. The list is one panel of compact rows under day headers that stay in view and fold.
 * On a phone a row can be swiped: right to mark it read, left to remove it (with Undo).
 */
function AdminNotifications() {
  const navigate = useNavigate();
  const { items, loaded, unread, canDismiss, hasMore, loadingMore } = useNotifications();
  const [status, setStatus] = usePersistedState<Status>("moa:notifs:status", "all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<GroupBy>("day");
  const [dateFilter, setDateFilter] = useState<DayFilter>("all");
  const [custom, setCustom] = useState<Days | null>(null);
  const [picking, setPicking] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const folds = useFolds();
  const [visible, setVisible] = useState(PAGE);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const press = useLongPress((id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  });

  // ----- what is shown -----
  const term = q.trim().toLowerCase();
  const dates = useMemo(() => rangeFor(dateFilter, custom), [dateFilter, custom]);
  const pool = useMemo(
    () =>
      items.filter(
        (n) =>
          (status === "all" || (status === "unread" ? !n.read_at : isAttention(n))) &&
          inRange(n.created_at, dates) &&
          (term === "" || `${n.title} ${n.body} ${categoryOf(n.kind).label}`.toLowerCase().includes(term)),
      ),
    [items, status, term, dates],
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
  const attentionCount = items.filter(isAttention).length;
  const chips = [
    ...(activeType !== "all" ? [{ key: "type", label: types.find((t) => t.key === activeType)?.label ?? activeType, clear: () => setCategory("all") }] : []),
    ...(dateFilter !== "all" ? [{ key: "date", label: filterText(dateFilter, custom), clear: () => (setDateFilter("all"), setCustom(null)) }] : []),
    ...(term !== "" ? [{ key: "search", label: `“${q.trim()}”`, clear: () => setQ("") }] : []),
  ];
  const filtersOn = status !== "all" || chips.length > 0;
  const page = shown.slice(0, visible);
  const remaining = shown.length - page.length;
  const byDay = group === "day";

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; stamp: string; list: Notif[] }> = [];
    const add = (key: string, label: string, stamp: string, n: Notif) => {
      const g = out.find((x) => x.key === key);
      if (g) g.list.push(n);
      else out.push({ key, label, stamp, list: [n] });
    };
    for (const n of page) {
      if (byDay) {
        const k = dayOf(n.created_at);
        add(k, dayLabel(k), stampOf(k), n);
      } else {
        const c = categoryOf(n.kind);
        add(c.key, c.label, c.label, n);
      }
    }
    return out;
  }, [page, byDay]);

  // ----- changing the view starts again at the top, with nothing selected -----
  const reset = () => {
    setVisible(PAGE);
    setSelected(new Set());
  };
  const clearFilters = () => {
    setCategory("all");
    setQ("");
    setDateFilter("all");
    setCustom(null);
    reset();
  };
  const jump = (key: string) => {
    folds.open(key);
    requestAnimationFrame(() => scrollToDay(`notifs-day-${key}`));
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
    n.read_at ? { label: "Mark as unread", icon: "bx-envelope", onSelect: () => void markUnread(n.id) } : { label: "Mark as read", icon: "bx-envelope-open", onSelect: () => void markRead(n.id) },
    ...(canDismiss ? [{ label: "Remove", icon: "bx-trash", danger: true, onSelect: () => remove(n) }] : []),
  ];

  const row = (n: Notif) => {
    const t = SEV[n.severity] ?? SEV.info;
    const isNew = !n.read_at;
    const isPicked = selected.has(n.id);
    const c = categoryOf(n.kind);
    const urgency = URGENCY[n.severity];
    const accent = isNew && n.severity === "critical" ? "border-l-destructive" : isNew && n.severity === "warning" ? "border-l-warning" : "border-l-transparent";
    return (
      <li key={n.id} className={cn("group relative transition-colors", isPicked ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
        <SwipeRow
          disabled={selectMode}
          right={{ label: isNew ? "Mark read" : "Mark unread", icon: isNew ? "bx-envelope-open" : "bx-envelope", tone: "bg-info", run: () => void (isNew ? markRead(n.id) : markUnread(n.id)) }}
          left={canDismiss ? { label: "Remove", icon: "bx-trash", tone: "bg-destructive", run: () => remove(n) } : undefined}
        >
          <div className={cn("flex items-start border-l-2", accent)}>
            {selectMode && (
              <label className="grid min-h-11 min-w-11 shrink-0 place-items-center pl-2 pt-2" data-no-swipe>
                <input type="checkbox" className="size-5 accent-white" aria-label={`Select ${n.title}`} checked={isPicked} onChange={() => toggle(n.id)} />
              </label>
            )}
            <button
              type="button"
              onClick={() => (selectMode ? toggle(n.id) : open(n))}
              {...press(n.id)}
              className="flex min-w-0 flex-1 select-none items-start gap-3 px-3 py-3 text-left [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
            >
              <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
                <i aria-hidden className={`bx ${t.icon} text-xl`} />
              </span>
              <span className="min-w-0 flex-1">
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
                {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground md:line-clamp-1">{n.body}</span>}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {byDay && (
                    <span className="inline-flex items-center gap-1">
                      <i aria-hidden className={`bx ${c.icon} text-sm`} />
                      {c.label}
                    </span>
                  )}
                  {urgency && <span className={cn("font-medium", t.text)}>{urgency}</span>}
                  {n.link && (
                    <span className="inline-flex items-center">
                      Open <i aria-hidden className="bx bx-chevron-right text-base" />
                    </span>
                  )}
                </span>
              </span>
            </button>
            {!selectMode && (
              <div className="flex items-start pr-1 pt-1.5" data-no-swipe>
                <button
                  type="button"
                  aria-label={isNew ? `Mark ${n.title} as read` : `Mark ${n.title} as unread`}
                  onClick={() => void (isNew ? markRead(n.id) : markUnread(n.id))}
                  className="hidden size-10 place-items-center rounded-xl text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 lg:grid"
                >
                  <i aria-hidden className={cn("bx text-xl", isNew ? "bx-envelope-open" : "bx-envelope")} />
                </button>
                <ActionMenu label={`Actions for ${n.title}`} items={menuFor(n)} />
              </div>
            )}
          </div>
        </SwipeRow>
      </li>
    );
  };

  const sectionAction = (list: Notif[]) => {
    const ids = list.filter((n) => !n.read_at).map((n) => n.id);
    return ids.length > 0 ? (
      <button type="button" onClick={() => void markMany(ids, true)} className="min-h-9 shrink-0 px-2 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
        Mark {ids.length} read
      </button>
    ) : null;
  };

  const statusTabs: TabItem<Status>[] = [
    { key: "all", label: "All", count: items.length },
    { key: "unread", label: "Unread", count: unread, tone: "warning" },
    { key: "attention", label: "Needs attention", count: attentionCount, tone: "warning" },
  ];
  const allFolded = groups.length > 0 && groups.every((g) => folds.isFolded(g.key));
  const moreItems: MenuItem[] = [
    ...(shown.length > 0 ? [{ label: selectMode ? "Stop selecting" : "Select", icon: "bx-check-square", onSelect: () => (selectMode ? stopSelecting() : setSelectMode(true)) } satisfies MenuItem] : []),
    ...(groups.length > 1 ? [{ label: allFolded ? "Open all groups" : "Fold all groups", icon: allFolded ? "bx-expand-vertical" : "bx-collapse-vertical", onSelect: () => (allFolded ? folds.unfoldAll() : folds.foldAll(groups.map((g) => g.key))) } satisfies MenuItem] : []),
    ...(byDay && groups.length > 1 ? groups.slice(0, 6).map((g) => ({ label: `Go to ${g.label}`, icon: "bx-calendar", onSelect: () => jump(g.key) }) satisfies MenuItem) : []),
  ];
  const panel = (
    <FilterPanel
      types={types}
      total={pool.length}
      type={activeType}
      onType={(k) => {
        setCategory(k);
        reset();
      }}
      dateFilter={dateFilter}
      custom={custom}
      onDate={(v) => {
        setDateFilter(v);
        reset();
      }}
      onPick={() => {
        setFiltersOpen(false);
        setPicking(true);
      }}
      group={group}
      onGroup={(g) => {
        setGroup(g);
        reset();
      }}
    />
  );

  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="New orders, payments, stock changes and chats."
        actions={
          <>
            {unread > 0 && !selectMode && (
              <button type="button" onClick={() => void markAllRead()} className={btn.ghost}>
                <i aria-hidden className="bx bx-check-double text-lg" /> Mark all as read
              </button>
            )}
            {moreItems.length > 0 && <ActionMenu label="More options for notifications" items={moreItems} />}
          </>
        }
      />

      {!loaded || items.length > 0 ? (
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <aside aria-label="Filters" className="sticky top-20 hidden lg:block">
            {panel}
          </aside>

          <div className="min-w-0">
            <div className="grid gap-3">
              <FilterTabs
                items={statusTabs}
                value={status}
                onChange={(k) => {
                  setStatus(k);
                  reset();
                }}
                label="Show"
              />
              <div className="flex gap-2">
                <SearchField
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    reset();
                  }}
                  label="Search notifications"
                  placeholder="Search notifications"
                />
                <button type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" className={cn(btn.ghost, "shrink-0 lg:hidden")}>
                  <i aria-hidden className="bx bx-slider-alt text-lg" />
                  Filters
                  {chips.length > 0 && <span className="grid size-5 place-items-center rounded-full bg-white text-xs font-medium text-black">{chips.length}</span>}
                </button>
              </div>
            </div>

            {loaded && chips.length > 0 && (
              <div aria-label="Applied filters" role="group" className="mt-3 flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <button key={c.key} type="button" onClick={() => { c.clear(); reset(); }} aria-label={`Remove filter: ${c.label}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#262626] bg-white/[0.06] px-3 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}
                    <i aria-hidden className="bx bx-x text-base" />
                  </button>
                ))}
                <button type="button" onClick={clearFilters} className="min-h-9 px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Clear all
                </button>
                <span aria-live="polite" className="ml-auto text-xs text-muted-foreground">
                  {shown.length === 0 ? "Nothing matches" : `${shown.length} of ${items.length}`}
                </span>
              </div>
            )}

            {selectMode && shown.length > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{selected.size === 0 ? "Tap notifications to select them" : `${picked.length} of ${shown.length} selected`}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setSelected(allPicked ? new Set() : new Set(shown.map((n) => n.id)))} className="min-h-11 px-2 text-foreground underline-offset-4 hover:underline">
                    {allPicked ? "Clear selection" : `Select all ${shown.length}`}
                  </button>
                  <button type="button" onClick={stopSelecting} className="min-h-11 px-2 text-muted-foreground underline-offset-4 hover:underline">
                    Done
                  </button>
                </span>
              </div>
            )}

            <div className="mt-4">
              {!loaded ? (
                <ul aria-label="Loading notifications" className="divide-y divide-[#262626] overflow-hidden rounded-2xl border border-[#262626] bg-card">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <li key={i} aria-hidden className="flex gap-3 p-4">
                      <span className="size-9 animate-pulse rounded-full bg-white/[0.06]" />
                      <span className="grid flex-1 gap-2">
                        <span className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                        <span className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : shown.length === 0 ? (
                <div className="rounded-2xl border border-[#262626] bg-card">
                  <EmptyState
                    icon={status === "unread" && chips.length === 0 ? "bx-check-circle" : "bx-search"}
                    title={status === "unread" && chips.length === 0 ? "You are all caught up" : "No notifications match"}
                    hint={(term !== "" || dateFilter !== "all") && hasMore ? "Older notifications that are not loaded yet may match too." : "Try another word, or clear the filters."}
                    action={
                      <span className="flex flex-wrap justify-center gap-2">
                        {chips.length > 0 && (
                          <button type="button" className={btn.ghost} onClick={clearFilters}>
                            Clear filters
                          </button>
                        )}
                        {status !== "all" && (
                          <button type="button" className={btn.ghost} onClick={() => setStatus("all")}>
                            Show all
                          </button>
                        )}
                      </span>
                    }
                  />
                </div>
              ) : (
                <section aria-label="Notification list" className="overflow-clip rounded-2xl border border-[#262626] bg-card">
                  {status === "all" && chips.length === 0 && attentionCount > 0 && (
                    <div className="flex items-center gap-3 border-b border-[#262626] bg-warning/[0.07] px-4 py-2.5 text-sm">
                      <i aria-hidden className="bx bx-error text-lg text-warning" />
                      <span className="min-w-0 flex-1">
                        <strong className="font-semibold">{attentionCount}</strong> {attentionCount === 1 ? "needs" : "need"} your attention
                      </span>
                      <button type="button" onClick={() => { setStatus("attention"); reset(); }} className="min-h-9 shrink-0 px-2 text-warning underline-offset-4 hover:underline">
                        Show
                      </button>
                    </div>
                  )}
                  {groups.map((g) => (
                    <section key={g.key} aria-label={g.label}>
                      <div className="sticky top-14 z-10 border-b border-t border-[#262626] bg-card/95 px-2 backdrop-blur first:border-t-0">
                        <DayHeader
                          id={`notifs-day-${g.key}`}
                          controls={`notifs-list-${g.key}`}
                          label={g.label}
                          count={g.list.length}
                          noun="notification"
                          badge={g.list.some((n) => !n.read_at) ? `${g.list.filter((n) => !n.read_at).length} new` : null}
                          folded={folds.isFolded(g.key)}
                          onToggle={() => folds.toggle(g.key)}
                          trailing={sectionAction(g.list)}
                        />
                      </div>
                      {folds.isFolded(g.key) ? null : (
                        <ul id={`notifs-list-${g.key}`} className="divide-y divide-[#262626]">
                          {g.list.map(row)}
                        </ul>
                      )}
                    </section>
                  ))}
                  <div className="grid justify-items-center gap-2 border-t border-[#262626] px-4 py-4 text-sm">
                    {remaining > 0 ? (
                      <button type="button" onClick={() => setVisible((v) => v + PAGE)} className={btn.ghost}>
                        Show {Math.min(PAGE, remaining)} more
                        <span className="text-muted-foreground">({remaining} left)</span>
                      </button>
                    ) : hasMore ? (
                      <>
                        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={btn.ghost}>
                          {loadingMore ? "Loading…" : "Load older notifications"}
                        </button>
                        {filtersOn && <p className="text-xs text-muted-foreground">Older notifications that are not loaded yet may match too.</p>}
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <i aria-hidden className="bx bx-check-circle text-base" /> That is all of them
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#262626] bg-card">
          <EmptyState icon="bx-bell" title="Nothing here yet" hint="Orders, payments, stock alerts and chats show up here." />
        </div>
      )}

      <AdminSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        subtitle={`${shown.length} of ${items.length} notifications`}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btn.ghost} disabled={chips.length === 0} onClick={clearFilters}>
              Clear all
            </button>
            <button type="button" className={btn.primary} onClick={() => setFiltersOpen(false)}>
              Show {shown.length}
            </button>
          </div>
        }
      >
        {panel}
      </AdminSheet>
      <CustomRangeSheet
        open={picking}
        onClose={() => setPicking(false)}
        initial={custom ?? thisMonth()}
        onApply={(r) => {
          setCustom(r);
          setDateFilter("custom");
          setPicking(false);
          reset();
        }}
      />

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
