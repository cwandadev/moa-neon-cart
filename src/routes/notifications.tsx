import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { NotificationList } from "@/components/notifications/NotificationList";
import { Header } from "@/components/shop/Header";
import { useAuth } from "@/lib/auth";
import { markRead } from "@/lib/notifications";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login" });
  }, [ready, user, navigate]);

  if (!ready || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Notifications</h1>
        <div className="mt-2">
          <NotificationList
            onOpen={(n) => {
              void markRead(n.id);
              const link = n.link;
              if (link) void navigate({ to: link as never });
            }}
          />
        </div>
      </main>
    </div>
  );
}
