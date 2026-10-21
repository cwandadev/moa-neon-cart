import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top part of a pop-up (handle and title). Dragging here always moves the pop-up, up or down.
 * The swiping itself is done by the pop-up (see sheetGestures), which also lets you swipe from anywhere on its body.
 */
export function SwipeZone({
  className,
  children,
}: {
  /** No longer used: the pop-up closes itself when swiped. Kept so existing code keeps working. */
  onClose?: (() => void) | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div data-sheet-handle className={cn("touch-none", className)}>
      {children}
    </div>
  );
}
