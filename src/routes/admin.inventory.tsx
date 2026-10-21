import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead, Skeleton } from "@/components/moa/ui";
import { ago, csvSafe, downloadText, toCsv } from "@/lib/adminTools";
import { usePersistedState } from "@/lib/persist";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — MOA Mart Suite" },
      { name: "description", content: "Stock levels per product and per size, with every change recorded." },
    ],
  }),
  component: Inventory,
});

const LOW_STOCK = 5;
const MAX_STOCK = 100_000;

type Variant = { id: string; option1: string | null; option2: string | null; sku: string | null; stock: number; position: number };
type Row = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  images: string[];
  archived_at: string | null;
  category: { name: string } | null;
  product_variants: Variant[];
};
type Movement = {
  id: string;
  product_id: string;
  delta: number;
  stock_after: number;
  reason: string;
  created_at: string;
  variant_label: string | null;
  products: { name: string } | null;
  profiles: { first_name: string; last_name: string } | null;
};
type Flt = "all" | "attention" | "out" | "low";

const REASONS = ["New stock arrived", "Stock count", "Damaged or lost", "Returned by a customer", "Other"];

const labelOf = (v: Variant) => [v.option1, v.option2].filter(Boolean).join(" / ") || "Default";
const sortedVariants = (p: Row) => [...p.product_variants].sort((a, b) => a.position - b.position);
const outSizes = (p: Row) => (p.stock > 0 ? p.product_variants.filter((v) => v.stock <= 0) : []);

function level(n: number): { label: string; cls: string } {
  if (n <= 0) return { label: "Out of stock", cls: "bg-destructive/10 text-destructive" };
  if (n <= LOW_STOCK) return { label: "Low stock", cls: "bg-warning/10 text-warning" };
  return { label: "In stock", cls: "bg-success/10 text-success" };
}

const whoOf = (m: Movement) => `${m.profiles?.first_name ?? ""} ${m.profiles?.last_name ?? ""}`.trim() || "System";

function Thumb({ p, size }: { p: Row; size: string }) {
  return p.images[0] ? (
    <img src={p.images[0]} alt="" className={cn("shrink-0 rounded-xl object-cover", size)} />
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground", size)}>
      <i aria-hidden className="bx bx-package text-xl" />
    </span>
  );
}

/** A number with a minus and a plus, big enough for a thumb. */
function Stepper({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const n = Number(value);
  const step = (d: number) => onChange(String(Math.max(0, Math.min(MAX_STOCK, (Number.isFinite(n) ? Math.floor(n) : 0) + d))));
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => step(-1)} aria-label={`Decrease ${label}`} className="grid size-11 place-items-center rounded-xl border border-[#262626] text-xl hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <i aria-hidden className="bx bx-minus" />
      </button>
      <input
        aria-label={`Stock for ${label}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
        className={cn(field, "w-20 text-center")}
      />
      <button type="button" onClick={() => step(1)} aria-label={`Increase ${label}`} className="grid size-11 place-items-center rounded-xl border border-[#262626] text-xl hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <i aria-hidden className="bx bx-plus" />
      </button>
    </div>
  );
}

// ---------- changing the stock of one product, per size ----------

type Target = { key: string; label: string; current: number; variantId: string | null };

function AdjustSheet({ open, product, history, onClose, onSaved }: { open: boolean; product: Row | null; history: Movement[]; onClose: () => void; onSaved: () => void }) {
  const targets: Target[] = useMemo(() => {
    if (!product) return [];
    return product.product_variants.length > 0
      ? sortedVariants(product).map((v) => ({ key: v.id, label: labelOf(v), current: v.stock, variantId: v.id }))
      : [{ key: product.id, label: "In stock", current: product.stock, variantId: null }];
  }, [product]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState(REASONS[0] ?? "Other");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValues(Object.fromEntries(targets.map((t) => [t.key, String(t.current)])));
    setChoice(REASONS[0] ?? "Other");
    setText("");
    setError("");
  }, [targets, open]);

  const changes = targets.filter((t) => {
    const n = Number(values[t.key] ?? t.current);
    return Number.isInteger(n) && n !== t.current;
  });

  const save = async () => {
    if (!product) return;
    setError("");
    for (const t of changes) {
      const n = Number(values[t.key]);
      if (!Number.isInteger(n) || n < 0 || n > MAX_STOCK) return setError(`${t.label}: enter a whole number from 0 to ${MAX_STOCK}.`);
    }
    const detail = text.trim();
    const reason = choice === "Other" ? detail : detail ? `${choice} — ${detail}` : choice;
    if (!reason) return setError("Please give a reason for the change.");
    setBusy(true);
    for (const t of changes) {
      const n = Number(values[t.key]);
      const { error: err } = t.variantId
        ? await supabase.rpc("set_variant_stock", { p_variant_id: t.variantId, p_new_stock: n, p_reason: reason })
        : await supabase.rpc("set_product_stock", { p_product_id: product.id, p_new_stock: n, p_reason: reason });
      if (err) {
        setBusy(false);
        setError(`${t.label}: ${err.message}`);
        onSaved(); // the ones before it were saved
        return;
      }
    }
    setBusy(false);
    toast.success(changes.length === 1 ? "Stock updated." : `${changes.length} stock levels updated.`);
    onSaved();
    onClose();
  };

  const total = targets.reduce((n, t) => n + (Number.isInteger(Number(values[t.key])) ? Number(values[t.key]) : t.current), 0);

  return (
    <AdminSheet
      open={open}
      onClose={() => !busy && onClose()}
      title={product?.name ?? "Stock"}
      subtitle={product ? `${product.sku} · ${product.category?.name ?? "—"}` : undefined}
      footer={
        <div className="grid gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={busy || changes.length === 0} onClick={() => void save()} className={btn.primary}>
              {busy ? "Saving…" : changes.length === 0 ? "No changes yet" : `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      }
    >
      {product && (
        <div className="grid gap-6">
          <section aria-label="Stock">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-base font-semibold">{product.product_variants.length > 0 ? "Stock per option" : "Stock"}</h3>
              {targets.length > 1 && <span className="text-sm text-muted-foreground">Total {total}</span>}
            </div>
            <ul className="grid gap-2">
              {targets.map((t) => {
                const n = Number(values[t.key] ?? t.current);
                const diff = Number.isInteger(n) ? n - t.current : 0;
                return (
                  <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#262626] p-3">
                    <div className="min-w-0">
                      <p className="text-base">{t.label}</p>
                      <p className="text-sm text-muted-foreground">
                        Now {t.current}
                        {diff !== 0 && <span className={cn("ml-2 font-medium", diff > 0 ? "text-success" : "text-destructive")}>{diff > 0 ? `+${diff}` : diff}</span>}
                      </p>
                    </div>
                    <Stepper label={t.label} value={values[t.key] ?? String(t.current)} onChange={(v) => setValues((s) => ({ ...s, [t.key]: v }))} />
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Reason">
            <h3 className="mb-2 font-display text-base font-semibold">Why is it changing?</h3>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={choice === r}
                  onClick={() => setChoice(r)}
                  className={cn("min-h-11 rounded-full border px-4 text-sm transition-colors", choice === r ? "border-foreground/60 bg-white/10 text-foreground" : "border-[#262626] text-muted-foreground hover:text-foreground")}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              aria-label="More detail"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={120}
              placeholder={choice === "Other" ? "Write the reason" : "More detail (optional)"}
              className={cn(field, "mt-3")}
            />
          </section>

          <section aria-label="History">
            <h3 className="mb-2 font-display text-base font-semibold">Recent changes</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[#262626]">
                {history.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 py-2.5">
                    <span className={cn("w-12 shrink-0 text-right text-sm font-semibold tabular-nums", m.delta > 0 ? "text-success" : "text-destructive")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {m.variant_label ? `${m.variant_label}: ` : ""}
                        {m.reason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Now {m.stock_after} · {whoOf(m)} · {ago(m.created_at)} ago
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminSheet>
  );
}

// ---------- the page ----------

function Inventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [q, setQ] = usePersistedState("moa:inventory:q", "");
  const [cat, setCat] = usePersistedState("moa:inventory:cat", "All");
  const [flt, setFlt] = usePersistedState<Flt>("moa:inventory:filter", "all");
  const [visible, setVisible] = useState(30);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [history, setHistory] = useState<Movement[]>([]);

  const loadMoves = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("stock_movements")
        .select("id, product_id, delta, stock_after, reason, created_at, variant_label, products(name), profiles(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(15);
      setMoves((data ?? []) as unknown as Movement[]);
    } catch {
      setMoves([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, stock, images, archived_at, category:categories(name), product_variants(id, option1, option2, sku, stock, position)")
        .order("name")
        .limit(500);
      if (error) throw error;
      setRows((data ?? []) as unknown as Row[]);
      setLoadError("");
    } catch {
      setLoadError("Could not load products. Check your connection and try again.");
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "product_variants" }, () => {
        void load();
        void loadMoves();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, loadMoves]);

  const categories = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.category?.name).filter((c): c is string => Boolean(c))))], [rows]);

  const live = rows.filter((r) => !r.archived_at);
  const outN = live.filter((r) => r.stock <= 0).length;
  const lowN = live.filter((r) => r.stock > 0 && r.stock <= LOW_STOCK).length;
  const needs = (p: Row) => p.stock <= LOW_STOCK || outSizes(p).length > 0;

  const t = q.trim().toLowerCase();
  const shown = rows
    .filter(
      (p) =>
        (cat === "All" || p.category?.name === cat) &&
        (flt === "all" || (!p.archived_at && (flt === "out" ? p.stock <= 0 : flt === "low" ? p.stock > 0 && p.stock <= LOW_STOCK : needs(p)))) &&
        (!t || p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || p.product_variants.some((v) => (v.sku ?? "").toLowerCase().includes(t))),
    )
    .sort((a, b) => (flt === "all" ? a.name.localeCompare(b.name) : a.stock - b.stock));
  const page = shown.slice(0, visible);

  const tabs: TabItem<Flt>[] = [
    { key: "all", label: "All", count: live.length },
    { key: "attention", label: "Needs attention", count: outN + lowN + live.filter((r) => r.stock > LOW_STOCK && outSizes(r).length > 0).length, tone: "warning" },
    { key: "out", label: "Out of stock", count: outN },
    { key: "low", label: "Running low", count: lowN },
  ];

  const loadHistory = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("stock_movements")
      .select("id, product_id, delta, stock_after, reason, created_at, variant_label, products(name), profiles(first_name, last_name)")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(8);
    setHistory((data ?? []) as unknown as Movement[]);
  }, []);

  const openSheet = (p: Row) => {
    setSheetId(p.id);
    setSheetOpen(true);
    setHistory([]);
    void loadHistory(p.id);
  };
  const sheetRow = rows.find((r) => r.id === sheetId) ?? null;

  const exportCsv = () => {
    const out: Array<Array<string | number | null | undefined>> = [["SKU", "Product", "Option", "Stock", "Status"]];
    for (const p of rows) {
      if (p.product_variants.length === 0) out.push([p.sku, csvSafe(p.name), "", p.stock, p.archived_at ? "Archived" : level(p.stock).label]);
      else for (const v of sortedVariants(p)) out.push([v.sku ?? p.sku, csvSafe(p.name), csvSafe(labelOf(v)), v.stock, p.archived_at ? "Archived" : level(v.stock).label]);
    }
    downloadText(`moa-stock-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
    toast.success("Stock list exported.");
  };

  return (
    <>
      <PageHead
        title="Inventory"
        subtitle="Stock per product and per size. Every change is recorded with who and why."
        actions={
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={btn.ghost}>
            <i aria-hidden className="bx bx-download text-lg" /> Export
          </button>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField
            value={q}
            onChange={(v) => {
              setQ(v);
              setVisible(30);
            }}
            label="Search products"
            placeholder="Search name or SKU"
          />
          <select aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value); setVisible(30); }} className={cn(field, "sm:w-52")}>
            {categories.map((c) => (
              <option key={c} value={c} className="bg-card">
                {c === "All" ? "All categories" : c}
              </option>
            ))}
          </select>
        </div>
        <FilterTabs items={tabs} value={flt} onChange={(k) => { setFlt(k); setVisible(30); }} label="Stock level" />
      </div>

      <div className="mt-4">
        {loadError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
            <p className="text-destructive">{loadError}</p>
            <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
              Try again
            </button>
          </div>
        )}

        {loading && !loadError && (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1" aria-label="Loading products">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3 rounded-2xl border border-[#262626] bg-card p-4">
                <Skeleton className="size-16 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-3 h-4 w-24" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && !loadError && shown.length === 0 && (
          <div className="rounded-2xl border border-[#262626] bg-card">
            <EmptyState
              icon={flt === "all" ? "bx-search" : "bx-check-circle"}
              title={flt === "all" ? "No products match" : "Nothing needs attention"}
              hint={flt === "all" ? "Try a different word or category." : "Every product in this view has enough stock."}
              action={<button type="button" className={btn.ghost} onClick={() => { setQ(""); setCat("All"); setFlt("all"); }}>Show everything</button>}
            />
          </div>
        )}

        {page.length > 0 && (
          <>
            <ul className="grid gap-3 md:grid-cols-2 lg:hidden" aria-label="Products">
              {page.map((p) => {
                const s = p.archived_at ? { label: "Archived", cls: "bg-muted text-muted-foreground" } : level(p.stock);
                const sizes = sortedVariants(p);
                return (
                  <li key={p.id} className="rounded-2xl border border-[#262626] bg-card p-4">
                    <div className="flex items-start gap-3">
                      <Thumb p={p} size="size-16" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">{p.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {p.sku} · {p.category?.name ?? "—"}
                        </p>
                        <span className={cn("mt-1 inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", s.cls)}>{s.label}</span>
                      </div>
                      <p className="shrink-0 font-display text-3xl font-semibold tabular-nums">{p.stock}</p>
                    </div>
                    {sizes.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Sizes of ${p.name}`}>
                        {sizes.slice(0, 8).map((v) => (
                          <li key={v.id} className={cn("rounded-full px-2.5 py-1 text-xs", v.stock <= 0 ? "bg-destructive/10 text-destructive" : v.stock <= LOW_STOCK ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground")}>
                            {labelOf(v)}: {v.stock}
                          </li>
                        ))}
                        {sizes.length > 8 && <li className="px-1 py-1 text-xs text-muted-foreground">+{sizes.length - 8} more</li>}
                      </ul>
                    )}
                    <button type="button" onClick={() => openSheet(p)} className={cn(btn.ghost, "mt-3 w-full")}>
                      Adjust stock
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-hidden rounded-2xl border border-[#262626] bg-card lg:block">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col />
                  <col className="w-40" />
                  <col className="w-36" />
                  <col className="w-24" />
                  <col className="w-36" />
                  <col className="w-40" />
                </colgroup>
                <thead className="border-b border-[#262626] text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 font-medium">SKU</th>
                    <th className="px-3 py-3 font-medium">Category</th>
                    <th className="px-3 py-3 font-medium">Stock</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right">
                      <span className="sr-only">Adjust</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((p) => {
                    const s = p.archived_at ? { label: "Archived", cls: "bg-muted text-muted-foreground" } : level(p.stock);
                    const out = outSizes(p);
                    return (
                      <tr key={p.id} className="border-b border-[#262626]/70 align-middle last:border-0 hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Thumb p={p} size="size-12" />
                            <div className="min-w-0">
                              <p className="truncate">{p.name}</p>
                              {p.product_variants.length > 0 && (
                                <p className={cn("truncate text-xs", out.length > 0 ? "text-destructive" : "text-muted-foreground")}>
                                  {p.product_variants.length} options{out.length > 0 ? ` · ${out.length} out of stock` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-3 py-3 text-muted-foreground">{p.sku}</td>
                        <td className="truncate px-3 py-3 text-muted-foreground">{p.category?.name ?? "—"}</td>
                        <td className="px-3 py-3 font-medium tabular-nums">{p.stock}</td>
                        <td className="px-3 py-3">
                          <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", s.cls)}>{s.label}</span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button type="button" onClick={() => openSheet(p)} className={btn.ghost} aria-label={`Adjust stock of ${p.name}`}>
                            Adjust stock
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {page.length} of {shown.length} products
              </p>
              {shown.length > visible && (
                <button type="button" onClick={() => setVisible((n) => n + 30)} className={btn.ghost}>
                  Show more
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <section aria-label="Recent stock changes" className="mt-10">
        <h2 className="mb-3 font-display text-lg font-semibold">Recent stock changes</h2>
        <div className="rounded-2xl border border-[#262626] bg-card px-4">
          {moves.length === 0 ? (
            <EmptyState icon="bx-history" title="No changes yet" hint="Every stock change appears here with who made it and why." />
          ) : (
            <ul className="divide-y divide-[#262626]">
              {moves.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <span className={cn("w-12 shrink-0 text-right text-sm font-semibold tabular-nums", m.delta > 0 ? "text-success" : "text-destructive")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {m.products?.name ?? "Product"}
                      {m.variant_label ? ` · ${m.variant_label}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">{m.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Now {m.stock_after} · {whoOf(m)} · {ago(m.created_at)} ago
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <AdjustSheet
        key={sheetId ?? "none"}
        open={sheetOpen}
        product={sheetRow}
        history={history}
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          void load();
          void loadMoves();
          if (sheetId) void loadHistory(sheetId);
        }}
      />
    </>
  );
}
