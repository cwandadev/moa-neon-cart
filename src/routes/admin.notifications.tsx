import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { ActionBar, btn, FilterTabs, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead } from "@/components/moa/ui";
import { useLongPress } from "@/lib/adminTools";
import { dismiss, markAllRead, markMany, markRead, markUnread, restore, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart Suite" }] }),
  component: AdminNotifications,
});

type Tab = "all" | "unread";

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};

function AdminNotifications() {
  const navigate = useNavigate();
  const { items, loaded, unread, canDismiss } = useNotifications();
  const [tab, setTab] = useState<Tab>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const press = useLongPress((id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  });

  const shown = tab === "unread" ? items.filter((n) => !n.read_at) : items;
  const groups = useMemo(() => {
    const out: Array<{ label: string; list: Notif[] }> = [];
    for (const n of shown) {
      const label = dayLabel(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.list.push(n);
      else out.push({ label, list: [n] });
    }
    return out;
  }, [shown]);

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

  const tabs: TabItem<Tab>[] = [
    { key: "all", label: "All", count: items.length },
    { key: "unread", label: "Unread", count: unread, tone: "warning" },
  ];

  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="New orders, payments and stock changes, newest first. Red needs action, orange needs a look, green is done."
        actions={
          <>
            {shown.length > 0 && (
              <button
                type="button"
                aria-pressed={selectMode}
                onClick={() => (selectMode ? stopSelecting() : setSelectMode(true))}
                className={cn(btn.ghost, selectMode && "border-foreground/60 bg-white/10")}
              >
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

      <FilterTabs
        items={tabs}
        value={tab}
        onChange={(k) => {
          setTab(k);
          setSelected(new Set());
        }}
        label="Show"
      />

      {selectMode && shown.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{selected.size === 0 ? "Tap notifications to select them" : `${picked.length} of ${shown.length} selected`}</span>
          <button type="button" onClick={() => setSelected(allPicked ? new Set() : new Set(shown.map((n) => n.id)))} className="min-h-11 px-2 text-foreground underline-offset-4 hover:underline">
            {allPicked ? "Clear selection" : "Select all shown"}
          </button>
        </div>
      )}

      <div className="mt-5">
        {loaded && shown.length === 0 ? (
          <div className="rounded-2xl border border-[#262626] bg-card">
            <EmptyState
              icon="bx-bell"
              title={tab === "unread" ? "You are all caught up" : "Nothing here yet"}
              hint={tab === "unread" ? "New orders, payments and stock alerts will show up here." : "Orders, payments and stock alerts show up here."}
              action={
                tab === "unread" && items.length > 0 ? (
                  <button type="button" className={btn.ghost} onClick={() => setTab("all")}>
                    Show all
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid gap-6">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">{g.label}</h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {g.list.map((n) => {
                    const t = SEV[n.severity] ?? SEV.info;
                    const isNew = !n.read_at;
                    const isPicked = selected.has(n.id);
                    return (
                      <li key={n.id} className={cn("flex items-start gap-1 rounded-2xl border", isPicked ? "border-foreground/60 bg-white/5" : isNew ? `${t.border} ${t.bg}` : "border-[#262626] bg-card")}>
                        {selectMode && (
                          <label className="grid min-h-11 min-w-11 shrink-0 place-items-center pl-2 pt-3">
                            <input type="checkbox" className="size-5" aria-label={`Select ${n.title}`} checked={isPicked} onChange={() => toggle(n.id)} />
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
                            <span className={cn("block text-base", isNew && "font-semibold")}>
                              {isNew && <span className="sr-only">Unread: </span>}
                              {n.title}
                            </span>
                            {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
                            <span className="mt-1 block text-sm text-muted-foreground">{timeAgo(n.created_at)}</span>
                          </span>
                          {isNew && <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full bg-current", t.text)} />}
                        </button>
                        {!selectMode && (
                          <div className="pr-1 pt-1.5">
                            <ActionMenu label={`Actions for ${n.title}`} items={menuFor(n)} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
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
