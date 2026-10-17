import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/shop/Header";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "My orders — MOA Mart" }] }),
  component: MyOrders,
});

type Row = {
  id: string;
  code: string;
  created_at: string;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  order_items: { name: string; image: string; qty: number }[];
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const tone = (s: string) => {
  switch (s) {
    case "paid":
    case "delivered":
      return "bg-success/10 text-success";
    case "awaiting_payment":
    case "pending":
    case "confirmed":
      return "bg-warning/10 text-warning";
    case "out_for_delivery":
      return "bg-accent/10 text-accent";
    default:
      return "bg-destructive/10 text-destructive";
  }
};

function MyOrders() {
  const { user, ready } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        const uid = s.session?.user.id;
        if (!uid) {
          if (!cancelled) setRows([]);
          return;
        }
        const { data, error: err } = await supabase
          .from("orders")
          .select("id, code, created_at, total, payment_status, fulfilment_status, order_items(name, image, qty)")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(50);
        if (err) throw err;
        if (!cancelled) {
          setRows((data ?? []) as unknown as Row[]);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Could not load your orders. Please refresh.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user?.id]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">My orders</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">{rows.length} orders</p>

        {!user && rows.length > 0 && (
          <p className="mt-4 rounded-xl border border-border bg-card/60 p-3 font-body text-xs text-muted-foreground">
            You are not signed in, so these are the orders placed from this device.{" "}
            <Link to="/login" className="text-primary hover:underline">
              Log in
            </Link>{" "}
            to see your orders anywhere.
          </p>
        )}

        {error && <p className="mt-4 font-body text-sm text-destructive">{error}</p>}

        {!loading && rows.length === 0 && !error ? (
          <div className="py-20 text-center">
            <p className="font-body text-sm text-muted-foreground">You have no orders yet.</p>
            <Link to="/" className="mt-4 inline-block font-body text-sm text-primary hover:underline">
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {rows.map((o) => (
              <li key={o.id}>
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: o.code }}
                  className="block rounded-2xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-body text-sm font-medium text-primary">{o.code}</p>
                      <p className="font-body text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString()} · {money(o.total)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 font-body text-[11px] ${tone(o.payment_status)}`}>
                        {label(o.payment_status)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 font-body text-[11px] ${tone(o.fulfilment_status)}`}>
                        {label(o.fulfilment_status)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {o.order_items.slice(0, 4).map((it, i) =>
                      it.image ? (
                        <img key={i} src={it.image} alt="" className="size-10 rounded-lg object-cover" />
                      ) : null,
                    )}
                    <p className="min-w-0 flex-1 truncate font-body text-xs text-muted-foreground">
                      {o.order_items.map((it) => `${it.name} × ${it.qty}`).join(", ")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
