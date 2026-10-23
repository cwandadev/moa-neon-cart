import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  FAIL_REASONS,
  FALLBACK_REASONS,
  failLabel,
  kmLabel,
  navigateLink,
  proofPath,
  routeLink,
  shrinkPhoto,
  telLink,
  type AvailableOrder,
  type RiderDelivery,
} from "@/lib/delivery";
import { GEO_HELP, locate } from "@/lib/geo";
import { markAllRead, markRead, SEV, timeAgo, useNotifications } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rider")({
  head: () => ({ meta: [{ title: "MOA Rider" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0b0f17" }] }),
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
const alertBox = "rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive";

function Card({ children, tone }: { children: ReactNode; tone?: "warn" | undefined }) {
  return <li className={cn("list-none rounded-3xl border bg-card p-4 sm:p-5", tone === "warn" ? "border-warning/40" : "border-border")}>{children}</li>;
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

type Tab = "available" | "mine" | "done" | "alerts";

function RiderApp({ name }: { name: string }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [available, setAvailable] = useState<AvailableOrder[]>([]);
  const [mine, setMine] = useState<RiderDelivery[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);
  const alive = useRef(true);
  const { items: notes, unread, loaded: notesLoaded } = useNotifications();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [a, m] = await Promise.all([call<AvailableOrder[]>("rider_available_orders"), call<RiderDelivery[]>("rider_my_deliveries")]);
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

  // A new notification (an order is ready, one was given to you or taken away) refreshes the lists and buzzes the phone.
  const newest = notes[0]?.id;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!notesLoaded) return;
    if (seen.current !== undefined && newest && newest !== seen.current) {
      void refresh();
      try {
        navigator.vibrate?.(200);
      } catch {
        /* no vibration on this phone */
      }
    }
    seen.current = newest ?? "";
  }, [newest, notesLoaded, refresh]);

  const active = mine.filter((d) => d.status === "assigned" || d.status === "picked_up");
  const done = mine.filter((d) => d.status === "delivered" || d.status === "failed");
  // Open on what matters: what is in your hands, otherwise what is waiting.
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

  const tabs: Array<[Tab, string, string, number]> = [
    ["available", "Available", "bx-list-ul", available.length],
    ["mine", "My deliveries", "bx-package", active.length],
    ["done", "Done today", "bx-check-circle", 0],
    ["alerts", "Alerts", "bx-bell", unread],
  ];

  return (
    <div className="min-h-screen bg-background pb-28 text-foreground">
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
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4">
        {loadError && (
          <p role="alert" className={cn(alertBox, "mb-4")}>
            {loadError}
          </p>
        )}
        {shown === "alerts" ? (
          <Alerts />
        ) : !loaded && !loadError ? (
          <p className="py-16 text-center font-body text-sm text-muted-foreground">Loading…</p>
        ) : shown === "available" ? (
          <AvailableList orders={available} onChanged={refresh} onTook={() => setTab("mine")} />
        ) : shown === "mine" ? (
          <ul className="grid gap-4" aria-label="My deliveries">
            {active.length === 0 && <Empty icon="bx-package" title="Nothing on your hands" body="Take an order from Available and it shows up here." />}
            {active.map((d) => (
              <DeliveryCard key={d.order_id} d={d} onChanged={refresh} />
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

      <nav aria-label="Rider" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div role="tablist" aria-label="Rider sections" className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map(([key, label, icon, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              aria-label={n > 0 ? `${label}, ${n}` : label}
              onClick={() => setTab(key)}
              className={cn("relative flex min-h-16 flex-col items-center justify-center gap-0.5 font-body text-[11px] transition-colors", shown === key ? "text-foreground" : "text-muted-foreground")}
            >
              <span className="relative">
                <i aria-hidden className={cn("bx text-2xl", icon)} />
                {n > 0 && <span className="absolute -right-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-display text-[10px] font-semibold text-primary-foreground">{n > 9 ? "9+" : n}</span>}
              </span>
              <span className={cn(shown === key && "font-semibold")}>{label}</span>
              {shown === key && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </nav>
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

// ---------- alerts ----------

function Alerts() {
  const { items, unread, loaded } = useNotifications();
  return (
    <section aria-label="Alerts" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-semibold">Alerts</h1>
        {unread > 0 && (
          <button type="button" className={quiet} onClick={() => void markAllRead()}>
            Mark all as read
          </button>
        )}
      </div>
      {!loaded ? (
        <p className="py-12 text-center font-body text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <ul>
          <Empty icon="bx-bell" title="No alerts yet" body="You will see here when an order is ready, when one is given to you, or when something changes." />
        </ul>
      ) : (
        <ul className="grid gap-2" aria-label="Alerts list">
          {items.slice(0, 40).map((n) => {
            const t = SEV[n.severity] ?? SEV.info;
            const isNew = !n.read_at;
            return (
              <li key={n.id} className={cn("list-none rounded-2xl border", isNew ? `${t.border} ${t.bg}` : "border-border bg-card")}>
                <button type="button" onClick={() => void markRead(n.id)} className="flex w-full items-start gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
                    <i aria-hidden className={`bx ${t.icon} text-lg`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={cn("block min-w-0 break-words font-body text-sm", isNew && "font-semibold")}>
                        {isNew && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </span>
                      <span className="shrink-0 font-body text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                    </span>
                    {n.body && <span className="mt-0.5 block font-body text-sm text-muted-foreground">{n.body}</span>}
                  </span>
                  {isNew && <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full bg-current", t.text)} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
              <p className="font-display text-2xl font-semibold tracking-tight">{o.code}</p>
              <p className="font-body text-sm text-muted-foreground">
                {o.warehouse ? `Collect at ${o.warehouse}` : "Collect at the warehouse"} · ready {timeAgo(o.ready_since)}
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

function DeliveryCard({ d, onChanged }: { d: RiderDelivery; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [sheet, setSheet] = useState<null | "code" | "photo" | "fail">(null);
  const collected = d.status === "picked_up";
  const w = d.warehouse;

  const act = async (fn: "rider_mark_picked_up" | "rider_release_order", ok: string) => {
    setBusy(true);
    const r = await call<{ ok: boolean }>(fn, { p_order_id: d.order_id });
    setBusy(false);
    setConfirmBack(false);
    if (r.error) toast.error(r.error);
    else toast.success(ok);
    await onChanged();
  };
  const finished = async () => {
    setSheet(null);
    await onChanged();
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold tracking-tight">{d.code}</p>
          <p className="font-body text-sm text-muted-foreground">{collected ? "On the way to the customer" : "Waiting to be collected"}</p>
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
            <p className="font-display text-base font-semibold">{w?.name ?? "The warehouse"}</p>
            {w?.address && <p>{w.address}</p>}
            <p className="mt-1 text-muted-foreground">
              Ask for order <span className="font-semibold text-foreground">{d.code}</span>. Take the sealed parcel with that code on it.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={navigateLink({ lat: w?.lat, lng: w?.lng, text: w?.address || w?.name })} target="_blank" rel="noreferrer" className={secondary}>
                <i aria-hidden className="bx bx-navigation text-xl" /> Navigate
              </a>
              {w?.phone ? (
                <a href={telLink(w.phone)} className={secondary}>
                  <i aria-hidden className="bx bx-phone text-xl" /> Call
                </a>
              ) : (
                <span />
              )}
            </div>
          </section>
          <button type="button" disabled={busy} onClick={() => void act("rider_mark_picked_up", `${d.code} collected. Now deliver it.`)} className={primary}>
            {busy ? "Saving…" : "I have the parcel"}
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
              <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-warning">The customer did not share an exact location. Use the address, and call them when you are close.</p>
            ) : (
              <p className="flex items-center gap-1.5 text-success">
                <i aria-hidden className="bx bx-map-pin text-lg" /> Exact location shared
              </p>
            )}
            <div className="mt-1 grid grid-cols-2 gap-2">
              <a href={routeLink({ lat: w?.lat, lng: w?.lng, text: w?.address || w?.name }, { lat: d.lat, lng: d.lng, text: d.location })} target="_blank" rel="noreferrer" className={secondary}>
                <i aria-hidden className="bx bx-trip text-xl" /> Route from warehouse
              </a>
              <a href={navigateLink({ lat: d.lat, lng: d.lng, text: d.location })} target="_blank" rel="noreferrer" className={secondary}>
                <i aria-hidden className="bx bx-navigation text-xl" /> Navigate from here
              </a>
            </div>
            {d.phone && (
              <a href={telLink(d.phone)} className={secondary}>
                <i aria-hidden className="bx bx-phone text-xl" /> Call {(d.customer_name ?? "").split(" ")[0] || "the customer"}
              </a>
            )}
          </section>
          <button type="button" onClick={() => setSheet("code")} className={primary}>
            I am here: enter the code
          </button>
          <div className="flex flex-wrap items-center justify-center gap-x-2">
            <button type="button" className={quiet} onClick={() => setSheet("photo")}>
              The customer can&apos;t give the code
            </button>
            <button type="button" className={quiet} onClick={() => setSheet("fail")}>
              I can&apos;t deliver this order
            </button>
          </div>
        </div>
      )}

      {sheet === "code" && <CodeSheet d={d} office={w?.phone ?? ""} onClose={() => setSheet(null)} onDone={finished} onNoCode={() => setSheet("photo")} />}
      {sheet === "photo" && <NoCodeSheet d={d} onClose={() => setSheet(null)} onDone={finished} />}
      {sheet === "fail" && <FailSheet d={d} onClose={() => setSheet(null)} onDone={finished} />}
    </Card>
  );
}

function DoneCard({ d }: { d: RiderDelivery }) {
  const delivered = d.status === "delivered";
  return (
    <Card tone={delivered ? undefined : "warn"}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">{d.code}</p>
          {delivered && d.verified_by === "photo" && <p className="font-body text-xs text-muted-foreground">Delivered with a photo: the office will check it</p>}
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

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string | undefined; onClose: () => void; children: ReactNode }) {
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

// ---------- the moment of delivery: the code ----------

type CompleteResult = { ok: boolean; reason?: "wrong_code" | "locked"; attempts_left?: number; flag?: string | null };

function CodeSheet({ d, office, onClose, onDone, onNoCode }: { d: RiderDelivery; office: string; onClose: () => void; onDone: () => Promise<void>; onNoCode: () => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(d.attempts_left);
  const [locked, setLocked] = useState(d.attempts_left <= 0);

  const complete = async () => {
    if (code.length !== 4 || submitting) return;
    setSubmitting(true);
    setError("");
    const where = await locate({ quick: true });
    const r = await call<CompleteResult>("rider_complete_delivery", {
      p_order_id: d.order_id,
      p_code: code,
      p_lat: where.ok ? where.where.lat : null,
      p_lng: where.ok ? where.where.lng : null,
    });
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
    if (r.data.reason === "locked") {
      setLocked(true);
      setAttemptsLeft(0);
      return;
    }
    setAttemptsLeft(r.data.attempts_left ?? 0);
    setCode("");
    setError(`That code is not right. ${r.data.attempts_left} ${r.data.attempts_left === 1 ? "try" : "tries"} left.`);
  };

  return (
    <Sheet title={`Deliver ${d.code}`} subtitle={d.customer_name ?? undefined} onClose={onClose}>
      {locked ? (
        <div className="grid gap-4">
          <p role="alert" className={alertBox}>
            Too many wrong codes. For safety this delivery is locked. Call the office and they will unlock it, or use the photo way below if the customer cannot give the code.
          </p>
          {office ? (
            <a href={telLink(office)} className={primary}>
              <i aria-hidden className="bx bx-phone text-xl" /> Call the office
            </a>
          ) : null}
          <button type="button" className={secondary} onClick={onNoCode}>
            The customer can&apos;t give the code
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <label htmlFor="rider-code" className="font-display text-sm font-semibold">
              Ask the customer for their 4-digit code
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
              autoFocus
              className="h-24 rounded-2xl border border-border bg-card text-center font-display text-6xl font-semibold tracking-[0.35em] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p id="rider-code-help" className="font-body text-xs text-muted-foreground">
              They see it on their order page in the MOA Mart app. Never tell them the code.{attemptsLeft < 5 ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` : ""}
            </p>
          </section>
          {error && (
            <p role="alert" className={alertBox}>
              {error}
            </p>
          )}
          <button type="button" disabled={code.length !== 4 || submitting} onClick={() => void complete()} className={primary}>
            {submitting ? "Completing…" : "Complete delivery"}
          </button>
          <button type="button" className={quiet} onClick={onNoCode}>
            The customer can&apos;t give the code
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------- only when the code cannot be used ----------

type NoCodeResult = { ok: boolean; reason?: "photo_missing" | "location_required"; flag?: string | null };

function NoCodeSheet({ d, onClose, onDone }: { d: RiderDelivery; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState<(typeof FALLBACK_REASONS)[number][0] | "">("");
  const [who, setWho] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ path: string; at: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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

  const valid = reason !== "" && who.trim().length >= 2 && photo !== null && !uploading && !submitting;

  const complete = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError("");
    const where = await locate({ quick: true });
    if (!where.ok) {
      setSubmitting(false);
      setError(`We need your location to check this delivery. ${GEO_HELP[where.reason]}`);
      return;
    }
    let path = uploaded && Date.now() - uploaded.at < PHOTO_FRESH_MS ? uploaded.path : null;
    if (!path && photo) path = await upload(photo);
    if (!path) {
      setSubmitting(false);
      return;
    }
    const r = await call<NoCodeResult>("rider_complete_without_code", { p_order_id: d.order_id, p_reason: reason, p_received_by: who.trim(), p_proof_path: path, p_lat: where.where.lat, p_lng: where.where.lng });
    setSubmitting(false);
    if (r.error || !r.data) {
      setError(r.error ?? "Something went wrong. Try again.");
      return;
    }
    if (r.data.ok) {
      toast.success(`${d.code} delivered. The office will check the photo.`);
      await onDone();
      return;
    }
    if (r.data.reason === "location_required") setError("We need your location to check this delivery. Allow location and try again.");
    else {
      setUploaded(null);
      setError("The photo was not accepted. Take it again, at the customer's door.");
    }
  };

  return (
    <Sheet title={`Deliver ${d.code} without the code`} subtitle="Only when the customer cannot give the code" onClose={onClose}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 font-body text-sm text-warning">The office checks every delivery done this way. Ask the customer to show you the code if they can, it is much quicker.</p>

        <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <legend className="mb-1 font-display text-sm font-semibold">Why can&apos;t they give the code?</legend>
          {FALLBACK_REASONS.map(([value, label]) => (
            <label key={value} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 font-body text-sm", reason === value ? "border-white bg-white/10" : "border-border")}>
              <input type="radio" name="fallback-reason" className="size-5 accent-white" checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <label htmlFor="received-by" className="font-display text-sm font-semibold">
            Name of the person who received it
          </label>
          <input id="received-by" value={who} onChange={(e) => setWho(e.target.value)} maxLength={60} autoComplete="off" className="h-12 rounded-2xl border border-border bg-card px-4 font-body text-base focus:outline-none focus:ring-2 focus:ring-ring" />
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="font-display text-sm font-semibold">Take a photo of the parcel with the person</p>
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
          <p role="alert" className={alertBox}>
            {error}
          </p>
        )}
        <button type="button" disabled={!valid} onClick={() => void complete()} className={primary}>
          {submitting ? "Completing…" : "Complete delivery"}
        </button>
        <p className="text-center font-body text-xs text-muted-foreground">We also record where you are, to check the delivery.</p>
      </div>
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
    <Sheet title={`Can't deliver ${d.code}`} subtitle="Tell the office why. Keep the parcel with you until they call." onClose={onClose}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <legend className="mb-1 font-display text-sm font-semibold">What happened?</legend>
          {FAIL_REASONS.map(([value, label]) => (
            <label key={value} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 font-body text-sm", reason === value ? "border-white bg-white/10" : "border-border")}>
              <input type="radio" name="fail-reason" className="size-5 accent-white" checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <label htmlFor="fail-note" className="font-display text-sm font-semibold">
            Note {reason === "other" ? "(required)" : "(optional)"}
          </label>
          <textarea id="fail-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className="rounded-2xl border border-border bg-card p-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="For example: called three times, no answer" />
        </div>
        {error && (
          <p role="alert" className={alertBox}>
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
