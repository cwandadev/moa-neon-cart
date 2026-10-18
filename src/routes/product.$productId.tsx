import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckoutDialog } from "@/components/shop/CheckoutDialog";
import { Header } from "@/components/shop/Header";
import { Button } from "@/components/ui/button";
import { fetchProduct } from "@/lib/catalog";
import { money, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { OptionGroup } from "@/components/shop/OptionPicker";
import { findVariant, lineProductFor, optionValues, variantLabel } from "@/lib/variants";
import { cn } from "@/lib/utils";

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
        <main className="mx-auto w-full max-w-7xl px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl font-bold">Product not found</h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">
            This product does not exist or was removed.
          </p>
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

function ProductView({ product }: { product: Product }) {
  const { addToCart, toggleWishlist, isWished, setCartOpen, setChatOpen } = useStore();
  const variants = product.variants ?? [];
  const name1 = product.optionNames?.[0] ?? "";
  const name2 = product.optionNames?.[1] ?? "";
  const hasOptions = variants.length > 0 && name1 !== "";
  const values1 = optionValues(variants, 1);
  const values2 = name2 ? optionValues(variants, 2) : [];

  const [sel1, setSel1] = useState(values1.length === 1 ? (values1[0] ?? "") : "");
  const [sel2, setSel2] = useState(values2.length === 1 ? (values2[0] ?? "") : "");
  const [qty, setQty] = useState(1);
  const [showError, setShowError] = useState(false);
  const [active, setActive] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(true);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLDivElement | null>(null);

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
  }, [maxQty]);

  const images = useMemo(() => {
    const extra = variants.map((v) => v.image).filter((u): u is string => Boolean(u) && !product.images.includes(u as string));
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
  }, [selected?.id]);

  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setCtaVisible(Boolean(entries[0]?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const needChoice = () => {
    setShowError(true);
    optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const lineProduct = () => lineProductFor(product, selected);

  const add = () => {
    if (!complete) return needChoice();
    if (soldOut) return;
    addToCart(lineProduct(), qty);
    setCartOpen(true);
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

  const wished = isWished(product.id);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 pb-40 pt-5 sm:px-6 md:pb-16">
        <nav className="mb-4 font-body text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            Shop
          </Link>
          <span className="mx-1.5">/</span>
          <span>{String(product.category)}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <div className="relative">
              <div
                ref={trackRef}
                onScroll={onScroll}
                className="flex snap-x snap-mandatory overflow-x-auto rounded-3xl bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {images.map((u, i) => (
                  <img
                    key={u}
                    src={u}
                    alt={i === 0 ? product.name : ""}
                    loading={i === 0 ? "eager" : "lazy"}
                    className="aspect-[4/5] w-full shrink-0 snap-center object-cover md:aspect-square"
                  />
                ))}
              </div>
              {discount > 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-destructive px-2.5 py-1 font-body text-xs font-semibold text-white">
                  -{discount}%
                </span>
              )}
              {totalStock <= 0 && (
                <span className="absolute right-3 top-3 rounded-full bg-background/90 px-3 py-1 font-body text-xs font-semibold text-destructive">
                  Sold out
                </span>
              )}
              {images.length > 1 && (
                <>
                  <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-background/70 px-2.5 py-1.5">
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
            {images.length > 1 && (
              <div className="mt-4 hidden gap-3 md:flex">
                {images.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    aria-label={`Show photo ${i + 1}`}
                    onClick={() => scrollToImage(i)}
                    className={cn(
                      "size-20 overflow-hidden rounded-xl border-2 transition-colors",
                      i === active ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <img src={u} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="font-body text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {String(product.category)}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold leading-tight sm:text-3xl">{product.name}</h1>
            {product.blurb && <p className="mt-2 font-body text-sm text-muted-foreground">{product.blurb}</p>}

            <div className="mt-4 flex flex-wrap items-baseline gap-3">
              <span className="font-display text-3xl font-semibold">{money(price)}</span>
              {showOld && product.oldPrice && (
                <span className="font-body text-base text-muted-foreground line-through">{money(product.oldPrice)}</span>
              )}
            </div>
            <p className={cn("mt-1.5 flex items-center gap-2 font-body text-sm", status.cls)}>
              <span className="size-2 rounded-full bg-current" />
              {status.text}
            </p>

            {hasOptions && (
              <div ref={optionsRef} className="mt-6 grid gap-5">
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

            <div ref={ctaRef} className="mt-6 grid gap-3">
              <div className="flex gap-3">
                <div className="flex h-12 items-center rounded-xl border border-border">
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
                  className="h-12 flex-1 rounded-xl text-base"
                  disabled={soldOut && complete}
                  onClick={add}
                >
                  {soldOut && complete ? "Sold out" : "Add to cart"}
                </Button>
                <button
                  type="button"
                  aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
                  onClick={() => toggleWishlist(product.id)}
                  className={cn(
                    "grid size-12 shrink-0 place-items-center rounded-xl border border-border transition-colors",
                    wished ? "text-accent" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <i className={cn("text-2xl", wished ? "bx bxs-heart" : "bx bx-heart")} />
                </button>
              </div>
              <Button
                variant="glass"
                size="lg"
                className="h-12 rounded-xl"
                disabled={soldOut && complete}
                onClick={buyNow}
              >
                Buy now
              </Button>
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="py-1 text-center font-body text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                Have a question? Chat with us
              </button>
            </div>

            <div className="mt-8 border-t border-border">
              {product.description && (
                <Accordion title="Description" defaultOpen>
                  <p className="whitespace-pre-line">{product.description}</p>
                </Accordion>
              )}
              <Accordion title="Specifications" defaultOpen>
                <dl className="grid divide-y divide-border">
                  {specRows.map((r) => (
                    <div key={r.label} className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                      <dt>{r.label}</dt>
                      <dd className="text-right text-foreground">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </Accordion>
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
      </main>

      {!ctaVisible && (
        <div className="fixed inset-x-3 bottom-[5.25rem] z-30 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_20px_50px_-20px_black] md:hidden">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold leading-tight text-primary">{money(price)}</p>
            <p className="truncate font-body text-[11px] text-muted-foreground">
              {selected ? variantLabel(selected) : product.name}
            </p>
          </div>
          <Button
            variant="neon"
            className="h-11 shrink-0 rounded-xl px-5"
            disabled={soldOut && complete}
            onClick={add}
          >
            {soldOut && complete ? "Sold out" : complete ? "Add to cart" : missingText || "Choose options"}
          </Button>
        </div>
      )}

      <CheckoutDialog open={checkout} onOpenChange={setCheckout} items={[{ product: lineProduct(), qty }]} buyNow />
    </div>
  );
}
