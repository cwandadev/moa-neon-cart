import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LocationPinButton } from "@/components/shop/LocationPinButton";
import { PaymentPanel } from "@/components/shop/PaymentPanel";
import { SwipeZone } from "@/components/shop/SwipeZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import type { Pin } from "@/lib/delivery";
import { callFn, guessProvider, normalizePhone } from "@/lib/momo";
import { usePersistedState } from "@/lib/persist";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Receipt = { code: string; total: number; payments: boolean };

const emptyForm = { name: "", phone: "", location: "" };

/**
 * The whole checkout inside one pop-up: delivery details and payment on one screen, then the payment
 * progress. Closing the pop-up never loses it: the order and the form are remembered until it is finished.
 */
export function CheckoutFlow({
  items,
  kind,
  onClose,
  onBack,
  onDone,
}: {
  items: { product: Product; qty: number }[];
  kind: "cart" | "buy";
  /** Hide the pop-up (nothing is lost). */
  onClose: () => void;
  /** Back to the cart, shown before an order exists. */
  onBack?: () => void;
  /** The checkout is finished: forget it and hide the pop-up. */
  onDone: () => void;
}) {
  const buyNow = kind === "buy";
  const [form, setForm] = usePersistedState(`moa:checkout:${kind}:form`, emptyForm, { sync: true });
  const [receipt, setReceipt] = usePersistedState<Receipt | null>(`moa:checkout:${kind}:receipt`, null, {
    sync: true,
  });
  const [useOther, setUseOther] = useState(false);
  const [otherPhone, setOtherPhone] = useState("");
  const [payNote, setPayNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showItems, setShowItems] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  const [paid, setPaid] = useState(false);
  const [ended, setEnded] = useState(false);
  const { ensureSession, user } = useAuth();
  const { clearCart, validateCart } = useStore();
  const navigate = useNavigate();

  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const count = items.reduce((n, i) => n + i.qty, 0);
  const payPhone = useOther ? otherPhone : form.phone;
  const guess = guessProvider(payPhone);
  const payReady = Boolean(normalizePhone(payPhone));
  const valid = form.name.trim() && form.phone.trim() && form.location.trim() && items.length > 0 && payReady;

  // Nothing to check out and no order waiting: go back to the cart.
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!receipt && items.length === 0) backRef.current?.();
  }, [receipt, items.length]);

  // Pre-fill from the saved profile.
  useEffect(() => {
    if (!user) return;
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
  }, [user, setForm]);

  const reset = () => {
    setReceipt(null);
    setForm(emptyForm);
    setPaid(false);
    setEnded(false);
    setPayNote("");
    setUseOther(false);
    setOtherPhone("");
    setError("");
    setPin(null);
  };

  const finish = () => {
    reset();
    onDone();
  };

  const goTrack = () => {
    if (!receipt) return;
    const code = receipt.code;
    reset();
    onDone();
    void navigate({ to: "/orders/$orderId", params: { orderId: code } });
  };

  const submit = async () => {
    const mm = normalizePhone(payPhone);
    if (!mm) {
      setError("Enter a valid mobile money number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const uid = await ensureSession();
      if (!uid) {
        setError("Could not start a secure session. Please refresh the page and try again.");
        return;
      }
      // 1. Create the order (the server re-prices every line).
      const order = await callFn<{ order: { code: string; total: number }; payments_enabled?: boolean }>(
        "create-checkout",
        {
          items: items.map((i) => ({
            product_id: i.product.baseId ?? i.product.id,
            variant_id: i.product.variantId ?? null,
            qty: i.qty,
          })),
          customer: { customer_name: form.name, phone: form.phone, location: form.location },
        },
      );
      if (order.error || !order.data?.order) {
        const msg = order.error ?? "";
        // The shop says something is not available: fix the cart and say what changed, instead of showing the raw message.
        if (/not available|not enough stock|sold out|choose a size|option is not/i.test(msg)) {
          const issues = !buyNow ? await validateCart() : [];
          if (issues.length > 0 && onBack) {
            onBack();
            return;
          }
          setError(
            buyNow
              ? "Sorry, this item just sold out or is no longer available."
              : "Some items are no longer available in the quantity you chose. Please check your cart.",
          );
          return;
        }
        setError(msg || "Something went wrong. Please try again.");
        return;
      }
      const code = order.data.order.code;
      const payments = Boolean(order.data.payments_enabled);
      if (pin) {
        try {
          await supabase.rpc("set_order_pin", { p_code: code, p_lat: pin.lat, p_lng: pin.lng, p_accuracy: pin.accuracy });
        } catch {
          /* the order is saved; the customer can add the location on the order page */
        }
      }
      if (!buyNow) clearCart();

      // 2. Start the payment right away, so one tap does both.
      let note = "";
      if (payments) {
        const r = await callFn<{ status: string }>("create-payment", {
          action: "pay",
          order_code: code,
          // The server asks PawaPay which network this number is on. This is only the screen's own guess.
          ...(guess ? { provider: guess } : {}),
          phone: mm,
        });
        if (r.error) note = r.error;
      }
      setPayNote(note);
      setReceipt({ code, total: order.data.order.total, payments });
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "h-11 text-base sm:h-10 sm:text-sm";
  const heading = "font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  const done = Boolean(receipt && (paid || !receipt.payments));
  const title = !receipt ? "Checkout" : done ? "Order confirmed" : "Payment";
  const subtitle = !receipt
    ? "Delivery and payment"
    : done
      ? "Thank you for your order"
      : `Order ${receipt.code}`;

  return (
    <>
      <SwipeZone onClose={onClose} className="shrink-0">
        <span className="mx-auto mt-2 block h-1 w-10 rounded-full bg-muted-foreground/40 md:hidden" />
        <div className="flex items-center gap-2 px-3 pb-3 pr-16 pt-3 md:px-5 md:pt-5">
          {!receipt && onBack && (
            <button
              type="button"
              aria-label="Back to the cart"
              onClick={onBack}
              className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <i className="bx bx-chevron-left text-2xl" />
            </button>
          )}
          <div className={cn("min-w-0", (!onBack || receipt) && "pl-2")}>
            <h2 className="font-display text-lg font-semibold leading-tight">{title}</h2>
            <p className="font-body text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </SwipeZone>

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
                defaultPhone={payPhone}
                defaultProvider={guess}
                initialError={payNote}
                onPaid={() => setPaid(true)}
                onEnded={() => setEnded(true)}
                compact
              />
            ) : (
              <p className="font-body text-sm text-muted-foreground">
                Online payment with MTN MoMo and Airtel Money is coming soon. Keep your order number, you will be able
                to pay it as soon as payments open.
              </p>
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
                <button
                  type="button"
                  onClick={() => setUseOther((v) => !v)}
                  className="w-fit text-left font-body text-xs text-primary hover:underline"
                >
                  {useOther ? "Use this phone number for the payment" : "Pay with a different number"}
                </button>
                {useOther && (
                  <div className="grid gap-2 pt-1">
                    <Label htmlFor="co-momo">Phone number</Label>
                    <div className="flex gap-2">
                      <span className="grid h-11 place-items-center rounded-xl border border-border bg-muted/40 px-3 font-body text-sm text-muted-foreground sm:h-10">
                        +250
                      </span>
                      <Input
                        id="co-momo"
                        inputMode="tel"
                        value={otherPhone}
                        onChange={(e) => setOtherPhone(e.target.value)}
                        placeholder="0783 456 789"
                        className={cn(field, "min-w-0 flex-1")}
                      />
                    </div>
                  </div>
                )}
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
                <LocationPinButton value={pin} onChange={setPin} />
                <p className="font-body text-xs text-muted-foreground">
                  Sharing your exact location helps the rider find you. We call your phone number if we need directions.
                </p>
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {!receipt ? (
          <>
            {error && <p className="mb-2 font-body text-sm text-destructive">{error}</p>}
            <Button
              variant="neon"
              size="lg"
              className="h-12 w-full rounded-xl text-base"
              disabled={!valid || busy}
              onClick={() => void submit()}
            >
              {busy ? "Placing your order…" : `Pay ${money(total)}`}
            </Button>
            <p className="mt-2 text-center font-body text-[11px] text-muted-foreground">
              You approve the payment with your PIN on your phone.
            </p>
          </>
        ) : done ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="neon" size="lg" className="h-12 rounded-xl" onClick={goTrack}>
              Track order
            </Button>
            <Button variant="glass" size="lg" className="h-12 rounded-xl" onClick={finish}>
              Continue shopping
            </Button>
          </div>
        ) : ended ? (
          <Button variant="neon" size="lg" className="h-12 w-full rounded-xl" onClick={finish}>
            Back to the shop
          </Button>
        ) : (
          <button
            type="button"
            onClick={goTrack}
            className="w-full py-2.5 text-center font-body text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Pay later and track this order
          </button>
        )}
      </div>
    </>
  );
}
