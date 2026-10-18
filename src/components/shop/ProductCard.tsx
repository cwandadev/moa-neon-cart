import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money, stockLabel, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";

export function StockBadge({ product, className }: { product: Product; className?: string }) {
  const s = stockLabel(product);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-body text-[11px] font-medium",
        s.tone === "in" && "border-accent/40 bg-accent/15 text-accent",
        s.tone === "low" && "border-chart-3/40 bg-chart-3/15 text-chart-3",
        s.tone === "out" && "border-destructive/40 bg-destructive/15 text-destructive",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.text}
    </span>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const { toggleWishlist, isWished, addToCart, setCartOpen } = useStore();
  const navigate = useNavigate();
  const wished = isWished(product.id);
  const [added, setAdded] = useState(false);
  const hasOptions = (product.optionNames?.length ?? 0) > 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_20px_50px_-24px_var(--primary)]">
      <Link
        to="/product/$productId"
        params={{ productId: product.id }}
        className="relative block aspect-[4/5] overflow-hidden bg-muted"
      >
        <img
          src={product.images[0]}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover "
        />
        <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-1 font-body text-[11px] text-muted-foreground">
          {product.category}
        </span>
        {product.createdDaysAgo < 25 && (
          <span className="absolute bottom-3 left-3 rounded-full bg-primary px-2.5 py-1 font-body text-[11px] font-semibold text-primary-foreground">
            New
          </span>
        )}
      </Link>

      <button
        type="button"
        aria-label="Toggle wishlist"
        onClick={() => toggleWishlist(product.id)}
        className={cn(
          "absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-border bg-background/90 transition-colors",
          wished ? "text-accent" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <i className={cn("text-xl", wished ? "bx bxs-heart" : "bx bx-heart")} />
      </button>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/product/$productId"
            params={{ productId: product.id }}
            className="min-w-0 font-display text-sm font-semibold leading-snug hover:text-primary"
          >
            {product.name}
          </Link>
        </div>
        {hasOptions && (
          <p className="-mt-1 font-body text-[11px] text-muted-foreground">{product.optionNames?.join(" · ")}</p>
        )}

        <StockBadge product={product} className="self-start" />

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">{money(product.price)}</p>
            {product.oldPrice && (
              <p className="font-body text-xs text-muted-foreground line-through">
                {money(product.oldPrice)}
              </p>
            )}
          </div>
          {hasOptions ? (
            <Button
              size="icon"
              variant="neon"
              className="rounded-xl"
              disabled={!product.inStock}
              aria-label="Choose options"
              title="Choose options"
              onClick={() => void navigate({ to: "/product/$productId", params: { productId: product.id } })}
            >
              <i className="bx bx-right-arrow-alt text-xl" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="neon"
              className="rounded-xl"
              disabled={!product.inStock}
              aria-label="Add to cart"
              onClick={() => {
                addToCart(product);
                setAdded(true);
                window.setTimeout(() => setAdded(false), 1200);
                toast.success("Added to cart", {
                  description: product.name,
                  action: { label: "View cart", onClick: () => setCartOpen(true) },
                });
              }}
            >
              <i className={cn("text-xl", added ? "bx bx-check" : "bx bx-plus")} />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
