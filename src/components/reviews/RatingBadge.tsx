import { plural, useReviewSummary } from "@/lib/reviews";
import { Stars } from "@/components/reviews/Stars";

/** The rating just under the product's name, bigger than in the list below (that is where shoppers look first). Taps through to the reviews. Nothing at all until there is a review. */
export function RatingBadge({ productId }: { productId: string }) {
  const s = useReviewSummary(productId);
  if (!s || s.count === 0) return null;
  return (
    <a href="#reviews" className="mt-2 inline-flex items-center gap-2 font-body text-sm" aria-label={`${s.avg.toFixed(1)} out of 5 stars, ${plural(s.count, "review", "reviews")}. Go to the reviews.`}>
      <Stars value={s.avg} size={18} />
      <span className="font-semibold">{s.avg.toFixed(1)}</span>
      <span className="text-muted-foreground underline underline-offset-4">({plural(s.count, "review", "reviews")})</span>
    </a>
  );
}
