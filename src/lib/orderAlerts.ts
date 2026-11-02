import { useMemo } from "react";
import { markMany, useNotifications, type Notif } from "@/lib/notifications";

/**
 * Order updates. Every notification about an order points at it (/orders/MOA-4801), so what is new about each order can be worked out from the
 * unread notifications themselves: no extra table and no extra request. A badge on an order, a count on My orders and the "What's new" box on the
 * order all read from here, and opening the order marks its updates seen.
 */

/** Where a notification points: "/orders/MOA-4801" is order "MOA-4801". Anything else is not about an order. */
export const orderCodeOf = (link: string | null | undefined): string | null => {
  const m = /^\/orders\/([^/?#]+)/.exec(link ?? "");
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
};

/** What happened, in the words a shopper would use. A kind not listed here is shown by its own title. */
export const UPDATE_WORDS: Record<string, string> = {
  order_placed: "Order received",
  order_confirmed: "Order confirmed",
  order_shipping: "On its way",
  order_delivered: "Delivered",
  order_cancelled: "Cancelled",
  payment_paid: "Payment received",
  payment_failed: "Payment failed",
  payment_expired: "Payment time ran out",
  refund_done: "Refund sent",
  review_invite: "Tell us how it went",
};
export const updateWords = (n: Pick<Notif, "kind" | "title">): string => UPDATE_WORDS[n.kind] ?? n.title;

export type OrderAlert = { code: string; items: Notif[]; unread: number; latest: Notif };

/** The orders that have something new: one entry per order, from the unread notifications that point at it. */
export function orderAlertsOf(items: readonly Notif[]): Map<string, OrderAlert> {
  const out = new Map<string, OrderAlert>();
  for (const n of items) {
    if (n.read_at) continue;
    const code = orderCodeOf(n.link);
    if (!code) continue;
    const a = out.get(code);
    if (a) {
      a.items.push(n);
      a.unread += 1;
      if (n.created_at > a.latest.created_at) a.latest = n;
    } else out.set(code, { code, items: [n], unread: 1, latest: n });
  }
  return out;
}

export function useOrderAlerts() {
  const { items } = useNotifications();
  return useMemo(() => {
    const by = orderAlertsOf(items);
    let total = 0;
    for (const a of by.values()) total += a.unread;
    return { by, orders: by.size, total };
  }, [items]);
}

/** Marks every update of the given orders as seen. */
export function markOrdersSeen(alerts: Iterable<OrderAlert>): void {
  const ids = [...alerts].flatMap((a) => a.items.map((n) => n.id));
  if (ids.length > 0) void markMany(ids, true);
}
