import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { PageHead } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/inbox")({
  head: () => ({
    meta: [
      { title: "Staff & Client Chat Inbox — MOA Mart Suite" },
      {
        name: "description",
        content: "Two-way conversation console between MOA Mart staff and live storefront customers.",
      },
      { property: "og:title", content: "Staff & Client Chat Inbox — MOA Mart Suite" },
      { property: "og:description", content: "Answer live shoppers from a single threaded inbox." },
    ],
  }),
  component: Inbox,
});

function Inbox() {
  const { threads, sendStaffMessage } = useStore();
  const [activeId, setActiveId] = useState(threads[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const active = threads.find((t) => t.id === activeId) ?? threads[0];

  return (
    <>
      <PageHead title="Staff & Client Chat Inbox" subtitle="Live storefront conversations with simulated customer replies." />

      <div className="glass grid overflow-hidden rounded-2xl lg:grid-cols-[280px_1fr]">
        <div className="border-b border-[#262626] lg:border-b-0 lg:border-r">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`flex w-full items-center gap-3 border-b border-[#262626]/60 p-4 text-left transition-colors ${
                active?.id === t.id ? "bg-primary/10" : "hover:bg-secondary/40"
              }`}
            >
              <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs">
                {t.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">{t.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t.messages[t.messages.length - 1]?.body}
                </p>
              </div>
              <span
                className={`size-2 rounded-full ${t.status === "online" ? "bg-success" : "bg-muted-foreground"}`}
              />
            </button>
          ))}
        </div>

        <div className="flex min-h-[520px] flex-col">
          <div className="flex items-center gap-3 border-b border-[#262626] p-4">
            <span className="grid size-9 place-items-center rounded-full bg-[image:var(--gradient-neon)] text-xs text-primary-foreground">
              {active?.name.charAt(0)}
            </span>
            <div>
              <p className="text-xs">{active?.name}</p>
              <p className="text-[11px] text-muted-foreground capitalize">{active?.status}</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {active?.messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs ${
                  m.from === "staff"
                    ? "self-end bg-primary/15 text-primary"
                    : "hairline self-start bg-secondary/60"
                }`}
              >
                {m.body}
                <span className="mt-1 block text-[10px] text-muted-foreground">{m.at}</span>
              </div>
            ))}
          </div>

          <form
            className="flex gap-2 border-t border-[#262626] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim() || !active) return;
              sendStaffMessage(active.id, draft.trim());
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Reply as MOA staff…"
              className="hairline h-10 flex-1 rounded-xl bg-card/60 px-3 text-sm outline-none focus:neon-ring"
            />
            <button className="grid size-10 place-items-center rounded-xl bg-[image:var(--gradient-neon)] text-primary-foreground">
              <i className="bx bx-send" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
