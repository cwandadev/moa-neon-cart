import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PaymentPanel } from "@/components/shop/PaymentPanel";
import { Header } from "@/components/shop/Header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orders/$orderId")({
  head: () => ({ meta: [{ title: "Track your order — MOA Mart" }] }),
  component: OrderTracking,
});

type OrderRow = {
  id: string;
  code: string;
  created_at: string;
  customer_name: string;
  phone: string;
  location: string;
  preferred_time: string | null;
  notes: string | null;
  subtotal: number;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  refund_status: string;
  cancel_reason: string | null;
  order_items: { name: string; variant_label: string | null; image: string; qty: number; price: number }[];
};

const COLS =
  "id, code, created_at, customer_name, phone, location, preferred_time, notes, subtotal, total, payment_status, fulfilment_status, refund_status, cancel_reason, order_items(name, variant_label, image, qty, price)";

const STEPS: [string, string][] = [
  ["pending", "Order placed"],
  ["confirmed", "Confirmed"],
  ["out_for_delivery", "On the way"],
  ["delivered", "Delivered"],
];

function statusLine(o: OrderRow): { text: string; cls: string } {
  switch (o.fulfilment_status) {
    case "confirmed":
      return { text: "Payment received. We are preparing your order.", cls: "text-success" };
    case "out_for_delivery":
      return { text: "Your order is on its way.", cls: "text-info" };
    case "delivered":
      return { text: "Delivered. Thank you for shopping with MOA Mart.", cls: "text-success" };
    default:
      if (o.payment_status === "failed") return { text: "The payment did not go through.", cls: "text-destructive" };
      if (o.payment_status === "expired") return { text: "The time to pay ran out.", cls: "text-destructive" };
      return { text: "Waiting for payment.", cls: "text-warning" };
  }
}

function refundLine(o: OrderRow): string | null {
  if (o.refund_status === "pending") return "Your refund is on its way to your mobile money account.";
  if (o.refund_status === "completed") return `${money(o.total)} was refunded to your mobile money account.`;
  if (o.refund_status === "failed") {
    return `We are sorting out your refund. Message us in the chat and quote ${o.code}.`;
  }
  return null;
}

function OrderTracking() {
  const { orderId } = Route.useParams();
  const { ready } = useAuth();
  const code = decodeURIComponent(orderId).trim().toUpperCase();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from("orders").select(COLS).eq("code", code).maybeSingle();
      setOrder((data as unknown as OrderRow | null) ?? null);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void load();
  }, [ready, load]);

  const orderUuid = order?.id;
  useEffect(() => {
    if (!orderUuid) return;
    const channel = supabase
      .channel(`order-${orderUuid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderUuid}` },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderUuid, load]);

  const act = async (fn: "confirm_order_received" | "cancel_my_unpaid_order") => {
    if (!order) return;
    setBusy(true);
    setActionError("");
    const { error } = await supabase.rpc(fn, { p_code: order.code });
    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setConfirmCancel(false);
    await load();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center font-body text-sm text-muted-foreground">
          Loading your order…
        </main>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl font-bold">Order not found</h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">
            We could not find order {code}. Orders are only visible to the person who placed them, on the
            account or device they used at checkout.
          </p>
          <Link to="/" className="mt-6 inline-block font-body text-sm text-primary hover:underline">
            Back to the shop
          </Link>
        </main>
      </div>
    );
  }

  const cancelled = order.fulfilment_status === "cancelled";
  const stepIndex = STEPS.findIndex((s) => s[0] === order.fulfilment_status);
  const line = statusLine(order);
  const refund = refundLine(order);
  const unpaid = order.payment_status === "awaiting_payment" && order.fulfilment_status === "pending";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <p className="font-body text-xs uppercase tracking-[0.25em] text-muted-foreground">Order</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{order.code}</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Placed {new Date(order.created_at).toLocaleString()}
        </p>

        <section className="mt-6 rounded-2xl border border-border bg-card/60 p-5">
          {cancelled ? (
            <div className="grid gap-2 font-body text-sm">
              <p className="font-display text-base font-semibold text-destructive">This order was cancelled</p>
              {order.cancel_reason && <p className="text-muted-foreground">Reason: {order.cancel_reason}</p>}
              {refund && <p className="text-foreground">{refund}</p>}
            </div>
          ) : (
            <>
              <ol className="grid gap-4 sm:grid-cols-4">
                {STEPS.map(([key, label], i) => {
                  const done = i <= stepIndex;
                  return (
                    <li key={key} className="flex items-center gap-3 sm:block sm:text-center">
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full text-xs sm:mx-auto",
                          done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground",
                        )}
                      >
                        {done ? "✓" : i + 1}
                      </span>
                      <span
                        className={cn(
                          "font-body text-xs sm:mt-2 sm:block",
                          done ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className={cn("mt-4 font-body text-sm", line.cls)}>{line.text}</p>
            </>
          )}

          {order.fulfilment_status === "out_for_delivery" && (
            <div className="mt-4 grid gap-2 border-t border-border pt-4">
              <Button variant="neon" size="lg" disabled={busy} onClick={() => void act("confirm_order_received")}>
                I received my order
              </Button>
              <p className="font-body text-xs text-muted-foreground">
                Tap this when your order arrives. If you do not, we mark it delivered 3 days after dispatch.
              </p>
            </div>
          )}
          {actionError && <p className="mt-3 font-body text-sm text-destructive">{actionError}</p>}
        </section>

        {unpaid && (
          <section className="mt-4 rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="mb-3 font-display text-sm font-medium tracking-tight">Pay for this order</h2>
            <PaymentPanel code={order.code} total={order.total} defaultPhone={order.phone} />
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="mt-4 w-full py-2 text-center font-body text-sm text-muted-foreground transition-colors hover:text-destructive"
            >
              Cancel this order
            </button>
          </section>
        )}

        <section className="mt-4 rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-sm font-medium tracking-tight">Items</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {order.order_items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 font-body text-sm">
                {it.image && <img src={it.image} alt="" className="size-12 rounded-lg object-cover" />}
                <span className="min-w-0 flex-1 truncate">
                  {it.name}{it.variant_label ? ` (${it.variant_label})` : ""} <span className="text-muted-foreground">× {it.qty}</span>
                </span>
                <span className="shrink-0">{money(it.price * it.qty)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-border pt-3 font-body text-sm font-medium">
            <span>Total</span>
            <span className="text-primary">{money(order.total)}</span>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-card/60 p-5 font-body text-sm">
          <h2 className="font-display text-sm font-medium tracking-tight">Delivery details</h2>
          <dl className="mt-3 grid gap-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{order.customer_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{order.phone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Location</dt>
              <dd className="text-right">{order.location}</dd>
            </div>
            {order.preferred_time && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Preferred time</dt>
                <dd className="text-right">{order.preferred_time}</dd>
              </div>
            )}
            {order.notes && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="text-right">{order.notes}</dd>
              </div>
            )}
          </dl>
        </section>

        <p className="mt-6 text-center font-body text-xs text-muted-foreground">
          Questions about this order? Use the chat button and quote {order.code}.
        </p>
      </main>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              You have not paid, so nothing is charged. The items go back in stock and you cannot undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my order</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void act("cancel_my_unpaid_order");
              }}
            >
              {busy ? "Cancelling…" : "Cancel order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
