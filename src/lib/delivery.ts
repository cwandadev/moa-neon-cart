/**
 * Shared bits of the delivery feature: the shapes the database functions return, links that open Google Maps and the phone,
 * a phone camera photo shrunk before it is uploaded, and the phone's location.
 */

export type RiderItem = { name: string; variant_label: string | null; image: string; qty: number };

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
  customer_name: string;
  phone: string;
  location: string;
  preferred_time: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  items: RiderItem[];
};

export type AvailableOrder = { order_id: string; code: string; items: number; ready_since: string; distance_km: number | null };

export type PickupPoint = { name: string; address: string; phone: string; lat: number | null; lng: number | null };

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

export const failLabel = (reason: string | null): string =>
  reason === "cancelled" ? "The order was cancelled" : FAIL_REASONS.find(([v]) => v === reason)?.[1] ?? "Could not be delivered";

// ---------- links ----------

/** Opens the Google Maps app straight into navigation (or the route in the browser). Needs no key. Uses the exact pin when there is one. */
export function navigateLink(to: { lat?: number | null | undefined; lng?: number | null | undefined; text?: string | null | undefined }): string {
  const hasPin = typeof to.lat === "number" && typeof to.lng === "number";
  const destination = hasPin ? `${to.lat},${to.lng}` : `${(to.text ?? "").trim()}, Kigali, Rwanda`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
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

// ---------- location ----------

export type Where = { lat: number; lng: number; accuracy: number | null };

/** The phone's location, or null when it is refused, switched off or too slow. Never throws. */
export function getPosition(timeoutMs = 10000): Promise<Where | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let settled = false;
    const done = (v: Where | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => done(null), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        done({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

