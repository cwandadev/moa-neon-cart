import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "@/components/moa/ui";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { usePersistedState } from "@/lib/persist";

export const Route = createFileRoute("/admin/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — MOA Mart Suite" },
      { name: "description", content: "Answer live storefront visitors from one inbox." },
    ],
  }),
  component: Inbox,
});

type Msg = {
  id: string;
  conversation_id: string;
  sender_role: "client" | "staff" | "system";
  body: string;
  created_at: string;
};
type Conv = {
  id: string;
  guest_name: string;
  last_active_at: string;
  profiles: { first_name: string; last_name: string; email: string | null } | null;
  messages: { body: string; sender_role: string; created_at: string }[];
};

const nameOf = (c: Conv) => {
  const full = `${c.profiles?.first_name ?? ""} ${c.profiles?.last_name ?? ""}`.trim();
  if (full) return full;
  return c.guest_name && c.guest_name !== "Guest" ? c.guest_name : `Guest ${c.id.slice(0, 4)}`;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Inbox() {
  const { user } = useAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = usePersistedState("moa:inbox:active", "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = usePersistedState("moa:inbox:draft", "");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const activeRef = useRef("");
  const endRef = useRef<HTMLDivElement | null>(null);
  activeRef.current = activeId;

  const loadList = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from("conversations")
        .select(
          "id, guest_name, last_active_at, profiles(first_name, last_name, email), messages(body, sender_role, created_at)",
        )
        .order("last_active_at", { ascending: false })
        .order("created_at", { referencedTable: "messages", ascending: false })
        .limit(1, { referencedTable: "messages" })
        .limit(100);
      if (err) throw err;
      const list = (data ?? []) as unknown as Conv[];
      setConvs(list);
      setActiveId((prev) => prev || list[0]?.id || "");
    } catch {
      setError("Could not load conversations. Check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMsgs = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_role, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    setMsgs((data ?? []) as Msg[]);
  }, []);

  useEffect(() => {
    void loadList();
    const channel = supabase
      .channel("admin-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as unknown as Msg;
        if (m.conversation_id === activeRef.current) {
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
        void loadList();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void loadList();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadList]);

  useEffect(() => {
    if (activeId) void loadMsgs(activeId);
    else setMsgs([]);
  }, [activeId, loadMsgs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const active = convs.find((c) => c.id === activeId);

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || !user || sending) return;
    setSending(true);
    setError("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ conversation_id: activeId, sender_role: "staff", sender_id: user.id, body });
    setSending(false);
    if (err) {
      setError(
        err.message.toLowerCase().includes("rate limit")
          ? "Slow down: at most 10 messages a minute per conversation."
          : err.message,
      );
      return;
    }
    setDraft("");
    await loadMsgs(activeId);
    void loadList();
  };

  return (
    <>
      <PageHead
        title="Inbox"
        subtitle="Live conversations with storefront visitors. A dot means the customer is waiting for a reply."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="glass grid overflow-hidden rounded-2xl lg:grid-cols-[280px_1fr]">
        <div className="max-h-[520px] overflow-y-auto border-b border-[#262626] lg:border-b-0 lg:border-r">
          {convs.map((c) => {
            const last = c.messages[0];
            const waiting = last?.sender_role === "client";
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`flex w-full items-center gap-3 border-b border-[#262626]/60 p-4 text-left transition-colors ${
                  activeId === c.id ? "bg-primary/10" : "hover:bg-secondary/40"
                }`}
              >
                <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs">
                  {nameOf(c).charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{nameOf(c)}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{last?.body ?? "No messages yet"}</p>
                </div>
                {waiting && <span title="Waiting for a reply" className="size-2 rounded-full bg-primary" />}
              </button>
            );
          })}
          {!loading && convs.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No conversations yet. They appear here when a visitor sends a message from the storefront chat.
            </p>
          )}
        </div>

        <div className="flex min-h-[520px] flex-col">
          <div className="flex items-center gap-3 border-b border-[#262626] p-4">
            <span className="grid size-9 place-items-center rounded-full bg-[image:var(--gradient-neon)] text-xs text-primary-foreground">
              {active ? nameOf(active).charAt(0) : "?"}
            </span>
            <div>
              <p className="text-xs">{active ? nameOf(active) : "Select a conversation"}</p>
              {active && (
                <p className="text-[11px] text-muted-foreground">
                  {active.profiles?.email ? `${active.profiles.email} · ` : ""}last active {when(active.last_active_at)}
                </p>
              )}
            </div>
          </div>

          <div className="flex max-h-[420px] flex-1 flex-col gap-3 overflow-y-auto p-4">
            {msgs.map((m) =>
              m.sender_role === "system" ? (
                <p key={m.id} className="self-center text-[11px] text-muted-foreground">
                  {m.body}
                </p>
              ) : (
                <div
                  key={m.id}
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs ${
                    m.sender_role === "staff" ? "self-end bg-primary/15 text-primary" : "hairline self-start bg-secondary/60"
                  }`}
                >
                  {m.body}
                  <span className="mt-1 block text-[10px] text-muted-foreground">{when(m.created_at)}</span>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 border-t border-[#262626] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!active}
              placeholder="Reply as MOA staff…"
              className="hairline h-10 flex-1 rounded-xl bg-card/60 px-3 text-sm outline-none focus:neon-ring"
            />
            <button
              disabled={sending || !active}
              className="grid size-10 place-items-center rounded-xl bg-[image:var(--gradient-neon)] text-primary-foreground disabled:opacity-60"
            >
              <i className="bx bx-send" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
