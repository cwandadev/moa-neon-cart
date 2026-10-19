import { FunctionsHttpError } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PaymentPanel } from "@/components/shop/PaymentPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppFrame, useIsMobile } from "@/lib/appFrame";
import { useAuth } from "@/lib/auth";
import { usePersistedState } from "@/lib/persist";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { useSwipeDown } from "@/lib/swipe";
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
  const kind = buyNow ? "buy" : "cart";
  const [form, setForm] = usePersistedState(`moa:checkout:${kind}:form`, emptyForm, { sync: true });
  const [receipt, setReceipt] = usePersistedState<Receipt | null>(`moa:checkout:${kind}:receipt`, null, {
    sync: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showItems, setShowItems] = useState(false);
  const [paid, setPaid] = useState(false);
  const { ensureSession, user } = useAuth();
  const { clearCart, setCartOpen } = useStore();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const frame = useAppFrame(open && isMobile);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const swipe = useSwipeDown(
    () => close(false),
    () => panelRef.current,
  );

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
  }, [open, user, setForm]);

  const close = (v: boolean) => {
    if (!v && receipt) {
      setReceipt(null);
      setForm(emptyForm);
      setPaid(false);
      setCartOpen(false);
    }
    setError("");
    onOpenChange(v);
  };

  const goTrack = () => {
    if (!receipt) return;
    const code = receipt.code;
    close(false);
    void navigate({ to: "/orders/$orderId", params: { orderId: code } });
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

  const done = Boolean(receipt && (paid || !receipt.payments));
  const title = !receipt ? "Checkout" : done ? "Order confirmed" : "Pay for your order";
  const step = !receipt
    ? "Step 1 of 2 · Delivery details"
    : done
      ? "Thank you for your order"
      : "Step 2 of 2 · Pay with mobile money";

  // On phones the dialog is a bottom sheet that is only as tall as its content.
  // When the keyboard is open it sits right above it.
  const visibleHeight =
    typeof window !== "undefined" && frame ? Math.max(0, window.innerHeight - frame.top - frame.bottom) : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        ref={panelRef}
        className="moa-sheet flex flex-col gap-0 overflow-hidden border-border bg-card p-0 max-sm:rounded-b-none max-sm:rounded-t-3xl sm:max-h-[90vh] sm:max-w-lg"
        style={
          isMobile
            ? {
                left: 0,
                right: 0,
                top: "auto",
                bottom: frame?.keyboard ? frame.bottom : 0,
                width: "100%",
                maxWidth: "none",
                maxHeight: frame?.keyboard ? `${Math.max(240, visibleHeight - 8)}px` : "92dvh",
                transform: "none",
                translate: "none",
              }
            : undefined
        }
      >
        <div {...swipe} className="shrink-0 touch-none">
          <span className="mx-auto mt-2 block h-1 w-10 rounded-full bg-muted-foreground/40 sm:hidden" />
          <DialogHeader className="gap-0.5 px-5 pb-3 pr-16 pt-3 text-left sm:pt-5">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className="font-body text-xs">{step}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border px-5 py-4">
          {receipt ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 px-4 py-3 font-body">
                <div>
                  <p className="text-[11px] text-muted-foreground">Order</p>
                  <p className="text-sm font-medium">{receipt.code}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Total</p>
                  <p className="font-display text-base font-semibold text-primary">{money(receipt.total)}</p>
                </div>
              </div>
              {receipt.payments ? (
                <PaymentPanel
                  code={receipt.code}
                  total={receipt.total}
                  defaultPhone={form.phone}
                  onPaid={() => setPaid(true)}
                  compact
                />
              ) : (
                <p className="font-body text-sm text-muted-foreground">
                  Online payment with MTN MoMo and Airtel Money is coming soon. Keep your order number, you will be
                  able to pay it as soon as payments open.
                </p>
              )}
              {!done && (
                <button
                  type="button"
                  onClick={goTrack}
                  className="py-1 text-center font-body text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Pay later and track this order
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-5">
              <section className="rounded-2xl border border-border bg-muted/40">
                <button
                  type="button"
                  onClick={() => setShowItems((v) => !v)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <span className="flex shrink-0">
                    {items.slice(0, 3).map((i, n) => (
                      <img
                        key={i.product.id}
                        src={i.product.images[0]}
                        alt=""
                        decoding="async"
                        className={cn("size-10 rounded-lg object-cover ring-2 ring-card", n > 0 && "-ml-3")}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 font-body text-sm">
                    {count} {count === 1 ? "item" : "items"}
                    <span className="block text-[11px] text-muted-foreground">
                      {showItems ? "Hide the list" : "Tap to see the list"}
                    </span>
                  </span>
                  <span className="font-display text-sm font-semibold">{money(total)}</span>
                  <i className={cn("bx text-lg text-muted-foreground", showItems ? "bx-chevron-up" : "bx-chevron-down")} />
                </button>
                {showItems && (
                  <div className="border-t border-border px-3 py-2 font-body text-sm">
                    {items.map((i) => (
                      <div key={i.product.id} className="flex justify-between gap-3 py-0.5">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {i.product.name}
                          {i.product.variantLabel ? ` (${i.product.variantLabel})` : ""} × {i.qty}
                        </span>
                        <span className="shrink-0">{money(i.product.price * i.qty)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="grid gap-3">
                <h3 className={heading}>Contact</h3>
                <div className="grid gap-2">
                  <Label htmlFor="co-name">Full name</Label>
                  <Input
                    id="co-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Alice Uwase"
                    autoComplete="name"
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
                    autoComplete="tel"
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
                    autoComplete="street-address"
                    className={field}
                  />
                  <p className="font-body text-xs text-muted-foreground">
                    We call your phone number if we need directions.
                  </p>
                </div>
              </section>
            </div>
          )}
        </div>

        {(!receipt || done) && (
          <div className="shrink-0 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {receipt ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="neon" size="lg" className="h-12 rounded-xl" onClick={goTrack}>
                  Track order
                </Button>
                <Button variant="glass" size="lg" className="h-12 rounded-xl" onClick={() => close(false)}>
                  Continue shopping
                </Button>
              </div>
            ) : (
              <>
                {error && <p className="mb-2 font-body text-sm text-destructive">{error}</p>}
                <Button
                  variant="neon"
                  size="lg"
                  className="h-12 w-full rounded-xl text-base"
                  disabled={!valid || busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Placing order…" : `Place order · ${money(total)}`}
                </Button>
                <p className="mt-2 text-center font-body text-[11px] text-muted-foreground">
                  You pay with MTN MoMo or Airtel Money in the next step.
                </p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
