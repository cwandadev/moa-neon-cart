import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";

const iconBtn =
  "relative grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground";

export function BottomNav() {
  const { cartCount, setCartOpen, chatOpen, setChatOpen } = useStore();

  return (
    <>
      <div className="h-24 md:hidden" />
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-3xl border border-border bg-card px-5 py-2.5 md:hidden"
      >
        <button type="button" aria-label="Cart" onClick={() => setCartOpen(true)} className={iconBtn}>
          <i className="bx bx-cart text-2xl" />
          {cartCount > 0 && (
            <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-body text-[10px] font-semibold text-primary-foreground">
              {cartCount}
            </span>
          )}
        </button>
        <button type="button" aria-label="Wishlist" className={iconBtn}>
          <i className="bx bx-heart text-2xl" />
        </button>
        <Link
          to="/"
          aria-label="Home"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="grid size-12 place-items-center"
        >
          <img src="/logo.svg" alt="" className="size-12" />
        </Link>
        <button type="button" aria-label="Chat" onClick={() => setChatOpen(!chatOpen)} className={iconBtn}>
          <i className="bx bx-message-dots text-2xl" />
        </button>
        <button type="button" aria-label="Profile" className={iconBtn}>
          <i className="bx bx-user text-2xl" />
        </button>
      </nav>
    </>
  );
}
