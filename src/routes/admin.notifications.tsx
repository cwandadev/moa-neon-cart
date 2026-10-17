import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/moa/ui";
import { NotificationList } from "@/components/notifications/NotificationList";
import { markRead } from "@/lib/notifications";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — MOA Mart Suite" }] }),
  component: AdminNotifications,
});

function AdminNotifications() {
  const navigate = useNavigate();
  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="New orders, payments and stock changes, newest first. Red needs action, orange needs a look, green is done."
      />
      <Panel>
        <NotificationList
          onOpen={(n) => {
            void markRead(n.id);
            const link = n.link;
            if (link) void navigate({ to: link as never });
          }}
        />
      </Panel>
    </>
  );
}
