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
  haversineKm,
  suggestOrder,
  telLink,
  type AvailableOrder,
  type RiderDelivery,
} from "@/lib/delivery";
import { GEO_HELP, locate } from "@/lib/geo";
import { HelpCenter } from "@/components/help/HelpCenter";
import { RIDER_GUIDE } from "@/lib/help";
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

type Offer = { offer_id: string; order_id: string; code: string; warehouse: { name: string; address: string }; pickup_m: number | null; delivery_km: number | null; seconds_left: number };
type OfferState = { auto: boolean; online: boolean; offer: Offer | null };
const PING_EVERY_MS = 30_000;

// ---------- small pieces ----------

const primary =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-display text-base font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50";
const secondary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/40 px-4 font-body text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50";
const quiet = "min-h-11 px-3 font-body text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50";
const alertBox = "rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive";

function Card({ children, tone }: { children: ReactNode; tone?: "warn" | undefined }) {
  return <li className={cn("list-none min-w-0 rounded-3xl border bg-card p-4 sm:p-5", tone === "warn" ? "border-warning/40" : "border-border")}>{children}</li>;
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
  const [auto, setAuto] = useState(false); // is auto-assign switched on? (then the Online switch shows)
  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [locNote, setLocNote] = useState("");
  const [, tick] = useState(0);
  const alive = useRef(true);
  const { items: notes, unread, loaded: notesLoaded } = useNotifications();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [a, m, o] = await Promise.all([call<AvailableOrder[]>("rider_available_orders"), call<RiderDelivery[]>("rider_my_deliveries"), call<OfferState>("rider_my_offer")]);
    if (!alive.current) return;
    setRefreshing(false);
    if (o.data) {
      setAuto(o.data.auto === true);
      setOnline(o.data.online === true);
      setOffer(o.data.offer ?? null);
    } else {
      setAuto(false); // a database that does not have offers yet is not an error: the rest works as before
      setOffer(null);
    }
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

  const goOnline = async (on: boolean) => {
    setOnlineBusy(true);
    setLocNote("");
    if (on) {
      const where = await locate({ quick: true });
      const r = await call<{ ok: boolean }>("rider_set_online", { p_online: true, p_lat: where.ok ? where.where.lat : null, p_lng: where.ok ? where.where.lng : null, p_accuracy: where.ok ? where.where.accuracy : null });
      if (r.error) toast.error(r.error);
      else {
        setOnline(true);
        if (!where.ok) setLocNote(`You are online, but we cannot see where you are, so you will not be offered orders. ${GEO_HELP[where.reason]}`);
      }
    } else {
      const r = await call<{ ok: boolean }>("rider_set_online", { p_online: false });
      if (r.error) toast.error(r.error);
      else {
        setOnline(false);
        setOffer(null);
      }
    }
    setOnlineBusy(false);
    void refresh();
  };

  // While online and looking at the app, say where we are now and then. A phone that is locked or a page that is closed stops, so the office
  // stops offering that rider anything: nobody is offered an order they cannot see.
  useEffect(() => {
    if (!online || !auto) return;
    let stop = false;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      const where = await locate({ quick: true });
      if (stop) return;
      if (!where.ok) {
        setLocNote(`We cannot see where you are, so you will not be offered orders. ${GEO_HELP[where.reason]}`);
        return;
      }
      setLocNote("");
      const r = await call<{ ok: boolean; online: boolean }>("rider_ping", { p_lat: where.where.lat, p_lng: where.where.lng, p_accuracy: where.where.accuracy });
      if (!stop && r.data && r.data.online === false) setOnline(false);
    };
    const timer = setInterval(() => void ping(), PING_EVERY_MS);
    const wake = () => void ping();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [online, auto]);

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
    if (online) await call("rider_set_online", { p_online: false });
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
          {auto && (
            <button
              type="button"
              role="switch"
              aria-checked={online}
              aria-label={online ? "Online: tap to go offline" : "Offline: tap to go online"}
              disabled={onlineBusy}
              onClick={() => void goOnline(!online)}
              className={cn("flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 font-body text-sm font-medium transition-colors disabled:opacity-60", online ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground")}
            >
              <span aria-hidden className={cn("size-2.5 rounded-full", online ? "bg-primary" : "bg-muted-foreground/60")} />
              {onlineBusy ? "…" : online ? "Online" : "Offline"}
            </button>
          )}
          <button type="button" onClick={() => setHelp(true)} aria-label="Help" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <i aria-hidden className="bx bx-help-circle text-2xl" />
          </button>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <i aria-hidden className={cn("bx bx-refresh text-2xl", refreshing && "animate-spin")} />
          </button>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <i aria-hidden className="bx bx-log-out text-2xl" />
          </button>
        </div>
      </header>

      {help && <RiderHelp onClose={() => setHelp(false)} />}

      <main className="mx-auto max-w-xl px-4 pt-4">
        {loadError && (
          <p role="alert" className={cn(alertBox, "mb-4")}>
            {loadError}
          </p>
        )}
        {offer && <OfferCard key={offer.offer_id} offer={offer} onDone={() => void refresh()} onTook={() => setTab("mine")} />}
        {auto && online && locNote && (
          <p role="status" className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 font-body text-sm text-warning">
            {locNote}
          </p>
        )}
        {shown === "alerts" ? (
          <Alerts />
        ) : !loaded && !loadError ? (
          <p className="py-16 text-center font-body text-sm text-muted-foreground">Loading…</p>
        ) : shown === "available" ? (
          <AvailableList orders={available} onChanged={refresh} onTook={() => setTab("mine")} />
        ) : shown === "mine" ? (
          <MyDeliveries active={active} onChanged={refresh} />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Done today">
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

/** The rider guide, over the whole screen. Escape or the close button brings the rider back to exactly where they were. */
function RiderHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={RIDER_GUIDE.title} className="fixed inset-0 z-[60] overflow-y-auto bg-background text-foreground">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{RIDER_GUIDE.title}</h2>
          <p className="truncate font-body text-xs text-muted-foreground">{RIDER_GUIDE.subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the guide" className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <i aria-hidden className="bx bx-x text-3xl" />
        </button>
      </div>
      <div className="mx-auto max-w-xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5">
        <HelpCenter guide={RIDER_GUIDE} heading={false} />
      </div>
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

// ---------- an order offered to this rider ----------

function OfferCard({ offer, onDone, onTook }: { offer: Offer; onDone: () => void; onTook: () => void }) {
  const [until] = useState(() => Date.now() + offer.seconds_left * 1000);
  const [left, setLeft] = useState(offer.seconds_left);
  const [busy, setBusy] = useState(false);
  const total = useRef(Math.max(1, offer.seconds_left));
  const again = useRef(onDone);
  again.current = onDone;
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        again.current(); // the time is up: the office moves it on to the next rider, so look again
      }
    }, 1000);
    return () => clearInterval(t);
  }, [until]);

  const answer = async (accept: boolean) => {
    setBusy(true);
    const r = await call<{ ok: boolean; reason?: string }>("rider_respond_offer", { p_offer: offer.offer_id, p_accept: accept });
    setBusy(false);
    if (r.error) toast.error(r.error);
    else if (accept && r.data?.ok) {
      toast.success(`${offer.code} is yours. Collect it first.`);
      onTook();
    } else if (accept) toast.error("That offer is gone: it ran out of time or was given to someone else.");
    onDone();
  };
  const near = offer.pickup_m === null ? null : offer.pickup_m < 1000 ? `${Math.max(50, Math.round(offer.pickup_m / 50) * 50)} m` : `${(offer.pickup_m / 1000).toFixed(1)} km`;
  return (
    <section aria-label="New order for you" className="mb-4 rounded-3xl border-2 border-primary bg-primary/10 p-4 shadow-[var(--glow-primary)]">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-primary px-2.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-primary-foreground">New order for you</span>
        <span className="font-display text-lg font-semibold tabular-nums" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
          {left}s
        </span>
      </div>
      <p className="mt-2 font-display text-4xl font-semibold leading-none tracking-tight">{offer.code}</p>
      <p className="mt-2 font-body text-base">
        Collect at <span className="font-semibold">{offer.warehouse.name}</span>
        {near && <span className="text-muted-foreground"> · you are {near} away</span>}
      </p>
      {offer.delivery_km !== null && <p className="font-body text-sm text-muted-foreground">Then about {offer.delivery_km} km to the customer</p>}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/20" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${Math.round((left / total.current) * 100)}%` }} />
      </div>
      <button type="button" disabled={busy || left === 0} onClick={() => void answer(true)} className={cn(primary, "mt-4")}>
        {busy ? "…" : "Accept"}
      </button>
      <button type="button" disabled={busy || left === 0} onClick={() => void answer(false)} className={cn(quiet, "mt-1 w-full")}>
        Not now
      </button>
    </section>
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
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Available orders">
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

// ---------- my deliveries: a short queue, one decision at a time ----------
// What a rider needs, at a glance: which parcels to collect and where, then the stops in a sensible order with the next one open.
// Each state shows its own few things (the code and the name big, one way to get there, one way to call, one big action) and the rest hides under "More".

type Group = { key: string; name: string; address: string; phone: string; lat: number | null; lng: number | null; parcels: RiderDelivery[] };

function groupByWarehouse(list: RiderDelivery[]): Group[] {
  const groups = new Map<string, Group>();
  for (const d of list) {
    const w = d.warehouse;
    const key = `${w?.name ?? ""}|${w?.address ?? ""}`;
    const g = groups.get(key) ?? { key, name: w?.name ?? "The warehouse", address: w?.address ?? "", phone: w?.phone ?? "", lat: w?.lat ?? null, lng: w?.lng ?? null, parcels: [] };
    g.parcels.push(d);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function MyDeliveries({ active, onChanged }: { active: RiderDelivery[]; onChanged: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toCollect = active.filter((d) => d.status === "assigned");
  const held = active.filter((d) => d.status === "picked_up").sort((a, b) => (a.picked_up_at ?? "").localeCompare(b.picked_up_at ?? ""));
  const origin = held[0]?.warehouse && held[0].warehouse.lat !== null && held[0].warehouse.lng !== null ? { lat: held[0].warehouse.lat, lng: held[0].warehouse.lng } : null;
  const stops = suggestOrder(held, origin);
  const open = openId && stops.some((s) => s.order_id === openId) ? openId : stops[0]?.order_id;
  const groups = groupByWarehouse(toCollect);

  if (active.length === 0) {
    return (
      <ul className="grid gap-4" aria-label="My deliveries">
        <Empty icon="bx-package" title="Nothing on your hands" body="Take an order from Available and it shows up here." />
      </ul>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {active.length > 1 && (
        <p className="font-body text-sm text-muted-foreground" aria-live="polite">
          {[stops.length > 0 && `${stops.length} to deliver`, toCollect.length > 0 && `${toCollect.length} to collect`].filter(Boolean).join(" · ")}
        </p>
      )}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="My deliveries">
        {stops.map((d, i) => (
          <DeliverStop key={d.order_id} d={d} index={i} total={stops.length} open={d.order_id === open} onOpen={() => setOpenId(d.order_id)} onChanged={onChanged} />
        ))}
        {groups.map((g) => (
          <CollectGroup key={g.key} group={g} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

const chip = (tone: "info" | "success" | "warning", text: string) => (
  <span className={cn("rounded-full px-2.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider", tone === "info" ? "bg-info/15 text-info" : tone === "success" ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{text}</span>
);

/** The "more" things, out of the way: a few small words, never a button the rider can press by mistake while driving. */
function More({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div className="grid gap-1">
      <button type="button" aria-expanded={on} onClick={() => setOn((v) => !v)} className={cn(quiet, "mx-auto flex items-center gap-1")}>
        More <i aria-hidden className={cn("bx text-lg", on ? "bx-chevron-up" : "bx-chevron-down")} />
      </button>
      {on && <div className="grid gap-1 rounded-2xl border border-border p-2">{children}</div>}
    </div>
  );
}

// ----- the route, as a line of places: where you have been, where you are going -----

type Node = { state: "done" | "now" | "next"; title: ReactNode; sub?: ReactNode; extra?: ReactNode; aside?: ReactNode };

const clock = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
/** The straight-line distance from the warehouse to the customer, which is all a phone can say without a map service. */
const legLabel = (d: RiderDelivery): string | null => {
  const w = d.warehouse;
  if (!w || w.lat === null || w.lng === null || d.lat === null || d.lng === null) return null;
  const km = haversineKm({ lat: w.lat, lng: w.lng }, { lat: d.lat, lng: d.lng });
  return km < 1 ? "Under 1 km" : `About ${km.toFixed(1)} km`;
};

function Timeline({ nodes }: { nodes: Node[] }) {
  return (
    <ol className="grid" aria-label="Route">
      {nodes.map((n, i) => (
        <li key={i} aria-current={n.state === "now" ? "step" : undefined} className="relative flex gap-3">
          <span className="flex w-6 shrink-0 flex-col items-center">
            {n.state === "done" ? (
              <span className="grid size-6 place-items-center rounded-full bg-success/20 text-success">
                <i aria-hidden className="bx bx-check text-lg" />
              </span>
            ) : n.state === "now" ? (
              <span className="grid size-6 place-items-center rounded-full border-2 border-white">
                <span className="size-2.5 rounded-full bg-white" />
              </span>
            ) : (
              <span className="size-6 rounded-full border-2 border-dashed border-muted-foreground/50" />
            )}
            {i < nodes.length - 1 && <span aria-hidden className="my-1 w-0 flex-1 border-l-2 border-dashed border-border" />}
          </span>
          <div className={cn("min-w-0 flex-1", i < nodes.length - 1 && "pb-4")}>
            <div className="flex items-start justify-between gap-3">
              <p className={cn("min-w-0 font-display leading-tight", n.state === "now" ? "text-xl font-semibold" : "text-base", n.state === "next" ? "text-muted-foreground" : n.state === "done" ? "text-muted-foreground" : "")}>{n.title}</p>
              {n.aside && <span className="shrink-0 font-body text-xs text-muted-foreground">{n.aside}</span>}
            </div>
            {n.sub && <p className={cn("mt-0.5 font-body text-sm text-muted-foreground", n.state === "now" && "line-clamp-2 text-base")}>{n.sub}</p>}
            {n.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A round call button: one thumb, no words to read. */
const CallRound = ({ phone, who }: { phone: string; who: string }) => (
  <a href={telLink(phone)} aria-label={`Call ${who}`} className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-secondary/40 hover:bg-secondary">
    <i aria-hidden className="bx bx-phone text-2xl" />
  </a>
);

// ----- collecting: every parcel from one warehouse, in one slide -----

function CollectGroup({ group, onChanged }: { group: Group; onChanged: () => Promise<void> }) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [backId, setBackId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = group.parcels.filter((p) => !skipped.has(p.order_id));
  const n = chosen.length;

  const collect = async () => {
    setBusy(true);
    let done = 0;
    let failure = "";
    for (const p of chosen) {
      const r = await call<{ ok: boolean }>("rider_mark_picked_up", { p_order_id: p.order_id });
      if (r.error) {
        failure = r.error;
        break;
      }
      done += 1;
    }
    setBusy(false);
    if (failure) toast.error(done > 0 ? `${done} collected, then: ${failure}` : failure);
    else toast.success(`${done === 1 ? chosen[0]!.code : `${done} parcels`} collected. Now deliver ${done === 1 ? "it" : "them"}.`);
    await onChanged();
  };
  const giveBack = async (p: RiderDelivery) => {
    setBusy(true);
    const r = await call<{ ok: boolean }>("rider_release_order", { p_order_id: p.order_id });
    setBusy(false);
    setBackId(null);
    if (r.error) toast.error(r.error);
    else toast.success(`${p.code} was given back.`);
    await onChanged();
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        {chip("warning", "Collect")}
        <span className="font-body text-xs text-muted-foreground">
          {group.parcels.length} parcel{group.parcels.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4">
        <Timeline
          nodes={[
            { state: "now", title: group.name, sub: group.address || undefined },
            { state: "next", title: group.parcels.length === 1 ? "The customer" : "The customers", sub: "Their names and addresses appear once you have collected" },
          ]}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <a href={navigateLink({ lat: group.lat, lng: group.lng, text: group.address || group.name })} target="_blank" rel="noreferrer" className={cn(secondary, "min-h-14 flex-1")}>
          <i aria-hidden className="bx bx-navigation text-xl" /> Navigate
        </a>
        {group.phone && <CallRound phone={group.phone} who={group.name} />}
      </div>

      <fieldset className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <legend className="mb-1 font-body text-xs text-muted-foreground">Take the parcel with each of these codes</legend>
        {group.parcels.map((p) => (
          <label key={p.order_id} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 transition-colors", skipped.has(p.order_id) ? "border-border opacity-60" : "border-white/70 bg-white/5")}>
            <input
              type="checkbox"
              className="size-6 accent-white"
              checked={!skipped.has(p.order_id)}
              onChange={() =>
                setSkipped((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.order_id)) next.delete(p.order_id);
                  else next.add(p.order_id);
                  return next;
                })
              }
            />
            <span className="font-display text-2xl font-semibold tracking-tight">{p.code}</span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4">
        <SlideToConfirm label={n === 0 ? "Tick a parcel first" : `Slide: I have ${n === 1 ? "the parcel" : `${n} parcels`}`} disabled={n === 0 || busy} onConfirm={collect} />
      </div>

      <div className="mt-2">
        <More>
          {group.parcels.map((p) =>
            backId === p.order_id ? (
              <div key={p.order_id} className="flex items-center justify-between gap-2 px-2 font-body text-sm">
                <span>Give {p.code} back?</span>
                <span className="flex">
                  <button type="button" className={quiet} onClick={() => setBackId(null)}>
                    No
                  </button>
                  <button type="button" disabled={busy} className={cn(quiet, "text-destructive")} onClick={() => void giveBack(p)}>
                    Yes, give it back
                  </button>
                </span>
              </div>
            ) : (
              <button key={p.order_id} type="button" className={cn(quiet, "text-left")} onClick={() => setBackId(p.order_id)}>
                Give {p.code} back
              </button>
            ),
          )}
        </More>
      </div>
    </Card>
  );
}

/**
 * Slide to confirm: the one step nobody can take back by mistake (it tells the customer their order is on the way). A tap does nothing,
 * so a pocket or a bump cannot do it; and for anyone who cannot slide, pressing Enter on the handle does the same.
 */
export function SlideToConfirm({ label, disabled, onConfirm }: { label: string; disabled?: boolean | undefined; onConfirm: () => void | Promise<void> }) {
  const HANDLE = 56;
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);
  const [x, setXState] = useState(0);
  const here = useRef(0); // where the handle really is, updated at once: a fast flick can lift the finger before React has redrawn
  const setX = (v: number) => {
    here.current = v;
    setXState(v);
  };
  const [done, setDone] = useState(false);
  const room = () => Math.max(1, (track.current?.clientWidth || 320) - HANDLE - 8);

  const finish = async () => {
    if (disabled || done) return;
    setDone(true);
    setX(room());
    try {
      await onConfirm();
    } finally {
      setDone(false);
      setX(0);
    }
  };

  return (
    <div ref={track} className={cn("relative h-16 select-none overflow-hidden rounded-full border border-border bg-secondary/40", disabled && "opacity-50")}>
      <div aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: x + HANDLE + 4 }} />
      <span aria-hidden className="absolute inset-0 grid place-items-center pl-14 font-display text-sm font-semibold">
        {done ? "Saving…" : label}
      </span>
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void finish();
          }
        }}
        onPointerDown={(e) => {
          if (disabled || done) return;
          grab.current = e.clientX - here.current;
          (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (grab.current === null) return;
          setX(Math.max(0, Math.min(room(), e.clientX - grab.current)));
        }}
        onPointerUp={() => {
          if (grab.current === null) return;
          grab.current = null;
          if (here.current >= room() * 0.85) void finish();
          else setX(0);
        }}
        onPointerCancel={() => {
          grab.current = null;
          setX(0);
        }}
        style={{ transform: `translateX(${x}px)`, touchAction: "none", width: HANDLE, height: HANDLE }}
        className={cn("absolute left-1 top-1 grid place-items-center rounded-full bg-primary text-primary-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", grab.current === null && "transition-transform duration-200 motion-reduce:transition-none")}
      >
        <i aria-hidden className="bx bx-chevrons-right text-3xl" />
      </button>
    </div>
  );
}

// ----- delivering: the stops, nearest first, the next one open -----

function DeliverStop({ d, index, total, open, onOpen, onChanged }: { d: RiderDelivery; index: number; total: number; open: boolean; onOpen: () => void; onChanged: () => Promise<void> }) {
  const [sheet, setSheet] = useState<null | "code" | "photo" | "fail">(null);
  const w = d.warehouse;
  const finished = async () => {
    setSheet(null);
    await onChanged();
  };

  if (!open) {
    return (
      <Card>
        <button type="button" aria-expanded={false} aria-label={`Open ${d.code}`} onClick={onOpen} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border font-display text-sm font-semibold">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold leading-tight">{d.code}</span>
            <span className="block truncate font-body text-sm text-muted-foreground">
              {d.customer_name}
              {d.location ? ` · ${d.location}` : ""}
            </span>
          </span>
          <i aria-hidden className="bx bx-chevron-right text-2xl text-muted-foreground" />
        </button>
      </Card>
    );
  }

  const extra = [d.preferred_time, d.notes].filter(Boolean).join(" · ");
  const dist = legLabel(d);
  const customer = { lat: d.lat, lng: d.lng, text: d.location };
  const fromWarehouse = w ? routeLink({ lat: w.lat, lng: w.lng, text: w.address || w.name }, customer) : navigateLink(customer);
  const first = (d.customer_name ?? "").split(" ")[0] || "the customer";
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        {chip("success", "Deliver")}
        <span className="font-body text-xs text-muted-foreground">{index === 0 ? "Next stop" : `Stop ${index + 1} of ${total}`}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-display text-4xl font-semibold leading-none tracking-tight">{d.code}</p>
        {dist && <span className="shrink-0 rounded-full bg-secondary px-3 py-1 font-body text-xs">{dist}</span>}
      </div>

      <div className="mt-4">
        <Timeline
          nodes={[
            { state: "done", title: `Collected at ${w?.name ?? "the warehouse"}`, aside: clock(d.picked_up_at) || undefined },
            {
              state: "now",
              title: d.customer_name,
              sub: d.location,
              extra: (
                <>
                  {extra && <p className="mt-1 font-body text-sm text-muted-foreground">{extra}</p>}
                  {d.lat === null && (
                    <p className="mt-1.5 flex items-center gap-1.5 font-body text-sm text-warning">
                      <i aria-hidden className="bx bx-error text-lg" /> No exact location: call them when you are close
                    </p>
                  )}
                </>
              ),
            },
          ]}
        />
      </div>

      <div className="mt-3 flex gap-2">
        {/* The route starts where the parcel was collected, not where the phone happens to be. */}
        <a href={fromWarehouse} target="_blank" rel="noreferrer" className={cn(secondary, "min-h-14 flex-1")}>
          <i aria-hidden className="bx bx-navigation text-xl" /> Navigate
        </a>
        {d.phone && <CallRound phone={d.phone} who={first} />}
      </div>
      <button type="button" onClick={() => setSheet("code")} className={cn(primary, "mt-3")}>
        I am here: enter the code
      </button>

      <div className="mt-1">
        <More>
          <button type="button" className={cn(quiet, "text-left")} onClick={() => setSheet("photo")}>
            The customer can&apos;t give the code
          </button>
          <a href={navigateLink(customer)} target="_blank" rel="noreferrer" className={cn(quiet, "flex items-center")}>
            Navigate from where I am now
          </a>
          <button type="button" className={cn(quiet, "text-left")} onClick={() => setSheet("fail")}>
            I can&apos;t deliver this order
          </button>
        </More>
      </div>

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
    <Sheet title={`Deliver ${d.code}`} subtitle={[d.customer_name, d.location].filter(Boolean).join(" · ") || undefined} onClose={onClose}>
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
              Never tell them the code.{attemptsLeft < 5 ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.` : ""}
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
