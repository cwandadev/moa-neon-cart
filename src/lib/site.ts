/** One place for the business details that appear in page titles, the footer, the legal pages and the data Google reads. */
export const SITE = {
  name: "MOA Mart",
  legalName: "TIEFLABS LTD",
  /** The address Google should treat as the main one. */
  url: "https://www.moamart.shop",
  email: "moamart250@gmail.com",
  phone: "+250798433900",
  phoneDisplay: "+250 798 433 900",
  address: { street: "KG 551", city: "Kigali", country: "Rwanda", countryCode: "RW" },
  currency: "RWF",
  locale: "en_RW",
  tagline: "Shop clothing, shoes, kitchen items, electronics and more. Delivered in Kigali.",
  /** Shown when a link to the shop is shared and the page has no photo of its own. */
  shareImage: "/c_color1.png",
  /** Shown at the top of the policy pages. */
  policyUpdated: "20 October 2026",
} as const;

export const absoluteUrl = (path: string) => SITE.url + (path.startsWith("/") ? path : `/${path}`);
