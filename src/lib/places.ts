/**
 * Finding a place by name (a building, a shop, a street), and naming a spot on the map.
 * Both use Photon, a search made for typing-as-you-go over OpenStreetMap, with a bias towards where the map is looking.
 * It knows what OpenStreetMap knows: a mapped building or shop is found, but a business nobody has put on the map is not (Google has its own
 * private list of businesses; this does not). Photon's public server is for fair use: if the shop grows a lot, point PHOTON_URL at your own.
 * If Photon is down, naming a spot falls back to Nominatim.
 */
export const PHOTON_URL = "https://photon.komoot.io";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org";

export type Place = { lat: number; lng: number; label: string; detail: string; /** The whole name, for an address field: "Simba Supermarket, KG 7 Ave, Kimihurura". */ full: string };

type Props = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const unique = (parts: string[]): string[] => parts.filter((p, i) => p !== "" && parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
const kind = (p: Props): string => {
  const v = text(p["osm_value"]).replace(/_/g, " ");
  return v === "" || ["yes", "house", "residential", "road"].includes(v) ? "" : v.charAt(0).toUpperCase() + v.slice(1);
};

/** The name of a place, and a line to tell it apart from others with the same name. */
export function describe(p: Props): { label: string; detail: string; full: string } {
  const street = unique([text(p["street"]), text(p["housenumber"])]).join(" ");
  const area = text(p["district"]) || text(p["locality"]) || text(p["suburb"]);
  const town = text(p["city"]) || text(p["county"]) || text(p["state"]);
  const name = text(p["name"]);
  const label = name || street || area || town || "A place";
  const where = unique([name ? street : "", area, town]).filter((x) => x.toLowerCase() !== label.toLowerCase());
  const k = kind(p);
  return { label, detail: unique([k, ...where]).join(" · "), full: unique([label, ...where]).join(", ") };
}

type Feature = { geometry?: { coordinates?: [number, number] }; properties?: Props };

const toPlace = (f: Feature): Place | null => {
  const c = f.geometry?.coordinates;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const p = f.properties ?? {};
  const cc = text(p["countrycode"]);
  if (cc !== "" && cc.toUpperCase() !== "RW") return null; // this shop delivers in Rwanda
  return { lat: c[1], lng: c[0], ...describe(p) };
};

async function getJson(url: string, signal?: AbortSignal, ms = 6000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Places matching what has been typed so far, those near `near` first. Never throws: no answer is an empty list. */
export async function searchPlaces(query: string, near: { lat: number; lng: number }, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const url = `${PHOTON_URL}/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&lat=${near.lat.toFixed(5)}&lon=${near.lng.toFixed(5)}&location_bias_scale=0.4`;
    const data = (await getJson(url, signal)) as { features?: Feature[] };
    const seen = new Set<string>();
    const places: Place[] = [];
    for (const f of data.features ?? []) {
      const p = toPlace(f);
      if (!p) continue;
      const key = `${p.label}|${p.detail}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(p);
      if (places.length === 8) break;
    }
    return places;
  } catch {
    return [];
  }
}

/** What to call this spot ("Simba Supermarket, KG 7 Ave, Kimihurura"), or null when nothing can say. */
export async function describePlace(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  const join = (p: Props, extra: string[] = []) => unique([text(p["name"]), unique([text(p["street"]), text(p["housenumber"])]).join(" "), text(p["district"]) || text(p["locality"]) || text(p["suburb"]), text(p["city"]) || text(p["county"]), ...extra]).slice(0, 3).join(", ");
  try {
    const data = (await getJson(`${PHOTON_URL}/reverse?lon=${lng.toFixed(6)}&lat=${lat.toFixed(6)}&lang=en&limit=1`, signal, 4000)) as { features?: Feature[] };
    const p = data.features?.[0]?.properties;
    const label = p ? join(p) : "";
    if (label) return label;
  } catch {
    /* fall through to the second source */
  }
  try {
    const data = (await getJson(`${NOMINATIM_URL}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`, signal, 4000)) as { name?: string; address?: Props };
    const a = data.address ?? {};
    const label = unique([text(data.name), unique([text(a["road"]), text(a["house_number"])]).join(" "), text(a["suburb"]) || text(a["neighbourhood"]) || text(a["quarter"]), text(a["city"]) || text(a["town"]) || text(a["village"])]).slice(0, 3).join(", ");
    return label || null;
  } catch {
    return null;
  }
}
