import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** Product reviews: the shapes the database functions return, the words shown to people, and a shared summary that every part of a product page reads. */
export type Stars5 = "1" | "2" | "3" | "4" | "5";
export type Summary = { count: number; avg: number; dist: Record<Stars5, number> };
export type Review = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  /** "Aline U.": a first name and the first letter of the last. Never an email. */
  name: string;
  created_at: string;
  edited: boolean;
  helpful: number;
  reply: string | null;
  reply_at: string | null;
  mine: boolean;
  voted: boolean;
  /** Where the reviewer's own profile photo is kept, and the photo from their Google account: the same two their account shows. Either can be missing. */
  avatar_path?: string | null;
  google_photo?: string | null;
};
export type MyReview = Review & { status: "published" | "hidden"; hidden_reason: string | null };
export type Eligibility = { signed_in: boolean; can_review: boolean; has_reviewed: boolean; reason: "not_signed_in" | "not_delivered" | null };
export type Store = { id: string; name: string; logo_path?: string | null };

export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"] as const;
export const REPORT_REASONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "abusive", label: "Abusive or offensive" },
  { value: "personal_info", label: "Shares personal information" },
  { value: "not_about_product", label: "Not about this product" },
  { value: "fake", label: "Looks fake" },
] as const;
/** Why a review was taken down, in the words the author is told. */
export const HIDDEN_WHY: Record<string, string> = {
  spam: "it looked like spam",
  abusive: "it contained abusive language",
  personal_info: "it contained personal information",
  not_about_product: "it was not about the product",
  suspected_fake: "we could not confirm it was a genuine review",
};

/**
 * The reviewer's picture, exactly as their own profile shows it: the photo they added, else the one from their Google account, else their initials.
 * The reviews carry a first name and a last initial ("Keter M."), which is also what the initials are made from.
 */
export function reviewerOf(r: Pick<Review, "name" | "avatar_path" | "google_photo">) {
  const [first = "", ...rest] = r.name.split(" ");
  const last = rest.join(" ").replace(/\./g, "");
  return {
    avatarUrl: r.avatar_path ? supabase.storage.from("avatars").getPublicUrl(r.avatar_path).data.publicUrl : null,
    googlePhoto: r.google_photo ?? null,
    firstName: first,
    lastName: last,
  };
}
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const nameList = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// One summary per product, shared: the rating under the title and the reviews section below read the same numbers and refresh together.
const cache = new Map<string, Summary>();
const listeners = new Set<() => void>();
export function refreshReviews() {
  cache.clear();
  listeners.forEach((f) => f());
}
export function useReviewSummary(productId: string): Summary | null {
  const [s, setS] = useState<Summary | null>(cache.get(productId) ?? null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const hit = cache.get(productId);
      if (hit) return setS(hit);
      const { data, error } = await supabase.rpc("product_review_summary", { p_product: productId });
      if (!live) return;
      if (error || !data) return setS(null); // an older database has no reviews: show nothing
      const next = data as Summary;
      cache.set(productId, next);
      setS(next);
    };
    void load();
    listeners.add(load);
    return () => {
      live = false;
      listeners.delete(load);
    };
  }, [productId]);
  return s;
}
