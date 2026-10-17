import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PageHead, Panel, StatusPill } from "@/components/moa/ui";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — MOA Mart Suite" },
      { name: "description", content: "Track every storefront order, its payment and its delivery." },
    ],
  }),
  component: Orders,
});

type Row = {
  id: string;
  code: string;
  created_at: string;
  customer_name: string;
  phone: string;
  location: string;
  preferred_time: string | null;
  notes: string | null;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  order_items: { name: string; image: string; qty: number; price: number }[];
};

const FULFILMENT: [string, string][] = [
  ["pending", "Pending"],
  ["confirmed", "Confirmed"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];

const maskPhone = (p: string) => (p.length <= 6 ? p : p.slice(0, 4) + " ••• " + p.slice(-2));

const DAY_MS = 24 * 60 * 60 * 1000;
const ageOf = (iso: string) => Date.now() - new Date(iso).getTime();
const waitedLabel = (iso: string) => {
  const m = Math.floor(ageOf(iso) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
};
const groupOf = (s: string) =>
  s === "pending" ? "wait" : s === "confirmed" || s === "out_for_delivery" ? "progress" : s === "delivered" ? "done" : "cancelled";
function edgeFor(o: Row) {
  if (o.fulfilment_status === "cancelled") return "border-l-4 border-l-transparent";
  if (o.payment_status === "failed" || o.payment_status === "expired" || (o.fulfilment_status === "pending" && ageOf(o.created_at) > DAY_MS))
    return "border-l-4 border-l-destructive";
  if (o.fulfilment_status === "pending") return "border-l-4 border-l-warning";
  if (o.fulfilment_status === "delivered") return "border-l-4 border-l-success";
  return "border-l-4 border-l-info";
}

function Orders() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flt, setFlt] = useState<"all" | "wait" | "progress" | "done" | "cancelled">("all");

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from("orders")
        .select(
          "id, code, created_at, customer_name, phone, location, preferred_time, notes, total, payment_status, fulfilment_status, order_items(name, image, qty, price)",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (err) throw err;
      setRows((data ?? []) as unknown as Row[]);
      setError("");
    } catch {
      setError("Could not load orders. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const visible = flt === "all" ? rows : rows.filter((o) => groupOf(o.fulfilment_status) === flt);
  const nOf = (g: string) => rows.filter((o) => groupOf(o.fulfilment_status) === g).length;
  const chips: Array<["all" | "wait" | "progress" | "done" | "cancelled", string, number, string]> = [
    ["all", "All", rows.length, "border-border text-muted-foreground"],
    ["wait", "Waiting for confirmation", nOf("wait"), "border-warning/40 text-warning"],
    ["progress", "In progress", nOf("progress"), "border-info/40 text-info"],
    ["done", "Delivered", nOf("done"), "border-success/40 text-success"],
    ["cancelled", "Cancelled", nOf("cancelled"), "border-destructive/40 text-destructive"],
  ];

  const setStatus = async (id: string, status: string) => {
    setBusyId(id);
    setError("");
    const { error: err } = await supabase.from("orders").update({ fulfilment_status: status }).eq("id", id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, fulfilment_status: status } : r)));
  };

  return (
    <>
      <PageHead title="Orders" subtitle="Every order placed on the storefront, updated live." />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
        <i className="bx bx-info-circle mt-0.5 text-lg text-warning" />
        <p className="text-xs leading-relaxed text-warning">
          Payment status is set automatically by the payment system. While online payments are not
          switched on, orders stay on Awaiting payment. You set the delivery status yourself.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map(([key, label, n, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFlt(key)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${tone} ${flt === key ? "bg-secondary/70 ring-1 ring-current" : "hover:bg-secondary/30"}`}
          >
            {label} <span className="ml-1 font-semibold">{n}</span>
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">Order</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Contact</th>
              <th className="p-4">Products</th>
              <th className="p-4">Total</th>
              <th className="p-4">Payment</th>
              <th className="p-4">Delivery</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o.id} className="border-b border-[#262626]/60 align-top hover:bg-secondary/30">
                <td className={`p-4 ${edgeFor(o)}`}>
                  <p className="text-xs text-primary">{o.code}</p>
                  {o.fulfilment_status === "pending" && (
                    <p className={`text-[11px] ${ageOf(o.created_at) > DAY_MS ? "text-destructive" : "text-warning"}`}>
                      Waiting {waitedLabel(o.created_at)}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </p>
                </td>
                <td className="p-4">
                  <p className="text-xs">{o.customer_name}</p>
                  {o.preferred_time && (
                    <p className="text-[11px] text-muted-foreground">Wants: {o.preferred_time}</p>
                  )}
                  {o.notes && <p className="mt-1 text-[11px] text-muted-foreground">Note: {o.notes}</p>}
                </td>
                <td className="p-4">
                  <p className="text-xs">{shown[o.id] ? o.phone : maskPhone(o.phone)}</p>
                  <button
                    type="button"
                    onClick={() => setShown((s) => ({ ...s, [o.id]: !s[o.id] }))}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {shown[o.id] ? "Hide number" : "Show number"}
                  </button>
                  <p className="mt-1 text-[11px] text-muted-foreground">{o.location}</p>
                </td>
                <td className="p-4">
                  <ul className="flex flex-col gap-2">
                    {o.order_items.map((it, i) => (
                      <li key={i} className="flex items-center gap-2">
                        {it.image && (
                          <img src={it.image} alt={it.name} className="size-9 rounded-lg object-cover" />
                        )}
                        <span className="text-[11px]">
                          {it.name} <span className="text-muted-foreground">×{it.qty}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="p-4 text-xs text-primary">{money(o.total)}</td>
                <td className="p-4">
                  <StatusPill status={o.payment_status} />
                </td>
                <td className="p-4">
                  <div className="grid gap-2">
                    <StatusPill status={o.fulfilment_status} />
                    <select
                      value={o.fulfilment_status}
                      disabled={busyId === o.id}
                      onChange={(e) => void setStatus(o.id, e.target.value)}
                      className="hairline h-9 rounded-lg bg-card/60 px-2 text-[11px] outline-none"
                    >
                      {FULFILMENT.map(([value, label]) => (
                        <option key={value} value={value} className="bg-card">
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "No orders yet." : "No orders in this view."}
          </p>
        )}
      </Panel>
    </>
  );
}
