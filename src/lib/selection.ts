import { canRemove, stageOf, type OrderLike, type Stage } from "@/lib/orderStage";

/** Orders that can be part of a selection: unpaid ones (cancel) and finished ones (remove, buy again). */
export const isPickableStage = (s: Stage) => s === "to_pay" || canRemove(s);

export function isPickableOrder(o: OrderLike): boolean {
  return isPickableStage(stageOf(o));
}

/** What can be done with the selected orders. Each action only lists the orders it applies to. */
export function orderSelectionActions<T extends OrderLike>(rows: T[], canHide: boolean) {
  const cancelable = rows.filter((r) => stageOf(r) === "to_pay");
  const finished = rows.filter((r) => canRemove(stageOf(r)));
  return { cancelable, removable: canHide ? finished : [], rebuyable: finished };
}

/** What can be done with the selected notifications. */
export function notificationSelectionActions<T extends { read_at: string | null }>(rows: T[], canDismiss: boolean) {
  return {
    markRead: rows.filter((n) => !n.read_at),
    markUnread: rows.filter((n) => Boolean(n.read_at)),
    deletable: canDismiss ? rows : [],
  };
}
