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
  const stock = stockLabel(product);
  const soldOut = !product.inStock;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40 sm:hover:-translate-y-1 sm:hover:shadow-[0_20px_50px_-24px_var(--primary)]">
      <Link
        to="/product/$productId"
        params={{ productId: product.id }}
        className="relative block aspect-square overflow-hidden bg-muted sm:aspect-[4/5]"
      >
        <img
          src={product.images[0]}
          alt={product.name}
          loading="lazy"
          className={cn("h-full w-full object-cover", soldOut && "opacity-60")}
        />
        <span className="absolute left-2 top-2 max-w-[60%] truncate rounded-full bg-background/90 px-2 py-0.5 font-body text-[10px] text-muted-foreground sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
          {product.category}
        </span>
        {product.createdDaysAgo < 25 && !soldOut && (
          <span className="absolute bottom-2 left-2 rounded-full bg-primary px-2 py-0.5 font-body text-[10px] font-semibold text-primary-foreground sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
            New
          </span>
        )}
        {soldOut && (
          <span className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2 py-0.5 font-body text-[10px] font-semibold text-destructive sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
            Sold out
          </span>
        )}
      </Link>

      <button
        type="button"
        aria-label="Toggle wishlist"
        onClick={() => toggleWishlist(product.id)}
        className={cn(
          "absolute right-2 top-2 grid size-8 place-items-center rounded-full border border-border bg-background/90 transition-colors sm:right-3 sm:top-3 sm:size-9",
          wished ? "text-accent" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <i className={cn("text-lg sm:text-xl", wished ? "bx bxs-heart" : "bx bx-heart")} />
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
        <Link
          to="/product/$productId"
          params={{ productId: product.id }}
          className="line-clamp-2 min-h-[2.4rem] font-display text-[13px] font-semibold leading-snug hover:text-primary sm:min-h-0 sm:text-sm"
        >
          {product.name}
        </Link>
        {hasOptions && (
          <p className="-mt-1 truncate font-body text-[11px] text-muted-foreground">{product.optionNames?.join(" · ")}</p>
        )}
        {stock.tone === "low" && <StockBadge product={product} className="self-start px-2 py-0.5 text-[10px]" />}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1 sm:pt-2">
          <div className="min-w-0">
            <p className="font-display text-base font-semibold leading-tight sm:text-lg">{money(product.price)}</p>
            {product.oldPrice && (
              <p className="font-body text-[11px] text-muted-foreground line-through sm:text-xs">
                {money(product.oldPrice)}
              </p>
            )}
          </div>
          {hasOptions ? (
            <Button
              size="icon"
              variant="neon"
              className="size-9 shrink-0 rounded-xl sm:size-10"
              disabled={soldOut}
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
              className="size-9 shrink-0 rounded-xl sm:size-10"
              disabled={soldOut}
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
