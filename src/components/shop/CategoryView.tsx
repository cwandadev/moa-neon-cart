import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterBar, defaultFilters, type Filters } from "@/components/shop/FilterBar";
import { Header } from "@/components/shop/Header";
import { ProductCard } from "@/components/shop/ProductCard";
import { fetchCatalog, fetchPriceBounds } from "@/lib/catalog";
import { categorySlug } from "@/lib/categories";
import { usePersistedState } from "@/lib/persist";
import type { Category, Product } from "@/lib/products";
import { cn } from "@/lib/utils";

const roundDown5k = (n: number) => Math.floor(n / 5000) * 5000;
const roundUp5k = (n: number) => Math.ceil(n / 5000) * 5000;

const chip = (active: boolean) =>
  cn(
    "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 font-body text-sm transition-colors",
    active
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
  );

/**
 * One category of the shop: the same grid, filters and "Load more" as the home page.
 * The first products come from the server (so search engines see them); the rest is the normal shop.
 */
export function CategoryView({
  name,
  names,
  initialItems,
  initialTotal,
}: {
  name: string;
  names: string[];
  initialItems: Product[];
  initialTotal: number;
}) {
  const scope = `cat-${categorySlug(name)}`;
  const [query, setQuery] = usePersistedState(`moa:${scope}:query`, "");
  const [debounced, setDebounced] = usePersistedState(`moa:${scope}:debounced`, "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = usePersistedState<Filters>(`moa:${scope}:filters`, defaultFilters);
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(null);
  const [items, setItems] = useState<Product[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const firstRun = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query, setDebounced]);

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
    return () => {
      cancelled = true;
    };
  }, [setFilters]);

  const query0 = (f: Filters, search: string, limit: number, offset: number) => ({
    search,
    categories: [name as Category],
    minPrice: f.price[0],
    maxPrice: f.price[1],
    inStockOnly: f.inStockOnly,
    minRating: f.minRating,
    sort: f.sort,
    limit,
    offset,
  });

  // The server already sent the first page for the unfiltered view, so the first run only fetches when something differs.
  useEffect(() => {
    if (!bounds) return;
    const untouched =
      debounced === "" &&
      !filters.inStockOnly &&
      filters.minRating === 0 &&
      filters.sort === "smart" &&
      filters.price[0] <= roundDown5k(bounds.min) &&
      filters.price[1] >= roundUp5k(bounds.max);
    if (untouched && firstRun.current) {
      firstRun.current = false;
      return;
    }
    firstRun.current = false;
    let cancelled = false;
    setLoading(true);
    fetchCatalog(query0(filters, debounced, 12, 0))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, filters, bounds]);

  const maxPrice = useMemo(() => (bounds ? roundUp5k(bounds.max) : 2_000_000), [bounds]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchCatalog(query0(filters, debounced, 12, items.length));
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
        <nav className="font-body text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground/80">{name}</span>
        </nav>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
        <p className="mt-2 font-body text-sm text-muted-foreground">
          {total} {total === 1 ? "product" : "products"} · Pay with MTN MoMo or Airtel Money · Delivery in Kigali
        </p>

        <nav
          aria-label="Categories"
          className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Link to="/" className={chip(false)}>
            All
          </Link>
          {names.map((n) => (
            <Link
              key={n}
              to="/shop/$category"
              params={{ category: categorySlug(n) }}
              aria-current={n === name ? "page" : undefined}
              className={chip(n === name)}
            >
              {n}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          <FilterBar
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            filters={{ ...filters, categories: [name as Category] }}
            onChange={(f) => setFilters({ ...f, categories: [] })}
            resultCount={total}
            maxPrice={maxPrice}
            categories={[name]}
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
