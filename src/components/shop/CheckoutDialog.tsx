import { FunctionsHttpError } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PaymentPanel } from "@/components/shop/PaymentPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppFrame, useIsMobile } from "@/lib/appFrame";
import { useAuth } from "@/lib/auth";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Receipt = { code: string; total: number; payments: boolean };

const emptyForm = { name: "", phone: "", location: "" };

export function CheckoutDialog({
  open,
  onOpenChange,
  items,
  buyNow = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: { product: Product; qty: number }[];
  buyNow?: boolean;
}) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [showItems, setShowItems] = useState(false);
  const { ensureSession, user } = useAuth();
  const { clearCart, setCartOpen } = useStore();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const frame = useAppFrame(open && isMobile);

  // Display total only: the server re-prices every item from the database.
  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const count = items.reduce((n, i) => n + i.qty, 0);
  const valid = form.name.trim() && form.phone.trim() && form.location.trim() && items.length > 0;

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
          items: items.map((i) => ({
            product_id: i.product.baseId ?? i.product.id,
            variant_id: i.product.variantId ?? null,
            qty: i.qty,
          })),
          customer: {
            customer_name: form.name,
            phone: form.phone,
            location: form.location,
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
      if (!buyNow) clearCart();
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "h-11 text-base sm:h-10 sm:text-sm";
  const heading = "font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden border-border bg-card p-0 max-sm:rounded-2xl sm:max-h-[90vh] sm:max-w-lg"
        style={
          isMobile && frame
            ? {
                left: 12,
                right: 12,
                top: frame.top,
                bottom: frame.bottom,
                width: "auto",
                maxWidth: "none",
                maxHeight: "none",
                transform: "none",
                translate: "none",
                animation: "none",
              }
            : undefined
        }
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-lg">
            {receipt ? (receipt.payments ? "Pay for your order" : "Order received") : "Checkout"}
          </DialogTitle>
          <DialogDescription className="font-body text-xs">
            {receipt
              ? receipt.payments
                ? "Your order is saved. Pay with mobile money to confirm it."
                : "Your order is saved and waiting for payment."
              : "Enter your delivery details. You pay with MTN MoMo or Airtel Money in the next step."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {receipt ? (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-xl border border-border bg-muted/40 p-3 font-body text-sm">
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
                    Online payment with MTN MoMo and Airtel Money is coming soon. Keep your order number, you will
                    be able to pay it as soon as payments open.
                  </p>
                )}
              </div>
              {receipt.payments && (
                <PaymentPanel code={receipt.code} total={receipt.total} defaultPhone={form.phone} />
              )}
            </div>
          ) : (
            <div className="grid gap-5">
              <section className="grid gap-3">
                <h3 className={heading}>Contact</h3>
                <div className="grid gap-2">
                  <Label htmlFor="co-name">Full name</Label>
                  <Input
                    id="co-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Alice Uwase"
                    className={field}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="co-phone">Phone number</Label>
                  <Input
                    id="co-phone"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+250 78..."
                    className={field}
                  />
                </div>
              </section>

              <section className="grid gap-3">
                <h3 className={heading}>Delivery</h3>
                <div className="grid gap-2">
                  <Label htmlFor="co-loc">Delivery location</Label>
                  <Input
                    id="co-loc"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="Kigali, Kimihurura — KG 7 Ave"
                    className={field}
                  />
                  <p className="font-body text-xs text-muted-foreground">We call your phone number if we need directions.</p>
                </div>
              </section>

              <section className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setShowItems((v) => !v)}
                  className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left font-body text-sm sm:pointer-events-none"
                >
                  <span>
                    Order summary · {count} {count === 1 ? "item" : "items"}
                  </span>
                  <i
                    className={cn(
                      "bx text-lg text-muted-foreground sm:hidden",
                      showItems ? "bx-chevron-up" : "bx-chevron-down",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "rounded-xl border border-border bg-muted/40 p-3 font-body text-sm",
                    !showItems && "max-sm:hidden",
                  )}
                >
                  {items.map((i) => (
                    <div key={i.product.id} className="flex justify-between gap-3 py-0.5">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {i.product.name}{i.product.variantLabel ? ` (${i.product.variantLabel})` : ""} × {i.qty}
                      </span>
                      <span className="shrink-0">{money(i.product.price * i.qty)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-card px-5 py-3 max-sm:pb-4">
          {receipt ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="glass"
                size="lg"
                onClick={() => {
                  const code = receipt.code;
                  close(false);
                  void navigate({ to: "/orders/$orderId", params: { orderId: code } });
                }}
              >
                Track order
              </Button>
              <Button variant="neon" size="lg" onClick={() => close(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              {error && <p className="mb-2 font-body text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  <p className="font-body text-[11px] text-muted-foreground">Total</p>
                  <p className="font-display text-lg font-semibold leading-tight text-primary">{money(total)}</p>
                </div>
                <Button
                  variant="neon"
                  size="lg"
                  className="flex-1"
                  disabled={!valid || busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Placing order…" : "Place order"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
