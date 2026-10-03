import { createFileRoute } from "@tanstack/react-router";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { z } from "zod";
import { useStore, type AdminProduct, type ProductInput } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/products";
import { PageHead, Panel } from "@/components/moa/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Product Management — MOA Mart Suite" },
      {
        name: "description",
        content: "Create, edit and delete products in the MOA Mart catalog.",
      },
      { property: "og:title", content: "Product Management — MOA Mart Suite" },
      { property: "og:description", content: "Manage the MOA Mart product catalog." },
    ],
  }),
  component: Products,
});

const isHttp = (u: string) => /^https?:/i.test(u.trim());

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(80, "Name is too long (80 max)"),
    category: z.string().refine((v) => (CATEGORIES as string[]).includes(v), "Pick a category"),
    price: z
      .number({ required_error: "Price is required", invalid_type_error: "Enter a valid price" })
      .positive("Price must be greater than 0")
      .max(1000000, "Price is too high"),
    oldPrice: z
      .number({ invalid_type_error: "Enter a valid price" })
      .positive("Must be greater than 0")
      .optional(),
    stock: z
      .number({ required_error: "Stock is required", invalid_type_error: "Enter a valid number" })
      .int("Stock must be a whole number")
      .min(0, "Stock cannot be negative")
      .max(100000, "Stock is too high"),
    image: z
      .string()
      .trim()
      .min(1, "Image URL is required")
      .url("Enter a valid URL")
      .refine(isHttp, "URL must start with http:// or https://"),
    blurb: z.string().trim().max(160, "Keep the short description under 160 characters"),
    description: z.string().trim().max(1000, "Description is too long (1000 max)"),
    tags: z.array(z.string().max(30, "Each tag must be under 30 characters")).max(8, "Up to 8 tags"),
  })
  .refine((d) => d.oldPrice === undefined || d.oldPrice > d.price, {
    path: ["oldPrice"],
    message: "Old price must be higher than the price",
  });

type Form = {
  name: string;
  category: string;
  price: string;
  oldPrice: string;
  stock: string;
  image: string;
  blurb: string;
  description: string;
  tags: string;
};
type Errors = Partial<Record<keyof Form, string>>;

const toForm = (p?: AdminProduct): Form => ({
  name: p?.name ?? "",
  category: p?.category ?? CATEGORIES[0] ?? "",
  price: p ? String(p.price) : "",
  oldPrice: p?.oldPrice ? String(p.oldPrice) : "",
  stock: p ? String(p.stock) : "0",
  image: p?.images[0] ?? "",
  blurb: p?.blurb ?? "",
  description: p?.description ?? "",
  tags: p?.tags.join(", ") ?? "",
});

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function validate(f: Form, existing?: AdminProduct): { errors: Errors; input?: ProductInput } {
  const r = schema.safeParse({
    name: f.name,
    category: f.category,
    price: num(f.price),
    oldPrice: num(f.oldPrice),
    stock: num(f.stock),
    image: f.image,
    blurb: f.blurb,
    description: f.description,
    tags: f.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  });
  if (!r.success) {
    const errors: Errors = {};
    for (const i of r.error.issues) {
      const k = i.path[0] as keyof Form;
      errors[k] ??= i.message;
    }
    return { errors };
  }
  const d = r.data;
  return {
    errors: {},
    input: {
      name: d.name,
      category: d.category as Category,
      price: d.price,
      oldPrice: d.oldPrice,
      stock: d.stock,
      images: [d.image, ...(existing?.images.slice(1) ?? [])],
      blurb: d.blurb,
      description: d.description,
      tags: d.tags,
    },
  };
}

const stockState = (n: number) =>
  n <= 0
    ? { label: "Out of Stock", cls: "text-destructive" }
    : n <= 5
      ? { label: "Low Stock", cls: "text-warning" }
      : { label: "In Stock", cls: "text-success" };

const fieldClass =
  "w-full rounded-xl border border-[#262626] bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </label>
  );
}

function ProductDialog({ product, onClose }: { product?: AdminProduct | undefined; onClose: () => void }) {
  const { addProduct, updateProduct } = useStore();
  const [form, setForm] = useState<Form>(() => toForm(product));
  const [errors, setErrors] = useState<Errors>({});

  const set =
    (k: keyof Form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    const { errors: e, input } = validate(form, product);
    setErrors(e);
    if (!input) return;
    if (product) updateProduct(product.id, input);
    else addProduct(input);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="moa-admin-dialog max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            {product ? `Editing ${product.sku}` : "A SKU is generated automatically."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Name" error={errors.name}>
            <input value={form.name} onChange={set("name")} className={`${fieldClass} h-10`} placeholder="Vector Runner V3" />
          </Field>

          <Field label="Category" error={errors.category}>
            <select value={form.category} onChange={set("category")} className={`${fieldClass} h-10`}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-card">
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Price ($)" error={errors.price}>
              <input value={form.price} onChange={set("price")} inputMode="decimal" className={`${fieldClass} h-10`} />
            </Field>
            <Field label="Old price (optional)" error={errors.oldPrice}>
              <input value={form.oldPrice} onChange={set("oldPrice")} inputMode="decimal" className={`${fieldClass} h-10`} />
            </Field>
            <Field label="Stock" error={errors.stock}>
              <input value={form.stock} onChange={set("stock")} inputMode="numeric" className={`${fieldClass} h-10`} />
            </Field>
          </div>

          <Field label="Image URL" error={errors.image}>
            <div className="flex items-center gap-3">
              <input value={form.image} onChange={set("image")} className={`${fieldClass} h-10`} placeholder="https://..." />
              {isHttp(form.image) && (
                <img
                  key={form.image}
                  src={form.image}
                  alt=""
                  className="size-10 shrink-0 rounded-lg object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </div>
          </Field>

          <Field label="Short description (optional)" error={errors.blurb}>
            <input value={form.blurb} onChange={set("blurb")} className={`${fieldClass} h-10`} />
          </Field>

          <Field label="Description (optional)" error={errors.description}>
            <textarea value={form.description} onChange={set("description")} rows={3} className={`${fieldClass} py-2`} />
          </Field>

          <Field label="Tags (comma separated, optional)" error={errors.tags}>
            <input value={form.tags} onChange={set("tags")} className={`${fieldClass} h-10`} placeholder="running, mesh, summer" />
          </Field>
        </div>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-[#262626] px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {product ? "Save changes" : "Create product"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  const btn =
    "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground";
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Edit ${name}`} onClick={onEdit} className={btn}>
        <i className="bx bx-edit text-lg" />
      </button>
      <button type="button" aria-label={`Delete ${name}`} onClick={onDelete} className={btn}>
        <i className="bx bx-trash text-lg" />
      </button>
    </div>
  );
}

type Confirm = { type: "delete"; product: AdminProduct } | { type: "reset" } | null;

function Products() {
  const { products, deleteProduct, resetProducts } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [visible, setVisible] = useState(20);
  const [dialog, setDialog] = useState<{ product?: AdminProduct | undefined } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const rows = products.filter((p) => {
    const t = q.trim().toLowerCase();
    return (
      (cat === "All" || p.category === cat) &&
      (!t || `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(t))
    );
  });
  const shown = rows.slice(0, visible);

  return (
    <>
      <PageHead
        title="Product Management"
        subtitle="Create, edit and remove products. Changes are saved in this browser until the backend is connected."
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <i className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setVisible(20);
            }}
            placeholder="Search name, SKU or category"
            className="hairline h-10 w-full rounded-xl bg-card/60 pl-9 pr-3 text-sm outline-none focus:neon-ring"
          />
        </div>
        <select
          value={cat}
          onChange={(e) => {
            setCat(e.target.value);
            setVisible(20);
          }}
          className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
        >
          {["All", ...CATEGORIES].map((c) => (
            <option key={c} value={c} className="bg-card">
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDialog({})}
          className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <i className="bx bx-plus text-lg" /> Add product
        </button>
        <button
          type="button"
          onClick={() => setConfirm({ type: "reset" })}
          className="hairline h-10 rounded-xl px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Reset demo data
        </button>
      </div>

      {rows.length === 0 ? (
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">No products match your search.</p>
        </Panel>
      ) : (
        <>
          <Panel className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-4">Product</th>
                  <th className="p-4">SKU</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Stock</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const s = stockState(p.stock);
                  return (
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
                      <td className="p-4 text-xs">{p.stock}</td>
                      <td className={`p-4 text-[11px] ${s.cls}`}>{s.label}</td>
                      <td className="p-4">
                        <div className="flex justify-end">
                          <RowActions
                            name={p.name}
                            onEdit={() => setDialog({ product: p })}
                            onDelete={() => setConfirm({ type: "delete", product: p })}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {shown.map((p) => {
              const s = stockState(p.stock);
              return (
                <div key={p.id} className="glass rounded-2xl p-4">
                  <div className="flex gap-3">
                    <img src={p.images[0]} alt={p.name} className="size-16 shrink-0 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {p.sku} · {p.category}
                      </p>
                      <p className="mt-1 text-sm text-primary">${p.price}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-[11px] ${s.cls}`}>
                      {s.label} · {p.stock}
                    </span>
                    <RowActions
                      name={p.name}
                      onEdit={() => setDialog({ product: p })}
                      onDelete={() => setConfirm({ type: "delete", product: p })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground md:mb-20">
            <span>
              Showing {shown.length} of {rows.length} products
            </span>
            {rows.length > visible && (
              <button
                type="button"
                onClick={() => setVisible(visible + 20)}
                className="hairline rounded-xl px-4 py-2 transition-colors hover:text-foreground"
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}

      {dialog && (
        <ProductDialog
          key={dialog.product?.id ?? "new"}
          product={dialog.product}
          onClose={() => setDialog(null)}
        />
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <AlertDialogContent className="moa-admin-dialog rounded-2xl border-[#262626]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "delete" ? "Delete this product?" : "Reset demo data?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "delete"
                ? `"${confirm.product.name}" will be removed from the admin and the storefront. This cannot be undone.`
                : "All products return to the 52 mock products. Anything you added, edited or deleted is lost."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm?.type === "delete") deleteProduct(confirm.product.id);
                else if (confirm?.type === "reset") resetProducts();
              }}
            >
              {confirm?.type === "delete" ? "Delete" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
