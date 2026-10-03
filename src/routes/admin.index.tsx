import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Kpi, PageHead, Panel, StatusPill } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Overview Dashboard — MOA Mart Suite" },
      {
        name: "description",
        content: "Revenue, orders, support load and inventory health at a glance for MOA Mart.",
      },
      { property: "og:title", content: "Overview Dashboard — MOA Mart Suite" },
      { property: "og:description", content: "Live operational KPIs for the MOA Mart storefront." },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { products, orders, threads } = useStore();

  const revenue = products.reduce((n, p) => n + p.price * p.orders, 0);
  const totalOrders = products.reduce((n, p) => n + p.orders, 0);
  const inStock = products.filter((p) => p.stock > 0).length;
  const health = Math.round((inStock / products.length) * 100);
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 5);
  const outStock = products.filter((p) => p.stock === 0);

  return (
    <>
      <PageHead
        title="Overview Dashboard"
        subtitle="Real-time pulse of the MOA Mart storefront and off-platform WhatsApp fulfilment."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Revenue" value={`$${revenue.toLocaleString()}`} delta="+12.4% vs last month" icon="bx-dollar-circle" />
        <Kpi label="Total Orders" value={totalOrders.toLocaleString()} delta="+318 this week" icon="bx-receipt" />
        <Kpi label="Active Support Chats" value={String(threads.filter((t) => t.status === "online").length)} delta="Avg reply 42s" icon="bx-conversation" />
        <Kpi label="Inventory Health" value={`${health}%`} delta={`${inStock}/${products.length} SKUs stocked`} icon="bx-shield-quarter" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Stock alerts"
          action={
            <Link to="/admin/inventory" className="text-xs text-primary">
              Manage <i className="bx bx-right-arrow-alt align-middle" />
            </Link>
          }
        >
          <ul className="flex flex-col gap-3">
            {[...outStock, ...lowStock].slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <img src={p.images[0]} alt={p.name} className="size-10 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">{p.sku}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] ${
                    p.stock === 0 ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                  }`}
                >
                  {p.stock === 0 ? "Out of stock" : `${p.stock} left`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Recent WhatsApp requests"
          action={
            <Link to="/admin/orders" className="text-xs text-primary">
              Tracking desk <i className="bx bx-right-arrow-alt align-middle" />
            </Link>
          }
        >
          <ul className="flex flex-col gap-3">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id} className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
                  <i className="bx bxl-whatsapp text-lg" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    {o.customer} · <span className="text-muted-foreground">{o.id}</span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {o.items.map((i) => i.name).join(", ")}
                  </p>
                </div>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
