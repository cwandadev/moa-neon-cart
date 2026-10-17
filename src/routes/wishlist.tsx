import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/shop/Header";
import { ProductCard } from "@/components/shop/ProductCard";
import { useAuth } from "@/lib/auth";
import { rowToProduct, type ProductRow } from "@/lib/catalog";
import { type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/wishlist")({
  head: () => ({ meta: [{ title: "Wishlist — MOA Mart" }] }),
  component: Wishlist,
});

function Wishlist() {
  const { user, ready } = useAuth();
  const { wishlist } = useStore();
  const navigate = useNavigate();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const key = wishlist.join(",");

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login" });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (!user) return;
    if (wishlist.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("products")
          .select("*, category:categories(name)")
          .in("id", wishlist)
          .is("archived_at", null);
        if (cancelled) return;
        const rows = (data ?? []) as unknown as (ProductRow & { category: { name: string } | null })[];
        setItems(
          rows.map((r) =>
            rowToProduct({ ...r, ...(r.category?.name ? { category_name: r.category.name } : {}) }),
          ),
        );
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, key]);

  if (!ready || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">My Wishlist</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">{wishlist.length} saved</p>
        {!loading && items.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-body text-sm text-muted-foreground">
              Nothing saved yet. Tap the heart on any product to save it here.
            </p>
            <Link to="/" className="mt-4 inline-block font-body text-sm text-primary hover:underline">
              Browse the catalog
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
