import { useNotifications } from "@/lib/notifications";

export function UnreadBadge() {
  const { unread } = useNotifications();
  if (unread <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
