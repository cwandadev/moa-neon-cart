import { CheckoutFlow } from "@/components/shop/CheckoutFlow";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppFrame, useIsMobile } from "@/lib/appFrame";
import type { Product } from "@/lib/products";

/**
 * "Buy now": the same checkout as the cart's, in a pop-up of its own (it buys only this product).
 * On phones it is a bottom sheet that is only as tall as its content.
 */
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
  const isMobile = useIsMobile();
  const frame = useAppFrame(open && isMobile);
  const visibleHeight =
    typeof window !== "undefined" && frame ? Math.max(0, window.innerHeight - frame.top - frame.bottom) : 0;
  const hide = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="moa-sheet flex flex-col gap-0 overflow-hidden border-border bg-card p-0 max-md:rounded-b-none max-md:rounded-t-3xl md:max-h-[90vh] md:max-w-lg"
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
        <DialogTitle className="sr-only">Checkout</DialogTitle>
        <DialogDescription className="sr-only">Delivery details and payment</DialogDescription>
        <CheckoutFlow kind={buyNow ? "buy" : "cart"} items={items} onClose={hide} onDone={hide} />
      </DialogContent>
    </Dialog>
  );
}
