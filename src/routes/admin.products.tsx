import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { z } from "zod";
import { PageHead, Panel } from "@/components/moa/ui";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Product Management — MOA Mart Suite" },
      { name: "description", content: "Create, edit and archive products in the MOA Mart catalog." },
    ],
  }),
  component: Products,
});

type Spec = { label: string; value: string };
type DbVariant = {
  id: string;
  sku: string | null;
  option1: string | null;
  option2: string | null;
  price: number | null;
  stock: number;
  image: string | null;
  swatch: string | null;
  position: number;
};
type Row = {
  id: string;
  name: string;
  category_id: string;
  price: number;
  old_price: number | null;
  sku: string;
  stock: number;
  images: string[];
  blurb: string;
  description: string;
  tags: string[];
  archived_at: string | null;
  option1_name: string | null;
  option2_name: string | null;
  specs: Spec[] | null;
  care: string | null;
  category: { name: string } | null;
  product_variants: DbVariant[];
};
type Cat = { id: string; name: string };

/** One size/color combination in the form. Stock is editable only for new combinations. */
type Variant = {
  id?: string;
  option1: string;
  option2: string;
  sku: string;
  price: string;
  stock: string;
  image: string;
  swatch: string;
};

const msgOf = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : "Something went wrong. Please try again.";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const isHttp = (u: string) => /^https?:\/\//i.test(u.trim());
const isColorName = (n: string) => /^colou?rs?$/i.test(n.trim());

const COLOR_GUESS: Record<string, string> = {
  black: "#111111",
  white: "#f5f5f5",
  red: "#dc2626",
  blue: "#2563eb",
  green: "#16a34a",
  yellow: "#eab308",
  orange: "#ea580c",
  pink: "#ec4899",
  purple: "#9333ea",
  gray: "#6b7280",
  grey: "#6b7280",
  brown: "#92400e",
  beige: "#d6c3a3",
  navy: "#1e3a8a",
  cream: "#f3ead3",
  gold: "#ca8a04",
  silver: "#c0c0c0",
};
const guessColor = (name: string) => COLOR_GUESS[name.trim().toLowerCase()] ?? "#888888";

function combos(v1: string[], v2: string[]): [string, string][] {
  const out: [string, string][] = [];
  if (v1.length === 0) return out;
  if (v2.length === 0) {
    for (const a of v1) out.push([a, ""]);
    return out;
  }
  for (const a of v1) for (const b of v2) out.push([a, b]);
  return out;
}

const uniq = (list: (string | null)[]) => {
  const out: string[] = [];
  for (const v of list) if (v && !out.includes(v)) out.push(v);
  return out;
};

const schema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name is too long (80 max)"),
    categoryId: z.string().min(1, "Pick a category"),
    price: z
      .number({ required_error: "Price is required", invalid_type_error: "Enter a valid price" })
      .int("Use whole RWF, no decimals")
      .positive("Price must be greater than 0")
      .max(100000000, "Price is too high"),
    oldPrice: z
      .number({ invalid_type_error: "Enter a valid price" })
      .int("Use whole RWF, no decimals")
      .positive("Must be greater than 0")
      .optional(),
    cost: z
      .number({ required_error: "Cost is required", invalid_type_error: "Enter a valid cost" })
      .int("Use whole RWF, no decimals")
      .min(0, "Cost cannot be negative")
      .max(100000000, "Cost is too high"),
    stock: z
      .number({ required_error: "Stock is required", invalid_type_error: "Enter a valid number" })
      .int("Stock must be a whole number")
      .min(0, "Stock cannot be negative")
      .max(100000, "Stock is too high"),
    images: z.array(z.string()).min(1, "Add at least one photo").max(6, "Up to 6 photos"),
    blurb: z.string().trim().max(160, "Keep the short description under 160 characters"),
    description: z.string().trim().max(1000, "Description is too long (1000 max)"),
    care: z.string().trim().max(600, "Keep care and handling under 600 characters"),
    tags: z.array(z.string().max(30, "Each tag must be under 30 characters")).max(8, "Up to 8 tags"),
  })
  .refine((d) => d.oldPrice === undefined || d.oldPrice > d.price, {
    path: ["oldPrice"],
    message: "Old price must be higher than the price",
  });

type Form = {
  name: string;
  categoryId: string;
  price: string;
  oldPrice: string;
  cost: string;
  stock: string;
  images: string[];
  blurb: string;
  description: string;
  care: string;
  tags: string;
};
type Errors = Partial<Record<keyof Form | "options" | "specs", string | undefined>>;

const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/[,\s]/g, "")));

const toForm = (cats: Cat[], p?: Row, cost?: number): Form => ({
  name: p?.name ?? "",
  categoryId: p?.category_id ?? cats[0]?.id ?? "",
  price: p ? String(p.price) : "",
  oldPrice: p?.old_price ? String(p.old_price) : "",
  cost: cost !== undefined ? String(cost) : "",
  stock: p ? String(p.stock) : "0",
  images: p?.images ?? [],
  blurb: p?.blurb ?? "",
  description: p?.description ?? "",
  care: p?.care ?? "",
  tags: p?.tags.join(", ") ?? "",
});

const stockState = (n: number) =>
  n <= 0
    ? { label: "Out of Stock", cls: "text-destructive" }
    : n <= 5
      ? { label: "Low Stock", cls: "text-warning" }
      : { label: "In Stock", cls: "text-success" };

const fieldClass =
  "w-full rounded-xl border border-[#262626] bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50";
// Same look without a width, for inputs that set their own width.
const inputBase =
  "rounded-xl border border-[#262626] bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50";

function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </label>
  );
}

function ChipsInput({
  values,
  onChange,
  placeholder,
  max = 12,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().slice(0, 30))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length < max && !next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#262626] bg-background p-2">
      {values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="text-muted-foreground hover:text-destructive"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={values.length > 0 ? "" : placeholder}
        className="min-w-[7rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
      />
    </div>
  );
}

async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

function ProductDialog({
  product,
  cats,
  rows,
  costs,
  onClose,
  onSaved,
}: {
  product?: Row | undefined;
  cats: Cat[];
  rows: Row[];
  costs: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const existing = [...(product?.product_variants ?? [])].sort((a, b) => a.position - b.position);

  const [form, setForm] = useState<Form>(() => toForm(cats, product, product ? costs[product.id] : undefined));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const [specs, setSpecs] = useState<Spec[]>(() =>
    (product?.specs ?? []).filter((s) => !/^(sku|category)$/i.test(s.label.trim())),
  );

  const [hasOptions, setHasOptions] = useState(existing.length > 0);
  const [opt1Name, setOpt1Name] = useState(product?.option1_name ?? "Size");
  const [opt2Name, setOpt2Name] = useState(product?.option2_name ?? "Color");
  const [opt1Values, setOpt1Values] = useState<string[]>(() => uniq(existing.map((v) => v.option1)));
  const [opt2Values, setOpt2Values] = useState<string[]>(() => uniq(existing.map((v) => v.option2)));
  const [swatches, setSwatches] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const v of existing) {
      if (!v.swatch) continue;
      if (isColorName(product?.option1_name ?? "") && v.option1) m[v.option1] = v.swatch;
      if (isColorName(product?.option2_name ?? "") && v.option2) m[v.option2] = v.swatch;
    }
    return m;
  });
  const [variants, setVariants] = useState<Variant[]>(() =>
    existing.map((v) => ({
      id: v.id,
      option1: v.option1 ?? "",
      option2: v.option2 ?? "",
      sku: v.sku ?? "",
      price: v.price ? String(v.price) : "",
      stock: String(v.stock),
      image: v.image ?? "",
      swatch: v.swatch ?? "",
    })),
  );

  // Keep one row per combination, and keep what was typed for combinations that stay.
  useEffect(() => {
    if (!hasOptions) return;
    setVariants((prev) =>
      combos(opt1Values, opt2Values).map(
        ([a, b]) =>
          prev.find((v) => v.option1 === a && v.option2 === b) ?? {
            option1: a,
            option2: b,
            sku: "",
            price: "",
            stock: "0",
            image: "",
            swatch: "",
          },
      ),
    );
  }, [hasOptions, opt1Values, opt2Values]);

  const set =
    (k: keyof Form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const setVariant = (i: number, patch: Partial<Variant>) =>
    setVariants((prev) => prev.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrors((er) => ({ ...er, images: "Use a JPG, PNG or WebP photo." }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((er) => ({ ...er, images: "That photo is larger than 5 MB." }));
      return;
    }
    setUploading(true);
    try {
      const url = await uploadImage(file, slugify(form.name) || "new");
      setForm((f) => ({ ...f, images: [...f.images, url] }));
      setErrors((er) => ({ ...er, images: undefined }));
    } catch (err) {
      setErrors((er) => ({ ...er, images: msgOf(err) }));
    } finally {
      setUploading(false);
    }
  };

  const addUrl = () => {
    const u = urlInput.trim();
    if (!isHttp(u)) {
      setErrors((er) => ({ ...er, images: "Enter a link that starts with https://" }));
      return;
    }
    if (form.images.length >= 6) {
      setErrors((er) => ({ ...er, images: "Up to 6 photos" }));
      return;
    }
    setForm((f) => ({ ...f, images: [...f.images, u] }));
    setUrlInput("");
    setErrors((er) => ({ ...er, images: undefined }));
  };

  const removeImage = (i: number) => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }));

  const colorIndex = isColorName(opt1Name) ? 1 : opt2Values.length > 0 && isColorName(opt2Name) ? 2 : 0;
  const colorValues = colorIndex === 1 ? opt1Values : colorIndex === 2 ? opt2Values : [];

  const submit = async () => {
    const r = schema.safeParse({
      name: form.name,
      categoryId: form.categoryId,
      price: num(form.price),
      oldPrice: num(form.oldPrice),
      cost: num(form.cost),
      stock: hasOptions ? 0 : num(form.stock),
      images: form.images,
      blurb: form.blurb,
      description: form.description,
      care: form.care,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    const errs: Errors = {};
    if (!r.success) {
      for (const i of r.error.issues) {
        const k = i.path[0] as keyof Form;
        errs[k] ??= i.message;
      }
    }

    // Options
    if (hasOptions) {
      if (!opt1Name.trim()) errs.options = "Name the first option, for example Size.";
      else if (opt1Values.length === 0) errs.options = "Add at least one value, for example S, M, L.";
      else if (opt2Values.length > 0 && !opt2Name.trim()) errs.options = "Name the second option, for example Color.";
      else if (opt2Name.trim() && opt2Name.trim().toLowerCase() === opt1Name.trim().toLowerCase())
        errs.options = "The two options need different names.";
      else if (variants.length > 60) errs.options = "That is more than 60 combinations. Remove some values.";
      else {
        const skus = new Set<string>();
        for (const v of variants) {
          const label = [v.option1, v.option2].filter(Boolean).join(" / ");
          if (v.price.trim() !== "" && !(Number.isInteger(Number(v.price)) && Number(v.price) > 0)) {
            errs.options = `${label}: the price must be whole RWF above 0, or empty to use the product price.`;
            break;
          }
          if (!v.id && !(Number.isInteger(Number(v.stock)) && Number(v.stock) >= 0 && v.stock.trim() !== "")) {
            errs.options = `${label}: stock must be a whole number, 0 or more.`;
            break;
          }
          const sku = v.sku.trim().toUpperCase();
          if (sku) {
            if (skus.has(sku)) {
              errs.options = `${label}: the SKU ${sku} is used twice.`;
              break;
            }
            skus.add(sku);
          }
        }
      }
    }

    // Specifications
    const cleanSpecs = specs
      .map((s) => ({ label: s.label.trim().slice(0, 40), value: s.value.trim().slice(0, 200) }))
      .filter((s) => s.label && s.value)
      .filter((s) => !/^(sku|category)$/i.test(s.label));
    if (specs.some((s) => (s.label.trim() === "") !== (s.value.trim() === ""))) {
      errs.specs = "Each specification needs both a name and a value.";
    }
    if (cleanSpecs.length > 20) errs.specs = "Up to 20 specifications.";

    setErrors(errs);
    if (!r.success || Object.values(errs).some(Boolean)) return;
    const d = r.data;

    setSaving(true);
    setFormError("");
    try {
      let id = product?.id ?? "";
      let productSku = product?.sku ?? "";
      const optionFields = hasOptions
        ? {
            option1_name: opt1Name.trim(),
            option2_name: opt2Values.length > 0 ? opt2Name.trim() : null,
          }
        : { option1_name: null, option2_name: null };

      if (product) {
        const { error } = await supabase
          .from("products")
          .update({
            name: d.name,
            category_id: d.categoryId,
            price: d.price,
            old_price: d.oldPrice ?? null,
            images: d.images,
            blurb: d.blurb,
            description: d.description,
            care: d.care,
            specs: cleanSpecs,
            tags: d.tags,
            ...optionFields,
          })
          .eq("id", product.id);
        if (error) throw error;
      } else {
        const taken = new Set(rows.map((x) => x.id));
        const base = slugify(d.name) || "product";
        id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        const nums = rows.map((x) => Number(x.sku.split("-").pop())).filter((n) => Number.isFinite(n));
        const next = (nums.length ? Math.max(...nums) : 1000) + 1;
        const catName = cats.find((c) => c.id === d.categoryId)?.name ?? "";
        const code = catName.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "XX";
        productSku = `MOA-${code}-${next}`;
        const { error } = await supabase.from("products").insert({
          id,
          name: d.name,
          category_id: d.categoryId,
          price: d.price,
          old_price: d.oldPrice ?? null,
          sku: productSku,
          stock: d.stock,
          images: d.images,
          blurb: d.blurb,
          description: d.description,
          care: d.care,
          specs: cleanSpecs,
          tags: d.tags,
          ...optionFields,
        });
        if (error) throw error;
      }

      const { error: costErr } = await supabase
        .from("product_costs")
        .upsert({ product_id: id, cost: d.cost, updated_by: user?.id ?? null, updated_at: new Date().toISOString() });
      if (costErr) throw costErr;

      // Sync the options: remove, update and add combinations.
      const oldIds = existing.map((v) => v.id);
      if (!hasOptions) {
        if (oldIds.length > 0) {
          const { error } = await supabase.from("product_variants").delete().in("id", oldIds);
          if (error) throw error;
        }
      } else {
        const keepIds = variants.filter((v) => v.id).map((v) => v.id as string);
        const dropIds = oldIds.filter((x) => !keepIds.includes(x));
        if (dropIds.length > 0) {
          const { error } = await supabase.from("product_variants").delete().in("id", dropIds);
          if (error) throw error;
        }
        const swatchFor = (v: Variant) => {
          if (colorIndex === 0) return null;
          const value = colorIndex === 1 ? v.option1 : v.option2;
          return swatches[value] ?? guessColor(value);
        };
        const skuFor = (v: Variant) =>
          v.sku.trim().toUpperCase() ||
          [productSku, slugify(v.option1).toUpperCase(), slugify(v.option2).toUpperCase()].filter(Boolean).join("-");
        const toDb = (v: Variant, i: number) => ({
          sku: skuFor(v),
          option1: v.option1 || null,
          option2: v.option2 || null,
          price: v.price.trim() === "" ? null : Number(v.price),
          image: v.image.trim() === "" ? null : v.image.trim(),
          swatch: swatchFor(v),
          position: i,
        });
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          if (!v || !v.id) continue;
          const { error } = await supabase.from("product_variants").update(toDb(v, i)).eq("id", v.id);
          if (error) throw error;
        }
        const fresh = variants
          .map((v, i) => ({ v, i }))
          .filter((x) => !x.v.id)
          .map((x) => ({ product_id: id, ...toDb(x.v, x.i), stock: Number(x.v.stock) }));
        if (fresh.length > 0) {
          const { error } = await supabase.from("product_variants").insert(fresh);
          if (error) throw error;
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setFormError(msgOf(err));
    } finally {
      setSaving(false);
    }
  };

  const section = "grid gap-3 rounded-2xl border border-[#262626] p-4";
  const sectionTitle = "font-display text-sm font-semibold text-foreground";

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="moa-admin-dialog max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            {product
              ? `Editing ${product.sku}. Change stock of existing items on the Live Inventory page.`
              : "The SKU and web address are generated automatically."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className={section}>
            <h3 className={sectionTitle}>Basics</h3>
            <Field label="Name" error={errors.name}>
              <input value={form.name} onChange={set("name")} className={`${fieldClass} h-10`} placeholder="Linen shirt" />
            </Field>
            <Field label="Category" error={errors.categoryId}>
              <select value={form.categoryId} onChange={set("categoryId")} className={`${fieldClass} h-10`}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id} className="bg-card">
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Price (RWF)" error={errors.price}>
                <input value={form.price} onChange={set("price")} inputMode="numeric" className={`${fieldClass} h-10`} />
              </Field>
              <Field label="Old price (RWF, optional)" error={errors.oldPrice}>
                <input value={form.oldPrice} onChange={set("oldPrice")} inputMode="numeric" className={`${fieldClass} h-10`} />
              </Field>
              <Field label="Cost per unit (RWF)" error={errors.cost}>
                <input value={form.cost} onChange={set("cost")} inputMode="numeric" className={`${fieldClass} h-10`} />
              </Field>
            </div>
            <p className="-mt-1 text-[11px] text-muted-foreground">The cost is only visible to admins and is used for finance.</p>
            {!product && !hasOptions && (
              <Field label="Starting stock" error={errors.stock}>
                <input value={form.stock} onChange={set("stock")} inputMode="numeric" className={`${fieldClass} h-10`} />
              </Field>
            )}
          </div>

          <div className={section}>
            <h3 className={sectionTitle}>Photos</h3>
            <p className="-mt-2 text-[11px] text-muted-foreground">The first photo is the main one.</p>
            <div className="flex flex-wrap gap-2">
              {form.images.map((u, i) => (
                <div key={`${i}-${u}`} className="relative">
                  <img src={u} alt="" className="size-16 rounded-lg object-cover" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => removeImage(i)}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-[11px] text-white"
                  >
                    ×
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-0 left-0 rounded-tr-md bg-primary px-1 text-[9px] text-primary-foreground">
                      Main
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="hairline cursor-pointer rounded-xl px-3 py-2 text-xs text-foreground hover:text-primary">
                {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading || form.images.length >= 6}
                  onChange={(e) => void onFile(e)}
                />
              </label>
              <span className="text-[11px] text-muted-foreground">JPG, PNG or WebP, up to 5 MB, max 6 photos</span>
            </div>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Or paste a photo link (https://...)"
                className={`${fieldClass} h-9 text-xs`}
              />
              <button type="button" onClick={addUrl} className="hairline h-9 shrink-0 rounded-xl px-3 text-xs text-foreground">
                Add
              </button>
            </div>
            {errors.images && <span className="text-[11px] text-red-400">{errors.images}</span>}
          </div>

          <div className={section}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={sectionTitle}>Options (sizes, colors…)</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Turn this on when customers must choose, for example a size or a color. Each combination gets its own
                  stock, and optionally its own price and photo.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hasOptions}
                onClick={() => setHasOptions((v) => !v)}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                  hasOptions ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-background transition-all",
                    hasOptions ? "left-[22px]" : "left-0.5",
                  )}
                />
              </button>
            </div>

            {hasOptions && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Field label="Option 1 name">
                      <input
                        value={opt1Name}
                        onChange={(e) => setOpt1Name(e.target.value.slice(0, 30))}
                        placeholder="Size"
                        className={`${fieldClass} h-10`}
                      />
                    </Field>
                    <ChipsInput values={opt1Values} onChange={setOpt1Values} placeholder="Type a value and press Enter: S, M, L" />
                  </div>
                  <div className="grid gap-2">
                    <Field label="Option 2 name (optional)">
                      <input
                        value={opt2Name}
                        onChange={(e) => setOpt2Name(e.target.value.slice(0, 30))}
                        placeholder="Color"
                        className={`${fieldClass} h-10`}
                      />
                    </Field>
                    <ChipsInput
                      values={opt2Values}
                      onChange={setOpt2Values}
                      placeholder="Type a value and press Enter: Black, White"
                    />
                  </div>
                </div>

                {colorValues.length > 0 && (
                  <div className="grid gap-2">
                    <span className="text-xs text-muted-foreground">Swatch colors</span>
                    <div className="flex flex-wrap gap-3">
                      {colorValues.map((c) => (
                        <label key={c} className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="color"
                            value={swatches[c] ?? guessColor(c)}
                            onChange={(e) => setSwatches((s) => ({ ...s, [c]: e.target.value }))}
                            className="size-8 cursor-pointer rounded-full border border-[#262626] bg-transparent p-0"
                          />
                          {c}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {variants.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-[#262626]">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="p-3">{[opt1Name.trim() || "Option 1", opt2Values.length > 0 ? opt2Name.trim() || "Option 2" : ""].filter(Boolean).join(" / ")}</th>
                          <th className="p-3">SKU</th>
                          <th className="p-3">Stock</th>
                          <th className="p-3">Price (optional)</th>
                          <th className="p-3">Photo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v, i) => (
                          <tr key={`${v.option1}|${v.option2}`} className="border-b border-[#262626]/60">
                            <td className="p-3 text-foreground">{[v.option1, v.option2].filter(Boolean).join(" / ")}</td>
                            <td className="p-3">
                              <input
                                value={v.sku}
                                onChange={(e) => setVariant(i, { sku: e.target.value })}
                                placeholder="auto"
                                className={`${inputBase} h-9 w-36 text-xs`}
                              />
                            </td>
                            <td className="p-3">
                              {v.id ? (
                                <span className="text-muted-foreground">{v.stock} (Live Inventory)</span>
                              ) : (
                                <input
                                  value={v.stock}
                                  onChange={(e) => setVariant(i, { stock: e.target.value })}
                                  inputMode="numeric"
                                  className={`${inputBase} h-9 w-20 text-xs`}
                                />
                              )}
                            </td>
                            <td className="p-3">
                              <input
                                value={v.price}
                                onChange={(e) => setVariant(i, { price: e.target.value })}
                                inputMode="numeric"
                                placeholder={form.price || "same"}
                                className={`${inputBase} h-9 w-28 text-xs`}
                              />
                            </td>
                            <td className="p-3">
                              <select
                                value={v.image}
                                onChange={(e) => setVariant(i, { image: e.target.value })}
                                className={`${inputBase} h-9 w-32 text-xs`}
                              >
                                <option value="" className="bg-card">
                                  Product photos
                                </option>
                                {form.images.map((u, n) => (
                                  <option key={u} value={u} className="bg-card">
                                    Photo {n + 1}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {errors.options && <span className="text-[11px] text-red-400">{errors.options}</span>}
              </>
            )}
          </div>

          <div className={section}>
            <h3 className={sectionTitle}>Description</h3>
            <Field label="Short description (optional)" error={errors.blurb}>
              <input value={form.blurb} onChange={set("blurb")} className={`${fieldClass} h-10`} />
            </Field>
            <Field label="Description (optional)" error={errors.description}>
              <textarea value={form.description} onChange={set("description")} rows={3} className={`${fieldClass} py-2`} />
            </Field>
            <Field label="Tags (comma separated, optional)" error={errors.tags}>
              <input value={form.tags} onChange={set("tags")} className={`${fieldClass} h-10`} placeholder="summer, cotton" />
            </Field>
          </div>

          <div className={section}>
            <h3 className={sectionTitle}>Specifications</h3>
            <p className="-mt-2 text-[11px] text-muted-foreground">
              Facts customers compare, such as Material, Weight or Size. SKU and Category are added automatically.
            </p>
            {specs.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={s.label}
                  onChange={(e) => setSpecs((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder="Name (Material)"
                  className={`${inputBase} h-9 w-32 shrink-0 text-xs sm:w-44`}
                />
                <input
                  value={s.value}
                  onChange={(e) => setSpecs((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="Value (100% cotton)"
                  className={`${inputBase} h-9 min-w-0 flex-1 text-xs`}
                />
                <button
                  type="button"
                  aria-label="Remove specification"
                  onClick={() => setSpecs((prev) => prev.filter((_, j) => j !== i))}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-destructive"
                >
                  <i className="bx bx-trash text-lg" />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={specs.length >= 20}
              onClick={() => setSpecs((prev) => [...prev, { label: "", value: "" }])}
              className="hairline h-9 w-fit rounded-xl px-3 text-xs text-foreground disabled:opacity-50"
            >
              + Add specification
            </button>
            {errors.specs && <span className="text-[11px] text-red-400">{errors.specs}</span>}
          </div>

          <div className={section}>
            <h3 className={sectionTitle}>Care &amp; handling</h3>
            <Field label="How to look after it (optional)" error={errors.care}>
              <textarea
                value={form.care}
                onChange={set("care")}
                rows={3}
                placeholder="Machine wash cold. Do not bleach. Dry in the shade."
                className={`${fieldClass} py-2`}
              />
            </Field>
          </div>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

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
            disabled={saving || uploading}
            onClick={() => void submit()}
            className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : product ? "Save changes" : "Create product"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({
  name,
  archived,
  onEdit,
  onToggle,
}: {
  name: string;
  archived: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const btn =
    "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground";
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Edit ${name}`} onClick={onEdit} className={btn}>
        <i className="bx bx-edit text-lg" />
      </button>
      <button
        type="button"
        aria-label={`${archived ? "Restore" : "Archive"} ${name}`}
        onClick={onToggle}
        className={btn}
      >
        <i className={`bx ${archived ? "bx-archive-out" : "bx-archive"} text-lg`} />
      </button>
    </div>
  );
}

function Products() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [view, setView] = useState<"active" | "archived" | "all">("active");
  const [visible, setVisible] = useState(20);
  const [dialog, setDialog] = useState<{ product?: Row | undefined } | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c, k] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, category_id, price, old_price, sku, stock, images, blurb, description, tags, archived_at, option1_name, option2_name, specs, care, category:categories(name), product_variants(id, sku, option1, option2, price, stock, image, swatch, position)",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("categories").select("id, name").order("sort_order"),
        supabase.from("product_costs").select("product_id, cost"),
      ]);
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      setRows((p.data ?? []) as unknown as Row[]);
      setCats((c.data ?? []) as Cat[]);
      const map: Record<string, number> = {};
      for (const r of k.data ?? []) map[r.product_id as string] = r.cost as number;
      setCosts(map);
      setError("");
    } catch {
      setError("Could not load products. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setArchived = async (p: Row, archived: boolean) => {
    setError("");
    const { error: err } = await supabase
      .from("products")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", p.id);
    if (err) {
      setError(err.message);
      return;
    }
    void load();
  };

  const filtered = rows.filter((p) => {
    const t = q.trim().toLowerCase();
    const catName = p.category?.name ?? "";
    return (
      (view === "all" || (view === "archived") === Boolean(p.archived_at)) &&
      (cat === "All" || catName === cat) &&
      (!t || `${p.name} ${p.sku} ${catName}`.toLowerCase().includes(t))
    );
  });
  const shown = filtered.slice(0, visible);

  const optionNote = (p: Row) =>
    p.product_variants.length > 0
      ? `${p.product_variants.length} option${p.product_variants.length === 1 ? "" : "s"}: ${[p.option1_name, p.option2_name].filter(Boolean).join(" / ")}`
      : "";

  return (
    <>
      <PageHead
        title="Product Management"
        subtitle="Create, edit and archive products. Changes go live on the storefront right away."
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
          {["All", ...cats.map((c) => c.name)].map((c) => (
            <option key={c} value={c} className="bg-card">
              {c}
            </option>
          ))}
        </select>
        <select
          value={view}
          onChange={(e) => {
            setView(e.target.value as "active" | "archived" | "all");
            setVisible(20);
          }}
          className="hairline h-10 rounded-xl bg-card/60 px-3 text-sm outline-none"
        >
          <option value="active" className="bg-card">
            Active
          </option>
          <option value="archived" className="bg-card">
            Archived
          </option>
          <option value="all" className="bg-card">
            All
          </option>
        </select>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setDialog({})}
            className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <i className="bx bx-plus text-lg" /> Add product
          </button>
        )}
      </div>

      {!isAdmin && <p className="mb-4 text-xs text-muted-foreground">Only admins can add, edit or archive products.</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!loading && filtered.length === 0 ? (
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
                  {isAdmin && <th className="p-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const s = stockState(p.stock);
                  return (
                    <tr key={p.id} className="border-b border-[#262626]/60 transition-colors hover:bg-secondary/30">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {p.images[0] && <img src={p.images[0]} alt={p.name} className="size-11 rounded-lg object-cover" />}
                          <div>
                            <p className="text-xs">{p.name}</p>
                            {optionNote(p) && <p className="text-[11px] text-muted-foreground">{optionNote(p)}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">{p.sku}</td>
                      <td className="p-4 text-xs text-muted-foreground">{p.category?.name ?? "—"}</td>
                      <td className="p-4 text-xs text-primary">{money(p.price)}</td>
                      <td className="p-4 text-xs">{p.stock}</td>
                      <td className={`p-4 text-[11px] ${p.archived_at ? "text-muted-foreground" : s.cls}`}>
                        {p.archived_at ? "Archived" : s.label}
                      </td>
                      {isAdmin && (
                        <td className="p-4">
                          <div className="flex justify-end">
                            <RowActions
                              name={p.name}
                              archived={Boolean(p.archived_at)}
                              onEdit={() => setDialog({ product: p })}
                              onToggle={() => (p.archived_at ? void setArchived(p, false) : setConfirm(p))}
                            />
                          </div>
                        </td>
                      )}
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
                    {p.images[0] && <img src={p.images[0]} alt={p.name} className="size-16 shrink-0 rounded-xl object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {p.sku} · {p.category?.name ?? "—"}
                      </p>
                      {optionNote(p) && <p className="text-[11px] text-muted-foreground">{optionNote(p)}</p>}
                      <p className="mt-1 text-sm text-primary">{money(p.price)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-[11px] ${p.archived_at ? "text-muted-foreground" : s.cls}`}>
                      {p.archived_at ? "Archived" : `${s.label} · ${p.stock}`}
                    </span>
                    {isAdmin && (
                      <RowActions
                        name={p.name}
                        archived={Boolean(p.archived_at)}
                        onEdit={() => setDialog({ product: p })}
                        onToggle={() => (p.archived_at ? void setArchived(p, false) : setConfirm(p))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground md:mb-20">
            <span>
              Showing {shown.length} of {filtered.length} products
            </span>
            {filtered.length > visible && (
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
          cats={cats}
          rows={rows}
          costs={costs}
          onClose={() => setDialog(null)}
          onSaved={() => void load()}
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
            <AlertDialogTitle>Archive this product?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm
                ? `"${confirm.name}" will disappear from the storefront. Past orders and stock history stay. You can restore it any time.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void setArchived(confirm, true);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
