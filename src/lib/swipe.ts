import { useRef, type TouchEvent } from "react";

/**
 * Swipe down on an element to close the panel it belongs to.
 * While the finger moves, the panel follows it. Past the threshold it closes, otherwise it snaps back.
 */
export function useSwipeDown(onClose: () => void, getPanel: () => HTMLElement | null, threshold = 90) {
  const startY = useRef<number | null>(null);
  const moved = useRef(0);

  const snapBack = () => {
    const el = getPanel();
    if (el) {
      el.style.transform = "";
      el.style.transition = "";
    }
  };

  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      startY.current = e.touches[0]?.clientY ?? null;
      moved.current = 0;
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      if (startY.current === null) return;
      const d = (e.touches[0]?.clientY ?? startY.current) - startY.current;
      moved.current = Math.max(0, d);
      const el = getPanel();
      if (el && d > 0) {
        el.style.transition = "none";
        el.style.transform = `translateY(${d}px)`;
      }
    },
    onTouchEnd: () => {
      const shouldClose = moved.current > threshold;
      startY.current = null;
      moved.current = 0;
      snapBack();
      if (shouldClose) onClose();
    },
    onTouchCancel: () => {
      startY.current = null;
      moved.current = 0;
      snapBack();
    },
  };
}
