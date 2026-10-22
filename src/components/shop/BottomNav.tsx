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
        className="fixed inset-x-3 z-40 md:hidden"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/*
          The bar is three pieces side by side: the two icons on the left, a centre piece with a round notch cut into its top edge,
          and the two icons on the right. The logo sits in the notch, half above the bar. Drawn this way the curve stays perfectly
          round on every phone width, and the border follows it.
        */}
        <div className="flex h-[68px] items-stretch">
          <div className="grid flex-1 grid-cols-2 items-center rounded-l-3xl border-y border-l border-border bg-card px-1">
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
          </div>

          <div className="relative w-24 shrink-0">
            <svg aria-hidden viewBox="0 0 96 68" className="absolute inset-0 size-full">
              <path d="M0 .5H12.9A36 36 0 0 0 83.1 .5H96V67.5H0Z" className="fill-card" />
              <path d="M0 .5H12.9A36 36 0 0 0 83.1 .5H96M0 67.5H96" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-border" />
            </svg>
            {/* The centre of the app: the logo is raised out of the bar, and the whole column (logo and label) is one big tap target. */}
            <Link
              to="/"
              aria-label="Home"
              aria-current={homeOn ? "page" : undefined}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="group absolute inset-x-0 -top-[38px] bottom-0 flex flex-col items-center focus-visible:outline-none"
            >
              <span className="grid size-[60px] place-items-center overflow-hidden rounded-full shadow-[0_10px_22px_-8px_rgba(0,0,0,0.75)] transition-transform duration-200 group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <img src="/logo.svg" alt="" className="size-full object-cover" />
              </span>
            </Link>
          </div>

          <div className="grid flex-1 grid-cols-2 items-center rounded-r-3xl border-y border-r border-border bg-card px-1">
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
          </div>
        </div>
      </nav>
    </>
  );
}
