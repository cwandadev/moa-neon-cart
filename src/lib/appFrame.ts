import { useEffect, useState } from "react";

export type AppFrame = { top: number; bottom: number; keyboard: boolean };
type Options = { coverNav?: boolean; expanded?: boolean };

const GAP = 8;

/** True on phone-sized screens. */
export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

/**
 * The free area of a phone screen. Normally it sits below the sticky header
 * (logo and search) and above the bottom bar (or flush to the bottom when the
 * panel covers the bar). While the person is typing it grows to the whole
 * visible area above the keyboard.
 */
export function useAppFrame(active: boolean, opts: Options = {}): AppFrame | null {
  const { coverNav = false, expanded = false } = opts;
  const [frame, setFrame] = useState<AppFrame | null>(null);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!active) {
      setTyping(false);
      return;
    }
    const check = () =>
      window.setTimeout(() => {
        const el = document.activeElement as HTMLElement | null;
        setTyping(Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)));
      }, 0);
    window.addEventListener("focusin", check);
    window.addEventListener("focusout", check);
    return () => {
      window.removeEventListener("focusin", check);
      window.removeEventListener("focusout", check);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setFrame(null);
      return;
    }
    const vv = window.visualViewport;
    const measure = () => {
      const vh = vv?.height ?? window.innerHeight;
      const vtop = vv?.offsetTop ?? 0;
      const below = Math.max(0, window.innerHeight - (vtop + vh));
      if (expanded || typing || window.innerHeight - vh > 120) {
        setFrame({ top: vtop, bottom: below, keyboard: true });
        return;
      }
      const header = document.querySelector("header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      if (coverNav) {
        setFrame({ top: headerBottom + GAP, bottom: below, keyboard: false });
        return;
      }
      const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      setFrame({ top: headerBottom + GAP, bottom: Math.max(0, window.innerHeight - navTop) + GAP, keyboard: false });
    };
    measure();
    const t = window.setTimeout(measure, 120);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [active, coverNav, expanded, typing]);

  return frame;
}
