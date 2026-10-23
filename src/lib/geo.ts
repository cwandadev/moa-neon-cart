/**
 * Where is this device? Asking a browser for its location can fail in five different ways, and each needs different advice, so this says which one it was:
 *   unsupported  this browser has no location feature at all
 *   insecure     the page is not on https (browsers only allow location on secure pages)
 *   policy       the website's own settings (a Permissions-Policy header) forbid it, which looks exactly like "denied"
 *   denied       the person (or their phone) said no for this site
 *   unavailable  the device has no way to find itself: common on computers without GPS, and in browsers with no location service
 *   timeout      it took too long
 * It first asks for a quick answer from the network (which works on computers), and only then for the GPS (which phones can give, but slowly).
 * It never gives up while the browser is still waiting for the person to tap "Allow": the time limit only starts once permission is given.
 */
export type Where = { lat: number; lng: number; accuracy: number | null };
export type GeoFailure = "unsupported" | "insecure" | "policy" | "denied" | "unavailable" | "timeout";
export type GeoResult = { ok: true; where: Where } | { ok: false; reason: GeoFailure; detail: string };

/** What to tell the person, and what they can do about it. */
export const GEO_HELP: Record<GeoFailure, string> = {
  unsupported: "This browser cannot find your location. Choose it on the map instead.",
  insecure: "Your location only works on a secure (https) page. Choose it on the map instead.",
  policy: "This website's settings block location. Choose it on the map instead, and tell the shop so it can be fixed.",
  denied: "Location is blocked for this site. Tap the lock icon next to the address, allow Location, and try again, or choose it on the map instead.",
  unavailable: "This device cannot work out where it is (many computers cannot). Choose it on the map instead.",
  timeout: "Finding you took too long. Move near a window and try again, or choose it on the map instead.",
};

type PolicyApi = { allowsFeature: (f: string) => boolean };

function blockedByPolicy(): boolean {
  try {
    const d = document as unknown as { permissionsPolicy?: PolicyApi; featurePolicy?: PolicyApi };
    const p = d.permissionsPolicy ?? d.featurePolicy;
    return p ? !p.allowsFeature("geolocation") : false;
  } catch {
    return false;
  }
}

async function permission(): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  try {
    const s = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return s?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

function attempt(options: PositionOptions): Promise<GeoResult> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, where: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null } }),
      (e) => resolve({ ok: false, reason: e?.code === 1 ? "denied" : e?.code === 3 ? "timeout" : "unavailable", detail: e?.message ?? "" }),
      options,
    );
  });
}

/** A browser that never answers (some in-app browsers) must not leave the screen waiting for ever. A minute is long enough to read a permission question and tap Allow. */
const GIVE_UP_MS = 60_000;

export function locate(opts: { quick?: boolean } = {}): Promise<GeoResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<GeoResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout", detail: "The browser did not answer." }), GIVE_UP_MS);
  });
  return Promise.race([find(opts), giveUp]).finally(() => clearTimeout(timer));
}

async function find(opts: { quick?: boolean }): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { ok: false, reason: "unsupported", detail: "No geolocation in this browser." };
  if (typeof window !== "undefined" && window.isSecureContext === false) return { ok: false, reason: "insecure", detail: "The page is not on https." };
  if (blockedByPolicy()) return { ok: false, reason: "policy", detail: "Blocked by the page's Permissions-Policy." };
  if ((await permission()) === "denied") return { ok: false, reason: "denied", detail: "Location is blocked for this site." };

  // For a quick extra reading (the rider's phone while completing a delivery): one attempt, a few seconds.
  if (opts.quick) return attempt({ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });

  const first = await attempt({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  if (first.ok && (first.where.accuracy ?? 0) <= 300) return first;
  if (!first.ok && first.reason === "denied") return first;
  const second = await attempt({ enableHighAccuracy: true, timeout: first.ok ? 12000 : 20000, maximumAge: 0 });
  if (second.ok) return first.ok && (first.where.accuracy ?? 1e9) < (second.where.accuracy ?? 1e9) ? first : second;
  if (first.ok) return first; // a rough answer is better than none: the screen says it is rough
  if (second.reason === "denied") return second;
  return first.reason === "unavailable" && second.reason === "timeout" ? first : second;
}

/** Just the position, or nothing. For places where the location is an extra and a failure should stay quiet. */
export async function getPosition(): Promise<Where | null> {
  const r = await locate({ quick: true });
  return r.ok ? r.where : null;
}

// ---------- typed or pasted places ----------

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PAIR = new RegExp(`${NUM}\\s*[,;\\s]\\s*${NUM}`);
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Coordinates from what someone pastes: "-1.9441, 30.0619", or a Google Maps address that contains them
 * (…/@-1.9441,30.0619,17z, …?q=-1.9441,30.0619, …!3d-1.9441!4d30.0619). A short link (maps.app.goo.gl/…) does not contain them, so it gives null.
 */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.replace(/\u2212/g, "-").trim().replace(/%(?![0-9a-f]{2})/gi, "%25"));
  const bang = new RegExp(`!3d${NUM}!4d${NUM}`).exec(t);
  const at = new RegExp(`@${NUM},${NUM}`).exec(t);
  const query = new RegExp(`[?&](?:q|ll|query|destination|center)=${NUM}\\s*,\\s*${NUM}`).exec(t);
  const plain = /^[\s(]*[-\d]/.test(t) && !/https?:/i.test(t) ? PAIR.exec(t) : null;
  for (const m of [bang, at, query, plain]) {
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (valid(lat, lng)) return { lat, lng };
  }
  return null;
}
