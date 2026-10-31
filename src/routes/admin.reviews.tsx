import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field, FilterTabs, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead, Skeleton } from "@/components/moa/ui";
import { ago } from "@/lib/adminTools";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Reviews — MOA Mart Suite" }] }),
  component: Reviews,
});

type Report = { reason: string; note: string | null; at: string };
type Row = {
  id: string;
  product_id: string;
  product_name: string;
  rating: number;
  title: string | null;
  body: string;
  name: string;
  email: string | null;
  created_at: string;
  edited: boolean;
  status: "published" | "hidden";
  hidden_reason: string | null;
  helpful: number;
  reply: string | null;
  reply_at: string | null;
  reports: Report[];
};
type Counts = { needs_reply: number; low: number; reported: number; hidden: number; all: number; avg: number };
type Filter = "needs_reply" | "low" | "reported" | "hidden" | "all";

const PAGE = 20;
/** Only these can hide a review. "It is negative" is deliberately not on the list: hiding honest criticism is deceptive, and against Google's and the FTC's rules. */
const HIDE_REASONS = [
  { value: "spam", label: "Spam or advertising", hint: "Links, promotion, or the same text posted again and again." },
  { value: "abusive", label: "Abusive or offensive", hint: "Insults, threats or hate. Strong criticism of the product is not abuse." },
  { value: "personal_info", label: "Shares personal information", hint: "A phone number, address or someone's full name." },
  { value: "not_about_product", label: "Not about this product", hint: "About delivery of another order, the weather, or something else." },
  { value: "suspected_fake", label: "Looks fake", hint: "You have a real reason to think the person did not receive or use it." },
] as const;
const REASON_LABEL: Record<string, string> = Object.fromEntries([...HIDE_REASONS.map((r) => [r.value, r.label]), ["fake", "Looks fake"]]);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Stars({ value }: { value: number }) {
  return (
    <span role="img" aria-label={`${value} out of 5 stars`} className="inline-flex text-lg leading-none">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} aria-hidden className={cn("bx", n <= value ? "bxs-star text-warning" : "bx-star text-muted-foreground/50")} />
      ))}
    </span>
  );
}

function Reviews() {
  const [filter, setFilter] = useState<Filter>("needs_reply");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [hiding, setHiding] = useState<Row | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      const { data, error } = await supabase.rpc("staff_reviews_list", { p_filter: filter, p_limit: PAGE, p_offset: offset });
      if (error || !data) return setState("missing");
      const d = data as { total: number; counts: Counts; reviews: Row[] };
      setTotal(d.total);
      setCounts(d.counts);
      setRows((prev) => (offset === 0 ? d.reviews : [...prev, ...d.reviews]));
      setState("ready");
    },
    [filter],
  );
  useEffect(() => {
    setState((s) => (s === "ready" ? s : "loading"));
    void load(0);
  }, [load]);

  const tabs: TabItem<Filter>[] = [
    { key: "needs_reply", label: "Needs a reply", count: counts?.needs_reply, tone: "warning" },
    { key: "low", label: "Low ratings", count: counts?.low, tone: "warning" },
    { key: "reported", label: "Reported", count: counts?.reported, tone: "warning" },
    { key: "hidden", label: "Hidden", count: counts?.hidden },
    { key: "all", label: "All", count: counts?.all },
  ];
  const empty: Record<Filter, [string, string]> = {
    needs_reply: ["Every review has an answer", "New reviews that nobody has replied to yet show here. A reply, especially to a bad review, shows other shoppers you care."],
    low: ["No low ratings", "Reviews of 1 or 2 stars show here."],
    reported: ["Nothing reported", "Reviews that readers report show here for you to look at."],
    hidden: ["Nothing is hidden", "Reviews you hide, and why, show here."],
    all: ["No reviews yet", "Reviews appear here once customers whose orders were delivered write them."],
  };

  return (
    <>
      <PageHead title="Reviews" subtitle="What customers say about what they received. Reply in public. Hide a review only for spam, abuse or personal information, never because it is negative." />

      {state === "missing" ? (
        <EmptyState icon="bx-error-circle" title="Reviews are not set up yet" hint="The database update 000024 has not been run. Run it in Supabase, then reload this page." />
      ) : (
        <>
          {counts && (
            <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Reviews at a glance">
              {[
                ["Average rating", counts.all > 0 ? `${counts.avg.toFixed(1)} / 5` : "—"],
                ["Reviews", String(counts.all)],
                ["Need a reply", String(counts.needs_reply)],
                ["Low ratings", String(counts.low)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-[#262626] bg-card/60 p-4">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <FilterTabs label="Show reviews" items={tabs} value={filter} onChange={setFilter} />

          <div className="mt-5 grid gap-4">
            {state === "loading" ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)
            ) : rows.length === 0 ? (
              <EmptyState icon="bx-star" title={empty[filter][0]} hint={empty[filter][1]} />
            ) : (
              rows.map((r) => <ReviewCard key={r.id} r={r} onChanged={() => void load(0)} onHide={() => setHiding(r)} />)
            )}
            {state === "ready" && total > rows.length && (
              <button type="button" onClick={() => void load(rows.length)} className={cn(btn.ghost, "justify-self-center")}>
                Show more ({total - rows.length} more)
              </button>
            )}
          </div>
        </>
      )}

      {hiding && (
        <HideSheet
          row={hiding}
          onClose={() => setHiding(null)}
          onDone={() => {
            setHiding(null);
            void load(0);
          }}
        />
      )}
    </>
  );
}

function ReviewCard({ r, onChanged, onHide }: { r: Row; onChanged: () => void; onHide: () => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(r.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc(fn, args);
    setBusy(false);
    if (e) return setError(e.message);
    toast.success(ok);
    onChanged();
    return true;
  };
  const saveReply = async () => {
    if ((await run("reply_to_review", { p_review: r.id, p_text: text }, text.trim() ? "Reply saved. The customer was told." : "Reply removed.")) === true) setReplying(false);
  };
  const items: MenuItem[] = [
    ...(r.status === "published" ? [{ label: "Hide review…", icon: "bx-hide", danger: true, onSelect: onHide }] : [{ label: "Show again", icon: "bx-show", onSelect: () => void run("moderate_review", { p_review: r.id, p_hide: false, p_reason: null }, "The review is showing again.") }]),
    ...(r.reports.length > 0 ? [{ label: "Dismiss reports", icon: "bx-check-shield", onSelect: () => void run("dismiss_review_reports", { p_review: r.id }, "Reports dismissed. The review stays.") }] : []),
  ];
  return (
    <article aria-label={`Review of ${r.product_name} by ${r.name}, ${r.rating} out of 5`} className={cn("rounded-2xl border bg-card/60 p-4 md:p-5", r.status === "hidden" ? "border-[#262626] opacity-80" : "border-[#262626]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Stars value={r.rating} />
          <p className="mt-1 text-sm text-muted-foreground">
            <a href={`/product/${encodeURIComponent(r.product_id)}#reviews`} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
              {r.product_name}
            </a>
            {" · "}
            {r.name}
            {r.email ? ` (${r.email})` : ""}
            {" · "}
            {dateOf(r.created_at)} ({ago(r.created_at)} ago){r.edited ? " · edited" : ""}
            {r.helpful > 0 ? ` · ${r.helpful} found it helpful` : ""}
          </p>
        </div>
        <ActionMenu label={`Actions for the review by ${r.name}`} items={items} />
      </div>

      {(r.status === "hidden" || r.reports.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.status === "hidden" && <span className="rounded-full bg-white/10 px-3 py-1 text-xs">Hidden: {REASON_LABEL[r.hidden_reason ?? ""] ?? "no reason recorded"}</span>}
          {r.reports.length > 0 && (
            <span className="rounded-full bg-warning/15 px-3 py-1 text-xs text-warning">
              {r.reports.length} {r.reports.length === 1 ? "report" : "reports"}: {[...new Set(r.reports.map((x) => REASON_LABEL[x.reason] ?? x.reason))].join(", ")}
            </span>
          )}
        </div>
      )}
      {r.reports.some((x) => x.note) && (
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground" aria-label="Notes from the people who reported it">
          {r.reports.filter((x) => x.note).map((x, i) => (
            <li key={i}>“{x.note}”</li>
          ))}
        </ul>
      )}

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{r.body}</p>

      {r.reply && !replying && (
        <div className="mt-3 rounded-xl border-l-4 border-primary bg-white/5 p-3" aria-label="The store's reply">
          <p className="text-xs text-muted-foreground">Your reply{r.reply_at ? ` · ${dateOf(r.reply_at)}` : ""}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{r.reply}</p>
        </div>
      )}

      {replying ? (
        <div className="mt-3 grid gap-2">
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`reply-${r.id}`}>Your public reply</label>
            <textarea id={`reply-${r.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={4} placeholder="Thank them, say sorry if it fell short, and say what you will do." className={cn(field, "h-auto py-2")} />
            <span className="text-right text-xs text-muted-foreground">{1000 - text.length} left</span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void saveReply()} className={btn.primary}>
              {busy ? "Saving…" : "Save reply"}
            </button>
            {r.reply && (
              <button type="button" disabled={busy} onClick={() => void run("reply_to_review", { p_review: r.id, p_text: "" }, "Reply removed.").then(() => setReplying(false))} className={btn.dangerQuiet}>
                Remove reply
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => { setReplying(false); setText(r.reply ?? ""); setError(""); }} className={btn.ghost}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setReplying(true)} className={btn.ghost}>
            <i aria-hidden className="bx bx-reply text-lg" /> {r.reply ? "Edit reply" : "Reply"}
          </button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function HideSheet({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc("moderate_review", { p_review: row.id, p_hide: true, p_reason: reason });
    setBusy(false);
    if (e) return setError(e.message);
    toast.success("The review is hidden. The customer was told why.");
    onDone();
  };
  return (
    <AdminSheet
      open
      onClose={busy ? () => undefined : onClose}
      title="Hide this review?"
      subtitle={`${row.rating}-star review of ${row.product_name} by ${row.name}`}
      footer={
        <div className="grid gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btn.ghost} disabled={busy} onClick={onClose}>
              Keep it showing
            </button>
            <button type="button" className={btn.danger} disabled={busy || !reason} onClick={() => void go()}>
              {busy ? "Hiding…" : "Hide review"}
            </button>
          </div>
        </div>
      }
    >
      <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">A review cannot be hidden for being negative. Honest criticism stays, and the best answer to it is a reply. Hide only for one of these reasons.</p>
      <fieldset className="mt-4 grid gap-2">
        <legend className="mb-1 text-sm font-medium">Why?</legend>
        {HIDE_REASONS.map((r) => (
          <label key={r.value} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3", reason === r.value ? "border-foreground/60 bg-white/5" : "border-[#262626]")}>
            <input type="radio" name="hide-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="mt-1 size-4" />
            <span>
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-xs text-muted-foreground">{r.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-4 text-sm text-muted-foreground">The customer is told that it was hidden and why, and can edit it and write it again.</p>
    </AdminSheet>
  );
}
