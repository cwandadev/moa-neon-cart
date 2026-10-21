"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePhoneViewport, useSheetGestures } from "@/lib/sheetGestures";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** A sheet from the bottom, on a phone: "auto" opens partway (and can be opened fully), "full" opens full screen (for forms). */
  snap?: "auto" | "full" | undefined;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, snap = "auto", ...props }, ref) => {
  const bottom = side === "bottom";
  const fullOnly = snap === "full";
  const phone = usePhoneViewport();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  // The panel only exists while the sheet is open. Knowing when it appears lets the swiping start then.
  const [panel, setPanel] = React.useState<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);

  const body = () => panelRef.current?.querySelector<HTMLElement>("[data-sheet-body], .overflow-y-auto") ?? null;
  // Is there more content than fits? Only then is there something to open.
  const canExpand = () => {
    const el = body();
    return Boolean(el && el.scrollHeight > el.clientHeight + 4);
  };

  React.useEffect(() => {
    if (!bottom || fullOnly || !panel || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflowing(canExpand());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    const el = body();
    if (el) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottom, fullOnly, expanded, panel]);

  // On a phone: swipe down anywhere on the sheet (when its content is at the top) and it follows the finger and closes.
  useSheetGestures({
    enabled: bottom && phone && panel !== null,
    open: true,
    fullOnly,
    expanded,
    setExpanded,
    canExpand,
    onClose: () => panelRef.current?.querySelector<HTMLElement>("[data-sheet-close]")?.click(),
    panelRef,
    getOverlay: () => (panelRef.current?.previousElementSibling as HTMLElement | null) ?? null,
  });

  const setRefs = (node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanel(node);
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={setRefs}
        className={cn(
          sheetVariants({ side }),
          bottom &&
            (fullOnly
              ? "max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none"
              : expanded
                ? "max-md:max-h-[100dvh] max-md:rounded-t-none"
                : "max-md:max-h-[72dvh]"),
          bottom && "max-md:transition-[transform,max-height]",
          className,
        )}
        {...props}
      >
        {bottom && !fullOnly && (
          <button
            type="button"
            data-sheet-handle
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            aria-disabled={!overflowing && !expanded ? true : undefined}
            onClick={() => (expanded || canExpand() ? setExpanded((v) => !v) : undefined)}
            className="absolute inset-x-16 top-0 z-10 h-8 md:hidden"
          />
        )}
        <SheetPrimitive.Close data-sheet-close className="absolute right-2 top-2 grid size-11 cursor-pointer place-items-center rounded-full bg-secondary/70 text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
