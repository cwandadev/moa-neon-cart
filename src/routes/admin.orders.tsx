import { createFileRoute } from "@tanstack/react-router";
import { ORDER_STATUSES, useStore, type OrderStatus } from "@/lib/store";
import { PageHead, Panel, StatusPill } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "WhatsApp Orders & Tracking Desk — MOA Mart Suite" },
      {
        name: "description",
        content: "Log, verify and update every WhatsApp order placed through the MOA Mart storefront.",
      },
      { property: "og:title", content: "WhatsApp Orders & Tracking Desk — MOA Mart Suite" },
      { property: "og:description", content: "Manual fulfilment tracking for off-platform WhatsApp orders." },
    ],
  }),
  component: Orders,
});

function Orders() {
  const { orders, setOrderStatus } = useStore();

  return (
    <>
      <PageHead title="WhatsApp Orders & Tracking Desk" subtitle="Every order request captured from the storefront checkout flow." />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
        <i className="bx bx-error-circle mt-0.5 text-lg text-warning" />
        <p className="text-xs leading-relaxed text-warning">
          Orders are finalized off-platform via WhatsApp text messages. Please ensure order status is
          manually updated once payment or delivery is verified.
        </p>
      </div>

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">Order</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Contact</th>
              <th className="p-4">Products</th>
              <th className="p-4">Total</th>
              <th className="p-4">Status</th>
              <th className="p-4">Update</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-[#262626]/60 align-top hover:bg-secondary/30">
                <td className="p-4">
                  <p className="text-xs text-primary">{o.id}</p>
                  <p className="text-[11px] text-muted-foreground">{o.createdAt}</p>
                </td>
                <td className="p-4">
                  <p className="text-xs">{o.customer}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {o.orderType} · {o.time}
                  </p>
                </td>
                <td className="p-4">
                  <p className="text-xs">{o.phone}</p>
                  <p className="text-[11px] text-muted-foreground">{o.location}</p>
                </td>
                <td className="p-4">
                  <ul className="flex flex-col gap-2">
                    {o.items.map((it, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <img src={it.image} alt={it.name} className="size-9 rounded-lg object-cover" />
                        <span className="text-[11px]">
                          {it.name} <span className="text-muted-foreground">×{it.qty}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="p-4 text-xs text-primary">${o.total.toFixed(2)}</td>
                <td className="p-4">
                  <StatusPill status={o.status} />
                </td>
                <td className="p-4">
                  <select
                    value={o.status}
                    onChange={(e) => setOrderStatus(o.id, e.target.value as OrderStatus)}
                    className="hairline h-9 rounded-lg bg-card/60 px-2 text-[11px] outline-none"
                  >
                    {ORDER_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-card">
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
