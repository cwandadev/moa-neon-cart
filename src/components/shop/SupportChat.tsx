import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { bumpChatUnread, setChatUnread, useChatUnread } from "@/lib/chatUnread";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSwipeDown } from "@/lib/swipe";
import { useAppFrame, useIsMobile } from "@/lib/appFrame";
import { usePersistedState } from "@/lib/persist";

type Msg = {
  id: string;
  sender_role: "client" | "staff" | "system";
  body: string;
  created_at: string;
};

type Row = Msg & { local?: "sending" | "failed" };

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const seenKey = (id: string) => `moa-chat-seen-${id}`;
const readSeen = (id: string): string | null => {
  try {
    return window.localStorage.getItem(seenKey(id));
  } catch {
    return null;
  }
};
const writeSeen = (id: string, iso: string) => {
  try {
    window.localStorage.setItem(seenKey(id), iso);
  } catch {
    /* storage blocked: the badge may reappear after a refresh */
  }
};

export function SupportChat() {
  const { user, ensureSession } = useAuth();
  const { chatOpen: open, setChatOpen: setOpen } = useStore();
  const unread = useChatUnread();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMobile = useIsMobile();
  const [text, setText] = usePersistedState("moa:chat:draft", "");
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const hidden =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

  const frame = useAppFrame(open && isMobile && !hidden, { coverNav: true });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const swipe = useSwipeDown(
    () => setOpen(false),
    () => panelRef.current,
  );

  const openRef = useRef(open);
  const hiddenRef = useRef(hidden);
  openRef.current = open;
  hiddenRef.current = hidden;

  const loadMessages = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("messages")
      .select("id, sender_role, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200);
    const list = (data ?? []) as Msg[];
    setMsgs((prev) => [...list, ...prev.filter((m) => m.local === "failed")]);
    const last = list[list.length - 1];
    if (openRef.current && last) {
      writeSeen(id, last.created_at);
      setChatUnread(0);
    }
  }, []);

  const findConversation = useCallback(async (uid: string) => {
    const { data } = await supabase.from("conversations").select("id").eq("user_id", uid).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }, []);

  const refreshUnread = useCallback(async (id: string) => {
    const seen = readSeen(id);
    const base = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", id)
      .eq("sender_role", "staff");
    const { count } = seen ? await base.gt("created_at", seen) : await base;
    setChatUnread(openRef.current ? 0 : (count ?? 0));
  }, []);

  // On page load, and whenever the account changes, find an existing conversation
  // (never create one) and work out how many staff replies are unread.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id;
        if (!uid) {
          if (!cancelled) {
            setConvId(null);
            setChatUnread(0);
          }
          return;
        }
        const id = await findConversation(uid);
        if (cancelled) return;
        setConvId(id);
        if (id) await refreshUnread(id);
        else setChatUnread(0);
      } catch {
        /* no badge if the lookup fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, findConversation, refreshUnread]);

  // When the chat opens, load the conversation and mark everything as seen.
  useEffect(() => {
    if (!open || hidden) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id;
        if (!uid) {
          if (!cancelled) {
            setConvId(null);
            setMsgs([]);
          }
          return;
        }
        const id = await findConversation(uid);
        if (cancelled) return;
        setConvId(id);
        if (id) await loadMessages(id);
        else setMsgs([]);
      } catch {
        /* keep the empty chat */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hidden, user?.id, findConversation, loadMessages]);

  // Live updates, also while the chat is closed.
  useEffect(() => {
    if (!convId) return;
    const channel = supabase
      .channel(`chat-${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new as unknown as Msg;
          setMsgs((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            const i = m.sender_role === "client" ? prev.findIndex((x) => x.local === "sending" && x.body === m.body) : -1;
            return [...(i >= 0 ? prev.filter((_, j) => j !== i) : prev), m];
          });
          if (m.sender_role !== "staff") return;
          if (openRef.current) {
            writeSeen(convId, m.created_at);
            return;
          }
          bumpChatUnread();
          if (hiddenRef.current) return;
          toast("New reply from MOA Support", {
            description: m.body.length > 80 ? `${m.body.slice(0, 77)}…` : m.body,
            icon: <i className="bx bx-support text-xl" />,
            action: { label: "Open", onClick: () => setOpen(true) },
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [convId, setOpen]);

  // The chat closes whenever the page changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // On phones the page behind the chat must not scroll.
  useEffect(() => {
    if (!open || !isMobile || hidden) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile, hidden]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, open, frame?.top, frame?.bottom]);

  const send = async (body: string) => {
    if (sending) return;
    setSending(true);
    setError("");
    const localId = `local-${Date.now()}`;
    setMsgs((prev) => [
      ...prev,
      { id: localId, sender_role: "client", body, created_at: new Date().toISOString(), local: "sending" },
    ]);
    try {
      const uid = await ensureSession();
      if (!uid) throw new Error("no session");
      let id: string | null = convId;
      if (!id) {
        id = await findConversation(uid);
        if (!id) {
          const name = user ? `${user.firstName} ${user.lastName}`.trim() || "Customer" : "Guest";
          const { data, error: err } = await supabase
            .from("conversations")
            .insert({ user_id: uid, guest_name: name })
            .select("id")
            .single();
          if (err) throw err;
          id = (data?.id as string | undefined) ?? null;
        }
        if (!id) throw new Error("no conversation");
        setConvId(id);
      }
      const { error: err2 } = await supabase
        .from("messages")
        .insert({ conversation_id: id, sender_role: "client", sender_id: uid, body });
      if (err2) throw err2;
      await loadMessages(id);
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
      setMsgs((prev) => prev.map((m) => (m.id === localId ? { ...m, local: "failed" as const } : m)));
      setError(msg.toLowerCase().includes("rate limit") ? "You are sending messages too fast. Please wait a minute." : "");
    } finally {
      setSending(false);
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    void send(body);
  };

  const retry = (m: Row) => {
    setMsgs((prev) => prev.filter((x) => x.id !== m.id));
    void send(m.body);
  };

  if (hidden) return null;

  const quick = ["Where is my order?", "Delivery question", "Product question"];
  const sameGroup = (a: Row, b: Row) =>
    a.sender_role !== "system" &&
    b.sender_role !== "system" &&
    a.sender_role === b.sender_role &&
    dayKey(a.created_at) === dayKey(b.created_at) &&
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 5 * 60 * 1000;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 max-md:bottom-24">
      {open && (
        <div
          ref={panelRef}
          className={cn(
            "relative flex flex-col overflow-hidden border border-border bg-card shadow-[0_24px_60px_-24px_black]",
            "md:h-[28rem] md:w-[22rem] md:rounded-2xl",
            "max-md:fixed max-md:inset-x-0 max-md:z-50 max-md:rounded-t-3xl max-md:border-x-0 max-md:border-b-0",
            frame?.keyboard && "max-md:rounded-none max-md:border-t-0",
          )}
          style={isMobile ? { top: frame?.top ?? 120, bottom: frame?.bottom ?? 0 } : undefined}
        >
          <span className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40 md:hidden" />
          <div
            {...swipe}
            className="flex shrink-0 touch-none items-center gap-3 border-b border-border px-4 pb-3 pt-4 md:py-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <i className="bx bx-support text-xl" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-display text-[15px] font-semibold">MOA Support</p>
              <p className="font-body text-xs text-muted-foreground">We reply as soon as we can</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="grid size-11 place-items-center rounded-full bg-secondary/70 text-foreground transition-colors hover:bg-secondary"
            >
              <i className="bx bx-x text-2xl" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain bg-background px-3 py-3">
            {msgs.length === 0 ? (
              <div className="grid h-full place-content-center justify-items-center gap-2 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <i className="bx bx-message-dots text-2xl" />
                </span>
                <p className="font-display text-[15px] font-semibold">How can we help?</p>
                <p className="max-w-[16rem] font-body text-xs text-muted-foreground">
                  Ask about an order, a product or delivery. We reply here.
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {quick.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setText(q)}
                      className="rounded-full border border-border bg-card px-3 py-1.5 font-body text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {msgs.map((m, i) => {
                  const prev = msgs[i - 1];
                  const next = msgs[i + 1];
                  const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  const first = !prev || newDay || !sameGroup(prev, m);
                  const last = !next || !sameGroup(m, next);
                  const mine = m.sender_role === "client";
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-secondary/70 px-3 py-1 font-body text-[11px] font-medium text-muted-foreground">
                            {dayLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      {m.sender_role === "system" ? (
                        <p className="mx-auto my-2 max-w-[85%] rounded-xl bg-secondary/50 px-3 py-1.5 text-center font-body text-xs text-muted-foreground">
                          {m.body}
                        </p>
                      ) : (
                        <div
                          className={cn(
                            "flex items-end gap-2",
                            mine ? "justify-end" : "justify-start",
                            first ? "mt-3" : "mt-0.5",
                          )}
                        >
                          {!mine && (
                            <span
                              className={cn(
                                "grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary",
                                !last && "invisible",
                              )}
                            >
                              <i className="bx bx-support text-sm" />
                            </span>
                          )}
                          <div className={cn("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
                            <div
                              className={cn(
                                "break-words rounded-2xl px-3.5 py-2 font-body text-[15px] leading-snug",
                                mine ? "bg-[oklch(0.52_0.11_195)] text-white" : "bg-[oklch(0.28_0.02_250)] text-foreground",
                                last && (mine ? "rounded-br-md" : "rounded-bl-md"),
                                m.local === "failed" && "opacity-70",
                              )}
                            >
                              {m.body}
                            </div>
                            {last && (
                              <div className="mt-1 flex items-center gap-1.5 px-1 font-body text-[11px] text-muted-foreground">
                                {m.local === "failed" ? (
                                  <>
                                    <span className="text-destructive">Not sent</span>
                                    <button
                                      type="button"
                                      onClick={() => retry(m)}
                                      className="font-medium text-primary hover:underline"
                                    >
                                      Retry
                                    </button>
                                  </>
                                ) : m.local === "sending" ? (
                                  <span>Sending…</span>
                                ) : (
                                  <>
                                    <span>{hhmm(m.created_at)}</span>
                                    {mine && <i className="bx bx-check text-sm" />}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && <p className="px-3 pb-1 font-body text-xs text-destructive">{error}</p>}

          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card p-2.5 max-md:pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <Input
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Write a message…"
              enterKeyHint="send"
              className="h-11 flex-1 rounded-full border-border bg-background px-4 font-body text-base md:h-10 md:text-sm"
            />
            <button
              type="button"
              aria-label="Send"
              disabled={!text.trim()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => submit()}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-full transition-colors md:size-10",
                text.trim() ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              <i className="bx bx-send text-lg" />
            </button>
          </div>
        </div>
      )}

      <Button
        variant="neon"
        className="relative h-14 w-14 rounded-full p-0 shadow-[0_16px_40px_-12px_var(--primary)] max-md:hidden"
        onClick={() => setOpen(!open)}
        aria-label="Support chat"
      >
        <i className={cn("text-2xl", open ? "bx bx-chevron-down" : "bx bx-message-dots")} />
        {unread > 0 && !open && (
          <span
            key={unread}
            className="absolute -right-1 -top-1 grid h-5 min-w-5 animate-in zoom-in-50 duration-200 place-items-center rounded-full bg-destructive px-1 font-body text-[10px] font-semibold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
    </div>
  );
}
