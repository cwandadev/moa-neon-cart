import { FunctionsHttpError } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PageHead, Panel, StatusPill } from "@/components/moa/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/persist";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — MOA Mart Suite" },
      { name: "description", content: "Dispatch, track and cancel storefront orders." },
    ],
  }),
  component: Orders,
});

type Row = {
  id: string;
  code: string;
  created_at: string;
  paid_at: string | null;
  customer_name: string;
  phone: string;
  location: string;
  preferred_time: string | null;
  notes: string | null;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  refund_status: string;
  cancel_reason: string | null;
  order_items: { name: string; variant_label: string | null; image: string; qty: number; price: number }[];
};

type Filter = "all" | "pending" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled";

const DAY_MS = 24 * 60 * 60 * 1000;
const ageOf = (iso: string) => Date.now() - new Date(iso).getTime();
const ago = (iso: string) => {
  const m = Math.floor(ageOf(iso) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
};
const maskPhone = (p: string) => (p.length <= 6 ? p : p.slice(0, 4) + " ••• " + p.slice(-2));

const FULFIL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
  confirmed: { label: "To dispatch", cls: "bg-warning/10 text-warning" },
  out_for_delivery: { label: "On the way", cls: "bg-info/10 text-info" },
  delivered: { label: "Delivered", cls: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive" },
};

const REASONS = [
  "Customer asked to cancel",
  "Item out of stock",
  "Cannot deliver to this address",
  "Duplicate order",
  "Other",
];

const fieldClass =
  "w-full rounded-xl border border-[#262626] bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50";

function edgeFor(o: Row) {
  if (o.fulfilment_status === "cancelled") {
    if (o.refund_status === "failed") return "border-l-destructive";
    if (o.refund_status === "pending") return "border-l-warning";
    return "border-l-transparent";
  }
  if (o.fulfilment_status === "confirmed") {
    return ageOf(o.paid_at ?? o.created_at) > DAY_MS ? "border-l-destructive" : "border-l-warning";
  }
  if (o.fulfilment_status === "out_for_delivery") return "border-l-info";
  if (o.fulfilment_status === "delivered") return "border-l-success";
  return "border-l-muted-foreground/40";
}

async function callFn<T>(name: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let msg = "Something went wrong. Please try again.";
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (b?.error) msg = String(b.error);
      } catch {
        /* keep the generic message */
      }
    }
    return { error: msg };
  }
  return { data: data as T };
}

function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: Row;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const paid = order.payment_status === "paid";
  const [choice, setChoice] = useState(REASONS[0] ?? "Other");
  const [text, setText] = useState("");
  const [restock, setRestock] = useState(order.fulfilment_status !== "out_for_delivery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const detail = text.trim();
    const reason = choice === "Other" ? detail : detail ? `${choice} — ${detail}` : choice;
    if (!reason) {
      setError("Please give a reason.");
      return;
    }
    setBusy(true);
    setError("");
    const r = await callFn<{ refund?: string; refund_error?: string }>("cancel-order", {
      action: "cancel",
      order_code: order.code,
      reason,
      restock: paid ? restock : false,
    });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    const refund = r.data?.refund;
    onDone(
      refund === "failed"
        ? `${order.code} cancelled, but the refund did not start: ${r.data?.refund_error ?? "unknown reason"} Retry it from the orders list.`
        : refund === "pending"
          ? `${order.code} cancelled. The refund was sent to PawaPay.`
          : `${order.code} cancelled.`,
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="moa-admin-dialog max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {order.code}?</DialogTitle>
          <DialogDescription>
            {paid
              ? `The customer paid ${money(order.total)}. Cancelling refunds the full amount to the number that paid.`
              : "The customer has not paid. Reserved items go back in stock."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-xs text-muted-foreground">Reason (the customer will see it)</span>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setChoice(r)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    choice === r
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder={choice === "Other" ? "Write the reason" : "More detail (optional)"}
              className={`${fieldClass} py-2`}
            />
          </div>

          {paid && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Put the items back in stock.
                {order.fulfilment_status === "out_for_delivery" && " Tick only if they are back in the shop."}
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-10 rounded-xl border border-[#262626] px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Keep the order
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-10 rounded-xl bg-destructive px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Cancelling…" : paid ? "Cancel and refund" : "Cancel order"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Orders() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [flt, setFlt] = usePersistedState<Filter>("moa:orders:filter", "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cancelFor, setCancelFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from("orders")
        .select(
          "id, code, created_at, paid_at, customer_name, phone, location, preferred_time, notes, total, payment_status, fulfilment_status, refund_status, cancel_reason, order_items(name, variant_label, image, qty, price)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
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

  const advance = async (o: Row, to: "out_for_delivery" | "delivered") => {
    setBusyId(o.id);
    setError("");
    setNotice("");
    const { error: err } = await supabase.from("orders").update({ fulfilment_status: to }).eq("id", o.id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === o.id ? { ...r, fulfilment_status: to } : r)));
  };

  const dispatchSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError("");
    setNotice("");
    const { error: err } = await supabase
      .from("orders")
      .update({ fulfilment_status: "out_for_delivery" })
      .in("id", ids)
      .eq("fulfilment_status", "confirmed");
    setBulkBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNotice(`${ids.length} order${ids.length === 1 ? "" : "s"} marked out for delivery.`);
    setSelected(new Set());
    void load();
  };

  const refundAction = async (o: Row, action: "refund-status" | "retry-refund") => {
    setBusyId(o.id);
    setError("");
    setNotice("");
    const r = await callFn<{ refund?: string; refund_error?: string; refund_status?: string }>("cancel-order", {
      action,
      order_code: o.code,
    });
    setBusyId(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (action === "retry-refund") {
      setNotice(
        r.data?.refund === "failed"
          ? `The refund did not start: ${r.data.refund_error ?? "unknown reason"}`
          : "The refund was sent to PawaPay.",
      );
    } else {
      setNotice(`Refund status: ${r.data?.refund_status ?? "unknown"}.`);
    }
    void load();
  };

  const count = (f: Filter) => (f === "all" ? rows.length : rows.filter((o) => o.fulfilment_status === f).length);
  const chips: Array<[Filter, string, string]> = [
    ["all", "All", "border-border text-muted-foreground"],
    ["confirmed", "To dispatch", "border-warning/40 text-warning"],
    ["out_for_delivery", "On the way", "border-info/40 text-info"],
    ["pending", "Awaiting payment", "border-border text-muted-foreground"],
    ["delivered", "Delivered", "border-success/40 text-success"],
    ["cancelled", "Cancelled", "border-destructive/40 text-destructive"],
  ];

  const visible = flt === "all" ? rows : rows.filter((o) => o.fulfilment_status === flt);
  const dispatchable = visible.filter((o) => o.fulfilment_status === "confirmed");
  const allSelected = dispatchable.length > 0 && dispatchable.every((o) => selected.has(o.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(dispatchable.map((o) => o.id)));

  const canCancel = (o: Row) =>
    ["pending", "confirmed", "out_for_delivery"].includes(o.fulfilment_status) &&
    (o.payment_status !== "paid" || isAdmin);

  const refundTone = (s: string) =>
    s === "completed"
      ? "bg-success/10 text-success"
      : s === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-warning/10 text-warning";

  return (
    <>
      <PageHead
        title="Orders"
        subtitle="Paid orders are confirmed automatically. Dispatch them here, and they are marked delivered when the customer confirms or 3 days after dispatch."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map(([key, label, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFlt(key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              tone,
              flt === key ? "bg-secondary/70 ring-1 ring-current" : "hover:bg-secondary/30",
            )}
          >
            {label} <span className="ml-1 font-semibold">{count(key)}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">{selected.size} selected</span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void dispatchSelected()}
            className="h-9 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {bulkBusy ? "Working…" : `Mark ${selected.size} out for delivery`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {notice && <p className="mb-4 text-sm text-success">{notice}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-10 p-4">
                {dispatchable.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Select all orders to dispatch"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                )}
              </th>
              <th className="p-4">Order</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Contact</th>
              <th className="p-4">Products</th>
              <th className="p-4">Total</th>
              <th className="p-4">Payment</th>
              <th className="p-4">Status</th>
              <th className="p-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => {
              const f = FULFIL[o.fulfilment_status] ?? { label: o.fulfilment_status, cls: "bg-muted" };
              const lateConfirmed = o.fulfilment_status === "confirmed" && ageOf(o.paid_at ?? o.created_at) > DAY_MS;
              return (
                <tr
                  key={o.id}
                  className={cn(
                    "border-b border-l-4 border-[#262626]/60 align-top hover:bg-secondary/30",
                    edgeFor(o),
                  )}
                >
                  <td className="p-4">
                    {o.fulfilment_status === "confirmed" && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${o.code}`}
                        checked={selected.has(o.id)}
                        onChange={() => toggleOne(o.id)}
                      />
                    )}
                  </td>
                  <td className="p-4">
                    <p className="text-xs text-primary">{o.code}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
                    {o.fulfilment_status === "confirmed" && (
                      <p className={cn("text-[11px]", lateConfirmed ? "text-destructive" : "text-warning")}>
                        Paid {ago(o.paid_at ?? o.created_at)} ago
                      </p>
                    )}
                    {o.fulfilment_status === "pending" && (
                      <p className="text-[11px] text-muted-foreground">Waiting {ago(o.created_at)}</p>
                    )}
                    {o.fulfilment_status === "cancelled" && o.cancel_reason && (
                      <p className="mt-1 max-w-[14rem] text-[11px] text-muted-foreground">{o.cancel_reason}</p>
                    )}
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
                          {it.image && <img src={it.image} alt={it.name} className="size-9 rounded-lg object-cover" />}
                          <span className="text-[11px]">
                            {it.name}{it.variant_label ? ` (${it.variant_label})` : ""} <span className="text-muted-foreground">×{it.qty}</span>
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
                    <span className={cn("rounded-full px-2.5 py-1 text-[11px]", f.cls)}>{f.label}</span>
                    {o.fulfilment_status === "cancelled" && o.refund_status !== "none" && (
                      <p className="mt-2">
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px]", refundTone(o.refund_status))}>
                          Refund {o.refund_status}
                        </span>
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="grid w-40 gap-2">
                      {o.fulfilment_status === "confirmed" && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void advance(o, "out_for_delivery")}
                          className="h-9 rounded-xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
                        >
                          Out for delivery
                        </button>
                      )}
                      {o.fulfilment_status === "out_for_delivery" && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void advance(o, "delivered")}
                          className="h-9 rounded-xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
                        >
                          Mark delivered
                        </button>
                      )}
                      {o.fulfilment_status === "pending" && (
                        <span className="text-[11px] text-muted-foreground">Waiting for the customer to pay</span>
                      )}
                      {o.fulfilment_status === "cancelled" && o.refund_status === "pending" && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void refundAction(o, "refund-status")}
                          className="text-left text-[11px] text-primary hover:underline"
                        >
                          Check refund status
                        </button>
                      )}
                      {o.fulfilment_status === "cancelled" && o.refund_status === "failed" && isAdmin && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => void refundAction(o, "retry-refund")}
                          className="text-left text-[11px] text-primary hover:underline"
                        >
                          Retry refund
                        </button>
                      )}
                      {canCancel(o) && (
                        <button
                          type="button"
                          onClick={() => setCancelFor(o)}
                          className="text-left text-[11px] text-destructive hover:underline"
                        >
                          Cancel order…
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "No orders yet." : "No orders in this view."}
          </p>
        )}
      </Panel>

      {cancelFor && (
        <CancelDialog
          key={cancelFor.id}
          order={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={(msg) => {
            setCancelFor(null);
            setNotice(msg);
            void load();
          }}
        />
      )}
    </>
  );
}
