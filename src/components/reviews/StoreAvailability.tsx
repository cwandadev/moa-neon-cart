import { useEffect, useState } from "react";
import { logoUrlOf } from "@/lib/storeLogo";
import { nameList, type Store } from "@/lib/reviews";
import { supabase } from "@/lib/supabase";

/**
 * Which store the product is sent from, shown the way Google Play shows who made an app: a round picture (the store's own logo, or a store icon until it has one), the NAME in the brand colour, and one plain
 * line under it saying what that means for the shopper. To a customer these are stores, never warehouses, and no quantities or addresses are shown.
 * Nothing is shown when no store has it (the page already says it is out of stock) or when the database does not have the feature yet.
 */
export function StoreAvailability({ productId, variantId }: { productId: string; variantId?: string | null | undefined }) {
  const [stores, setStores] = useState<Store[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase.rpc("product_stores", { p_product: productId, p_variant: variantId ?? null });
      if (live) setStores(error || !Array.isArray(data) ? [] : (data as Store[]));
    })();
    return () => {
      live = false;
    };
  }, [productId, variantId]);
  const [logoFailed, setLogoFailed] = useState(false);
  const only = stores.length === 1 ? stores[0]! : null;
  const logo = only ? logoUrlOf(only.logo_path) : null;
  useEffect(() => setLogoFailed(false), [logo]);
  if (stores.length === 0) return null;
  const one = stores.length === 1;
  return (
    <div className="mt-3 flex items-center gap-3" data-stores aria-label="Where your order is sent from" role="group">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-foreground">
        {logo && !logoFailed ? <img src={logo} alt="" data-store-logo draggable={false} onError={() => setLogoFailed(true)} className="size-full object-cover" /> : <i className="bx bx-store-alt text-xl" />}
      </span>
      <div className="min-w-0">
        <p className="truncate font-body text-sm font-semibold text-primary" data-store-name>
          {one ? stores[0]!.name : nameList(stores.map((s) => s.name))}
        </p>
        <p className="font-body text-xs text-muted-foreground">{one ? "Your order is sent from this store" : `In stock at ${stores.length} stores. Your order is sent from the nearest`}</p>
      </div>
    </div>
  );
}
