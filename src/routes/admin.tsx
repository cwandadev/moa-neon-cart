import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminAlerts } from "@/lib/adminAlerts";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "MOA Mart Management Suite — Admin" },
      {
        name: "description",
        content:
          "Operate MOA Mart: revenue KPIs, analytics, live inventory, finance, chat inbox and order tracking.",
      },
      { property: "og:title", content: "MOA Mart Management Suite" },
      {
        property: "og:description",
        content: "Internal operations console for MOA Mart orders, inventory and analytics.",
      },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { user, ready, isStaff, isAdmin, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const alerts = useAdminAlerts(ready && isStaff);
  // After a reload the login is ready a moment before the role is known. Do not send anyone away until
  // the database has confirmed they really are not staff.
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  useEffect(() => {
    if (!ready || isStaff) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) {
        if (!cancelled) navigate({ to: "/login" });
        return;
      }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
      if (cancelled) return;
      if (p?.role === "staff" || p?.role === "admin") {
        await refreshRef.current();
        return;
      }
      navigate({ to: "/" });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, isStaff, user, navigate]);
  if (!ready || !isStaff) return null;

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Team member";
  return (
    <AdminShell isAdmin={isAdmin} alerts={alerts} name={name} role={isAdmin ? "Admin" : "Staff"}>
      <Outlet />
    </AdminShell>
  );
}
