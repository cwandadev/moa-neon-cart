import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { btn, field } from "@/components/admin/controls";
import { failLabel, mapLink, telLink } from "@/lib/delivery";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Person = { first_name: string; last_name: string; phone?: string | null } | null;
type DeliveryRow = {
  id: string;
  status: "assigned" | "picked_up" | "delivered" | "failed";
  code: string;
  code_attempts: number;
  assigned_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
  failed_note: string | null;
  proof_path: string | null;
  proof_distance_m: number | null;
  proof_flag: "far_from_pin" | "no_location" | "no_pin" | null;
  override_reason: string | null;
  verified_by: "code" | "photo" | "office" | null;
  needs_review: boolean;
  fallback_reason: string | null;
  received_by: string | null;
  rider: Person;
};
type EventRow = { id: string; event: string; detail: Record<string, unknown> | null; created_at: string; actor: Person };
type RiderOption = { id: string; first_name: string; last_name: string };
type WarehouseOption = { id: string; name: string; address: string };
/** Goods for this order that are in another warehouse and must be moved to the one it is filled from. */
type Transfer = {
  id: string;
  qty: number;
  status: "requested" | "received" | "cancelled";
  from_warehouse: string;
  to_warehouse: string;
  products: { name: string } | null;
  product_variants: { option1: string | null; option2: string | null } | null;
};

export type PanelOrder = { id: string; code: string; fulfilment_status: string; lat: number | null; lng: number | null; warehouse_id?: string | null };

const nameOf = (p: Person | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() || "A rider" : "Someone");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const FALLBACK_TEXT: Record<string, string> = {
  no_phone: "The customer had no phone or no battery",
  code_not_working: "The customer could not find or read the code",
  someone_else: "Someone else received it",
};

const FLAG_TEXT: Record<string, string> = {
  far_from_pin: "The rider was far from the customer's pin when completing. Worth a look.",
  no_location: "The rider's phone did not share its location, so the place could not be checked.",
  no_pin: "The customer shared no pin, so the place could not be checked.",
};

function eventText(e: EventRow): string {
  const who = nameOf(e.actor);
  const d = e.detail ?? {};
  switch (e.event) {
    case "taken":
      return `${who} took the order`;
    case "assigned":
      return `${who} assigned a rider`;
    case "reassigned":
      return `${who} gave it to another rider`;
    case "unassigned":
      return `${who} took the rider off`;
    case "released":
      return `${who} gave the order back`;
    case "picked_up":
      return `${who} collected it from the shop`;
    case "code_wrong":
      return `Wrong code entered (attempt ${String(d["attempt"] ?? "")})`;
    case "code_reset":
      return `${who} unlocked the code`;
    case "delivered":
      return "Delivered with the customer's code";
    case "delivered_no_code":
      return `Delivered without a code: ${FALLBACK_TEXT[String(d["reason"] ?? "")] ?? "no code"}. Received by ${String(d["received_by"] ?? "someone")}`;
    case "reviewed":
      return `${who} checked the photo`;
    case "warehouse_changed":
      return `${who} changed where it is collected: ${String(d["warehouse"] ?? "")}`;
    case "failed":
      return `Could not deliver: ${failLabel(String(d["reason"] ?? ""))}${d["note"] ? `. ${String(d["note"])}` : ""}`;
    case "override_delivered":
      return `${who} marked it delivered: ${String(d["reason"] ?? "")}`;
    default:
      return e.event;
  }
}

/** Everything about how an order is getting to the customer, and what the office can do about it. */
export function DeliveryPanel({ order, onChanged }: { order: PanelOrder; onChanged: () => void }) {
  const [delivery, setDelivery] = useState<DeliveryRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [riders, setRiders] = useState<RiderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [pickWarehouse, setPickWarehouse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const [d, e, r, w, t] = await Promise.all([
      supabase
        .from("deliveries")
        .select(
          "id, status, code, code_attempts, assigned_at, picked_up_at, delivered_at, failed_reason, failed_note, proof_path, proof_distance_m, proof_flag, override_reason, verified_by, needs_review, fallback_reason, received_by, rider:profiles!deliveries_rider_id_fkey(first_name, last_name, phone)",
        )
        .eq("order_id", order.id)
        .maybeSingle(),
      supabase
        .from("delivery_events")
        .select("id, event, detail, created_at, actor:profiles!delivery_events_actor_id_fkey(first_name, last_name)")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, first_name, last_name").eq("role", "rider").order("first_name"),
      supabase.from("warehouses").select("id, name, address").eq("active", true).order("name"),
      // Needs migration 000023: without it there is simply nothing to show here.
      supabase.from("stock_transfers").select("id, qty, status, from_warehouse, to_warehouse, products(name), product_variants(option1, option2)").eq("order_id", order.id).order("created_at", { ascending: true }),
    ]);
    setDelivery((d.data as unknown as DeliveryRow | null) ?? null);
    setEvents(((e.data as unknown as EventRow[] | null) ?? []).slice(-30));
    setRiders((r.data as RiderOption[] | null) ?? []);
    setWarehouses((w.data as WarehouseOption[] | null) ?? []);
    setTransfers(t.error ? [] : ((t.data as unknown as Transfer[] | null) ?? []));
    setLoaded(true);
  }, [order.id]);

  useEffect(() => {
    setLoaded(false);
    setShowCode(false);
    setOverride(false);
    setReason("");
    setPick("");
    setPickWarehouse("");
    void load();
  }, [load, order.fulfilment_status]);

  // The proof photo is private: it is shown through a link that works for a few minutes.
  const proof = delivery?.proof_path ?? null;
  useEffect(() => {
    setPhotoUrl(null);
    if (!proof) return;
    let cancelled = false;
    void supabase.storage
      .from("delivery-proofs")
      .createSignedUrl(proof, 300)
      .then(({ data }) => {
        if (!cancelled) setPhotoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [proof]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(ok);
    await load();
    onChanged();
    return true;
  };

  const status = order.fulfilment_status;
  const waiting = transfers.filter((t) => t.status === "requested");
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "the other warehouse";
  if (!["confirmed", "out_for_delivery", "delivered"].includes(status) && !delivery) return null;
  if (!loaded) return <section aria-label="Delivery" className="mt-6 h-24 animate-pulse rounded-2xl border border-[#262626] bg-white/[0.03]" />;

  const canAssign = !delivery || delivery.status === "assigned" || delivery.status === "failed";
  const canMoveWarehouse = (status === "confirmed" || status === "out_for_delivery") && (!delivery || delivery.status === "assigned" || delivery.status === "failed");
  const here = warehouses.find((w) => w.id === order.warehouse_id);
  const canOverride = status === "confirmed" || status === "out_for_delivery";
  const label = !delivery
    ? status === "confirmed"
      ? "Waiting for a rider"
      : "No rider"
    : delivery.status === "assigned"
      ? "Assigned, not collected yet"
      : delivery.status === "picked_up"
        ? "On the way"
        : delivery.status === "delivered"
          ? "Delivered"
          : "Delivery failed";
  const tone = !delivery ? "text-warning" : delivery.status === "failed" ? "text-destructive" : delivery.status === "delivered" ? "text-success" : "text-info";

  return (
    <section aria-label="Delivery" className="mt-6 grid gap-4 rounded-2xl border border-[#262626] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-medium">Delivery</h3>
        <span className={cn("text-sm font-medium", tone)}>{label}</span>
      </div>

      {waiting.length > 0 && (
        <div role="status" className="grid gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <div>
            <p className="font-medium text-warning">Waiting for items</p>
            <p className="mt-1 text-muted-foreground">
              {waiting.length === 1 ? "This item is" : "These items are"} in another warehouse. Move {waiting.length === 1 ? "it" : "them"} to {warehouseName(waiting[0]!.to_warehouse)}, then mark {waiting.length === 1 ? "it" : "them"} received. The order cannot go to a rider until then.
            </p>
          </div>
          <ul className="grid gap-2" aria-label="Items to move">
            {waiting.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/30 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">
                    {t.qty} × {t.products?.name ?? "An item"}
                    {t.product_variants ? ` (${[t.product_variants.option1, t.product_variants.option2].filter(Boolean).join(" / ")})` : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">from {warehouseName(t.from_warehouse)}</span>
                </span>
                <button type="button" className={btn.ghost} disabled={busy} onClick={() => void run("receive_transfer", { p_id: t.id }, "Marked as received.")}>
                  It has arrived
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(here || canMoveWarehouse) && warehouses.length > 0 && (
        <div className="grid gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Collected from: </span>
            {here ? <span>{here.name}{here.address ? ` · ${here.address}` : ""}</span> : <span className="text-muted-foreground">not chosen yet</span>}
          </p>
          {canMoveWarehouse && warehouses.length > 1 && (
            <div className="flex gap-2">
              <label htmlFor={`wh-${order.id}`} className="sr-only">
                Collect from another warehouse
              </label>
              <select id={`wh-${order.id}`} className={cn(field, "min-w-0 flex-1")} value={pickWarehouse} onChange={(e) => setPickWarehouse(e.target.value)}>
                <option value="">Collect from another warehouse…</option>
                {warehouses.filter((w) => w.id !== order.warehouse_id).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button type="button" className={btn.ghost} disabled={busy || !pickWarehouse} onClick={() => void run("admin_set_order_warehouse", { p_order_id: order.id, p_warehouse_id: pickWarehouse }, "The collection point was changed.")}>
                Change
              </button>
            </div>
          )}
        </div>
      )}

      {delivery && (
        <div className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Rider: </span>
            {nameOf(delivery.rider)}
            {delivery.rider?.phone && (
              <>
                {" · "}
                <a className="underline-offset-4 hover:underline" href={telLink(delivery.rider.phone)}>
                  {delivery.rider.phone}
                </a>
              </>
            )}
          </p>
          {order.lat !== null && order.lng !== null ? (
            <p>
              <span className="text-muted-foreground">Customer pin: </span>
              <a className="underline-offset-4 hover:underline" href={mapLink(order.lat, order.lng)} target="_blank" rel="noreferrer">
                Open in Maps
              </a>
            </p>
          ) : (
            <p className="text-muted-foreground">The customer shared no map pin.</p>
          )}
          {delivery.status === "picked_up" && (
            <p>
              <span className="text-muted-foreground">Customer&apos;s code: </span>
              {showCode ? (
                <span className="font-display font-semibold tracking-widest">{delivery.code}</span>
              ) : (
                <button type="button" className="underline-offset-4 hover:underline" onClick={() => setShowCode(true)}>
                  Show (for a customer who lost it)
                </button>
              )}
              {delivery.code_attempts > 0 && <span className="ml-2 text-warning">{delivery.code_attempts} wrong {delivery.code_attempts === 1 ? "try" : "tries"}</span>}
            </p>
          )}
        </div>
      )}

      {delivery?.status === "failed" && delivery.failed_reason && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {failLabel(delivery.failed_reason)}
          {delivery.failed_note ? `. ${delivery.failed_note}` : ""}. {delivery.failed_reason === "cancelled" ? "" : "Give it to a rider again, or cancel the order."}
        </p>
      )}

      {delivery?.status === "delivered" && (
        <div className="grid gap-2">
          <p className={cn("text-sm", delivery.verified_by === "photo" ? "font-medium text-warning" : "text-muted-foreground")}>
            {delivery.verified_by === "photo"
              ? "Delivered without the code: checked by a photo"
              : delivery.verified_by === "office"
                ? "Marked delivered by the office"
                : "Delivered with the customer's code"}
          </p>
          {delivery.verified_by === "photo" && (
            <p className="text-sm text-muted-foreground">
              {FALLBACK_TEXT[delivery.fallback_reason ?? ""] ?? "The code could not be used"}. Received by {delivery.received_by ?? "someone"}.
            </p>
          )}
          {delivery.proof_flag && (
            <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {FLAG_TEXT[delivery.proof_flag]}
              {delivery.proof_flag === "far_from_pin" && delivery.proof_distance_m !== null ? ` (about ${delivery.proof_distance_m} m away)` : ""}
            </p>
          )}
          {delivery.override_reason && <p className="text-sm text-muted-foreground">Marked delivered by the office: {delivery.override_reason}</p>}
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer" aria-label="Open the proof photo">
              <img src={photoUrl} alt="Proof of delivery" className="max-h-64 w-full rounded-xl border border-[#262626] object-cover" />
            </a>
          ) : delivery.proof_path ? (
            <p className="text-sm text-muted-foreground">Loading the photo…</p>
          ) : null}
          {delivery.needs_review && (
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void run("admin_review_delivery", { p_order_id: order.id }, "Marked as checked.")}>
              I checked the photo: all is well
            </button>
          )}
        </div>
      )}

      {canAssign && riders.length > 0 && (
        <div className="grid gap-2">
          <label htmlFor={`assign-${order.id}`} className="text-sm text-muted-foreground">
            {delivery ? "Give it to another rider" : "Or give it to a rider yourself"}
          </label>
          <div className="flex gap-2">
            <select id={`assign-${order.id}`} className={cn(field, "min-w-0 flex-1")} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a rider…</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {`${r.first_name} ${r.last_name}`.trim() || "Rider"}
                </option>
              ))}
            </select>
            <button type="button" className={btn.ghost} disabled={busy || !pick} onClick={() => void run("admin_assign_delivery", { p_order_id: order.id, p_rider: pick }, "Rider assigned.")}>
              Assign
            </button>
          </div>
        </div>
      )}
      {canAssign && riders.length === 0 && <p className="text-sm text-muted-foreground">There are no riders yet. Add one on the Riders page.</p>}

      {delivery && delivery.status === "assigned" && (
        <button type="button" className={btn.quiet} disabled={busy} onClick={() => void run("admin_unassign_delivery", { p_order_id: order.id }, "The rider was taken off. Anyone can take it now.")}>
          Take the rider off
        </button>
      )}
      {delivery && delivery.status === "failed" && delivery.failed_reason !== "cancelled" && (
        <button type="button" className={btn.quiet} disabled={busy} onClick={() => void run("admin_unassign_delivery", { p_order_id: order.id }, "Back in the list of orders waiting for a rider.")}>
          Put it back in the list for any rider
        </button>
      )}
      {delivery?.status === "picked_up" && delivery.code_attempts >= 5 && (
        <button type="button" className={btn.ghost} disabled={busy} onClick={() => void run("admin_reset_code_attempts", { p_order_id: order.id }, "The code is unlocked.")}>
          Unlock the code
        </button>
      )}

      {canOverride && (
        <div className="grid gap-2 border-t border-[#262626] pt-4">
          {!override ? (
            <button type="button" className={btn.quiet} onClick={() => setOverride(true)}>
              Mark delivered without the code…
            </button>
          ) : (
            <>
              <label htmlFor={`why-${order.id}`} className="text-sm text-muted-foreground">
                Why? This is saved in the order&apos;s history.
              </label>
              <textarea id={`why-${order.id}`} rows={2} maxLength={300} className={cn(field, "py-2")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the customer collected it at the shop" />
              <div className="flex justify-end gap-2">
                <button type="button" className={btn.ghost} onClick={() => setOverride(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={btn.primary}
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => void run("admin_mark_delivered", { p_order_id: order.id, p_reason: reason.trim() }, `${order.code} marked delivered.`).then((ok) => ok && setOverride(false))}
                >
                  Mark delivered
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {events.length > 0 && (
        <ol aria-label="Delivery history" className="grid gap-2 border-t border-[#262626] pt-4 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3">
              <span>{eventText(e)}</span>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.created_at}>
                {when(e.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
