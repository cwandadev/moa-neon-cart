import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { haversineKm } from "@/lib/delivery";
import { GEO_HELP, locate } from "@/lib/geo";
import { describePlace, searchPlaces, type Place } from "@/lib/places";
import { cn } from "@/lib/utils";

/**
 * Choose a place on a map: search for a building, shop or street, or drag the map until the pin is on the exact spot. No GPS and no key needed.
 * It opens on SATELLITE imagery (with the names of places on top), which is how people recognise their own roof; "Map" shows the streets.
 * Imagery is Esri's and the map is OpenStreetMap's: both are fine for a shop's light use, but they are third parties' public servers, so if traffic
 * grows a lot, change the addresses in LAYERS to a paid tile provider. Search is Photon (see places.ts).
 * When a spot is confirmed it is also NAMED ("Simba Supermarket, KG 7 Ave, Kimihurura"), so a form can fill its address field.
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
const src = (template: string, z: number, x: number, y: number) => template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
const savedLayer = (): Layer => {
  try {
    return localStorage.getItem(LAYER_KEY) === "map" ? "map" : "satellite";
  } catch {
    return "satellite";
  }
};

export type Picked = { lat: number; lng: number; /** What the spot is called, or null when nothing could say. */ label?: string | null };

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
  const start = known ?? KIGALI;
  const [layer, setLayer] = useState<Layer>(savedLayer);
  const cfg = LAYERS[layer];
  const startZ = Math.min(known ? 17 : 14, cfg.max);
  const [z, setZ] = useState(startZ);
  const [c, setC] = useState({ x: worldX(start.lng, startZ), y: worldY(start.lat, startZ) });
  const [size, setSize] = useState({ w: 360, h: 420 });
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listOpen = useRef(false);
  listOpen.current = results.length > 0;
  const view = useRef({ z, c, max: cfg.max });
  view.current = { z, c, max: cfg.max };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const lastWheel = useRef(0);

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
      if (listOpen.current) setResults([]);
      else closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const k of kinds) document.body.removeEventListener(k, keep);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus(); // back to the button that opened the map, so a keyboard or screen reader user is not lost
    };
  }, []);

  const clampY = (y: number, zoom: number) => Math.max(0, Math.min(T * 2 ** zoom, y));
  const goTo = (lat: number, lng: number, zoom: number) => {
    const zz = Math.max(MIN_Z, Math.min(view.current.max, zoom));
    setZ(zz);
    setC({ x: worldX(lng, zz), y: worldY(lat, zz) });
  };
  const zoomBy = (d: number) => {
    const { z: cz, c: cc, max } = view.current;
    const nz = Math.max(MIN_Z, Math.min(max, cz + d));
    if (nz !== cz) goTo(latAt(cc.y, cz), lngAt(cc.x, cz), nz);
  };
  const pickLayer = (l: Layer) => {
    if (l === layer) return;
    const { z: cz, c: cc } = view.current;
    setLayer(l);
    try {
      localStorage.setItem(LAYER_KEY, l);
    } catch {
      /* not saved: it is only a preference */
    }
    const nz = Math.min(cz, LAYERS[l].max);
    setZ(nz);
    setC({ x: worldX(lngAt(cc.x, cz), nz), y: worldY(latAt(cc.y, cz), nz) });
  };

  // A press on one of the map's own buttons (zoom, my location) or its link is not a drag: capturing the mouse would swallow the click.
  const onControl = (e: { target: EventTarget | null }) => e.target instanceof Element && e.target.closest("button, a, input") !== null;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (onControl(e)) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setC((p) => ({ x: p.x - dx, y: clampY(p.y - dy, view.current.z) }));
    } else if (pointers.current.size === 2 && pinch.current > 0) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > pinch.current * 1.6) {
        zoomBy(1);
        pinch.current = d;
      } else if (d < pinch.current * 0.625) {
        zoomBy(-1);
        pinch.current = d;
      }
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = 0;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 100;
    const pan = (dx: number, dy: number) => setC((p) => ({ x: p.x + dx, y: clampY(p.y + dy, view.current.z) }));
    if (e.key === "ArrowLeft") pan(-step, 0);
    else if (e.key === "ArrowRight") pan(step, 0);
    else if (e.key === "ArrowUp") pan(0, -step);
    else if (e.key === "ArrowDown") pan(0, step);
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
      const { z: cz, c: cc } = view.current;
      const found = await searchPlaces(term, { lat: latAt(cc.y, cz), lng: lngAt(cc.x, cz) }, ctl.signal);
      if (ctl.signal.aborted) return;
      setResults(found);
      setActive(-1);
      setSearching(false);
      setNote(found.length === 0 ? "Nothing found with that name. Try the street or neighbourhood, or drag the map to the spot." : "");
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const choose = (p: Place) => {
    setChosen({ lat: p.lat, lng: p.lng, label: p.full });
    setQ(p.full);
    setResults([]);
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

  const mine = async () => {
    setBusy(true);
    setNote("");
    const r = await locate();
    setBusy(false);
    if (r.ok) goTo(r.where.lat, r.where.lng, 17);
    else setNote(GEO_HELP[r.reason]);
  };

  const lat = round6(latAt(c.y, z));
  const lng = round6(wrapLng(lngAt(c.x, z)));
  const confirm = async () => {
    // If the spot is still where the chosen search result is, that result's name is the best name for it.
    if (chosen && haversineKm(chosen, { lat, lng }) < 0.03) return onPick({ lat, lng, label: chosen.label });
    setConfirming(true);
    const label = await describePlace(lat, lng);
    setConfirming(false);
    onPick({ lat, lng, label });
  };

  // ----- the tiles that are on the screen -----
  const n = 2 ** z;
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const tiles: Array<{ key: string; base: string; names: string | null; x: number; y: number }> = [];
  for (let ty = Math.max(0, Math.floor(top / T)); ty <= Math.min(n - 1, Math.floor((top + size.h) / T)); ty++) {
    for (let tx = Math.floor(left / T); tx <= Math.floor((left + size.w) / T); tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${layer}/${z}/${tx}/${ty}`, base: src(cfg.url, z, wx, ty), names: cfg.labels ? src(cfg.labels, z, wx, ty) : null, x: tx * T - left, y: ty * T - top });
    }
  }
  const iconBtn = "grid size-11 place-items-center rounded-xl border border-border bg-card/95 text-lg shadow transition-colors hover:bg-secondary disabled:opacity-50";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} style={{ pointerEvents: "auto" }} className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="font-body text-xs text-muted-foreground">Search for a building or shop, or drag the map so the pin is on the exact spot.</p>
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
            onKeyDown={searchKey}
            role="combobox"
            aria-expanded={results.length > 0}
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
      </div>
      {note && (
        <p role="status" className="border-b border-border bg-warning/10 px-4 py-2 font-body text-xs text-warning">
          {note}
        </p>
      )}

      <div
        ref={box}
        role="application"
        aria-label="Map. Drag to move it, use plus and minus to zoom."
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onDoubleClick={(e) => !onControl(e) && zoomBy(1)}
        onWheel={(e) => {
          if (onControl(e) || Date.now() - lastWheel.current < 350) return;
          lastWheel.current = Date.now();
          zoomBy(e.deltaY < 0 ? 1 : -1);
        }}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[#1c2128] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {tiles.map((t) => (
          <span key={t.key} className="pointer-events-none absolute block size-[256px]" style={{ left: t.x, top: t.y }}>
            <img src={t.base} alt="" draggable={false} className="absolute inset-0 size-[256px] max-w-none" />
            {t.names && <img src={t.names} alt="" draggable={false} data-names className="absolute inset-0 size-[256px] max-w-none" onError={(e) => (e.currentTarget.style.display = "none")} />}
          </span>
        ))}
        {/* the pin: always in the middle, its tip on the chosen spot */}
        <svg aria-hidden viewBox="0 0 24 34" className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.6)]">
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
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)} disabled={z >= cfg.max} className={iconBtn}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)} disabled={z <= MIN_Z} className={iconBtn}>
            −
          </button>
          <button type="button" aria-label="Go to my location" onClick={() => void mine()} disabled={busy} className={iconBtn}>
            <i aria-hidden className="bx bx-current-location" />
          </button>
        </div>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute bottom-1 right-1 max-w-[80%] rounded bg-background/80 px-1.5 py-0.5 text-right font-body text-[10px] text-muted-foreground">
          {cfg.credit} · Search © OpenStreetMap contributors
        </a>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="min-w-0 font-body text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        <button type="button" disabled={confirming} onClick={() => void confirm()} className="min-h-12 shrink-0 rounded-2xl bg-primary px-6 font-display text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60">
          {confirming ? "Finding the address…" : "Use this spot"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
