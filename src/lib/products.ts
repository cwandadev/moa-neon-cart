export type Category =
  | "Clothing"
  | "Shoes"
  | "Home Tools"
  | "Kitchen"
  | "Lighting"
  | "Electronics"
  | "Tech Gadgets"
  | "Toys"
  | "Art";

export const CATEGORIES: Category[] = [
  "Clothing",
  "Shoes",
  "Home Tools",
  "Kitchen",
  "Lighting",
  "Electronics",
  "Tech Gadgets",
  "Toys",
  "Art",
];

export type Product = {
  id: string;
  name: string;
  category: Category;
  price: number;
  oldPrice?: number | undefined;
  rating: number;
  reviews: number;
  stock: number;
  inStock: boolean;
  images: string[];
  videoPreview: boolean;
  blurb: string;
  description: string;
  specs: { label: string; value: string }[];
  highlights: string[];
  care: string;
  shipping: string;
  references: { label: string; url: string }[];
  clicks: number;
  wishlists: number;
  orders: number;
  createdDaysAgo: number;
  tags: string[];
};

/**
 * Mock CDN delivery helper. Swap the base for your Cloudinary cloud name
 * (e.g. https://res.cloudinary.com/<cloud>/image/upload/w_900,q_auto/<public_id>)
 * once the backend is connected.
 */
export const cdn = (photo: string, w = 900, crop = "entropy") =>
  `https://images.unsplash.com/${photo}?auto=format&fit=crop&crop=${crop}&w=${w}&q=80`;

type Seed = [name: string, category: Category, price: number, photos: string[]];

const seeds: Seed[] = [
  ["Nebula Oversized Hoodie", "Clothing", 68, ["photo-1556821840-3a63f95609a7", "photo-1620799140408-edc6dcb6d633"]],
  ["Onyx Tailored Blazer", "Clothing", 149, ["photo-1594938298603-c8148c4dae35", "photo-1593030761757-71fae45fa0e7"]],
  ["Kigali Linen Shirt", "Clothing", 54, ["photo-1602810318383-e386cc2a3ccf", "photo-1596755094514-f87e34085b2c"]],
  ["Vector Cargo Pants", "Clothing", 72, ["photo-1517445312882-bc9910d016b7", "photo-1541099649105-f69ad21f3246"]],
  ["Halo Knit Sweater", "Clothing", 84, ["photo-1576871337622-98d48d1cf531", "photo-1434389677669-e08b4cac3105"]],
  ["Aurora Summer Dress", "Clothing", 96, ["photo-1595777457583-95e059d581b8", "photo-1515372039744-b8f02a3ae446"]],
  ["Grid Tech Windbreaker", "Clothing", 118, ["photo-1591047139829-d91aecb6caea", "photo-1548126032-079a0fb0099d"]],
  ["Mono Essential Tee 3-Pack", "Clothing", 39, ["photo-1521572163474-6864f9cf17ab", "photo-1618354691373-d851c5c3a990"]],
  ["Pulse Runner Sneakers", "Shoes", 129, ["photo-1542291026-7eec264c27ff", "photo-1600185365483-26d7a4cc7519"]],
  ["Carbon Court Low", "Shoes", 112, ["photo-1595950653106-6c9ebd614d3a", "photo-1549298916-b41d501d3772"]],
  ["Terra Trail Boots", "Shoes", 168, ["photo-1520639888713-7851133b1ed0", "photo-1608256246200-53e635b5b65f"]],
  ["Slate Leather Loafers", "Shoes", 145, ["photo-1533867617858-e7b97e060509", "photo-1614252369475-531eba835eb1"]],
  ["Cloudstep Slides", "Shoes", 42, ["photo-1603487742131-4160ec999306", "photo-1562183241-b937e95585b6"]],
  ["Orbit High-Top", "Shoes", 138, ["photo-1552346154-21d32810aba3", "photo-1595950653106-6c9ebd614d3a"]],
  ["FlexDrive 20V Drill Kit", "Home Tools", 189, ["photo-1504148455328-c376907d081c", "photo-1581147036324-c1c9bf9c9d1c"]],
  ["Precision 42-Bit Driver Set", "Home Tools", 46, ["photo-1572981779307-38b8cabb2407", "photo-1530124566582-a618bc2615dc"]],
  ["LaserLine Digital Measure", "Home Tools", 78, ["photo-1581092160562-40aa08e78837", "photo-1600585152220-90363fe7e115"]],
  ["Titan Grip Wrench Set", "Home Tools", 96, ["photo-1590479773265-7464e5d48118", "photo-1416879595882-3373a0480b5b"]],
  ["Vault Rolling Tool Chest", "Home Tools", 320, ["photo-1530124566582-a618bc2615dc", "photo-1581147036324-c1c9bf9c9d1c"]],
  ["Sear Pro Cast Iron Pan", "Kitchen", 64, ["photo-1585237017125-24baf8d7406f", "photo-1556910103-1c02745aae4d"]],
  ["Damascus 8\" Chef Knife", "Kitchen", 132, ["photo-1593618998160-e34014e67546", "photo-1594385208974-2e75f8d7bb48"]],
  ["Vortex Vacuum Blender", "Kitchen", 175, ["photo-1570222094114-d054a817e56b", "photo-1610701596007-11502861dcfa"]],
  ["Brew Lab Pour-Over Set", "Kitchen", 58, ["photo-1495474472287-4d71bcdd2085", "photo-1461023058943-07fcbe16d735"]],
  ["Matte Ceramic Dinner Set", "Kitchen", 112, ["photo-1578985545062-69928b1d9587", "photo-1584990347449-a2d4c2c9ea16"]],
  ["SmartTemp Air Fryer", "Kitchen", 148, ["photo-1626074353765-517a681e40be", "photo-1585515320310-259814833e62"]],
  ["Halo Ring Pendant Light", "Lighting", 210, ["photo-1507473885765-e6ed057f782c", "photo-1524634126442-357e0eac3c14"]],
  ["Filament Edison Bulb Trio", "Lighting", 34, ["photo-1550985616-10810253b84d", "photo-1513506003901-1e6a229e2d15"]],
  ["Arc Floor Lamp", "Lighting", 245, ["photo-1543198126-c65a8b2be7b0", "photo-1540932239986-30128078f3c5"]],
  ["Neon Signature Wall Glow", "Lighting", 89, ["photo-1563889362352-b0492c224f62", "photo-1533228876829-65c94e7b5025"]],
  ["Solar Path Light Set", "Lighting", 76, ["photo-1558002038-1055907df827", "photo-1493666438817-866a91353ca9"]],
  ["Aperture 4K Mirrorless", "Electronics", 1290, ["photo-1502920917128-1aa500764cbd", "photo-1516035069371-29a1b244cc32"]],
  ["Sonic Studio Headphones", "Electronics", 279, ["photo-1505740420928-5e560c06d30e", "photo-1583394838336-acd977736f90"]],
  ["Nova 27\" 4K Monitor", "Electronics", 449, ["photo-1527443224154-c4a3942d3acf", "photo-1547082299-de196ea013d6"]],
  ["Bassline Portable Speaker", "Electronics", 119, ["photo-1608043152269-423dbba4e7e1", "photo-1545454675-3531b543be5d"]],
  ["EchoDrone Mini 4K", "Electronics", 690, ["photo-1473968512647-3e447244af8f", "photo-1521405924368-64c5b84bec60"]],
  ["Pulse Smart Ring", "Tech Gadgets", 249, ["photo-1523275335684-37898b6baf30", "photo-1434493789847-2f02dc6ca35d"]],
  ["Glide Wireless Charge Pad", "Tech Gadgets", 59, ["photo-1601972602288-3c4e0e7f7b0a", "photo-1585123334904-845d60e97b29"]],
  ["Vision AR Glasses", "Tech Gadgets", 399, ["photo-1512499617640-c74ae3a79d37", "photo-1592478411213-6153e4ebc07d"]],
  ["Cell 20K Power Bank", "Tech Gadgets", 72, ["photo-1609091839311-d5365f9ff1c5", "photo-1591290619618-904f6dd935e3"]],
  ["Mech Aurora Keyboard", "Tech Gadgets", 139, ["photo-1587829741301-dc798b83add3", "photo-1618384887929-16ec33fab9ef"]],
  ["Track Fit Smartwatch", "Tech Gadgets", 189, ["photo-1546868871-7041f2a55e12", "photo-1508685096489-7aacd43bd3b1"]],
  ["Cosmo Building Blocks 480pc", "Toys", 64, ["photo-1587654780291-39c9404d746b", "photo-1596461404969-9ae70f2830c1"]],
  ["RC Rover Storm 4WD", "Toys", 98, ["photo-1558060370-d644479cb6f7", "photo-1516981879613-9f5da904015f"]],
  ["Plush Nimbus Bear", "Toys", 32, ["photo-1559454403-b8fb88521f11", "photo-1530325553241-4f6e7690cf36"]],
  ["Logic Maze Puzzle Cube", "Toys", 24, ["photo-1591991564021-0662a0a1d1b3", "photo-1509228468518-central"]],
  ["Junior Science Lab Kit", "Toys", 79, ["photo-1567016526105-22da7c13161a", "photo-1596464716127-f2a82984de30"]],
  ["Chromatic Abstract Canvas", "Art", 320, ["photo-1541961017774-22349e4a1262", "photo-1549887534-1541e9326642"]],
  ["Brutalist Concrete Sculpture", "Art", 480, ["photo-1578321272176-b7bbc0679853", "photo-1531913764164-f85c52e6e654"]],
  ["Monochrome Line Print Set", "Art", 96, ["photo-1513519245088-0e12902e5a38", "photo-1526040652367-ac003a0475fe"]],
  ["Kinetic Metal Wall Art", "Art", 265, ["photo-1518998053901-5348d3961a04", "photo-1552083375-1447ce886485"]],
  ["Handmade Clay Vase Duo", "Art", 128, ["photo-1578500494198-246f612d3b3d", "photo-1493106819501-66d381c466f1"]],
  ["Ink Portrait Study", "Art", 210, ["photo-1499781350541-7783f6c6a0c8", "photo-1531913764164-f85c52e6e654"]],
];

const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const PRODUCTS: Product[] = seeds.map(([name, category, price, photos], i) => {
  const r = (n: number) => rnd(i + n * 7.13);
  const stock = Math.floor(r(1) * 26);
  const outOfStock = r(2) > 0.9;
  const p0 = photos[0] as string;
  const p1 = (photos[1] ?? photos[0]) as string;
  return {
    id: slug(name),
    name,
    category,
    price,
    oldPrice: r(3) > 0.6 ? Math.round(price * 1.25) : undefined,
    rating: Math.round((3.5 + r(4) * 1.5) * 10) / 10,
    reviews: 12 + Math.floor(r(5) * 480),
    stock: outOfStock ? 0 : stock,
    inStock: !outOfStock && stock > 0,
    images: [cdn(p0), cdn(p1), cdn(p0, 900, "edges"), cdn(p1, 900, "faces")],
    videoPreview: r(6) > 0.5,
    blurb: `${category} essential engineered for daily use — precision materials, considered details.`,
    description: `The ${name} is part of the MOA Mart curated ${category.toLowerCase()} line. Every unit is inspected before dispatch and ships with our 12-month replacement promise. Designed for durability first, with a restrained silhouette that fits any setup.`,
    specs: [
      { label: "SKU", value: `MOA-${String(1000 + i)}` },
      { label: "Category", value: category },
      { label: "Warranty", value: r(7) > 0.5 ? "12 months" : "24 months" },
      { label: "Weight", value: `${(0.3 + r(8) * 4).toFixed(2)} kg` },
      { label: "Origin", value: r(9) > 0.5 ? "Imported" : "Locally sourced" },
      { label: "Delivery", value: "Kigali same-day · Countrywide 1-3 days" },
    ],
    highlights: [
      "Quality-checked before dispatch",
      "Cash on delivery or mobile money",
      "Free returns within 7 days",
      "Verified supplier network",
    ],
    care: "Wipe with a dry microfibre cloth. Avoid prolonged exposure to moisture and direct heat. Store in the supplied packaging when unused.",
    shipping:
      "Orders confirmed on WhatsApp before 4pm are dispatched the same day within Kigali. Upcountry deliveries arrive in 1-3 working days through our courier partners.",
    references: [
      { label: "Full manufacturer spec sheet", url: "https://example.com/spec-sheet" },
      { label: "Care & maintenance guide", url: "https://example.com/care-guide" },
    ],
    clicks: Math.floor(r(10) * 9000),
    wishlists: Math.floor(r(11) * 1200),
    orders: Math.floor(r(12) * 600),
    createdDaysAgo: Math.floor(r(13) * 220),
    tags: [category, name.split(" ")[0] as string],
  };
});

export const getProduct = (id: string) => PRODUCTS.find((p) => p.id === id);

export const popularityScore = (p: Product) => p.clicks * 0.4 + p.wishlists * 1.6 + p.orders * 3;

/**
 * Smart feed simulation:
 * page 1-1.5 -> highest engagement (clicks + wishlists + orders)
 * page ~3    -> newest arrivals
 * beyond     -> dynamic mixed recommendations
 */
export function smartFeed(products: Product[], pageSize = 12): Product[] {
  const hotCount = Math.round(pageSize * 1.5);
  const pool = [...products];
  const hot = [...pool].sort((a, b) => popularityScore(b) - popularityScore(a)).slice(0, hotCount);
  const taken = new Set(hot.map((p) => p.id));
  const rest = pool.filter((p) => !taken.has(p.id));

  const newest = [...rest]
    .sort((a, b) => a.createdDaysAgo - b.createdDaysAgo)
    .slice(0, pageSize);
  newest.forEach((p) => taken.add(p.id));

  const mixed = pool.filter((p) => !taken.has(p.id));
  // interleave rating-led and price-led picks for a "dynamic" recommendation tail
  const byRating = [...mixed].sort((a, b) => b.rating - a.rating);
  const byValue = [...mixed].sort((a, b) => a.price - b.price);
  const tail: Product[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mixed.length; i++) {
    for (const cand of [byRating[i], byValue[i]]) {
      if (cand && !seen.has(cand.id)) {
        seen.add(cand.id);
        tail.push(cand);
      }
    }
  }

  const halfPage = Math.round(pageSize / 2);
  return [...hot, ...newest.slice(0, halfPage), ...newest.slice(halfPage), ...tail];
}

export const stockLabel = (p: Product) =>
  !p.inStock || p.stock === 0
    ? { text: "Out of Stock", tone: "out" as const }
    : p.stock <= 3
      ? { text: `Only ${p.stock} left`, tone: "low" as const }
      : { text: "In Stock", tone: "in" as const };

export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);