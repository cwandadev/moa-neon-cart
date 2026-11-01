import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { searchGuide, type Block, type Entry, type Guide, type Topic } from "@/lib/help";
import { cn } from "@/lib/utils";

/**
 * One of the guides (see src/lib/help.ts), as a page: a search box, shortcuts to each topic, and the answers, which open and close.
 * A link ending in #the-entry-id opens that answer and scrolls to it, so a person can be sent straight to one.
 */
const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/**
 * A sentence with its links. A link is written [words](/page) in the guide. It is a real anchor (so search engines can follow it and it opens in a
 * new tab if asked to), and inside the app a plain click moves to the page without a reload.
 */
function Inline({ text }: { text: string }) {
  const router = useRouter({ warn: false }) as { navigate: (o: { to: never }) => unknown } | undefined;
  const out: Array<string | ReactElement> = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, label = "", path = "/"] = m;
    out.push(text.slice(last, m.index));
    out.push(
      <a
        key={`${m.index}-${path}`}
        href={path}
        onClick={(e) => {
          if (!router || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          void router.navigate({ to: path as never });
        }}
        className="font-medium text-primary underline underline-offset-4 hover:no-underline"
      >
        {label}
      </a>,
    );
    last = (m.index ?? 0) + whole.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function BlockView({ b }: { b: Block }) {
  if ("text" in b)
    return (
      <p className="font-body text-sm leading-relaxed">
        <Inline text={b.text} />
      </p>
    );
  if ("note" in b)
    return (
      <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 font-body text-sm leading-relaxed text-warning">
        <i aria-hidden className="bx bx-info-circle mt-0.5 shrink-0 text-lg" />
        <span>
          <Inline text={b.note} />
        </span>
      </p>
    );
  if ("steps" in b)
    return (
      <ol className="grid list-decimal gap-1.5 pl-5 font-body text-sm leading-relaxed marker:font-semibold marker:text-muted-foreground">
        {b.steps.map((s) => (
          <li key={s}>
            <Inline text={s} />
          </li>
        ))}
      </ol>
    );
  return (
    <ul className="grid list-disc gap-1.5 pl-5 font-body text-sm leading-relaxed marker:text-muted-foreground">
      {b.bullets.map((s) => (
        <li key={s}>
          <Inline text={s} />
        </li>
      ))}
    </ul>
  );
}

function EntryView({ entry, topic, open, showTopic }: { entry: Entry; topic: Topic; open: boolean; showTopic: boolean }) {
  return (
    <details id={entry.id} open={open} className="group scroll-mt-24 rounded-2xl border border-border bg-card/60 open:bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 font-display text-base font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          {showTopic && <span className="mb-0.5 block font-body text-xs font-normal text-muted-foreground">{topic.title}</span>}
          {entry.q}
        </span>
        <i aria-hidden className="bx bx-chevron-down shrink-0 text-2xl text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 px-4 pb-4 pt-1">
        {entry.a.map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
      </div>
    </details>
  );
}

export function HelpCenter({ guide, heading = true, className }: { guide: Guide; heading?: boolean; className?: string }) {
  const [term, setTerm] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const searching = term.trim().length > 0;
  const results = useMemo(() => searchGuide(guide, term), [guide, term]);

  // A link that ends in #an-answer opens that answer.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id || !guide.topics.some((t) => t.entries.some((e) => e.id === id) || t.id === id)) return;
    const topicHit = guide.topics.find((t) => t.id === id);
    setTarget(topicHit ? null : id);
    requestAnimationFrame?.(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }));
  }, [guide]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <div role="region" aria-label={guide.title} className={cn("grid gap-6", className)}>
      {heading && (
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{guide.title}</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">{guide.subtitle}</p>
        </header>
      )}

      <div role="search" className="relative">
        <i aria-hidden className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-muted-foreground" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search this guide"
          placeholder="Search, for example: code, refund, location"
          autoComplete="off"
          className="h-12 w-full rounded-2xl border border-border bg-card pl-10 pr-10 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
        />
        {searching && (
          <button type="button" aria-label="Clear the search" onClick={() => setTerm("")} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-xl text-muted-foreground hover:text-foreground">
            <i aria-hidden className="bx bx-x text-xl" />
          </button>
        )}
      </div>

      {!searching && (
        <nav aria-label="Topics" className="-mt-2 flex flex-wrap gap-2">
          {guide.topics.map((t) => (
            <button key={t.id} type="button" onClick={() => jump(t.id)} className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-body text-sm transition-colors hover:bg-secondary">
              <i aria-hidden className={cn("bx text-lg text-muted-foreground", t.icon)} />
              {t.title}
            </button>
          ))}
        </nav>
      )}

      {searching ? (
        <section aria-label="Search results" className="grid gap-3">
          <p role="status" className="font-body text-sm text-muted-foreground">
            {results.length === 0 ? "No answer found." : `${results.length} ${results.length === 1 ? "answer" : "answers"} found.`}
          </p>
          {results.map(({ topic, entry }) => (
            <EntryView key={entry.id} entry={entry} topic={topic} showTopic open={results.length <= 3} />
          ))}
          {results.length === 0 && <p className="font-body text-sm">Try one short word, such as the name of a button. If it is not here, see below.</p>}
        </section>
      ) : (
        guide.topics.map((t) => (
          <section key={t.id} id={t.id} aria-labelledby={`${t.id}-h`} className="grid scroll-mt-24 gap-3">
            <h2 id={`${t.id}-h`} className="flex items-center gap-2 font-display text-lg font-semibold">
              <i aria-hidden className={cn("bx text-2xl text-muted-foreground", t.icon)} />
              {t.title}
            </h2>
            {t.intro && <p className="font-body text-sm text-muted-foreground">{t.intro}</p>}
            {t.entries.map((e) => (
              <EntryView key={e.id} entry={e} topic={t} showTopic={false} open={target === e.id} />
            ))}
          </section>
        ))
      )}

      <aside aria-label="More help" className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-4">
        <i aria-hidden className="bx bx-support mt-0.5 shrink-0 text-2xl text-primary" />
        <p className="font-body text-sm leading-relaxed">{guide.stuck}</p>
      </aside>
    </div>
  );
}
