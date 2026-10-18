import { useRef } from "react";
import { SheetClose } from "@/components/ui/sheet";
import { useSwipeDown } from "@/lib/swipe";

/** The handle at the top of a bottom sheet: swipe it down, or tap it, to close the sheet. */
export function SheetGrabber() {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const swipe = useSwipeDown(
    () => closeRef.current?.click(),
    () => closeRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null,
  );
  return (
    <SheetClose
      ref={closeRef}
      aria-label="Close"
      className="absolute inset-x-14 top-0 z-10 flex h-9 touch-none justify-center pt-2"
      {...swipe}
    >
      <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
    </SheetClose>
  );
}
