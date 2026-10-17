import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Kpi, PageHead, Panel, StatusPill } from "@/components/moa/ui";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Overview — MOA Mart Suite" },
      { name: "description", content: "A live look at orders, payments and stock." },
    ],
  }),
  component: Overview,
});

const LOW_STOCK = 5;

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
type Stats = { orders: number; revenue: number; awaiting: number; alerts: number; live: number; chats: number };

function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [o, paid, aw, ac, live, ch, rec, al] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).neq("fulfilment_status", "cancelled"),
        supabase.from("orders").select("total").eq("payment_status", "paid").limit(5000),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("payment_status", "awaiting_payment")
          .neq("fulfilment_status", "cancelled"),
        supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null).lte("stock", LOW_STOCK),
        supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null),
        supabase.from("conversations").select("id", { count: "exact", head: true }).gte("last_active_at", since),
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
      const failed = [o, paid, aw, ac, live, ch, rec, al].find((r) => r.error);
      if (failed?.error) throw failed.error;
      const revenue = (paid.data ?? []).reduce((n: number, r: { total: number }) => n + Number(r.total), 0);
      setStats({
        orders: o.count ?? 0,
        revenue,
        awaiting: aw.count ?? 0,
        alerts: ac.count ?? 0,
        live: live.count ?? 0,
        chats: ch.count ?? 0,
      });
      setRecent((rec.data ?? []) as unknown as RecentOrder[]);
      setAlerts((al.data ?? []) as unknown as StockAlert[]);
      setError("");
    } catch {
      setError("Could not load the overview. Check your connection and refresh.");
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

  return (
    <>
      <PageHead title="Overview" subtitle="A live look at orders, payments and stock." />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Orders" value={String(stats?.orders ?? 0)} icon="bx-receipt" />
        <Kpi label="Paid Revenue" value={money(stats?.revenue ?? 0)} icon="bx-trending-up" />
        <Kpi label="Awaiting Payment" value={String(stats?.awaiting ?? 0)} icon="bx-time-five" />
        <Kpi label="Stock Alerts" value={String(stats?.alerts ?? 0)} icon="bx-error-circle" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {stats?.live ?? 0} products on sale · {stats?.chats ?? 0} chats in the last 24 hours
      </p>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Recent orders">
          {recent.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "No orders yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {recent.map((o) => (
                <li key={o.id} className="flex items-center gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="text-primary">{o.code}</span> · {o.customer_name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {o.order_items.map((i) => i.name).join(", ")}
                    </p>
                  </div>
                  <div className="grid shrink-0 justify-items-end gap-1">
                    <span className="text-primary">{money(o.total)}</span>
                    <div className="flex gap-1">
                      <StatusPill status={o.payment_status} />
                      <StatusPill status={o.fulfilment_status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="/admin/orders" className="mt-4 inline-block text-[11px] text-primary hover:underline">
            View all orders
          </Link>
        </Panel>

        <Panel title="Stock alerts">
          {alerts.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "Every product has enough stock."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {alerts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 text-xs">
                  {p.images[0] && <img src={p.images[0]} alt={p.name} className="size-10 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.sku}</p>
                  </div>
                  <span className={p.stock <= 0 ? "text-destructive" : "text-warning"}>
                    {p.stock <= 0 ? "Out of stock" : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/admin/inventory" className="mt-4 inline-block text-[11px] text-primary hover:underline">
            Open live inventory
          </Link>
        </Panel>
      </div>
    </>
  );
}
