import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Press and hold (about half a second) on a touch screen to start selecting, as on Android and in Google Photos.
 * Mouse users use the checkbox instead. A press that moves (scrolling) is ignored.
 */
export function useLongPress(onLong: () => void, enabled = true) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return {
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        if (!enabled || e.pointerType === "mouse") return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(12);
          onLong();
        }, 450);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const o = origin.current;
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (fired.current) e.preventDefault();
      },
    },
    /** True once, right after a long press: the click that follows it must be ignored. */
    consumeLongPress: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
