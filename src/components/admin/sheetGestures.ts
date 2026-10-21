import { useEffect, useRef, useState, type RefObject } from "react";

/** How much of the screen a sheet takes when it opens (it grows to the full screen on request). */
export const PARTIAL = 0.72;
const FLICK = 0.5; // px per millisecond: a quick flick counts even when it is short
const SLOP = 8; // px before a touch counts as a drag
const MS = 300; // the length of the slide

export type SheetGestureOptions = {
  /** Only on a phone: on a tablet or desktop the sheet is a drawer on the right. */
  enabled: boolean;
  open: boolean;
  /** A sheet that is always full screen (a long form): it can only be closed, not made smaller. */
  fullOnly: boolean;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** Is there more content than fits? Only then is there something to expand. */
  canExpand: () => boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** The handle and the title bar: a drag here always moves the sheet, up or down. */
  dragRef: RefObject<HTMLElement | null>;
  overlayRef: RefObject<HTMLElement | null>;
};

/** Is this part of the sheet scrolled down? Then a swipe down should scroll it back, not move the sheet. */
function scrolledDown(from: EventTarget | null, stop: HTMLElement): boolean {
  let el = from as HTMLElement | null;
  while (el && el !== stop) {
    if (el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Swipe a sheet like the comments on YouTube Shorts: it follows the finger, and lets go in the
 * right place. A swipe down anywhere on the body closes it (when the content is at the top);
 * dragging the handle or title bar up opens it fully, and down brings it back or closes it.
 */
export function useSheetGestures(o: SheetGestureOptions): void {
  const live = useRef(o);
  live.current = o;

  useEffect(() => {
    const panel = o.panelRef.current;
    if (!o.enabled || !o.open || !panel) return;

    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let vy = 0;
    let dy = 0;
    let mode: "idle" | "pending" | "drag" | "scroll" = "idle";
    let fromHandle = false;
    let level: "partial" | "full" = "partial";
    let h0 = 0;
    let partialH = 0;
    let fullH = 0;
    let maxH: number | null = null;
    let ty = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup: ReturnType<typeof setTimeout> | undefined;
    let settling = false; // the sheet is still sliding into place after a swipe

    const overlay = () => live.current.overlayRef.current;
    const visibleHeight = () => window.visualViewport?.height ?? window.innerHeight;

    const clearStyles = () => {
      panel.style.transition = "";
      panel.style.maxHeight = "";
      panel.style.transform = "";
      const ov = overlay();
      if (ov) {
        ov.style.transition = "";
        ov.style.opacity = "";
      }
    };

    const compute = () => {
      if (live.current.fullOnly) {
        ty = Math.max(0, dy);
        maxH = null;
        return;
      }
      if (dy < 0) {
        ty = 0;
        maxH = Math.min(fullH, Math.max(partialH, partialH - dy));
        return;
      }
      if (level === "full") {
        const range = fullH - partialH;
        maxH = Math.max(partialH, fullH - dy);
        ty = Math.max(0, dy - range);
      } else {
        maxH = partialH;
        ty = dy;
      }
    };

    const apply = () => {
      panel.style.transition = "none";
      if (maxH !== null) panel.style.maxHeight = `${maxH}px`;
      panel.style.transform = ty > 0 ? `translateY(${ty}px)` : "";
      const ov = overlay();
      if (ov) {
        const cap = maxH ?? (level === "full" ? fullH : partialH);
        const base = (h0 > 0 ? Math.min(h0, cap) : cap) || 1;
        ov.style.transition = "none";
        ov.style.opacity = String(Math.max(0, Math.min(1, 1 - ty / base)));
      }
    };

    const done = () => {
      clearStyles();
      settling = false;
    };

    const settle = (target: "close" | "partial" | "full") => {
      settling = true;
      panel.style.transition = "";
      const ov = overlay();
      if (ov) ov.style.transition = "";
      if (target === "close") {
        panel.style.transform = "translateY(100%)";
        if (ov) ov.style.opacity = "0";
        timer = setTimeout(() => {
          live.current.onClose();
          // let the page apply "closed" before the temporary styles are removed, so nothing jumps back
          cleanup = setTimeout(done, 80);
        }, MS);
        return;
      }
      panel.style.transform = "";
      if (!live.current.fullOnly) panel.style.maxHeight = target === "full" ? "100dvh" : `${PARTIAL * 100}dvh`;
      if (ov) ov.style.opacity = "";
      timer = setTimeout(() => {
        if (!live.current.fullOnly) live.current.setExpanded(target === "full");
        cleanup = setTimeout(done, 80);
      }, MS);
    };

    const onStart = (e: TouchEvent) => {
      if (settling) return; // still sliding into place after the last swipe
      if (e.touches.length !== 1) {
        mode = "idle";
        return;
      }
      const t = e.touches[0]!;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input[type="range"], input[type="color"], [data-no-sheet-drag]')) {
        mode = "idle";
        return;
      }
      startY = lastY = t.clientY;
      startX = t.clientX;
      lastT = Date.now();
      vy = 0;
      dy = 0;
      maxH = null;
      ty = 0;
      fromHandle = Boolean(target && live.current.dragRef.current?.contains(target));
      level = live.current.expanded ? "full" : "partial";
      fullH = visibleHeight();
      partialH = live.current.fullOnly ? fullH : PARTIAL * fullH;
      h0 = panel.getBoundingClientRect().height;
      mode = fromHandle || !scrolledDown(target, panel) ? "pending" : "scroll";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "idle" || mode === "scroll") return;
      const t = e.touches[0];
      if (!t) return;
      dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (mode === "pending") {
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          mode = "scroll"; // a sideways swipe belongs to the content
          return;
        }
        const canGoUp = fromHandle && level === "partial" && !live.current.fullOnly && live.current.canExpand();
        if (dy < 0 && !canGoUp) {
          mode = "scroll"; // scrolling the content up
          return;
        }
        mode = "drag";
      }
      if (e.cancelable) e.preventDefault();
      const now = Date.now();
      if (now > lastT) vy = vy * 0.5 + ((t.clientY - lastY) / (now - lastT)) * 0.5;
      lastY = t.clientY;
      lastT = now;
      compute();
      apply();
    };

    const onEnd = (cancelled: boolean) => {
      if (mode !== "drag") {
        mode = "idle";
        return;
      }
      mode = "idle";
      if (Date.now() - lastT > 120) vy = 0; // the finger rested before lifting: it is not a flick
      const cap = maxH ?? (level === "full" ? fullH : partialH);
      const hNow = h0 > 0 ? Math.min(h0, cap) : cap;
      const partBase = h0 > 0 ? Math.min(h0, partialH) : partialH;
      const down = vy > FLICK;
      const up = vy < -FLICK;
      let target: "close" | "partial" | "full";
      if (cancelled) target = level;
      else if (live.current.fullOnly) target = down || ty > 0.3 * hNow ? "close" : "full";
      else if (level === "partial") {
        if (down || ty > 0.3 * hNow) target = "close";
        else if (up || (maxH !== null && maxH - partialH > (fullH - partialH) * 0.3)) target = "full";
        else target = "partial";
      } else if (ty > 0.3 * partBase || (down && ty > 0)) target = "close";
      else if (down || ty > 0 || (maxH !== null && maxH < fullH - (fullH - partialH) * 0.3)) target = "partial";
      else target = "full";
      settle(target);
    };

    const end = () => onEnd(false);
    const cancel = () => onEnd(true);

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", cancel);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", end);
      panel.removeEventListener("touchcancel", cancel);
      clearTimeout(timer);
      clearTimeout(cleanup);
      clearStyles();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, o.open]);
}

/** True on a phone: the width where sheets rise from the bottom. */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/** How far the on-screen keyboard covers the page (0 when it is closed), so a sheet can stay above it. */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !v) {
      setInset(0);
      return;
    }
    const update = () => {
      const covered = Math.round(window.innerHeight - (v.height + v.offsetTop));
      setInset(covered > 80 ? covered : 0); // a small change is the browser's own bar, not a keyboard
    };
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return inset;
}
