import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/lib/notifications";
import { clearPersisted } from "@/lib/persist";

const item =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-body text-sm transition-colors hover:bg-secondary";

export function UserMenu({ variant, className }: { variant: "header" | "nav"; className?: string }) {
  const { user, isStaff, logOut } = useAuth();
  const { unread } = useNotifications();
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
          className={cn("relative rounded-xl", user && "text-primary")}
          aria-label={user && unread > 0 ? `Account, ${unread} unread notifications` : "Account"}
          onClick={onClick}
        >
          <i className="bx bx-user text-xl" />
          {user && unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 animate-in zoom-in-50 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white duration-200">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      ) : (
        <button
          type="button"
          aria-label="Account"
          onClick={onClick}
          className={className}
        >
          <i className="bx bx-user text-2xl" />
          {user && unread > 0 && <span className="absolute left-1/2 top-2 ml-1.5 size-2.5 rounded-full bg-destructive" />}
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
          {/* menu order: admin first */}
          {isStaff && (
            <Link to="/admin" onClick={() => setOpen(false)} className={item}>
              <i className="bx bx-grid-alt text-lg" /> Admin
            </Link>
          )}
          <Link to="/orders" onClick={() => setOpen(false)} className={item}>
            <i className="bx bx-receipt text-lg" /> My orders
          </Link>
          <Link to="/notifications" onClick={() => setOpen(false)} className={item}>
            <i className="bx bx-bell text-lg" /> Notifications
            {unread > 0 && (
              <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
          <Link to="/account" onClick={() => setOpen(false)} className={item}>
            <i className="bx bx-user-circle text-lg" /> Account
          </Link>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              clearPersisted("moa:");
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
