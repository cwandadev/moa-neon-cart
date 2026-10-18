import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { UserMenu } from "@/components/shop/UserMenu";
import { useStore } from "@/lib/store";
import { useChatUnread } from "@/lib/chatUnread";

const iconBtn =
  "relative grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground";

export function BottomNav() {
  const { cartCount, wishlist, setCartOpen, chatOpen, setChatOpen } = useStore();
  const chatUnread = useChatUnread();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    chatOpen
  )
    return null;

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
            <span key={cartCount} className="absolute right-0 top-0 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-primary px-1 font-body text-[10px] font-semibold text-primary-foreground">
              {cartCount}
            </span>
          )}
        </button>
        <button type="button" aria-label="Wishlist" onClick={() => navigate({ to: "/wishlist" })} className={iconBtn}>
          <i className="bx bx-heart text-2xl" />
          {wishlist.length > 0 && (
            <span
              key={wishlist.length}
              className="absolute right-0 top-0 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-accent px-1 font-body text-[10px] font-semibold text-accent-foreground"
            >
              {wishlist.length}
            </span>
          )}
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
          {chatUnread > 0 && !chatOpen && (
            <span
              key={chatUnread}
              className="absolute right-0 top-0 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-destructive px-1 font-body text-[10px] font-semibold text-white"
            >
              {chatUnread > 9 ? "9+" : chatUnread}
            </span>
          )}
          <i className="bx bx-message-dots text-2xl" />
        </button>
        <UserMenu variant="nav" className={iconBtn} />
      </nav>
    </>
  );
}
