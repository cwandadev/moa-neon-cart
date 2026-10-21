import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useShellAlerts } from "@/components/admin/alertsContext";
import { change } from "@/components/admin/charts";
import { btn } from "@/components/admin/controls";
import { EmptyState, Kpi, PageHead, Skeleton } from "@/components/moa/ui";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Overview — MOA Mart Suite" },
      { name: "description", content: "What needs doing now, and how today compares with yesterday." },
    ],
  }),
  component: Overview,
});

const LOW_STOCK = 5;
const DAY = 24 * 60 * 60 * 1000;

type Slim = { created_at: string; paid_at: string | null; total: number; payment_status: string; fulfilment_status: string };
type RecentOrder = {
  id: string;
  code: string;
  customer_name: string;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  created_at: string;
  order_items: { name: string; qty: number }[];
};
type StockAlert = { id: string; name: string; sku: string; stock: number; images: string[] };
type Stats = {
  ordersToday: number;
  ordersYesterday: number;
  paidToday: number;
  paidYesterday: number;
  paidWeek: number;
  awaiting: number;
  live: number;
};

function startOfDay(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY;
}

const STAGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
  confirmed: { label: "To dispatch", cls: "bg-warning/10 text-warning" },
  out_for_delivery: { label: "On the way", cls: "bg-info/10 text-info" },
  delivered: { label: "Delivered", cls: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive" },
};

const TONE_CARD = {
  green: "border-[#262626]",
  orange: "border-warning/50 bg-warning/5",
  red: "border-destructive/50 bg-destructive/5",
} as const;
const TONE_NUM = { green: "text-muted-foreground", orange: "text-warning", red: "text-destructive" } as const;

function Overview() {
  const alerts = useShellAlerts();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [stock, setStock] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const weekAgo = new Date(startOfDay(-6)).toISOString();
      const [week, aw, live, rec, al] = await Promise.all([
        supabase
          .from("orders")
          .select("created_at, paid_at, total, payment_status, fulfilment_status")
          .or(`created_at.gte.${weekAgo},paid_at.gte.${weekAgo}`)
          .limit(5000),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("payment_status", "awaiting_payment")
          .neq("fulfilment_status", "cancelled"),
        supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null),
        supabase
          .from("orders")
          .select("id, code, customer_name, total, payment_status, fulfilment_status, created_at, order_items(name, qty)")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("products")
          .select("id, name, sku, stock, images")
          .is("archived_at", null)
          .lte("stock", LOW_STOCK)
          .order("stock", { ascending: true })
          .limit(6),
      ]);
      const failed = [week, aw, live, rec, al].find((r) => r.error);
      if (failed?.error) throw failed.error;

      const today = startOfDay(0);
      const yesterday = startOfDay(-1);
      const rows = (week.data ?? []) as unknown as Slim[];
      const placed = (from: number, to: number) =>
        rows.filter((o) => o.fulfilment_status !== "cancelled" && new Date(o.created_at).getTime() >= from && new Date(o.created_at).getTime() < to).length;
      const paidIn = (from: number, to: number) =>
        rows
          .filter((o) => o.payment_status === "paid" && o.paid_at && new Date(o.paid_at).getTime() >= from && new Date(o.paid_at).getTime() < to)
          .reduce((n, o) => n + Number(o.total), 0);
      setStats({
        ordersToday: placed(today, today + DAY),
        ordersYesterday: placed(yesterday, today),
        paidToday: paidIn(today, today + DAY),
        paidYesterday: paidIn(yesterday, today),
        paidWeek: paidIn(startOfDay(-6), today + DAY),
        awaiting: aw.count ?? 0,
        live: live.count ?? 0,
      });
      setRecent((rec.data ?? []) as unknown as RecentOrder[]);
      setStock((al.data ?? []) as unknown as StockAlert[]);
      setError("");
    } catch {
      setError("Could not load the overview. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const needs: Array<{ key: string; to: "/admin/orders" | "/admin/inbox" | "/admin/inventory"; icon: string; title: string; a: typeof alerts.orders; quiet: string }> = [
    { key: "orders", to: "/admin/orders", icon: "bx-receipt", title: "Orders to dispatch", a: alerts.orders, quiet: "Nothing to dispatch" },
    { key: "inbox", to: "/admin/inbox", icon: "bx-conversation", title: "Customers waiting", a: alerts.inbox, quiet: "No one is waiting for a reply" },
    { key: "stock", to: "/admin/inventory", icon: "bx-box", title: "Stock to fill", a: alerts.inventory, quiet: "Every product has enough stock" },
  ];
  const open = needs.filter((n) => n.a.level !== "green");

  const od = stats ? change(stats.ordersToday, stats.ordersYesterday, false, "yesterday") : undefined;
  const pd = stats ? change(stats.paidToday, stats.paidYesterday, true, "yesterday") : undefined;

  return (
    <>
      <PageHead title="Overview" subtitle="What needs doing now, and how today compares with yesterday." />

      {error && (
        <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">{error}</p>
          <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
            Try again
          </button>
        </div>
      )}

      <section aria-label="Needs you now">
        <h2 className="mb-3 font-display text-lg font-semibold">Needs you now</h2>
        {open.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-[#262626] bg-card p-4 text-sm text-muted-foreground">
            <span className="size-2.5 rounded-full bg-success" aria-hidden />
            All clear. No orders to dispatch, no one waiting, and stock is fine.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {open.map((n) => (
              <li key={n.key}>
                <Link to={n.to} className={cn("flex min-h-24 items-center gap-4 rounded-2xl border p-4 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE_CARD[n.a.level])}>
                  <span className={cn("font-display text-4xl font-semibold tabular-nums", TONE_NUM[n.a.level])}>{n.a.count}</span>
                  <span className="min-w-0">
                    <span className="block text-base">{n.title}</span>
                    <span className="block text-sm text-muted-foreground">{n.a.label}</span>
                  </span>
                  <i aria-hidden className="bx bx-chevron-right ml-auto text-2xl text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Numbers" className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">Today</h2>
        {loading && !stats ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading numbers">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-[#262626] bg-card p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-4 h-8 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Orders today" value={String(stats?.ordersToday ?? 0)} icon="bx-receipt" delta={od?.text} tone={od?.tone ?? "flat"} />
            <Kpi label="Paid today" value={money(stats?.paidToday ?? 0)} icon="bx-trending-up" delta={pd?.text} tone={pd?.tone ?? "flat"} />
            <Kpi label="Paid, last 7 days" value={money(stats?.paidWeek ?? 0)} icon="bx-calendar-week" />
            <Kpi label="Awaiting payment" value={String(stats?.awaiting ?? 0)} icon="bx-time-five" />
          </div>
        )}
        {stats && <p className="mt-3 text-sm text-muted-foreground">{stats.live} products on sale</p>}
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section aria-label="Recent orders" className="rounded-2xl border border-[#262626] bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold">Recent orders</h2>
            <Link to="/admin/orders" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState icon="bx-receipt" title={loading ? "Loading…" : "No orders yet"} hint={loading ? undefined : "Orders appear here as soon as customers place them."} />
          ) : (
            <ul className="divide-y divide-[#262626]">
              {recent.map((o) => {
                const st = STAGE[o.fulfilment_status] ?? { label: o.fulfilment_status, cls: "bg-muted text-muted-foreground" };
                return (
                  <li key={o.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium text-primary">{o.code}</span> · {o.customer_name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{o.order_items.map((i) => i.name).join(", ")}</p>
                    </div>
                    <div className="grid shrink-0 justify-items-end gap-1">
                      <span className="text-sm font-medium">{money(o.total)}</span>
                      <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", st.cls)}>{st.label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Stock alerts" className="rounded-2xl border border-[#262626] bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold">Stock alerts</h2>
            <Link to="/admin/inventory" className="text-sm text-primary hover:underline">
              Open inventory
            </Link>
          </div>
          {stock.length === 0 ? (
            <EmptyState icon="bx-check-circle" title={loading ? "Loading…" : "Every product has enough stock"} />
          ) : (
            <ul className="divide-y divide-[#262626]">
              {stock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  {p.images[0] ? (
                    <img src={p.images[0]} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                      <i aria-hidden className="bx bx-package text-xl" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.sku}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-medium", p.stock <= 0 ? "text-destructive" : "text-warning")}>
                    {p.stock <= 0 ? "Out of stock" : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
