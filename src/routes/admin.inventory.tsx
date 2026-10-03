import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { CATEGORIES } from "@/lib/products";
import { PageHead, Panel } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({
    meta: [
      { title: "Live Inventory Manager — MOA Mart Suite" },
      {
        name: "description",
        content: "Track SKUs, stock levels, categories and pricing, and flip availability instantly.",
      },
      { property: "og:title", content: "Live Inventory Manager — MOA Mart Suite" },
      { property: "og:description", content: "Instant stock toggles across the full MOA Mart catalog." },
    ],
  }),
  component: Inventory,
});

function Inventory() {
  const { products, toggleStock, updateStock } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");

  const rows = products.filter(
    (p) =>
      (cat === "All" || p.category === cat) &&
      (p.name.toLowerCase().includes(q.toLowerCase()) ||
        p.sku.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHead title="Live Inventory Manager" subtitle="Stock, SKUs and pricing across every MOA Mart product line." />

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <i className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or SKU"
            className="hairline h-10 w-full rounded-xl bg-card/60 pl-9 pr-3 text-sm outline-none focus:neon-ring"
          />
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
        >
          {["All", ...CATEGORIES].map((c) => (
            <option key={c} value={c} className="bg-card">
              {c}
            </option>
          ))}
        </select>
      </div>

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">Product</th>
              <th className="p-4">SKU</th>
              <th className="p-4">Category</th>
              <th className="p-4">Price</th>
              <th className="p-4">Qty</th>
              <th className="p-4">Availability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-[#262626]/60 transition-colors hover:bg-secondary/30">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <img src={p.images[0]} alt={p.name} className="size-11 rounded-lg object-cover" />
                    <span className="text-xs">{p.name}</span>
                  </div>
                </td>
                <td className="p-4 text-xs text-muted-foreground">{p.sku}</td>
                <td className="p-4 text-xs text-muted-foreground">{p.category}</td>
                <td className="p-4 text-xs text-primary">${p.price}</td>
                <td className="p-4">
                  <input
                    type="number"
                    value={p.stock}
                    onChange={(e) => updateStock(p.id, Number(e.target.value))}
                    className="hairline h-9 w-20 rounded-lg bg-card/60 px-2 text-xs outline-none"
                  />
                </td>
                <td className="p-4">
                  <button
                    role="switch"
                    aria-checked={p.stock > 0}
                    onClick={() => toggleStock(p.id)}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={`hairline relative h-6 w-11 rounded-full transition-colors ${
                        p.stock > 0 ? "bg-success/30" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-foreground transition-all ${
                          p.stock > 0 ? "left-5" : "left-0.5"
                        }`}
                      />
                    </span>
                    <span className={`text-[11px] ${p.stock > 0 ? "text-success" : "text-destructive"}`}>
                      {p.stock > 0 ? "In Stock" : "Out of Stock"}
                    </span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
