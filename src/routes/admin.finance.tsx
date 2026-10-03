import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { Kpi, PageHead, Panel, StatusPill } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/finance")({
  head: () => ({
    meta: [
      { title: "Financial Overview — MOA Mart Suite" },
      {
        name: "description",
        content: "Revenue tracking, gross margin analysis, manual payment logs and pending WhatsApp invoices.",
      },
      { property: "og:title", content: "Financial Overview — MOA Mart Suite" },
      { property: "og:description", content: "Margins, payments and invoice status for MOA Mart." },
    ],
  }),
  component: Finance,
});

type Payment = { id: string; payer: string; method: string; amount: number; date: string };

function Finance() {
  const { products, orders } = useStore();
  const [payments, setPayments] = useState<Payment[]>([
    { id: "PM-201", payer: "Jean Bosco", method: "MoMo", amount: 172, date: "2026-08-12" },
    { id: "PM-200", payer: "Sandrine K.", method: "Bank Transfer", amount: 278, date: "2026-08-11" },
    { id: "PM-199", payer: "Eric N.", method: "Cash on Delivery", amount: 142, date: "2026-08-11" },
  ]);
  const [form, setForm] = useState({ payer: "", method: "MoMo", amount: "" });

  const revenue = products.reduce((n, p) => n + p.price * p.orders, 0);
  const cogs = products.reduce((n, p) => n + p.cost * p.orders, 0);
  const margin = Math.round(((revenue - cogs) / revenue) * 100);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => map.set(p.category, (map.get(p.category) ?? 0) + p.price * p.orders));
    return [...map].map(([label, value]) => ({ label: label.split(" ")[0]!, value }));
  }, [products]);

  const pending = orders.filter((o) => o.status !== "Fulfilled" && o.status !== "Cancelled");

  return (
    <>
      <PageHead title="Financial Overview" subtitle="Cash position, margins and off-platform payment reconciliation." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Gross Revenue" value={`$${revenue.toLocaleString()}`} delta="+9.8% MoM" icon="bx-trending-up" />
        <Kpi label="Cost of Goods" value={`$${cogs.toLocaleString()}`} icon="bx-package" />
        <Kpi label="Gross Margin" value={`${margin}%`} delta="Target 40%" icon="bx-pie-chart-alt-2" />
        <Kpi label="Pending Invoices" value={String(pending.length)} icon="bx-time-five" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Panel title="Revenue by category" className="xl:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory}>
                <CartesianGrid stroke="#262626" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12, fontSize: 12 }}
                />
                <Bar dataKey="value" fill="#ffffff" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Log a manual payment">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.payer || !form.amount) return;
              setPayments((p) => [
                {
                  id: `PM-${202 + p.length}`,
                  payer: form.payer,
                  method: form.method,
                  amount: Number(form.amount),
                  date: new Date().toISOString().slice(0, 10),
                },
                ...p,
              ]);
              setForm({ payer: "", method: "MoMo", amount: "" });
            }}
          >
            <input
              value={form.payer}
              onChange={(e) => setForm({ ...form, payer: e.target.value })}
              placeholder="Customer name"
              className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
            />
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
              className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
            >
              {["MoMo", "Bank Transfer", "Cash on Delivery", "Card Link"].map((m) => (
                <option key={m} className="bg-card">
                  {m}
                </option>
              ))}
            </select>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="Amount (USD)"
              type="number"
              className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
            />
            <button className="rounded-xl bg-[image:var(--gradient-neon)] py-2.5 text-xs font-semibold text-primary-foreground">
              Record payment
            </button>
          </form>
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Payment log" className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-3">Ref</th>
                <th className="pb-3">Payer</th>
                <th className="pb-3">Method</th>
                <th className="pb-3">Amount</th>
                <th className="pb-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-[#262626]/60">
                  <td className="py-3 text-muted-foreground">{p.id}</td>
                  <td className="py-3">{p.payer}</td>
                  <td className="py-3 text-muted-foreground">{p.method}</td>
                  <td className="py-3 text-primary">${p.amount}</td>
                  <td className="py-3 text-muted-foreground">{p.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Pending WhatsApp invoices">
          <ul className="flex flex-col gap-3">
            {pending.map((o) => (
              <li key={o.id} className="flex items-center gap-3 text-xs">
                <span className="grid size-9 place-items-center rounded-lg bg-success/10 text-success">
                  <i className="bx bxl-whatsapp" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{o.customer}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {o.id} · ${o.total.toFixed(2)}
                  </p>
                </div>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
