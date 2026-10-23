import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { GEO_HELP, locate } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * Choose a place on a map, with no GPS and no key: drag the map so the pin is on the spot, then confirm.
 * The map is OpenStreetMap's. Their public tile server is meant for light use (a shop like this): if traffic grows a lot, point TILE_URL at a paid
 * tile provider. The place search is Nominatim, whose rules allow one search per second and no search-as-you-type, so it only searches when asked.
 */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const T = 256;
const MIN_Z = 3;
const MAX_Z = 19;
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MapPicker({
  initial,
  onPick,
  onClose,
  title = "Choose the place",
}: {
  initial?: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number }) => void;
  onClose: () => void;
  title?: string;
}) {
  const known = initial && !(initial.lat === 0 && initial.lng === 0) ? initial : null;
  const start = known ?? KIGALI;
  const startZ = known ? 17 : 14;
  const [z, setZ] = useState(startZ);
  const [c, setC] = useState({ x: worldX(start.lng, startZ), y: worldY(start.lat, startZ) });
  const [size, setSize] = useState({ w: 360, h: 420 });
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef({ z, c });
  view.current = { z, c };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const lastWheel = useRef(0);
  const lastSearch = useRef(0);
  const cache = useRef(new Map<string, { lat: number; lng: number } | null>());

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

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const clampY = (y: number, zoom: number) => Math.max(0, Math.min(T * 2 ** zoom, y));
  const goTo = (lat: number, lng: number, zoom: number) => {
    setZ(zoom);
    setC({ x: worldX(lng, zoom), y: worldY(lat, zoom) });
  };
  const zoomBy = (d: number) => {
    const { z: cz, c: cc } = view.current;
    const nz = Math.max(MIN_Z, Math.min(MAX_Z, cz + d));
    if (nz === cz) return;
    goTo(latAt(cc.y, cz), lngAt(cc.x, cz), nz);
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

  const search = async () => {
    const term = q.trim();
    if (term.length < 3) return setNote("Type at least 3 letters, then press Search.");
    setBusy(true);
    setNote("");
    try {
      let hit = cache.current.get(term.toLowerCase());
      if (hit === undefined) {
        const wait = 1100 - (Date.now() - lastSearch.current);
        if (wait > 0) await sleep(wait);
        lastSearch.current = Date.now();
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=rw&q=${encodeURIComponent(term)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("search failed");
        const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
        hit = rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null;
        cache.current.set(term.toLowerCase(), hit);
      }
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) goTo(hit.lat, hit.lng, 16);
      else setNote("We did not find that place. Try a bigger one, like the neighbourhood, and then move the map.");
    } catch {
      setNote("Search is not available right now. You can still drag the map.");
    } finally {
      setBusy(false);
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

  // ----- the tiles that are on the screen -----
  const n = 2 ** z;
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const tiles: Array<{ key: string; src: string; x: number; y: number }> = [];
  for (let ty = Math.max(0, Math.floor(top / T)); ty <= Math.min(n - 1, Math.floor((top + size.h) / T)); ty++) {
    for (let tx = Math.floor(left / T); tx <= Math.floor((left + size.w) / T); tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${z}/${tx}/${ty}`, src: TILE_URL.replace("{z}", String(z)).replace("{x}", String(wx)).replace("{y}", String(ty)), x: tx * T - left, y: ty * T - top });
    }
  }
  const lat = round6(latAt(c.y, z));
  const lng = round6(wrapLng(lngAt(c.x, z)));
  const iconBtn = "grid size-11 place-items-center rounded-xl border border-border bg-card/95 text-lg shadow transition-colors hover:bg-secondary disabled:opacity-50";

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="font-body text-xs text-muted-foreground">Drag the map so the pin is on the exact spot.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the map" className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <i aria-hidden className="bx bx-x text-3xl" />
        </button>
      </div>

      <form
        className="flex gap-2 border-b border-border px-4 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search for a place"
          placeholder="Search a place, e.g. Kimihurura"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
        />
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl border border-border bg-secondary/60 px-4 font-body text-sm font-medium hover:bg-secondary disabled:opacity-50">
          Search
        </button>
      </form>
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
          <img key={t.key} src={t.src} alt="" draggable={false} className="pointer-events-none absolute size-[256px] max-w-none" style={{ left: t.x, top: t.y }} />
        ))}
        {/* the pin: always in the middle, its tip on the chosen spot */}
        <svg aria-hidden viewBox="0 0 24 34" className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.5)]">
          <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.6 12 34 12 34s12-13.4 12-22.3C24 5.2 18.6 0 12 0z" fill="#e5484d" />
          <circle cx="12" cy="11.5" r="4.5" fill="#fff" />
        </svg>
        <div className="absolute right-3 top-3 grid gap-2">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)} disabled={z >= MAX_Z} className={iconBtn}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)} disabled={z <= MIN_Z} className={iconBtn}>
            −
          </button>
          <button type="button" aria-label="Go to my location" onClick={() => void mine()} disabled={busy} className={iconBtn}>
            <i aria-hidden className="bx bx-current-location" />
          </button>
        </div>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">
          © OpenStreetMap contributors
        </a>
      </div>

      <div className={cn("flex items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
        <p className="min-w-0 font-body text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        <button type="button" onClick={() => onPick({ lat, lng })} className="min-h-12 shrink-0 rounded-2xl bg-primary px-6 font-display text-base font-semibold text-primary-foreground active:opacity-80">
          Use this spot
        </button>
      </div>
    </div>
  );
}
