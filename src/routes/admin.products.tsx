import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { ActionBar, btn, field, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead, Skeleton } from "@/components/moa/ui";
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
import { useAuth } from "@/lib/auth";
import { csvSafe, downloadText, toCsv, useLongPress } from "@/lib/adminTools";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { clearPersisted, usePersistedState } from "@/lib/persist";

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


// ---------- small building blocks of the form ----------

function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="grid gap-1.5" data-error={error ? "true" : undefined}>
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </label>
  );
}

/** A group of fields with a heading. Long optional groups can be folded away. */
function Section({
  title,
  hint,
  children,
  fold,
  startOpen = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  fold?: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="rounded-2xl border border-[#262626] p-4">
      {fold ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="font-display text-base font-semibold">{title}</h3>
          <i aria-hidden className={cn("bx text-2xl text-muted-foreground", open ? "bx-chevron-up" : "bx-chevron-down")} />
        </button>
      ) : (
        <h3 className="font-display text-base font-semibold">{title}</h3>
      )}
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {open && <div className="mt-4 grid gap-4">{children}</div>}
    </section>
  );
}

function ChipsInput({
  values,
  onChange,
  placeholder,
  label,
  max = 12,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  label: string;
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
        <span key={v} className="flex min-h-9 items-center gap-1 rounded-full bg-secondary pl-3 pr-1 text-sm text-foreground">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-destructive"
          >
            <i aria-hidden className="bx bx-x text-lg" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
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
        enterKeyHint="done"
        placeholder={values.length > 0 ? "" : placeholder}
        className="h-10 min-w-[8rem] flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground"
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

function ProductEditor({
  open,
  product,
  seed,
  cats,
  rows,
  costs,
  onClose,
  onSaved,
}: {
  open: boolean;
  product?: Row | undefined;
  /** A product to copy when adding a new one (Duplicate). */
  seed?: Row | undefined;
  cats: Cat[];
  rows: Row[];
  costs: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const existing = [...(product?.product_variants ?? [])].sort((a, b) => a.position - b.position);
  // The starting point of the form: the product being edited, or the product being copied.
  const base = product ?? seed;
  const baseVariants = [...(base?.product_variants ?? [])].sort((a, b) => a.position - b.position);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = usePersistedState<Form>(`moa:pe:${product?.id ?? "new"}:form`, () => {
    const f = toForm(cats, base, base ? costs[base.id] : undefined);
    return seed && !product ? { ...f, name: `Copy of ${seed.name}`.slice(0, 80) } : f;
  }, { sync: true });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const [specs, setSpecs] = usePersistedState<Spec[]>(`moa:pe:${product?.id ?? "new"}:specs`, () =>
    (base?.specs ?? []).filter((s) => !/^(sku|category)$/i.test(s.label.trim())), { sync: true });

  const [hasOptions, setHasOptions] = usePersistedState(`moa:pe:${product?.id ?? "new"}:hasOptions`, baseVariants.length > 0, { sync: true });
  const [opt1Name, setOpt1Name] = usePersistedState(`moa:pe:${product?.id ?? "new"}:opt1Name`, base?.option1_name ?? "Size", { sync: true });
  const [opt2Name, setOpt2Name] = usePersistedState(`moa:pe:${product?.id ?? "new"}:opt2Name`, base?.option2_name ?? "Color", { sync: true });
  const [opt1Values, setOpt1Values] = usePersistedState<string[]>(`moa:pe:${product?.id ?? "new"}:opt1Values`, () => uniq(baseVariants.map((v) => v.option1)), { sync: true });
  const [opt2Values, setOpt2Values] = usePersistedState<string[]>(`moa:pe:${product?.id ?? "new"}:opt2Values`, () => uniq(baseVariants.map((v) => v.option2)), { sync: true });
  const [swatches, setSwatches] = usePersistedState<Record<string, string>>(`moa:pe:${product?.id ?? "new"}:swatches`, () => {
    const m: Record<string, string> = {};
    for (const v of baseVariants) {
      if (!v.swatch) continue;
      if (isColorName(base?.option1_name ?? "") && v.option1) m[v.option1] = v.swatch;
      if (isColorName(base?.option2_name ?? "") && v.option2) m[v.option2] = v.swatch;
    }
    return m;
  }, { sync: true });
  const [variants, setVariants] = usePersistedState<Variant[]>(`moa:pe:${product?.id ?? "new"}:variants`, () =>
    baseVariants.map((v) => ({
      // A copy gets new combinations: no id, no SKU and no stock carried over.
      ...(product ? { id: v.id } : {}),
      option1: v.option1 ?? "",
      option2: v.option2 ?? "",
      sku: product ? (v.sku ?? "") : "",
      price: v.price ? String(v.price) : "",
      stock: product ? String(v.stock) : "0",
      image: v.image ?? "",
      swatch: v.swatch ?? "",
    })), { sync: true });

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
  const makeMain = (i: number) =>
    setForm((f) => {
      const img = f.images[i];
      return img ? { ...f, images: [img, ...f.images.filter((_, j) => j !== i)] } : f;
    });

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
    if (!r.success || Object.values(errs).some(Boolean)) {
      setFormError("Please fix the fields marked in red.");
      setTimeout(() => document.querySelector('[data-error="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      return;
    }
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

  const title = product ? "Edit product" : seed ? "Duplicate product" : "Add product";
  const subtitle = product
    ? `Editing ${product.sku}. Change the stock of existing items on the Inventory page.`
    : seed
      ? `A copy of ${seed.name}. Change what is different, then save.`
      : "The SKU and web address are generated automatically.";

  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      wide
      fullOnPhone
      footer={
        <div className="grid gap-2">
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={saving || uploading} onClick={() => void submit()} className={btn.primary}>
              {saving ? "Saving…" : uploading ? "Uploading photo…" : product ? "Save changes" : "Create product"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4">
        <Section title="Basics">
          <Field label="Name" error={errors.name}>
            <input value={form.name} onChange={set("name")} className={field} placeholder="Linen shirt" autoComplete="off" enterKeyHint="next" />
          </Field>
          <Field label="Category" error={errors.categoryId}>
            <select value={form.categoryId} onChange={set("categoryId")} className={field}>
              {cats.map((c) => (
                <option key={c.id} value={c.id} className="bg-card">
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Price and stock">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Price (RWF)" error={errors.price}>
              <input value={form.price} onChange={set("price")} inputMode="numeric" className={field} />
            </Field>
            <Field label="Old price (RWF, optional)" error={errors.oldPrice}>
              <input value={form.oldPrice} onChange={set("oldPrice")} inputMode="numeric" className={field} />
            </Field>
            <Field label="Cost per unit (RWF)" error={errors.cost}>
              <input value={form.cost} onChange={set("cost")} inputMode="numeric" className={field} />
            </Field>
          </div>
          <p className="-mt-1 text-sm text-muted-foreground">The cost is only visible to admins and is used for finance.</p>
          {!product && !hasOptions && (
            <Field label="Starting stock" error={errors.stock}>
              <input value={form.stock} onChange={set("stock")} inputMode="numeric" className={field} />
            </Field>
          )}
        </Section>

        <Section title="Photos" hint="The first photo is the main one. JPG, PNG or WebP, up to 5 MB each, 6 at most.">
          {form.images.length > 0 && (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-label="Photos">
              {form.images.map((u, i) => (
                <li key={`${i}-${u}`} className="grid gap-1.5">
                  <div className="relative">
                    <img src={u} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-xl object-cover" />
                    {i === 0 && (
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                        Main
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {i !== 0 && (
                      <button type="button" onClick={() => makeMain(i)} aria-label={`Make photo ${i + 1} the main photo`} className={cn(btn.quiet, "h-10 flex-1 px-2 text-xs")}>
                        Make main
                      </button>
                    )}
                    <button type="button" onClick={() => removeImage(i)} aria-label={`Remove photo ${i + 1}`} className={cn(btn.dangerQuiet, "h-10 flex-1 px-2 text-xs")}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={uploading || form.images.length >= 6} onClick={() => fileRef.current?.click()} className={btn.ghost}>
              <i aria-hidden className="bx bx-image-add text-lg" /> {uploading ? "Uploading…" : "Choose photo"}
            </button>
            <button type="button" disabled={uploading || form.images.length >= 6} onClick={() => camRef.current?.click()} className={cn(btn.ghost, "md:hidden")}>
              <i aria-hidden className="bx bx-camera text-lg" /> Take photo
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Photo file" onChange={(e) => void onFile(e)} />
          <input ref={camRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} aria-label="Camera photo" onChange={(e) => void onFile(e)} />
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              inputMode="url"
              autoCapitalize="none"
              aria-label="Photo link"
              placeholder="Or paste a photo link (https://…)"
              className={field}
            />
            <button type="button" onClick={addUrl} className={btn.ghost}>
              Add
            </button>
          </div>
          {errors.images && (
            <p data-error="true" className="text-sm text-destructive">
              {errors.images}
            </p>
          )}
        </Section>

        <Section
          title="Options (sizes, colors…)"
          hint="Turn this on when customers must choose, for example a size or a color. Each combination gets its own stock, and optionally its own price and photo."
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-base">This product has options</span>
            <button
              type="button"
              role="switch"
              aria-checked={hasOptions}
              aria-label="This product has options"
              onClick={() => setHasOptions((v) => !v)}
              className={cn(
                "relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                hasOptions ? "bg-primary" : "bg-muted",
              )}
            >
              <span className={cn("absolute top-1 size-6 rounded-full bg-background transition-all", hasOptions ? "left-[30px]" : "left-1")} />
            </button>
          </div>

          {hasOptions && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Field label="Option 1 name">
                    <input value={opt1Name} onChange={(e) => setOpt1Name(e.target.value.slice(0, 30))} placeholder="Size" className={field} />
                  </Field>
                  <ChipsInput label="Option 1 values" values={opt1Values} onChange={setOpt1Values} placeholder="Type a value and press Enter: S, M, L" />
                </div>
                <div className="grid gap-2">
                  <Field label="Option 2 name (optional)">
                    <input value={opt2Name} onChange={(e) => setOpt2Name(e.target.value.slice(0, 30))} placeholder="Color" className={field} />
                  </Field>
                  <ChipsInput label="Option 2 values" values={opt2Values} onChange={setOpt2Values} placeholder="Type a value and press Enter: Black, White" />
                </div>
              </div>

              {colorValues.length > 0 && (
                <div className="grid gap-2">
                  <span className="text-sm text-muted-foreground">Swatch colors</span>
                  <div className="flex flex-wrap gap-4">
                    {colorValues.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="color"
                          aria-label={`Swatch color for ${c}`}
                          value={swatches[c] ?? guessColor(c)}
                          onChange={(e) => setSwatches((s) => ({ ...s, [c]: e.target.value }))}
                          className="size-11 cursor-pointer rounded-full border border-[#262626] bg-transparent p-0"
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {variants.length > 0 && (
                <ul className="grid gap-3 md:grid-cols-2" aria-label="Combinations">
                  {variants.map((v, i) => {
                    const label = [v.option1, v.option2].filter(Boolean).join(" / ");
                    return (
                      <li key={`${v.option1}|${v.option2}`} className="rounded-2xl border border-[#262626] p-4">
                        <p className="text-base font-medium">{label}</p>
                        <div className="mt-3 grid gap-3">
                          <Field label="SKU">
                            <input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} placeholder="auto" autoCapitalize="characters" className={field} />
                          </Field>
                          {v.id ? (
                            <div>
                              <p className="text-sm text-muted-foreground">Stock</p>
                              <p className="text-base">{v.stock} in stock</p>
                              <p className="text-sm text-muted-foreground">Change it on the Inventory page.</p>
                            </div>
                          ) : (
                            <Field label="Stock">
                              <input value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value })} inputMode="numeric" className={field} />
                            </Field>
                          )}
                          <Field label="Price (optional)">
                            <input value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} inputMode="numeric" placeholder={form.price || "same as the product"} className={field} />
                          </Field>
                          <Field label="Photo">
                            <select value={v.image} onChange={(e) => setVariant(i, { image: e.target.value })} className={field}>
                              <option value="" className="bg-card">
                                Product photos
                              </option>
                              {form.images.map((u, n) => (
                                <option key={u} value={u} className="bg-card">
                                  Photo {n + 1}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {errors.options && (
                <p data-error="true" className="text-sm text-destructive">
                  {errors.options}
                </p>
              )}
            </>
          )}
        </Section>

        <Section title="Description">
          <Field label="Short description (optional)" error={errors.blurb}>
            <input value={form.blurb} onChange={set("blurb")} className={field} />
          </Field>
          <Field label="Description (optional)" error={errors.description}>
            <textarea value={form.description} onChange={set("description")} rows={4} className={cn(field, "h-auto py-2.5")} />
          </Field>
          <Field label="Tags (comma separated, optional)" error={errors.tags}>
            <input value={form.tags} onChange={set("tags")} className={field} placeholder="summer, cotton" />
          </Field>
        </Section>

        <Section
          title="Specifications"
          hint="Facts customers compare, such as Material, Weight or Size. SKU and Category are added automatically."
          fold
          startOpen={specs.length > 0}
        >
          {specs.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <input
                aria-label={`Specification ${i + 1} name`}
                value={s.label}
                onChange={(e) => setSpecs((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Name (Material)"
                className={field}
              />
              <input
                aria-label={`Specification ${i + 1} value`}
                value={s.value}
                onChange={(e) => setSpecs((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="Value (100% cotton)"
                className={field}
              />
              <button
                type="button"
                aria-label={`Remove specification ${i + 1}`}
                onClick={() => setSpecs((prev) => prev.filter((_, j) => j !== i))}
                className="grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-destructive"
              >
                <i aria-hidden className="bx bx-trash text-xl" />
              </button>
            </div>
          ))}
          <button type="button" disabled={specs.length >= 20} onClick={() => setSpecs((prev) => [...prev, { label: "", value: "" }])} className={cn(btn.ghost, "w-fit")}>
            <i aria-hidden className="bx bx-plus text-lg" /> Add specification
          </button>
          {errors.specs && (
            <p data-error="true" className="text-sm text-destructive">
              {errors.specs}
            </p>
          )}
        </Section>

        <Section title="Care and handling" fold startOpen={form.care.trim() !== ""}>
          <Field label="How to look after it (optional)" error={errors.care}>
            <textarea
              value={form.care}
              onChange={set("care")}
              rows={3}
              placeholder="Machine wash cold. Do not bleach. Dry in the shade."
              className={cn(field, "h-auto py-2.5")}
            />
          </Field>
        </Section>
      </div>
    </AdminSheet>
  );
}

type View = "active" | "archived" | "all";
type EditorState = { product?: Row | undefined; seed?: Row | undefined };
type ConfirmState = { ids: string[]; label: string } | null;

function stockPill(p: Row): { label: string; cls: string } {
  if (p.archived_at) return { label: "Archived", cls: "bg-muted text-muted-foreground" };
  if (p.stock <= 0) return { label: "Out of stock", cls: "bg-destructive/10 text-destructive" };
  if (p.stock <= 5) return { label: `Low: ${p.stock} left`, cls: "bg-warning/10 text-warning" };
  return { label: `In stock: ${p.stock}`, cls: "bg-success/10 text-success" };
}

const optionNote = (p: Row) =>
  p.product_variants.length > 0
    ? `${p.product_variants.length} option${p.product_variants.length === 1 ? "" : "s"}: ${[p.option1_name, p.option2_name].filter(Boolean).join(" / ")}`
    : "";

function Thumb({ p, size }: { p: Row; size: string }) {
  return p.images[0] ? (
    <img src={p.images[0]} alt="" className={cn("shrink-0 rounded-xl object-cover", size)} />
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground", size)}>
      <i aria-hidden className="bx bx-package text-xl" />
    </span>
  );
}

function Products() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [q, setQ] = usePersistedState("moa:products:q", "");
  const [cat, setCat] = usePersistedState("moa:products:cat", "All");
  const [view, setView] = usePersistedState<View>("moa:products:view", "active");
  const [visible, setVisible] = usePersistedState("moa:products:visible", 20);
  const [editor, setEditor] = usePersistedState<EditorState | null>("moa:products:dialog", null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const press = useLongPress((id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  });

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
      setLoadError("");
    } catch {
      setLoadError("Could not load products. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The editor slides in a moment after it is mounted, and out before it is removed.
  useEffect(() => {
    if (!editor) {
      setEditorOpen(false);
      return;
    }
    const t = setTimeout(() => setEditorOpen(true), 20);
    return () => clearTimeout(t);
  }, [editor]);

  const openEditor = (e: EditorState) => {
    // Starting something new or a copy: forget any unsaved draft of a previous "new" product.
    clearPersisted(`moa:pe:${e.product?.id ?? "new"}:`);
    setEditor(e);
  };
  const closeEditor = () => {
    const key = editor?.product?.id ?? "new";
    setEditorOpen(false);
    setTimeout(() => {
      clearPersisted(`moa:pe:${key}:`);
      setEditor(null);
    }, 320);
  };

  const setArchived = async (ids: string[], archived: boolean) => {
    const { error } = await supabase
      .from("products")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .in("id", ids);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(
      ids.length === 1 ? (archived ? "Product archived." : "Product restored.") : `${ids.length} products ${archived ? "archived" : "restored"}.`,
    );
    void load();
    return true;
  };

  const bulk = async (archived: boolean) => {
    const ids = [...selected].filter((id) => Boolean(rows.find((r) => r.id === id)?.archived_at) !== archived);
    if (ids.length === 0) return;
    if (archived) {
      setConfirm({ ids, label: `${ids.length} product${ids.length === 1 ? "" : "s"}` });
      return;
    }
    setBulkBusy(true);
    const ok = await setArchived(ids, false);
    setBulkBusy(false);
    if (ok) {
      setSelected(new Set());
      setSelectMode(false);
    }
  };

  // ----- what is shown -----

  const inView = (p: Row, v: View) => v === "all" || (v === "archived") === Boolean(p.archived_at);
  const counts = {
    active: rows.filter((p) => !p.archived_at).length,
    archived: rows.filter((p) => p.archived_at).length,
    all: rows.length,
  };
  const t = q.trim().toLowerCase();
  const filtered = rows.filter((p) => {
    const catName = p.category?.name ?? "";
    return inView(p, view) && (cat === "All" || catName === cat) && (!t || `${p.name} ${p.sku} ${catName}`.toLowerCase().includes(t));
  });
  const shown = filtered.slice(0, visible);

  const moveSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0 || !moveTo) return;
    setBulkBusy(true);
    const { error } = await supabase.from("products").update({ category_id: moveTo }).in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${ids.length} product${ids.length === 1 ? "" : "s"} moved to ${cats.find((c) => c.id === moveTo)?.name ?? "the new category"}.`);
    setMoveOpen(false);
    setSelected(new Set());
    setSelectMode(false);
    void load();
  };

  const exportSelected = () => {
    const list = rows.filter((p) => selected.has(p.id));
    const out: Array<Array<string | number | null | undefined>> = [
      ["SKU", "Name", "Category", "Price (RWF)", "Stock", "Status"],
      ...list.map((p) => [p.sku, csvSafe(p.name), p.category?.name ?? "", p.price, p.stock, p.archived_at ? "Archived" : "Active"]),
    ];
    downloadText(`moa-products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
    toast.success(`${list.length} product${list.length === 1 ? "" : "s"} exported.`);
  };

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((p) => p.id)));
  const selectedRows = rows.filter((p) => selected.has(p.id));
  const selActive = selectedRows.filter((p) => !p.archived_at).length;
  const selArchived = selectedRows.length - selActive;

  const menuFor = (p: Row): MenuItem[] => [
    { label: "Edit", icon: "bx-edit", onSelect: () => openEditor({ product: p }) },
    { label: "Duplicate", icon: "bx-copy", onSelect: () => openEditor({ seed: p }), hint: "Start a new product from this one" },
    p.archived_at
      ? { label: "Restore", icon: "bx-archive-out", onSelect: () => void setArchived([p.id], false), hint: "Show it on the storefront again" }
      : {
          label: "Archive",
          icon: "bx-archive",
          danger: true,
          onSelect: () => setConfirm({ ids: [p.id], label: `"${p.name}"` }),
          hint: "Hide it from the storefront",
        },
  ];

  const tabs: TabItem<View>[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: "Active", count: counts.active },
    { key: "archived", label: "Archived", count: counts.archived },
  ];

  return (
    <>
      <PageHead
        title="Products"
        subtitle="Create, edit and archive products. Changes go live on the storefront right away."
        actions={
          isAdmin ? (
            <>
              <button
                type="button"
                aria-pressed={selectMode}
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelected(new Set());
                }}
                className={cn(btn.ghost, selectMode && "border-foreground/60 bg-white/10")}
              >
                <i aria-hidden className="bx bx-check-square text-lg" /> {selectMode ? "Done" : "Select"}
              </button>
              <button type="button" onClick={() => openEditor({})} className={btn.primary}>
                <i aria-hidden className="bx bx-plus text-lg" /> Add product
              </button>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchField
            value={q}
            onChange={(v) => {
              setQ(v);
              setVisible(20);
            }}
            label="Search products"
            placeholder="Search name, SKU or category"
          />
          <select
            aria-label="Category"
            value={cat}
            onChange={(e) => {
              setCat(e.target.value);
              setVisible(20);
            }}
            className={cn(field, "sm:w-52")}
          >
            {["All", ...cats.map((c) => c.name)].map((c) => (
              <option key={c} value={c} className="bg-card">
                {c === "All" ? "All categories" : c}
              </option>
            ))}
          </select>
        </div>
        <FilterTabs
          items={tabs}
          value={view}
          onChange={(v) => {
            setView(v);
            setVisible(20);
            setSelected(new Set());
          }}
          label="Show"
        />
      </div>

      {!isAdmin && <p className="mt-3 text-sm text-muted-foreground">Only admins can add, edit or archive products.</p>}

      {selectMode && isAdmin && shown.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm lg:hidden">
          <span className="text-muted-foreground">
            {selected.size} of {shown.length} selected
          </span>
          <button type="button" onClick={toggleAll} className="min-h-11 px-2 text-foreground underline-offset-4 hover:underline">
            {allShownSelected ? "Clear selection" : "Select all shown"}
          </button>
        </div>
      )}

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
                <Skeleton className="size-20 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-3 h-4 w-28" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <div className="rounded-2xl border border-[#262626] bg-card">
            {rows.length === 0 ? (
              <EmptyState
                icon="bx-package"
                title="No products yet"
                hint="Add the first product to start selling."
                action={
                  isAdmin ? (
                    <button type="button" className={btn.primary} onClick={() => openEditor({})}>
                      Add product
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                icon="bx-search"
                title="No products match"
                hint="Try a different word, category or view."
                action={
                  <button
                    type="button"
                    className={btn.ghost}
                    onClick={() => {
                      setQ("");
                      setCat("All");
                      setView("active");
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            )}
          </div>
        )}

        {shown.length > 0 && (
          <>
            <ul className="grid gap-3 md:grid-cols-2 lg:hidden" aria-label="Products">
              {shown.map((p) => {
                const s = stockPill(p);
                return (
                  <li
                    key={p.id}
                    {...press(p.id)}
                    onClick={(e) => {
                      if (selectMode && isAdmin && !(e.target as HTMLElement).closest("button, a, label, input")) toggleOne(p.id);
                    }}
                    className={cn("select-none rounded-2xl border bg-card p-4 [-webkit-touch-callout:none]", selected.has(p.id) ? "border-foreground/60" : "border-[#262626]")}
                  >
                    <div className="flex items-start gap-3">
                      {selectMode && isAdmin && (
                        <label className="grid min-h-11 min-w-8 place-items-center">
                          <input type="checkbox" className="size-5" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
                        </label>
                      )}
                      <Thumb p={p} size="size-20" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">{p.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {p.sku} · {p.category?.name ?? "—"}
                        </p>
                        {optionNote(p) && <p className="truncate text-sm text-muted-foreground">{optionNote(p)}</p>}
                        <p className="mt-1 font-display text-base font-semibold">{money(p.price)}</p>
                      </div>
                      {isAdmin && <ActionMenu label={`Actions for ${p.name}`} items={menuFor(p)} />}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", s.cls)}>{s.label}</span>
                      {isAdmin && (
                        <button type="button" onClick={() => openEditor({ product: p })} className={btn.ghost}>
                          Edit
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-hidden rounded-2xl border border-[#262626] bg-card lg:block">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  {isAdmin && <col className="w-12" />}
                  <col />
                  <col className="w-36" />
                  <col className="w-32" />
                  <col className="w-32" />
                  <col className="w-40" />
                  {isAdmin && <col className="w-16" />}
                </colgroup>
                <thead className="border-b border-[#262626] text-xs font-medium text-muted-foreground">
                  <tr>
                    {isAdmin && (
                      <th className="py-3 pl-4">
                        <input type="checkbox" className="size-4" aria-label="Select all shown products" checked={allShownSelected} onChange={toggleAll} />
                      </th>
                    )}
                    <th className="px-3 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 font-medium">SKU</th>
                    <th className="px-3 py-3 font-medium">Category</th>
                    <th className="px-3 py-3 font-medium">Price</th>
                    <th className="px-3 py-3 font-medium">Stock</th>
                    {isAdmin && (
                      <th className="px-3 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const s = stockPill(p);
                    return (
                      <tr key={p.id} className="border-b border-[#262626]/70 align-middle last:border-0 hover:bg-white/[0.03]">
                        {isAdmin && (
                          <td className="py-3 pl-4">
                            <input type="checkbox" className="size-4" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
                          </td>
                        )}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <Thumb p={p} size="size-12" />
                            <div className="min-w-0">
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => openEditor({ product: p })}
                                  className="block max-w-full truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {p.name}
                                </button>
                              ) : (
                                <p className="truncate">{p.name}</p>
                              )}
                              {optionNote(p) && <p className="truncate text-xs text-muted-foreground">{optionNote(p)}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-3 py-3 text-muted-foreground">{p.sku}</td>
                        <td className="truncate px-3 py-3 text-muted-foreground">{p.category?.name ?? "—"}</td>
                        <td className="px-3 py-3 font-medium">{money(p.price)}</td>
                        <td className="px-3 py-3">
                          <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", s.cls)}>{s.label}</span>
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-1 text-right">
                            <ActionMenu label={`Actions for ${p.name}`} items={menuFor(p)} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {shown.length} of {filtered.length} products
              </p>
              {filtered.length > visible && (
                <button type="button" onClick={() => setVisible(visible + 20)} className={btn.ghost}>
                  Show more
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ActionBar show={selected.size > 0 && isAdmin}>
        <span className="mr-auto px-1 text-sm">{selected.size} selected</span>
        <button type="button" onClick={() => setSelected(new Set())} className={btn.quiet}>
          Clear
        </button>
        <ActionMenu
          up
          label="More actions for the selected products"
          items={[
            { label: "Change category…", icon: "bx-category", onSelect: () => { setMoveTo(cats[0]?.id ?? ""); setMoveOpen(true); } },
            { label: "Export selected", icon: "bx-download", onSelect: exportSelected },
            { label: "Delete products", icon: "bx-trash", disabled: true, hint: "Products are archived, never deleted, so past orders keep working. Use Archive.", onSelect: () => undefined },
          ]}
        >
          More
          <i aria-hidden className="bx bx-chevron-up text-lg" />
        </ActionMenu>
        {selArchived > 0 && (
          <button type="button" disabled={bulkBusy} onClick={() => void bulk(false)} className={cn(btn.ghost, "flex-1")}>
            Restore ({selArchived})
          </button>
        )}
        {selActive > 0 && (
          <button type="button" disabled={bulkBusy} onClick={() => void bulk(true)} className={cn(btn.primary, "flex-1")}>
            Archive ({selActive})
          </button>
        )}
      </ActionBar>

      <AdminSheet
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Change category"
        subtitle={`${selected.size} product${selected.size === 1 ? "" : "s"} will move to the category you choose.`}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setMoveOpen(false)} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={bulkBusy || !moveTo} onClick={() => void moveSelected()} className={btn.primary}>
              {bulkBusy ? "Moving…" : "Move products"}
            </button>
          </div>
        }
      >
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm text-muted-foreground">New category</legend>
          {cats.map((c) => (
            <label key={c.id} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 transition-colors hover:bg-white/5", moveTo === c.id ? "border-foreground/60 bg-white/5" : "border-[#262626]")}>
              <input type="radio" name="category" className="size-5" checked={moveTo === c.id} onChange={() => setMoveTo(c.id)} />
              <span className="text-base">{c.name}</span>
            </label>
          ))}
        </fieldset>
      </AdminSheet>

      {editor && (
        <ProductEditor
          key={editor.product?.id ?? (editor.seed ? `copy-${editor.seed.id}` : "new")}
          open={editorOpen}
          product={editor.product}
          seed={editor.seed}
          cats={cats}
          rows={rows}
          costs={costs}
          onClose={closeEditor}
          onSaved={() => {
            toast.success(editor.product ? "Product saved." : "Product created.");
            void load();
          }}
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
            <AlertDialogTitle>Archive {confirm && confirm.ids.length > 1 ? "these products" : "this product"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm
                ? `${confirm.label} will disappear from the storefront. Past orders and stock history stay. You can restore ${confirm.ids.length > 1 ? "them" : "it"} any time.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                if (!confirm) return;
                const ids = confirm.ids;
                setConfirm(null);
                void setArchived(ids, true).then((ok) => {
                  if (ok) {
                    setSelected(new Set());
                    setSelectMode(false);
                  }
                });
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
