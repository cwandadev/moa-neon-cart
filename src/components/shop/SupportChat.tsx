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

type Msg = {
  id: string;
  sender_role: "client" | "staff" | "system";
  body: string;
  created_at: string;
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
  const [text, setText] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const hidden =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

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
    setMsgs(list);
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
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, open]);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const uid = await ensureSession();
      if (!uid) {
        setError("Could not start a secure session. Please refresh the page and try again.");
        return;
      }
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
      setText("");
      await loadMessages(id);
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
      setError(
        msg.toLowerCase().includes("rate limit")
          ? "You are sending messages too fast. Please wait a minute."
          : "Could not send your message. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 max-md:bottom-24">
      {open && (
        <div className="flex h-[26rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_30px_80px_-30px_black] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <i className="bx bx-support text-lg" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold">MOA Support</p>
                <p className="font-body text-[11px] text-muted-foreground">We reply as soon as we can</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-muted-foreground hover:text-foreground">
              <i className="bx bx-x text-2xl" />
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <div className="max-w-[80%] rounded-2xl bg-secondary px-3 py-2 font-body text-sm text-secondary-foreground">
                Hi! Welcome to MOA Mart. How can we help you today?
              </div>
            )}
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 font-body text-sm",
                  m.sender_role === "client"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.body}
                <span className="mt-1 block text-[10px] opacity-60">{hhmm(m.created_at)}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {error && <p className="px-3 pb-1 font-body text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2 border-t border-border p-3">
            <Input
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="Type a message…"
              className="h-10 rounded-xl font-body"
            />
            <Button
              size="icon"
              variant="neon"
              className="rounded-xl"
              disabled={sending}
              onClick={() => void submit()}
              aria-label="Send"
            >
              <i className="bx bx-send text-lg" />
            </Button>
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
