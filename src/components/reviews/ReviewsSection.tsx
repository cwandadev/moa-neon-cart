import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar } from "@/components/Avatar";
import { Stars, StarInput } from "@/components/reviews/Stars";
import { useAuth } from "@/lib/auth";
import { formatDate, HIDDEN_WHY, plural, refreshReviews, REPORT_REASONS, reviewerOf, useReviewSummary, type Eligibility, type MyReview, type Review, type Stars5 } from "@/lib/reviews";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Ratings and reviews, laid out the way Google Play lays them out: a plain list, no boxes. Each review is the reviewer's circle and NAME on top,
 * then the stars and the date, then what they wrote (there is no title, as on Play), then how many found it helpful, and the store's reply
 * indented underneath. A rating summary with a bar for each star count (tap a bar to see only those reviews) sits above.
 * Only a customer whose order was delivered can write one, so every review is from a real buyer; nobody is paid for one, and a review is only
 * ever removed for spam, abuse or personal information, never for being negative.
 */
const PAGE = 5;
// The sign-in page. (Cast so a project whose route list does not know "/login" yet still type-checks.)
const LOGIN = "/login" as never;
const SORTS = [
  ["helpful", "Most helpful"],
  ["recent", "Newest"],
  ["highest", "Highest rated"],
  ["lowest", "Lowest rated"],
] as const;
type Sort = (typeof SORTS)[number][0];
const field = "w-full rounded-xl border border-border bg-card px-3 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm";

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <>
      <p className="whitespace-pre-line font-body text-sm leading-relaxed">{long && !open ? `${text.slice(0, 320).trimEnd()}…` : text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 font-body text-sm font-medium text-primary">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

/** The three dots at the corner of a review (as on Play). It holds "Report review". */
function ReviewMenu({ onReport }: { onReport: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-label="More options for this review" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
        <i aria-hidden className="bx bx-dots-vertical-rounded text-2xl" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-border bg-popover p-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onReport();
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-body text-sm hover:bg-secondary"
          >
            <i aria-hidden className="bx bx-flag text-lg" /> Report review
          </button>
        </div>
      )}
    </div>
  );
}

function ReportForm({ reviewId, onDone }: { reviewId: string; onDone: (sent: boolean) => void }) {
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
    onDone(true);
  };
  return (
    <form onSubmit={(e) => void send(e)} aria-label="Report this review" className="mt-3 grid gap-2 border-l-2 border-border pl-4">
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
        <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-primary px-5 font-display text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={() => onDone(false)} className="min-h-11 rounded-full px-4 font-body text-sm text-muted-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReviewItem({ r, caption, signedIn, onVote, onEdit, onDelete }: { r: Review; caption?: string; signedIn: boolean; onVote: (r: Review) => void; onEdit?: () => void; onDelete?: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  return (
    <article aria-label={`Review by ${r.name}, ${r.rating} out of 5`}>
      {caption && <p className="mb-2 font-body text-xs font-medium uppercase tracking-wider text-muted-foreground">{caption}</p>}
      <header className="flex items-center gap-3">
        <Avatar user={reviewerOf(r)} size={36} />
        <p className="min-w-0 flex-1 truncate font-body text-sm font-medium">{r.name}</p>
        {!r.mine && signedIn && !reported && <ReviewMenu onReport={() => setReporting(true)} />}
      </header>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Stars value={r.rating} size={14} />
        <span className="font-body text-xs text-muted-foreground">
          {formatDate(r.created_at)}
          {r.edited ? " · edited" : ""}
        </span>
        <span className="inline-flex items-center gap-1 font-body text-xs text-success">
          <i aria-hidden className="bx bxs-check-circle text-sm" /> Verified purchase
        </span>
      </div>
      <div className="mt-2">
        <Body text={r.body} />
      </div>
      {r.helpful > 0 && (
        <p className="mt-2 font-body text-xs text-muted-foreground">
          {plural(r.helpful, "person", "people")} found this review helpful
        </p>
      )}
      {r.mine ? (
        <div className="mt-2 flex items-center gap-1">
          {onEdit && (
            <button type="button" onClick={onEdit} className="min-h-11 rounded-full px-3 font-body text-sm font-medium text-primary">
              Edit
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="min-h-11 rounded-full px-3 font-body text-sm text-destructive">
              Delete
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <span className="font-body text-xs text-muted-foreground">Was this review helpful?</span>
          <button
            type="button"
            aria-pressed={r.voted}
            onClick={() => onVote(r)}
            className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 font-body text-sm transition-colors", r.voted ? "border-primary text-primary" : "border-border hover:bg-secondary")}
          >
            <i aria-hidden className={cn("bx text-lg", r.voted ? "bxs-like" : "bx-like")} />
            Helpful
          </button>
          {reported && <span className="font-body text-xs text-muted-foreground">Reported. Thank you.</span>}
        </div>
      )}
      {r.reply && (
        <div className="mt-3 border-l-2 border-border pl-4" aria-label="Reply from the store">
          <p className="font-body text-sm font-medium">
            Reply from the store{r.reply_at ? <span className="ml-2 text-xs font-normal text-muted-foreground">{formatDate(r.reply_at)}</span> : null}
          </p>
          <p className="mt-1 whitespace-pre-line font-body text-sm leading-relaxed">{r.reply}</p>
        </div>
      )}
      {reporting && !reported && (
        <ReportForm
          reviewId={r.id}
          onDone={(sent) => {
            setReporting(false);
            if (sent) setReported(true);
          }}
        />
      )}
    </article>
  );
}

function ReviewForm({ productId, productName, initial, onDone, onCancel }: { productId: string; productName: string; initial?: MyReview | null; onDone: () => void; onCancel: () => void }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = 2000 - body.length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    if (body.trim().length < 10) return setError("Please write at least a few words (10 characters or more).");
    if (/(https?:\/\/|www\.)/i.test(body)) return setError("Please do not put links in a review.");
    setBusy(true);
    const { error: err } = await supabase.rpc("submit_review", { p_product: productId, p_rating: rating, p_title: null, p_body: body.trim() });
    setBusy(false);
    if (err) return setError(err.message);
    toast.success(initial ? "Your review was updated." : "Thank you. Your review is posted.");
    refreshReviews();
    onDone();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={initial ? "Edit your review" : "Write a review"} className="grid gap-4">
      <div>
        <h3 className="font-display text-base font-semibold">{initial ? "Edit your review" : `Review ${productName}`}</h3>
        <p className="mt-1 font-body text-xs text-muted-foreground">Say what you liked or did not like about the product itself. Please do not include links or personal details. Nobody is paid for a review, and a review is never hidden for being negative. Your first name and profile photo are shown with your review.</p>
      </div>
      <StarInput value={rating} onChange={setRating} />
      <div className="grid gap-1.5">
        <label htmlFor="review-text" className="font-body text-sm">
          Your review
        </label>
        <textarea id="review-text" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} placeholder="Describe your experience: fit, quality, delivery, anything others would want to know." className={cn(field, "py-2")} />
        <span className={cn("text-right text-xs", left < 100 ? "text-warning" : "text-muted-foreground")}>{left} characters left</span>
      </div>
      {error && (
        <p role="alert" className="font-body text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-12 rounded-full bg-primary px-8 font-display text-base font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Posting…" : initial ? "Save changes" : "Post review"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 rounded-full px-5 font-body text-sm text-muted-foreground">
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
  const showHighlights = sort === "helpful" && stars === null;
  const pinned: Array<{ r: Review; caption: string }> = [];
  if (showHighlights && highlights.positive) pinned.push({ r: highlights.positive, caption: "Most helpful positive review" });
  if (showHighlights && highlights.critical) pinned.push({ r: highlights.critical, caption: "Most helpful critical review" });
  const shown = items.filter((r) => !r.mine && !pinned.some((p) => p.r.id === r.id));
  const left = total - items.length;
  const signedIn = !!user;

  return (
    <section id="reviews" aria-labelledby="reviews-h" className="scroll-mt-24">
      <h2 id="reviews-h" className="font-display text-lg font-semibold md:text-xl">
        Ratings and reviews
      </h2>
      <p className="mt-1 flex items-start gap-1.5 font-body text-xs text-muted-foreground">
        <i aria-hidden className="bx bx-shield-quarter mt-px text-sm" />
        <span>Verified: only customers who received this product can review it. Nobody is paid for a review.</span>
      </p>

      {count > 0 && summary ? (
        <div aria-label="Rating summary" role="group" className="mt-5 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 md:max-w-lg md:gap-x-10">
          <div>
            <p className="font-display text-5xl font-semibold leading-none">{summary.avg.toFixed(1)}</p>
            <div className="mt-2">
              <Stars value={summary.avg} size={16} />
            </div>
            <p className="mt-1 font-body text-xs text-muted-foreground">{plural(count, "review", "reviews")}</p>
          </div>
          <ul aria-label="Reviews by rating" className="grid gap-0.5">
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
                    className={cn("grid min-h-7 w-full grid-cols-[1rem_1fr_1.75rem] items-center gap-2.5 rounded-md text-left font-body text-xs transition-colors disabled:cursor-default disabled:opacity-50", on && "bg-primary/10")}
                  >
                    <span className="text-center text-muted-foreground">{n}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
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
        <p className="mt-5 font-body text-sm text-muted-foreground">No reviews yet.</p>
      )}

      <div className="mt-5">
        {!signedIn || elig?.reason === "not_signed_in" ? (
          <p className="font-body text-sm">
            <Link to={LOGIN} className="font-medium text-primary">
              Sign in
            </Link>{" "}
            to review a product you have received.
          </p>
        ) : elig?.reason === "not_delivered" ? (
          <p className="font-body text-sm text-muted-foreground">You can review this product once it has been delivered to you.</p>
        ) : elig?.can_review && !mine && !writing ? (
          <button type="button" onClick={() => setWriting(true)} className="min-h-12 rounded-full border border-primary px-8 font-display text-base font-semibold text-primary hover:bg-primary/10">
            Write a review
          </button>
        ) : null}
      </div>

      {writing && !mine && (
        <div className="mt-5">
          <ReviewForm productId={productId} productName={productName} onDone={() => setWriting(false)} onCancel={() => setWriting(false)} />
        </div>
      )}

      {mine && (
        <div className="mt-6" aria-label="Your review">
          {writing ? (
            <ReviewForm productId={productId} productName={productName} initial={mine} onDone={() => setWriting(false)} onCancel={() => setWriting(false)} />
          ) : (
            <>
              {mine.status === "hidden" && (
                <p role="status" className="mb-3 flex items-start gap-2 font-body text-sm text-warning">
                  <i aria-hidden className="bx bx-info-circle mt-0.5 text-lg" />
                  <span>Your review is not showing on the page. We removed it because {HIDDEN_WHY[mine.hidden_reason ?? ""] ?? "it broke our review rules"}. You can edit it and it will be looked at again.</span>
                </p>
              )}
              <ReviewItem r={mine} caption="Your review" signedIn onVote={() => undefined} onEdit={() => setWriting(true)} onDelete={() => setConfirmDelete(true)} />
            </>
          )}
        </div>
      )}

      {count > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 rounded-full border border-border bg-background px-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {stars !== null && (
            <button type="button" onClick={() => setStars(null)} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 font-body text-sm">
              Showing {stars}-star reviews
              <i aria-hidden className="bx bx-x text-lg" />
              <span className="sr-only">Show all reviews</span>
            </button>
          )}
        </div>
      )}

      {loading && items.length === 0 ? (
        <p role="status" className="mt-6 font-body text-sm text-muted-foreground">
          Loading reviews…
        </p>
      ) : (
        <div className="mt-6 grid gap-8" aria-live="polite">
          {pinned.map((p) => (
            <ReviewItem key={p.r.id} r={p.r} caption={p.caption} signedIn={signedIn} onVote={(x) => void vote(x)} />
          ))}
          {shown.map((r) => (
            <ReviewItem key={r.id} r={r} signedIn={signedIn} onVote={(x) => void vote(x)} />
          ))}
          {count > 0 && shown.length === 0 && pinned.length === 0 && !mine && <p className="font-body text-sm text-muted-foreground">No reviews with that rating.</p>}
          {left > 0 && (
            <button type="button" onClick={() => void loadPage(items.length)} className="min-h-12 justify-self-start rounded-full border border-border px-8 font-body text-sm font-medium text-primary hover:bg-secondary">
              Show more reviews ({left} more)
            </button>
          )}
        </div>
      )}
      <p className="mt-8 font-body text-xs leading-relaxed text-muted-foreground">We only remove a review for spam, abuse or personal information, never for being negative.</p>

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
