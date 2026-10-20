import { createFileRoute } from "@tanstack/react-router";
import { categoryPath } from "@/lib/categories";
import { CATEGORIES } from "@/lib/products";
import { absoluteUrl } from "@/lib/site";
import { supabase } from "@/lib/supabase";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const PAGES: { path: string; priority: string }[] = [
  { path: "/", priority: "1.0" },
  { path: "/contact", priority: "0.4" },
  { path: "/delivery", priority: "0.4" },
  { path: "/returns", priority: "0.4" },
  { path: "/privacy-policy", priority: "0.3" },
  { path: "/terms", priority: "0.3" },
];

type P = { id: string; updated_at?: string | null };

async function products(): Promise<P[]> {
  try {
    const withDates = await supabase.from("products").select("id, updated_at").is("archived_at", null).range(0, 4999);
    if (!withDates.error) return (withDates.data ?? []) as unknown as P[];
    // No "updated_at" column: the list of products is still enough.
    const idsOnly = await supabase.from("products").select("id").is("archived_at", null).range(0, 4999);
    return (idsOnly.data ?? []) as unknown as P[];
  } catch {
    return [];
  }
}

async function categoryNames(): Promise<string[]> {
  try {
    const { data, error } = await supabase.from("categories").select("name").order("sort_order", { ascending: true });
    if (!error && data && data.length > 0) return data.map((c: { name: string }) => c.name);
  } catch {
    /* use the built-in list */
  }
  return [...CATEGORIES];
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [list, cats] = await Promise.all([products(), categoryNames()]);
        const rows = [
          ...PAGES.map((p) => `<url><loc>${esc(absoluteUrl(p.path))}</loc><priority>${p.priority}</priority></url>`),
          ...cats.map((c) => `<url><loc>${esc(absoluteUrl(categoryPath(c)))}</loc><priority>0.9</priority></url>`),
          ...list.map((p) => {
            const last = p.updated_at ? new Date(p.updated_at) : null;
            const lastmod = last && !Number.isNaN(last.getTime()) ? `<lastmod>${last.toISOString().slice(0, 10)}</lastmod>` : "";
            return `<url><loc>${esc(absoluteUrl(`/product/${p.id}`))}</loc>${lastmod}<priority>0.8</priority></url>`;
          }),
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
        });
      },
    },
  },
});
