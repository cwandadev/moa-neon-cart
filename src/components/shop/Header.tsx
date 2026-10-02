import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";

export function Header({
  query,
  onQueryChange,
}: {
  query?: string;
  onQueryChange?: (v: string) => void;
}) {
  const { cartCount, wishlist, setCartOpen } = useStore();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] max-sm:grid-cols-1 items-center gap-3 px-4 py-3 sm:px-6 lg:gap-6">
        <div className="flex min-w-0 items-center gap-3 max-md:justify-center lg:gap-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img src="/logo.svg" alt="" className="h-9 w-9 shrink-0" />
            <span className="font-display text-lg font-semibold tracking-tight sm:text-xl">
              MOA <span className="text-gradient">Mart</span>
            </span>
          </Link>

          <div className="relative hidden min-w-0 flex-1 items-center lg:flex">
            <i className="bx bx-search pointer-events-none absolute left-3 text-lg text-muted-foreground" />
            <Input
              value={query ?? ""}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search products, categories, brands…"
              className="h-10 rounded-xl border-border bg-glass pl-10 font-body"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 max-sm:hidden sm:gap-2">
          <Button variant="glass" size="icon" className="relative rounded-xl max-md:hidden" aria-label="Wishlist">
            <i className="bx bx-heart text-xl" />
            {wishlist.length > 0 && (
              <Badge className="absolute -right-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full bg-accent px-1 text-[10px] text-accent-foreground">
                {wishlist.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="glass"
            size="icon"
            className="relative rounded-xl max-md:hidden"
            aria-label="Cart"
            onClick={() => setCartOpen(true)}
          >
            <i className="bx bx-shopping-bag text-xl" />
            {cartCount > 0 && (
              <Badge className="absolute -right-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
                {cartCount}
              </Badge>
            )}
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden rounded-xl font-body sm:inline-flex">
            <Link to="/admin">
              <i className="bx bx-grid-alt text-lg" /> Admin
            </Link>
          </Button>
        </div>
      </div>

      <div className="px-4 pb-3 sm:px-6 lg:hidden">
        <div className="relative flex items-center">
          <i className="bx bx-search pointer-events-none absolute left-3 text-lg text-muted-foreground" />
          <Input
            value={query ?? ""}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder="Search MOA Mart…"
            className="h-10 rounded-xl border-border bg-glass pl-10 font-body"
          />
        </div>
      </div>
    </header>
  );
}