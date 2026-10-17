import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Kpi, PageHead, Panel } from "@/components/moa/ui";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/finance")({
  head: () => ({
    meta: [
      { title: "Financial Overview — MOA Mart Suite" },
      { name: "description", content: "Revenue, cost of goods and margin from paid orders." },
    ],
  }),
  component: Finance,
});

type Line = {
  price: number;
  qty: number;
  order_item_costs: { cost: number } | { cost: number }[] | null;
  products: { category: { name: string } | null } | null;
};
type PaidOrder = {
  id: string;
  code: string;
  customer_name: string;
  total: number;
  paid_at: string | null;
  created_at: string;
  payment_method: string | null;
  order_items: Line[];
};
type Unpaid = { id: string; code: string; customer_name: string; total: number; created_at: string };

const unitCost = (l: Line) => {
  const c = Array.isArray(l.order_item_costs) ? l.order_item_costs[0] : l.order_item_costs;
  return c?.cost ?? 0;
};

const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

const methodLabel = (m: string | null) =>
  m === "MTN_MOMO_RWA" ? "MTN MoMo" : m === "AIRTEL_RWA" ? "Airtel Money" : "—";

function Finance() {
  const { isAdmin, ready } = useAuth();
  const [paid, setPaid] = useState<PaidOrder[]>([]);
  const [unpaid, setUnpaid] = useState<Unpaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, code, customer_name, total, paid_at, created_at, payment_method, order_items(price, qty, order_item_costs(cost), products(category:categories(name)))",
          )
          .eq("payment_status", "paid")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("orders")
          .select("id, code, customer_name, total, created_at")
          .eq("payment_status", "awaiting_payment")
          .neq("fulfilment_status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (p.error) throw p.error;
      if (u.error) throw u.error;
      setPaid((p.data ?? []) as unknown as PaidOrder[]);
      setUnpaid((u.data ?? []) as unknown as Unpaid[]);
      setError("");
    } catch {
      setError("Could not load finance data. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    const channel = supabase
      .channel("admin-finance")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, load]);

  const { revenue, cogs } = useMemo(() => {
    let r = 0;
    let c = 0;
    for (const o of paid)
      for (const l of o.order_items) {
        r += l.price * l.qty;
        c += unitCost(l) * l.qty;
      }
    return { revenue: r, cogs: c };
  }, [paid]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of paid)
      for (const l of o.order_items) {
        const name = l.products?.category?.name ?? "Other";
        map.set(name, (map.get(name) ?? 0) + l.price * l.qty);
      }
    return [...map].map(([label, value]) => ({ label: label.split(" ")[0] ?? label, value }));
  }, [paid]);

  const unpaidTotal = unpaid.reduce((n, o) => n + o.total, 0);
  const margin = revenue > 0 ? `${Math.round(((revenue - cogs) / revenue) * 100)}%` : "—";

  if (ready && !isAdmin) {
    return (
      <>
        <PageHead title="Financial Overview" subtitle="Revenue, costs and margins." />
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Finance is only available to admins, because it shows product costs.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHead title="Financial Overview" subtitle="Revenue, cost of goods and margin from paid orders." />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Gross Revenue" value={money(revenue)} icon="bx-trending-up" />
        <Kpi label="Cost of Goods" value={money(cogs)} icon="bx-package" />
        <Kpi label="Gross Margin" value={margin} icon="bx-pie-chart-alt-2" />
        <Kpi label="Awaiting Payment" value={`${unpaid.length} · ${money(unpaidTotal)}`} icon="bx-time-five" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Panel title="Revenue by category" className="xl:col-span-2">
          {byCategory.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No paid orders yet. Revenue appears here once customers pay."}
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory}>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#6b7280"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => compact(v)}
                  />
                  <Tooltip
                    cursor={{ fill: "#ffffff08" }}
                    formatter={(v) => money(Number(v))}
                    contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="value" fill="#ffffff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Awaiting payment">
          {unpaid.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "Nothing is waiting for payment."}
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto">
              {unpaid.slice(0, 12).map((o) => (
                <li key={o.id} className="flex items-center gap-3 text-xs">
                  <span className="grid size-9 place-items-center rounded-lg bg-warning/10 text-warning">
                    <i className="bx bx-time-five" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{o.customer_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {o.code} · {new Date(o.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-primary">{money(o.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Recent payments" className="overflow-x-auto">
          {paid.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "No payments received yet."}
            </p>
          ) : (
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-3">Order</th>
                  <th className="pb-3">Customer</th>
                  <th className="pb-3">Method</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {paid.slice(0, 20).map((o) => (
                  <tr key={o.id} className="border-t border-[#262626]/60">
                    <td className="py-3 text-muted-foreground">{o.code}</td>
                    <td className="py-3">{o.customer_name}</td>
                    <td className="py-3 text-muted-foreground">{methodLabel(o.payment_method)}</td>
                    <td className="py-3 text-primary">{money(o.total)}</td>
                    <td className="py-3 text-muted-foreground">
                      {new Date(o.paid_at ?? o.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
