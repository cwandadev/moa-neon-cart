import { FunctionsHttpError } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { PaymentPanel } from "@/components/shop/PaymentPanel";

type Receipt = { code: string; total: number; payments: boolean };

const emptyForm = { name: "", phone: "", location: "", time: "As soon as possible", notes: "" };

export function CheckoutDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: { product: Product; qty: number }[];
}) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const { ensureSession, user } = useAuth();
  const { clearCart, setCartOpen } = useStore();
  const navigate = useNavigate();

  // Pre-fill from the saved profile when the dialog opens.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("phone, default_location")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled || !data) return;
        setForm((f) => ({
          ...f,
          name: f.name || `${user.firstName} ${user.lastName}`.trim(),
          phone: f.phone || ((data.phone as string | null) ?? ""),
          location: f.location || ((data.default_location as string | null) ?? ""),
        }));
      } catch {
        /* keep the empty form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  // Display total only: the server re-prices every item from the database.
  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const valid = form.name.trim() && form.phone.trim() && form.location.trim() && items.length > 0;

  const close = (v: boolean) => {
    if (!v && receipt) {
      setReceipt(null);
      setForm(emptyForm);
      setCartOpen(false);
    }
    setError("");
    onOpenChange(v);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const uid = await ensureSession();
      if (!uid) {
        setError("Could not start a secure session. Please refresh the page and try again.");
        return;
      }
      const { data, error: err } = await supabase.functions.invoke<{
        order: { code: string; total: number };
        payments_enabled?: boolean;
      }>("create-checkout", {
        body: {
          items: items.map((i) => ({ product_id: i.product.id, qty: i.qty })),
          customer: {
            customer_name: form.name,
            phone: form.phone,
            location: form.location,
            preferred_time: form.time,
            notes: form.notes,
          },
        },
      });
      if (err) {
        let msg = "Something went wrong. Please try again.";
        if (err instanceof FunctionsHttpError) {
          try {
            const b = await err.context.json();
            if (b?.error) msg = String(b.error);
          } catch {
            /* keep the generic message */
          }
        }
        setError(msg);
        return;
      }
      if (!data?.order) {
        setError("Something went wrong. Please try again.");
        return;
      }
      setReceipt({
        code: data.order.code,
        total: data.order.total,
        payments: Boolean(data.payments_enabled),
      });
      clearCart();
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="glass max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {receipt ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">{receipt.payments ? "Pay for your order" : "Order received"}</DialogTitle>
              <DialogDescription className="font-body">
                {receipt.payments ? "Your order is saved. Pay with mobile money to confirm it." : "Your order is saved and waiting for payment."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 rounded-xl border border-border bg-muted/40 p-4 font-body text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order number</span>
                <span className="font-medium">{receipt.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium text-primary">{money(receipt.total)}</span>
              </div>
              {!receipt.payments && (
                <p className="text-muted-foreground">
                  Online payment with MTN MoMo and Airtel Money is coming soon. Keep your order number,
                  you will be able to pay it as soon as payments open.
                </p>
              )}
            </div>
            {receipt.payments && (
              <PaymentPanel code={receipt.code} total={receipt.total} defaultPhone={form.phone} />
            )}
            <Button
              variant="glass"
              size="lg"
              onClick={() => {
                const code = receipt.code;
                close(false);
                void navigate({ to: "/orders/$orderId", params: { orderId: code } });
              }}
            >
              Track this order
            </Button>
            <Button variant="neon" size="lg" onClick={() => close(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Checkout</DialogTitle>
              <DialogDescription className="font-body">
                Enter your delivery details. You pay with MTN MoMo or Airtel Money in the next step.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="co-name">Full name</Label>
                <Input id="co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alice Uwase" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="co-phone">Phone number</Label>
                  <Input id="co-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+250 78..." />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="co-time">Preferred delivery time</Label>
                  <Input id="co-time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="co-loc">Delivery location</Label>
                <Input id="co-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Kigali, Kimihurura — KG 7 Ave" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="co-notes">Notes (optional)</Label>
                <Textarea id="co-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-3 font-body text-sm">
                {items.map((i) => (
                  <div key={i.product.id} className="flex justify-between gap-3 py-0.5">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {i.product.name} × {i.qty}
                    </span>
                    <span className="shrink-0">{money(i.product.price * i.qty)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
                  <span>Total</span>
                  <span className="text-primary">{money(total)}</span>
                </div>
              </div>

              {error && <p className="font-body text-sm text-destructive">{error}</p>}

              <Button variant="neon" size="lg" disabled={!valid || busy} onClick={() => void submit()}>
                {busy ? "Placing order…" : "Place order"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
