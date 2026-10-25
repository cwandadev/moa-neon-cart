import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CheckoutFlow } from "@/components/shop/CheckoutFlow";
import { SwipeZone } from "@/components/shop/SwipeZone";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAppFrame, useIsMobile } from "@/lib/appFrame";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EditOptionsDialog } from "./EditOptionsDialog";

/**
 * One pop-up for the whole buying process: cart, then checkout (details and payment), then the payment.
 * Closing it only hides it. Open it again (or reload) and you are back where you were.
 */
export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, removeFromCart, setQty, cartTotal, addToCart, cartIssues, dismissCartIssues, validateCart } = useStore();
  const [view, setView] = usePersistedState<"cart" | "checkout">("moa:cart:view", "cart");
  const [editing, setEditing] = useState<(typeof cart)[number] | null>(null);
  const [checking, setChecking] = useState(false);
  const isMobile = useIsMobile();
  const frame = useAppFrame(cartOpen && isMobile);
  const navigate = useNavigate();
  const count = cart.reduce((n, i) => n + i.qty, 0);
  const hide = () => setCartOpen(false);
  const visibleHeight =
    typeof window !== "undefined" && frame ? Math.max(0, window.innerHeight - frame.top - frame.bottom) : 0;

  /** Checks the stock one more time before the form. If something changed, stay here and say what. */
  const goCheckout = async () => {
    setChecking(true);
    const issues = await validateCart();
    setChecking(false);
    if (issues.length === 0) setView("checkout");
  };

  const remove = (item: (typeof cart)[number]) => {
    removeFromCart(item.product.id);
    toast("Removed from cart", {
      description: item.product.name,
      action: { label: "Undo", onClick: () => addToCart(item.product, item.qty) },
    });
  };

  return (
    <>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          snap={view === "checkout" ? "fit" : "auto"}
          className={cn(
            "flex flex-col gap-0 border-border bg-card p-0",
            isMobile ? "max-h-[88dvh] rounded-t-3xl" : "w-full sm:max-w-md",
          )}
          style={
            isMobile && frame?.keyboard
              ? { bottom: frame.bottom, maxHeight: `${Math.max(240, visibleHeight - 8)}px` }
              : undefined
          }
        >
          <SheetTitle className="sr-only">{view === "cart" ? "Your cart" : "Checkout"}</SheetTitle>
          <SheetDescription className="sr-only">
            {view === "cart" ? "Review your items, then continue to checkout." : "Delivery details and payment."}
          </SheetDescription>

          {view === "checkout" ? (
            <CheckoutFlow
              kind="cart"
              items={cart}
              onClose={hide}
              onBack={() => setView("cart")}
              onDone={() => {
                setView("cart");
                hide();
              }}
            />
          ) : (
            <>
              <SwipeZone onClose={hide} className="shrink-0">
                <span className="mx-auto mt-2 block h-1 w-10 rounded-full bg-muted-foreground/40 md:hidden" />
                <div className="border-b border-border px-5 pb-4 pr-16 pt-4 md:pt-5">
                  <h2 className="font-display text-lg font-semibold">
                    Your cart
                    {count > 0 && (
                      <span className="ml-2 font-body text-sm font-normal text-muted-foreground">
                        {count} {count === 1 ? "item" : "items"}
                      </span>
                    )}
                  </h2>
                </div>
              </SwipeZone>

              {cartIssues.length > 0 && (
                <div role="alert" className="mx-5 mt-4 shrink-0 rounded-xl border border-warning/40 bg-warning/10 p-3 font-body text-sm">
                  <div className="flex items-start gap-2">
                    <i aria-hidden className="bx bx-info-circle mt-0.5 text-lg text-warning" />
                    <ul className="grid min-w-0 flex-1 gap-1">
                      {cartIssues.map((i) => (
                        <li key={`${i.id}-${i.kind}`} className="break-words">
                          {i.text}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={dismissCartIssues}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <i aria-hidden className="bx bx-x text-xl" />
                    </button>
                  </div>
                </div>
              )}

              {cart.length === 0 ? (
                <div className="grid flex-1 place-content-center justify-items-center gap-3 px-6 py-10 text-center">
                  <span className="grid size-16 place-items-center rounded-full bg-secondary text-muted-foreground">
                    <i className="bx bx-shopping-bag text-3xl" />
                  </span>
                  <p className="font-display text-base font-semibold">Your cart is empty</p>
                  <p className="max-w-[16rem] font-body text-sm text-muted-foreground">
                    Add something you like and it will wait for you here.
                  </p>
                  <Button
                    variant="neon"
                    className="mt-1 rounded-xl"
                    onClick={() => {
                      hide();
                      void navigate({ to: "/" });
                    }}
                  >
                    Browse the shop
                  </Button>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <ul className="divide-y divide-border">
                    {cart.map((item) => {
                      const atMax = item.qty >= item.product.stock;
                      return (
                        <li key={item.product.id} className="flex gap-3 py-4 first:pt-0">
                          <Link
                            to="/product/$productId"
                            params={{ productId: item.product.baseId ?? item.product.id }}
                            onClick={hide}
                            className="shrink-0"
                          >
                            <img
                              src={item.product.images[0]}
                              alt=""
                              decoding="async"
                              className="size-[72px] rounded-xl object-cover"
                            />
                          </Link>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                to="/product/$productId"
                                params={{ productId: item.product.baseId ?? item.product.id }}
                                onClick={hide}
                                className="line-clamp-2 font-display text-sm font-medium leading-snug hover:text-primary"
                              >
                                {item.product.name}
                              </Link>
                              <button
                                type="button"
                                aria-label="Remove item"
                                className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                                onClick={() => remove(item)}
                              >
                                <i className="bx bx-trash text-lg" />
                              </button>
                            </div>
                            {item.product.variantLabel && (
                              <p className="font-body text-xs text-foreground/80">
                                {item.product.variantLabel}
                                <button
                                  type="button"
                                  onClick={() => setEditing(item)}
                                  className="ml-2 text-primary hover:underline"
                                >
                                  Change
                                </button>
                              </p>
                            )}
                            <p className="font-body text-xs text-muted-foreground">{money(item.product.price)} each</p>
                            <div className="mt-auto flex items-center justify-between pt-2">
                              <div className="flex items-center rounded-full border border-border">
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                                  onClick={() => (item.qty <= 1 ? remove(item) : setQty(item.product.id, item.qty - 1))}
                                >
                                  <i className="bx bx-minus" />
                                </button>
                                <span className="w-7 text-center font-body text-sm">{item.qty}</span>
                                <button
                                  type="button"
                                  aria-label="Increase quantity"
                                  disabled={atMax}
                                  className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                                  onClick={() => setQty(item.product.id, item.qty + 1)}
                                >
                                  <i className="bx bx-plus" />
                                </button>
                              </div>
                              <p className="font-display text-sm font-semibold">
                                {money(item.product.price * item.qty)}
                              </p>
                            </div>
                            {item.product.stock <= 3 && (
                              <p className="mt-1 font-body text-[11px] text-warning">Only {item.product.stock} left</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {cart.length > 0 && (
                <div className="shrink-0 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
                  <dl className="grid gap-1.5 font-body text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd>{money(cartTotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Delivery</dt>
                      <dd className="text-muted-foreground">Confirmed after you order</dd>
                    </div>
                  </dl>
                  <Button
                    variant="neon"
                    size="lg"
                    className="mt-4 h-12 w-full rounded-xl text-base"
                    disabled={checking}
                    onClick={() => void goCheckout()}
                  >
                    {checking ? "Checking stock…" : `Checkout · ${money(cartTotal)}`}
                  </Button>
                  <button
                    type="button"
                    onClick={hide}
                    className="mt-1 w-full py-2.5 text-center font-body text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Continue shopping
                  </button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {editing && <EditOptionsDialog key={editing.product.id} item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
