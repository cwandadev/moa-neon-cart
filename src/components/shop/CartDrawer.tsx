import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { money } from "@/lib/products";
import { useStore } from "@/lib/store";
import { CheckoutDialog } from "./CheckoutDialog";

export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, removeFromCart, setQty, cartTotal } = useStore();
  const [checkout, setCheckout] = useState(false);

  return (
    <>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="flex w-full flex-col gap-0 border-border bg-card/95 backdrop-blur-xl sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-display">Your cart</SheetTitle>
            <SheetDescription className="font-body">
              Checkout is completed over WhatsApp with our sales desk.
            </SheetDescription>
          </SheetHeader>

          <div className="-mx-6 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {cart.length === 0 && (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <i className="bx bx-shopping-bag text-4xl text-muted-foreground" />
                <p className="font-body text-sm text-muted-foreground">Your cart is empty.</p>
              </div>
            )}
            {cart.map((item) => (
              <div
                key={item.product.id}
                className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-background/40 p-2"
              >
                <img
                  src={item.product.images[0]}
                  alt={item.product.name}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-medium">{item.product.name}</p>
                  <p className="font-body text-xs text-muted-foreground">{money(item.product.price)}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      className="grid h-6 w-6 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                      onClick={() => setQty(item.product.id, item.qty - 1)}
                      aria-label="Decrease quantity"
                    >
                      <i className="bx bx-minus" />
                    </button>
                    <span className="w-6 text-center font-body text-xs">{item.qty}</span>
                    <button
                      className="grid h-6 w-6 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                      onClick={() => setQty(item.product.id, item.qty + 1)}
                      aria-label="Increase quantity"
                    >
                      <i className="bx bx-plus" />
                    </button>
                  </div>
                </div>
                <button
                  className="shrink-0 self-start p-1 text-muted-foreground hover:text-destructive"
                  onClick={() => removeFromCart(item.product.id)}
                  aria-label="Remove item"
                >
                  <i className="bx bx-trash text-lg" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between font-display">
              <span className="text-muted-foreground">Total</span>
              <span className="text-xl font-semibold text-primary">{money(cartTotal)}</span>
            </div>
            <Button
              variant="whatsapp"
              size="lg"
              className="w-full"
              disabled={cart.length === 0}
              onClick={() => setCheckout(true)}
            >
              <i className="bx bxl-whatsapp text-xl" /> Order via WhatsApp
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <CheckoutDialog open={checkout} onOpenChange={setCheckout} items={cart} />
    </>
  );
}