import { Link, useRouterState } from "@tanstack/react-router";
import { UserMenu } from "@/components/shop/UserMenu";
import { useChatUnread } from "@/lib/chatUnread";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const cell =
  "relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl text-muted-foreground transition-colors hover:text-foreground active:bg-secondary/60";
const labelClass = "font-body text-[10px] font-medium leading-none";

export function BottomNav() {
  const { cartCount, wishlist, setCartOpen, chatOpen, setChatOpen } = useStore();
  const chatUnread = useChatUnread();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    chatOpen
  )
    return null;

  const homeOn = pathname === "/" || pathname.startsWith("/product/");
  const savedOn = pathname === "/wishlist";
  const accountOn = pathname === "/account" || pathname.startsWith("/orders") || pathname === "/notifications";

  return (
    <>
      <div className="h-24 md:hidden" />
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 z-40 grid grid-cols-5 items-center rounded-3xl border border-border bg-card p-1 md:hidden"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button type="button" aria-label="Cart" onClick={() => setCartOpen(true)} className={cell}>
          <span className="relative">
            <i className="bx bx-cart text-2xl" />
            {cartCount > 0 && (
              <span
                key={cartCount}
                className="absolute -right-2 -top-1.5 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-primary px-1 font-body text-[10px] font-semibold text-primary-foreground"
              >
                {cartCount}
              </span>
            )}
          </span>
          <span className={labelClass}>Cart</span>
        </button>

        <Link
          to="/wishlist"
          aria-label="Saved items"
          aria-current={savedOn ? "page" : undefined}
          className={cn(cell, savedOn && "text-primary")}
        >
          <span className="relative">
            <i className={cn("text-2xl", savedOn ? "bx bxs-heart" : "bx bx-heart")} />
            {wishlist.length > 0 && (
              <span
                key={wishlist.length}
                className="absolute -right-2 -top-1.5 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-accent px-1 font-body text-[10px] font-semibold text-accent-foreground"
              >
                {wishlist.length}
              </span>
            )}
          </span>
          <span className={labelClass}>Saved</span>
        </Link>

        {/* The center of the app: the logo fills the height of the bar, so it is the biggest thing in it. */}
        <div className="grid h-16 place-items-center">
          <Link
            to="/"
            aria-label="Home"
            aria-current={homeOn ? "page" : undefined}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={cn(
              "grid size-16 place-items-center overflow-hidden rounded-full ring-1 ring-primary/40 transition-transform active:scale-95",
              homeOn && "ring-2 ring-primary",
            )}
          >
            <img src="/logo.svg" alt="" className="size-full object-cover" />
          </Link>
        </div>

        <button type="button" aria-label="Chat" onClick={() => setChatOpen(!chatOpen)} className={cell}>
          <span className="relative">
            <i className="bx bx-message-dots text-2xl" />
            {chatUnread > 0 && !chatOpen && (
              <span
                key={chatUnread}
                className="absolute -right-2 -top-1.5 grid h-4 min-w-4 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-destructive px-1 font-body text-[10px] font-semibold text-white"
              >
                {chatUnread > 9 ? "9+" : chatUnread}
              </span>
            )}
          </span>
          <span className={labelClass}>Chat</span>
        </button>

        <UserMenu
          variant="nav"
          className={cn(
            cell,
            "w-full text-muted-foreground! data-[state=open]:text-primary! after:font-body after:text-[10px] after:font-medium after:leading-none after:content-['Account'] [&_i]:text-current",
            accountOn && "text-primary!",
          )}
        />
      </nav>
    </>
  );
}
