import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { popup, useToastSwipe } from "@/lib/swipeToasts";
import { supabase } from "@/lib/supabase";

export type Severity = "info" | "success" | "warning" | "critical";
export type Notif = {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

type Tone = { icon: string; text: string; bg: string; border: string; cssVar: string; fallback: string };

export const SEV: Record<Severity, Tone> = {
  info: { icon: "bx-info-circle", text: "text-info", bg: "bg-info/10", border: "border-info/40", cssVar: "--info", fallback: "#60a5fa" },
  success: { icon: "bx-check-circle", text: "text-success", bg: "bg-success/10", border: "border-success/40", cssVar: "--success", fallback: "#4ade80" },
  warning: { icon: "bx-error", text: "text-warning", bg: "bg-warning/10", border: "border-warning/40", cssVar: "--warning", fallback: "#f59e0b" },
  critical: { icon: "bx-error-circle", text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/40", cssVar: "--destructive", fallback: "#ef4444" },
};

const toneStyle = (t: Tone) =>
  ({
    "--toast-border": `color-mix(in oklab, var(${t.cssVar}, ${t.fallback}) 55%, transparent)`,
    "--toast-glow": `var(${t.cssVar}, ${t.fallback})`,
    "--toast-icon": `var(${t.cssVar}, ${t.fallback})`,
    "--toast-action": `var(${t.cssVar}, ${t.fallback})`,
    "--toast-action-fg": "#111111",
  }) as CSSProperties;

type State = { items: Notif[]; unread: number; loaded: boolean; canDismiss: boolean; hasMore: boolean; loadingMore: boolean };
let state: State = { items: [], unread: 0, loaded: false, canDismiss: true, hasMore: false, loadingMore: false };
const PAGE = 50;
const COLUMNS = "id, kind, severity, title, body, link, read_at, created_at";
const listeners = new Set<() => void>();

function setItems(items: Notif[], loaded = true) {
  state = { ...state, items, unread: items.filter((n) => !n.read_at).length, loaded };
  listeners.forEach((l) => l());
}

export function useNotifications(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => state,
  );
}

export async function markRead(id: string) {
  const now = new Date().toISOString();
  setItems(state.items.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)));
  await supabase.from("notifications").update({ read_at: now }).eq("id", id);
}

export async function markAllRead() {
  const now = new Date().toISOString();
  setItems(state.items.map((n) => (n.read_at ? n : { ...n, read_at: now })));
  await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
}

export async function markUnread(id: string) {
  setItems(state.items.map((n) => (n.id === id ? { ...n, read_at: null } : n)));
  await supabase.from("notifications").update({ read_at: null }).eq("id", id);
}

/** Mark several notifications as read, or as unread. Only the ones that change are saved. */
export async function markMany(ids: string[], read: boolean) {
  const targets = state.items.filter((n) => ids.includes(n.id) && (read ? !n.read_at : Boolean(n.read_at))).map((n) => n.id);
  if (targets.length === 0) return;
  const now = new Date().toISOString();
  setItems(state.items.map((n) => (targets.includes(n.id) ? { ...n, read_at: read ? now : null } : n)));
  await supabase.from("notifications").update({ read_at: read ? now : null }).in("id", targets);
}

/** Clear notifications from the list. They stay in the database until the nightly cleanup, so this can be undone. */
export async function dismiss(ids: string[]) {
  if (ids.length === 0) return;
  setItems(state.items.filter((n) => !ids.includes(n.id)));
  await supabase.from("notifications").update({ dismissed_at: new Date().toISOString() }).in("id", ids);
}

/** Load the next page of older notifications, for the Notifications page. */
export async function loadMore() {
  if (state.loadingMore || !state.hasMore) return;
  const oldest = state.items[state.items.length - 1]?.created_at;
  if (!oldest) return;
  state = { ...state, loadingMore: true };
  listeners.forEach((l) => l());
  try {
    let q = supabase.from("notifications").select(COLUMNS).order("created_at", { ascending: false }).lt("created_at", oldest).limit(PAGE);
    if (state.canDismiss) q = q.is("dismissed_at", null);
    const { data, error } = await q;
    const more = (error ? [] : data ?? []) as Notif[];
    const known = new Set(state.items.map((n) => n.id));
    state = { ...state, hasMore: !error && more.length >= PAGE };
    setItems([...state.items, ...more.filter((n) => !known.has(n.id))]);
  } finally {
    state = { ...state, loadingMore: false };
    listeners.forEach((l) => l());
  }
}

/** Undo a clear. */
export async function restore(back: Notif[]) {
  if (back.length === 0) return;
  const merged = [...state.items, ...back.filter((b) => !state.items.some((n) => n.id === b.id))];
  setItems(merged.sort((a, b) => b.created_at.localeCompare(a.created_at)));
  await supabase.from("notifications").update({ dismissed_at: null }).in("id", back.map((b) => b.id));
}

export function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Mounted once in the root layout: loads, listens live and shows toasts. */
export function NotificationsHost() {
  const navigate = useNavigate();
  useToastSwipe(); // on a phone a popup can be swiped away
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUid(data.session?.user.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUid(session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!uid) {
      setItems([], false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cols = COLUMNS;
        let res = await supabase
          .from("notifications")
          .select(cols)
          .is("dismissed_at", null)
          .order("created_at", { ascending: false })
          .limit(PAGE);
        if (res.error && /dismissed_at/.test(res.error.message)) {
          // The database update that adds "clear notifications" has not been run yet: show everything, hide the clear actions.
          state = { ...state, canDismiss: false };
          res = await supabase.from("notifications").select(cols).order("created_at", { ascending: false }).limit(PAGE);
        } else if (!res.error) {
          state = { ...state, canDismiss: true };
        }
        if (!cancelled) {
          state = { ...state, hasMore: !res.error && (res.data ?? []).length >= PAGE };
          setItems((res.data ?? []) as Notif[]);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();

    const channel = supabase
      .channel(`notif-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (payload) => {
          const n = payload.new as unknown as Notif;
          if (state.items.some((x) => x.id === n.id)) return;
          setItems([n, ...state.items]);
          // The admin alert system already announces new orders live.
          if (n.kind === "order_new") return;
          const t = SEV[n.severity] ?? SEV.info;
          const link = n.link;
          popup(n.title, {
            id: `notification-${n.id}`,
            description: n.body,
            icon: <i className={`bx ${t.icon} text-xl`} />,
            style: toneStyle(t),
            ...(link
              ? {
                  action: {
                    label: "View",
                    onClick: () => {
                      void markRead(n.id);
                      void navigate({ to: link as never });
                    },
                  },
                }
              : {}),
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [uid, navigate]);

  return null;
}
