import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Header } from "@/components/shop/Header";
import { SITE } from "@/lib/site";

/** The same page layout for every policy page: breadcrumb, title, last-updated date and readable text. */
export function PolicyPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-8 sm:px-6 md:pb-16 md:pt-12">
        <nav className="font-body text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground/80">{title}</span>
        </nav>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        {intro && <p className="mt-3 font-body text-base leading-relaxed text-muted-foreground">{intro}</p>}
        <p className="mt-2 font-body text-xs text-muted-foreground">Last updated {SITE.policyUpdated}</p>
        <div className="mt-10 grid gap-9">{children}</div>
      </main>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-2.5 grid gap-3 font-body text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid list-disc gap-1.5 pl-5 marker:text-primary/60">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** The business details, written the same way everywhere. */
export function Business() {
  return (
    <>
      {SITE.name}, operated by {SITE.legalName}, {SITE.address.street}, {SITE.address.city}, {SITE.address.country}.
    </>
  );
}
