import { toast } from "sonner";

const ADDED = {
  "--toast-border": "color-mix(in oklab, var(--accent) 55%, transparent)",
  "--toast-glow": "var(--accent)",
  "--toast-icon": "var(--accent)",
  "--toast-action": "var(--accent)",
  "--toast-action-fg": "var(--accent-foreground)",
} as React.CSSProperties;

const REMOVED = {
  "--toast-border": "color-mix(in oklab, var(--destructive) 50%, transparent)",
  "--toast-glow": "var(--destructive)",
  "--toast-icon": "var(--destructive)",
} as React.CSSProperties;

export function showWishlistToast(added: boolean, onView?: () => void) {
  if (added) {
    toast.success("Added to wishlist", {
      icon: <i className="bx bxs-heart text-xl" />,
      style: ADDED,
      ...(onView ? { action: { label: "View", onClick: onView } } : {}),
    });
  } else {
    toast("Removed from wishlist", {
      icon: <i className="bx bx-heart text-xl" />,
      style: REMOVED,
    });
  }
}
