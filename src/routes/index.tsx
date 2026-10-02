import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Header } from "@/components/shop/Header";
import { FilterBar, defaultFilters, type Filters } from "@/components/shop/FilterBar";
import { ProductCard } from "@/components/shop/ProductCard";
import { PRODUCTS, smartFeed } from "@/lib/products";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MOA Mart — Futuristic Online Store" },
      {
        name: "description",
        content:
          "Shop clothing, shoes, kitchen, lighting, electronics, tech gadgets, toys and art at MOA Mart. Order instantly over WhatsApp.",
      },
      { property: "og:title", content: "MOA Mart — Futuristic Online Store" },
      {
        property: "og:description",
        content: "A neon-minimal catalog with smart product feed and instant WhatsApp checkout.",
      },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [visible, setVisible] = useState(12);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = PRODUCTS.filter((p) => {
      if (q && !`${p.name} ${p.category} ${p.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      if (filters.categories.length && !filters.categories.includes(p.category)) return false;
      if (p.price < filters.price[0] || p.price > filters.price[1]) return false;
      if (filters.inStockOnly && !p.inStock) return false;
      if (p.rating < filters.minRating) return false;
      return true;
    });

    switch (filters.sort) {
      case "new":
        list = [...list].sort((a, b) => a.createdDaysAgo - b.createdDaysAgo);
        break;
      case "price-asc":
        list = [...list].sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list = [...list].sort((a, b) => b.price - a.price);
        break;
      case "rating":
        list = [...list].sort((a, b) => b.rating - a.rating);
        break;
      default:
        list = smartFeed(list);
    }
    return list;
  }, [query, filters]);

  return (
    <div className="min-h-screen bg-background">
      <Header query={query} onQueryChange={setQuery} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card/50 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
          <p className="font-body text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Curated · Neon · Everyday
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-5xl">
            Everything you need, <span className="text-gradient">delivered by chat</span>
          </h1>
          <p className="mt-4 max-w-xl font-body text-sm text-muted-foreground sm:text-base">
            Browse a smart feed that surfaces hot picks first, fresh arrivals next, and personal
            recommendations after. Checkout happens on WhatsApp in seconds.
          </p>
        </section>

        <div className="mt-8">
          <FilterBar
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            filters={filters}
            onChange={setFilters}
            resultCount={results.length}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.slice(0, visible).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>

        {results.length > visible && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setVisible((v) => v + 12)}
              className="rounded-full border border-border bg-card px-6 py-2.5 font-body text-sm font-medium hover:border-primary/50 hover:text-primary"
            >
              Load more
            </button>
          </div>
        )}

        {results.length === 0 && (
          <p className="py-24 text-center font-body text-sm text-muted-foreground">
            No products match your filters yet.
          </p>
        )}
      </main>
    </div>
  );
}
