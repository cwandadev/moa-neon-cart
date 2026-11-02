import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SwipeAction = { label: string; icon: string; tone: string; run: () => void };

const FAR = 0.35; // how far across (as a share of the row's width) a swipe must go
const MIN_FAR = 88; // and never less than this many pixels
const START = 10; // pixels before a drag counts as a swipe

/**
 * A row you can swipe on a phone, the way a mail app does it: drag right to do the first thing (mark read), drag left to do the second (remove).
 * The row follows the finger and shows what it will do; let go early and it springs back. Only a finger or a pen does this (a mouse does not, so
 * selecting text works), and every swipe also has a button, so nobody has to swipe.
 */
export function SwipeRow({ children, right, left, disabled = false }: { children: ReactNode; right?: SwipeAction | undefined; left?: SwipeAction | undefined; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pid: number; axis: boolean; dx: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [moving, setMoving] = useState(false);
  const calm = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const settle = (to: number, then?: () => void) => {
    setMoving(false);
    setDx(to);
    if (then) window.setTimeout(then, calm() ? 0 : 150);
  };
  const end = (cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.axis) return;
    const w = box.current?.offsetWidth || 320;
    const action = d.dx > 0 ? right : left;
    if (!cancelled && action && Math.abs(d.dx) > Math.max(MIN_FAR, w * FAR)) {
      // goes off the side, does its thing, and (if the row is still there) comes back
      settle(Math.sign(d.dx) * w, () => {
        action.run();
        setDx(0);
      });
    } else settle(0);
  };

  if (disabled || (!right && !left)) return <>{children}</>;
  const shown = dx > 0 ? right : dx < 0 ? left : undefined;
  return (
    <div
      ref={box}
      className="relative overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" || e.isPrimary === false || drag.current) return;
        if ((e.target as Element).closest("[data-no-swipe], input")) return; // the small buttons at the side, and checkboxes, are taps
        drag.current = { x: e.clientX, y: e.clientY, pid: e.pointerId, axis: false, dx: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pid) return;
        const mx = e.clientX - d.x;
        const my = e.clientY - d.y;
        if (!d.axis) {
          if (Math.abs(mx) > START && Math.abs(mx) > Math.abs(my) * 1.2) {
            d.axis = true;
            setMoving(true);
          } else if (Math.abs(my) > 12) {
            drag.current = null;
            return;
          } else return;
        }
        const allowed = mx > 0 ? !!right : !!left;
        d.dx = allowed ? mx : mx / 4; // a side with nothing to do pulls back
        setDx(d.dx);
      }}
      onPointerUp={(e) => {
        if (drag.current && e.pointerId === drag.current.pid) end(false);
      }}
      onPointerCancel={(e) => {
        if (drag.current && e.pointerId === drag.current.pid) end(true);
      }}
    >
      {shown && (
        <div aria-hidden data-swipe-reveal className={cn("absolute inset-y-0 flex w-full items-center px-5 text-sm font-medium text-white", dx > 0 ? "justify-start" : "justify-end", shown.tone)}>
          <span className="inline-flex items-center gap-2">
            <i className={cn("bx text-xl", shown.icon)} />
            {shown.label}
          </span>
        </div>
      )}
      <div ref={face} data-swipe-face className="relative bg-card" style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving || calm() ? "none" : "transform 150ms ease-out" }}>
        {children}
      </div>
    </div>
  );
}
