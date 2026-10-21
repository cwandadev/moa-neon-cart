import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useKeyboardInset, usePhoneViewport, useSheetGestures } from "@/components/admin/sheetGestures";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel for details and forms.
 * Phone: it rises from the bottom and opens partway. Swipe down anywhere on it to close it (the content must be at the
 * top), or drag the handle. Tap the handle, drag it up, or tap a field that needs room, and it opens fully.
 * Tablet and desktop: a drawer on the right.
 * The title bar and the action bar stay in view while the middle scrolls. Escape closes it, and the keyboard stays inside it.
 */
export function AdminSheet({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
  wide = false,
  fullOnPhone = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** For long forms: fill the whole phone screen instead of opening partway. */
  fullOnPhone?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLButtonElement>(null);
  // The caller usually passes a new function on every render. Reading it through a ref keeps the effect below
  // from restarting (and stealing the keyboard focus) each time something inside the sheet changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const phone = usePhoneViewport();
  const keyboard = useKeyboardInset(phone && open);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // Keep the content on screen while the panel slides away.
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      setExpanded(false);
      return;
    }
    const t = setTimeout(() => setPresent(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  // Is there more to see than fits? Then the handle can open the sheet fully.
  const canExpand = () => {
    const b = bodyRef.current;
    return Boolean(b && b.scrollHeight > b.clientHeight + 4);
  };
  useEffect(() => {
    const b = bodyRef.current;
    if (!open || !b) return;
    const measure = () => setOverflowing(canExpand());
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    if (b.firstElementChild) ro.observe(b.firstElementChild);
    return () => ro.disconnect();
  }, [open, present, expanded]);

  useSheetGestures({
    enabled: phone && open,
    open,
    fullOnly: fullOnPhone,
    expanded,
    setExpanded,
    canExpand,
    onClose: () => onCloseRef.current(),
    panelRef,
    dragRef,
    overlayRef,
  });

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus?.();
    };
  }, [open]);

  const style = { "--kb": `${keyboard}px` } as CSSProperties;

  return (
    <div className={cn("fixed inset-0 z-50", !open && "pointer-events-none")} inert={!open}>
      <button
        ref={overlayRef}
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/70 transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={style}
        // tapping a field in a half-open sheet opens it fully, so the field is not squeezed or hidden by the keyboard
        onFocusCapture={(e) => {
          const t = e.target as HTMLElement;
          if (phone && !fullOnPhone && !expanded && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && canExpand()) setExpanded(true);
        }}
        className={cn(
          "absolute inset-x-0 bottom-[var(--kb,0px)] flex flex-col border-t border-[#262626] bg-[#0a0a0a] outline-none",
          "transition-[transform,max-height] duration-300 ease-out motion-reduce:transition-none",
          fullOnPhone
            ? "h-[calc(100dvh_-_var(--kb,0px))] max-h-[calc(100dvh_-_var(--kb,0px))]"
            : expanded
              ? "max-h-[calc(100dvh_-_var(--kb,0px))]"
              : "max-h-[min(72dvh,calc(100dvh_-_var(--kb,0px)))] rounded-t-3xl",
          "md:inset-y-0 md:bottom-0 md:left-auto md:right-0 md:h-auto md:max-h-none md:w-full md:rounded-none md:border-l md:border-t-0",
          wide ? "md:max-w-2xl" : "md:max-w-lg",
          open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-x-full md:translate-y-0",
        )}
      >
        <div ref={dragRef} className="shrink-0 touch-none">
          {!fullOnPhone && (
            <button
              type="button"
              aria-label={expanded ? "Collapse" : "Expand"}
              aria-expanded={expanded}
              aria-disabled={!overflowing && !expanded ? true : undefined}
              onClick={() => (expanded || canExpand() ? setExpanded((v) => !v) : undefined)}
              className="mx-auto grid h-8 w-32 place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <span aria-hidden className="h-1 w-10 rounded-full bg-white/25" />
            </button>
          )}
          <header
            className={cn(
              "flex items-start gap-3 border-b border-[#262626] px-4 py-3 md:px-6 md:py-4 md:pt-4",
              fullOnPhone && "pt-[calc(0.75rem+env(safe-area-inset-top))]",
              expanded && "pt-[calc(0.25rem+env(safe-area-inset-top))]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="font-display text-lg font-semibold tracking-tight">
                  {title}
                </h2>
                {badge}
              </div>
              {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <i aria-hidden className="bx bx-x text-3xl" />
            </button>
          </header>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
          {present ? children : null}
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-[#262626] bg-[#0a0a0a] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">
            {present ? footer : null}
          </footer>
        )}
      </div>
    </div>
  );
}
