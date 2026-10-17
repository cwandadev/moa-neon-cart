import { useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useNotifications } from "@/lib/notifications";

export function NotificationBell() {
  const { user } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <Button
      variant="glass"
      size="icon"
      className="relative rounded-xl max-md:hidden"
      aria-label="Notifications"
      onClick={() => navigate({ to: "/notifications" })}
    >
      <i className="bx bx-bell text-xl" />
      {unread > 0 && (
        <Badge
          key={unread}
          className="absolute -right-1.5 -top-1.5 h-5 min-w-5 animate-in zoom-in-50 duration-200 justify-center rounded-full bg-destructive px-1 text-[10px] text-white"
        >
          {unread > 9 ? "9+" : unread}
        </Badge>
      )}
    </Button>
  );
}
