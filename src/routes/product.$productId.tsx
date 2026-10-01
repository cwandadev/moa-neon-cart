import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Header } from "@/components/shop/Header";
import { StockBadge } from "@/components/shop/ProductCard";
import { CheckoutDialog } from "@/components/shop/CheckoutDialog";
import { getProduct, money } from "@/lib/products";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/product/$productId")({
  loader: ({ params }) => {
    const product = getProduct(params.productId);
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Product unavailable — MOA Mart" }, { name: "robots", content: "noindex" }] };
    }
    const { product } = loaderData;
    const title = `${product.name} — MOA Mart`;
    return {
      meta: [
        { title },
        { name: "description", content: product.blurb },
        { property: "og:title", content: title },
        { property: "og:description", content: product.blurb },
      ],
    };
  },
  component: ProductDetail,
});

function ProductDetail() {
  const { product } = Route.useLoaderData();
  const { addToCart, toggleWishlist, isWished, setCartOpen } = useStore();
  const [active, setActive] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const wished = isWished(product.id);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <nav className="flex items-center gap-2 font-body text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Catalog
          </Link>
          <i className="bx bx-chevron-right" />
          <span>{product.category}</span>
          <i className="bx bx-chevron-right" />
          <span className="truncate text-foreground">{product.name}</span>
        </nav>

        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <div>
            <div className="relative aspect-square overflow-hidden rounded-3xl border border-border bg-muted">
              <img
                src={product.images[active]}
                alt={`${product.name} view ${active + 1}`}
                className="h-full w-full object-cover"
              />
              {product.videoPreview && (
                <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 font-body text-xs backdrop-blur">
                  <i className="bx bx-play-circle text-lg text-primary" /> Video preview
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-3 overflow-x-auto">
              {product.images.map((img, i) => (
                <button
                  key={img}
                  onClick={() => setActive(i)}
                  className={cn(
                    "h-20 w-20 shrink-0 overflow-hidden rounded-xl border transition-colors",
                    i === active ? "border-primary" : "border-border opacity-70 hover:opacity-100",
                  )}
                >
                  <img src={img} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="font-body text-xs uppercase tracking-[0.25em] text-muted-foreground">
              {product.category}
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold sm:text-4xl">{product.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StockBadge product={product} />
              <span className="flex items-center gap-1 font-body text-sm text-muted-foreground">
                <i className="bx bxs-star text-chart-3" /> {product.rating} · {product.reviews} reviews
              </span>
            </div>

            <div className="mt-5 flex items-end gap-3">
              <p className="font-display text-3xl font-bold">{money(product.price)}</p>
              {product.oldPrice && (
                <p className="font-body text-sm text-muted-foreground line-through">
                  {money(product.oldPrice)}
                </p>
              )}
            </div>

            <p className="mt-4 font-body text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                variant="whatsapp"
                size="lg"
                className="rounded-xl font-body"
                disabled={!product.inStock}
                onClick={() => setCheckout(true)}
              >
                <i className="bx bxl-whatsapp text-xl" /> Buy now on WhatsApp
              </Button>
              <Button
                variant="neon"
                size="lg"
                className="rounded-xl font-body"
                disabled={!product.inStock}
                onClick={() => {
                  addToCart(product);
                  setCartOpen(true);
                }}
              >
                <i className="bx bx-shopping-bag text-xl" /> Add to cart
              </Button>
              <Button
                variant="glass"
                size="lg"
                className="rounded-xl font-body"
                onClick={() => toggleWishlist(product.id)}
              >
                <i className={cn("text-xl", wished ? "bx bxs-heart text-accent" : "bx bx-heart")} />
                {wished ? "Saved" : "Save"}
              </Button>
            </div>

            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {product.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 font-body text-sm text-muted-foreground">
                  <i className="bx bx-check-circle mt-0.5 text-accent" /> {h}
                </li>
              ))}
            </ul>

            <Accordion type="multiple" className="mt-8">
              <AccordionItem value="specs">
                <AccordionTrigger className="font-display">Specifications</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-2">
                    {product.specs.map((s) => (
                      <div
                        key={s.label}
                        className="flex justify-between gap-4 border-b border-border/60 py-2 font-body text-sm"
                      >
                        <dt className="text-muted-foreground">{s.label}</dt>
                        <dd className="text-right">{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="care">
                <AccordionTrigger className="font-display">Care & handling</AccordionTrigger>
                <AccordionContent className="font-body text-sm text-muted-foreground">
                  {product.care}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="shipping">
                <AccordionTrigger className="font-display">Delivery & shipping</AccordionTrigger>
                <AccordionContent className="font-body text-sm text-muted-foreground">
                  {product.shipping}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="refs">
                <AccordionTrigger className="font-display">Reference links</AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-2">
                    {product.references.map((r) => (
                      <li key={r.url}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-body text-sm text-primary hover:underline"
                        >
                          {r.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </main>

      <CheckoutDialog open={checkout} onOpenChange={setCheckout} items={[{ product, qty: 1 }]} />
    </div>
  );
}
