import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchCategoryNames } from "@/lib/catalog";
import { categorySlug } from "@/lib/categories";
import { CATEGORIES } from "@/lib/products";
import { useStore } from "@/lib/store";
import { SITE } from "@/lib/site";

/** Pages that are not part of the shop front: no footer there. */
const HIDDEN = ["/admin", "/login", "/register", "/forgot-password", "/reset-password"];

const head = "font-body text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground";
const link = "font-body text-sm text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setChatOpen } = useStore();
  // The page starts with the built-in list (so search engines see the links), then uses the live list.
  const [categories, setCategories] = useState<string[]>([...CATEGORIES]);
  useEffect(() => {
    let cancelled = false;
    fetchCategoryNames()
      .then((c) => {
        if (!cancelled && c.length > 0) setCategories(c);
      })
      .catch(() => {
        /* keep the built-in list */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 pb-28 pt-12 sm:px-6 md:pb-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-9 w-9 shrink-0" />
              <span className="font-display text-xl font-semibold tracking-tight">
                MOA <span className="text-gradient">Mart</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs font-body text-sm leading-relaxed text-muted-foreground">{SITE.tagline}</p>
            <ul className="mt-5 grid gap-2.5 font-body text-sm text-muted-foreground">
              <li className="flex items-start gap-2.5">
                <i className="bx bx-map mt-0.5 text-lg text-foreground/70" />
                <span>
                  {SITE.address.street}, {SITE.address.city}, {SITE.address.country}
                </span>
              </li>
              <li>
                <a href={`tel:${SITE.phone}`} className="flex items-center gap-2.5 transition-colors hover:text-foreground">
                  <i className="bx bx-phone text-lg text-foreground/70" /> {SITE.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={`mailto:${SITE.email}`} className="flex items-center gap-2.5 transition-colors hover:text-foreground">
                  <i className="bx bx-envelope text-lg text-foreground/70" /> {SITE.email}
                </a>
              </li>
            </ul>
          </div>

          <nav aria-label="Shop by category">
            <p className={head}>Shop</p>
            <ul className="mt-4 grid gap-2.5">
              {categories.map((c) => (
                <li key={c}>
                  <Link to="/shop/$category" params={{ category: categorySlug(c) }} className={link}>
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Your account">
            <p className={head}>Your account</p>
            <ul className="mt-4 grid gap-2.5">
              <li>
                <Link to="/orders" className={link}>
                  My orders
                </Link>
              </li>
              <li>
                <Link to="/wishlist" className={link}>
                  Saved items
                </Link>
              </li>
              <li>
                <Link to="/notifications" className={link}>
                  Notifications
                </Link>
              </li>
              <li>
                <Link to="/account" className={link}>
                  Account
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Help">
            <p className={head}>Help</p>
            <ul className="mt-4 grid gap-2.5">
              <li>
                <Link to="/contact" className={link}>
                  Contact us
                </Link>
              </li>
              <li>
                <button type="button" onClick={() => setChatOpen(true)} className={link}>
                  Chat with us
                </button>
              </li>
              <li>
                <Link to="/delivery" className={link}>
                  Delivery
                </Link>
              </li>
              <li>
                <Link to="/returns" className={link}>
                  Returns and refunds
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <p className={head}>Legal</p>
            <ul className="mt-4 grid gap-2.5">
              <li>
                <Link to="/privacy-policy" className={link}>
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className={link}>
                  Terms of service
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 font-body text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.legalName}. {SITE.name} is operated by {SITE.legalName}.
          </p>
          <p>Pay with MTN MoMo or Airtel Money · Delivery in {SITE.address.city}</p>
        </div>
      </div>
    </footer>
  );
}
