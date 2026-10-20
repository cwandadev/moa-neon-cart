/** One clear status for an order, worked out from the payment, delivery and refund columns. */
export type Stage = "to_pay" | "preparing" | "on_the_way" | "delivered" | "cancelled" | "expired";

export type OrderLike = {
  payment_status: string;
  fulfilment_status: string;
  refund_status?: string | null;
};

export function stageOf(o: OrderLike): Stage {
  if (o.fulfilment_status === "cancelled") return o.payment_status === "expired" ? "expired" : "cancelled";
  if (o.payment_status === "expired") return "expired";
  // Once an order has gone out or been delivered, that is what the customer sees, even if the payment was never recorded.
  if (o.fulfilment_status === "delivered") return "delivered";
  if (o.fulfilment_status === "out_for_delivery") return "on_the_way";
  if (o.payment_status === "awaiting_payment" || o.payment_status === "failed") return "to_pay";
  return "preparing";
}

export const STAGE: Record<Stage, { label: string; pill: string; step: number }> = {
  to_pay: { label: "To pay", pill: "bg-warning/10 text-warning", step: 0 },
  preparing: { label: "Preparing", pill: "bg-info/10 text-info", step: 1 },
  on_the_way: { label: "On the way", pill: "bg-primary/10 text-primary", step: 2 },
  delivered: { label: "Delivered", pill: "bg-success/10 text-success", step: 3 },
  cancelled: { label: "Cancelled", pill: "bg-destructive/10 text-destructive", step: -1 },
  expired: { label: "Expired", pill: "bg-muted text-muted-foreground", step: -1 },
};

/** A short extra line for cancelled orders that were paid. */
export function refundNote(o: OrderLike): string {
  if (
    (o.fulfilment_status === "delivered" || o.fulfilment_status === "out_for_delivery") &&
    (o.payment_status === "awaiting_payment" || o.payment_status === "failed")
  ) {
    return "Payment not recorded";
  }
  if (o.fulfilment_status !== "cancelled") return "";
  if (o.refund_status === "pending") return "Refund in progress";
  if (o.refund_status === "completed") return "Refunded";
  if (o.refund_status === "failed") return "Refund needs attention, we will contact you";
  return "";
}

/** Finished orders can be removed from the customer's own list. */
export const canRemove = (s: Stage) => s === "delivered" || s === "cancelled" || s === "expired";
