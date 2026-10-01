import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PRODUCTS, money, popularityScore, type Product } from "@/lib/products";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — MOA Mart" },
      { name: "description", content: "Manage MOA Mart inventory, analytics, financials, chats and WhatsApp orders." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Admin Dashboard — MOA Mart" },
      { property: "og:description", content: "Inventory, analytics, financials and order tracking for MOA Mart." },
    ],
  }),
  component: Admin,
});

type SectionId = "overview" | "analytics" | "inventory" | "financials" | "chats" | "orders";

const NAV: { id: SectionId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "bx bx-grid-alt" },
  { id: "analytics", label: "Analytics", icon: "bx bx-line-chart" },
  { id: "inventory", label: "Inventory", icon: "bx bx-package" },
  { id: "financials", label: "Financials", icon: "bx bx-wallet" },
  { id: "chats", label: "Chats", icon: "bx bx-chat" },
  { id: "orders", label: "Orders", icon: "bxl bxl-whatsapp" },
];

const ORDER_STATUSES = ["Pending", "Confirmed", "Delivered", "Cancelled"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

type Order = {
  id: string;
  client: string;
  phone: string;
  product: string;
  total: number;
  placed: string;
  status: OrderStatus;
};

const SEED_ORDERS: Order[] = PRODUCTS.slice(0, 8).map((p, i) => ({
  id: `MM-10${i + 1}`,
  client: ["Aline K.", "Eric M.", "Sandra U.", "Jean P.", "Chantal N.", "David R.", "Grace I.", "Yves B."][i] ?? "Client",
  phone: `+25078${500000 + i * 4321}`,
  product: p.name,
  total: p.price,
  placed: `${i + 1}h ago`,
  status: ORDER_STATUSES[i % 4] ?? "Pending",
}));

function StatCard({ label, value, delta, icon }: { label: string; value: string; delta: string; icon: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between">
        <p className="font-body text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        <i className={cn("text-xl text-primary", icon)} />
      </div>
      <p className="mt-3 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 font-body text-xs text-accent">{delta}</p>
    </div>
  );
}

function Admin() {
  const [section, setSection] = useState<SectionId>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [stock, setStock] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRODUCTS.map((p) => [p.id, p.inStock])),
  );
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
  const [search, setSearch] = useState("");
  const { messages, sendMessage } = useStore();
  const [reply, setReply] = useState("");

  const revenueSeries = useMemo(
    () =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
        day,
        revenue: 1200 + i * 340 + (i % 2 ? 480 : 0),
        orders: 8 + i * 3,
      })),
    [],
  );

  const categorySeries = useMemo(() => {
    const map = new Map<string, number>();
    PRODUCTS.forEach((p) => map.set(p.category, (map.get(p.category) ?? 0) + p.orders));
    return [...map].map(([name, value]) => ({ name, value }));
  }, []);

  const topProducts = useMemo(
    () =>
      [...PRODUCTS]
        .sort((a, b) => popularityScore(b) - popularityScore(a))
        .slice(0, 6)
        .map((p) => ({ name: p.name.split(" ").slice(0, 2).join(" "), score: Math.round(popularityScore(p)) })),
    [],
  );

  const inventory: Product[] = useMemo(
    () =>
      PRODUCTS.filter((p) =>
        `${p.name} ${p.category}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [search],
  );

  const gross = orders.reduce((s, o) => s + o.total, 0);
  const outOfStock = Object.values(stock).filter((v) => !v).length;

  const cycleStatus = (id: string) => {
    const next = window.prompt(
      `Update status for ${id}\nOptions: ${ORDER_STATUSES.join(", ")}`,
      orders.find((o) => o.id === id)?.status,
    );
    if (!next) return;
    const match = ORDER_STATUSES.find((s) => s.toLowerCase() === next.trim().toLowerCase());
    if (!match) return;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: match } : o)));
  };

  const colors = ["var(--primary)", "var(--accent)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 shrink-0 border-r border-border bg-card p-4 transition-transform lg:static lg:z-auto lg:translate-x-0 lg:rounded-2xl lg:border",
            navOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Link to="/" className="flex items-center gap-2 px-2 py-1">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">
              M
            </span>
            <span className="font-display font-semibold">
              MOA <span className="text-gradient">Admin</span>
            </span>
          </Link>
          <nav className="mt-6 grid gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setSection(n.id);
                  setNavOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm transition-colors",
                  section === n.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <i className={cn("text-lg", n.icon)} />
                {n.label}
              </button>
            ))}
          </nav>
          <Button asChild variant="glass" className="mt-6 w-full rounded-xl font-body">
            <Link to="/">
              <i className="bx bx-store text-lg" /> View storefront
            </Link>
          </Button>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold capitalize sm:text-3xl">{section}</h1>
              <p className="font-body text-sm text-muted-foreground">
                Live mock data — connect a backend later to persist changes.
              </p>
            </div>
            <Button
              variant="glass"
              size="icon"
              className="rounded-xl lg:hidden"
              aria-label="Toggle navigation"
              onClick={() => setNavOpen((v) => !v)}
            >
              <i className="bx bx-menu text-xl" />
            </Button>
          </div>

          {section === "overview" && (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Gross sales" value={money(gross)} delta="+18.4% this week" icon="bx bx-dollar-circle" />
                <StatCard label="Orders" value={String(orders.length)} delta="+6 today" icon="bx bx-receipt" />
                <StatCard label="Products" value={String(PRODUCTS.length)} delta={`${outOfStock} out of stock`} icon="bx bx-package" />
                <StatCard label="Open chats" value={String(messages.length)} delta="Avg reply 2m" icon="bx bx-chat" />
              </div>
              <div className="rounded-2xl border border-border bg-card/60 p-5">
                <p className="font-display text-sm font-semibold">Revenue this week</p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenueSeries}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                      <Area type="monotone" dataKey="revenue" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {section === "analytics" && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card/60 p-5">
                <p className="font-display text-sm font-semibold">Orders per day</p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueSeries}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                      <Bar dataKey="orders" fill="var(--accent)" radius={6} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card/60 p-5">
                <p className="font-display text-sm font-semibold">Orders by category</p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categorySeries} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                        {categorySeries.map((entry, i) => (
                          <Cell key={entry.name} fill={colors[i % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card/60 p-5 lg:col-span-2">
                <p className="font-display text-sm font-semibold">Top engagement</p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProducts} layout="vertical">
                      <CartesianGrid stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis type="category" dataKey="name" width={110} stroke="var(--muted-foreground)" fontSize={12} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                      <Bar dataKey="score" fill="var(--primary)" radius={6} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {section === "inventory" && (
            <div className="mt-6 rounded-2xl border border-border bg-card/60">
              <div className="border-b border-border p-4">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search inventory…"
                  className="h-10 max-w-sm rounded-xl font-body"
                />
              </div>
              <ul className="divide-y divide-border">
                {inventory.map((p) => (
                  <li key={p.id} className="flex items-center gap-4 p-4">
                    <img src={p.images[0]} alt={p.name} className="h-12 w-12 rounded-xl object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold">{p.name}</p>
                      <p className="font-body text-xs text-muted-foreground">
                        {p.category} · {money(p.price)} · {p.stock} units
                      </p>
                    </div>
                    <span className="hidden font-body text-xs text-muted-foreground sm:block">
                      {stock[p.id] ? "Available" : "Hidden"}
                    </span>
                    <Switch
                      checked={stock[p.id] ?? false}
                      onCheckedChange={(v) => setStock((prev) => ({ ...prev, [p.id]: v }))}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {section === "financials" && (
            <div className="mt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Gross revenue" value={money(gross)} delta="+12.1% MoM" icon="bx bx-trending-up" />
                <StatCard label="Est. costs" value={money(Math.round(gross * 0.62))} delta="62% of revenue" icon="bx bx-receipt" />
                <StatCard label="Net profit" value={money(Math.round(gross * 0.38))} delta="38% margin" icon="bx bx-wallet" />
              </div>
              <div className="rounded-2xl border border-border bg-card/60 p-5">
                <p className="font-display text-sm font-semibold">Payout ledger</p>
                <div className="mt-4 space-y-3">
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 font-body text-sm">
                      <span className="text-muted-foreground">{o.id} · {o.client}</span>
                      <span className="font-display font-semibold">{money(o.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === "chats" && (
            <div className="mt-6 rounded-2xl border border-border bg-card/60 p-5">
              <p className="font-display text-sm font-semibold">Staff inbox</p>
              <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5 font-body text-sm",
                      m.from === "staff"
                        ? "ml-auto bg-primary/15 text-foreground"
                        : "bg-muted/60 text-foreground",
                    )}
                  >
                    <p>{m.text}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{m.from} · {m.at}</p>
                  </div>
                ))}
              </div>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!reply.trim()) return;
                  sendMessage(reply.trim(), "staff");
                  setReply("");
                }}
              >
                <Input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply as staff…"
                  className="h-10 rounded-xl font-body"
                />
                <Button type="submit" variant="neon" className="rounded-xl font-body">
                  Send
                </Button>
              </form>
            </div>
          )}

          {section === "orders" && (
            <div className="mt-6 rounded-2xl border border-border bg-card/60">
              <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                <p className="font-display text-sm font-semibold">WhatsApp order tracker</p>
                <span className="font-body text-xs text-muted-foreground">{orders.length} orders</span>
              </div>
              <ul className="divide-y divide-border">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold">
                        {o.id} · {o.client}
                      </p>
                      <p className="truncate font-body text-xs text-muted-foreground">
                        {o.product} · {money(o.total)} · {o.phone} · {o.placed}
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        "rounded-full font-body text-[11px]",
                        o.status === "Delivered" && "bg-accent text-accent-foreground",
                        o.status === "Pending" && "bg-chart-3 text-background",
                        o.status === "Cancelled" && "bg-destructive text-destructive-foreground",
                      )}
                    >
                      {o.status}
                    </Badge>
                    <Button variant="glass" size="sm" className="rounded-xl font-body" onClick={() => cycleStatus(o.id)}>
                      <i className="bx bx-edit text-base" /> Update
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
