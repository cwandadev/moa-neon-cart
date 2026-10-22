/**
 * Notifications carry a "kind" like "order_new" or "stock_low". The first word says what it is about, and that is how the Notifications
 * page groups and filters them. Kinds that are not listed here still work: they are named after their first word ("Review" for "review_new").
 */
export type Category = { key: string; label: string; icon: string };

const KNOWN: Record<string, { label: string; icon: string }> = {
  order: { label: "Orders", icon: "bx-receipt" },
  orders: { label: "Orders", icon: "bx-receipt" },
  payment: { label: "Payments", icon: "bx-credit-card" },
  payments: { label: "Payments", icon: "bx-credit-card" },
  paid: { label: "Payments", icon: "bx-credit-card" },
  refund: { label: "Refunds", icon: "bx-undo" },
  refunds: { label: "Refunds", icon: "bx-undo" },
  stock: { label: "Stock", icon: "bx-package" },
  inventory: { label: "Stock", icon: "bx-package" },
  chat: { label: "Chats", icon: "bx-message-dots" },
  chats: { label: "Chats", icon: "bx-message-dots" },
  message: { label: "Chats", icon: "bx-message-dots" },
  conversation: { label: "Chats", icon: "bx-message-dots" },
  support: { label: "Chats", icon: "bx-message-dots" },
  delivery: { label: "Deliveries", icon: "bx-trip" },
  dispatch: { label: "Deliveries", icon: "bx-trip" },
  shipping: { label: "Deliveries", icon: "bx-trip" },
  customer: { label: "Customers", icon: "bx-user" },
  signup: { label: "Customers", icon: "bx-user" },
  user: { label: "Team", icon: "bx-group" },
  staff: { label: "Team", icon: "bx-group" },
  system: { label: "System", icon: "bx-cog" },
  security: { label: "System", icon: "bx-shield" },
};

export function categoryOf(kind: string): Category {
  const word = (kind || "other").toLowerCase().split(/[^a-z0-9]+/)[0] || "other";
  const hit = KNOWN[word];
  if (hit) return { key: hit.label, label: hit.label, icon: hit.icon };
  const label = word.charAt(0).toUpperCase() + word.slice(1);
  return { key: label, label, icon: "bx-bell" };
}

/** The word shown on a notification that is not just information. */
export const URGENCY: Partial<Record<string, string>> = { critical: "Needs action", warning: "Take a look" };
