import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckoutDialog } from "@/components/shop/CheckoutDialog";
import { Header } from "@/components/shop/Header";
import { OptionGroup } from "@/components/shop/OptionPicker";
import { ProductCard } from "@/components/shop/ProductCard";
import { Button } from "@/components/ui/button";
import { fetchProduct, rowToProduct, type ProductRow } from "@/lib/catalog";
import { usePersistedState } from "@/lib/persist";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { findVariant, lineProductFor, optionValues, variantLabel } from "@/lib/variants";

export const Route = createFileRoute("/product/$productId")({
  loader: ({ params }) => fetchProduct(params.productId).then((product) => ({ product })),
  head: ({ loaderData }) => {
    const product = loaderData?.product;
    if (!product) {
      return { meta: [{ title: "Product — MOA Mart" }, { name: "robots", content: "noindex" }] };
    }
    const title = `${product.name} — MOA Mart`;
    return {
      meta: [
        { title },
        { name: "description", content: product.blurb },
        { property: "og:title", content: title },
        { property: "og:description", content: product.blurb },
        { property: "og:image", content: product.images[0] ?? "" },
      ],
    };
  },
  component: ProductDetail,
});

function ProductDetail() {
  const { product } = Route.useLoaderData();

  if (!product) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl font-bold">Product not found</h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">This product does not exist or was removed.</p>
          <Link to="/" className="mt-6 inline-block font-body text-sm text-primary hover:underline">
            Back to the shop
          </Link>
        </main>
      </div>
    );
  }
  return <ProductView key={product.id} product={product} />;
}

const uniq = (list: (string | null | undefined)[]) => {
  const out: string[] = [];
  for (const v of list) if (v && !out.includes(v)) out.push(v);
  return out;
};

function Accordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-4 text-left font-display text-sm font-semibold"
      >
        <span>{title}</span>
        <i className={cn("bx text-xl text-muted-foreground", open ? "bx-chevron-up" : "bx-chevron-down")} />
      </button>
      {open && <div className="pb-4 font-body text-sm leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <div className="mt-3 font-body text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function ProductView({ product }: { product: Product }) {
  const { addToCart, toggleWishlist, isWished, setCartOpen, setChatOpen } = useStore();
  const variants = product.variants ?? [];
  const name1 = product.optionNames?.[0] ?? "";
  const name2 = product.optionNames?.[1] ?? "";
  const hasOptions = variants.length > 0 && name1 !== "";
  const values1 = optionValues(variants, 1);
  const values2 = name2 ? optionValues(variants, 2) : [];

  const [sel1, setSel1] = usePersistedState(
    `moa:pp:${product.id}:sel1`,
    values1.length === 1 ? (values1[0] ?? "") : "",
  );
  const [sel2, setSel2] = usePersistedState(
    `moa:pp:${product.id}:sel2`,
    values2.length === 1 ? (values2[0] ?? "") : "",
  );
  const [qty, setQty] = usePersistedState(`moa:pp:${product.id}:qty`, 1);
  const [checkout, setCheckout] = usePersistedState(`moa:pp:${product.id}:checkout`, false);
  const [showError, setShowError] = useState(false);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);
  const [related, setRelated] = useState<Product[]>([]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);

  const complete = !hasOptions || (sel1 !== "" && (values2.length === 0 || sel2 !== ""));
  const selected = hasOptions ? findVariant(variants, sel1, sel2, values2.length > 0) : null;
  const missingText = !hasOptions
    ? ""
    : sel1 === ""
      ? `Select ${name1.toLowerCase()}`
      : values2.length > 0 && sel2 === ""
        ? `Select ${name2.toLowerCase()}`
        : "";

  const totalStock = product.stock;
  const unitStock = hasOptions ? (selected?.stock ?? null) : product.stock;
  const soldOut = hasOptions ? (selected ? selected.stock <= 0 : totalStock <= 0) : product.stock <= 0;
  const price = selected?.price ?? product.price;
  const showOld = Boolean(product.oldPrice && product.oldPrice > price && !selected?.price);
  const discount = showOld && product.oldPrice ? Math.round((1 - price / product.oldPrice) * 100) : 0;
  const maxQty = Math.max(1, Math.min(10, unitStock ?? 10));

  useEffect(() => {
    setQty((q) => Math.min(q, maxQty));
  }, [maxQty, setQty]);

  const images = useMemo(() => {
    const extra = variants
      .map((v) => v.image)
      .filter((u): u is string => Boolean(u) && !product.images.includes(u as string));
    return uniq([...product.images, ...extra]);
  }, [product.images, variants]);

  const scrollToImage = (i: number) => {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = trackRef.current;
    if (el && el.clientWidth > 0) setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  useEffect(() => {
    if (!selected?.image) return;
    const i = images.indexOf(selected.image);
    if (i >= 0) scrollToImage(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // More from the same category, shown under the product.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("products")
          .select("*, category:categories!inner(name), product_variants(*)")
          .eq("category.name", String(product.category))
          .neq("id", product.id)
          .is("archived_at", null)
          .gt("stock", 0)
          .limit(8);
        if (cancelled || !data) return;
        const rows = data as unknown as (ProductRow & { category: { name: string } | null })[];
        setRelated(
          rows
            .map((r) => rowToProduct({ ...r, ...(r.category?.name ? { category_name: r.category.name } : {}) }))
            .slice(0, 4),
        );
      } catch {
        /* no related row */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id, product.category]);

  const needChoice = () => {
    setShowError(true);
    optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const lineProduct = () => lineProductFor(product, selected);

  const add = () => {
    if (!complete) return needChoice();
    if (soldOut) return;
    addToCart(lineProduct(), qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
    toast.success("Added to cart", {
      description: product.name + (selected ? ` · ${variantLabel(selected)}` : ""),
      action: { label: "View cart", onClick: () => setCartOpen(true) },
    });
  };

  const buyNow = () => {
    if (!complete) return needChoice();
    if (soldOut) return;
    setCheckout(true);
  };

  const status = (() => {
    if (hasOptions && !selected) {
      return totalStock > 0
        ? { text: "Choose your options", cls: "text-muted-foreground" }
        : { text: "Out of stock", cls: "text-destructive" };
    }
    const n = hasOptions ? (selected?.stock ?? 0) : product.stock;
    if (n <= 0) return { text: hasOptions ? "This option is sold out" : "Out of stock", cls: "text-destructive" };
    if (n <= 3) return { text: `Only ${n} left`, cls: "text-warning" };
    return { text: "In stock", cls: "text-success" };
  })();

  const specRows = [
    { label: "SKU", value: selected?.sku || product.sku || "" },
    { label: "Category", value: String(product.category) },
    ...product.specs.filter((s) => !/^(sku|category)$/i.test(s.label)),
  ].filter((r) => r.value);

  const specList = (
    <dl className="grid divide-y divide-border">
      {specRows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt>{r.label}</dt>
          <dd className="text-right text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );

  const wished = isWished(product.id);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-3 sm:px-6 md:pb-16 md:pt-5">
        <nav className="mb-3 font-body text-xs text-muted-foreground md:mb-5">
          <Link to="/" className="hover:text-primary">
            Shop
          </Link>
          <span className="mx-1.5">/</span>
          <span>{String(product.category)}</span>
          <span className="mx-1.5">/</span>
          <span className="text-foreground/80">{product.name}</span>
        </nav>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10 lg:gap-14">
          {/* Gallery: thumbnails on the left on desktop, swipe on phones */}
          <div className="md:flex md:items-start md:gap-3">
            {images.length > 1 && (
              <div className="hidden max-h-[34rem] shrink-0 flex-col gap-2.5 overflow-y-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {images.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    aria-label={`Show photo ${i + 1}`}
                    onClick={() => scrollToImage(i)}
                    className={cn(
                      "size-16 overflow-hidden rounded-xl border-2 transition-colors",
                      i === active ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <img src={u} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="relative min-w-0 flex-1">
              <div
                ref={trackRef}
                onScroll={onScroll}
                className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl bg-muted md:rounded-3xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {images.map((u, i) => (
                  <img
                    key={u}
                    src={u}
                    alt={i === 0 ? product.name : ""}
                    loading={i === 0 ? "eager" : "lazy"}
                    className="aspect-square max-h-[52svh] w-full shrink-0 snap-center object-cover md:max-h-[min(70vh,600px)]"
                  />
                ))}
              </div>
              {discount > 0 && totalStock > 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-destructive px-2.5 py-1 font-body text-xs font-semibold text-white">
                  -{discount}%
                </span>
              )}
              {totalStock <= 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 font-body text-xs font-semibold text-destructive">
                  Sold out
                </span>
              )}
              <button
                type="button"
                aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
                onClick={() => toggleWishlist(product.id)}
                className={cn(
                  "absolute right-3 top-3 grid size-10 place-items-center rounded-full border border-border bg-background/90 md:hidden",
                  wished ? "text-accent" : "text-muted-foreground",
                )}
              >
                <i className={cn("text-2xl", wished ? "bx bxs-heart" : "bx bx-heart")} />
              </button>
              {images.length > 1 && (
                <>
                  <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-background/70 px-2.5 py-1.5 md:hidden">
                    {images.map((u, i) => (
                      <span
                        key={u}
                        className={cn("size-1.5 rounded-full", i === active ? "bg-primary" : "bg-foreground/40")}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Previous photo"
                    onClick={() => scrollToImage(Math.max(0, active - 1))}
                    className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/90 md:grid"
                  >
                    <i className="bx bx-chevron-left text-2xl" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next photo"
                    onClick={() => scrollToImage(Math.min(images.length - 1, active + 1))}
                    className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/90 md:grid"
                  >
                    <i className="bx bx-chevron-right text-2xl" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Buy box: stays in view on desktop while the page scrolls */}
          <div className="md:sticky md:top-28 md:self-start">
            <p className="font-body text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {String(product.category)}
            </p>
            <h1 className="mt-1 font-display text-xl font-semibold leading-tight md:text-2xl lg:text-[1.75rem]">
              {product.name}
            </h1>
            {product.blurb && <p className="mt-2 font-body text-sm text-muted-foreground">{product.blurb}</p>}

            <div className="mt-4 flex flex-wrap items-baseline gap-3">
              <span className="font-display text-2xl font-semibold md:text-[1.75rem]">{money(price)}</span>
              {showOld && product.oldPrice && (
                <span className="font-body text-base text-muted-foreground line-through">{money(product.oldPrice)}</span>
              )}
            </div>
            <p className={cn("mt-1.5 flex items-center gap-2 font-body text-sm", status.cls)}>
              <span className="size-2 rounded-full bg-current" />
              {status.text}
            </p>

            {hasOptions && (
              <div ref={optionsRef} className="mt-5 grid gap-4 md:mt-6 md:gap-5">
                <OptionGroup
                  name={name1}
                  which={1}
                  values={values1}
                  selected={sel1}
                  otherSelected={sel2}
                  variants={variants}
                  onSelect={(v) => {
                    setSel1(v);
                    setShowError(false);
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
                      setShowError(false);
                    }}
                  />
                )}
                {showError && missingText && <p className="font-body text-sm text-destructive">{missingText}</p>}
                {complete && !selected && (
                  <p className="font-body text-sm text-destructive">That combination is not available.</p>
                )}
              </div>
            )}

            <div className="mt-5 grid gap-2.5 md:mt-6 md:gap-3">
              <div className="flex gap-3">
                <div className="flex h-11 items-center rounded-xl border border-border md:h-12">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={qty <= 1}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="grid size-11 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <i className="bx bx-minus" />
                  </button>
                  <span className="w-8 text-center font-body text-sm">{qty}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={qty >= maxQty}
                    onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                    className="grid size-11 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <i className="bx bx-plus" />
                  </button>
                </div>
                <Button
                  variant="neon"
                  size="lg"
                  className="h-11 flex-1 rounded-xl text-base md:h-12"
                  disabled={soldOut && complete}
                  onClick={add}
                >
                  {soldOut && complete ? (
                    "Sold out"
                  ) : added ? (
                    <>
                      <i className="bx bx-check text-xl" /> Added
                    </>
                  ) : (
                    "Add to cart"
                  )}
                </Button>
                <button
                  type="button"
                  aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
                  onClick={() => toggleWishlist(product.id)}
                  className={cn(
                    "hidden size-12 shrink-0 place-items-center rounded-xl border border-border transition-colors md:grid",
                    wished ? "text-accent" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <i className={cn("text-2xl", wished ? "bx bxs-heart" : "bx bx-heart")} />
                </button>
              </div>
              <Button
                variant="glass"
                size="lg"
                className="h-11 rounded-xl md:h-12"
                disabled={soldOut && complete}
                onClick={buyNow}
              >
                Buy now
              </Button>
            </div>

            <ul className="mt-5 grid gap-2.5 border-t border-border pt-4 font-body text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <i className="bx bx-package text-lg text-foreground/70" /> Delivery is confirmed after you order
              </li>
              <li className="flex items-center gap-2.5">
                <i className="bx bx-mobile-alt text-lg text-foreground/70" /> Pay with MTN MoMo or Airtel Money
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="flex items-center gap-2.5 text-left transition-colors hover:text-primary"
                >
                  <i className="bx bx-message-dots text-lg text-foreground/70" /> Have a question? Chat with us
                </button>
              </li>
            </ul>

            {/* Phones: collapsible sections under the buy box */}
            <div className="mt-6 border-t border-border md:hidden">
              {product.description && (
                <Accordion title="Description" defaultOpen>
                  <p className="whitespace-pre-line">{product.description}</p>
                </Accordion>
              )}
              <Accordion title="Specifications">{specList}</Accordion>
              {product.care && (
                <Accordion title="Care & handling">
                  <p className="whitespace-pre-line">{product.care}</p>
                </Accordion>
              )}
              {product.shipping && (
                <Accordion title="Delivery & shipping">
                  <p className="whitespace-pre-line">{product.shipping}</p>
                </Accordion>
              )}
            </div>
          </div>
        </div>

        {/* Desktop: the details are always visible, in two columns */}
        <div className="mt-12 hidden gap-x-14 gap-y-8 border-t border-border pt-10 md:grid md:grid-cols-2">
          <div className="grid content-start gap-8">
            {product.description && (
              <DetailBlock title="Description">
                <p className="whitespace-pre-line">{product.description}</p>
              </DetailBlock>
            )}
            {product.care && (
              <DetailBlock title="Care & handling">
                <p className="whitespace-pre-line">{product.care}</p>
              </DetailBlock>
            )}
          </div>
          <div className="grid content-start gap-8">
            <DetailBlock title="Specifications">{specList}</DetailBlock>
            {product.shipping && (
              <DetailBlock title="Delivery & shipping">
                <p className="whitespace-pre-line">{product.shipping}</p>
              </DetailBlock>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-12 border-t border-border pt-8 md:mt-14 md:pt-10">
            <h2 className="font-display text-lg font-semibold md:text-xl">You may also like</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 md:mt-5 md:grid-cols-4 md:gap-5">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </main>

      <CheckoutDialog open={checkout} onOpenChange={setCheckout} items={[{ product: lineProduct(), qty }]} buyNow />
    </div>
  );
}
