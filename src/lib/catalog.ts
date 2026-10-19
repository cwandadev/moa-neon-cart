import { supabase } from "./supabase";
import { type Category, type Product, type ProductVariant } from "./products";

type VariantRow = {
  id: string;
  sku: string | null;
  option1: string | null;
  option2: string | null;
  price: number | null;
  stock: number;
  image: string | null;
  swatch: string | null;
  position: number;
};

/** One row shape returned by catalog_products / product selects. */
export type ProductRow = {
  id: string;
  name: string;
  category_id: string;
  category_name?: string;
  price: number;
  old_price: number | null;
  sku?: string;
  stock: number;
  images: string[];
  blurb: string;
  description: string;
  specs: { label: string; value: string }[];
  highlights: string[];
  care: string;
  shipping: string;
  reference_links: { label: string; url: string }[];
  tags: string[];
  rating: number;
  reviews: number;
  video_preview: boolean;
  archived_at: string | null;
  created_at: string;
  wishlist_count?: number;
  order_count?: number;
  option1_name?: string | null;
  option2_name?: string | null;
  product_variants?: VariantRow[] | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function rowToProduct(row: ProductRow): Product {
  const created = new Date(row.created_at).getTime();
  const createdDaysAgo = Math.max(0, Math.floor((Date.now() - created) / DAY_MS));
  const variants: ProductVariant[] = [...(row.product_variants ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    name: row.name,
    category: (row.category_name ?? row.category_id) as Category,
    price: row.price,
    oldPrice: row.old_price ?? undefined,
    rating: row.rating,
    reviews: row.reviews,
    stock: row.stock,
    inStock: row.stock > 0,
    images: row.images,
    videoPreview: row.video_preview,
    blurb: row.blurb,
    description: row.description,
    specs: row.specs ?? [],
    highlights: row.highlights ?? [],
    care: row.care,
    shipping: row.shipping,
    references: row.reference_links ?? [],
    clicks: 0,
    wishlists: row.wishlist_count ?? 0,
    orders: row.order_count ?? 0,
    createdDaysAgo,
    tags: row.tags ?? [],
    optionNames: [row.option1_name, row.option2_name].filter((n): n is string => Boolean(n)),
    variants,
    ...(row.sku ? { sku: row.sku } : {}),
  };
}

export type CatalogQuery = {
  search: string;
  categories: string[];
  minPrice: number;
  maxPrice: number;
  inStockOnly: boolean;
  minRating: number;
  sort: "smart" | "new" | "price-asc" | "price-desc" | "rating";
  limit: number;
  offset: number;
};

const DEPTH_PREFIX = "moa:catalog-depth:";
const depthKey = (q: CatalogQuery) =>
  DEPTH_PREFIX +
  JSON.stringify([q.search.trim(), [...q.categories].sort(), q.minPrice, q.maxPrice, q.inStockOnly, q.minRating, q.sort]);
const readDepth = (key: string): number => {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.sessionStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};
const saveDepth = (key: string, n: number) => {
  if (typeof window === "undefined") return;
  try {
    const prev = Number(window.sessionStorage.getItem(key)) || 0;
    window.sessionStorage.setItem(key, String(Math.max(prev, n)));
  } catch {
    /* ignore */
  }
};

export async function fetchCatalog(q: CatalogQuery): Promise<{ items: Product[]; total: number }> {
  const dKey = depthKey(q);
  // The first page loads as many items as were already loaded, so a reload or "back" lands on the same place.
  const limit = q.offset === 0 ? Math.min(60, Math.max(q.limit, readDepth(dKey))) : q.limit;
  const { data, error } = await supabase.rpc("catalog_products", {
    p_search: q.search.trim() || null,
    p_categories: q.categories.length ? q.categories : null,
    p_min_price: q.minPrice > 0 ? q.minPrice : null,
    p_max_price: q.maxPrice > 0 ? q.maxPrice : null,
    p_in_stock: q.inStockOnly,
    p_min_rating: q.minRating > 0 ? q.minRating : null,
    p_sort: q.sort,
    p_limit: limit,
    p_offset: q.offset,
  });
  if (error) throw new Error(error.message);
  const payload = data as { total: number; items: ProductRow[] };
  const items = (payload?.items ?? []).map(rowToProduct);
  saveDepth(dKey, q.offset + items.length);
  return { total: payload?.total ?? 0, items };
}

/** Single published product with its options (works from SSR loader and client navigation). */
export async function fetchProduct(id: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*, category:categories(name), product_variants(*)")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ProductRow & { category: { name: string } | null };
  return rowToProduct({ ...row, ...(row.category?.name ? { category_name: row.category.name } : {}) });
}

/** Category names for the FilterBar chips, in catalog order. */
export async function fetchCategoryNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("name")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: { name: string }) => c.name);
}

/** Lowest/highest published price — feeds the FilterBar slider bounds. */
export async function fetchPriceBounds(): Promise<{ min: number; max: number }> {
  const [lo, hi] = await Promise.all([
    supabase.from("products").select("price").is("archived_at", null).order("price").limit(1),
    supabase.from("products").select("price").is("archived_at", null).order("price", { ascending: false }).limit(1),
  ]);
  if (lo.error) throw new Error(lo.error.message);
  if (hi.error) throw new Error(hi.error.message);
  const min = lo.data?.[0]?.price ?? 0;
  const max = hi.data?.[0]?.price ?? 2_000_000;
  return { min, max };
}
