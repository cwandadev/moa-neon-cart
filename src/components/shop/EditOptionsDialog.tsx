import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OptionGroup } from "@/components/shop/OptionPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchProduct } from "@/lib/catalog";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { findVariant, lineProductFor, optionValues, variantLabel } from "@/lib/variants";

/** Change the size or color of a line that is already in the cart. */
export function EditOptionsDialog({
  item,
  onClose,
}: {
  item: { product: Product; qty: number };
  onClose: () => void;
}) {
  const { cart, removeFromCart, addToCart } = useStore();
  const [base, setBase] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [sel1, setSel1] = useState("");
  const [sel2, setSel2] = useState("");
  const baseId = item.product.baseId ?? item.product.id;
  const currentId = item.product.variantId;

  // Load fresh options and stock, and start from what is in the cart now.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchProduct(baseId);
        if (cancelled) return;
        if (!p) {
          setLoadError("This product is no longer available.");
          return;
        }
        setBase(p);
        const v = p.variants?.find((x) => x.id === currentId);
        setSel1(v?.option1 ?? "");
        setSel2(v?.option2 ?? "");
      } catch {
        if (!cancelled) setLoadError("Could not load the options. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseId, currentId]);

  const variants = base?.variants ?? [];
  const name1 = base?.optionNames?.[0] ?? "";
  const name2 = base?.optionNames?.[1] ?? "";
  const values1 = optionValues(variants, 1);
  const values2 = name2 ? optionValues(variants, 2) : [];
  const chosen = findVariant(variants, sel1, sel2, values2.length > 0);
  const price = chosen?.price ?? base?.price ?? item.product.price;

  const apply = () => {
    if (!base) return;
    if (sel1 === "") return setError(`Select ${name1.toLowerCase()}`);
    if (values2.length > 0 && sel2 === "") return setError(`Select ${name2.toLowerCase()}`);
    if (!chosen) return setError("That combination is not available.");
    if (chosen.id === currentId) return onClose();
    if (chosen.stock <= 0) return setError("That option is sold out.");

    const line = lineProductFor(base, chosen);
    const inCart = cart.find((i) => i.product.id === line.id)?.qty ?? 0;
    const room = chosen.stock - inCart;
    if (room <= 0) return setError("You already have all that is available of this option in your cart.");

    removeFromCart(item.product.id);
    addToCart(line, Math.min(item.qty, room));
    onClose();
    toast("Options updated", { description: `${base.name} · ${variantLabel(chosen)}` });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-2xl border-border bg-card">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg">Change options</DialogTitle>
          <DialogDescription className="font-body text-xs">{item.product.name}</DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="font-body text-sm text-destructive">{loadError}</p>
        ) : !base ? (
          <p className="py-6 text-center font-body text-sm text-muted-foreground">Loading options…</p>
        ) : (
          <div className="grid gap-5">
            <OptionGroup
              name={name1}
              which={1}
              values={values1}
              selected={sel1}
              otherSelected={sel2}
              variants={variants}
              onSelect={(v) => {
                setSel1(v);
                setError("");
              }}
            />
            {values2.length > 0 && (
              <OptionGroup
                name={name2}
                which={2}
                values={values2}
                selected={sel2}
                otherSelected={sel1}
                variants={variants}
                onSelect={(v) => {
                  setSel2(v);
                  setError("");
                }}
              />
            )}
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2.5 font-body text-sm">
              <span className="text-muted-foreground">{chosen ? variantLabel(chosen) : "Choose your options"}</span>
              <span className="font-medium">{money(price)}</span>
            </div>
            {error && <p className="font-body text-sm text-destructive">{error}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="glass" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="neon" size="lg" disabled={!base} onClick={apply}>
            Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
