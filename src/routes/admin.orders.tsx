import { FunctionsHttpError } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { ActionBar, btn, Detail, FilterTabs, SearchField, field, type TabItem } from "@/components/admin/controls";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { EmptyState, PageHead, Skeleton } from "@/components/moa/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DAY_MS,
  ageOf,
  ago,
  csvSafe,
  downloadText,
  escapeHtml,
  maskPhone,
  openPrintable,
  shortWhen,
  toCsv,
  useDebouncedValue,
  useLongPress,
} from "@/lib/adminTools";
import { useAuth } from "@/lib/auth";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/orders")({
  // /admin/orders?q=MOA-4860 opens the list already searched for that order.
  validateSearch: (s: Record<string, unknown>): { q?: string | undefined } => ({
    q: typeof s["q"] === "string" && s["q"] !== "" ? s["q"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Orders — MOA Mart Suite" },
      { name: "description", content: "Dispatch, track and cancel storefront orders." },
    ],
  }),
  component: Orders,
});

type Item = { name: string; variant_label: string | null; image: string; qty: number; price: number };

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
  order_items: Item[];
};

type Tab = "confirmed" | "out_for_delivery" | "pending" | "delivered" | "cancelled" | "all";
type Range = "all" | "today" | "7d" | "30d";
type Counts = Record<Tab, number>;

const PAGE = 25;
const SELECT =
  "id, code, created_at, paid_at, customer_name, phone, location, preferred_time, notes, total, payment_status, fulfilment_status, refund_status, cancel_reason, order_items(name, variant_label, image, qty, price)";

const RANGES: Array<[Range, string]> = [
  ["all", "All time"],
  ["today", "Today"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
];

const REASONS = [
  "Customer asked to cancel",
  "Item out of stock",
  "Cannot deliver to this address",
  "Duplicate order",
  "Other",
];

// ---------- how an order is described ----------

type Tone = "warning" | "info" | "success" | "danger" | "muted";
const TONE: Record<Tone, string> = {
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

/** One status for the whole order, so nobody has to combine a payment label with a delivery label. */
function stageOf(o: Row): { label: string; tone: Tone } {
  switch (o.fulfilment_status) {
    case "cancelled":
      return { label: "Cancelled", tone: "danger" };
    case "delivered":
      return { label: "Delivered", tone: "success" };
    case "out_for_delivery":
      return { label: "On the way", tone: "info" };
    case "confirmed":
      return { label: "To dispatch", tone: "warning" };
    case "pending":
      return o.payment_status === "failed"
        ? { label: "Payment failed", tone: "danger" }
        : { label: "Awaiting payment", tone: "muted" };
    default:
      return { label: o.fulfilment_status, tone: "muted" };
  }
}

const refundTone = (s: string): Tone => (s === "completed" ? "success" : s === "failed" ? "danger" : "warning");

/** Money that left the shop with the goods but was never recorded as paid. Staff must see it. */
const unpaidOut = (o: Row) =>
  (o.fulfilment_status === "out_for_delivery" || o.fulfilment_status === "delivered") && o.payment_status !== "paid";

function whenLine(o: Row): { text: string; urgent: boolean } {
  if (o.fulfilment_status === "confirmed") {
    const at = o.paid_at ?? o.created_at;
    return { text: `Paid ${ago(at)} ago`, urgent: ageOf(at) > DAY_MS };
  }
  if (o.fulfilment_status === "pending") return { text: `Waiting ${ago(o.created_at)}`, urgent: false };
  return { text: shortWhen(o.created_at), urgent: false };
}

const itemCount = (items: Item[]) => items.reduce((n, i) => n + i.qty, 0);
const itemsLabel = (items: Item[]) => {
  const n = itemCount(items);
  return `${n} item${n === 1 ? "" : "s"}`;
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", TONE[tone])}>{children}</span>;
}

// ---------- talking to the database ----------

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

function sinceIso(range: Range): string | null {
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === "7d") return new Date(Date.now() - 7 * DAY_MS).toISOString();
  if (range === "30d") return new Date(Date.now() - 30 * DAY_MS).toISOString();
  return null;
}

/** Characters that have a meaning inside a database filter are turned into spaces. */
const cleanTerm = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();

type Filters = { tab: Tab; range: Range; term: string };

// The query builder comes from the database library; this one helper adds the filters to either query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withFilters(q: any, f: Filters, includeTab: boolean): any {
  let out = q;
  if (includeTab && f.tab !== "all") out = out.eq("fulfilment_status", f.tab);
  const since = sinceIso(f.range);
  if (since) out = out.gte("created_at", since);
  const t = cleanTerm(f.term);
  if (t) out = out.or(`code.ilike.%${t}%,customer_name.ilike.%${t}%,phone.ilike.%${t}%`);
  return out;
}

// ---------- the delivery note ----------

function notesHtml(orders: Row[]): string {
  const e = escapeHtml;
  const sheets = orders
    .map(
      (o) => `<section class="note">
  <header><div><h1>MOA Mart</h1><p>Delivery note</p></div><div class="code">${e(o.code)}</div></header>
  <dl>
    <dt>Customer</dt><dd>${e(o.customer_name)}</dd>
    <dt>Phone</dt><dd>${e(o.phone)}</dd>
    <dt>Deliver to</dt><dd>${e(o.location)}</dd>
    ${o.preferred_time ? `<dt>Preferred time</dt><dd>${e(o.preferred_time)}</dd>` : ""}
    ${o.notes ? `<dt>Customer note</dt><dd>${e(o.notes)}</dd>` : ""}
    <dt>Ordered</dt><dd>${e(new Date(o.created_at).toLocaleString())}</dd>
  </dl>
  <table><thead><tr><th>Qty</th><th>Item</th></tr></thead><tbody>${o.order_items
    .map((it) => `<tr><td>${it.qty}</td><td>${e(it.name)}${it.variant_label ? ` (${e(it.variant_label)})` : ""}</td></tr>`)
    .join("")}</tbody></table>
  <p class="total">Total ${e(money(o.total))} · ${o.payment_status === "paid" ? "PAID" : e(o.payment_status)}</p>
  <p class="sign">Received by: ______________________ &nbsp;&nbsp; Date: ______________</p>
</section>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Delivery notes</title><style>
@page { size: A5; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, sans-serif; color: #111; }
.note { page-break-after: always; }
.note:last-child { page-break-after: auto; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
h1 { margin: 0; font-size: 20px; } header p { margin: 2px 0 0; color: #555; }
.code { font-size: 20px; font-weight: 700; letter-spacing: .5px; }
dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; margin: 0 0 12px; }
dt { color: #555; } dd { margin: 0; font-weight: 600; word-break: break-word; }
table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #ccc; } th { font-size: 12px; color: #555; } td:first-child, th:first-child { width: 48px; }
.total { font-weight: 700; margin: 8px 0 24px; } .sign { margin-top: 28px; color: #333; }
</style></head><body>${sheets}<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script></body></html>`;
}

// ---------- the cancel dialog (the rules are unchanged) ----------

function CancelDialog({ order, onClose, onDone }: { order: Row; onClose: () => void; onDone: (msg: string) => void }) {
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
        ? `${order.code} cancelled, but the refund did not start: ${r.data?.refund_error ?? "unknown reason"} Retry it from the order.`
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
      <DialogContent className="moa-admin-dialog max-h-[90dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-md">
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
            <span className="text-sm text-muted-foreground">Reason (the customer will see it)</span>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={choice === r}
                  onClick={() => setChoice(r)}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-sm transition-colors",
                    choice === r
                      ? "border-foreground/60 bg-white/10 text-foreground"
                      : "border-[#262626] text-muted-foreground hover:text-foreground",
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
              className={cn(field, "h-auto py-2.5")}
            />
          </div>

          {paid && (
            <label className="flex items-start gap-3 text-sm text-muted-foreground">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-5" />
              <span>
                Put the items back in stock.
                {order.fulfilment_status === "out_for_delivery" && " Tick only if they are back in the shop."}
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onClose} className={btn.ghost}>
            Keep the order
          </button>
          <button type="button" disabled={busy} onClick={() => void submit()} className={btn.danger}>
            {busy ? "Cancelling…" : paid ? "Cancel and refund" : "Cancel order"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cancel several orders at once, with one reason. Paid orders are refunded, one by one, by the same function as a single cancel. */
function BulkCancelDialog({ orders, onClose, onDone }: { orders: Row[]; onClose: () => void; onDone: (msg: string, failed: boolean) => void }) {
  const paid = orders.filter((o) => o.payment_status === "paid");
  const [choice, setChoice] = useState(REASONS[0] ?? "Other");
  const [text, setText] = useState("");
  const [restock, setRestock] = useState(!orders.some((o) => o.fulfilment_status === "out_for_delivery"));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
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
    let cancelled = 0;
    let refundFailed = 0;
    const problems: string[] = [];
    for (const o of orders) {
      const r = await callFn<{ refund?: string }>("cancel-order", {
        action: "cancel",
        order_code: o.code,
        reason,
        restock: o.payment_status === "paid" ? restock : false,
      });
      setDone((n) => n + 1);
      if (r.error) problems.push(`${o.code}: ${r.error}`);
      else {
        cancelled += 1;
        if (r.data?.refund === "failed") refundFailed += 1;
      }
    }
    setBusy(false);
    const parts = [`${cancelled} of ${orders.length} cancelled.`];
    if (refundFailed > 0) parts.push(`${refundFailed} refund${refundFailed === 1 ? "" : "s"} did not start: retry from the order.`);
    if (problems.length > 0) parts.push(`Not cancelled: ${problems.join("; ")}`);
    onDone(parts.join(" "), problems.length > 0 || refundFailed > 0);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="moa-admin-dialog max-h-[90dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Cancel {orders.length} order{orders.length === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            {paid.length > 0
              ? `${paid.length} of them ${paid.length === 1 ? "is" : "are"} paid and will be refunded in full to the number that paid. Orders are never deleted: a cancelled order stays in your records.`
              : "None of them has been paid. Reserved items go back in stock. Orders are never deleted: a cancelled order stays in your records."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm text-muted-foreground">Reason (the customers will see it)</span>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={choice === r}
                  onClick={() => setChoice(r)}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-sm transition-colors",
                    choice === r ? "border-foreground/60 bg-white/10 text-foreground" : "border-[#262626] text-muted-foreground hover:text-foreground",
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
              className={cn(field, "h-auto py-2.5")}
            />
          </div>
          {paid.length > 0 && (
            <label className="flex items-start gap-3 text-sm text-muted-foreground">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-5" />
              <span>Put the items of the paid orders back in stock.</span>
            </label>
          )}
        </div>
        {busy && (
          <p className="text-sm text-muted-foreground" role="status">
            Cancelling… {done} of {orders.length}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onClose} className={btn.ghost}>
            Keep the orders
          </button>
          <button type="button" disabled={busy} onClick={() => void submit()} className={btn.danger}>
            {busy ? "Cancelling…" : `Cancel ${orders.length} order${orders.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- pieces of the list ----------

function Thumbs({ items }: { items: Item[] }) {
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      {shown.map((it, i) =>
        it.image ? (
          <img key={i} src={it.image} alt="" className="size-10 rounded-lg object-cover" />
        ) : (
          <span key={i} className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <i aria-hidden className="bx bx-package" />
          </span>
        ),
      )}
      {more > 0 && (
        <span className="grid size-10 place-items-center rounded-lg bg-secondary text-xs text-muted-foreground">+{more}</span>
      )}
    </div>
  );
}

type Handlers = {
  open: (o: Row) => void;
  advance: (o: Row, to: "out_for_delivery" | "delivered") => void;
  refund: (o: Row, action: "refund-status" | "retry-refund") => void;
  busyId: string | null;
  isAdmin: boolean;
};

/** The one thing to do next with an order, as a button the size of a thumb. */
function PrimaryAction({ o, h }: { o: Row; h: Handlers }) {
  const busy = h.busyId === o.id;
  if (o.fulfilment_status === "confirmed")
    return (
      <button type="button" disabled={busy} onClick={() => h.advance(o, "out_for_delivery")} className={btn.primary}>
        {busy ? "Saving…" : "Out for delivery"}
      </button>
    );
  if (o.fulfilment_status === "out_for_delivery")
    return (
      <button type="button" disabled={busy} onClick={() => h.advance(o, "delivered")} className={btn.primary}>
        {busy ? "Saving…" : "Mark delivered"}
      </button>
    );
  if (o.fulfilment_status === "cancelled" && o.refund_status === "pending")
    return (
      <button type="button" disabled={busy} onClick={() => h.refund(o, "refund-status")} className={btn.ghost}>
        Check refund
      </button>
    );
  if (o.fulfilment_status === "cancelled" && o.refund_status === "failed" && h.isAdmin)
    return (
      <button type="button" disabled={busy} onClick={() => h.refund(o, "retry-refund")} className={btn.ghost}>
        Retry refund
      </button>
    );
  return (
    <button type="button" onClick={() => h.open(o)} className={btn.ghost}>
      View
    </button>
  );
}

type Press = ReturnType<typeof useLongPress>;

function OrderCard({
  o,
  h,
  selectMode,
  selected,
  onToggle,
  press,
}: {
  o: Row;
  h: Handlers;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  press: Press;
}) {
  const stage = stageOf(o);
  const when = whenLine(o);
  const selectable = selectMode;
  return (
    <li className={cn("rounded-2xl border bg-card", selected ? "border-foreground/60" : "border-[#262626]")}>
      <div className="flex items-start">
        {selectable && (
          <label className="grid min-h-11 min-w-12 shrink-0 place-items-center pt-3">
            <input type="checkbox" className="size-5" aria-label={`Select ${o.code}`} checked={selected} onChange={onToggle} />
          </label>
        )}
        <button
          type="button"
          onClick={() => (selectMode ? onToggle() : h.open(o))}
          aria-label={`Open ${o.code}`}
          {...press(o.id)}
          className="min-w-0 flex-1 select-none rounded-2xl p-4 text-left [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-primary">{o.code}</p>
              <p className={cn("text-sm", when.urgent ? "text-destructive" : "text-muted-foreground")}>{when.text}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Pill tone={stage.tone}>{stage.label}</Pill>
              {o.fulfilment_status === "cancelled" && o.refund_status !== "none" && (
                <Pill tone={refundTone(o.refund_status)}>Refund {o.refund_status}</Pill>
              )}
            </div>
          </div>
          <p className="mt-3 truncate text-base">{o.customer_name}</p>
          <p className="truncate text-sm text-muted-foreground">{o.location}</p>
          <div className="mt-3 flex items-center gap-3">
            <Thumbs items={o.order_items} />
            <span className="text-sm text-muted-foreground">{itemsLabel(o.order_items)}</span>
          </div>
          {unpaidOut(o) && <p className="mt-3 text-sm text-warning">Payment not recorded for this order</p>}
          {o.fulfilment_status === "cancelled" && o.cancel_reason && (
            <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{o.cancel_reason}</p>
          )}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[#262626] px-4 py-3">
        <p className="font-display text-lg font-semibold">{money(o.total)}</p>
        <PrimaryAction o={o} h={h} />
      </div>
    </li>
  );
}

function OrderTable({
  rows,
  h,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
  press,
}: {
  rows: Row[];
  h: Handlers;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  press: Press;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#262626] bg-card">
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-12" />
          <col className="w-44" />
          <col />
          <col className="w-[22%]" />
          <col className="w-32" />
          <col className="w-36" />
          <col className="w-44" />
        </colgroup>
        <thead className="border-b border-[#262626] text-xs font-medium text-muted-foreground">
          <tr>
            <th className="py-3 pl-4">
              <input type="checkbox" className="size-4" aria-label="Select all orders shown" checked={allSelected} onChange={onToggleAll} />
            </th>
            <th className="px-3 py-3 font-medium">Order</th>
            <th className="px-3 py-3 font-medium">Customer</th>
            <th className="px-3 py-3 font-medium">Items</th>
            <th className="px-3 py-3 font-medium">Total</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 pr-4 text-right font-medium">Next step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const stage = stageOf(o);
            const when = whenLine(o);
            return (
              <tr
                key={o.id}
                onClick={() => h.open(o)}
                className="cursor-pointer border-b border-[#262626]/70 align-middle transition-colors last:border-0 hover:bg-white/[0.03]"
              >
                <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="size-4" aria-label={`Select ${o.code}`} checked={selected.has(o.id)} onChange={() => onToggle(o.id)} />
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      h.open(o);
                    }}
                    {...press(o.id)}
                    className="select-none font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {o.code}
                  </button>
                  <p className={cn("text-xs", when.urgent ? "text-destructive" : "text-muted-foreground")}>{when.text}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="truncate">{o.customer_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.location}</p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Thumbs items={o.order_items.slice(0, 2)} />
                    <span className="text-xs text-muted-foreground">{itemsLabel(o.order_items)}</span>
                  </div>
                </td>
                <td className="px-3 py-3 font-medium">{money(o.total)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <Pill tone={stage.tone}>{stage.label}</Pill>
                    {o.fulfilment_status === "cancelled" && o.refund_status !== "none" && (
                      <Pill tone={refundTone(o.refund_status)}>Refund {o.refund_status}</Pill>
                    )}
                    {unpaidOut(o) && <span className="text-xs text-warning">Payment not recorded</span>}
                  </div>
                </td>
                <td className="px-3 py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <PrimaryAction o={o} h={h} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- the detail screen ----------

const STEPS = ["Placed", "Paid", "On the way", "Delivered"];
const stepIndex = (s: string) => (s === "delivered" ? 3 : s === "out_for_delivery" ? 2 : s === "confirmed" ? 1 : 0);

function Progress({ status }: { status: string }) {
  const at = stepIndex(status);
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s} className="grid justify-items-center gap-1.5 text-center" aria-current={i === at ? "step" : undefined}>
          <span className="relative grid w-full place-items-center">
            <span className={cn("absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2", i <= at ? "bg-foreground/60" : "bg-white/10")} />
            <span
              className={cn(
                "relative grid size-6 place-items-center rounded-full border text-xs",
                i < at ? "border-foreground bg-foreground text-black" : i === at ? "border-foreground bg-black text-foreground" : "border-white/20 bg-black text-muted-foreground",
              )}
            >
              {i < at ? <i aria-hidden className="bx bx-check" /> : i + 1}
            </span>
          </span>
          <span className={cn("text-xs", i <= at ? "text-foreground" : "text-muted-foreground")}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderDetails({ o, shown, onShow }: { o: Row; shown: boolean; onShow: () => void }) {
  const stage = stageOf(o);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.location)}`;
  return (
    <div className="grid gap-6">
      {o.fulfilment_status === "cancelled" ? (
        <div className="rounded-2xl bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Cancelled</p>
          {o.cancel_reason && <p className="mt-1 text-foreground/90">{o.cancel_reason}</p>}
          {o.refund_status !== "none" && (
            <p className="mt-2 text-muted-foreground">
              Refund: <span className="text-foreground">{o.refund_status}</span>
            </p>
          )}
        </div>
      ) : (
        <Progress status={o.fulfilment_status} />
      )}

      {unpaidOut(o) && (
        <p className="rounded-2xl bg-warning/10 p-4 text-sm text-warning">
          This order has left the shop, but no payment is recorded for it ({o.payment_status.replace(/_/g, " ")}). Check with the customer.
        </p>
      )}

      <section>
        <h3 className="mb-3 font-display text-base font-semibold">Customer</h3>
        <dl className="grid gap-3">
          <Detail label="Name">{o.customer_name}</Detail>
          <Detail label="Phone">
            <span className="flex flex-wrap items-center gap-3">
              <span>{shown ? o.phone : maskPhone(o.phone)}</span>
              {shown ? (
                <a href={`tel:${o.phone}`} className={cn(btn.ghost, "h-10")}>
                  <i aria-hidden className="bx bx-phone text-lg" /> Call
                </a>
              ) : (
                <button type="button" onClick={onShow} className={cn(btn.ghost, "h-10")}>
                  Show number
                </button>
              )}
            </span>
          </Detail>
        </dl>
      </section>

      <section>
        <h3 className="mb-3 font-display text-base font-semibold">Delivery</h3>
        <dl className="grid gap-3">
          <Detail label="Address">
            <span className="flex flex-wrap items-center gap-3">
              <span>{o.location}</span>
              <a href={maps} target="_blank" rel="noreferrer" className={cn(btn.ghost, "h-10")}>
                <i aria-hidden className="bx bx-map text-lg" /> Open in maps
              </a>
            </span>
          </Detail>
          {o.preferred_time && <Detail label="Preferred time">{o.preferred_time}</Detail>}
          {o.notes && (
            <Detail label="Customer note">
              <span className="block rounded-xl bg-secondary/60 p-3">{o.notes}</span>
            </Detail>
          )}
        </dl>
      </section>

      <section>
        <h3 className="mb-3 font-display text-base font-semibold">
          Items <span className="font-sans text-sm font-normal text-muted-foreground">({itemsLabel(o.order_items)})</span>
        </h3>
        <ul className="grid gap-3">
          {o.order_items.map((it, i) => (
            <li key={i} className="flex items-center gap-3">
              {it.image ? (
                <img src={it.image} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                  <i aria-hidden className="bx bx-package text-xl" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm">{it.name}</p>
                {it.variant_label && <p className="text-sm text-muted-foreground">{it.variant_label}</p>}
              </div>
              <div className="ml-auto shrink-0 text-right">
                <p className="text-sm">{money(it.price * it.qty)}</p>
                <p className="text-xs text-muted-foreground">
                  {it.qty} × {money(it.price)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-3 font-display text-base font-semibold">Payment</h3>
        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Total">
            <span className="font-display text-lg font-semibold">{money(o.total)}</span>
          </Detail>
          <Detail label="Status">{o.payment_status.replace(/_/g, " ")}</Detail>
          <Detail label="Placed">{shortWhen(o.created_at)}</Detail>
          {o.paid_at && <Detail label="Paid">{shortWhen(o.paid_at)}</Detail>}
        </dl>
      </section>

      <span className="sr-only">{stage.label}</span>
    </div>
  );
}

// ---------- the page ----------

function Orders() {
  const { isAdmin } = useAuth();
  const { q: linkedSearch } = Route.useSearch();
  const [tab, setTab] = usePersistedState<Tab>("moa:orders:tab", "confirmed");
  const [range, setRange] = usePersistedState<Range>("moa:orders:range", "all");
  const [term, setTerm] = usePersistedState("moa:orders:q", "");
  const debounced = useDebouncedValue(term);

  // Arriving from a link: search for it, in every status and every date.
  useEffect(() => {
    if (!linkedSearch) return;
    setTerm(linkedSearch);
    setTab("all");
    setRange("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSearch]);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({ confirmed: 0, out_for_delivery: 0, pending: 0, delivered: 0, cancelled: 0, all: 0 });
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCancel, setBulkCancel] = useState<Row[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cancelFor, setCancelFor] = useState<Row | null>(null);
  const [phoneShown, setPhoneShown] = useState<Set<string>>(new Set());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const lastSheetRow = useRef<Row | null>(null);

  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    const f: Filters = { tab, range, term: debounced };
    try {
      const list = withFilters(
        supabase.from("orders").select(SELECT, { count: "exact" }).order("created_at", { ascending: false }).range(0, limit - 1),
        f,
        true,
      );
      const tally = withFilters(supabase.from("orders").select("fulfilment_status").limit(5000), f, false);
      const [listRes, tallyRes] = await Promise.all([list, tally]);
      if (req !== reqRef.current) return;
      if (listRes.error) throw listRes.error;
      setRows((listRes.data ?? []) as unknown as Row[]);
      setTotal(typeof listRes.count === "number" ? listRes.count : (listRes.data ?? []).length);
      const c: Counts = { confirmed: 0, out_for_delivery: 0, pending: 0, delivered: 0, cancelled: 0, all: 0 };
      for (const r of (tallyRes.data ?? []) as Array<{ fulfilment_status: string }>) {
        c.all += 1;
        if (r.fulfilment_status in c) c[r.fulfilment_status as Tab] += 1;
      }
      setCounts(c);
      setLoadError("");
    } catch {
      if (req === reqRef.current) setLoadError("Could not load orders. Check your connection and try again.");
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [tab, range, debounced, limit]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void load();
  }, [load]);

  // A different view starts from the first page, with nothing ticked.
  useEffect(() => {
    setLimit(PAGE);
    setSelected(new Set());
    setLoading(true);
  }, [tab, range, debounced]);

  // New and changed orders arrive by themselves.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void loadRef.current(), 400);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  // ----- actions -----

  const patchRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (lastSheetRow.current?.id === id) lastSheetRow.current = { ...lastSheetRow.current, ...patch };
  };

  const advance = async (o: Row, to: "out_for_delivery" | "delivered") => {
    setBusyId(o.id);
    const { error } = await supabase.from("orders").update({ fulfilment_status: to }).eq("id", o.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    patchRow(o.id, { fulfilment_status: to });
    toast.success(to === "delivered" ? `${o.code} marked delivered.` : `${o.code} is out for delivery.`);
    void load();
  };

  /** Change the status of every selected order that is in the right status. */
  const moveSelected = async (from: "confirmed" | "out_for_delivery", to: "out_for_delivery" | "delivered", done: string) => {
    const ids = selRows.filter((o) => o.fulfilment_status === from).map((o) => o.id);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.from("orders").update({ fulfilment_status: to }).in("id", ids).eq("fulfilment_status", from);
    setBulkBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${ids.length} order${ids.length === 1 ? "" : "s"} ${done}.`);
    setSelected(new Set());
    setSelectMode(false);
    void load();
  };
  const dispatchSelected = () => moveSelected("confirmed", "out_for_delivery", "marked out for delivery");
  const deliverSelected = () => moveSelected("out_for_delivery", "delivered", "marked delivered");

  const refundAction = async (o: Row, action: "refund-status" | "retry-refund") => {
    setBusyId(o.id);
    const r = await callFn<{ refund?: string; refund_error?: string; refund_status?: string }>("cancel-order", {
      action,
      order_code: o.code,
    });
    setBusyId(null);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    if (action === "retry-refund") {
      if (r.data?.refund === "failed") toast.error(`The refund did not start: ${r.data.refund_error ?? "unknown reason"}`);
      else toast.success("The refund was sent to PawaPay.");
    } else {
      toast.message(`Refund status: ${r.data?.refund_status ?? "unknown"}.`);
    }
    void load();
  };

  const printNotes = (list: Row[]) => {
    if (list.length === 0) return;
    if (!openPrintable(notesHtml(list))) toast.error("Your browser blocked the print page. Allow pop-ups for this site and try again.");
  };

  const downloadCsv = (list: Row[]) => {
    const out: Array<Array<string | number | null | undefined>> = [
      ["Order", "Placed", "Paid", "Customer", "Phone", "Address", "Preferred time", "Note", "Items", "Total (RWF)", "Payment", "Status", "Refund", "Cancel reason"],
      ...list.map((o) => [
        o.code,
        new Date(o.created_at).toLocaleString(),
        o.paid_at ? new Date(o.paid_at).toLocaleString() : "",
        csvSafe(o.customer_name),
        // Staff get a hidden number in the file, the same as on the screen.
        isAdmin ? o.phone : maskPhone(o.phone),
        csvSafe(o.location),
        csvSafe(o.preferred_time ?? ""),
        csvSafe(o.notes ?? ""),
        csvSafe(o.order_items.map((i) => `${i.qty}× ${i.name}${i.variant_label ? ` (${i.variant_label})` : ""}`).join("; ")),
        o.total,
        o.payment_status,
        stageOf(o).label,
        o.refund_status === "none" ? "" : o.refund_status,
        csvSafe(o.cancel_reason ?? ""),
      ]),
    ];
    downloadText(`moa-orders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
    toast.success(`${list.length} order${list.length === 1 ? "" : "s"} exported.`);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await withFilters(
        supabase.from("orders").select(SELECT).order("created_at", { ascending: false }).limit(5000),
        { tab, range, term: debounced },
        true,
      );
      if (res.error) throw res.error;
      downloadCsv((res.data ?? []) as unknown as Row[]);
    } catch {
      toast.error("Could not export the orders. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // ----- derived -----

  const canCancel = (o: Row) =>
    ["pending", "confirmed", "out_for_delivery"].includes(o.fulfilment_status) && (o.payment_status !== "paid" || isAdmin);

  const selRows = rows.filter((o) => selected.has(o.id));
  const nDispatch = selRows.filter((o) => o.fulfilment_status === "confirmed").length;
  const nDeliver = selRows.filter((o) => o.fulfilment_status === "out_for_delivery").length;
  const cancellable = selRows.filter(canCancel);
  const allSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));
  const press = useLongPress((id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  });
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((o) => o.id)));

  const open = (o: Row) => {
    lastSheetRow.current = o;
    setSheetId(o.id);
    setSheetOpen(true);
  };
  const sheetRow = (sheetId ? rows.find((r) => r.id === sheetId) : undefined) ?? lastSheetRow.current;
  if (sheetRow && sheetId === sheetRow.id) lastSheetRow.current = sheetRow;

  const handlers: Handlers = {
    open,
    advance: (o, to) => void advance(o, to),
    refund: (o, a) => void refundAction(o, a),
    busyId,
    isAdmin,
  };

  const tabs: TabItem<Tab>[] = [
    { key: "confirmed", label: "To dispatch", count: counts.confirmed, tone: "warning" },
    { key: "out_for_delivery", label: "On the way", count: counts.out_for_delivery, tone: "info" },
    { key: "pending", label: "Awaiting payment", count: counts.pending },
    { key: "delivered", label: "Delivered", count: counts.delivered },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
    { key: "all", label: "All", count: counts.all },
  ];

  const filtered = debounced.trim() !== "" || range !== "all";
  const emptyText: Record<Tab, [string, string]> = {
    confirmed: ["Nothing to dispatch", "Paid orders appear here by themselves."],
    out_for_delivery: ["No orders on the way", "Orders you send out for delivery appear here."],
    pending: ["No orders waiting for payment", "Orders appear here until the customer pays."],
    delivered: ["No delivered orders yet", "Delivered orders appear here."],
    cancelled: ["No cancelled orders", "Cancelled orders and their refunds appear here."],
    all: ["No orders yet", "Orders appear here as soon as customers place them."],
  };

  const sheetStage = sheetRow ? stageOf(sheetRow) : null;

  return (
    <>
      <PageHead
        title="Orders"
        subtitle="Paid orders wait under To dispatch. They are marked delivered when the customer confirms, or 3 days after dispatch."
        actions={
          <>
            <button
              type="button"
              aria-pressed={selectMode}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
              className={cn(btn.ghost, selectMode && "border-foreground/60 bg-white/10")}
            >
              <i aria-hidden className="bx bx-check-square text-lg" /> {selectMode ? "Done" : "Select"}
            </button>
            <button type="button" onClick={() => void exportCsv()} disabled={exporting} className={btn.ghost}>
              <i aria-hidden className="bx bx-download text-lg" /> {exporting ? "Exporting…" : "Export"}
            </button>
          </>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField value={term} onChange={setTerm} label="Search orders" placeholder="Number, name or phone" />
          <select
            aria-label="Date range"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            className={cn(field, "sm:w-44")}
          >
            {RANGES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <FilterTabs items={tabs} value={tab} onChange={setTab} label="Order status" />
      </div>

      {selectMode && rows.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm lg:hidden">
          <span className="text-muted-foreground">
            {selected.size === 0 ? "Tap orders to select them" : `${selected.size} of ${rows.length} selected`}
          </span>
          <button type="button" onClick={toggleAll} className="min-h-11 px-2 text-foreground underline-offset-4 hover:underline">
            {allSelected ? "Clear selection" : "Select all shown"}
          </button>
        </div>
      )}

      <div className="mt-4">
        {loadError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
            <p className="text-destructive">{loadError}</p>
            <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
              Try again
            </button>
          </div>
        )}

        {loading && rows.length === 0 && !loadError && (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1" aria-label="Loading orders">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="rounded-2xl border border-[#262626] bg-card p-4">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="mt-3 h-4 w-48" />
                <Skeleton className="mt-4 h-10 w-full" />
              </li>
            ))}
          </ul>
        )}

        {!loading && !loadError && rows.length === 0 && (
          <div className="rounded-2xl border border-[#262626] bg-card">
            {filtered ? (
              <EmptyState
                icon="bx-search"
                title="No orders match"
                hint="Try a different word, or remove the date range."
                action={
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() => {
                      setTerm("");
                      setRange("all");
                    }}
                  >
                    Clear search and date
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon="bx-receipt"
                title={emptyText[tab][0]}
                hint={emptyText[tab][1]}
                action={
                  tab !== "all" ? (
                    <button type="button" className={btn.ghost} onClick={() => setTab("all")}>
                      See all orders
                    </button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <ul className="grid gap-3 md:grid-cols-2 lg:hidden" aria-label="Orders">
              {rows.map((o) => (
                <OrderCard key={o.id} o={o} h={handlers} selectMode={selectMode} selected={selected.has(o.id)} onToggle={() => toggleOne(o.id)} press={press} />
              ))}
            </ul>
            <div className="hidden lg:block">
              <OrderTable
                rows={rows}
                h={handlers}
                selected={selected}
                onToggle={toggleOne}
                onToggleAll={toggleAll}
                allSelected={allSelected}
                press={press}
              />
            </div>
            <div className="mt-5 flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {rows.length} of {total}
              </p>
              {rows.length < total && (
                <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={btn.ghost}>
                  Show more
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ActionBar show={selected.size > 0}>
        <span className="mr-auto px-1 text-sm text-foreground">{selected.size} selected</span>
        <button type="button" onClick={() => setSelected(new Set())} className={btn.quiet}>
          Clear
        </button>
        <ActionMenu
          up
          label="More actions for the selected orders"
          items={
            [
              { label: "Print delivery notes", icon: "bx-printer", onSelect: () => printNotes(selRows) },
              { label: "Export selected", icon: "bx-download", onSelect: () => downloadCsv(selRows) },
              {
                label: cancellable.length === 0 || cancellable.length === selRows.length ? "Cancel orders…" : `Cancel ${cancellable.length} of ${selRows.length}…`,
                icon: "bx-x-circle",
                danger: true,
                disabled: cancellable.length === 0,
                hint: cancellable.length === 0 ? "None of these can be cancelled" : cancellable.length < selRows.length ? "The others are already finished, or paid (admins only)" : "Paid orders are refunded",
                onSelect: () => setBulkCancel(cancellable.slice(0, 25)),
              },
              { label: "Delete orders", icon: "bx-trash", disabled: true, hint: "Orders are never deleted. Cancel them instead.", onSelect: () => undefined },
            ] satisfies MenuItem[]
          }
        >
          More
          <i aria-hidden className="bx bx-chevron-up text-lg" />
        </ActionMenu>
        {nDeliver > 0 && (
          <button type="button" disabled={bulkBusy} onClick={() => void deliverSelected()} className={cn(nDispatch > 0 ? btn.ghost : btn.primary, "flex-1")}>
            {bulkBusy ? "Working…" : `Delivered (${nDeliver})`}
          </button>
        )}
        {nDispatch > 0 && (
          <button type="button" disabled={bulkBusy} onClick={() => void dispatchSelected()} className={cn(btn.primary, "flex-1")}>
            {bulkBusy ? "Working…" : `Out for delivery (${nDispatch})`}
          </button>
        )}
      </ActionBar>

      {bulkCancel && (
        <BulkCancelDialog
          orders={bulkCancel}
          onClose={() => setBulkCancel(null)}
          onDone={(msg, failed) => {
            setBulkCancel(null);
            setSelected(new Set());
            setSelectMode(false);
            if (failed) toast.error(msg);
            else toast.success(msg);
            void load();
          }}
        />
      )}

      <AdminSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetRow?.code ?? "Order"}
        subtitle={sheetRow ? `Placed ${shortWhen(sheetRow.created_at)}` : undefined}
        badge={sheetStage ? <Pill tone={sheetStage.tone}>{sheetStage.label}</Pill> : null}
        footer={
          sheetRow ? (
            <div className="grid gap-2">
              {(sheetRow.fulfilment_status === "confirmed" || sheetRow.fulfilment_status === "out_for_delivery") && (
                <div className="grid">
                  <PrimaryAction o={sheetRow} h={{ ...handlers, open: () => undefined }} />
                </div>
              )}
              {sheetRow.fulfilment_status === "pending" && (
                <p className="text-center text-sm text-muted-foreground">Waiting for the customer to pay.</p>
              )}
              {sheetRow.fulfilment_status === "cancelled" && sheetRow.refund_status === "pending" && (
                <button type="button" disabled={busyId === sheetRow.id} onClick={() => void refundAction(sheetRow, "refund-status")} className={btn.ghost}>
                  Check refund status
                </button>
              )}
              {sheetRow.fulfilment_status === "cancelled" && sheetRow.refund_status === "failed" && isAdmin && (
                <button type="button" disabled={busyId === sheetRow.id} onClick={() => void refundAction(sheetRow, "retry-refund")} className={btn.ghost}>
                  Retry refund
                </button>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => printNotes([sheetRow])} className={btn.quiet}>
                  <i aria-hidden className="bx bx-printer text-lg" /> Print delivery note
                </button>
                {canCancel(sheetRow) && (
                  <button type="button" onClick={() => setCancelFor(sheetRow)} className={btn.dangerQuiet}>
                    Cancel order…
                  </button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {sheetRow && (
          <OrderDetails
            o={sheetRow}
            shown={phoneShown.has(sheetRow.id)}
            onShow={() => setPhoneShown((s) => new Set(s).add(sheetRow.id))}
          />
        )}
      </AdminSheet>

      {cancelFor && (
        <CancelDialog
          key={cancelFor.id}
          order={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={(msg) => {
            setCancelFor(null);
            setSheetOpen(false);
            toast.success(msg);
            void load();
          }}
        />
      )}
    </>
  );
}
