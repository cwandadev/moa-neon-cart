import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

const PREFIX = "moa:scroll:";

function keyOf(loc: { href: string; state?: unknown }): string {
  const st = (loc.state ?? {}) as Record<string, unknown>;
  const k = st["__TSR_key"] ?? st["key"];
  return PREFIX + String(k ?? loc.href);
}

/**
 * Remembers how far down each page was scrolled, and puts the person back there after a reload or
 * when they come back to the page. Pages fill in after they load, so it keeps trying for a few seconds
 * until the page is tall enough. It stops as soon as the person scrolls themselves.
 */
export function ScrollRestorer() {
  const location = useRouterState({ select: (s) => s.location });
  const key = keyOf({ href: location.href, state: location.state });

  // Save the position of this page while it is scrolled.
  useEffect(() => {
    let timer: number | undefined;
    const save = () => {
      try {
        window.sessionStorage.setItem(key, String(Math.round(window.scrollY)));
      } catch {
        /* ignore */
      }
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 80);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [key]);

  // Put the person back where they were, once the page is tall enough.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      /* ignore */
    }
    if (raw === null) return;
    const y = Number(raw);
    if (!Number.isFinite(y) || y < 8) return;

    let stop = false;
    let stable = 0;
    const started = performance.now();
    const cancel = () => {
      stop = true;
    };
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const e of events) window.addEventListener(e, cancel, { once: true, passive: true });

    const tick = () => {
      if (stop) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= y - 2) {
        window.scrollTo({ top: y, behavior: "instant" });
        if (Math.abs(window.scrollY - y) <= 2) {
          stable += 1;
          if (stable >= 3) return;
        } else {
          stable = 0;
        }
      }
      if (performance.now() - started < 4000) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);

    return () => {
      stop = true;
      for (const e of events) window.removeEventListener(e, cancel);
    };
  }, [key]);

  return null;
}
