import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Kpi, PageHead, Panel } from "@/components/moa/ui";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

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
const RANGES: Range[] = [7, 30, 90];

const FULFILMENT_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  out_for_delivery: "Out for delivery",
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

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

const tip = { background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12, fontSize: 12 };

function Analytics() {
  const [days, setDays] = useState<Range>(30);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (range: Range) => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString();
      const { data, error: err } = await supabase
        .from("orders")
        .select(
          "created_at, total, payment_status, fulfilment_status, order_items(name, qty, price, products(category:categories(name)))",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (err) throw err;
      setOrders((data ?? []) as unknown as Order[]);
      setError("");
    } catch {
      setError("Could not load analytics. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const view = useMemo(() => {
    const active = orders.filter((o) => o.fulfilment_status !== "cancelled");

    const slots = new Map<string, { label: string; value: number; count: number }>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      slots.set(dayKey(d), {
        label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        value: 0,
        count: 0,
      });
    }
    for (const o of active) {
      const s = slots.get(dayKey(new Date(o.created_at)));
      if (s) {
        s.value += o.total;
        s.count += 1;
      }
    }

    const prod = new Map<string, { qty: number; value: number }>();
    const cat = new Map<string, number>();
    for (const o of active) {
      for (const it of o.order_items) {
        const p = prod.get(it.name) ?? { qty: 0, value: 0 };
        p.qty += it.qty;
        p.value += it.price * it.qty;
        prod.set(it.name, p);
        const cn = it.products?.category?.name ?? "Other";
        cat.set(cn, (cat.get(cn) ?? 0) + it.price * it.qty);
      }
    }

    const totalValue = active.reduce((n, o) => n + o.total, 0);
    return {
      chart: [...slots.values()],
      statusCounts: Object.entries(FULFILMENT_LABELS).map(([k, label]) => ({
        label,
        value: orders.filter((o) => o.fulfilment_status === k).length,
      })),
      top: [...prod]
        .map(([name, v]) => ({ name, qty: v.qty, value: v.value }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8),
      byCategory: [...cat].map(([label, value]) => ({ label: label.split(" ")[0] ?? label, value })),
      totalValue,
      count: active.length,
      paidCount: active.filter((o) => o.payment_status === "paid").length,
    };
  }, [orders, days]);

  return (
    <>
      <PageHead title="Analytics" subtitle="Orders and order value from the storefront. Order value counts all orders, paid or not." />

      <div className="mb-5 flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setDays(r)}
            className={`hairline h-9 rounded-xl px-4 text-xs transition-colors ${
              days === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Last {r} days
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Orders" value={String(view.count)} icon="bx-receipt" />
        <Kpi label="Order Value" value={money(view.totalValue)} icon="bx-trending-up" />
        <Kpi
          label="Average Order"
          value={view.count > 0 ? money(Math.round(view.totalValue / view.count)) : "—"}
          icon="bx-calculator"
        />
        <Kpi label="Paid Orders" value={String(view.paidCount)} icon="bx-check-circle" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Panel title="Order value per day" className="xl:col-span-2">
          {view.count === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No orders in this period yet."}
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={view.chart}>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#6b7280"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    stroke="#6b7280"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => compact(v)}
                  />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={tip} />
                  <Area type="monotone" dataKey="value" stroke="#ffffff" fill="#ffffff22" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Orders by delivery status">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.statusCounts}>
                <CartesianGrid stroke="#262626" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} interval={0} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "#ffffff08" }} contentStyle={tip} />
                <Bar dataKey="value" fill="#ffffff" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Top products" className="overflow-x-auto">
          {view.top.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "No products ordered in this period."}
            </p>
          ) : (
            <table className="w-full min-w-[360px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-3">Product</th>
                  <th className="pb-3">Units</th>
                  <th className="pb-3">Value</th>
                </tr>
              </thead>
              <tbody>
                {view.top.map((p) => (
                  <tr key={p.name} className="border-t border-[#262626]/60">
                    <td className="py-3">{p.name}</td>
                    <td className="py-3 text-muted-foreground">{p.qty}</td>
                    <td className="py-3 text-primary">{money(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Order value by category">
          {view.byCategory.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "No orders in this period yet."}
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={view.byCategory}>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#6b7280"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => compact(v)}
                  />
                  <Tooltip cursor={{ fill: "#ffffff08" }} formatter={(v) => money(Number(v))} contentStyle={tip} />
                  <Bar dataKey="value" fill="#ffffff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Visitor traffic and customer sentiment will appear here once visit tracking and reviews are added.
      </p>
    </>
  );
}
