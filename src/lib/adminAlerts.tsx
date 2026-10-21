import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export type Level = "green" | "orange" | "red";
export type Alert = { level: Level; count: number; label: string };
export type AdminAlerts = { orders: Alert; inventory: Alert; inbox: Alert; worst: Level };

const LOW_STOCK = 5;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CLEAR: Alert = { level: "green", count: 0, label: "All clear" };
const EMPTY: AdminAlerts = { orders: CLEAR, inventory: CLEAR, inbox: CLEAR, worst: "green" };
const RANK: Record<Level, number> = { green: 0, orange: 1, red: 2 };

const toneStyle = (cssVar: string, fallback: string) =>
  ({
    "--toast-border": `color-mix(in oklab, var(${cssVar}, ${fallback}) 55%, transparent)`,
    "--toast-glow": `var(${cssVar}, ${fallback})`,
    "--toast-icon": `var(${cssVar}, ${fallback})`,
    "--toast-action": `var(${cssVar}, ${fallback})`,
    "--toast-action-fg": "#111111",
  }) as CSSProperties;

async function compute(): Promise<AdminAlerts | null> {
  const [pend, oldest, out, low, convs] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("fulfilment_status", "confirmed"),
    supabase
      .from("orders")
      .select("created_at")
      .eq("fulfilment_status", "confirmed")
      .order("created_at", { ascending: true })
      .limit(1),
    supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null).lte("stock", 0),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .gt("stock", 0)
      .lte("stock", LOW_STOCK),
    // Customers waiting: chats that are open and whose last message came from the customer (migration 000018).
    supabase
      .from("conversations")
      .select("waiting_since", { count: "exact" })
      .eq("status", "open")
      .eq("needs_reply", true)
      .order("waiting_since", { ascending: true })
      .limit(1),
  ]);
  if (pend.error || oldest.error || out.error || low.error) return null;

  const now = Date.now();

  const pendingCount = pend.count ?? 0;
  const oldestAt = (oldest.data?.[0] as { created_at?: string } | undefined)?.created_at;
  const orders: Alert =
    pendingCount === 0
      ? { level: "green", count: 0, label: "Nothing to dispatch" }
      : {
          level: oldestAt && now - new Date(oldestAt).getTime() > DAY ? "red" : "orange",
          count: pendingCount,
          label: `${pendingCount} order${pendingCount === 1 ? "" : "s"} ready to dispatch`,
        };

  const outCount = out.count ?? 0;
  const lowCount = low.count ?? 0;
  const inventory: Alert =
    outCount > 0
      ? {
          level: "red",
          count: outCount + lowCount,
          label: `${outCount} out of stock${lowCount > 0 ? `, ${lowCount} running low` : ""}`,
        }
      : lowCount > 0
        ? { level: "orange", count: lowCount, label: `${lowCount} running low` }
        : { level: "green", count: 0, label: "Stock is healthy" };

  let waitingCount = 0;
  let oldestWait = Infinity;
  if (!convs.error) {
    waitingCount = convs.count ?? 0;
    const since = (convs.data?.[0] as { waiting_since?: string | null } | undefined)?.waiting_since;
    if (since) oldestWait = new Date(since).getTime();
  } else {
    // The database has not been updated yet (migration 000018): look at the last message of each chat instead.
    const legacy = await supabase
      .from("conversations")
      .select("id, messages(sender_role, created_at)")
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" })
      .limit(100);
    for (const r of (legacy.data ?? []) as unknown as { messages: { sender_role: string; created_at: string }[] }[]) {
      const m = r.messages[0];
      if (m && m.sender_role === "client") {
        waitingCount += 1;
        oldestWait = Math.min(oldestWait, new Date(m.created_at).getTime());
      }
    }
  }
  const inbox: Alert =
    waitingCount === 0
      ? { level: "green", count: 0, label: "Everyone has been answered" }
      : {
          level: now - oldestWait > HOUR ? "red" : "orange",
          count: waitingCount,
          label: `${waitingCount} customer${waitingCount === 1 ? "" : "s"} waiting for a reply`,
        };

  const worst = ([orders, inventory, inbox] as Alert[]).reduce<Level>(
    (w, a) => (RANK[a.level] > RANK[w] ? a.level : w),
    "green",
  );
  return { orders, inventory, inbox, worst };
}

export function useAdminAlerts(enabled: boolean): AdminAlerts {
  const [alerts, setAlerts] = useState<AdminAlerts>(EMPTY);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let live = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const next = await compute();
        if (next && !cancelled) setAlerts(next);
      } catch {
        /* keep the last alerts */
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 400);
    };
    void refresh().then(() => {
      live = true;
    });

    const channel = supabase
      .channel("admin-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        schedule();
        if (!live || pathRef.current.startsWith("/admin/orders") || (payload.new as { stock_reserved?: boolean }).stock_reserved) return;
        const o = payload.new as unknown as { code?: string; customer_name?: string; total?: number };
        toast(`New order ${o.code ?? ""}`.trim(), {
          description: `${o.customer_name ?? "A customer"}${o.total ? ` · ${money(o.total)}` : ""}`,
          icon: <i className="bx bx-receipt text-xl" />,
          style: toneStyle("--warning", "#f59e0b"),
          action: { label: "View", onClick: () => void navigate({ to: "/admin/orders" }) },
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => schedule())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        schedule();
        const m = payload.new as unknown as { sender_role?: string; body?: string };
        if (!live || m.sender_role !== "client" || pathRef.current.startsWith("/admin/inbox")) return;
        const body = m.body ?? "";
        toast("New customer message", {
          description: body.length > 80 ? `${body.slice(0, 77)}…` : body,
          icon: <i className="bx bx-conversation text-xl" />,
          style: toneStyle("--warning", "#f59e0b"),
          action: { label: "Open", onClick: () => void navigate({ to: "/admin/inbox" }) },
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, () => schedule())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, () => schedule())
      .subscribe();

    // Re-check every minute so "waiting too long" turns red without needing an event.
    const tick = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [enabled, navigate]);

  return alerts;
}
