import type { Product, ProductVariant } from "./products";

/** "M / Black" */
export const variantLabel = (v: Pick<ProductVariant, "option1" | "option2">) =>
  [v.option1, v.option2].filter(Boolean).join(" / ");

/** The distinct values of option 1 or 2, in the order the admin set them. */
export const optionValues = (variants: ProductVariant[], which: 1 | 2): string[] => {
  const out: string[] = [];
  for (const v of variants) {
    const x = which === 1 ? v.option1 : v.option2;
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
};

/** The variant that matches the choices made so far, or null. */
export const findVariant = (
  variants: ProductVariant[],
  sel1: string,
  sel2: string,
  hasSecond: boolean,
): ProductVariant | null =>
  variants.find((v) => (v.option1 ?? "") === sel1 && (!hasSecond || (v.option2 ?? "") === sel2)) ?? null;

/**
 * A cart line for one chosen option. Its id is unique per option, so two sizes of
 * the same product are two lines. baseId is the real product id.
 */
export function lineProductFor(product: Product, variant: ProductVariant | null): Product {
  if (!variant) return product;
  return {
    ...product,
    id: `${product.id}::${variant.id}`,
    baseId: product.id,
    variantId: variant.id,
    variantLabel: variantLabel(variant),
    price: variant.price ?? product.price,
    stock: variant.stock,
    inStock: variant.stock > 0,
    images: variant.image ? [variant.image, ...product.images.filter((u) => u !== variant.image)] : product.images,
  };
}
