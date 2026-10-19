import { useRef, type ReactNode } from "react";
import { useSwipeDown } from "@/lib/swipe";
import { cn } from "@/lib/utils";

/**
 * The top part of a pop-up (handle and title). Swipe down anywhere on it to close the pop-up.
 * The pop-up follows the finger, and snaps back if the swipe is too short.
 */
export function SwipeZone({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const swipe = useSwipeDown(onClose, () => ref.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  return (
    <div ref={ref} {...swipe} className={cn("touch-none", className)}>
      {children}
    </div>
  );
}
