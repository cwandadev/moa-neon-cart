import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { btn, FilterTabs, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead } from "@/components/moa/ui";
import { dismiss, markAllRead, markRead, markUnread, restore, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";
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
          unread > 0 ? (
            <button type="button" onClick={() => void markAllRead()} className={btn.ghost}>
              <i aria-hidden className="bx bx-check-double text-lg" /> Mark all as read
            </button>
          ) : undefined
        }
      />

      <FilterTabs items={tabs} value={tab} onChange={setTab} label="Show" />

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
                    return (
                      <li key={n.id} className={cn("flex items-start gap-1 rounded-2xl border", isNew ? `${t.border} ${t.bg}` : "border-[#262626] bg-card")}>
                        <button
                          type="button"
                          onClick={() => open(n)}
                          className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        <div className="pr-1 pt-1.5">
                          <ActionMenu label={`Actions for ${n.title}`} items={menuFor(n)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
