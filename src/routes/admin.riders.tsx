import { createFileRoute, Link } from "@tanstack/react-router";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field } from "@/components/admin/controls";
import { EmptyState, PageHead } from "@/components/moa/ui";
import { useAuth } from "@/lib/auth";
import { failLabel, getPosition, telLink } from "@/lib/delivery";
import { timeAgo } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/riders")({
  head: () => ({ meta: [{ title: "Riders — MOA Mart Suite" }] }),
  component: Riders,
});

type Rider = { id: string; first_name: string; last_name: string; phone: string | null };
type Dlv = {
  order_id: string;
  rider_id: string;
  status: "assigned" | "picked_up" | "delivered" | "failed";
  assigned_at: string;
  delivered_at: string | null;
  failed_at: string | null;
  failed_reason: string | null;
  proof_flag: string | null;
  orders: { code: string } | null;
};
type Settings = {
  pickup_name: string;
  pickup_address: string;
  pickup_phone: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  max_active_per_rider: number;
  proof_radius_m: number;
};
type Candidate = { id: string; first_name: string; last_name: string; phone: string | null; email: string | null };

const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim() || "Unnamed";
const kigaliDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });

async function callFn<T>(name: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let msg = "Something went wrong. Please try again.";
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (b?.error) msg = String(b.error);
      } catch {
        /* keep the generic message */
      }
    }
    return { error: msg };
  }
  return { data: data as T };
}

function Riders() {
  const { isAdmin } = useAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [deliveries, setDeliveries] = useState<Dlv[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const [r, d, w, s] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, phone").eq("role", "rider").order("first_name"),
      supabase.from("deliveries").select("order_id, rider_id, status, assigned_at, delivered_at, failed_at, failed_reason, proof_flag, orders(code)").order("assigned_at", { ascending: false }).limit(300),
      supabase.rpc("rider_available_orders"),
      supabase.from("delivery_settings").select("pickup_name, pickup_address, pickup_phone, pickup_lat, pickup_lng, max_active_per_rider, proof_radius_m").eq("id", 1).maybeSingle(),
    ]);
    if (r.error || d.error) {
      setError(/relation|does not exist|schema cache|function/i.test((r.error ?? d.error)?.message ?? "") ? "The delivery update has not been run in Supabase yet (migration 000020)." : "Could not load the riders. Try again.");
      setLoaded(true);
      return;
    }
    setError("");
    setRiders((r.data as Rider[] | null) ?? []);
    setDeliveries((d.data as unknown as Dlv[] | null) ?? []);
    setWaiting(Array.isArray(w.data) ? w.data.length : 0);
    setSettings((s.data as Settings | null) ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const today = kigaliDay(new Date());
  const active = deliveries.filter((d) => d.status === "assigned" || d.status === "picked_up");
  const onRoad = deliveries.filter((d) => d.status === "picked_up").length;
  const needsLook = deliveries.filter((d) => (d.status === "failed" && d.failed_reason !== "cancelled") || (d.status === "delivered" && d.proof_flag === "far_from_pin" && d.delivered_at && Date.now() - new Date(d.delivered_at).getTime() < 7 * 86_400_000));

  const stat = (label: string, value: number, hint?: string) => (
    <div className="rounded-2xl border border-[#262626] bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  const removeRole = async (r: Rider) => {
    if (active.some((d) => d.rider_id === r.id)) {
      toast.error(`${fullName(r)} still has a delivery. Move it to another rider first.`);
      return;
    }
    const { error: e } = await supabase.from("profiles").update({ role: "customer" }).eq("id", r.id);
    if (e) toast.error(e.message);
    else {
      toast.success(`${fullName(r)} is no longer a rider.`);
      void load();
    }
  };

  return (
    <>
      <PageHead
        title="Riders"
        subtitle="Your delivery team. Riders take paid orders themselves, collect them at the pickup point, and finish each delivery with the customer's code and a photo."
        actions={
          isAdmin ? (
            <button type="button" className={btn.primary} onClick={() => setAddOpen(true)}>
              <i aria-hidden className="bx bx-plus text-lg" /> Add a rider
            </button>
          ) : null
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Riders", riders.length)}
        {stat("On the road now", onRoad)}
        <Link to="/admin/orders" className="rounded-2xl border border-[#262626] bg-card p-4 transition-colors hover:bg-white/[0.04]">
          <p className="text-sm text-muted-foreground">Waiting for a rider</p>
          <p className={cn("mt-1 font-display text-3xl font-semibold tabular-nums", waiting > 0 && "text-warning")}>{waiting}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Open the Orders page</p>
        </Link>
        {stat("Need a look", needsLook.length, "Failed or flagged")}
      </div>

      {needsLook.length > 0 && (
        <section aria-label="Need a look" className="mt-6 rounded-2xl border border-warning/30 bg-warning/[0.04] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <i aria-hidden className="bx bx-error text-lg text-warning" /> Need a look
          </h2>
          <ul className="grid gap-2">
            {needsLook.slice(0, 8).map((d) => {
              const rider = riders.find((r) => r.id === d.rider_id);
              const code = d.orders?.code ?? "";
              return (
                <li key={d.order_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-card px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link to="/admin/orders" search={{ q: code } as never} className="font-medium underline-offset-4 hover:underline">
                      {code}
                    </Link>
                    <span className="text-muted-foreground">
                      {" · "}
                      {d.status === "failed" ? failLabel(d.failed_reason) : "Delivered far from the customer's pin"}
                      {rider ? ` · ${fullName(rider)}` : ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{timeAgo(d.failed_at ?? d.delivered_at ?? d.assigned_at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="The team" className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">The team</h2>
        {!loaded ? (
          <div className="h-28 animate-pulse rounded-2xl border border-[#262626] bg-white/[0.03]" />
        ) : riders.length === 0 ? (
          <div className="rounded-2xl border border-[#262626] bg-card">
            <EmptyState icon="bx-cycling" title="No riders yet" hint={isAdmin ? "Add your first rider. They sign in with their own account and see only deliveries." : "An admin can add riders."} />
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {riders.map((r) => {
              const mine = deliveries.filter((d) => d.rider_id === r.id);
              const now = mine.filter((d) => d.status === "assigned" || d.status === "picked_up").length;
              const doneToday = mine.filter((d) => d.status === "delivered" && d.delivered_at && kigaliDay(new Date(d.delivered_at)) === today).length;
              const total = mine.filter((d) => d.status === "delivered").length;
              const items: MenuItem[] = [
                ...(r.phone ? [{ label: "Call", icon: "bx-phone", onSelect: () => void (window.location.href = telLink(r.phone!)) }] : []),
                ...(isAdmin ? [{ label: "Remove rider role", icon: "bx-user-x", danger: true, onSelect: () => void removeRole(r) }] : []),
              ];
              return (
                <li key={r.id} className="rounded-2xl border border-[#262626] bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium">{fullName(r)}</p>
                      <p className="truncate text-sm text-muted-foreground">{r.phone ?? "No phone number"}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs", now > 0 ? "bg-info/15 text-info" : "bg-success/15 text-success")}>{now > 0 ? `${now} on hand` : "Free"}</span>
                      {items.length > 0 && <ActionMenu label={`Actions for ${fullName(r)}`} items={items} />}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="tabular-nums text-foreground">{doneToday}</span> delivered today · <span className="tabular-nums text-foreground">{total}</span> in total
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <PickupSettings settings={settings} canEdit={isAdmin} onSaved={() => void load()} />

      <AddRiderSheet open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => void load()} existing={new Set(riders.map((r) => r.id))} />
    </>
  );
}

// ---------- where riders collect, and the rules ----------

function PickupSettings({ settings, canEdit, onSaved }: { settings: Settings | null; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", address: "", phone: "", lat: "", lng: "", max: "3", radius: "300" });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  // The page refreshes itself every 30 seconds: it must never overwrite what someone is in the middle of typing.
  const edited = useRef(false);
  const change = (key: keyof typeof form, value: string) => {
    edited.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  useEffect(() => {
    if (!settings || edited.current) return;
    setForm({
      name: settings.pickup_name,
      address: settings.pickup_address,
      phone: settings.pickup_phone,
      lat: settings.pickup_lat === null ? "" : String(settings.pickup_lat),
      lng: settings.pickup_lng === null ? "" : String(settings.pickup_lng),
      max: String(settings.max_active_per_rider),
      radius: String(settings.proof_radius_m),
    });
  }, [settings]);

  if (!settings) return null;

  const lat = form.lat.trim() === "" ? null : Number(form.lat);
  const lng = form.lng.trim() === "" ? null : Number(form.lng);
  const badPin = (lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180));
  const max = Number(form.max);
  const radius = Number(form.radius);
  const badRules = !Number.isInteger(max) || max < 1 || max > 20 || !Number.isInteger(radius) || radius < 50 || radius > 5000;
  const valid = form.name.trim() !== "" && !badPin && !badRules;

  const here = async () => {
    setLocating(true);
    const p = await getPosition(12000);
    setLocating(false);
    if (!p) {
      toast.error("Could not get this device's location. Allow it in the browser, or type the coordinates.");
      return;
    }
    edited.current = true;
    setForm((f) => ({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }));
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const { error } = await supabase
      .from("delivery_settings")
      .update({ pickup_name: form.name.trim(), pickup_address: form.address.trim(), pickup_phone: form.phone.trim(), pickup_lat: lat, pickup_lng: lng, max_active_per_rider: max, proof_radius_m: radius, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Saved.");
      edited.current = false;
      onSaved();
    }
  };

  const input = (id: string, label: string, key: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <input id={id} className={field} value={form[key]} disabled={!canEdit} onChange={(e) => change(key, e.target.value)} {...props} />
    </div>
  );

  return (
    <section aria-label="Pickup point and rules" className="mt-8 rounded-2xl border border-[#262626] bg-card p-4 sm:p-5">
      <h2 className="text-base font-medium">Pickup point and rules</h2>
      <p className="mt-1 text-sm text-muted-foreground">Where riders collect orders. Riders only see the address of the customer after they take an order.{!canEdit && " Only an admin can change this."}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {input("pp-name", "Name", "name")}
        {input("pp-phone", "Phone riders can call", "phone", { inputMode: "tel", placeholder: "07…" })}
        <div className="sm:col-span-2">{input("pp-address", "Address", "address", { placeholder: "KG 11 Ave, Kigali" })}</div>
        {input("pp-lat", "Latitude", "lat", { inputMode: "decimal", placeholder: "-1.944100" })}
        {input("pp-lng", "Longitude", "lng", { inputMode: "decimal", placeholder: "30.061900" })}
        {canEdit && (
          <div className="sm:col-span-2">
            <button type="button" className={btn.ghost} disabled={locating} onClick={() => void here()}>
              <i aria-hidden className="bx bx-current-location text-lg" /> {locating ? "Finding this device…" : "Use this device's location (stand at the pickup point)"}
            </button>
          </div>
        )}
        {input("pp-max", "Most deliveries one rider can hold at once", "max", { inputMode: "numeric" })}
        {input("pp-radius", "A delivery is flagged when the rider is further than (metres) from the customer's pin", "radius", { inputMode: "numeric" })}
      </div>
      {badPin && <p role="alert" className="mt-3 text-sm text-destructive">Enter both coordinates as numbers (latitude between -90 and 90, longitude between -180 and 180), or leave both empty.</p>}
      {badRules && <p role="alert" className="mt-3 text-sm text-destructive">Deliveries per rider: 1 to 20. Distance: 50 to 5000 metres.</p>}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button type="button" className={btn.primary} disabled={!valid || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- adding a rider ----------

function AddRiderSheet({ open, onClose, onAdded, existing }: { open: boolean; onClose: () => void; onAdded: () => void; existing: Set<string> }) {
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ first: "", last: "", phone: "", email: "", password: "" });
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open || mode !== "pick") return;
    const term = q.trim();
    if (term.length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      const like = `%${term.replace(/[%,()]/g, " ")}%`;
      void supabase
        .from("profiles")
        .select("id, first_name, last_name, phone, email")
        .eq("role", "customer")
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .limit(8)
        .then(({ data }) => {
          if (!cancelled) setFound(((data as Candidate[] | null) ?? []).filter((c) => !existing.has(c.id)));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, mode, existing]);

  const makeRider = async (id: string, label: string) => {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ role: "rider" }).eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(`${label} is now a rider.`);
    onAdded();
    return true;
  };

  const create = async () => {
    setFormError("");
    const email = form.email.trim().toLowerCase();
    if (!form.first.trim() || !form.last.trim()) return setFormError("Enter a first and last name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setFormError("Enter a valid email.");
    if (form.password.length < 8) return setFormError("The password must be at least 8 characters.");
    setBusy(true);
    const r = await callFn<{ id: string }>("manage-users", { action: "create", email, password: form.password, role: "customer", first_name: form.first.trim(), last_name: form.last.trim(), phone: form.phone.trim() });
    if (r.error || !r.data?.id) {
      setBusy(false);
      setFormError(r.error ?? "Could not create the account.");
      return;
    }
    const ok = await makeRider(r.data.id, `${form.first.trim()} ${form.last.trim()}`);
    if (ok) {
      setForm({ first: "", last: "", phone: "", email: "", password: "" });
      onClose();
    } else setFormError("The account was created but could not be made a rider. Find it in the Users page.");
  };

  const input = (id: string, label: string, key: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <input id={id} className={field} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <AdminSheet open={open} onClose={onClose} title="Add a rider" subtitle="Riders sign in with their own account and see only deliveries.">
      <div className="grid gap-5">
        <div role="group" aria-label="How" className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#262626] p-1">
          {([["pick", "Someone with an account"], ["new", "A new account"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={cn("min-h-11 rounded-lg px-3 text-sm transition-colors", mode === k ? "bg-white font-medium text-black" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>

        {mode === "pick" ? (
          <div className="grid gap-3">
            <label htmlFor="rider-search" className="text-sm text-muted-foreground">
              Search by name, email or phone
            </label>
            <input id="rider-search" className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters" autoComplete="off" />
            <ul className="grid gap-2" aria-label="People found">
              {found.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#262626] p-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{fullName(c)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.email ?? c.phone ?? ""}</span>
                  </span>
                  <button type="button" className={btn.ghost} disabled={busy} onClick={() => void makeRider(c.id, fullName(c)).then((ok) => ok && onClose())}>
                    Make rider
                  </button>
                </li>
              ))}
              {q.trim().length >= 2 && found.length === 0 && <li className="text-sm text-muted-foreground">Nobody found. They need an account first, or use A new account.</li>}
            </ul>
          </div>
        ) : (
          <div className="grid gap-4">
            {input("nr-first", "First name", "first", { autoComplete: "off" })}
            {input("nr-last", "Last name", "last", { autoComplete: "off" })}
            {input("nr-phone", "Phone (customers and the office call this number)", "phone", { inputMode: "tel", autoComplete: "off" })}
            {input("nr-email", "Email (their login)", "email", { type: "email", autoComplete: "off" })}
            {input("nr-pass", "Password (at least 8 characters)", "password", { type: "text", autoComplete: "off" })}
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create the rider"}
            </button>
            <p className="text-xs text-muted-foreground">Give them the email and password. They open the MOA Mart website on their phone and sign in: they land on the rider screen.</p>
          </div>
        )}
      </div>
    </AdminSheet>
  );
}
