import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Stars, StarInput } from "@/components/reviews/Stars";
import { useAuth } from "@/lib/auth";
import { formatDate, HIDDEN_WHY, plural, refreshReviews, REPORT_REASONS, useReviewSummary, type Eligibility, type MyReview, type Review, type Stars5 } from "@/lib/reviews";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Customer reviews, built the way the shops that sell best build them:
 *  - a rating summary with a CLICKABLE bar for each star count (shoppers use it to filter, so it is open by default);
 *  - "Verified purchase" on every review, because only a customer whose order was delivered can write one (nothing is paid for);
 *  - sort by most helpful, newest, highest and lowest; "helpful" votes; the most helpful good and the most helpful critical review first;
 *  - the store's replies, set apart, so a bad review gets a visible answer;
 *  - report a review; and a plain statement of the rules: only spam, abuse or personal information is ever hidden, never a negative review.
 */
// The sign-in page. (Cast so a project whose route list does not know "/login" yet still type-checks.)
const LOGIN = "/login" as never;
const PAGE = 5;
const SORTS = [
  ["helpful", "Most helpful"],
  ["recent", "Newest"],
  ["highest", "Highest rated"],
  ["lowest", "Lowest rated"],
] as const;
type Sort = (typeof SORTS)[number][0];
const field = "w-full rounded-xl border border-border bg-card px-3 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm";

function Verified() {
  return (
    <span className="inline-flex items-center gap-1 font-body text-xs font-medium text-success">
      <i aria-hidden className="bx bxs-check-circle text-sm" /> Verified purchase
    </span>
  );
}

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <>
      <p className="whitespace-pre-line font-body text-sm leading-relaxed">{long && !open ? `${text.slice(0, 320).trimEnd()}…` : text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 font-body text-sm text-primary underline underline-offset-4">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

function ReportForm({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Choose why you are reporting it.");
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("report_review", { p_review: reviewId, p_reason: reason, p_note: note.trim() || null });
    setBusy(false);
    if (err) return setError(err.message);
    toast.success("Thank you. We will look at it.");
    onDone();
  };
  return (
    <form onSubmit={(e) => void send(e)} aria-label="Report this review" className="mt-3 grid gap-2 rounded-xl border border-border bg-background/60 p-3">
      <label className="grid gap-1 font-body text-sm">
        Why are you reporting it?
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={cn(field, "h-11")}>
          <option value="">Choose a reason</option>
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 font-body text-sm">
        Anything we should know? (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} className={cn(field, "py-2")} />
      </label>
      {error && (
        <p role="alert" className="font-body text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-primary px-4 font-display text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 rounded-xl border border-border px-4 font-body text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReviewCard({ r, signedIn, onVote, onEdit, onDelete }: { r: Review; signedIn: boolean; onVote: (r: Review) => void; onEdit?: () => void; onDelete?: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  return (
    <article aria-label={`Review by ${r.name}, ${r.rating} out of 5`} className="border-b border-border py-5 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={r.rating} size={16} />
        {r.title && <h3 className="font-display text-base font-semibold">{r.title}</h3>}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{r.name}</span>
        <Verified />
        <span>
          {formatDate(r.created_at)}
          {r.edited ? " · edited" : ""}
        </span>
      </p>
      <div className="mt-2">
        <Body text={r.body} />
      </div>
      {r.reply && (
        <div className="mt-3 rounded-xl border-l-4 border-primary bg-secondary/60 p-3" aria-label="Reply from the store">
          <p className="font-display text-sm font-semibold">
            Reply from the store{r.reply_at ? <span className="ml-2 font-body text-xs font-normal text-muted-foreground">{formatDate(r.reply_at)}</span> : null}
          </p>
          <p className="mt-1 whitespace-pre-line font-body text-sm leading-relaxed">{r.reply}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.mine ? (
          <>
            <span className="font-body text-sm text-muted-foreground">{plural(r.helpful, "person found", "people found")} this helpful</span>
            {onEdit && (
              <button type="button" onClick={onEdit} className="min-h-11 rounded-xl border border-border px-3 font-body text-sm">
                Edit
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete} className="min-h-11 rounded-xl px-3 font-body text-sm text-destructive">
                Delete
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={r.voted}
              onClick={() => onVote(r)}
              className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 font-body text-sm transition-colors", r.voted ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}
            >
              <i aria-hidden className={cn("bx text-lg", r.voted ? "bxs-like" : "bx-like")} />
              Helpful{r.helpful > 0 ? ` (${r.helpful})` : ""}
            </button>
            {signedIn &&
              (reported ? (
                <span className="font-body text-sm text-muted-foreground">Reported. Thank you.</span>
              ) : (
                <button type="button" onClick={() => setReporting((v) => !v)} aria-expanded={reporting} className="min-h-11 rounded-xl px-3 font-body text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Report
                </button>
              ))}
          </>
        )}
      </div>
      {reporting && !reported && (
        <ReportForm
          reviewId={r.id}
          onDone={() => {
            setReporting(false);
            setReported((x) => x || false);
          }}
        />
      )}
    </article>
  );
}

function ReviewForm({ productId, productName, initial, onDone, onCancel }: { productId: string; productName: string; initial?: MyReview | null; onDone: () => void; onCancel: () => void }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = 2000 - body.length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    if (body.trim().length < 10) return setError("Please write at least a few words (10 characters or more).");
    if (/(https?:\/\/|www\.)/i.test(`${title} ${body}`)) return setError("Please do not put links in a review.");
    setBusy(true);
    const { error: err } = await supabase.rpc("submit_review", { p_product: productId, p_rating: rating, p_title: title.trim() || null, p_body: body.trim() });
    setBusy(false);
    if (err) return setError(err.message);
    toast.success(initial ? "Your review was updated." : "Thank you. Your review is posted.");
    refreshReviews();
    onDone();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={initial ? "Edit your review" : "Write a review"} className="grid gap-4 rounded-2xl border border-border bg-card/60 p-4">
      <div>
        <h3 className="font-display text-base font-semibold">{initial ? "Edit your review" : `Review ${productName}`}</h3>
        <p className="mt-1 font-body text-xs text-muted-foreground">Say what you liked or did not like about the product itself. Please do not include links or personal details. Nobody is paid for a review, and a review is never hidden for being negative.</p>
      </div>
      <StarInput value={rating} onChange={setRating} />
      <label className="grid gap-1.5 font-body text-sm">
        Title (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="The short version" className={cn(field, "h-11")} />
      </label>
      <label className="grid gap-1.5 font-body text-sm">
        Your review
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} placeholder="What was it like? Fit, quality, delivery, anything others would want to know." className={cn(field, "py-2")} />
        <span className={cn("text-right text-xs", left < 100 ? "text-warning" : "text-muted-foreground")}>{left} characters left</span>
      </label>
      {error && (
        <p role="alert" className="font-body text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-12 rounded-2xl bg-primary px-6 font-display text-base font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Posting…" : initial ? "Save changes" : "Post review"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 rounded-2xl border border-border px-5 font-body text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
export function ReviewsSection({ productId, productName }: { productId: string; productName: string }) {
  const { user } = useAuth();
  const summary = useReviewSummary(productId);
  const key = summary ? `${summary.count}:${summary.avg}` : "";
  const [sort, setSort] = useState<Sort>("helpful");
  const [stars, setStars] = useState<number | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [highlights, setHighlights] = useState<{ positive: Review | null; critical: Review | null }>({ positive: null, critical: null });
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [mine, setMine] = useState<MyReview | null>(null);
  const [writing, setWriting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      const { data, error } = await supabase.rpc("product_reviews_list", { p_product: productId, p_sort: sort, p_stars: stars, p_limit: PAGE, p_offset: offset });
      if (error || !data) return;
      const d = data as { total: number; reviews: Review[] };
      setTotal(d.total);
      setItems((prev) => (offset === 0 ? d.reviews : [...prev, ...d.reviews]));
    },
    [productId, sort, stars],
  );
  useEffect(() => {
    setLoading(true);
    void loadPage(0).finally(() => setLoading(false));
  }, [loadPage, key]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("product_review_highlights", { p_product: productId });
      const h = data as { positive: Review | null; critical: Review | null } | null;
      setHighlights(h ?? { positive: null, critical: null });
    })();
  }, [productId, key]);
  useEffect(() => {
    void (async () => {
      const [e, m] = await Promise.all([supabase.rpc("review_eligibility", { p_product: productId }), supabase.rpc("my_review", { p_product: productId })]);
      setElig(e.error ? null : (e.data as Eligibility));
      setMine(m.error ? null : (m.data as MyReview | null));
    })();
  }, [productId, user?.id, key]);

  const vote = async (r: Review) => {
    if (!user) {
      toast.error("Sign in to mark a review helpful.");
      return;
    }
    const next = !r.voted;
    const patch = (x: Review) => (x.id === r.id ? { ...x, voted: next, helpful: x.helpful + (next ? 1 : -1) } : x);
    setItems((p) => p.map(patch));
    setHighlights((h) => ({ positive: h.positive ? patch(h.positive) : null, critical: h.critical ? patch(h.critical) : null }));
    const { error } = await supabase.rpc("vote_review", { p_review: r.id, p_helpful: next });
    if (error) {
      toast.error(error.message);
      const undo = (x: Review) => (x.id === r.id ? { ...x, voted: r.voted, helpful: r.helpful } : x);
      setItems((p) => p.map(undo));
      setHighlights((h) => ({ positive: h.positive ? undo(h.positive) : null, critical: h.critical ? undo(h.critical) : null }));
    }
  };
  const remove = async () => {
    setBusyDelete(true);
    const { error } = await supabase.rpc("delete_my_review", { p_product: productId });
    setBusyDelete(false);
    setConfirmDelete(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Your review was deleted.");
    setMine(null);
    refreshReviews();
  };

  const count = summary?.count ?? 0;
  const dist = summary?.dist;
  const showHighlights = sort === "helpful" && stars === null && (highlights.positive || highlights.critical);
  const hl = showHighlights ? [highlights.positive, highlights.critical].filter(Boolean) as Review[] : [];
  const shown = items.filter((r) => !r.mine && !hl.some((h) => h.id === r.id));
  const left = total - items.length;
  const signedIn = !!user;

  return (
    <section id="reviews" aria-labelledby="reviews-h" className="scroll-mt-24">
      <h2 id="reviews-h" className="font-display text-lg font-semibold md:text-xl">
        Customer reviews
      </h2>

      <div className="mt-5 grid gap-8 md:grid-cols-[17rem_1fr] md:gap-12">
        <aside aria-label="Rating summary" className="grid content-start gap-5">
          {count > 0 && summary ? (
            <div>
              <div className="flex items-end gap-3">
                <span className="font-display text-5xl font-semibold leading-none">{summary.avg.toFixed(1)}</span>
                <span className="pb-1 font-body text-sm text-muted-foreground">out of 5</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Stars value={summary.avg} size={20} />
                <span className="font-body text-sm text-muted-foreground">{plural(count, "review", "reviews")}</span>
              </div>
              <ul aria-label="Reviews by rating" className="mt-4 grid gap-1">
                {([5, 4, 3, 2, 1] as const).map((n) => {
                  const c = dist?.[String(n) as Stars5] ?? 0;
                  const on = stars === n;
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        disabled={c === 0}
                        aria-pressed={on}
                        aria-label={`${n}-star reviews: ${c}. ${on ? "Showing only these. Press to show all." : "Press to show only these."}`}
                        onClick={() => setStars(on ? null : n)}
                        className={cn("grid min-h-9 w-full grid-cols-[3.25rem_1fr_2rem] items-center gap-2 rounded-lg px-1 text-left font-body text-sm transition-colors disabled:cursor-default disabled:opacity-50", on ? "bg-primary/10" : "enabled:hover:bg-secondary")}
                      >
                        <span className="text-muted-foreground">{n} star{n === 1 ? "" : "s"}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                          <span data-bar className="block h-full rounded-full bg-warning" style={{ width: `${count ? (c / count) * 100 : 0}%` }} />
                        </span>
                        <span className="text-right tabular-nums text-muted-foreground">{c}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="font-body text-sm text-muted-foreground">No reviews yet.</p>
          )}

          <div className="grid gap-3">
            {!signedIn || elig?.reason === "not_signed_in" ? (
              <p className="font-body text-sm">
                <Link to={LOGIN} className="text-primary underline underline-offset-4">
                  Sign in
                </Link>{" "}
                to review a product you have received.
              </p>
            ) : elig?.reason === "not_delivered" ? (
              <p className="font-body text-sm">You can review this product once it has been delivered to you.</p>
            ) : elig?.can_review && !mine && !writing ? (
              <button type="button" onClick={() => setWriting(true)} className="min-h-12 rounded-2xl bg-primary px-6 font-display text-base font-semibold text-primary-foreground">
                Write a review
              </button>
            ) : null}
            <p className="flex items-start gap-2 font-body text-xs leading-relaxed text-muted-foreground">
              <i aria-hidden className="bx bx-shield-quarter mt-0.5 text-base" />
              <span>Only customers who received this product can review it. Nobody is paid for a review. We only remove a review for spam, abuse or personal information, never for being negative.</span>
            </p>
          </div>
        </aside>

        <div className="min-w-0">
          {writing && !mine && (
            <div className="mb-6">
              <ReviewForm productId={productId} productName={productName} onDone={() => setWriting(false)} onCancel={() => setWriting(false)} />
            </div>
          )}

          {mine && (
            <div className="mb-6" aria-label="Your review">
              {writing ? (
                <ReviewForm productId={productId} productName={productName} initial={mine} onDone={() => setWriting(false)} onCancel={() => setWriting(false)} />
              ) : (
                <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
                  <p className="mb-1 font-display text-sm font-semibold">Your review</p>
                  {mine.status === "hidden" && (
                    <p role="status" className="mb-3 rounded-xl bg-warning/10 px-3 py-2 font-body text-sm text-warning">
                      Your review is not showing on the page. We removed it because {HIDDEN_WHY[mine.hidden_reason ?? ""] ?? "it broke our review rules"}. You can edit it and it will be looked at again.
                    </p>
                  )}
                  <ReviewCard r={mine} signedIn onVote={() => undefined} onEdit={() => setWriting(true)} onDelete={() => setConfirmDelete(true)} />
                </div>
              )}
            </div>
          )}

          {count > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-body text-sm">
                Sort by
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(field, "h-11 w-auto")}>
                  {SORTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {stars !== null && (
                <button type="button" onClick={() => setStars(null)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 font-body text-sm">
                  Showing {stars}-star reviews
                  <i aria-hidden className="bx bx-x text-lg" />
                  <span className="sr-only">Show all reviews</span>
                </button>
              )}
            </div>
          )}

          {hl.length > 0 && (
            <div className="mb-4 grid gap-3 md:grid-cols-2" aria-label="Top reviews">
              {hl.map((h) => (
                <div key={h.id} className="rounded-2xl border border-border bg-card/60 p-4">
                  <p className="mb-1 font-body text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h.rating >= 4 ? "Top positive review" : "Top critical review"}</p>
                  <ReviewCard r={h} signedIn={signedIn} onVote={(r) => void vote(r)} />
                </div>
              ))}
            </div>
          )}

          {loading && items.length === 0 ? (
            <p role="status" className="font-body text-sm text-muted-foreground">
              Loading reviews…
            </p>
          ) : (
            <>
              <div aria-live="polite">{shown.map((r) => <ReviewCard key={r.id} r={r} signedIn={signedIn} onVote={(x) => void vote(x)} />)}</div>
              {count > 0 && shown.length === 0 && !mine && hl.length === 0 && <p className="font-body text-sm text-muted-foreground">No reviews with that rating.</p>}
              {left > 0 && (
                <button type="button" onClick={() => void loadPage(items.length)} className="mt-4 min-h-12 w-full rounded-2xl border border-border font-body text-sm hover:bg-secondary md:w-auto md:px-8">
                  Show more reviews ({left} more)
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your review?</AlertDialogTitle>
            <AlertDialogDescription>It will be removed from this page. You can write a new one afterwards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyDelete}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {busyDelete ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
