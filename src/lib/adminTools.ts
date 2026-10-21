import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export const DAY_MS = 24 * 60 * 60 * 1000;

export const ageOf = (iso: string): number => Date.now() - new Date(iso).getTime();

/** "just now", "12 min", "3 h", "2 d" */
export function ago(iso: string): string {
  const m = Math.floor(ageOf(iso) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

export const shortWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const maskPhone = (p: string): string => (p.length <= 6 ? p : `${p.slice(0, 4)} ••• ${p.slice(-2)}`);

/** A value that follows another one after a pause: used so a search does not ask the database on every keystroke. */
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Text typed by customers must not turn into a spreadsheet formula when the file is opened in Excel. */
export const csvSafe = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (c: string | number | null | undefined) => {
    const s = c == null ? "" : String(c);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The leading mark makes Excel read accents and other characters correctly.
  return `\uFEFF${rows.map((r) => r.map(cell).join(",")).join("\r\n")}`;
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a ready-to-print page in a new tab. Returns false when the browser blocked the new tab. */
export function openPrintable(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/**
 * Press and hold a row to start selecting, like on the storefront. Returns a function that gives the props for one row:
 *   const press = useLongPress(startSelecting);
 *   <button {...press(row.id)}>
 * Moving the finger (scrolling) cancels it, and the tap that follows a long press does not open the row.
 */
export function useLongPress(onFire: (id: string) => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const fire = useRef(onFire);
  fire.current = onFire;
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return useCallback(
    (id: string) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.pointerType === "mouse") return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(15);
          fire.current(id);
        }, ms);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const o = origin.current;
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onClickCapture: (e: ReactMouseEvent) => {
        if (fired.current) {
          e.preventDefault();
          e.stopPropagation();
          fired.current = false;
        }
      },
      onContextMenu: (e: ReactMouseEvent) => {
        if (fired.current) e.preventDefault(); // the phone's own long-press menu must not appear
      },
    }),
    [ms, cancel],
  );
}
