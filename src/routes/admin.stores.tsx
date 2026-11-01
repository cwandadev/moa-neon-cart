import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field } from "@/components/admin/controls";
import { PageHead, Skeleton } from "@/components/moa/ui";
import { useAuth } from "@/lib/auth";
import { MapPicker } from "@/components/MapPicker";
import { mapLink } from "@/lib/delivery";
import { GEO_HELP, locate } from "@/lib/geo";
import { logoUrlOf, removeStoreLogo, uploadStoreLogo } from "@/lib/storeLogo";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/stores")({
  head: () => ({ meta: [{ title: "Stores — MOA Mart Suite" }] }),
  component: Stores,
});

type Warehouse = { id: string; name: string; address: string; phone: string; lat: number | null; lng: number | null; active: boolean; is_default: boolean };

/**
 * Stores: the places orders are sent from. The shop's database calls them warehouses, shoppers see them as stores, and riders collect from them.
 * They used to sit at the bottom of the Riders page. They have their own page now: their address, phone, logo, what each holds, which is the
 * default, and what happens when one order needs goods from two of them.
 */
function Stores() {
  const { isAdmin } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockBy, setStockBy] = useState<Record<string, number>>({});
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  const [splitPolicy, setSplitPolicy] = useState<"transfer" | "decline" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [wh, ws, sp, lg] = await Promise.all([
      supabase.from("warehouses").select("id, name, address, phone, lat, lng, active, is_default").is("archived_at", null).order("created_at"),
      // These need migration 000023: without it the page simply does not show stock or the setting below.
      supabase.from("warehouse_stock").select("warehouse_id, qty").limit(5000),
      supabase.from("delivery_settings").select("split_policy").eq("id", 1).maybeSingle(),
      // Needs migration 000025: without it the stores simply show the store icon, and the form has no logo to change.
      supabase.from("warehouses").select("id, logo_path").is("archived_at", null),
    ]);
    if (wh.error) {
      const msg = wh.error.message ?? "";
      setError(/relation|does not exist|schema cache|function|column/i.test(msg) ? "The delivery updates have not all been run in Supabase yet (migrations 000020 and 000021)." : "Could not load the stores. Try again in a moment.");
      setLoaded(true);
      return;
    }
    setError("");
    setWarehouses((wh.data as Warehouse[] | null) ?? []);
    const by: Record<string, number> = {};
    for (const x of ws.error ? [] : ((ws.data as Array<{ warehouse_id: string; qty: number }> | null) ?? [])) by[x.warehouse_id] = (by[x.warehouse_id] ?? 0) + x.qty;
    setStockBy(by);
    const lm: Record<string, string | null> = {};
    for (const x of lg.error ? [] : ((lg.data as Array<{ id: string; logo_path: string | null }> | null) ?? [])) lm[x.id] = x.logo_path;
    setLogos(lm);
    setSplitPolicy(sp.error ? null : ((sp.data as { split_policy?: "transfer" | "decline" } | null)?.split_policy ?? null));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <PageHead title="Stores" subtitle="The places orders are sent from. Shoppers see each one as a store and riders collect from it. A paid order goes to the nearest open store that has what it needs." />
      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
          <p className="text-destructive">{error}</p>
          <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
            Try again
          </button>
        </div>
      )}
      {!loaded ? (
        <div className="grid gap-3 md:grid-cols-2" aria-label="Loading stores">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        !error && <WarehouseList items={warehouses} stock={stockBy} logos={logos} policy={splitPolicy} canEdit={isAdmin} onChanged={() => void load()} />
      )}
    </>
  );
}

// ---------- warehouses: where riders collect orders ----------

function WarehouseList({ items, stock, logos, policy, canEdit, onChanged }: { items: Warehouse[]; stock: Record<string, number>; logos: Record<string, string | null>; policy: "transfer" | "decline" | null; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);
  const [removing, setRemoving] = useState<Warehouse | null>(null);

  const change = async (w: Warehouse, patch: { active?: boolean; makeDefault?: boolean }, ok: string) => {
    const { error } = await supabase.rpc("admin_save_warehouse", { p_id: w.id, p_name: w.name, p_address: w.address, p_phone: w.phone, p_lat: w.lat, p_lng: w.lng, p_active: patch.active ?? w.active, p_make_default: patch.makeDefault ?? false });
    if (error) toast.error(error.message);
    else {
      toast.success(ok);
      onChanged();
    }
  };

  return (
    <section aria-label="Warehouses" className="mt-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Warehouses</h2>
          <p className="text-sm text-muted-foreground">Where riders collect orders. A paid order goes to the nearest open one to the customer, and you can change it on the order. Stock is still one shared pool.</p>
        </div>
        {canEdit && (
          <button type="button" className={btn.ghost} onClick={() => setEditing("new")}>
            <i aria-hidden className="bx bx-plus text-lg" /> Add a warehouse
          </button>
        )}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((w) => {
          const menu: MenuItem[] = canEdit
            ? [
                { label: "Edit", icon: "bx-edit", onSelect: () => setEditing(w) },
                ...(!w.is_default && w.active ? [{ label: "Make the default", icon: "bx-star", onSelect: () => void change(w, { makeDefault: true }, `${w.name} is now the default.`) }] : []),
                ...(!w.is_default ? [{ label: w.active ? "Close it" : "Open it again", icon: w.active ? "bx-lock" : "bx-lock-open", onSelect: () => void change(w, { active: !w.active }, w.active ? `${w.name} is closed.` : `${w.name} is open again.`) }] : []),
                ...(!w.is_default ? [{ label: "Remove…", icon: "bx-trash", danger: true, onSelect: () => setRemoving(w) }] : []),
              ]
            : [];
          return (
            <li key={w.id} className={cn("rounded-2xl border bg-card p-4", w.active ? "border-[#262626]" : "border-[#262626] opacity-70")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-base font-medium">
                    <StoreMark path={logos[w.id]} size={28} />
                    {w.name}
                    {w.is_default && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal">Default</span>}
                    {!w.active && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-normal text-warning">Closed</span>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{w.address || "No address yet"}</p>
                  <p className="text-sm text-muted-foreground">{w.phone || "No phone number"}</p>
                  {stock[w.id] !== undefined && (
                    <p className="mt-1 text-sm">
                      <span className="tabular-nums">{stock[w.id]}</span> <span className="text-muted-foreground">item{stock[w.id] === 1 ? "" : "s"} in stock</span>
                    </p>
                  )}
                </div>
                {menu.length > 0 && <ActionMenu label={`Actions for ${w.name}`} items={menu} />}
              </div>
              <p className="mt-3 text-sm">
                {w.lat !== null && w.lng !== null ? (
                  <a className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={mapLink(w.lat, w.lng)} target="_blank" rel="noreferrer">
                    Pin set · open in Maps
                  </a>
                ) : (
                  <span className="text-warning">No map pin yet: riders will navigate by the address.</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      {policy !== null && items.length > 1 && <SplitPolicy value={policy} canEdit={canEdit} onSaved={onChanged} />}
      {editing && <WarehouseSheet warehouse={editing === "new" ? null : editing} logoPath={editing === "new" ? null : (logos[editing.id] ?? null)} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {removing && <RemoveWarehouse warehouse={removing} onClose={() => setRemoving(null)} onDone={() => { setRemoving(null); onChanged(); }} />}
    </section>
  );
}

/** Removing a warehouse hides it; nothing is erased. The database says no, and why, if anything still depends on it. */
function RemoveWarehouse({ warehouse, onClose, onDone }: { warehouse: Warehouse; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc("admin_delete_warehouse", { p_id: warehouse.id });
    setBusy(false);
    if (e) return setError(e.message);
    toast.success(`${warehouse.name} was removed.`);
    onDone();
  };
  return (
    <AdminSheet
      open
      onClose={busy ? () => undefined : onClose}
      title={`Remove ${warehouse.name}?`}
      subtitle="It leaves the list. Nothing is erased."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btn.ghost} disabled={busy} onClick={onClose}>
            Keep it
          </button>
          <button type="button" className={btn.primary} disabled={busy} onClick={() => void go()}>
            {busy ? "Removing…" : "Remove warehouse"}
          </button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        A warehouse can be removed once it holds no stock and no order is being filled from it. Its past orders keep its name. If you add it back later it will start empty.
      </p>
      {error && (
        <div role="alert" className="mt-4 grid gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <p>{error}</p>
          {/stock|items/i.test(error) && (
            <Link to="/admin/inventory" className="w-fit underline underline-offset-4">
              Go to Inventory to move its stock
            </Link>
          )}
        </div>
      )}
    </AdminSheet>
  );
}

/** What happens when a cart needs more than one warehouse. */
function SplitPolicy({ value, canEdit, onSaved }: { value: "transfer" | "decline"; canEdit: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = async (v: "transfer" | "decline") => {
    setBusy(true);
    const { error } = await supabase.from("delivery_settings").update({ split_policy: v, updated_at: new Date().toISOString() }).eq("id", 1);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Saved.");
      onSaved();
    }
  };
  return (
    <div className="mt-4 rounded-2xl border border-[#262626] p-4">
      <label htmlFor="split-policy" className="text-sm font-medium">
        When no single warehouse has everything in a cart
      </label>
      <select id="split-policy" className={cn(field, "mt-2")} value={value} disabled={!canEdit || busy} onChange={(e) => void save(e.target.value as "transfer" | "decline")}>
        <option value="transfer">Fill it from the best warehouse, and move the missing items there</option>
        <option value="decline">Do not accept it: ask the customer to order separately</option>
      </select>
      <p className="mt-2 text-sm text-muted-foreground">
        {value === "transfer" ? "The order waits, and is not given to a rider, until you mark the moved items as received." : "The customer sees that the items cannot be delivered together right now."}
      </p>
    </div>
  );
}

/** A store's round picture: its logo, or a store icon until it has one. */
function StoreMark({ path, size = 40 }: { path: string | null | undefined; size?: number }) {
  const url = logoUrlOf(path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span aria-hidden className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-muted-foreground" style={{ width: size, height: size }}>
      {url && !failed ? <img src={url} alt="" data-store-logo draggable={false} onError={() => setFailed(true)} className="size-full object-cover" /> : <i className="bx bx-store-alt" style={{ fontSize: Math.round(size * 0.55) }} />}
    </span>
  );
}

/** Choose or remove a store's logo. It is saved at once, on its own, so the rest of the form does not have to be saved for it. */
function LogoField({ warehouse, logoPath, onSaved }: { warehouse: Warehouse; logoPath: string | null; onSaved: () => void }) {
  const [path, setPath] = useState<string | null>(logoPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setPath(await uploadStoreLogo(warehouse.id, file, path));
      toast.success("Logo saved.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The logo could not be saved.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await removeStoreLogo(warehouse.id, path);
      setPath(null);
      toast.success("Logo removed.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The logo could not be removed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Logo</legend>
      <div className="flex items-center gap-4">
        <StoreMark path={path} size={64} />
        <div className="grid min-w-0 gap-2">
          <p className="text-sm text-muted-foreground">{path ? "Customers see this beside the store's name on a product page." : "No logo yet. Customers see a store icon instead."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={btn.ghost}>
              {busy ? "Saving…" : path ? "Change logo" : "Choose a logo"}
            </button>
            {path && (
              <button type="button" disabled={busy} onClick={() => void remove()} className={btn.dangerQuiet}>
                Remove logo
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo file" className="sr-only" tabIndex={-1} onChange={(e) => void choose(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function WarehouseSheet({ warehouse, logoPath, onClose, onSaved }: { warehouse: Warehouse | null; logoPath: string | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: warehouse?.name ?? "",
    address: warehouse?.address ?? "",
    phone: warehouse?.phone ?? "",
    lat: warehouse?.lat == null ? "" : String(warehouse.lat),
    lng: warehouse?.lng == null ? "" : String(warehouse.lng),
    active: warehouse?.active ?? true,
    makeDefault: warehouse?.is_default ?? false,
  });
  const [locating, setLocating] = useState(false);
  const [map, setMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lat = f.lat.trim() === "" ? null : Number(f.lat);
  const lng = f.lng.trim() === "" ? null : Number(f.lng);
  const badPin = (lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180));
  const valid = f.name.trim().length >= 2 && f.name.trim().length <= 60 && !badPin;
  const setPin = (p: { lat: number; lng: number }) => setF((x) => ({ ...x, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }));

  const here = async () => {
    setLocating(true);
    const r = await locate();
    setLocating(false);
    if (r.ok) setPin(r.where);
    else toast.error(GEO_HELP[r.reason]);
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc("admin_save_warehouse", { p_id: warehouse?.id ?? null, p_name: f.name.trim(), p_address: f.address.trim(), p_phone: f.phone.trim(), p_lat: lat, p_lng: lng, p_active: f.active, p_make_default: f.makeDefault });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    toast.success(warehouse ? "Saved." : `${f.name.trim()} was added.`);
    onSaved();
    onClose();
  };

  const input = (id: string, label: string, key: "name" | "address" | "phone" | "lat" | "lng", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <input id={id} className={field} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <AdminSheet open onClose={onClose} title={warehouse ? `Edit ${warehouse.name}` : "Add a warehouse"} subtitle="Riders collect orders here, and see its name, address and phone.">
      <div className="grid gap-5">
        {input("wh-name", "Name", "name", { placeholder: "MOA Mart Musanze", maxLength: 60 })}
        {input("wh-address", "Address", "address", { placeholder: "KN 5 Rd, Musanze", maxLength: 200 })}
        {input("wh-phone", "Phone riders can call", "phone", { inputMode: "tel", placeholder: "07…", maxLength: 30 })}

        {warehouse ? <LogoField warehouse={warehouse} logoPath={logoPath} onSaved={onSaved} /> : <p className="text-sm text-muted-foreground">Save the store first, then you can give it a logo.</p>}

        <fieldset className="grid gap-3 rounded-2xl border border-[#262626] p-4">
          <legend className="px-1 text-sm font-medium">Map pin (so riders can navigate here)</legend>
          <div className="grid grid-cols-2 gap-3">
            {input("wh-lat", "Latitude", "lat", { inputMode: "decimal", placeholder: "-1.944100" })}
            {input("wh-lng", "Longitude", "lng", { inputMode: "decimal", placeholder: "30.061900" })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.ghost} onClick={() => setMap(true)}>
              <i aria-hidden className="bx bx-map-pin text-lg" /> Choose on the map
            </button>
            <button type="button" className={btn.ghost} disabled={locating} onClick={() => void here()}>
              <i aria-hidden className="bx bx-current-location text-lg" /> {locating ? "Finding this device…" : "Use this device's location"}
            </button>
          </div>
          {badPin && (
            <p role="alert" className="text-sm text-destructive">
              Enter both coordinates as numbers (latitude between -90 and 90, longitude between -180 and 180), or leave both empty.
            </p>
          )}
        </fieldset>

        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-white" checked={f.active} disabled={warehouse?.is_default} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Open: orders can be collected here
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-white" checked={f.makeDefault} disabled={warehouse?.is_default} onChange={(e) => setF({ ...f, makeDefault: e.target.checked })} />
          The default: used when an order has no location
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} disabled={!valid || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {map && <MapPicker title={`Where is ${f.name.trim() || "the warehouse"}?`} initial={lat !== null && lng !== null && !badPin ? { lat, lng } : null} onClose={() => setMap(false)} onPick={(p) => { setPin(p); if (p.label && f.address.trim() === "") setF((x) => ({ ...x, address: p.label ?? "" })); setMap(false); }} />}
    </AdminSheet>
  );
}

