import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BarList } from "@/components/admin/charts";
import { btn, FilterTabs, type TabItem } from "@/components/admin/controls";
import { EmptyState, Kpi, PageHead, Panel, Skeleton } from "@/components/moa/ui";
import { ago, csvSafe, downloadText, toCsv } from "@/lib/adminTools";
import { useAuth } from "@/lib/auth";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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
type Period = "7" | "30" | "90" | "all";
const DAY = 24 * 60 * 60 * 1000;

const unitCost = (l: Line) => {
  const c = Array.isArray(l.order_item_costs) ? l.order_item_costs[0] : l.order_item_costs;
  return c?.cost ?? 0;
};
const methodLabel = (m: string | null) => (m === "MTN_MOMO_RWA" ? "MTN MoMo" : m === "AIRTEL_RWA" ? "Airtel Money" : "—");
const paidWhen = (o: PaidOrder) => o.paid_at ?? o.created_at;
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

function Finance() {
  const { isAdmin, ready } = useAuth();
  const [paid, setPaid] = useState<PaidOrder[]>([]);
  const [unpaid, setUnpaid] = useState<Unpaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = usePersistedState<Period>("moa:finance:period", "30");

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([
        supabase
          .from("orders")
          .select("id, code, customer_name, total, paid_at, created_at, payment_method, order_items(price, qty, order_item_costs(cost), products(category:categories(name)))")
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
      setError("Could not load finance data. Check your connection and try again.");
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

  const inPeriod = useMemo(() => {
    if (period === "all") return paid;
    const edge = Date.now() - Number(period) * DAY;
    return paid.filter((o) => new Date(paidWhen(o)).getTime() >= edge);
  }, [paid, period]);

  const { revenue, cogs, categories } = useMemo(() => {
    let r = 0;
    let c = 0;
    const cat = new Map<string, { revenue: number; cost: number }>();
    for (const o of inPeriod)
      for (const l of o.order_items) {
        const rev = l.price * l.qty;
        const cost = unitCost(l) * l.qty;
        r += rev;
        c += cost;
        const name = l.products?.category?.name ?? "Other";
        const cur = cat.get(name) ?? { revenue: 0, cost: 0 };
        cur.revenue += rev;
        cur.cost += cost;
        cat.set(name, cur);
      }
    return {
      revenue: r,
      cogs: c,
      categories: [...cat].map(([label, v]) => ({ label, value: v.revenue, note: `Margin ${pct(v.revenue - v.cost, v.revenue)}` })).sort((a, b) => b.value - a.value),
    };
  }, [inPeriod]);

  const unpaidTotal = unpaid.reduce((n, o) => n + o.total, 0);

  const exportCsv = () => {
    const rows: Array<Array<string | number | null | undefined>> = [
      ["Order", "Customer", "Method", "Amount (RWF)", "Paid"],
      ...inPeriod.map((o) => [o.code, csvSafe(o.customer_name), methodLabel(o.payment_method), o.total, new Date(paidWhen(o)).toLocaleString()]),
    ];
    downloadText(`moa-payments-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast.success(`${inPeriod.length} payment${inPeriod.length === 1 ? "" : "s"} exported.`);
  };

  if (ready && !isAdmin) {
    return (
      <>
        <PageHead title="Financial Overview" subtitle="Revenue, costs and margins." />
        <div className="rounded-2xl border border-[#262626] bg-card">
          <EmptyState icon="bx-lock-alt" title="Finance is only for admins" hint="It shows product costs and margins." />
        </div>
      </>
    );
  }

  const tabs: TabItem<Period>[] = [
    { key: "7", label: "7 days" },
    { key: "30", label: "30 days" },
    { key: "90", label: "90 days" },
    { key: "all", label: "All time" },
  ];

  return (
    <>
      <PageHead
        title="Financial Overview"
        subtitle="Revenue, cost of goods and margin from paid orders."
        actions={
          <button type="button" onClick={exportCsv} disabled={inPeriod.length === 0} className={btn.ghost}>
            <i aria-hidden className="bx bx-download text-lg" /> Export payments
          </button>
        }
      />

      <FilterTabs items={tabs} value={period} onChange={setPeriod} label="Period" />

      {error && (
        <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">{error}</p>
          <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
            Try again
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && paid.length === 0 ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-[#262626] bg-card p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-8 w-28" />
            </div>
          ))
        ) : (
          <>
            <Kpi label="Gross revenue" value={money(revenue)} icon="bx-trending-up" />
            <Kpi label="Cost of goods" value={money(cogs)} icon="bx-package" />
            <Kpi label="Gross margin" value={pct(revenue - cogs, revenue)} icon="bx-pie-chart-alt-2" />
            <Kpi label="Awaiting payment" value={`${unpaid.length} · ${money(unpaidTotal)}`} icon="bx-time-five" />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="Revenue by category">
            {categories.length === 0 ? (
              <EmptyState icon="bx-pie-chart-alt" title={loading ? "Loading…" : "No paid orders in this period"} hint={loading ? undefined : "Revenue appears here once customers pay."} />
            ) : (
              <BarList label="Revenue by category" rows={categories} format={money} />
            )}
          </Panel>
        </div>

        <Panel title="Awaiting payment">
          {unpaid.length === 0 ? (
            <EmptyState icon="bx-check-circle" title={loading ? "Loading…" : "Nothing is waiting for payment"} />
          ) : (
            <ul className="max-h-96 divide-y divide-[#262626] overflow-y-auto" aria-label="Awaiting payment">
              {unpaid.slice(0, 12).map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
                    <i aria-hidden className="bx bx-time-five text-lg" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{o.customer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.code} · {ago(o.created_at)} ago
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">{money(o.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Recent payments">
          {inPeriod.length === 0 ? (
            <EmptyState icon="bx-wallet" title={loading ? "Loading…" : "No payments in this period"} />
          ) : (
            <>
              <ul className="divide-y divide-[#262626] lg:hidden" aria-label="Recent payments">
                {inPeriod.slice(0, 20).map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium text-primary">{o.code}</span> · {o.customer_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {methodLabel(o.payment_method)} · {dateOf(paidWhen(o))}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium">{money(o.total)}</span>
                  </li>
                ))}
              </ul>
              <table className="hidden w-full table-fixed text-left text-sm lg:table">
                <thead className="border-b border-[#262626] text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="w-40 py-3 font-medium">Order</th>
                    <th className="py-3 font-medium">Customer</th>
                    <th className="w-40 py-3 font-medium">Method</th>
                    <th className="w-40 py-3 font-medium">Amount</th>
                    <th className="w-40 py-3 font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {inPeriod.slice(0, 20).map((o) => (
                    <tr key={o.id} className="border-b border-[#262626]/70 last:border-0">
                      <td className="py-3 font-medium text-primary">{o.code}</td>
                      <td className="truncate py-3">{o.customer_name}</td>
                      <td className="py-3 text-muted-foreground">{methodLabel(o.payment_method)}</td>
                      <td className="py-3 font-medium">{money(o.total)}</td>
                      <td className="py-3 text-muted-foreground">{dateOf(paidWhen(o))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inPeriod.length > 20 && <p className="mt-3 text-sm text-muted-foreground">Showing the latest 20 of {inPeriod.length}. Export the payments to see all of them.</p>}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
