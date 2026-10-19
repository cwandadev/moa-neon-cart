import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/shop/Header";
import { FilterBar, defaultFilters, type Filters } from "@/components/shop/FilterBar";
import { ProductCard } from "@/components/shop/ProductCard";
import { CATEGORIES, type Product } from "@/lib/products";
import { fetchCatalog, fetchCategoryNames, fetchPriceBounds } from "@/lib/catalog";
import { usePersistedState } from "@/lib/persist";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MOA Mart — Futuristic Online Store" },
      {
        name: "description",
        content:
          "Shop clothing, shoes, kitchen, lighting, electronics, tech gadgets, toys and art at MOA Mart.",
      },
      { property: "og:title", content: "MOA Mart — Futuristic Online Store" },
      {
        property: "og:description",
        content: "Clothing, shoes, kitchen, electronics and more, delivered to your door.",
      },
    ],
  }),
  component: Catalog,
});

const roundDown5k = (n: number) => Math.floor(n / 5000) * 5000;
const roundUp5k = (n: number) => Math.ceil(n / 5000) * 5000;

function Catalog() {
  const [query, setQuery] = usePersistedState("moa:home:query", "");
  const [debounced, setDebounced] = usePersistedState("moa:home:debounced", "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = usePersistedState<Filters>("moa:home:filters", defaultFilters);
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(null);
  const [categories, setCategories] = useState<string[]>(CATEGORIES);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Debounce the header search so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Slider bounds come from the highest published price in the database.
  useEffect(() => {
    let cancelled = false;
    fetchPriceBounds()
      .then((b) => {
        if (cancelled) return;
        setBounds(b);
        setFilters((f) => ({ ...f, price: [roundDown5k(b.min), roundUp5k(b.max)] }));
      })
      .catch(() => {
        if (!cancelled) setBounds({ min: 0, max: 2_000_000 });
      });
    fetchCategoryNames()
      .then((c) => {
        if (!cancelled && c.length) setCategories(c);
      })
      .catch(() => {
        /* keep the static fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Server-side search/filter/sort/page 1 (skipped until bounds are known).
  useEffect(() => {
    if (!bounds) return;
    let cancelled = false;
    setLoading(true);
    fetchCatalog({
      search: debounced,
      categories: filters.categories,
      minPrice: filters.price[0],
      maxPrice: filters.price[1],
      inStockOnly: filters.inStockOnly,
      minRating: filters.minRating,
      sort: filters.sort,
      limit: 12,
      offset: 0,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Catalog query failed:", err);
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, filters, bounds]);

  const maxPrice = useMemo(() => (bounds ? roundUp5k(bounds.max) : 2_000_000), [bounds]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchCatalog({
        search: debounced,
        categories: filters.categories,
        minPrice: filters.price[0],
        maxPrice: filters.price[1],
        inStockOnly: filters.inStockOnly,
        minRating: filters.minRating,
        sort: filters.sort,
        limit: 12,
        offset: items.length,
      });
      setItems((prev) => [...prev, ...r.items]);
      setTotal(r.total);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header query={query} onQueryChange={setQuery} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card/50 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
          <p className="font-body text-xs uppercase tracking-[0.3em] text-muted-foreground">
            New arrivals · Everyday essentials
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-5xl">
            Everything you need, <span className="text-gradient">delivered to your door</span>
          </h1>
          <p className="mt-4 max-w-xl font-body text-sm text-muted-foreground sm:text-base">
            Shop clothing, shoes, kitchen, lighting, electronics and more. Add what you like to your cart,
            check out in seconds, and we bring it to you.
          </p>
        </section>

        <div className="mt-8">
          <FilterBar
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            filters={filters}
            onChange={setFilters}
            resultCount={total}
            maxPrice={maxPrice}
            categories={categories}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>

        {items.length < total && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-full border border-border bg-card px-6 py-2.5 font-body text-sm font-medium hover:border-primary/50 hover:text-primary disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}

        {!loading && items.length === 0 && (
          <p className="py-24 text-center font-body text-sm text-muted-foreground">
            No products match your filters yet.
          </p>
        )}
      </main>
    </div>
  );
}


