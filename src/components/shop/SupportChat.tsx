import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useRouterState } from "@tanstack/react-router";

export function SupportChat() {
  const [text, setText] = useState("");
  const { messages, sendMessage, chatOpen: open, setChatOpen: setOpen } = useStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/login" || pathname === "/register") return null;

  const submit = () => {
    if (!text.trim()) return;
    sendMessage(text.trim(), "client");
    setText("");
  };

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
                <p className="flex items-center gap-1 font-body text-[11px] text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Online now
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-muted-foreground hover:text-foreground">
              <i className="bx bx-x text-2xl" />
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 font-body text-sm",
                  m.from === "client"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text}
                <span className="mt-1 block text-[10px] opacity-60">{m.at}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Type a message…"
              className="h-10 rounded-xl font-body"
            />
            <Button size="icon" variant="neon" className="rounded-xl" onClick={submit} aria-label="Send">
              <i className="bx bx-send text-lg" />
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="neon"
        className="h-14 w-14 rounded-full p-0 shadow-[0_16px_40px_-12px_var(--primary)] max-md:hidden"
        onClick={() => setOpen(!open)}
        aria-label="Support chat"
      >
        <i className={cn("text-2xl", open ? "bx bx-chevron-down" : "bx bx-message-dots")} />
      </Button>
    </div>
  );
}