import { useEffect, type ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";

/**
 * Popups that can be swiped away. A popup (a new order, a message, a notification) stays on the screen for a few seconds. On a phone you can
 * drag it sideways to get rid of it at once: it follows your finger, goes if you drag it far enough (or flick it), and springs back if you let go
 * early. There is always a close button too, for anyone who cannot swipe. Swiping a popup only hides the popup: the notification is still in the list.
 */
const TAG = "moa-toast-id-";
let counter = 0;

/** Shows a popup that can be swiped away and has a close button. Everything else works as a normal popup. Returns its id. */
export function popup(title: ReactNode, data: ExternalToast = {}): string | number {
  const id = String(data.id ?? `moa-${Date.now().toString(36)}-${++counter}`);
  return toast(title, { ...data, id, closeButton: true, className: [data.className, `${TAG}${id}`].filter(Boolean).join(" ") });
}

const FAR = 0.3; // how far across (as a share of its width) it must go to leave
const MIN_FAR = 56; // and never less than this many pixels
const FLICK = 0.5; // pixels per millisecond: a quick flick leaves from a short distance
const FLICK_MIN = 24;
const START = 8; // pixels before a drag counts as a swipe

type Drag = { el: HTMLElement; id: string | null; x: number; y: number; at: number; pid: number; axis: "x" | null; dx: number };

const idOf = (el: HTMLElement): string | null => {
  for (const c of el.classList) if (c.startsWith(TAG)) return c.slice(TAG.length);
  return null;
};
const calm = (doc: Document) => {
  const w = doc.defaultView;
  return !!w && typeof w.matchMedia === "function" && w.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/** Starts listening for swipes on popups. Returns the function that stops. */
export function attachToastSwipe(doc: Document = document): () => void {
  let drag: Drag | null = null;
  const win = doc.defaultView ?? window;

  const dismiss = (d: Drag) => {
    if (d.id) toast.dismiss(d.id);
    else if (doc.querySelectorAll("[data-sonner-toast]").length === 1) toast.dismiss(); // a popup we did not make: only safe to name when it is the only one
    else springBack(d.el);
  };
  const springBack = (el: HTMLElement) => {
    el.style.transition = "translate 180ms ease-out, opacity 180ms ease-out";
    el.style.translate = "0 0";
    el.style.opacity = "1";
    win.setTimeout(() => {
      el.style.transition = "";
      el.style.translate = "";
      el.style.opacity = "";
    }, 200);
  };
  const finish = (cancelled: boolean) => {
    const d = drag;
    drag = null;
    if (!d || d.axis !== "x") return;
    const w = d.el.offsetWidth || 320;
    const dt = Math.max(1, win.performance.now() - d.at);
    const far = Math.abs(d.dx) > Math.max(MIN_FAR, w * FAR);
    const flick = Math.abs(d.dx) > FLICK_MIN && Math.abs(d.dx) / dt > FLICK;
    if (cancelled || !(far || flick)) return springBack(d.el);
    if (calm(doc)) return dismiss(d);
    d.el.style.transition = "translate 160ms ease-out, opacity 160ms ease-out";
    d.el.style.translate = `${Math.sign(d.dx) * w}px 0`;
    d.el.style.opacity = "0";
    win.setTimeout(() => dismiss(d), 150);
  };

  const down = (e: PointerEvent) => {
    if (drag || (e.pointerType === "mouse" && e.button !== 0) || e.isPrimary === false) return;
    const target = e.target as Element | null;
    const el = target?.closest?.("[data-sonner-toast]") as HTMLElement | null;
    if (!el || target?.closest("button, a, input, textarea, select")) return; // a tap on its button is a tap
    drag = { el, id: idOf(el), x: e.clientX, y: e.clientY, at: win.performance.now(), pid: e.pointerId, axis: null, dx: 0 };
  };
  const move = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) > START && Math.abs(dx) > Math.abs(dy) * 1.2) {
        d.axis = "x";
        d.el.style.transition = "none";
      } else if (Math.abs(dy) > 12) {
        drag = null; // up or down is not ours
        return;
      } else return;
    }
    d.dx = dx;
    d.el.style.translate = `${dx}px 0`;
    d.el.style.opacity = String(Math.max(0.25, 1 - (Math.abs(dx) / (d.el.offsetWidth || 320)) * 0.75));
  };
  const up = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pid) finish(false);
  };
  const cancel = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pid) finish(true);
  };

  doc.addEventListener("pointerdown", down);
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel);
  return () => {
    doc.removeEventListener("pointerdown", down);
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
    drag = null;
  };
}

/** Mount once, near the top of the app. */
export function useToastSwipe(): void {
  useEffect(() => attachToastSwipe(document), []);
}
