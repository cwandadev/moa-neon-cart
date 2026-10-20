import { SITE, absoluteUrl } from "@/lib/site";

type PageSeo = {
  title: string;
  description: string;
  /** The page's own path, for example "/product/orbit-high-top". */
  path: string;
  image?: string | undefined;
  type?: "website" | "product";
  noindex?: boolean;
};

/** Titles, description, the address Google should use, and the cards shown when a link is shared. */
export function seoMeta(p: PageSeo) {
  const url = absoluteUrl(p.path);
  const own = Boolean(p.image);
  const image = p.image ? (p.image.startsWith("http") ? p.image : absoluteUrl(p.image)) : absoluteUrl(SITE.shareImage);
  return {
    meta: [
      { title: p.title },
      { name: "description", content: p.description },
      ...(p.noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
      { property: "og:site_name", content: SITE.name },
      { property: "og:locale", content: SITE.locale },
      { property: "og:type", content: p.type ?? "website" },
      { property: "og:title", content: p.title },
      { property: "og:description", content: p.description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { name: "twitter:card", content: own ? "summary_large_image" : "summary" },
      { name: "twitter:title", content: p.title },
      { name: "twitter:description", content: p.description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** A <script type="application/ld+json"> for the page head. It is part of the HTML the server sends. */
export const jsonLd = (data: unknown) => ({
  type: "application/ld+json",
  children: JSON.stringify(data).replace(/</g, "\\u003c"),
});

export const organizationLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": absoluteUrl("/#organization"),
  name: SITE.name,
  legalName: SITE.legalName,
  url: SITE.url,
  logo: absoluteUrl("/logo.svg"),
  email: SITE.email,
  telephone: SITE.phone,
  address: {
    "@type": "PostalAddress",
    streetAddress: SITE.address.street,
    addressLocality: SITE.address.city,
    addressCountry: SITE.address.countryCode,
  },
  contactPoint: [
    { "@type": "ContactPoint", contactType: "customer support", email: SITE.email, telephone: SITE.phone, areaServed: SITE.address.countryCode },
  ],
});

export const websiteLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": absoluteUrl("/#website"),
  name: SITE.name,
  alternateName: ["MoaMart"],
  url: SITE.url,
  publisher: { "@id": absoluteUrl("/#organization") },
});

type ProductLike = {
  id: string;
  name: string;
  description?: string | undefined;
  blurb?: string | undefined;
  images: string[];
  price: number;
  stock: number;
  sku?: string | undefined;
  category?: unknown;
};

/** A short, plain description for search results (about 155 characters). */
export function productDescription(p: Pick<ProductLike, "description" | "blurb" | "name">): string {
  const raw = (p.description || p.blurb || p.name).replace(/\s+/g, " ").trim();
  if (raw.length <= 160) return raw;
  const cut = raw.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 100 ? cut.lastIndexOf(" ") : 157)}…`;
}

/** What Google needs for a product: name, photos, price, currency and whether it is in stock. */
export function productLd(p: ProductLike) {
  const url = absoluteUrl(`/product/${p.id}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.name,
    description: productDescription(p),
    image: p.images.filter(Boolean),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.category ? { category: String(p.category) } : {}),
    url,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: SITE.currency,
      price: String(p.price),
      availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": absoluteUrl("/#organization") },
    },
  };
}

/** The trail "Home > Shoes > Orbit High-Top", for search results. */
export const breadcrumbLd = (items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: it.name,
    item: absoluteUrl(it.path),
  })),
});
