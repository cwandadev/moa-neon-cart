import { createFileRoute, notFound } from "@tanstack/react-router";
import { CategoryView } from "@/components/shop/CategoryView";
import { fetchCatalog, fetchCategoryNames } from "@/lib/catalog";
import { categoryDescription, categoryFromSlug, categoryPath } from "@/lib/categories";
import { CATEGORIES, type Category } from "@/lib/products";
import { breadcrumbLd, jsonLd, seoMeta } from "@/lib/seo";

export const Route = createFileRoute("/shop/$category")({
  loader: async ({ params }) => {
    const names = await fetchCategoryNames().catch(() => [...CATEGORIES] as string[]);
    const name = categoryFromSlug(params.category, names);
    if (!name) throw notFound();
    const first = await fetchCatalog({
      search: "",
      categories: [name as Category],
      minPrice: 0,
      maxPrice: 0,
      inStockOnly: false,
      minRating: 0,
      sort: "smart",
      limit: 12,
      offset: 0,
    });
    return { name, names, items: first.items, total: first.total };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Category — MOA Mart" }, { name: "robots", content: "noindex" }] };
    const { name, total, items } = loaderData;
    const path = categoryPath(name);
    return {
      ...seoMeta({
        title: `${name} in Kigali — MOA Mart`,
        description: categoryDescription(name, total),
        path,
        image: items[0]?.images[0],
        // A category with nothing in it should not be listed by search engines.
        ...(total === 0 ? { noindex: true } : {}),
      }),
      scripts: [
        jsonLd(
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name, path },
          ]),
        ),
      ],
    };
  },
  component: CategoryPage,
});

function CategoryPage() {
  const { name, names, items, total } = Route.useLoaderData();
  // One instance per category, so filters and results never carry over from another category.
  return <CategoryView key={name} name={name} names={names} initialItems={items} initialTotal={total} />;
}
