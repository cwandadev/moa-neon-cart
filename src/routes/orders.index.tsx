import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Header } from "@/components/shop/Header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { fetchProduct } from "@/lib/catalog";
import { useNotifications } from "@/lib/notifications";
import { canRemove, refundNote, STAGE, stageOf, type Stage } from "@/lib/orderStage";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { lineProductFor } from "@/lib/variants";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orders/")({
  head: () => ({ meta: [{ title: "My orders — MOA Mart" }] }),
  component: MyOrders,
});

type Item = {
  product_id: string | null;
  variant_id: string | null;
  name: string;
  image: string | null;
  qty: number;
  variant_label: string | null;
};
type Row = {
  id: string;
  code: string;
  created_at: string;
  total: number;
  payment_status: string;
  fulfilment_status: string;
  refund_status: string | null;
  reserved_until: string | null;
  order_items: Item[];
};
type Filter = "all" | "to_pay" | "preparing" | "on_the_way" | "delivered" | "closed";

const FILTERS: { id: Filter; label: string; icon: string }[] = [
  { id: "all", label: "All orders", icon: "bx-list-ul" },
  { id: "to_pay", label: "To pay", icon: "bx-time-five" },
  { id: "preparing", label: "Preparing", icon: "bx-package" },
  { id: "on_the_way", label: "On the way", icon: "bx-trip" },
  { id: "delivered", label: "Delivered", icon: "bx-check-circle" },
  { id: "closed", label: "Cancelled", icon: "bx-x-circle" },
];

const inFilter = (s: Stage, f: Filter) =>
  f === "all" ? true : f === "closed" ? s === "cancelled" || s === "expired" : s === f;

const STEPS = ["Placed", "Paid", "On the way", "Delivered"];
const PAGE = 10;

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function minutesLeft(until: string | null, now: number): number | null {
  if (!until) return null;
  return Math.ceil((new Date(until).getTime() - now) / 60000);
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="font-body">{text}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="glass" className="h-11 rounded-xl" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant={danger ? "destructive" : "neon"}
            className="h-11 rounded-xl"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground"
      >
        <i className="bx bx-dots-horizontal-rounded text-xl" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const menuItem =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors hover:bg-secondary";

function Progress({ step }: { step: number }) {
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-secondary")} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-body text-[11px] text-muted-foreground">
        {STEPS.map((s, i) => (
          <span key={s} className={cn(i === step && "font-medium text-foreground")}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The buttons at the bottom of an order: the main action and the "..." menu. */
function CardActions({
  o,
  stage,
  canHide,
  busy,
  onRemove,
  onCancel,
  onBuyAgain,
}: {
  o: Row;
  stage: Stage;
  canHide: boolean;
  busy: boolean;
  onRemove: (o: Row) => void;
  onCancel: (o: Row) => void;
  onBuyAgain: (o: Row) => void;
}) {
  const navigate = useNavigate();
  const open = () => void navigate({ to: "/orders/$orderId", params: { orderId: o.code } });
  return (
    <div className="flex items-center gap-2">
      {stage === "to_pay" ? (
        <Button variant="neon" className="h-10 flex-1 rounded-xl" onClick={open}>
          Pay now
        </Button>
      ) : stage === "preparing" || stage === "on_the_way" ? (
        <Button variant="glass" className="h-10 flex-1 rounded-xl" onClick={open}>
          Track order
        </Button>
      ) : (
        <Button variant="neon" className="h-10 flex-1 rounded-xl" disabled={busy} onClick={() => onBuyAgain(o)}>
          {busy ? "Adding…" : "Buy again"}
        </Button>
      )}
      <RowMenu>
        {(close) => (
          <>
            <Link to="/orders/$orderId" params={{ orderId: o.code }} onClick={close} className={menuItem}>
              <i className="bx bx-show text-lg" /> View details
            </Link>
            {stage === "to_pay" && (
              <button
                type="button"
                className={cn(menuItem, "text-destructive")}
                onClick={() => {
                  close();
                  onCancel(o);
                }}
              >
                <i className="bx bx-x-circle text-lg" /> Cancel this order
              </button>
            )}
            {canRemove(stage) && canHide && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onRemove(o);
                }}
              >
                <i className="bx bx-trash text-lg" /> Remove from my list
              </button>
            )}
          </>
        )}
      </RowMenu>
    </div>
  );
}

type CardProps = {
  o: Row;
  now: number;
  canHide: boolean;
  onRemove: (o: Row) => void;
  onCancel: (o: Row) => void;
  onBuyAgain: (o: Row) => void;
  busy: boolean;
};

const itemCount = (o: Row) => o.order_items.reduce((n, i) => n + i.qty, 0);

/** Phones: one order per row. */
function OrderCard({ o, now, canHide, onRemove, onCancel, onBuyAgain, busy }: CardProps) {
  const stage = stageOf(o);
  const meta = STAGE[stage];
  const left = stage === "to_pay" ? minutesLeft(o.reserved_until, now) : null;
  const first = o.order_items[0];
  const more = o.order_items.length - 1;
  const note = refundNote(o);
  const photos = o.order_items.filter((i) => i.image).slice(0, 3);
  const n = itemCount(o);

  return (
    <li
      className={cn(
        "rounded-2xl border bg-card/60 p-4 transition-colors hover:border-primary/40",
        stage === "to_pay" ? "border-warning/40" : "border-border",
      )}
    >
      <Link to="/orders/$orderId" params={{ orderId: o.code }} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-body text-sm font-medium text-primary">{o.code}</p>
            <p className="font-body text-xs text-muted-foreground">{dateText(o.created_at)}</p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 font-body text-[11px] font-medium", meta.pill)}>
            {meta.label}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="flex shrink-0">
            {photos.map((it, i) => (
              <img
                key={i}
                src={it.image ?? ""}
                alt=""
                decoding="async"
                className={cn("size-12 rounded-xl object-cover ring-2 ring-card", i > 0 && "-ml-3")}
              />
            ))}
          </span>
          <div className="min-w-0 flex-1 font-body">
            <p className="truncate text-sm">
              {first?.name}
              {first?.variant_label ? ` (${first.variant_label})` : ""}
              {more > 0 ? ` +${more} more` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {n} {n === 1 ? "item" : "items"}
              {note ? ` · ${note}` : ""}
            </p>
          </div>
          <p className="shrink-0 font-display text-sm font-semibold">{money(o.total)}</p>
        </div>

        {meta.step >= 0 && <Progress step={meta.step} />}
        {stage === "to_pay" && left !== null && (
          <p className="mt-3 flex items-center gap-1.5 font-body text-xs text-warning">
            <i className="bx bx-time-five text-sm" />
            {left > 0 ? `Pay within ${left} min to keep your items reserved` : "The time to pay is almost up"}
          </p>
        )}
      </Link>

      <div className="mt-4">
        <CardActions
          o={o}
          stage={stage}
          canHide={canHide}
          busy={busy}
          onRemove={onRemove}
          onCancel={onCancel}
          onBuyAgain={onBuyAgain}
        />
      </div>
    </li>
  );
}

/** A mosaic of the products in the order: 1, 2, 3 or 4 photos. */
function Mosaic({ items }: { items: Item[] }) {
  const imgs = items.filter((i) => i.image).map((i) => i.image as string);
  if (imgs.length === 0) {
    return (
      <div className="grid h-40 place-items-center bg-muted">
        <i className="bx bx-package text-4xl text-muted-foreground" />
      </div>
    );
  }
  const shown = imgs.slice(0, 4);
  const extra = items.length - 4;
  // Fixed row heights, so every photo fills its cell instead of showing at its natural height.
  const layout =
    shown.length === 1 ? "grid-cols-1 grid-rows-1" : shown.length === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-2";
  return (
    <div className={cn("grid h-40 gap-0.5 overflow-hidden bg-border", layout)}>
      {shown.map((u, i) => (
        <div key={i} className={cn("relative min-h-0 overflow-hidden", shown.length === 3 && i === 0 && "row-span-2")}>
          <img src={u} alt="" decoding="async" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
          {i === 3 && extra > 0 && (
            <span className="absolute inset-0 grid place-items-center bg-black/55 font-display text-lg font-semibold text-white">
              +{extra}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Desktop: a card in a three-across grid. */
function OrderTile({ o, now, canHide, onRemove, onCancel, onBuyAgain, busy }: CardProps) {
  const stage = stageOf(o);
  const meta = STAGE[stage];
  const left = stage === "to_pay" ? minutesLeft(o.reserved_until, now) : null;
  const first = o.order_items[0];
  const more = o.order_items.length - 1;
  const note = refundNote(o);
  const n = itemCount(o);

  return (
    <li
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card/60 transition-colors hover:border-primary/50",
        stage === "to_pay" ? "border-warning/50" : "border-border",
      )}
    >
      <Link to="/orders/$orderId" params={{ orderId: o.code }} className="flex flex-1 flex-col">
        <div className="relative">
          <Mosaic items={o.order_items} />
          <span className="absolute left-3 top-3 rounded-full bg-background/90 p-0.5 shadow-sm">
            <span className={cn("block rounded-full px-2.5 py-1 font-body text-[11px] font-medium", meta.pill)}>
              {meta.label}
            </span>
          </span>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-body text-sm font-medium text-primary">{o.code}</p>
            <p className="font-display text-base font-semibold">{money(o.total)}</p>
          </div>
          <p className="mt-0.5 font-body text-xs text-muted-foreground">
            {dateText(o.created_at)} · {n} {n === 1 ? "item" : "items"}
            {note ? ` · ${note}` : ""}
          </p>
          <p className="mt-2 truncate font-body text-sm">
            {first?.name}
            {first?.variant_label ? ` (${first.variant_label})` : ""}
            {more > 0 ? ` +${more} more` : ""}
          </p>

          {meta.step >= 0 && <Progress step={meta.step} />}
          {stage === "to_pay" && left !== null && (
            <p className="mt-3 flex items-center gap-1.5 font-body text-xs text-warning">
              <i className="bx bx-time-five text-sm" />
              {left > 0 ? `Pay within ${left} min` : "Time is almost up"}
            </p>
          )}
        </div>
      </Link>

      <div className="px-4 pb-4">
        <CardActions
          o={o}
          stage={stage}
          canHide={canHide}
          busy={busy}
          onRemove={onRemove}
          onCancel={onCancel}
          onBuyAgain={onBuyAgain}
        />
      </div>
    </li>
  );
}

function MyOrders() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const { addToCart, setCartOpen } = useStore();
  const { items: notifs } = useNotifications();
  const latestNotif = notifs[0]?.id ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canHide, setCanHide] = useState(true);
  const [filter, setFilter] = usePersistedState<Filter>("moa:orders:filter", "all");
  const [q, setQ] = usePersistedState("moa:orders:q", "");
  const [shown, setShown] = usePersistedState("moa:orders:shown", PAGE);
  const [now, setNow] = useState(() => Date.now());
  const [busyCode, setBusyCode] = useState("");
  const [cancelFor, setCancelFor] = useState<Row | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) {
        setRows([]);
        return;
      }
      const cols =
        "id, code, created_at, total, payment_status, fulfilment_status, refund_status, reserved_until, order_items(product_id, variant_id, name, image, qty, variant_label)";
      let res = await supabase
        .from("orders")
        .select(cols)
        .eq("user_id", uid)
        .eq("hidden_by_customer", false)
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error && /hidden_by_customer/.test(res.error.message)) {
        // The database update that adds "remove from my list" has not been run yet: show everything.
        setCanHide(false);
        res = await supabase
          .from("orders")
          .select(cols)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(200);
      } else {
        setCanHide(true);
      }
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
      setError("");
    } catch {
      setError("Could not load your orders. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on arrival, and again whenever a new notification arrives (payment received, order on its way...).
  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, user?.id, latestNotif, load]);

  const stages = useMemo(() => rows.map((r) => ({ r, s: stageOf(r) })), [rows]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, to_pay: 0, preparing: 0, on_the_way: 0, delivered: 0, closed: 0 };
    for (const { s } of stages) {
      c.all += 1;
      if (s === "cancelled" || s === "expired") c.closed += 1;
      else c[s] += 1;
    }
    return c;
  }, [stages]);

  const needle = q.trim().toLowerCase();
  const matches = (r: Row) =>
    !needle || r.code.toLowerCase().includes(needle) || r.order_items.some((i) => i.name.toLowerCase().includes(needle));

  const filtered = stages.filter(({ r, s }) => inFilter(s, filter) && matches(r));
  // In "All orders", the orders that wait for payment are pinned on top.
  const pinned = filter === "all" ? filtered.filter(({ s }) => s === "to_pay") : [];
  const rest = filter === "all" ? filtered.filter(({ s }) => s !== "to_pay") : filtered;
  const visible = rest.slice(0, shown);
  const clearable = stages.filter(({ s }) => s === "cancelled" || s === "expired").map(({ r }) => r);

  const hide = async (codes: string[], hidden: boolean) => {
    const { error: err } = await supabase.rpc("hide_my_orders", { p_codes: codes, p_hidden: hidden });
    if (err) {
      toast.error("Could not update your list. Please try again.");
      return false;
    }
    await load();
    return true;
  };

  const removeOne = async (o: Row) => {
    if (await hide([o.code], true)) {
      toast("Removed from your list", {
        description: o.code,
        action: { label: "Undo", onClick: () => void hide([o.code], false) },
      });
    }
  };

  const clearClosed = async () => {
    const codes = clearable.map((r) => r.code);
    if (codes.length === 0) return;
    if (await hide(codes, true)) {
      toast(`Removed ${codes.length} ${codes.length === 1 ? "order" : "orders"} from your list`, {
        action: { label: "Undo", onClick: () => void hide(codes, false) },
      });
    }
  };

  const cancelOrder = async (o: Row) => {
    const { error: err } = await supabase.rpc("cancel_my_unpaid_order", { p_code: o.code });
    if (err) {
      toast.error(err.message || "Could not cancel this order.");
      return;
    }
    toast("Order cancelled", { description: o.code });
    await load();
  };

  const buyAgain = async (o: Row) => {
    setBusyCode(o.code);
    let added = 0;
    const skipped: string[] = [];
    try {
      for (const it of o.order_items) {
        if (!it.product_id) {
          skipped.push(it.name);
          continue;
        }
        const p = await fetchProduct(it.product_id);
        if (!p) {
          skipped.push(it.name);
          continue;
        }
        const variants = p.variants ?? [];
        const variant = it.variant_id ? (variants.find((v) => v.id === it.variant_id) ?? null) : null;
        const hasOptions = variants.length > 0;
        const stock = hasOptions ? (variant?.stock ?? 0) : p.stock;
        if ((hasOptions && !variant) || stock <= 0) {
          skipped.push(it.name);
          continue;
        }
        addToCart(lineProductFor(p, variant), Math.min(it.qty, stock, 10));
        added += 1;
      }
    } catch {
      toast.error("Could not add these items. Please try again.");
      setBusyCode("");
      return;
    }
    setBusyCode("");
    if (added > 0) {
      toast.success(`Added ${added} ${added === 1 ? "item" : "items"} to your cart`, {
        ...(skipped.length > 0 ? { description: `No longer available: ${skipped.join(", ")}` } : {}),
        action: { label: "View cart", onClick: () => setCartOpen(true) },
      });
    } else {
      toast.error("These items are no longer available.");
    }
  };

  const pickFilter = (f: Filter) => {
    setFilter(f);
    setShown(PAGE);
  };

  const search = (
    <div className="relative">
      <i className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShown(PAGE);
        }}
        placeholder="Search order number or product"
        className="h-11 rounded-xl border-border bg-glass pl-10 font-body"
      />
      {q && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setQ("")}
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <i className="bx bx-x text-xl" />
        </button>
      )}
    </div>
  );

  const waiting = counts.to_pay;
  const cardProps = (r: Row): CardProps => ({
    o: r,
    now,
    canHide,
    busy: busyCode === r.code,
    onRemove: (o) => void removeOne(o),
    onCancel: setCancelFor,
    onBuyAgain: (o) => void buyAgain(o),
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-14 lg:pt-8">
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <aside className="lg:sticky lg:top-28">
            <h1 className="font-display text-2xl font-semibold tracking-tight">My orders</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {counts.all} {counts.all === 1 ? "order" : "orders"}
              {waiting > 0 ? ` · ${waiting} waiting for payment` : ""}
            </p>

            <div className="mt-4">{search}</div>

            {/* Phones: chips you can swipe sideways */}
            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pickFilter(f.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 font-body text-sm transition-colors",
                    filter === f.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {f.id === "all" ? "All" : f.label}
                  <span className="ml-1.5 text-xs opacity-70">{counts[f.id]}</span>
                </button>
              ))}
            </div>

            {/* Desktop: a list down the side */}
            <nav className="mt-5 hidden gap-1 lg:grid">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pickFilter(f.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm transition-colors",
                    filter === f.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  <i className={cn("bx text-lg", f.icon, filter === f.id && "text-primary")} />
                  <span className="flex-1">{f.label}</span>
                  <span className="text-xs opacity-70">{counts[f.id]}</span>
                </button>
              ))}
            </nav>

            {canHide && clearable.length > 0 && (
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                className="mt-4 hidden w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-left font-body text-sm text-muted-foreground transition-colors hover:text-foreground lg:flex"
              >
                <i className="bx bx-trash text-lg" /> Clear cancelled and expired ({clearable.length})
              </button>
            )}
          </aside>

          <section className="mt-5 min-w-0 lg:mt-0">
            {!user && rows.length > 0 && (
              <p className="mb-4 rounded-xl border border-border bg-card/60 p-3 font-body text-xs text-muted-foreground">
                You are not signed in, so these are the orders placed from this device.{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Log in
                </Link>{" "}
                to see your orders anywhere.
              </p>
            )}
            {error && <p className="mb-4 font-body text-sm text-destructive">{error}</p>}

            {loading ? (
              <ul className="grid gap-3 lg:grid-cols-2 lg:gap-5">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="h-36 animate-pulse rounded-2xl border border-border bg-card/40 lg:h-72" />
                ))}
              </ul>
            ) : counts.all === 0 && !error ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <i className="bx bx-package text-5xl text-muted-foreground" />
                <p className="mt-3 font-display text-base font-semibold">No orders yet</p>
                <p className="mt-1 font-body text-sm text-muted-foreground">When you order, it shows up here.</p>
                <Button variant="neon" className="mt-5 rounded-xl" onClick={() => void navigate({ to: "/" })}>
                  Browse the shop
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-14 text-center">
                <i className="bx bx-search-alt text-4xl text-muted-foreground" />
                <p className="mt-3 font-display text-base font-semibold">No orders match</p>
                <Button
                  variant="glass"
                  className="mt-4 rounded-xl"
                  onClick={() => {
                    setQ("");
                    pickFilter("all");
                  }}
                >
                  Show all orders
                </Button>
              </div>
            ) : (
              <>
                {pinned.length > 0 && (
                  <div className="mb-6">
                    <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-warning">
                      <i className="bx bx-error-circle text-lg" /> Waiting for your payment
                    </h2>
                    <ul className="grid gap-3 lg:hidden">
                    {pinned.map(({ r }) => (
                      <OrderCard key={r.id} {...cardProps(r)} />
                    ))}
                  </ul>
                  <ul className="hidden gap-5 lg:grid lg:grid-cols-2">
                    {pinned.map(({ r }) => (
                      <OrderTile key={r.id} {...cardProps(r)} />
                    ))}
                  </ul>
                  </div>
                )}

                {rest.length > 0 && (
                  <>
                    {pinned.length > 0 && <h2 className="mb-2 font-display text-sm font-semibold">Earlier orders</h2>}
                    <ul className="grid gap-3 lg:hidden">
                    {visible.map(({ r }) => (
                      <OrderCard key={r.id} {...cardProps(r)} />
                    ))}
                  </ul>
                  <ul className="hidden gap-5 lg:grid lg:grid-cols-2">
                    {visible.map(({ r }) => (
                      <OrderTile key={r.id} {...cardProps(r)} />
                    ))}
                  </ul>
                    {rest.length > visible.length && (
                      <Button
                        variant="glass"
                        className="mt-4 h-11 w-full rounded-xl"
                        onClick={() => setShown((n) => n + PAGE)}
                      >
                        Show more ({rest.length - visible.length} left)
                      </Button>
                    )}
                  </>
                )}

                {canHide && clearable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setClearOpen(true)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 font-body text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
                  >
                    <i className="bx bx-trash text-lg" /> Clear cancelled and expired ({clearable.length})
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <ConfirmDialog
        open={cancelFor !== null}
        onOpenChange={(v) => {
          if (!v) setCancelFor(null);
        }}
        title="Cancel this order?"
        text={`${cancelFor?.code ?? "This order"} has not been paid. Cancelling frees the items.`}
        confirmLabel="Cancel order"
        danger
        onConfirm={() => cancelFor && void cancelOrder(cancelFor)}
      />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear cancelled and expired orders?"
        text={`${clearable.length} ${clearable.length === 1 ? "order is" : "orders are"} removed from your list. We keep our records, and you can undo this right after.`}
        confirmLabel="Clear them"
        onConfirm={() => void clearClosed()}
      />
    </div>
  );
}
