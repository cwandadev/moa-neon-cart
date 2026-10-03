import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHead, Panel } from "@/components/moa/ui";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics Center — MOA Mart Suite" },
      {
        name: "description",
        content: "Sales trends, traffic sources and customer sentiment analytics for MOA Mart.",
      },
      { property: "og:title", content: "Analytics Center — MOA Mart Suite" },
      { property: "og:description", content: "Interactive charts across daily, weekly, monthly and YTD ranges." },
    ],
  }),
  component: Analytics,
});

const RANGES = ["Daily", "Weekly", "Monthly", "YTD"] as const;

const DATASETS: Record<string, { label: string; sales: number; visits: number }[]> = {
  Daily: ["00h", "04h", "08h", "12h", "16h", "20h"].map((label, i) => ({
    label,
    sales: [420, 260, 980, 1450, 1720, 1240][i]!,
    visits: [120, 90, 340, 520, 610, 430][i]!,
  })),
  Weekly: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({
    label,
    sales: [5200, 6100, 5800, 7400, 9100, 12400, 8600][i]!,
    visits: [1800, 2100, 1950, 2400, 3200, 4100, 3000][i]!,
  })),
  Monthly: ["W1", "W2", "W3", "W4"].map((label, i) => ({
    label,
    sales: [24000, 28500, 31200, 36800][i]!,
    visits: [9800, 11200, 12500, 14100][i]!,
  })),
  YTD: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((label, i) => ({
    label,
    sales: [82000, 76000, 91000, 104000, 98000, 118000, 132000, 121000][i]!,
    visits: [31000, 29000, 34000, 39000, 37000, 44000, 49000, 46000][i]!,
  })),
};

const TRAFFIC = [
  { name: "Direct", value: 38 },
  { name: "Instagram", value: 27 },
  { name: "WhatsApp Share", value: 21 },
  { name: "Search", value: 14 },
];

const SENTIMENT = [
  { label: "Delighted", value: 58 },
  { label: "Satisfied", value: 27 },
  { label: "Neutral", value: 10 },
  { label: "Frustrated", value: 5 },
];

const COLORS = ["#ffffff", "#a3a3a3", "#737373", "#525252"];

const tooltipStyle = {
  background: "#0a0a0a",
  border: "1px solid #262626",
  borderRadius: 12,
  fontSize: 12,
};

function Analytics() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("Weekly");
  const data = DATASETS[range]!;

  return (
    <>
      <PageHead title="Analytics Center" subtitle="Demand signals, acquisition mix and sentiment tracking." />

      <div className="mb-6 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`hairline rounded-full px-4 py-2 text-xs transition-colors ${
              range === r ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={`Sales trend · ${range}`} className="xl:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#262626" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="sales" stroke="#ffffff" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Traffic sources">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={TRAFFIC} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                  {TRAFFIC.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#000000" />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Visitor flow">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid stroke="#262626" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="visits" stroke="#d4d4d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Customer sentiment" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SENTIMENT}>
                <CartesianGrid stroke="#262626" vertical={false} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {SENTIMENT.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </>
  );
}
