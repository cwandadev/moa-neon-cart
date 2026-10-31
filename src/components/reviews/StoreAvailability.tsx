import { useEffect, useState } from "react";
import { nameList, type Store } from "@/lib/reviews";
import { supabase } from "@/lib/supabase";

/**
 * "Ships from MOA Mart Kigali": which of the shop's stores have this product (or this size) in stock. To a customer these are stores, never
 * warehouses, and no quantities or addresses are shown. With several, we say we send it from the nearest to them. Nothing is shown when
 * there is none (the page already says it is out of stock) or when the database does not have the feature yet.
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
  if (stores.length === 0) return null;
  const names = stores.map((s) => s.name);
  return (
    <p className="mt-2 flex items-start gap-2 font-body text-sm text-muted-foreground" data-stores>
      <i aria-hidden className="bx bx-store-alt mt-0.5 text-lg text-foreground/70" />
      <span>
        {stores.length === 1 ? (
          <>
            Ships from <strong className="font-semibold text-foreground">{names[0]}</strong>
          </>
        ) : (
          <>
            Ships from the nearest of our stores: <strong className="font-semibold text-foreground">{nameList(names)}</strong>
          </>
        )}
      </span>
    </p>
  );
}
