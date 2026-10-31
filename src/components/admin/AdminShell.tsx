import { Link, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { AlertsContext } from "@/components/admin/alertsContext";
import type { AdminAlerts, Alert, Level } from "@/lib/adminAlerts";
import { useNotifications } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type AlertKey = "orders" | "inventory" | "inbox";
type Group = "Operations" | "Insight" | "Team";
type Route =
  | "/admin"
  | "/admin/orders"
  | "/admin/inbox"
  | "/admin/products"
  | "/admin/inventory"
  | "/admin/help"
  | "/admin/reviews"
  | "/admin/riders"
  | "/admin/analytics"
  | "/admin/finance"
  | "/admin/users";

type NavItem = {
  to: Route;
  label: string;
  icon: string;
  exact: boolean;
  adminOnly: boolean;
  alert: AlertKey | null;
  group: Group;
  /** Shown in the phone's bottom bar; everything else sits under "More". */
  tab: boolean;
};

const NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: "bx-grid-alt", exact: true, adminOnly: false, alert: null, group: "Operations", tab: true },
  { to: "/admin/orders", label: "Orders", icon: "bx-receipt", exact: false, adminOnly: false, alert: "orders", group: "Operations", tab: true },
  { to: "/admin/inbox", label: "Inbox", icon: "bx-conversation", exact: false, adminOnly: false, alert: "inbox", group: "Operations", tab: true },
  { to: "/admin/products", label: "Products", icon: "bx-package", exact: false, adminOnly: false, alert: null, group: "Operations", tab: true },
  { to: "/admin/inventory", label: "Inventory", icon: "bx-box", exact: false, adminOnly: false, alert: "inventory", group: "Operations", tab: false },
  { to: "/admin/riders", label: "Riders", icon: "bx-cycling", exact: false, adminOnly: false, alert: null, group: "Operations", tab: false },
  { to: "/admin/reviews", label: "Reviews", icon: "bx-star", exact: false, adminOnly: false, alert: null, group: "Operations", tab: false },
  { to: "/admin/help", label: "Help", icon: "bx-help-circle", exact: false, adminOnly: false, alert: null, group: "Operations", tab: false },
  { to: "/admin/analytics", label: "Analytics", icon: "bx-line-chart", exact: false, adminOnly: false, alert: null, group: "Insight", tab: false },
  { to: "/admin/finance", label: "Finance", icon: "bx-wallet", exact: false, adminOnly: true, alert: null, group: "Insight", tab: false },
  { to: "/admin/users", label: "Users", icon: "bx-user-circle", exact: false, adminOnly: true, alert: null, group: "Team", tab: false },
];

const GROUPS: Group[] = ["Operations", "Insight", "Team"];

const DOT: Record<Level, string> = {
  green: "bg-success",
  orange: "bg-warning",
  red: "bg-destructive",
};

/** Short wording for the strip at the top; the full sentence stays available as a tooltip. */
const SHORT: Record<AlertKey, (n: number) => string> = {
  orders: (n) => `${n} to dispatch`,
  inbox: (n) => `${n} waiting`,
  inventory: (n) => `${n} need stock`,
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function isActive(item: NavItem, pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return item.exact ? p === item.to : p === item.to || p.startsWith(`${item.to}/`);
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

/** The number of things waiting, in the colour of how urgent it is. Hidden when all is well. */
function Count({ alert, className }: { alert: Alert | undefined; className?: string }) {
  if (!alert || alert.level === "green" || alert.count <= 0) return null;
  return (
    <span
      title={alert.label}
      className={cn(
        "grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold leading-5",
        alert.level === "red" ? "bg-destructive text-white" : "bg-warning text-black",
        className,
      )}
    >
      {alert.count > 99 ? "99+" : alert.count}
      <span className="sr-only"> ({alert.label})</span>
    </span>
  );
}

function BrandMark({ size }: { size: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-[image:var(--gradient-neon)] text-primary-foreground",
        size === "md" ? "size-10" : "size-9",
      )}
    >
      <i className={cn("bx bx-cube-alt", size === "md" ? "text-2xl" : "text-xl")} />
    </span>
  );
}

/** Tablet: a narrow rail with icon and label. Desktop: the full sidebar with groups. */
function Sidebar({ items, pathname, alerts }: { items: NavItem[]; pathname: string; alerts: AdminAlerts }) {
  const groups = GROUPS.filter((g) => items.some((i) => i.group === g));
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-[#262626] bg-black md:flex lg:w-64">
      <div className="flex h-14 shrink-0 items-center justify-center px-2 lg:justify-start lg:px-5">
        <Link
          to="/admin"
          aria-label="MOA Suite, overview"
          activeOptions={{ exact: true }}
          activeProps={{ "aria-current": undefined }}
          className={cn("flex items-center gap-2.5 rounded-xl", FOCUS)}
        >
          <BrandMark size="md" />
          <span className="hidden font-display text-base font-semibold lg:inline">
            MOA<span className="neon-text"> Suite</span>
          </span>
        </Link>
      </div>

      <nav aria-label="Admin" className="flex-1 overflow-y-auto px-2 pb-4 pt-2 lg:px-3">
        {groups.map((g) => (
          <div
            key={g}
            className="mt-2 border-t border-[#262626] pt-2 first:mt-0 first:border-0 first:pt-0 lg:border-0 lg:pt-0"
          >
            <p className="hidden px-3 pb-1.5 pt-3 text-xs font-medium text-muted-foreground lg:block">{g}</p>
            <ul className="grid gap-1">
              {items
                .filter((i) => i.group === g)
                .map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        activeOptions={{ exact: item.exact }}
                        className={cn(
                          "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-xs transition-colors",
                          "lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm",
                          FOCUS,
                          active
                            ? "bg-white/10 text-foreground"
                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                        )}
                      >
                        <i className={cn("bx", item.icon, "text-xl lg:text-lg")} />
                        <span>{item.label}</span>
                        <Count
                          alert={item.alert ? alerts[item.alert] : undefined}
                          className="absolute right-1 top-1 lg:static lg:ml-auto"
                        />
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[#262626] p-2 lg:p-3">
        <Link
          to="/"
          className={cn(
            "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
            "lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm",
            FOCUS,
          )}
        >
          <i className="bx bx-store text-xl lg:text-lg" />
          <span className="lg:hidden">Shop</span>
          <span className="hidden lg:inline">View shop</span>
        </Link>
      </div>
    </aside>
  );
}

/** What needs doing right now, on every page (tablet and desktop). */
function Attention({ alerts }: { alerts: AdminAlerts }) {
  const entries: Array<[Route, AlertKey]> = [
    ["/admin/orders", "orders"],
    ["/admin/inbox", "inbox"],
    ["/admin/inventory", "inventory"],
  ];
  const open = entries.filter(([, key]) => alerts[key].level !== "green");
  if (open.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-success" /> All clear
      </p>
    );
  }
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Needs attention">
      {open.map(([to, key]) => {
        const a = alerts[key];
        return (
          <li key={key}>
            <Link
              to={to}
              title={a.label}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-white/5",
                FOCUS,
                a.level === "red" ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning",
              )}
            >
              <span className={cn("size-2 rounded-full", DOT[a.level], a.level === "red" && "motion-safe:animate-pulse")} />
              {SHORT[key](a.count)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Bell({ unread }: { unread: number }) {
  return (
    <Link
      to="/admin/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className={cn(
        "relative grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
        FOCUS,
      )}
    >
      <i className="bx bx-bell text-2xl" />
      {unread > 0 && (
        <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-xs font-semibold leading-5 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

function TopBar({
  title,
  alerts,
  unread,
  name,
  role,
}: {
  title: string;
  alerts: AdminAlerts;
  unread: number;
  name: string;
  role: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[#262626] bg-black px-4 md:px-6 lg:px-8">
      <Link
        to="/admin"
        aria-label="MOA Suite, overview"
        activeOptions={{ exact: true }}
        activeProps={{ "aria-current": undefined }}
        className={cn("rounded-xl md:hidden", FOCUS)}
      >
        <BrandMark size="sm" />
      </Link>
      <p className="truncate font-display text-base font-semibold md:hidden">{title}</p>

      <div className="hidden min-w-0 flex-1 md:block">
        <Attention alerts={alerts} />
      </div>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <Bell unread={unread} />
        <div className="hidden items-center gap-2.5 border-l border-[#262626] pl-3 md:flex">
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-full bg-secondary text-sm font-medium text-foreground"
          >
            {initials(name)}
          </span>
          <div className="hidden min-w-0 lg:block">
            <p className="max-w-40 truncate text-sm leading-tight">{name}</p>
            <p className="text-xs leading-tight text-muted-foreground">{role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

/** The phone's "More": everything that does not fit in the four tabs. It is the same sheet as every other popup. */
function MoreSheet({
  open,
  onClose,
  items,
  alerts,
  unread,
  name,
  role,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  alerts: AdminAlerts;
  unread: number;
  name: string;
  role: string;
}) {
  const row =
    "flex min-h-14 items-center gap-4 rounded-2xl px-4 text-base text-foreground transition-colors hover:bg-white/5";
  return (
    <div className="md:hidden">
      <AdminSheet open={open} onClose={onClose} title="More" subtitle={`${name} · ${role}`}>
        <ul className="-mx-2 grid gap-1">
          {items.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={cn(row, FOCUS)}>
                <i className={cn("bx", item.icon, "text-2xl text-muted-foreground")} />
                {item.label}
                <Count alert={item.alert ? alerts[item.alert] : undefined} className="ml-auto" />
              </Link>
            </li>
          ))}
          <li>
            <Link to="/admin/notifications" className={cn(row, FOCUS)}>
              <i className="bx bx-bell text-2xl text-muted-foreground" />
              Notifications
              {unread > 0 && (
                <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-xs font-semibold leading-5 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </li>
          <li>
            <Link to="/" className={cn(row, FOCUS)}>
              <i className="bx bx-store text-2xl text-muted-foreground" />
              View shop
            </Link>
          </li>
        </ul>
      </AdminSheet>
    </div>
  );
}

/** The phone's bottom bar: the four daily pages and "More". */
function BottomTabs({
  tabs,
  pathname,
  alerts,
  moreActive,
  moreDot,
  onMore,
}: {
  tabs: NavItem[];
  pathname: string;
  alerts: AdminAlerts;
  moreActive: boolean;
  moreDot: boolean;
  onMore: () => void;
}) {
  const tab = "relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors";
  return (
    <nav
      aria-label="Admin"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[#262626] bg-black pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((item) => {
        const active = isActive(item, pathname);
        const alert = item.alert ? alerts[item.alert] : undefined;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact }}
            className={cn(tab, FOCUS, active ? "text-foreground" : "text-muted-foreground")}
          >
            {active && <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-foreground" />}
            <span className="relative">
              <i className={cn("bx", item.icon, "text-2xl")} />
              <Count alert={alert} className="absolute -right-3 -top-1.5" />
            </span>
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-haspopup="dialog"
        className={cn(tab, FOCUS, moreActive ? "text-foreground" : "text-muted-foreground")}
      >
        {moreActive && <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-foreground" />}
        <span className="relative">
          <i className="bx bx-dots-horizontal-rounded text-2xl" />
          {moreDot && <span aria-hidden className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-warning" />}
        </span>
        More
      </button>
    </nav>
  );
}

/**
 * The frame of every admin page.
 * Phone: top bar + bottom tabs. Tablet: icon rail + top bar. Desktop: sidebar + top bar.
 * People only see the pages their role may open.
 */
export function AdminShell({
  isAdmin,
  alerts,
  name,
  role,
  children,
}: {
  isAdmin: boolean;
  alerts: AdminAlerts;
  name: string;
  role: string;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { unread } = useNotifications();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  const items = NAV.filter((n) => !n.adminOnly || isAdmin);
  const tabs = items.filter((n) => n.tab);
  const more = items.filter((n) => !n.tab);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const onNotifications = pathname.startsWith("/admin/notifications");
  const current = items.find((n) => isActive(n, pathname));
  const title = onNotifications ? "Notifications" : (current?.label ?? "Admin");
  const moreActive = onNotifications || more.some((n) => isActive(n, pathname));
  const moreDot = unread > 0 || alerts.inventory.level !== "green";

  return (
    <div className="moa-admin min-h-screen [&_.grid>*]:min-w-0">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>

      <Sidebar items={items} pathname={pathname} alerts={alerts} />

      <div className="md:pl-20 lg:pl-64">
        <TopBar title={title} alerts={alerts} unread={unread} name={name} role={role} />
        <main
          id="admin-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-5 outline-none md:px-6 md:pb-10 md:pt-8 lg:px-8"
        >
          <AlertsContext.Provider value={alerts}>{children}</AlertsContext.Provider>
        </main>
      </div>

      <BottomTabs
        tabs={tabs}
        pathname={pathname}
        alerts={alerts}
        moreActive={moreActive}
        moreDot={moreDot}
        onMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onClose={closeMore}
        items={more}
        alerts={alerts}
        unread={unread}
        name={name}
        role={role}
      />
    </div>
  );
}
