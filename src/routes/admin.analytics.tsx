import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarList, change, compact } from "@/components/admin/charts";
import { btn, FilterTabs, type TabItem } from "@/components/admin/controls";
import { EmptyState, Kpi, PageHead, Panel, Skeleton } from "@/components/moa/ui";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — MOA Mart Suite" },
      { name: "description", content: "Orders, order value and top products from real storefront orders." },
    ],
  }),
  component: Analytics,
});

type Range = 7 | 30 | 90;
const DAY = 24 * 60 * 60 * 1000;

const FULFILMENT_LABELS: Record<string, string> = {
  pending: "Awaiting payment",
  confirmed: "To dispatch",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

type Item = { name: string; qty: number; price: number; products: { category: { name: string } | null } | null };
type Order = {
  created_at: string;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  order_items: Item[];
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tip = { background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12, fontSize: 13 };

const sum = (orders: Order[]) => {
  const active = orders.filter((o) => o.fulfilment_status !== "cancelled");
  const value = active.reduce((n, o) => n + o.total, 0);
  return { count: active.length, value, paid: active.filter((o) => o.payment_status === "paid").length, average: active.length ? Math.round(value / active.length) : 0 };
};

function Analytics() {
  const [days, setDays] = usePersistedState<Range>("moa:analytics:days", 30);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (range: Range) => {
    setLoading(true);
    try {
      // Twice the period: the second half is what the first half is compared with.
      const since = new Date(Date.now() - 2 * range * DAY).toISOString();
      const { data, error: err } = await supabase
        .from("orders")
        .select("created_at, total, payment_status, fulfilment_status, order_items(name, qty, price, products(category:categories(name)))")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (err) throw err;
      setOrders((data ?? []) as unknown as Order[]);
      setError("");
    } catch {
      setError("Could not load analytics. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const view = useMemo(() => {
    const edge = Date.now() - days * DAY;
    const current = orders.filter((o) => new Date(o.created_at).getTime() >= edge);
    const before = orders.filter((o) => new Date(o.created_at).getTime() < edge);
    const active = current.filter((o) => o.fulfilment_status !== "cancelled");

    const slots = new Map<string, { label: string; value: number }>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      slots.set(dayKey(d), { label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: 0 });
    }
    for (const o of active) {
      const s = slots.get(dayKey(new Date(o.created_at)));
      if (s) s.value += o.total;
    }

    const prod = new Map<string, { qty: number; value: number }>();
    const cat = new Map<string, number>();
    for (const o of active) {
      for (const it of o.order_items) {
        const p = prod.get(it.name) ?? { qty: 0, value: 0 };
        p.qty += it.qty;
        p.value += it.price * it.qty;
        prod.set(it.name, p);
        const name = it.products?.category?.name ?? "Other";
        cat.set(name, (cat.get(name) ?? 0) + it.price * it.qty);
      }
    }

    return {
      now: sum(current),
      before: sum(before),
      chart: [...slots.values()],
      status: Object.entries(FULFILMENT_LABELS).map(([k, label]) => ({ label, value: current.filter((o) => o.fulfilment_status === k).length })),
      top: [...prod].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 8),
      byCategory: [...cat].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    };
  }, [orders, days]);

  const unit = `the ${days} days before`;
  const dOrders = change(view.now.count, view.before.count, false, unit);
  const dValue = change(view.now.value, view.before.value, true, unit);
  const dAvg = change(view.now.average, view.before.average, true, unit);
  const dPaid = change(view.now.paid, view.before.paid, false, unit);

  const tabs: TabItem<`${Range}`>[] = [
    { key: "7", label: "7 days" },
    { key: "30", label: "30 days" },
    { key: "90", label: "90 days" },
  ];

  return (
    <>
      <PageHead title="Analytics" subtitle="Orders and order value from the storefront. Order value counts all orders, paid or not." />

      <FilterTabs items={tabs} value={String(days) as `${Range}`} onChange={(k) => setDays(Number(k) as Range)} label="Period" />

      {error && (
        <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">{error}</p>
          <button type="button" onClick={() => void load(days)} className={cn(btn.ghost, "mt-3")}>
            Try again
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && orders.length === 0 ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-[#262626] bg-card p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-8 w-28" />
            </div>
          ))
        ) : (
          <>
            <Kpi label="Orders" value={String(view.now.count)} icon="bx-receipt" delta={dOrders?.text} tone={dOrders?.tone ?? "flat"} />
            <Kpi label="Order value" value={money(view.now.value)} icon="bx-trending-up" delta={dValue?.text} tone={dValue?.tone ?? "flat"} />
            <Kpi label="Average order" value={view.now.count > 0 ? money(view.now.average) : "—"} icon="bx-calculator" delta={dAvg?.text} tone={dAvg?.tone ?? "flat"} />
            <Kpi label="Paid orders" value={String(view.now.paid)} icon="bx-check-circle" delta={dPaid?.text} tone={dPaid?.tone ?? "flat"} />
          </>
        )}
      </div>

      <div className="mt-6">
        <Panel title="Order value per day">
          {view.now.count === 0 ? (
            <EmptyState icon="bx-line-chart" title={loading ? "Loading…" : "No orders in this period yet"} hint={loading ? undefined : "Try a longer period."} />
          ) : (
            <div className="h-56 sm:h-72" role="img" aria-label="Order value per day">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={view.chart} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
                  <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => compact(v)} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={tip} />
                  <Area type="monotone" dataKey="value" stroke="#ffffff" fill="#ffffff22" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel title="Orders by status">
          <BarList label="Orders by status" rows={view.status} />
        </Panel>

        <Panel title="Top products">
          {view.top.length === 0 ? (
            <EmptyState icon="bx-package" title={loading ? "Loading…" : "No products ordered in this period"} />
          ) : (
            <ol className="divide-y divide-[#262626]" aria-label="Top products">
              {view.top.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-sm text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.qty} sold
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">{money(p.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Order value by category">
          {view.byCategory.length === 0 ? (
            <EmptyState icon="bx-category" title={loading ? "Loading…" : "No orders in this period yet"} />
          ) : (
            <BarList label="Order value by category" rows={view.byCategory} format={money} />
          )}
        </Panel>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">Visitor traffic and customer sentiment will appear here once visit tracking and reviews are added.</p>
    </>
  );
}
