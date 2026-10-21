import { useEffect, useState } from "react";

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
