import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/shop/Header";
import { HelpCenter } from "@/components/help/HelpCenter";
import { CUSTOMER_GUIDE } from "@/lib/help";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help — MOA Mart" },
      { name: "description", content: "How to order, pay, share where to deliver, follow your order and get your money back, on MOA Mart." },
    ],
  }),
  component: Help,
});

function Help() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <HelpCenter guide={CUSTOMER_GUIDE} />
      </main>
    </div>
  );
}
