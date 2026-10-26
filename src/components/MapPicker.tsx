import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { haversineKm } from "@/lib/delivery";
import { GEO_HELP, locate } from "@/lib/geo";
import { describePlace, searchPlaces, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

/**
 * Choose a place on a map: search for a building or shop, or move the map until the pin is on the exact spot. No GPS and no key needed.
 * It opens on SATELLITE imagery (with the names of places on top), which is how people recognise their own roof; "Map" shows the streets.
 *
 * What makes it quick to use (the things people know from Google Maps, Uber and Bolt):
 *  - the spot under the pin is NAMED as you move ("Simba Supermarket, KG 7 Ave, Kimihurura"), before you confirm;
 *  - a blue dot and circle show where you are, and how far this spot is from you;
 *  - zoom is smooth and follows your fingers or the pointer; the map glides when you let go; moves are animated, not jumps;
 *  - a tap anywhere puts the pin there; the pin lifts while the map moves;
 *  - the search box offers "Use my current location" and the places you chose before;
 *  - a scale bar; and it opens on where you are when the browser already allows that.
 * Imagery is Esri's and the map is OpenStreetMap's: both are fine for a shop's light use, but they are third parties' public servers, so if traffic
 * grows a lot, change the addresses in LAYERS to a paid tile provider. Search and names are Photon (see places.ts).
 * When a spot is confirmed it is also NAMED, so a form can fill its address field.
 */
export type Layer = "satellite" | "map";
export const LAYERS: Record<Layer, { name: string; url: string; labels: string | null; max: number; credit: string }> = {
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    max: 18,
    credit: "Imagery © Esri, Maxar, Earthstar Geographics",
  },
  map: { name: "Map", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", labels: null, max: 19, credit: "© OpenStreetMap contributors" },
};
export const TILE_URL = LAYERS.map.url;
const LAYER_KEY = "moa:map:layer";
const RECENT_KEY = "moa:map:recent";
const LAST_KEY = "moa:map:last";
const T = 256;
const MIN_Z = 3;
const KIGALI = { lat: -1.9441, lng: 30.0619 };

// Web Mercator: the same maths every web map uses.
export const worldX = (lng: number, z: number) => ((lng + 180) / 360) * T * 2 ** z;
export const worldY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z;
};
export const lngAt = (x: number, z: number) => (x / (T * 2 ** z)) * 360 - 180;
export const latAt = (y: number, z: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / (T * 2 ** z)));
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const clampY = (y: number, zoom: number) => clamp(y, 0, T * 2 ** zoom);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const src = (template: string, z: number, x: number, y: number) => template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
const key4 = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
/** Moves are jumps, not glides, for people who asked their device for less motion (and where the browser cannot say). */
const instant = () => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
const lengthLabel = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
const kmLabel = (km: number) => (km < 0.95 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

const savedLayer = (): Layer => {
  try {
    return localStorage.getItem(LAYER_KEY) === "map" ? "map" : "satellite";
  } catch {
    return "satellite";
  }
};
type Recent = { lat: number; lng: number; label: string };
const loadRecents = (): Recent[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
    return Array.isArray(list) ? list.filter((r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lng) && typeof r?.label === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
};
const loadLast = (): { lat: number; lng: number } | null => {
  try {
    const r = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as { lat: number; lng: number } | null;
    return r && Number.isFinite(r.lat) && Number.isFinite(r.lng) && !(r.lat === 0 && r.lng === 0) ? r : null;
  } catch {
    return null;
  }
};

export type Picked = { lat: number; lng: number; /** What the spot is called, or null when nothing could say. */ label?: string | null };
type View = { lat: number; lng: number; z: number };
type Me = { lat: number; lng: number; accuracy: number | null };
type Addr = { status: "loading" | "done" | "none"; label: string | null };

export function MapPicker({
  initial,
  onPick,
  onClose,
  title = "Choose the place",
}: {
  initial?: { lat: number; lng: number } | null;
  onPick: (p: Picked) => void;
  onClose: () => void;
  title?: string;
}) {
  const known = initial && !(initial.lat === 0 && initial.lng === 0) ? initial : null;
  const [layer, setLayer] = useState<Layer>(savedLayer);
  const cfg = LAYERS[layer];
  const [startAt] = useState(() => {
    const last = known ? null : loadLast();
    const at = known ?? last ?? KIGALI;
    return { lat: at.lat, lng: at.lng, z: Math.min(known ? 17 : last ? 16 : 14, cfg.max) };
  });
  const [view, setViewState] = useState<View>(startAt);
  const viewRef = useRef(view);
  const maxRef = useRef(cfg.max);
  maxRef.current = cfg.max;
  const [size, setSize] = useState({ w: 360, h: 420 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const [chosen, setChosen] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [addr, setAddr] = useState<Addr>({ status: "loading", label: null });
  const [lifted, setLifted] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const showStart = focused && q.trim() === "" && !chosen;
  const listOpen = useRef(false);
  listOpen.current = results.length > 0 || showStart;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ t0: number; x0: number; y0: number; moved: boolean; pinched: boolean; samples: Array<{ t: number; x: number; y: number }> } | null>(null);
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const wheelWindow = useRef({ t: 0, sum: 0 });
  const raf = useRef(0);
  const interacted = useRef(false);
  const labels = useRef(new Map<string, Promise<string | null>>());

  // The one place the view changes: kept in a ref too, so several moves in one event add up.
  const setView = useCallback((next: View | ((p: View) => View)) => {
    const v = typeof next === "function" ? next(viewRef.current) : next;
    const out = { lat: clamp(v.lat, -85, 85), lng: wrapLng(v.lng), z: clamp(v.z, MIN_Z, maxRef.current) };
    viewRef.current = out;
    setViewState(out);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The map is drawn at the top level of the page, not inside the sheet that opened it: a sheet that has slid into place becomes the frame of
  // reference for "fixed" things, so a map drawn inside it only covers the sheet. Out here it covers the screen, and two things need care.
  //  - A sheet like checkout traps the keyboard focus inside itself and counts a tap elsewhere as "close". Presses and focus inside the map
  //    are therefore kept from reaching the page-level listeners that do that (after the map's own handlers have run).
  //  - Escape closes the map (or first the list of results), and nothing else: it is caught first, so the sheet underneath stays open.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus moving INTO the map is announced on the thing it LEAVES (a button in the sheet), so look at where it is going as well as where it is.
    const inside = (e: Event) => root.current?.contains(e.target as Node) === true || (e instanceof FocusEvent && root.current?.contains(e.relatedTarget as Node) === true);
    const keep = (e: Event) => {
      if (inside(e)) e.stopPropagation();
    };
    const kinds = ["focusin", "focusout", "pointerdown", "mousedown", "touchstart"];
    for (const k of kinds) document.body.addEventListener(k, keep);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (listOpen.current) {
        setResults([]);
        setFocused(false);
      } else closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const k of kinds) document.body.removeEventListener(k, keep);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      cancelAnimationFrame?.(raf.current);
      if (opener?.isConnected) opener.focus(); // back to the button that opened the map, so a keyboard or screen reader user is not lost
    };
  }, []);

  // ----- moving about -----
  const stopAnim = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  };
  /** Glides to a place and zoom, in about a third of a second (or jumps, when the device asked for less motion). */
  const animateTo = (to: View, ms = 320) => {
    stopAnim();
    if (instant() || typeof requestAnimationFrame !== "function" || ms <= 0) return setView(to);
    const from = viewRef.current;
    const [fx, fy, tx, ty] = [worldX(from.lng, 0), worldY(from.lat, 0), worldX(to.lng, 0), worldY(to.lat, 0)];
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / ms, 0, 1);
      const e = ease(t);
      setView({ z: from.z + (to.z - from.z) * e, lat: latAt(fy + (ty - fy) * e, 0), lng: lngAt(fx + (tx - fx) * e, 0) });
      raf.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  };
  const goTo = (lat: number, lng: number, zoom: number) => animateTo({ lat, lng, z: clamp(zoom, MIN_Z, maxRef.current) });
  /** One whole level in or out, about the middle (the buttons, + and -, a double tap). */
  const zoomBy = (d: number) => {
    const v = viewRef.current;
    const nz = clamp(Math.round(v.z) + d, MIN_Z, maxRef.current);
    if (nz !== v.z) animateTo({ ...v, z: nz }, 240);
  };
  const panBy = (dx: number, dy: number) =>
    setView((v) => {
      const cx = worldX(v.lng, v.z) - dx;
      const cy = clampY(worldY(v.lat, v.z) - dy, v.z);
      return { ...v, lat: latAt(cy, v.z), lng: lngAt(cx, v.z) };
    });
  /** Zooms so the place under (px, py) stays under the finger or pointer: how every good map zooms. */
  const zoomAround = (nz: number, px: number, py: number) =>
    setView((v) => {
      const z2 = clamp(nz, MIN_Z, maxRef.current);
      const { w, h } = sizeRef.current;
      const pLat = latAt(worldY(v.lat, v.z) + (py - h / 2), v.z);
      const pLng = lngAt(worldX(v.lng, v.z) + (px - w / 2), v.z);
      const cx = worldX(pLng, z2) - (px - w / 2);
      const cy = clampY(worldY(pLat, z2) - (py - h / 2), z2);
      return { z: z2, lat: latAt(cy, z2), lng: lngAt(cx, z2) };
    });
  const pointOf = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const latLngAt = (px: number, py: number) => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    return { lat: latAt(worldY(v.lat, v.z) + (py - h / 2), v.z), lng: lngAt(worldX(v.lng, v.z) + (px - w / 2), v.z) };
  };
  const fling = (vx: number, vy: number) => {
    stopAnim();
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 32);
      last = now;
      const decay = 0.94 ** (dt / 16);
      vx *= decay;
      vy *= decay;
      panBy(vx * dt, vy * dt);
      raf.current = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  };

  const pickLayer = (l: Layer) => {
    if (l === layer) return;
    setLayer(l);
    try {
      localStorage.setItem(LAYER_KEY, l);
    } catch {
      /* not saved: it is only a preference */
    }
    maxRef.current = LAYERS[l].max;
    setView((v) => v);
  };

  // A press on one of the map's own buttons (zoom, my location) or its link is not a drag: capturing the mouse would swallow the click.
  const onControl = (e: { target: EventTarget | null }) => e.target instanceof Element && e.target.closest("button, a, input") !== null;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (onControl(e)) return;
    stopAnim();
    interacted.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = performance.now();
    if (pointers.current.size === 1) gesture.current = { t0: now, x0: e.clientX, y0: e.clientY, moved: false, pinched: false, samples: [{ t: now, x: e.clientX, y: e.clientY }] };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: pointOf({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
      if (gesture.current) gesture.current.pinched = true;
    }
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1 && g) {
      panBy(e.clientX - prev.x, e.clientY - prev.y);
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 6) g.moved = true;
      const now = performance.now();
      g.samples.push({ t: now, x: e.clientX, y: e.clientY });
      while (g.samples.length > 2 && now - g.samples[0]!.t > 100) g.samples.shift();
    } else if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = pointOf({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      panBy(mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y); // two fingers moving together also move the map
      zoomAround(viewRef.current.z + Math.log2(dist / pinch.current.dist), mid.x, mid.y);
      pinch.current = { dist, mid };
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    pinch.current = null;
    const g = gesture.current;
    if (pointers.current.size > 0 || !g) return;
    gesture.current = null;
    if (g.pinched) return;
    const now = performance.now();
    if (!g.moved && now - g.t0 < 400) {
      // a tap: the pin goes there
      const p = pointOf(e);
      const at = latLngAt(p.x, p.y);
      animateTo({ ...at, z: viewRef.current.z }, 260);
      return;
    }
    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    if (first && last && last !== first && now - last.t < 80 && !instant()) {
      const dt = Math.max(1, last.t - first.t);
      const vx = (last.x - first.x) / dt;
      const vy = (last.y - first.y) / dt;
      if (Math.hypot(vx, vy) > 0.35) fling(vx, vy);
    }
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 100;
    stopAnim();
    if (e.key === "ArrowLeft") panBy(step, 0);
    else if (e.key === "ArrowRight") panBy(-step, 0);
    else if (e.key === "ArrowUp") panBy(0, step);
    else if (e.key === "ArrowDown") panBy(0, -step);
    else if (e.key === "+" || e.key === "=") zoomBy(1);
    else if (e.key === "-") zoomBy(-1);
    else return;
    e.preventDefault();
  };

  // ----- search as you type: buildings, shops and streets, those near the map first -----
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || (chosen && term === chosen.label)) {
      setResults([]);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      const v = viewRef.current;
      const found = await searchPlaces(term, { lat: v.lat, lng: v.lng }, ctl.signal);
      if (ctl.signal.aborted) return;
      setResults(found);
      setActive(-1);
      setSearching(false);
      setNote(found.length === 0 ? "Nothing found with that name. Try the street or neighbourhood, or move the map to the spot." : "");
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const choose = (p: { lat: number; lng: number; full: string }) => {
    interacted.current = true;
    setChosen({ lat: p.lat, lng: p.lng, label: p.full });
    setQ(p.full);
    setResults([]);
    setFocused(false);
    setNote("");
    goTo(p.lat, p.lng, 17);
  };
  const searchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      choose(results[Math.max(0, active)]!);
    }
  };

  // ----- where I am -----
  const found = (where: { lat: number; lng: number; accuracy?: number | null }) => {
    setMe({ lat: where.lat, lng: where.lng, accuracy: where.accuracy ?? null });
    goTo(where.lat, where.lng, 17);
  };
  const mine = async () => {
    setBusy(true);
    setNote("");
    setFocused(false);
    const r = await locate();
    setBusy(false);
    if (r.ok) found(r.where);
    else setNote(GEO_HELP[r.reason]);
  };
  // Opens on where they are, when the browser already allows it (nothing is asked), and they have not started moving the map themselves.
  useEffect(() => {
    if (known || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let live = true;
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then(async (s) => {
        if (!live || s.state !== "granted") return;
        const r = await locate({ quick: true });
        if (!live || !r.ok) return;
        if (interacted.current) setMe({ lat: r.where.lat, lng: r.where.lng, accuracy: r.where.accuracy ?? null });
        else found(r.where);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- naming the spot under the pin, once the map has settled -----
  const lat = round6(view.lat);
  const lng = round6(wrapLng(view.lng));
  const resolveLabel = (la: number, ln: number) => {
    const k = key4(la, ln);
    let p = labels.current.get(k);
    if (!p) {
      p = describePlace(la, ln).catch(() => null);
      labels.current.set(k, p);
      void p.then((v) => {
        if (v === null) labels.current.delete(k);
      });
    }
    return p;
  };
  const atChosen = chosen !== null && haversineKm(chosen, { lat, lng }) < 0.03;
  useEffect(() => {
    if (atChosen && chosen) {
      setAddr({ status: "done", label: chosen.label });
      return;
    }
    setAddr((a) => (a.status === "loading" && a.label === null ? a : { status: "loading", label: null }));
    let live = true;
    const t = setTimeout(async () => {
      const label = await resolveLabel(lat, lng);
      if (live) setAddr({ status: label ? "done" : "none", label });
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, atChosen]);

  // The pin lifts while the map is moving, and drops when it stops.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLifted(true);
    const t = setTimeout(() => setLifted(false), 220);
    return () => clearTimeout(t);
  }, [view.lat, view.lng, view.z]);

  const confirm = async () => {
    let label: string | null;
    // If the spot is still where the chosen search result is, that result's name is the best name for it.
    if (atChosen && chosen) label = chosen.label;
    else {
      setConfirming(true);
      label = await resolveLabel(lat, lng);
      setConfirming(false);
    }
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ lat, lng }));
      if (label) {
        const next = [{ lat, lng, label }, ...recents.filter((r) => haversineKm(r, { lat, lng }) > 0.03)].slice(0, 5);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      }
    } catch {
      /* not remembered: it only saves a search next time */
    }
    onPick({ lat, lng, label });
  };
  const forgetRecents = () => {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      /* nothing to forget */
    }
    setRecents([]);
  };

  // ----- what is drawn -----
  const zi = clamp(Math.round(view.z), MIN_Z, cfg.max);
  const s = 2 ** (view.z - zi);
  const n = 2 ** zi;
  const cx = worldX(view.lng, zi);
  const cy = worldY(view.lat, zi);
  const edgeX = (t: number) => Math.round(size.w / 2 + (t * T - cx) * s);
  const edgeY = (t: number) => Math.round(size.h / 2 + (t * T - cy) * s);
  const tiles: Array<{ key: string; base: string; names: string | null; x: number; y: number; w: number; h: number }> = [];
  for (let ty = Math.max(0, Math.floor((cy - size.h / 2 / s) / T)); ty <= Math.min(n - 1, Math.floor((cy + size.h / 2 / s) / T)); ty++) {
    for (let tx = Math.floor((cx - size.w / 2 / s) / T); tx <= Math.floor((cx + size.w / 2 / s) / T); tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${layer}/${zi}/${tx}/${ty}`, base: src(cfg.url, zi, wx, ty), names: cfg.labels ? src(cfg.labels, zi, wx, ty) : null, x: edgeX(tx), y: edgeY(ty), w: edgeX(tx + 1) - edgeX(tx), h: edgeY(ty + 1) - edgeY(ty) });
    }
  }
  const mpp = metresPerPixel(view.lat, view.z);
  const scaleM = [...NICE].reverse().find((m) => m / mpp <= 90) ?? NICE[0]!;
  const mePos = me ? { x: size.w / 2 + worldX(me.lng, view.z) - worldX(view.lng, view.z), y: size.h / 2 + worldY(me.lat, view.z) - worldY(view.lat, view.z) } : null;
  const meVisible = mePos !== null && mePos.x > -60 && mePos.x < size.w + 60 && mePos.y > -60 && mePos.y < size.h + 60;
  const meRadius = me?.accuracy ? me.accuracy / mpp : 0;
  const fromMe = me ? haversineKm(me, { lat, lng }) : null;
  const iconBtn = "grid size-11 place-items-center rounded-xl border border-border bg-card/95 text-lg shadow transition-colors hover:bg-secondary disabled:opacity-50";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} style={{ pointerEvents: "auto" }} className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="font-body text-xs text-muted-foreground">Search, tap the map, or drag it so the pin is on the exact spot.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the map" className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <i aria-hidden className="bx bx-x text-3xl" />
        </button>
      </div>

      <div className="border-b border-border px-4 py-2.5">
        <div className="relative">
          <i aria-hidden className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setChosen(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={searchKey}
            role="combobox"
            aria-expanded={results.length > 0 || showStart}
            aria-controls="place-results"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `place-${active}` : undefined}
            aria-label="Search for a place"
            placeholder="Search a building, shop or street"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
          />
          {searching ? (
            <i aria-hidden className="bx bx-loader-alt absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-xl text-muted-foreground" />
          ) : q !== "" ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => {
                setQ("");
                setChosen(null);
                setResults([]);
                setNote("");
              }}
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <i aria-hidden className="bx bx-x text-xl" />
            </button>
          ) : null}
        </div>
        {results.length > 0 && (
          <ul id="place-results" role="listbox" aria-label="Places found" className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
            {results.map((p, i) => (
              <li key={`${p.lat}-${p.lng}-${i}`} role="option" id={`place-${i}`} aria-selected={i === active}>
                <button type="button" onClick={() => choose(p)} className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary", i === active && "bg-secondary")}>
                  <i aria-hidden className="bx bx-map-pin mt-0.5 text-lg text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-body text-sm font-medium">{p.label}</span>
                    {p.detail && <span className="block truncate font-body text-xs text-muted-foreground">{p.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {showStart && results.length === 0 && (
          <ul id="place-results" role="listbox" aria-label="Quick choices" className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-card">
            <li role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void mine()} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary">
                <i aria-hidden className="bx bx-current-location text-xl text-[#4285f4]" />
                <span className="font-body text-sm font-medium">Use my current location</span>
              </button>
            </li>
            {recents.map((r) => (
              <li key={`${r.lat}-${r.lng}`} role="option" aria-selected={false}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose({ lat: r.lat, lng: r.lng, full: r.label })} className="flex w-full items-start gap-3 border-t border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary">
                  <i aria-hidden className="bx bx-history mt-0.5 text-lg text-muted-foreground" />
                  <span className="block min-w-0 truncate font-body text-sm">{r.label}</span>
                </button>
              </li>
            ))}
            {recents.length > 0 && (
              <li role="presentation" className="border-t border-border px-3 py-1.5 text-right">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={forgetRecents} className="font-body text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Clear recent places
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {note && (
        <p role="status" className="border-b border-border bg-warning/10 px-4 py-2 font-body text-xs text-warning">
          {note}
        </p>
      )}

      <div
        ref={box}
        role="application"
        aria-label="Map. Drag to move it, tap to put the pin there, use plus and minus to zoom."
        data-zoom={view.z.toFixed(3)}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onDoubleClick={(e) => !onControl(e) && zoomBy(1)}
        onWheel={(e) => {
          if (onControl(e)) return;
          stopAnim();
          interacted.current = true;
          // A hard flick of the wheel is one or two levels, not twenty.
          const now = Date.now();
          if (now - wheelWindow.current.t > 300) wheelWindow.current = { t: now, sum: 0 };
          const dz = clamp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0035), -0.5, 0.5);
          if (Math.abs(wheelWindow.current.sum + dz) > 1.5) return;
          wheelWindow.current.sum += dz;
          const p = pointOf(e);
          zoomAround(viewRef.current.z + dz, p.x, p.y);
        }}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[#1c2128] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {tiles.map((t) => (
          <span key={t.key} className="pointer-events-none absolute block" style={{ left: t.x, top: t.y, width: t.w, height: t.h }}>
            <img src={t.base} alt="" draggable={false} className="absolute inset-0 size-full max-w-none animate-in fade-in duration-200" />
            {t.names && <img src={t.names} alt="" draggable={false} data-names className="absolute inset-0 size-full max-w-none" onError={(e) => (e.currentTarget.style.display = "none")} />}
          </span>
        ))}

        {/* where I am: a blue dot, and a circle as wide as the position is uncertain */}
        {me && mePos && meVisible && (
          <>
            {meRadius > 14 && meRadius < 1500 && <span aria-hidden data-accuracy className="pointer-events-none absolute rounded-full border border-[#4285f4]/60 bg-[#4285f4]/15" style={{ left: mePos.x - meRadius, top: mePos.y - meRadius, width: meRadius * 2, height: meRadius * 2 }} />}
            <span aria-hidden data-me className="pointer-events-none absolute size-4 rounded-full border-2 border-white bg-[#4285f4] shadow-[0_0_0_4px_rgba(66,133,244,0.25)]" style={{ left: mePos.x - 8, top: mePos.y - 8 }} />
          </>
        )}

        {/* the pin: always in the middle, its tip on the chosen spot; it lifts while the map moves */}
        <span aria-hidden className={cn("pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 blur-[1px] transition-all duration-150", lifted ? "scale-125 opacity-70" : "scale-75 opacity-40")} />
        <svg aria-hidden data-pin viewBox="0 0 24 34" className={cn("pointer-events-none absolute left-1/2 top-1/2 h-12 w-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.6)] transition-transform duration-150", lifted && "-translate-y-[calc(100%+10px)]")}>
          <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.6 12 34 12 34s12-13.4 12-22.3C24 5.2 18.6 0 12 0z" fill="#e5484d" stroke="#fff" strokeWidth="1.5" />
          <circle cx="12" cy="11.5" r="4.5" fill="#fff" />
        </svg>

        <div role="group" aria-label="Map type" className="absolute left-3 top-3 grid grid-cols-2 gap-0.5 rounded-xl border border-border bg-card/95 p-0.5 shadow">
          {(Object.keys(LAYERS) as Layer[]).map((l) => (
            <button key={l} type="button" aria-pressed={layer === l} onClick={() => pickLayer(l)} className={cn("min-h-10 rounded-lg px-3 font-body text-xs font-medium transition-colors", layer === l ? "bg-white text-black" : "text-muted-foreground hover:text-foreground")}>
              {LAYERS[l].name}
            </button>
          ))}
        </div>
        <div className="absolute right-3 top-3 grid gap-2">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)} disabled={view.z >= cfg.max - 0.001} className={iconBtn}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)} disabled={view.z <= MIN_Z + 0.001} className={iconBtn}>
            −
          </button>
          <button type="button" aria-label="Go to my location" onClick={() => void mine()} disabled={busy} className={cn(iconBtn, me && "text-[#4285f4]")}>
            <i aria-hidden className={cn("bx", busy ? "bx-loader-alt animate-spin" : "bx-current-location")} />
          </button>
        </div>
        <div aria-hidden data-scale className="pointer-events-none absolute bottom-12 left-3 font-body text-[10px] font-semibold text-white [text-shadow:0_0_3px_rgba(0,0,0,0.95)]">
          <span>{lengthLabel(scaleM)}</span>
          <div className="mt-0.5 h-1.5 border-x-2 border-b-2 border-white shadow-[0_1px_2px_rgba(0,0,0,0.6)]" style={{ width: Math.max(8, scaleM / mpp) }} />
        </div>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute bottom-1 right-1 max-w-[80%] rounded bg-background/80 px-1.5 py-0.5 text-right font-body text-[10px] text-muted-foreground">
          {cfg.credit} · Search © OpenStreetMap contributors
        </a>
      </div>

      <div className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start gap-3" aria-live="polite">
          <i aria-hidden className="bx bx-map-pin mt-0.5 text-2xl text-[#e5484d]" />
          <div className="min-w-0 flex-1">
            {addr.status === "loading" ? (
              <p className="font-body text-sm text-muted-foreground">Finding the address…</p>
            ) : addr.label ? (
              <p data-address className="line-clamp-2 font-display text-base font-semibold leading-snug">
                {addr.label}
              </p>
            ) : (
              <p className="font-body text-sm text-muted-foreground">No name for this spot. The pin is exact, and that is what the rider uses.</p>
            )}
            <p className="mt-0.5 font-body text-xs tabular-nums text-muted-foreground">
              <span>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
              {fromMe !== null && <span data-from-me>{fromMe < 0.025 ? " · this is where you are" : ` · ${kmLabel(fromMe)} from you`}</span>}
            </p>
          </div>
        </div>
        <button type="button" disabled={confirming} onClick={() => void confirm()} className="mt-3 min-h-12 w-full rounded-2xl bg-primary px-6 font-display text-base font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60">
          {confirming ? "Finding the address…" : "Use this spot"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
