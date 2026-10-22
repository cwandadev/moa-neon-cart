import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { change, compact } from "@/components/admin/charts";
import { btn, field, FilterTabs, type TabItem } from "@/components/admin/controls";
import { AnimatedNumber, ChartCard, ChartSkeleton, Columns, Donut, ErrorBlock, FactList, Funnel, HeatStrip, LineKey, RankBars, Refreshing, Stat, Trend, topWithOther } from "@/components/admin/viz";
import { EmptyState, PageHead } from "@/components/moa/ui";
import {
  daysIn,
  fmtMinutes,
  lastMonth,
  presetRange,
  previousRange,
  METHOD_LABEL as METHOD,
  rangeText,
  STATUS_LABEL as STATUS,
  thisMonth,
  todayKigali,
  useAnalytics,
  validateRange,
  yearToDate,
  type CustomersData,
  type FinanceData,
  type InventoryData,
  type Preset,
  type ProductsData,
  type Range,
  type SalesData,
  type SupportData,
} from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/products";
import { cn } from "@/lib/utils";

type Tab = "sales" | "products" | "inventory" | "customers" | "support" | "finance";
const TAB_KEYS: Tab[] = ["sales", "products", "inventory", "customers", "support", "finance"];
const PRESET_KEYS: Preset[] = ["today", "7d", "30d", "90d", "custom"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Search = { tab?: Tab | undefined; range?: Preset | undefined; from?: string | undefined; to?: string | undefined; cmp?: "off" | undefined };

export const Route = createFileRoute("/admin/analytics")({
  // /admin/analytics?tab=sales&range=7d  or  ?range=custom&from=2026-10-01&to=2026-10-15  or  &cmp=off
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: TAB_KEYS.includes(s["tab"] as Tab) ? (s["tab"] as Tab) : undefined,
    range: PRESET_KEYS.includes(s["range"] as Preset) ? (s["range"] as Preset) : undefined,
    from: typeof s["from"] === "string" && DATE.test(s["from"]) ? s["from"] : undefined,
    to: typeof s["to"] === "string" && DATE.test(s["to"]) ? s["to"] : undefined,
    cmp: s["cmp"] === "off" ? "off" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Analytics — MOA Mart Suite" },
      { name: "description", content: "Sales, products, stock, customers, support and finance for MOA Mart." },
    ],
  }),
  component: Analytics,
});

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const num = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
const vsText = (r: Range) => (daysIn(r) === 1 ? "the day before" : `the ${daysIn(r)} days before`);
const nameOf = (key: string, map: Record<string, string>) => map[key] ?? key;
/** What a Stat needs to count up to a plain number, or to an amount of money (full on a laptop, short on a phone). */
const N = (n: number) => ({ n, format: num });
const M = (n: number) => ({ n, format: (x: number) => money(x), shortFormat: (x: number) => `${compact(x)} RWF` });

function TabSkeleton() {
  return (
    <div aria-label="Loading" className="mt-6 grid gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <ChartSkeleton key={i} h={112} />
        ))}
      </div>
      <ChartSkeleton h={300} />
    </div>
  );
}

// ---------- the date control ----------

function CustomRangeSheet({ open, onClose, initial, onApply }: { open: boolean; onClose: () => void; initial: Range; onApply: (r: Range) => void }) {
  const today = todayKigali();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [error, setError] = useState("");
  const apply = () => {
    const problem = validateRange(from, to, today);
    if (problem) return setError(problem);
    onApply({ from, to });
  };
  const pick = (r: Range) => {
    setFrom(r.from);
    setTo(r.to);
    setError("");
  };
  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title="Custom range"
      subtitle="Days are counted in Kigali time."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} onClick={apply}>
            Show this range
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Shortcuts">
          {[
            ["This month", thisMonth(today)],
            ["Last month", lastMonth(today)],
            ["Year to date", yearToDate(today)],
          ].map(([label, r]) => (
            <button key={String(label)} type="button" className="min-h-11 rounded-full border border-[#262626] px-4 text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => pick(r as Range)}>
              {String(label)}
            </button>
          ))}
        </div>
        <label className="grid gap-1.5">
          <span className="text-sm text-muted-foreground">From</span>
          <input type="date" value={from} max={today} onChange={(e) => { setFrom(e.target.value); setError(""); }} className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-muted-foreground">To</span>
          <input type="date" value={to} max={today} onChange={(e) => { setTo(e.target.value); setError(""); }} className={field} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </AdminSheet>
  );
}

function DateBar({ preset, range, compare, onPreset, onCompare }: { preset: Preset; range: Range; compare: boolean; onPreset: (p: Preset) => void; onCompare: (on: boolean) => void }) {
  const items: TabItem<Preset>[] = [
    { key: "today", label: "Today" },
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
    { key: "custom", label: "Custom" },
  ];
  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Date range" className="grid grid-cols-5 gap-1.5 sm:inline-grid sm:w-fit sm:grid-cols-[repeat(5,auto)]">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            aria-pressed={preset === it.key}
            onClick={() => onPreset(it.key)}
            className={cn(
              "min-h-11 whitespace-nowrap rounded-xl border px-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:text-sm",
              preset === it.key ? "border-foreground/60 bg-white/10 text-foreground" : "border-[#262626] text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <p className="text-muted-foreground">
          <span className="text-foreground">{rangeText(range)}</span>
          {compare && <> · compared with {rangeText(previousRange(range))}</>}
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-muted-foreground">
          <input type="checkbox" className="size-5 accent-white" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
          Compare with the period before
        </label>
      </div>
    </div>
  );
}

// ---------- the tabs ----------

type TabProps = { range: Range; compare: boolean; isAdmin: boolean };
const wrapGrid = "mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3";
const statGrid = "mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4";

function SalesTab({ range, compare, isAdmin }: TabProps) {
  const { data, prev, loading, error, grain, reload } = useAnalytics<SalesData>("analytics_sales", range, { compare });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const t = data.totals;
  const p = prev?.totals;
  const vs = vsText(range);
  const withMoney = isAdmin && t.revenue !== null;
  const orders = data.series.map((s) => s.orders);
  const stats = withMoney
    ? [
        <Stat key="r" label="Revenue" value={money(t.revenue ?? 0)} {...M(t.revenue ?? 0)} short={`${compact(t.revenue ?? 0)} RWF`} delta={p && change(t.revenue ?? 0, p.revenue ?? 0, true, vs)} spark={data.series.map((s) => s.revenue ?? 0)} hint="Paid orders, not cancelled" />,
        <Stat key="o" label="Orders" value={num(t.orders)} {...N(t.orders)} delta={p && change(t.orders, p.orders, true, vs)} spark={orders} />,
        <Stat key="a" label="Average order" value={money(t.avg_order ?? 0)} {...M(t.avg_order ?? 0)} short={`${compact(t.avg_order ?? 0)} RWF`} delta={p && change(t.avg_order ?? 0, p.avg_order ?? 0, true, vs)} />,
        <Stat key="c" label="Cancelled" value={`${pct(t.cancelled, t.orders)}%`} hint={`${t.cancelled} of ${t.orders} orders`} />,
      ]
    : [
        <Stat key="p" label="Paid orders" value={num(t.paid_orders)} {...N(t.paid_orders)} delta={p && change(t.paid_orders, p.paid_orders, true, vs)} spark={orders} />,
        <Stat key="o" label="Orders" value={num(t.orders)} {...N(t.orders)} delta={p && change(t.orders, p.orders, true, vs)} />,
        <Stat key="u" label="Units sold" value={num(t.units)} {...N(t.units)} delta={p && change(t.units, p.units, true, vs)} />,
        <Stat key="c" label="Cancelled" value={`${pct(t.cancelled, t.orders)}%`} hint={`${t.cancelled} of ${t.orders} orders`} />,
      ];
  if (t.orders === 0)
    return (
      <Refreshing busy={loading}>
        <div className={statGrid}>{stats}</div>
        <div className="mt-6 rounded-2xl border border-[#262626] bg-card">
          <EmptyState icon="bx-line-chart" title="No orders in this period" hint="Try a longer range, or another date." />
        </div>
      </Refreshing>
    );
  const statusItems = data.status.map((s) => ({ name: nameOf(s.key, STATUS), value: s.n }));
  const methodItems = topWithOther(data.methods.map((m) => ({ name: nameOf(m.key, METHOD), value: withMoney ? (m.revenue ?? 0) : m.n })));
  const catItems = topWithOther(data.by_category.map((c) => ({ name: c.name, value: withMoney ? (c.revenue ?? 0) : c.units })));
  const fmt = withMoney ? (n: number) => money(n) : (n: number) => num(n);
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>{stats}</div>
      <div className={wrapGrid}>
        <ChartCard title={withMoney ? "Revenue" : "Orders"} hint={compare ? "The dashed line is the period before." : undefined} className="xl:col-span-2">
          <Trend
            rows={data.series.map((s) => ({ t: s.t, v: withMoney ? (s.revenue ?? 0) : s.orders }))}
            series={[{ key: "v", label: withMoney ? "Revenue" : "Orders" }]}
            prev={prev?.series.map((s) => (withMoney ? (s.revenue ?? 0) : s.orders))}
            grain={grain}
            format={withMoney ? (n) => money(n) : (n) => num(n)}
            summary={`${withMoney ? "Revenue" : "Orders"} over time: ${withMoney ? money(t.revenue ?? 0) : num(t.orders)} in total.`}
          />
        </ChartCard>
        <ChartCard title="Orders by status">
          <Donut items={statusItems} format={num} centerValue={<AnimatedNumber n={t.orders} format={num} />} centerLabel="orders" summary={`Orders by status: ${statusItems.map((s) => `${s.name} ${s.value}`).join(", ")}.`} />
        </ChartCard>
        <ChartCard title="From order to delivery" hint="How many orders carried on to the next step.">
          <Funnel stages={[{ label: "Orders placed", value: data.funnel.placed }, { label: "Paid", value: data.funnel.paid }, { label: "Delivered", value: data.funnel.delivered }]} />
        </ChartCard>
        <ChartCard title={withMoney ? "Revenue by payment method" : "Paid orders by payment method"}>
          <Donut items={methodItems} format={fmt} centerValue={withMoney ? compact(methodItems.reduce((n, i) => n + i.value, 0)) : num(t.paid_orders)} centerLabel={withMoney ? "RWF" : "paid orders"} summary="Payment methods." />
        </ChartCard>
        <ChartCard title={withMoney ? "Revenue by category" : "Units by category"}>
          <Donut items={catItems} format={fmt} centerValue={withMoney ? compact(catItems.reduce((n, i) => n + i.value, 0)) : num(t.units)} centerLabel={withMoney ? "RWF" : "units"} summary="Categories." />
        </ChartCard>
        <ChartCard title="Top products" hint="By units sold.">
          <RankBars rows={data.top_products.map((tp) => ({ name: tp.name, value: tp.units, note: withMoney && tp.revenue !== null ? money(tp.revenue) : undefined }))} format={(n) => `${n} sold`} />
        </ChartCard>
        <ChartCard title="When customers order" hint="By hour of the day, and by day of the week." className="xl:col-span-2">
          <HeatStrip values={data.by_hour} unit="orders" />
          <div className="mt-5">
            <Columns data={data.by_weekday.map((v, i) => ({ label: WEEKDAYS[i]!, value: v }))} format={num} height={170} summary="Orders by day of the week." />
          </div>
        </ChartCard>
      </div>
    </Refreshing>
  );
}

function ProductsTab({ range, isAdmin }: TabProps) {
  const { data, loading, error, reload } = useAnalytics<ProductsData>("analytics_products", range, { grain: null });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const t = data.totals;
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>
        <Stat label="Units sold" value={num(t.units)} {...N(t.units)} />
        <Stat label="Products sold" value={num(t.products_sold)} {...N(t.products_sold)} hint={`of ${t.active_products} on sale`} />
        <Stat label="On sale" value={num(t.active_products)} {...N(t.active_products)} />
        <Stat label="Share that sold" value={`${pct(t.products_sold, t.active_products)}%`} hint="Products with at least one sale" />
      </div>
      <div className={wrapGrid}>
        <ChartCard title="Best sellers" hint="By units sold in this period." className="xl:col-span-2">
          <RankBars rows={data.top.map((p) => ({ name: p.name, value: p.units, note: isAdmin && p.revenue !== null ? money(p.revenue) : undefined }))} format={(n) => `${n} sold`} empty="No sales in this period." />
        </ChartCard>
        <ChartCard title="Best sizes and colours">
          <Columns data={data.options.map((o) => ({ label: o.name.length > 9 ? `${o.name.slice(0, 8)}…` : o.name, value: o.units }))} format={num} summary="Best selling sizes and colours." />
        </ChartCard>
        <ChartCard title="On sale but not selling" hint="In stock, with no sale in this period." className="xl:col-span-1">
          <FactList rows={data.slow.map((s) => ({ name: s.name, value: `${s.stock} in stock` }))} empty="Everything in stock sold at least once." />
        </ChartCard>
        <ChartCard title="Saved, but not bought" hint="Most saved by customers, and how many were bought." className="xl:col-span-2">
          <FactList rows={data.saved.map((s) => ({ name: s.name, value: `${s.saved} saved`, note: `${s.units} bought` }))} empty="Nobody has saved a product yet." />
        </ChartCard>
      </div>
    </Refreshing>
  );
}

function InventoryTab({ range, isAdmin }: TabProps) {
  const { data, loading, error, reload } = useAnalytics<InventoryData>("analytics_inventory", range, { grain: null });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const s = data.snapshot;
  const m = data.movements;
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>
        <Stat label="Products on sale" value={num(s.active)} {...N(s.active)} />
        <Stat label="Out of stock" value={num(s.out)} {...N(s.out)} hint="Right now" />
        <Stat label="Running low" value={num(s.low)} {...N(s.low)} hint="5 or fewer left" />
        {isAdmin && s.value_cost !== null ? <Stat label="Stock value" value={money(s.value_cost)} {...M(s.value_cost)} short={`${compact(s.value_cost)} RWF`} hint={`At cost. Selling price ${money(s.value_retail ?? 0)}`} /> : <Stat label="Healthy stock" value={num(s.healthy)} {...N(s.healthy)} hint="More than 5 left" />}
      </div>
      <div className={wrapGrid}>
        <ChartCard title="Stock health" hint="The stock as it is right now.">
          <Donut items={[{ name: "Healthy", value: s.healthy }, { name: "Running low", value: s.low }, { name: "Out of stock", value: s.out }].filter((i) => i.value > 0)} format={num} centerValue={<AnimatedNumber n={s.active} format={num} />} centerLabel="products" summary={`Stock health: ${s.healthy} healthy, ${s.low} low, ${s.out} out.`} />
        </ChartCard>
        <ChartCard title="Will run out soonest" hint="At the pace of the last 30 days.">
          <FactList rows={data.at_risk.map((r) => ({ name: r.name, value: `${r.days_left} ${r.days_left === 1 ? "day" : "days"}`, note: `${r.stock} left` }))} empty="Nothing is about to run out." />
        </ChartCard>
        <ChartCard title="Out of stock, but wanted" hint="Sold in the last 30 days, with none left now.">
          <FactList rows={data.lost_sales.map((r) => ({ name: r.name, value: `${r.units} sold` }))} empty="No sold-out product had recent sales." />
        </ChartCard>
        <ChartCard title="Where the stock went" hint="Units, in the chosen period." className="xl:col-span-3">
          <Columns data={[{ label: "Sold", value: m.sold }, { label: "Put back", value: m.returned }, { label: "Added", value: m.added }, { label: "Removed", value: m.removed }]} format={num} height={200} summary="Stock movements." />
        </ChartCard>
      </div>
    </Refreshing>
  );
}

function CustomersTab({ range, compare, isAdmin }: TabProps) {
  const { data, prev, loading, error, grain, reload } = useAnalytics<CustomersData>("analytics_customers", range, { compare });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const t = data.totals;
  const p = prev?.totals;
  const vs = vsText(range);
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>
        <Stat label="New customers" value={num(t.new)} {...N(t.new)} delta={p && change(t.new, p.new, true, vs)} spark={data.series.map((s) => s.new)} />
        <Stat label="All customers" value={num(t.total)} {...N(t.total)} />
        <Stat label="Customers who bought" value={num(t.buyers)} {...N(t.buyers)} delta={p && change(t.buyers, p.buyers, true, vs)} />
        <Stat label="Came back" value={`${pct(t.returning, t.buyers)}%`} hint={`${t.returning} of ${t.buyers} had bought before`} />
      </div>
      <div className={wrapGrid}>
        <ChartCard title="New customers" hint={compare ? "The dashed line is the period before." : undefined} className="xl:col-span-2">
          <Trend rows={data.series.map((s) => ({ t: s.t, v: s.new }))} series={[{ key: "v", label: "New customers" }]} prev={prev?.series.map((s) => s.new)} grain={grain} format={num} summary={`${t.new} new customers.`} />
        </ChartCard>
        <ChartCard title="New and returning buyers">
          <Donut items={data.split.map((x) => ({ name: x.key === "new" ? "First purchase" : "Came back", value: x.n })).filter((i) => i.value > 0)} format={num} centerValue={<AnimatedNumber n={t.buyers} format={num} />} centerLabel="buyers" summary="New and returning buyers." />
        </ChartCard>
        {isAdmin && data.top && (
          <ChartCard title="Top customers" hint="By amount spent in this period." className="xl:col-span-3">
            <RankBars rows={data.top.map((c) => ({ name: c.name || "Customer", value: c.spent, note: `${c.orders} order${c.orders === 1 ? "" : "s"}` }))} format={(n) => money(n)} empty="No purchases in this period." />
          </ChartCard>
        )}
      </div>
    </Refreshing>
  );
}

function SupportTab({ range, compare }: TabProps) {
  const { data, prev, loading, error, grain, reload } = useAnalytics<SupportData>("analytics_support", range, { compare });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const t = data.totals;
  const r = data.response;
  const vs = vsText(range);
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>
        <Stat label="Chats" value={num(t.chats)} {...N(t.chats)} delta={prev && change(t.chats, prev.totals.chats, true, vs)} spark={data.series.map((s) => s.chats)} hint={`${t.closed} closed`} />
        <Stat label="Typical first reply" value={fmtMinutes(r.median_min)} hint="Half were answered faster than this" />
        <Stat label="Slowest 10%" value={fmtMinutes(r.p90_min)} hint="The wait of the unluckiest customers" />
        <Stat label="Never answered" value={num(r.unanswered)} {...N(r.unanswered)} hint={`${r.answered} answered`} />
      </div>
      <div className={wrapGrid}>
        <ChartCard title="Chats started" hint={compare ? "The dashed line is the period before." : undefined} className="xl:col-span-2">
          <Trend rows={data.series.map((s) => ({ t: s.t, v: s.chats }))} series={[{ key: "v", label: "Chats" }]} prev={prev?.series.map((s) => s.chats)} grain={grain} format={num} summary={`${t.chats} chats.`} />
        </ChartCard>
        <ChartCard title="Waiting right now" hint="Live, whatever the dates above." className="xl:self-start">
          <p className="font-display text-4xl font-semibold">{num(data.now.waiting)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{data.now.waiting === 0 ? "Nobody is waiting for a reply." : `The longest has waited ${fmtMinutes(data.now.oldest_min)}.`}</p>
        </ChartCard>
        <ChartCard title="When customers write" hint="Customer messages by hour of the day." className="xl:col-span-2">
          <HeatStrip values={data.by_hour} unit="messages" />
        </ChartCard>
        <ChartCard title="Chats by team member">
          <RankBars rows={data.by_staff.map((s) => ({ name: s.name, value: s.chats }))} format={(n) => `${n} chat${n === 1 ? "" : "s"}`} empty="No chats in this period." />
        </ChartCard>
      </div>
    </Refreshing>
  );
}

function FinanceTab({ range, compare }: TabProps) {
  const { data, prev, loading, error, grain, reload } = useAnalytics<FinanceData>("analytics_finance", range, { compare });
  if (error) return <div className="mt-6"><ErrorBlock message={error} onRetry={() => void reload()} /></div>;
  if (!data) return <TabSkeleton />;
  const t = data.totals;
  const p = prev?.totals;
  const vs = vsText(range);
  const series = [{ key: "revenue", label: "Revenue" }, { key: "profit", label: "Profit" }, { key: "cost", label: "Cost" }];
  return (
    <Refreshing busy={loading}>
      <div className={statGrid}>
        <Stat label="Revenue" value={money(t.revenue)} {...M(t.revenue)} short={`${compact(t.revenue)} RWF`} delta={p && change(t.revenue, p.revenue, true, vs)} spark={data.series.map((s) => s.revenue)} />
        <Stat label="Cost of goods" value={money(t.cost)} {...M(t.cost)} short={`${compact(t.cost)} RWF`} delta={p && change(t.cost, p.cost, true, vs)} />
        <Stat label="Profit" value={money(t.profit)} {...M(t.profit)} short={`${compact(t.profit)} RWF`} delta={p && change(t.profit, p.profit, true, vs)} spark={data.series.map((s) => s.profit)} />
        <Stat label="Margin" value={`${t.margin_pct}%`} hint={`${money(t.refunded)} refunded in this period`} />
      </div>
      <div className={wrapGrid}>
        <ChartCard title="Revenue, profit and cost" hint={compare ? "The dashed line is the revenue of the period before." : undefined} className="xl:col-span-2">
          <LineKey series={series} />
          <Trend rows={data.series.map((s) => ({ t: s.t, revenue: s.revenue, profit: s.profit, cost: s.cost }))} series={series} prev={prev?.series.map((s) => s.revenue)} grain={grain} format={(n) => money(n)} summary={`Revenue ${money(t.revenue)}, profit ${money(t.profit)}.`} />
        </ChartCard>
        <ChartCard title="Revenue by payment method">
          <Donut items={topWithOther(data.by_method.map((m) => ({ name: nameOf(m.key, METHOD), value: m.revenue })))} format={(n) => money(n)} centerValue={compact(t.revenue)} centerLabel="RWF" summary="Revenue by payment method." />
        </ChartCard>
        <ChartCard title="Margin by category" hint="How much of each sale is profit." className="xl:col-span-3">
          <Columns data={data.by_category.map((c) => ({ label: c.name, value: c.margin_pct }))} format={(n) => `${n}%`} yFormat={(n) => `${n}%`} height={220} summary="Margin by category." />
        </ChartCard>
      </div>
    </Refreshing>
  );
}

// ---------- the page ----------

function Analytics() {
  const { isAdmin } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const today = todayKigali();
  const [customOpen, setCustomOpen] = useState(false);

  const tabItems: TabItem<Tab>[] = [
    { key: "sales", label: "Sales" },
    { key: "products", label: "Products" },
    { key: "inventory", label: "Inventory" },
    { key: "customers", label: "Customers" },
    { key: "support", label: "Support" },
    ...(isAdmin ? [{ key: "finance" as const, label: "Finance" }] : []),
  ];
  const tab: Tab = tabItems.some((t) => t.key === search.tab) ? (search.tab as Tab) : "sales";
  const preset: Preset = search.range ?? "30d";
  const customOk = preset === "custom" && search.from !== undefined && search.to !== undefined && validateRange(search.from, search.to, today) === null;
  const range: Range = customOk ? { from: search.from!, to: search.to! } : presetRange(preset === "custom" ? "30d" : preset, today);
  const compare = search.cmp !== "off";

  const go = (patch: Partial<Search>) => void navigate({ to: "/admin/analytics", search: { ...search, ...patch }, replace: true });
  const props: TabProps = { range, compare, isAdmin };

  return (
    <>
      <PageHead title="Analytics" subtitle="How the shop is doing: sales, products, stock, customers, support and money." />
      <DateBar
        preset={customOk ? "custom" : preset === "custom" ? "30d" : preset}
        range={range}
        compare={compare}
        onPreset={(p) => (p === "custom" ? setCustomOpen(true) : go({ range: p, from: undefined, to: undefined }))}
        onCompare={(on) => go({ cmp: on ? undefined : "off" })}
      />
      <div className="mt-5">
        <FilterTabs items={tabItems} value={tab} onChange={(k) => go({ tab: k })} label="Section" />
      </div>

      <div key={tab} className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
        {tab === "sales" && <SalesTab {...props} />}
        {tab === "products" && <ProductsTab {...props} />}
        {tab === "inventory" && <InventoryTab {...props} />}
        {tab === "customers" && <CustomersTab {...props} />}
        {tab === "support" && <SupportTab {...props} />}
        {tab === "finance" && isAdmin && <FinanceTab {...props} />}
      </div>

      <CustomRangeSheet
        key={`${range.from}-${range.to}-${customOpen}`}
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        initial={range}
        onApply={(r) => {
          setCustomOpen(false);
          go({ range: "custom", from: r.from, to: r.to });
        }}
      />
      <span className={cn("sr-only")} aria-live="polite">
        {rangeText(range)}
      </span>
    </>
  );
}
