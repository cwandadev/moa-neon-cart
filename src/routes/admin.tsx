import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "MOA Mart Management Suite — Admin" },
      {
        name: "description",
        content:
          "Operate MOA Mart: revenue KPIs, analytics, live inventory, finance, chat inbox and WhatsApp order tracking.",
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

const NAV = [
  { to: "/admin", label: "Overview", icon: "bx-grid-alt", exact: true },
  { to: "/admin/analytics", label: "Analytics Center", icon: "bx-line-chart" },
  { to: "/admin/inventory", label: "Live Inventory", icon: "bx-box" },
  { to: "/admin/finance", label: "Financial Overview", icon: "bx-wallet" },
  { to: "/admin/inbox", label: "Chat Inbox", icon: "bx-conversation" },
  { to: "/admin/orders", label: "WhatsApp Orders", icon: "bxl-whatsapp" },
] as const;

function AdminLayout() {
  return (
    <div className="moa-admin min-h-screen lg:flex">
      <aside className="hairline sticky top-0 z-30 flex items-center gap-2 overflow-x-auto bg-[#000000]/85 px-4 py-3 backdrop-blur-xl lg:h-screen lg:w-64 lg:flex-col lg:items-stretch lg:overflow-y-auto lg:px-4 lg:py-6">
        <Link to="/" className="mb-0 flex shrink-0 items-center gap-2 lg:mb-8">
          <span className="grid size-9 place-items-center rounded-xl bg-[image:var(--gradient-neon)] text-primary-foreground">
            <i className="bx bx-cube-alt text-xl" />
          </span>
          <span className="font-display text-sm font-semibold">
            MOA<span className="neon-text"> Suite</span>
          </span>
        </Link>

        <nav className="flex shrink-0 gap-2 lg:flex-col">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              activeProps={{ className: "bg-primary/15 text-primary" }}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <i className={`bx ${n.icon} text-base`} /> {n.label}
            </Link>
          ))}
        </nav>

        <Link
          to="/"
          className="hairline ml-auto mt-0 flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-primary lg:ml-0 lg:mt-auto"
        >
          <i className="bx bx-store" /> Storefront
        </Link>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
