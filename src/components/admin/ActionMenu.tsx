import { useEffect, useId, useRef, useState } from "react";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { cn } from "@/lib/utils";

export type MenuItem = {
  label: string;
  icon: string;
  onSelect: () => void;
  danger?: boolean;
  /** Greyed out; the hint says why (shown under the label). */
  disabled?: boolean;
  hint?: string;
};

/**
 * The "..." button of a row. On a phone it opens a sheet with big rows; on a tablet or desktop it opens
 * a small menu next to the button. Disabled actions stay visible and explain themselves.
 */
export function ActionMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && menuRef.current) {
        const nodes = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
        if (nodes.length === 0) return;
        e.preventDefault();
        const at = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (at + 1) % nodes.length : (at - 1 + nodes.length) % nodes.length;
        nodes[next]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (it: MenuItem) => {
    if (it.disabled) return;
    setOpen(false);
    it.onSelect();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className="bx bx-dots-vertical-rounded text-2xl" />
      </button>

      {/* tablet and desktop: a small menu */}
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 hidden w-64 rounded-2xl border border-[#262626] bg-[#0a0a0a] p-1.5 shadow-2xl shadow-black/60 md:block"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              onClick={() => choose(it)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                it.disabled ? "cursor-not-allowed opacity-50" : it.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-white/5",
              )}
            >
              <i aria-hidden className={cn("bx mt-0.5 text-lg", it.icon)} />
              <span className="min-w-0">
                <span className="block">{it.label}</span>
                {it.hint && <span className="block text-xs text-muted-foreground">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* phone: a sheet with big rows */}
      <div className="md:hidden">
        <AdminSheet open={open} onClose={() => setOpen(false)} title={label}>
          <ul className="-mx-2 grid gap-1" role="menu" aria-label={label}>
            {items.map((it) => (
              <li key={it.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  aria-disabled={it.disabled || undefined}
                  onClick={() => choose(it)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-base transition-colors",
                    it.disabled ? "cursor-not-allowed opacity-50" : it.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-white/5",
                  )}
                >
                  <i aria-hidden className={cn("bx text-2xl", it.icon, !it.danger && "text-muted-foreground")} />
                  <span className="min-w-0">
                    <span className="block">{it.label}</span>
                    {it.hint && <span className="block text-sm text-muted-foreground">{it.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </AdminSheet>
      </div>
    </div>
  );
}
