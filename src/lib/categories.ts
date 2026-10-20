/** Category names turned into web addresses: "Tech Gadgets" becomes /shop/tech-gadgets. */
export const categorySlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The real category name for an address, or null when there is no such category. */
export const categoryFromSlug = (slug: string, names: readonly string[]): string | null =>
  names.find((n) => categorySlug(n) === slug.toLowerCase()) ?? null;

export const categoryPath = (name: string): string => `/shop/${categorySlug(name)}`;

/** A short description for search results. */
export function categoryDescription(name: string, total: number): string {
  const n = name.toLowerCase();
  const lead = total > 0 ? `Browse ${total} ${total === 1 ? "product" : "products"} in ${n}` : `Shop ${n}`;
  return `${lead} at MOA Mart. Pay with MTN MoMo or Airtel Money and get delivery in Kigali.`;
}
