import { createFileRoute } from "@tanstack/react-router";
import { HelpCenter } from "@/components/help/HelpCenter";
import { PageHead } from "@/components/moa/ui";
import { STAFF_GUIDE } from "@/lib/help";

export const Route = createFileRoute("/admin/help")({
  head: () => ({ meta: [{ title: "Help — MOA Mart Suite" }] }),
  component: StaffHelp,
});

function StaffHelp() {
  return (
    <>
      <PageHead title="Help" subtitle={STAFF_GUIDE.subtitle} />
      <HelpCenter guide={STAFF_GUIDE} heading={false} className="max-w-3xl" />
    </>
  );
}
