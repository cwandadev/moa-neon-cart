import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const item =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-body text-sm transition-colors hover:bg-secondary";

export function UserMenu({ variant, className }: { variant: "header" | "nav"; className?: string }) {
  const { user, isAdmin, logOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onClick = () => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className="relative">
      {variant === "header" ? (
        <Button
          variant="glass"
          size="icon"
          className={cn("rounded-xl", user && "text-primary")}
          aria-label="Account"
          onClick={onClick}
        >
          <i className="bx bx-user text-xl" />
        </Button>
      ) : (
        <button
          type="button"
          aria-label="Account"
          onClick={onClick}
          className={cn(className, user && "text-primary")}
        >
          <i className="bx bx-user text-2xl" />
        </button>
      )}

      {open && user && (
        <div
          className={cn(
            "absolute right-0 z-50 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-lg",
            variant === "header" ? "top-full mt-2" : "bottom-full mb-3",
          )}
        >
          <div className="px-3 py-2">
            <p className="truncate font-body text-sm font-medium">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate font-body text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          {isAdmin && (
            <Link to="/admin" onClick={() => setOpen(false)} className={item}>
              <i className="bx bx-grid-alt text-lg" /> Admin
            </Link>
          )}
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              logOut();
              navigate({ to: "/" });
            }}
          >
            <i className="bx bx-log-out text-lg" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
