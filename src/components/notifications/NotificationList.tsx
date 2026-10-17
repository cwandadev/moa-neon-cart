import { cn } from "@/lib/utils";
import { markAllRead, SEV, timeAgo, useNotifications, type Notif } from "@/lib/notifications";

export function NotificationList({ onOpen }: { onOpen: (n: Notif) => void }) {
  const { items, loaded, unread } = useNotifications();

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-sm text-muted-foreground">
          {unread > 0 ? `${unread} unread` : "You are all caught up"}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="font-body text-xs text-primary hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      {loaded && items.length === 0 ? (
        <p className="py-16 text-center font-body text-sm text-muted-foreground">
          Nothing here yet. Updates about your orders show up in this list.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((n) => {
            const t = SEV[n.severity] ?? SEV.info;
            const isNew = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpen(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors hover:bg-secondary/40",
                    isNew ? `${t.border} ${t.bg}` : "border-border bg-card/40",
                  )}
                >
                  <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
                    <i className={`bx ${t.icon} text-xl`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block font-body text-sm", isNew ? "font-semibold" : "font-medium")}>
                      {n.title}
                    </span>
                    {n.body && <span className="mt-0.5 block font-body text-xs text-muted-foreground">{n.body}</span>}
                    <span className="mt-1 block font-body text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </span>
                  {isNew && <span className={cn("mt-2 size-2 shrink-0 rounded-full bg-current", t.text)} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
