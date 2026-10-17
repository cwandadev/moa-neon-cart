import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/shop/Header";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { PaymentPanel } from "@/components/shop/PaymentPanel";

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
  payment_method: string | null;
  order_items: { name: string; image: string; qty: number; price: number }[];
};

const STEPS: [string, string][] = [
  ["pending", "Order placed"],
  ["confirmed", "Confirmed"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
];

function paymentNote(status: string): { text: string; cls: string } {
  switch (status) {
    case "paid":
      return { text: "Payment received. Thank you!", cls: "text-success" };
    case "failed":
      return { text: "The payment did not go through.", cls: "text-destructive" };
    case "expired":
      return { text: "The payment window expired.", cls: "text-destructive" };
    default:
      return {
        text: "Waiting for payment.",
        cls: "text-warning",
      };
  }
}

function OrderTracking() {
  const { orderId } = Route.useParams();
  const { ready } = useAuth();
  const code = decodeURIComponent(orderId).trim().toUpperCase();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data } = await supabase
          .from("orders")
          .select(
            "id, code, created_at, customer_name, phone, location, preferred_time, notes, subtotal, total, payment_status, fulfilment_status, payment_method, order_items(name, image, qty, price)",
          )
          .eq("code", code)
          .maybeSingle();
        if (!cancelled) setOrder((data as unknown as OrderRow | null) ?? null);
      } catch {
        if (!cancelled) setOrder(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, code]);

  const orderUuid = order?.id;
  useEffect(() => {
    if (!orderUuid) return;
    const channel = supabase
      .channel(`order-${orderUuid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderUuid}` },
        (payload) => {
          const n = payload.new as unknown as Partial<OrderRow>;
          setOrder((prev) =>
            prev
              ? {
                  ...prev,
                  payment_status: n.payment_status ?? prev.payment_status,
                  fulfilment_status: n.fulfilment_status ?? prev.fulfilment_status,
                }
              : prev,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderUuid]);

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
  const pay = paymentNote(order.payment_status);

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
            <p className="font-body text-sm text-destructive">This order was cancelled.</p>
          ) : (
            <ol className="grid gap-4 sm:grid-cols-4">
              {STEPS.map(([key, label], i) => {
                const done = i <= stepIndex;
                return (
                  <li key={key} className="flex items-center gap-3 sm:block sm:text-center">
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-full text-xs sm:mx-auto ${
                        done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span
                      className={`font-body text-xs sm:mt-2 sm:block ${
                        done ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className={`mt-4 font-body text-sm ${pay.cls}`}>{pay.text}</p>
        </section>

        {order.payment_status === "awaiting_payment" && !cancelled && (
          <section className="mt-4 rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="mb-3 font-display text-sm font-medium tracking-tight">Pay for this order</h2>
            <PaymentPanel code={order.code} total={order.total} defaultPhone={order.phone} />
          </section>
        )}
        <section className="mt-4 rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-sm font-medium tracking-tight">Items</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {order.order_items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 font-body text-sm">
                {it.image && <img src={it.image} alt="" className="size-12 rounded-lg object-cover" />}
                <span className="min-w-0 flex-1 truncate">
                  {it.name} <span className="text-muted-foreground">× {it.qty}</span>
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
    </div>
  );
}
