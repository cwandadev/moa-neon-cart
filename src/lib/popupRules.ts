/**
 * When a popup should and should not appear. A notification is always added to the list (and counted on the badges); these rules only decide
 * whether it also interrupts the person with a popup.
 *
 *  - Only the tab the person is looking at shows it. With the shop and the admin open in two tabs, each one used to show its own copy.
 *  - Not when the open page already shows the news: a popup about "/orders/MOA-4801" while that order is open, about the admin Orders page while
 *    the admin Orders page is open, or about anything while a Notifications list is open (the new row appears in it live).
 */

/** The path part of an address: "/orders/MOA-1?from=x#top" is "/orders/MOA-1". */
export const pathOf = (link: string | null | undefined): string => (link ?? "").split(/[?#]/)[0] ?? "";

const trimmed = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** The lists of notifications: anything new shows up in them as it arrives. */
const LISTS = ["/notifications", "/admin/notifications"];

export const tabIsVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";

/** True when the page that is open already shows what the link points at (or is a notifications list). */
export const pageShowsIt = (link: string | null | undefined, here: string = typeof window === "undefined" ? "" : window.location.pathname): boolean => {
  const page = trimmed(here);
  if (LISTS.includes(page)) return true;
  const target = trimmed(pathOf(link));
  return target !== "" && target === page;
};

export const shouldPopup = (link: string | null | undefined): boolean => tabIsVisible() && !pageShowsIt(link);
