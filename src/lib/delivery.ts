/**
 * Shared bits of the delivery feature: the shapes the database functions return, links that open Google Maps and the phone,
 * and a phone camera photo shrunk before it is uploaded. (Finding the phone's location lives in geo.ts.)
 */
export { getPosition, type Where } from "@/lib/geo";

export type Warehouse = { name: string; address: string; phone: string; lat: number | null; lng: number | null };

/**
 * What a rider's phone is told about a delivery. Never what is in the parcel and never a price. The customer's details are empty
 * (null) until the parcel has been collected.
 */
export type RiderDelivery = {
  order_id: string;
  code: string;
  status: "assigned" | "picked_up" | "delivered" | "failed";
  order_status: string;
  assigned_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  failed_reason: string | null;
  attempts_left: number;
  verified_by: "code" | "photo" | "office" | null;
  warehouse: Warehouse | null;
  customer_name: string | null;
  phone: string | null;
  location: string | null;
  preferred_time: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
};

export type AvailableOrder = { order_id: string; code: string; ready_since: string; warehouse: string | null; distance_km: number | null };

export type Pin = { lat: number; lng: number; accuracy: number | null };

/** What the customer's order page needs to know about the delivery. */
export type CustomerDelivery = {
  has_rider: boolean;
  status?: "assigned" | "picked_up" | "delivered" | "failed";
  pin: boolean;
  rider_first_name?: string;
  rider_phone?: string | null;
  code?: string | null;
  delivered_at?: string | null;
};

export const FAIL_REASONS: Array<[value: "no_answer" | "wrong_address" | "refused" | "other", label: string]> = [
  ["no_answer", "The customer did not answer"],
  ["wrong_address", "The address is wrong or unclear"],
  ["refused", "The customer refused the order"],
  ["other", "Something else"],
];

/** When the customer cannot give the code. */
export const FALLBACK_REASONS: Array<[value: "no_phone" | "code_not_working" | "someone_else", label: string]> = [
  ["no_phone", "The customer has no phone or no battery"],
  ["code_not_working", "The customer cannot find or read the code"],
  ["someone_else", "Someone else is receiving it"],
];

export const failLabel = (reason: string | null): string =>
  reason === "cancelled" ? "The order was cancelled" : FAIL_REASONS.find(([v]) => v === reason)?.[1] ?? "Could not be delivered";

// ---------- links ----------

type Place = { lat?: number | null | undefined; lng?: number | null | undefined; text?: string | null | undefined };

/** A pin when there is one, otherwise the address with the country added (never a city: a warehouse in Musanze is not in Kigali). */
const place = (p: Place): string => {
  if (typeof p.lat === "number" && typeof p.lng === "number") return `${p.lat},${p.lng}`;
  const t = (p.text ?? "").trim();
  return t === "" ? "Kigali, Rwanda" : /rwanda/i.test(t) ? t : `${t}, Rwanda`;
};

/** Turn-by-turn directions from wherever the rider is now. Google Maps decides the start because none is given: it opens its app straight into navigation. */
export function navigateLink(to: Place): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place(to))}&travelmode=driving&dir_action=navigate`;
}

/** The whole trip on one map: from the warehouse to the customer. Because the start is given, Google Maps shows it as a route preview. */
export function routeLink(from: Place, to: Place): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(place(from))}&destination=${encodeURIComponent(place(to))}&travelmode=driving`;
}

/** Just shows a point on the map (for the office). */
export function mapLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

/** A phone number a phone can dial. Rwandan numbers written as 07… become +2507… */
export function telLink(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("250")) return `tel:+${digits}`;
  if (digits.startsWith("0")) return `tel:+250${digits.slice(1)}`;
  return `tel:${digits}`;
}

/** Straight-line distance between two points, in kilometres. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A sensible order for several stops: always the nearest one next, starting from where the parcels were collected.
 * Stops with no map pin cannot be placed, so they come last, in the order they were given. It is a straight-line guess, not a road route:
 * it only decides which stop is shown first, and the rider can open any of them.
 */
export function suggestOrder<T extends { lat: number | null; lng: number | null }>(stops: T[], from: { lat: number; lng: number } | null): T[] {
  const placed = stops.filter((s): s is T & { lat: number; lng: number } => s.lat !== null && s.lng !== null);
  const rest = stops.filter((s) => s.lat === null || s.lng === null);
  const out: T[] = [];
  let here = from ?? (placed[0] ? { lat: placed[0].lat, lng: placed[0].lng } : null);
  const left = [...placed];
  while (left.length > 0 && here) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (haversineKm(here, left[i]!) < haversineKm(here, left[best]!)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next!);
    here = { lat: next!.lat, lng: next!.lng };
  }
  return [...out, ...rest];
}

export const kmLabel = (km: number | null): string | null => (km === null ? null : km < 1 ? "Under 1 km" : `About ${km} km`);

// ---------- the photo ----------

/** A new place in the private photo bucket: the order's own folder, a name nobody can guess. */
export function proofPath(orderId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${orderId}/${Date.now()}-${rand}.jpg`;
}

/** Shrinks a phone photo (often 4 to 8 MB) to about a few hundred KB, so it uploads quickly on mobile data. */
export async function shrinkPhoto(file: Blob, maxSide = 1280, quality = 0.72): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return out && out.size > 0 && out.size < file.size ? out : out ?? file;
  } catch {
    return file;
  }
}
