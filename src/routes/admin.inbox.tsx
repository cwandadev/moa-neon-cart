import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { EmptyState, Skeleton } from "@/components/moa/ui";
import { ago, maskPhone } from "@/lib/adminTools";
import { useAuth } from "@/lib/auth";
import { usePersistedState } from "@/lib/persist";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/inbox")({
  // /admin/inbox?c=<chat> opens that chat, so the browser's Back button closes it again.
  validateSearch: (s: Record<string, unknown>): { c?: string | undefined } => ({
    c: typeof s["c"] === "string" && s["c"] !== "" ? s["c"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Inbox — MOA Mart Suite" },
      { name: "description", content: "Answer storefront customers from one inbox." },
    ],
  }),
  component: Inbox,
});

type Role = "client" | "staff" | "system";
type Msg = { id: string; conversation_id: string; sender_role: Role; sender_name: string | null; body: string; created_at: string };
type Conv = {
  id: string;
  user_id: string;
  guest_name: string;
  created_at: string;
  last_active_at: string;
  status: "open" | "closed";
  assigned_to: string | null;
  needs_reply: boolean;
  waiting_since: string | null;
  closed_at: string | null;
  profiles: { first_name: string; last_name: string; email: string | null; phone: string | null } | null;
  messages: { body: string; sender_role: string; created_at: string }[];
};
type Staff = { id: string; first_name: string; last_name: string };
type Quick = { id: string; title: string; body: string; position: number };
type OrderLite = { id: string; code: string; total: number; fulfilment_status: string; payment_status: string; created_at: string };
type Tab = "needs" | "mine" | "all" | "closed";

const LIST_SELECT =
  "id, user_id, guest_name, created_at, last_active_at, status, assigned_to, needs_reply, waiting_since, closed_at, profiles!user_id(first_name, last_name, email, phone), messages(body, sender_role, created_at)";
const LEGACY_SELECT = "id, user_id, guest_name, created_at, last_active_at, profiles!user_id(first_name, last_name, email, phone), messages(body, sender_role, created_at)";

const STAGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
  confirmed: { label: "To dispatch", cls: "bg-warning/10 text-warning" },
  out_for_delivery: { label: "On the way", cls: "bg-info/10 text-info" },
  delivered: { label: "Delivered", cls: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive" },
};

// ---------- small helpers ----------

const fullName = (p: { first_name: string; last_name: string } | null | undefined) => `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
const nameOf = (c: Conv) => fullName(c.profiles) || (c.guest_name && c.guest_name !== "Guest" ? c.guest_name : `Guest ${c.id.slice(0, 4)}`);
const initialOf = (s: string) => s.trim().charAt(0).toUpperCase() || "?";
const firstName = (s: Staff | undefined) => s?.first_name?.trim() || "Someone";

const waitMinutes = (c: Conv) => (c.waiting_since ? Math.floor((Date.now() - new Date(c.waiting_since).getTime()) / 60000) : 0);
const waitTone = (m: number) => (m >= 60 ? "text-destructive" : m >= 10 ? "text-warning" : "text-muted-foreground");

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};

/** Customers who have waited longest come first; everything else follows by latest activity. */
function sortConvs(list: Conv[]): Conv[] {
  const waiting = list.filter((c) => c.needs_reply).sort((a, b) => new Date(a.waiting_since ?? a.last_active_at).getTime() - new Date(b.waiting_since ?? b.last_active_at).getTime());
  const rest = list.filter((c) => !c.needs_reply).sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime());
  return [...waiting, ...rest];
}

/** A chat from a database that has not been updated yet: who is waiting is worked out from the last message. */
function legacyConv(raw: Record<string, unknown>): Conv {
  const c = raw as unknown as Conv;
  const last = c.messages?.[0];
  const waiting = last?.sender_role === "client";
  return { ...c, status: "open", assigned_to: null, closed_at: null, needs_reply: waiting, waiting_since: waiting ? (last?.created_at ?? null) : null };
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/** The part of the screen the keyboard has not covered, so the message box stays above it on a phone. */
function useVisibleArea(enabled: boolean): { height: number; top: number } | null {
  const [area, setArea] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !v) {
      setArea(null);
      return;
    }
    const update = () => setArea({ height: v.height, top: v.offsetTop });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return area;
}

function Avatar({ name, size = "size-11" }: { name: string; size?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-secondary text-base font-medium", size)}>
      {initialOf(name)}
    </span>
  );
}

// ---------- saved replies ----------

function QuickReplies({
  open,
  onClose,
  replies,
  isAdmin,
  onPick,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  replies: Quick[];
  isAdmin: boolean;
  onPick: (body: string) => void;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Quick | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = replies.filter((r) => `${r.title} ${r.body}`.toLowerCase().includes(q.trim().toLowerCase()));

  const startEdit = (r: Quick | "new") => {
    setEditing(r);
    setTitle(r === "new" ? "" : r.title);
    setBody(r === "new" ? "" : r.body);
  };
  const save = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Give the reply a title and a text.");
      return;
    }
    setBusy(true);
    const res =
      editing === "new" || editing === null
        ? await supabase.from("quick_replies").insert({ title: title.trim(), body: body.trim(), position: replies.length + 1 })
        : await supabase.from("quick_replies").update({ title: title.trim(), body: body.trim() }).eq("id", editing.id);
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    setEditing(null);
    onChanged();
  };
  const remove = async (r: Quick) => {
    const { error } = await supabase.from("quick_replies").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reply deleted.");
    onChanged();
  };

  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title="Saved replies"
      subtitle={manage ? "Add, change or delete the replies your team can use." : "Tap one to put it in the message box. You can edit it before sending."}
      footer={
        isAdmin ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className={btn.quiet} onClick={() => { setManage((v) => !v); setEditing(null); }}>
              <i aria-hidden className="bx bx-cog text-lg" /> {manage ? "Done" : "Manage replies"}
            </button>
            {manage && !editing && (
              <button type="button" className={btn.primary} onClick={() => startEdit("new")}>
                <i aria-hidden className="bx bx-plus text-lg" /> Add reply
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        {editing ? (
          <div className="grid gap-3 rounded-2xl border border-[#262626] p-4">
            <label className="grid gap-1.5">
              <span className="text-sm text-muted-foreground">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className={field} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm text-muted-foreground">Text</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={1000} className={cn(field, "h-auto py-2.5")} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save reply"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <SearchField value={q} onChange={setQ} label="Search replies" placeholder="Search saved replies" />
            {shown.length === 0 ? (
              <EmptyState icon="bx-message-square-detail" title={replies.length === 0 ? "No saved replies yet" : "No reply matches"} hint={isAdmin && replies.length === 0 ? "Use Manage replies to add the first one." : undefined} />
            ) : (
              <ul className="grid gap-2" aria-label="Saved replies">
                {shown.map((r) => (
                  <li key={r.id} className="flex items-stretch gap-1 rounded-2xl border border-[#262626]">
                    <button
                      type="button"
                      onClick={() => !manage && onPick(r.body)}
                      aria-label={manage ? `${r.title}` : `Use reply: ${r.title}`}
                      className="min-w-0 flex-1 rounded-2xl p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-base font-medium">{r.title}</span>
                      <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{r.body}</span>
                    </button>
                    {manage && (
                      <div className="flex flex-col justify-center pr-1">
                        <button type="button" aria-label={`Edit ${r.title}`} className="grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-foreground" onClick={() => startEdit(r)}>
                          <i aria-hidden className="bx bx-edit text-xl" />
                        </button>
                        <button type="button" aria-label={`Delete ${r.title}`} className="grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-destructive" onClick={() => void remove(r)}>
                          <i aria-hidden className="bx bx-trash text-xl" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminSheet>
  );
}

// ---------- the customer's details ----------

function Details({
  conv,
  staff,
  orders,
  shown,
  onShow,
}: {
  conv: Conv;
  staff: Staff[];
  orders: OrderLite[];
  shown: boolean;
  onShow: () => void;
}) {
  const phone = conv.profiles?.phone ?? "";
  const mine = staff.find((s) => s.id === conv.assigned_to);
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <Avatar name={nameOf(conv)} size="size-14" />
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{nameOf(conv)}</p>
          <p className="text-sm text-muted-foreground">{conv.profiles ? "Customer" : "Guest visitor"}</p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm">
        {conv.profiles?.email && (
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd>
              <a href={`mailto:${conv.profiles.email}`} className="break-all text-primary hover:underline">
                {conv.profiles.email}
              </a>
            </dd>
          </div>
        )}
        {phone && (
          <div>
            <dt className="text-xs text-muted-foreground">Phone</dt>
            <dd className="flex flex-wrap items-center gap-3">
              <span>{shown ? phone : maskPhone(phone)}</span>
              {shown ? (
                <a href={`tel:${phone}`} className={cn(btn.ghost, "h-10")}>
                  <i aria-hidden className="bx bx-phone text-lg" /> Call
                </a>
              ) : (
                <button type="button" onClick={onShow} className={cn(btn.ghost, "h-10")}>
                  Show number
                </button>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Chat started</dt>
          <dd>{new Date(conv.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Handled by</dt>
          <dd>{mine ? firstName(mine) : "Nobody yet"}</dd>
        </div>
      </dl>
      <section aria-label="Recent orders">
        <h3 className="mb-2 font-display text-base font-semibold">Recent orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders from this customer.</p>
        ) : (
          <ul className="divide-y divide-[#262626]">
            {orders.map((o) => {
              const st = STAGE[o.fulfilment_status] ?? { label: o.fulfilment_status, cls: "bg-muted text-muted-foreground" };
              return (
                <li key={o.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary">{o.code}</p>
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                  </div>
                  <div className="grid justify-items-end gap-1">
                    <span className="text-sm">{money(o.total)}</span>
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs", st.cls)}>{st.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- the page ----------

function Inbox() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { c: activeId } = Route.useSearch();
  const phone = usePhone();
  const area = useVisibleArea(phone && Boolean(activeId));

  const [tab, setTab] = usePersistedState<Tab>("moa:inbox:tab", "needs");
  const [q, setQ] = usePersistedState("moa:inbox:q", "");
  const [drafts, setDrafts] = usePersistedState<Record<string, string>>("moa:inbox:drafts", {});

  const [convs, setConvs] = useState<Conv[]>([]);
  const [lone, setLone] = useState<Conv | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quick, setQuick] = useState<Quick[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [phoneShown, setPhoneShown] = useState<Set<string>>(new Set());

  const endRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const me = user?.id ?? "";

  const loadList = useCallback(async () => {
    const closed = tab === "closed";
    try {
      let list: Conv[] = [];
      const res = await supabase
        .from("conversations")
        .select(LIST_SELECT)
        .eq("status", closed ? "closed" : "open")
        .order("last_active_at", { ascending: false })
        .order("created_at", { referencedTable: "messages", ascending: false })
        .limit(1, { referencedTable: "messages" })
        .limit(200);
      if (res.error) {
        // The new chat fields do not exist yet (migration 000018): show the chats anyway.
        const legacy = await supabase
          .from("conversations")
          .select(LEGACY_SELECT)
          .order("last_active_at", { ascending: false })
          .order("created_at", { referencedTable: "messages", ascending: false })
          .limit(1, { referencedTable: "messages" })
          .limit(200);
        if (legacy.error) throw legacy.error;
        setNeedsMigration(true);
        list = ((legacy.data ?? []) as unknown as Array<Record<string, unknown>>).map(legacyConv);
      } else {
        setNeedsMigration(false);
        list = (res.data ?? []) as unknown as Conv[];
      }
      setConvs(list);
      setLoadError("");
    } catch {
      setLoadError("Could not load conversations. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadMsgs = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_role, sender_name, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (activeRef.current === id) setMsgs((data ?? []) as unknown as Msg[]);
  }, []);

  const loadStatic = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name").in("role", ["staff", "admin"]),
      supabase.from("quick_replies").select("id, title, body, position").order("position"),
    ]);
    setStaff((s.data ?? []) as unknown as Staff[]);
    setQuick((r.data ?? []) as unknown as Quick[]);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadStatic();
  }, [loadStatic]);

  const loadRef = useRef(loadList);
  loadRef.current = loadList;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload: { new?: { conversation_id?: string } }) => {
        clearTimeout(timer);
        timer = setTimeout(() => void loadRef.current(), 300);
        const id = payload.new?.conversation_id;
        if (id && id === activeRef.current) void loadMsgs(id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void loadRef.current(), 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadMsgs]);

  const active = convs.find((c) => c.id === activeId) ?? (lone?.id === activeId ? lone : undefined);

  // A chat opened from a link may not be in the list that is showing.
  useEffect(() => {
    if (!activeId || convs.some((c) => c.id === activeId)) return;
    let cancelled = false;
    void supabase
      .from("conversations")
      .select(LIST_SELECT)
      .eq("id", activeId)
      .maybeSingle()
      .then((r: { data: unknown }) => {
        if (!cancelled && r.data) setLone(r.data as Conv);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, convs]);

  useEffect(() => {
    setMsgs([]);
    setSendError("");
    if (activeId) void loadMsgs(activeId);
  }, [activeId, loadMsgs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const customerId = active?.user_id;
  useEffect(() => {
    setOrders([]);
    if (!customerId) return;
    let cancelled = false;
    void supabase
      .from("orders")
      .select("id, code, total, fulfilment_status, payment_status, created_at")
      .eq("user_id", customerId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r: { data: unknown }) => {
        if (!cancelled) setOrders((r.data ?? []) as OrderLite[]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // ----- what is shown in the list -----

  const open = convs.filter((c) => c.status === "open");
  const counts = { needs: open.filter((c) => c.needs_reply).length, mine: open.filter((c) => c.assigned_to === me).length, all: open.length };
  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    const base = tab === "closed" ? convs : tab === "needs" ? open.filter((c) => c.needs_reply) : tab === "mine" ? open.filter((c) => c.assigned_to === me) : open;
    const filtered = term
      ? base.filter((c) => `${nameOf(c)} ${c.profiles?.email ?? ""} ${c.profiles?.phone ?? ""} ${c.messages[0]?.body ?? ""}`.toLowerCase().includes(term))
      : base;
    return tab === "closed" ? [...filtered].sort((a, b) => b.last_active_at.localeCompare(a.last_active_at)) : sortConvs(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, tab, term, me]);

  // ----- actions -----

  const setDraft = (id: string, text: string) => setDrafts((d) => ({ ...d, [id]: text }));
  const draft = activeId ? (drafts[activeId] ?? "") : "";

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft, activeId]);

  const openChat = (id: string) => void navigate({ to: "/admin/inbox", search: { c: id } });
  const backToList = () => void navigate({ to: "/admin/inbox", search: { c: undefined }, replace: true });

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || !user || sending) return;
    setSending(true);
    setSendError("");
    const { error } = await supabase.from("messages").insert({ conversation_id: activeId, sender_role: "staff", sender_id: user.id, body });
    setSending(false);
    if (error) {
      setSendError(error.message.toLowerCase().includes("rate limit") ? "Slow down: at most 10 messages a minute per conversation." : error.message);
      return;
    }
    setDraft(activeId, "");
    await loadMsgs(activeId);
    void loadList();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      void send();
    }
  };

  const onType = (v: string) => {
    if (!activeId) return;
    if (v === "/" && draft === "") {
      setQuickOpen(true);
      return;
    }
    setDraft(activeId, v);
  };

  const pickReply = (body: string) => {
    if (!activeId) return;
    setDraft(activeId, draft.trim() === "" ? body : `${draft}${draft.endsWith("\n") ? "" : "\n"}${body}`);
    setQuickOpen(false);
    setTimeout(() => boxRef.current?.focus(), 350);
  };

  const patchConv = async (c: Conv, patch: Partial<Conv>, done: string, undo?: Partial<Conv>) => {
    const { error } = await supabase.from("conversations").update(patch).eq("id", c.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConvs((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    if (lone?.id === c.id) setLone({ ...lone, ...patch });
    if (undo) {
      toast.success(done, { action: { label: "Undo", onClick: () => void patchConv(c, undo, "Chat reopened.") } });
    } else {
      toast.success(done);
    }
    void loadList();
  };

  const assign = (c: Conv, staffId: string | null) =>
    void patchConv(c, { assigned_to: staffId }, staffId ? (staffId === me ? "The chat is yours." : "Chat assigned.") : "Chat unassigned.");
  const close = (c: Conv) => {
    void patchConv(c, { status: "closed", closed_at: new Date().toISOString() }, "Chat closed.", { status: "open", closed_at: null });
    if (phone) backToList();
  };
  const reopen = (c: Conv) => void patchConv(c, { status: "open", closed_at: null }, "Chat reopened.");

  const chatMenu = (c: Conv): MenuItem[] => [
    c.assigned_to === me
      ? { label: "Unassign", icon: "bx-user-minus", onSelect: () => assign(c, null) }
      : { label: "Assign to me", icon: "bx-user-check", onSelect: () => assign(c, me) },
    ...staff.filter((s) => s.id !== me && s.id !== c.assigned_to).map((s) => ({ label: `Assign to ${firstName(s)}`, icon: "bx-user-plus", onSelect: () => assign(c, s.id) })),
    ...(c.assigned_to && c.assigned_to !== me ? [{ label: "Unassign", icon: "bx-user-minus", onSelect: () => assign(c, null) }] : []),
  ];

  const tabs: TabItem<Tab>[] = [
    { key: "needs", label: "Needs reply", count: counts.needs, tone: "warning" },
    { key: "mine", label: "Mine", count: counts.mine },
    { key: "all", label: "All", count: counts.all },
    { key: "closed", label: "Closed" },
  ];

  // ----- the thread, grouped by day -----

  const groups = useMemo(() => {
    const out: Array<{ label: string; list: Msg[] }> = [];
    for (const m of msgs) {
      const label = dayLabel(m.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.list.push(m);
      else out.push({ label, list: [m] });
    }
    return out;
  }, [msgs]);

  const assignee = staff.find((s) => s.id === active?.assigned_to);

  const detailsBody = active ? (
    <Details conv={active} staff={staff} orders={orders} shown={phoneShown.has(active.id)} onShow={() => setPhoneShown((s) => new Set(s).add(active.id))} />
  ) : null;

  return (
    <>
      <h1 className="sr-only">Inbox</h1>

      <div
        className={cn(
          "-mx-4 -mt-5 -mb-28 h-[calc(100dvh-3.5rem-4rem-env(safe-area-inset-bottom))] md:-mx-6 md:-mt-8 md:-mb-10 md:h-[calc(100dvh-3.5rem)] lg:-mx-8",
          "md:grid md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_280px]",
        )}
      >
        {/* ---- the list ---- */}
        <section aria-label="Conversations" className="flex h-full min-h-0 flex-col border-[#262626] md:border-r">
          <div className="grid shrink-0 gap-3 p-4">
            <SearchField value={q} onChange={setQ} label="Search conversations" placeholder="Search chats" />
            <FilterTabs items={tabs} value={tab} onChange={setTab} label="Show" wrap />
          </div>
          {needsMigration && (
            <p role="status" className="mx-4 mb-3 rounded-xl bg-warning/10 p-3 text-sm text-warning">
              The inbox update (migration 000018) has not been run yet. Chats work, but assigning, closing and the waiting order need it.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
            {loadError && (
              <div className="m-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="text-destructive">{loadError}</p>
                <button type="button" onClick={() => void loadList()} className={cn(btn.ghost, "mt-3")}>
                  Try again
                </button>
              </div>
            )}
            {loading && !loadError && (
              <ul className="grid gap-1 p-2" aria-label="Loading conversations">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-3 p-2">
                    <Skeleton className="size-11 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="mt-2 h-4 w-48" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!loading && !loadError && visible.length === 0 && (
              <EmptyState
                icon={term ? "bx-search" : "bx-conversation"}
                title={term ? "No conversation matches" : tab === "needs" ? "No one is waiting" : tab === "mine" ? "No chats assigned to you" : tab === "closed" ? "No closed chats" : "No chats yet"}
                hint={term ? "Try another word." : tab === "needs" ? "New customer messages appear here, longest wait first." : undefined}
                action={term ? <button type="button" className={btn.ghost} onClick={() => setQ("")}>Clear search</button> : tab !== "all" && tab !== "closed" ? <button type="button" className={btn.ghost} onClick={() => setTab("all")}>See all open chats</button> : undefined}
              />
            )}
            <ul className="grid gap-0.5" aria-label="Chats">
              {visible.map((c) => {
                const last = c.messages[0];
                const wait = waitMinutes(c);
                const owner = staff.find((s) => s.id === c.assigned_to);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openChat(c.id)}
                      aria-current={c.id === activeId ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        c.id === activeId && "bg-white/10",
                      )}
                    >
                      <Avatar name={nameOf(c)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("truncate text-base", c.needs_reply && "font-semibold")}>{nameOf(c)}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{ago(c.last_active_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                          {last ? `${last.sender_role === "staff" ? "Staff: " : ""}${last.body}` : "No messages yet"}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {c.needs_reply && <span className={cn("font-medium", waitTone(wait))}>Waiting {ago(c.waiting_since ?? c.last_active_at)}</span>}
                          {owner ? <span className="text-muted-foreground">{owner.id === me ? "You" : firstName(owner)}</span> : c.status === "open" && <span className="text-muted-foreground">Unassigned</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ---- the conversation (a full screen on a phone) ---- */}
        <section
          aria-label="Conversation"
          style={phone && activeId && area ? { height: area.height, top: area.top, bottom: "auto" } : undefined}
          className={cn(
            activeId ? "fixed inset-0 z-40 flex flex-col bg-background md:static md:inset-auto md:z-auto md:h-full" : "hidden md:flex md:h-full md:flex-col",
            "min-h-0 md:bg-transparent",
          )}
        >
          {!activeId ? (
            <div className="grid h-full place-items-center p-8">
              <EmptyState icon="bx-conversation" title="Select a conversation" hint="Pick a chat on the left to read it and reply." />
            </div>
          ) : !active ? (
            <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">Loading the conversation…</div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-[#262626] bg-black px-2 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:bg-transparent md:px-4 md:pt-2">
                <button type="button" onClick={backToList} aria-label="Back to conversations" className="grid size-11 shrink-0 place-items-center rounded-xl text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
                  <i aria-hidden className="bx bx-arrow-back text-2xl" />
                </button>
                <Avatar name={nameOf(active)} size="size-10" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-medium leading-tight">{nameOf(active)}</h2>
                  <p className="truncate text-sm leading-tight text-muted-foreground">
                    {active.status === "closed" ? "Closed" : assignee ? (assignee.id === me ? "Handled by you" : `Handled by ${firstName(assignee)}`) : "Unassigned"}
                    {active.needs_reply && <span className={cn("ml-2 font-medium", waitTone(waitMinutes(active)))}>· waiting {ago(active.waiting_since ?? active.last_active_at)}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => setDetailsOpen(true)} aria-label="Customer details" className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden">
                  <i aria-hidden className="bx bx-info-circle text-2xl" />
                </button>
                {active.status === "closed" ? (
                  <button type="button" onClick={() => reopen(active)} className={cn(btn.ghost, "h-10 px-3")}>
                    Reopen
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => close(active)} className={cn(btn.ghost, "h-10 px-3")}>
                      Close
                    </button>
                    <ActionMenu label="Assign this chat" items={chatMenu(active)} />
                  </>
                )}
              </header>

              <div role="log" aria-label="Messages" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                {msgs.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet.</p>}
                {groups.map((g) => (
                  <div key={g.label} className="mb-4">
                    <p className="mb-3 text-center text-xs text-muted-foreground">{g.label}</p>
                    <ul className="grid gap-3">
                      {g.list.map((m) =>
                        m.sender_role === "system" ? (
                          <li key={m.id} className="text-center text-sm text-muted-foreground">
                            {m.body}
                          </li>
                        ) : (
                          <li key={m.id} className={cn("flex flex-col", m.sender_role === "staff" ? "items-end" : "items-start")}>
                            {m.sender_role === "staff" && m.sender_name && <span className="mb-0.5 text-xs text-muted-foreground">{m.sender_name}</span>}
                            <p
                              className={cn(
                                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-base md:max-w-[75%]",
                                m.sender_role === "staff" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-secondary text-foreground",
                              )}
                            >
                              {m.body}
                            </p>
                            <span className="mt-0.5 text-xs text-muted-foreground">{timeOf(m.created_at)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <div className="shrink-0 border-t border-[#262626] bg-black p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:bg-transparent">
                {sendError && (
                  <p role="alert" className="mb-2 text-sm text-destructive">
                    {sendError}
                  </p>
                )}
                {active.status === "closed" && <p className="mb-2 text-sm text-muted-foreground">This chat is closed. Sending a message reopens it.</p>}
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => setQuickOpen(true)} aria-label="Saved replies" className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#262626] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <i aria-hidden className="bx bx-message-square-detail text-2xl" />
                  </button>
                  <textarea
                    ref={boxRef}
                    value={draft}
                    onChange={(e) => onType(e.target.value)}
                    onKeyDown={onKey}
                    rows={1}
                    maxLength={1000}
                    aria-label="Write a reply"
                    placeholder="Write a reply…  (type / for saved replies)"
                    enterKeyHint="send"
                    className={cn(field, "h-auto max-h-40 min-h-11 flex-1 resize-none py-2.5 leading-snug")}
                  />
                  <button type="button" onClick={() => void send()} disabled={sending || draft.trim() === ""} className={cn(btn.primary, "px-4")} aria-label="Send">
                    <i aria-hidden className="bx bx-send text-xl" />
                    <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ---- the customer (beside the chat on wide screens) ---- */}
        <aside aria-label="Customer" className="hidden h-full min-h-0 overflow-y-auto border-l border-[#262626] p-5 xl:block">
          {detailsBody ?? <p className="text-sm text-muted-foreground">Customer details appear here.</p>}
        </aside>
      </div>

      <AdminSheet open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Customer" subtitle={active ? nameOf(active) : undefined}>
        {detailsBody}
      </AdminSheet>

      <QuickReplies open={quickOpen} onClose={() => setQuickOpen(false)} replies={quick} isAdmin={isAdmin} onPick={pickReply} onChanged={() => void loadStatic()} />
    </>
  );
}
