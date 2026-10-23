import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  FAIL_REASONS,
  failLabel,
  getPosition,
  kmLabel,
  navigateLink,
  proofPath,
  shrinkPhoto,
  telLink,
  type AvailableOrder,
  type PickupPoint,
  type RiderDelivery,
} from "@/lib/delivery";
import { timeAgo } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rider")({
  head: () => ({ meta: [{ title: "MOA Rider" }, { name: "robots", content: "noindex" }] }),
  component: RiderPage,
});

// ---------- talking to the database ----------

const friendly = (m: string) => (/failed to fetch|network|load failed/i.test(m) ? "No connection. Check your internet and try again." : m);

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { error: friendly(error.message) };
    return { data: data as T };
  } catch {
    return { error: "No connection. Check your internet and try again." };
  }
}

const BUCKET = "delivery-proofs";
const PHOTO_FRESH_MS = 25 * 60 * 1000; // the database accepts photos up to 30 minutes old

// ---------- small pieces ----------

const primary =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-display text-base font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50";
const secondary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/40 px-4 font-body text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50";
const quiet = "min-h-11 px-3 font-body text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50";

function Card({ children, tone }: { children: ReactNode; tone?: "warn" | undefined }) {
  return <li className={cn("list-none rounded-3xl border bg-card p-4 sm:p-5", tone === "warn" ? "border-warning/40" : "border-border")}>{children}</li>;
}

function Items({ items }: { items: RiderDelivery["items"] }) {
  return (
    <ul className="grid gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3 font-body text-sm">
          {it.image ? <img src={it.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" /> : <span aria-hidden className="size-12 shrink-0 rounded-xl bg-secondary" />}
          <span className="min-w-0 flex-1">
            {it.name}
            {it.variant_label ? <span className="text-muted-foreground"> ({it.variant_label})</span> : null}
          </span>
          <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 font-display font-semibold">× {it.qty}</span>
        </li>
      ))}
    </ul>
  );
}

function Message({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div className="grid max-w-sm gap-3">
        <img src="/logo.svg" alt="" className="mx-auto size-14" />
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {body && <p className="font-body text-sm text-muted-foreground">{body}</p>}
        {children}
      </div>
    </div>
  );
}

// ---------- the page ----------

function RiderPage() {
  const { user, ready } = useAuth();
  if (!ready) return <Message title="MOA Rider" body="Loading…" />;
  if (!user)
    return (
      <Message title="Sign in to start" body="Use the account the office created for you.">
        <Link to="/login" className={primary}>
          Sign in
        </Link>
      </Message>
    );
  if (user.role !== "rider")
    return (
      <Message title="This page is for riders" body="Your account is not a rider account. If you should be delivering, ask the office to change it.">
        {user.role === "admin" || user.role === "staff" ? (
          <Link to="/admin/riders" className={secondary}>
            Go to Riders in the admin
          </Link>
        ) : (
          <Link to="/" className={secondary}>
            Back to the shop
          </Link>
        )}
      </Message>
    );
  return <RiderApp name={user.firstName} />;
}

type Tab = "available" | "mine" | "done";

function RiderApp({ name }: { name: string }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [available, setAvailable] = useState<AvailableOrder[]>([]);
  const [mine, setMine] = useState<RiderDelivery[]>([]);
  const [pickup, setPickup] = useState<PickupPoint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [a, m, p] = await Promise.all([call<AvailableOrder[]>("rider_available_orders"), call<RiderDelivery[]>("rider_my_deliveries"), call<PickupPoint | null>("rider_pickup_point")]);
    if (!alive.current) return;
    setRefreshing(false);
    const err = a.error ?? m.error;
    if (err) {
      setLoadError(err);
      return;
    }
    setLoadError("");
    setAvailable(a.data ?? []);
    setMine(m.data ?? []);
    if (p.data) setPickup(p.data);
    setLoaded(true);
    setUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [refresh]);

  const active = mine.filter((d) => d.status === "assigned" || d.status === "picked_up");
  const done = mine.filter((d) => d.status === "delivered" || d.status === "failed");
  // Open on the tab that matters: what is in your hands, otherwise what is waiting.
  const shown: Tab = tab ?? (active.length > 0 ? "mine" : "available");

  const signOut = async () => {
    try {
      sessionStorage.removeItem("moa:rider:sent");
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
    window.location.assign("/login");
  };

  const tabs: Array<[Tab, string, number]> = [
    ["available", "Available", available.length],
    ["mine", "My deliveries", active.length],
    ["done", "Done today", done.length],
  ];

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <img src="/logo.svg" alt="" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold leading-tight">MOA Rider</p>
            <p className="truncate font-body text-xs text-muted-foreground">
              {name ? `Hello, ${name}` : "Hello"}
              {updatedAt ? ` · updated ${timeAgo(new Date(updatedAt).toISOString())}` : ""}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <i aria-hidden className={cn("bx bx-refresh text-2xl", refreshing && "animate-spin")} />
          </button>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <i aria-hidden className="bx bx-log-out text-2xl" />
          </button>
        </div>
        <div role="tablist" aria-label="Deliveries" className="mx-auto mt-3 grid max-w-xl grid-cols-3 gap-1.5 rounded-2xl border border-border p-1">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              onClick={() => setTab(key)}
              className={cn("min-h-11 rounded-xl px-2 font-body text-sm transition-colors", shown === key ? "bg-white font-semibold text-black" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              {n > 0 && <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", shown === key ? "bg-black/15" : "bg-secondary")}>{n}</span>}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4">
        {loadError && (
          <p role="alert" className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive">
            {loadError}
          </p>
        )}
        {!loaded && !loadError ? (
          <p className="py-16 text-center font-body text-sm text-muted-foreground">Loading…</p>
        ) : shown === "available" ? (
          <AvailableList orders={available} onChanged={refresh} onTook={() => setTab("mine")} />
        ) : shown === "mine" ? (
          <ul className="grid gap-4" aria-label="My deliveries">
            {active.length === 0 && <Empty icon="bx-package" title="Nothing on your hands" body="Take an order from Available and it shows up here." />}
            {active.map((d) => (
              <DeliveryCard key={d.order_id} d={d} pickup={pickup} onChanged={refresh} />
            ))}
          </ul>
        ) : (
          <ul className="grid gap-3" aria-label="Done today">
            {done.length === 0 && <Empty icon="bx-check-circle" title="Nothing finished yet today" body="Delivered orders show up here." />}
            {done.map((d) => (
              <DoneCard key={d.order_id} d={d} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <li className="list-none rounded-3xl border border-dashed border-border p-8 text-center">
      <i aria-hidden className={`bx ${icon} text-4xl text-muted-foreground`} />
      <p className="mt-2 font-display text-base font-semibold">{title}</p>
      <p className="mt-1 font-body text-sm text-muted-foreground">{body}</p>
    </li>
  );
}

// ---------- available orders ----------

function AvailableList({ orders, onChanged, onTook }: { orders: AvailableOrder[]; onChanged: () => Promise<void>; onTook: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const take = async (o: AvailableOrder) => {
    setBusy(o.order_id);
    const r = await call<{ ok: boolean }>("rider_accept_order", { p_order_id: o.order_id });
    setBusy(null);
    if (r.error) {
      toast.error(r.error);
      await onChanged();
      return;
    }
    toast.success(`${o.code} is yours. Collect it first.`);
    await onChanged();
    onTook();
  };
  return (
    <ul className="grid gap-3" aria-label="Available orders">
      {orders.length === 0 && <Empty icon="bx-time-five" title="No orders waiting" body="New paid orders appear here by themselves." />}
      {orders.map((o) => (
        <Card key={o.order_id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold">{o.code}</p>
              <p className="font-body text-sm text-muted-foreground">
                {o.items} item{o.items === 1 ? "" : "s"} · ready {timeAgo(o.ready_since)}
              </p>
            </div>
            {kmLabel(o.distance_km) && <span className="shrink-0 rounded-full bg-secondary px-3 py-1 font-body text-xs">{kmLabel(o.distance_km)}</span>}
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void take(o)} className={cn(primary, "mt-4")}>
            {busy === o.order_id ? "Taking…" : "Take this delivery"}
          </button>
        </Card>
      ))}
    </ul>
  );
}

// ---------- one delivery: collect, then deliver ----------

function Step({ n, label, state }: { n: number; label: string; state: "now" | "next" | "done" }) {
  return (
    <span className="flex items-center gap-2 font-body text-xs">
      <span className={cn("grid size-6 place-items-center rounded-full font-display text-xs font-semibold", state === "now" ? "bg-white text-black" : state === "done" ? "bg-success/20 text-success" : "border border-border text-muted-foreground")}>
        {state === "done" ? "✓" : n}
      </span>
      <span className={state === "next" ? "text-muted-foreground" : "font-medium"}>{label}</span>
    </span>
  );
}

function DeliveryCard({ d, pickup, onChanged }: { d: RiderDelivery; pickup: PickupPoint | null; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [finish, setFinish] = useState(false);
  const [fail, setFail] = useState(false);
  const collected = d.status === "picked_up";

  const act = async (fn: "rider_mark_picked_up" | "rider_release_order", ok: string) => {
    setBusy(true);
    const r = await call<{ ok: boolean }>(fn, { p_order_id: d.order_id });
    setBusy(false);
    setConfirmBack(false);
    if (r.error) toast.error(r.error);
    else toast.success(ok);
    await onChanged();
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-semibold">{d.code}</p>
          <p className="font-body text-sm text-muted-foreground">{d.customer_name}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Step n={1} label="Collect" state={collected ? "done" : "now"} />
          <Step n={2} label="Deliver" state={collected ? "now" : "next"} />
        </div>
      </div>

      {!collected ? (
        <div className="mt-4 grid gap-4">
          <section className="grid gap-1 rounded-2xl bg-secondary/40 p-4 font-body text-sm">
            <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">Collect at</p>
            <p className="font-display text-base font-semibold">{pickup?.name ?? "MOA Mart"}</p>
            {pickup?.address && <p>{pickup.address}</p>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={navigateLink({ lat: pickup?.lat, lng: pickup?.lng, text: pickup?.address })} target="_blank" rel="noreferrer" className={secondary}>
                <i aria-hidden className="bx bx-navigation text-xl" /> Navigate
              </a>
              {pickup?.phone ? (
                <a href={telLink(pickup.phone)} className={secondary}>
                  <i aria-hidden className="bx bx-phone text-xl" /> Call
                </a>
              ) : (
                <span />
              )}
            </div>
          </section>
          <Items items={d.items} />
          <button type="button" disabled={busy} onClick={() => void act("rider_mark_picked_up", `${d.code} collected. Now deliver it.`)} className={primary}>
            {busy ? "Saving…" : "I have the order"}
          </button>
          {confirmBack ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-border p-3 font-body text-sm">
              <span>Give this order back?</span>
              <span className="flex gap-1">
                <button type="button" className={quiet} onClick={() => setConfirmBack(false)}>
                  No
                </button>
                <button type="button" disabled={busy} className={cn(quiet, "text-destructive")} onClick={() => void act("rider_release_order", `${d.code} was given back.`)}>
                  Yes, give it back
                </button>
              </span>
            </div>
          ) : (
            <button type="button" className={quiet} onClick={() => setConfirmBack(true)}>
              Give this order back
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <section className="grid gap-2 rounded-2xl bg-secondary/40 p-4 font-body text-sm">
            <p className="font-display text-xs uppercase tracking-wider text-muted-foreground">Deliver to</p>
            <p className="font-display text-base font-semibold">{d.customer_name}</p>
            <p>{d.location}</p>
            {d.preferred_time && <p className="text-muted-foreground">Preferred time: {d.preferred_time}</p>}
            {d.notes && <p className="text-muted-foreground">Note: {d.notes}</p>}
            {d.lat === null ? (
              <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-warning">
                The customer did not share an exact location. Use the address, and call them when you are close.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-success">
                <i aria-hidden className="bx bx-map-pin text-lg" /> Exact location shared
              </p>
            )}
            <div className="mt-1 grid grid-cols-2 gap-2">
              <a href={navigateLink({ lat: d.lat, lng: d.lng, text: d.location })} target="_blank" rel="noreferrer" className={secondary}>
                <i aria-hidden className="bx bx-navigation text-xl" /> Navigate
              </a>
              <a href={telLink(d.phone)} className={secondary}>
                <i aria-hidden className="bx bx-phone text-xl" /> Call {d.customer_name.split(" ")[0]}
              </a>
            </div>
          </section>
          <Items items={d.items} />
          <button type="button" onClick={() => setFinish(true)} className={primary}>
            I am here: enter the code
          </button>
          <button type="button" className={quiet} onClick={() => setFail(true)}>
            I can&apos;t deliver this order
          </button>
        </div>
      )}

      {finish && <FinishSheet d={d} office={pickup?.phone ?? ""} onClose={() => setFinish(false)} onDone={async () => { setFinish(false); await onChanged(); }} />}
      {fail && <FailSheet d={d} onClose={() => setFail(false)} onDone={async () => { setFail(false); await onChanged(); }} />}
    </Card>
  );
}

function DoneCard({ d }: { d: RiderDelivery }) {
  const delivered = d.status === "delivered";
  return (
    <Card tone={delivered ? undefined : "warn"}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold">{d.code}</p>
          <p className="truncate font-body text-sm text-muted-foreground">{d.customer_name}</p>
        </div>
        {delivered ? (
          <span className="flex items-center gap-1.5 font-body text-sm text-success">
            <i aria-hidden className="bx bx-check-circle text-xl" /> Delivered {d.delivered_at ? timeAgo(d.delivered_at) : ""}
          </span>
        ) : (
          <span className="max-w-[55%] text-right font-body text-sm text-warning">{failLabel(d.failed_reason)}</span>
        )}
      </div>
      {!delivered && d.failed_reason !== "cancelled" && <p className="mt-2 font-body text-xs text-muted-foreground">The office will decide what happens next.</p>}
    </Card>
  );
}

// ---------- a full-screen sheet ----------

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          {subtitle && <p className="font-body text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <i aria-hidden className="bx bx-x text-3xl" />
        </button>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

// ---------- the moment of delivery: the code, and a photo ----------

type CompleteResult = { ok: boolean; reason?: "wrong_code" | "locked" | "photo_missing"; attempts_left?: number; flag?: string | null };

function FinishSheet({ d, office, onClose, onDone }: { d: RiderDelivery; office: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ path: string; at: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(d.attempts_left);
  const [locked, setLocked] = useState(d.attempts_left <= 0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const upload = async (blob: Blob): Promise<string | null> => {
    setUploading(true);
    const path = proofPath(d.order_id);
    try {
      const { error: e } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (e) {
        setError("The photo did not upload. Check your internet and tap Complete again.");
        return null;
      }
      setUploaded({ path, at: Date.now() });
      return path;
    } catch {
      setError("The photo did not upload. Check your internet and tap Complete again.");
      return null;
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    const small = await shrinkPhoto(file);
    setPhoto(small);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(small);
    });
    setUploaded(null);
    await upload(small); // sent right away, so completing is quick
  };

  const complete = async () => {
    if (!photo || code.length !== 4 || submitting) return;
    setSubmitting(true);
    setError("");
    let path = uploaded && Date.now() - uploaded.at < PHOTO_FRESH_MS ? uploaded.path : null;
    if (!path) path = await upload(photo);
    if (!path) {
      setSubmitting(false);
      return;
    }
    const where = await getPosition(8000);
    const r = await call<CompleteResult>("rider_complete_delivery", { p_order_id: d.order_id, p_code: code, p_proof_path: path, p_lat: where?.lat ?? null, p_lng: where?.lng ?? null });
    setSubmitting(false);
    if (r.error || !r.data) {
      setError(r.error ?? "Something went wrong. Try again.");
      return;
    }
    if (r.data.ok) {
      toast.success(`${d.code} delivered. Well done!`);
      await onDone();
      return;
    }
    if (r.data.reason === "wrong_code") {
      setAttemptsLeft(r.data.attempts_left ?? 0);
      setCode("");
      setError(`That code is not right. ${r.data.attempts_left} ${r.data.attempts_left === 1 ? "try" : "tries"} left.`);
      return;
    }
    if (r.data.reason === "locked") {
      setLocked(true);
      setAttemptsLeft(0);
      return;
    }
    // The photo was not accepted: send it again.
    setUploaded(null);
    setError("The photo was not accepted. Take it again, at the customer's door.");
  };

  const ready = code.length === 4 && photo !== null && !uploading && !submitting;

  return (
    <Sheet title={`Deliver ${d.code}`} subtitle={d.customer_name} onClose={onClose}>
      {locked ? (
        <div className="grid gap-4">
          <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 font-body text-sm text-destructive">
            Too many wrong codes. For safety this delivery is locked. Call the office, and they will unlock it.
          </p>
          {office ? (
            <a href={telLink(office)} className={primary}>
              <i aria-hidden className="bx bx-phone text-xl" /> Call the office
            </a>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <label htmlFor="rider-code" className="font-display text-sm font-semibold">
              1. Ask the customer for their 4-digit code
            </label>
            <input
              id="rider-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                setError("");
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="••••"
              aria-describedby="rider-code-help"
              className="h-20 rounded-2xl border border-border bg-card text-center font-display text-5xl font-semibold tracking-[0.4em] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p id="rider-code-help" className="font-body text-xs text-muted-foreground">
              They see it on their order page in the MOA Mart app. Never tell them the code.{attemptsLeft < 5 ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` : ""}
            </p>
          </section>

          <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <p className="font-display text-sm font-semibold">2. Take a photo of the order with the customer</p>
            <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            {preview ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <img src={preview} alt="The photo you took" className="max-h-72 w-full min-w-0 max-w-full rounded-2xl border border-border object-cover" />
                <div className="flex items-center justify-between gap-3 font-body text-sm">
                  <span className={cn("flex items-center gap-1.5", uploaded ? "text-success" : "text-muted-foreground")}>
                    <i aria-hidden className={cn("bx text-lg", uploading ? "bx-loader-alt animate-spin" : uploaded ? "bx-check-circle" : "bx-error")} />
                    {uploading ? "Sending the photo…" : uploaded ? "Photo saved" : "Photo not sent yet"}
                  </span>
                  <button type="button" className={quiet} onClick={() => input.current?.click()}>
                    Retake
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => input.current?.click()} className={secondary}>
                <i aria-hidden className="bx bx-camera text-2xl" /> Take a photo
              </button>
            )}
          </section>

          {error && (
            <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="button" disabled={!ready} onClick={() => void complete()} className={primary}>
            {submitting ? "Completing…" : "Complete delivery"}
          </button>
          <p className="text-center font-body text-xs text-muted-foreground">We also record where you are when you complete, to check the delivery.</p>
        </div>
      )}
    </Sheet>
  );
}

// ---------- when it cannot be delivered ----------

function FailSheet({ d, onClose, onDone }: { d: RiderDelivery; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState<(typeof FAIL_REASONS)[number][0] | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = reason !== "" && (reason !== "other" || note.trim().length >= 3);

  const send = async () => {
    if (!valid) return;
    setBusy(true);
    const r = await call<{ ok: boolean }>("rider_report_failed", { p_order_id: d.order_id, p_reason: reason, p_note: note.trim() || null, p_photo_path: null });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    toast.success("Reported. The office will decide what happens next.");
    await onDone();
  };

  return (
    <Sheet title={`Can't deliver ${d.code}`} subtitle="Tell the office why. Keep the order with you until they call." onClose={onClose}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-display text-sm font-semibold">What happened?</legend>
          {FAIL_REASONS.map(([value, label]) => (
            <label key={value} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 font-body text-sm", reason === value ? "border-white bg-white/10" : "border-border")}>
              <input type="radio" name="fail-reason" className="size-5 accent-white" checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <label htmlFor="fail-note" className="font-display text-sm font-semibold">
            Note {reason === "other" ? "(required)" : "(optional)"}
          </label>
          <textarea id="fail-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className="rounded-2xl border border-border bg-card p-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="For example: called three times, no answer" />
        </div>
        {error && (
          <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive">
            {error}
          </p>
        )}
        <button type="button" disabled={!valid || busy} onClick={() => void send()} className={primary}>
          {busy ? "Sending…" : "Report to the office"}
        </button>
      </div>
    </Sheet>
  );
}
