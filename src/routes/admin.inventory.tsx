import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead, Panel } from "@/components/moa/ui";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({
    meta: [
      { title: "Live Inventory — MOA Mart Suite" },
      { name: "description", content: "Stock levels, SKUs and pricing, with every stock change recorded." },
    ],
  }),
  component: Inventory,
});

const LOW_STOCK = 5;

type Row = {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  images: string[];
  archived_at: string | null;
  category: { name: string } | null;
};

type Movement = {
  id: string;
  delta: number;
  stock_after: number;
  reason: string;
  created_at: string;
  products: { name: string } | null;
  profiles: { first_name: string; last_name: string } | null;
};

function Inventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [flt, setFlt] = useState<"all" | "attention" | "out" | "low">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const loadMoves = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("stock_movements")
        .select("id, delta, stock_after, reason, created_at, products(name), profiles(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(15);
      setMoves((data ?? []) as unknown as Movement[]);
    } catch {
      setMoves([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from("products")
        .select("id, name, sku, price, stock, images, archived_at, category:categories(name)")
        .order("name")
        .limit(500);
      if (err) throw err;
      setRows((data ?? []) as unknown as Row[]);
      setError("");
    } catch {
      setError("Could not load products. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMoves();
    const channel = supabase
      .channel("admin-inventory")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, () => {
        void load();
        void loadMoves();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, loadMoves]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((r) => r.category?.name).filter((c): c is string => Boolean(c))))],
    [rows],
  );

  const shown = rows.filter(
    (p) =>
      (cat === "All" || p.category?.name === cat) &&
      (flt === "all" ||
        (!p.archived_at &&
          (flt === "out" ? p.stock <= 0 : flt === "low" ? p.stock > 0 && p.stock <= LOW_STOCK : p.stock <= LOW_STOCK))) &&
      (p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase())),
  );

  const live = rows.filter((r) => !r.archived_at);
  const outN = live.filter((r) => r.stock <= 0).length;
  const lowN = live.filter((r) => r.stock > 0 && r.stock <= LOW_STOCK).length;
  const chips: Array<["all" | "attention" | "out" | "low", string, number, string]> = [
    ["all", "All", live.length, "border-border text-muted-foreground"],
    ["attention", "Needs attention", outN + lowN, "border-warning/40 text-warning"],
    ["out", "Out of stock", outN, "border-destructive/40 text-destructive"],
    ["low", "Running low", lowN, "border-warning/40 text-warning"],
  ];

  const openEditor = (p: Row) => {
    setEditing(p.id);
    setQty(String(p.stock));
    setReason("");
    setError("");
  };

  const save = async (p: Row) => {
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n < 0) {
      setError("Quantity must be 0 or more.");
      return;
    }
    if (n === p.stock) {
      setEditing(null);
      return;
    }
    if (!reason.trim()) {
      setError("Please give a reason for the change.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.rpc("set_product_stock", {
      p_product_id: p.id,
      p_new_stock: n,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === p.id ? { ...r, stock: n } : r)));
    setEditing(null);
    void loadMoves();
  };

  const status = (n: number) =>
    n <= 0
      ? { label: "Out of stock", cls: "text-destructive bg-destructive/10" }
      : n <= LOW_STOCK
        ? { label: "Low stock", cls: "text-warning bg-warning/10" }
        : { label: "In stock", cls: "text-success bg-success/10" };

  return (
    <>
      <PageHead title="Live Inventory" subtitle="Stock, SKUs and pricing. Every quantity change is recorded with who and why." />

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
          {categories.map((c) => (
            <option key={c} value={c} className="bg-card">
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map(([key, label, n, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFlt(key)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${tone} ${flt === key ? "bg-secondary/70 ring-1 ring-current" : "hover:bg-secondary/30"}`}
          >
            {label} <span className="ml-1 font-semibold">{n}</span>
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">Product</th>
              <th className="p-4">SKU</th>
              <th className="p-4">Category</th>
              <th className="p-4">Price</th>
              <th className="p-4">Qty</th>
              <th className="p-4">Status</th>
              <th className="p-4">Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const st = status(p.stock);
              const edge = p.archived_at
                ? "border-l-4 border-l-transparent"
                : p.stock <= 0
                  ? "border-l-4 border-l-destructive"
                  : p.stock <= LOW_STOCK
                    ? "border-l-4 border-l-warning"
                    : "border-l-4 border-l-success";
              return (
                <tr key={p.id} className="border-b border-[#262626]/60 align-top transition-colors hover:bg-secondary/30">
                  <td className={`p-4 ${edge}`}>
                    <div className="flex items-center gap-3">
                      {p.images[0] && <img src={p.images[0]} alt={p.name} className="size-11 rounded-lg object-cover" />}
                      <span className="text-xs">
                        {p.name}
                        {p.archived_at && <span className="ml-2 text-[10px] text-muted-foreground">(archived)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 text-xs text-muted-foreground">{p.sku}</td>
                  <td className="p-4 text-xs text-muted-foreground">{p.category?.name ?? "—"}</td>
                  <td className="p-4 text-xs text-primary">{money(p.price)}</td>
                  <td className="p-4 text-xs">{p.stock}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="p-4">
                    {editing === p.id ? (
                      <div className="grid w-56 gap-2">
                        <input
                          type="number"
                          min={0}
                          value={qty}
                          onChange={(e) => setQty(e.target.value)}
                          className="hairline h-9 rounded-lg bg-card/60 px-2 text-xs outline-none"
                        />
                        <input
                          list="stock-reasons"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Reason (required)"
                          className="hairline h-9 rounded-lg bg-card/60 px-2 text-xs outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void save(p)}
                            className="h-8 flex-1 rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="hairline h-8 flex-1 rounded-lg text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => openEditor(p)} className="text-[11px] text-primary hover:underline">
                        Adjust stock
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && shown.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No products match.</p>
        )}
      </Panel>

      <datalist id="stock-reasons">
        <option value="Restock" />
        <option value="Counted stock" />
        <option value="Damaged or lost" />
        <option value="Customer return" />
        <option value="Correction" />
      </datalist>

      <h2 className="mb-3 mt-8 text-sm font-medium">Recent stock changes</h2>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">When</th>
              <th className="p-4">Product</th>
              <th className="p-4">Change</th>
              <th className="p-4">Now</th>
              <th className="p-4">Reason</th>
              <th className="p-4">By</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="border-b border-[#262626]/60">
                <td className="p-4 text-[11px] text-muted-foreground">{new Date(m.created_at).toLocaleString()}</td>
                <td className="p-4 text-xs">{m.products?.name ?? "—"}</td>
                <td className={`p-4 text-xs ${m.delta >= 0 ? "text-success" : "text-destructive"}`}>
                  {m.delta > 0 ? "+" : ""}
                  {m.delta}
                </td>
                <td className="p-4 text-xs">{m.stock_after}</td>
                <td className="p-4 text-[11px] text-muted-foreground">{m.reason}</td>
                <td className="p-4 text-[11px] text-muted-foreground">
                  {m.profiles ? `${m.profiles.first_name} ${m.profiles.last_name}`.trim() || "Staff" : "System"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {moves.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No stock changes yet.</p>}
      </Panel>
    </>
  );
}
