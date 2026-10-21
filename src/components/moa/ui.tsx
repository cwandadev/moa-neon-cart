import type { ReactNode } from "react";

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 md:mb-8">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-2xl p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  delta,
  tone = "up",
  icon,
}: {
  label: string;
  value: string;
  delta?: string | undefined;
  tone?: "up" | "down" | "flat";
  icon: string;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <i className={`bx ${icon}`} />
        </span>
      </div>
      <p className="mt-3 font-display text-2xl font-semibold">{value}</p>
      {delta && (
        <p className={`mt-1 text-sm ${tone === "down" ? "text-destructive" : tone === "flat" ? "text-muted-foreground" : "text-success"}`}>{delta}</p>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Pending Confirmation": "text-warning bg-warning/10",
    "Payment Verified": "text-info bg-info/10",
    "Out for Delivery": "text-info bg-info/10",
    Fulfilled: "text-success bg-success/10",
    Cancelled: "text-destructive bg-destructive/10",
    awaiting_payment: "text-warning bg-warning/10",
    paid: "text-success bg-success/10",
    failed: "text-destructive bg-destructive/10",
    expired: "text-destructive bg-destructive/10",
    pending: "text-warning bg-warning/10",
    confirmed: "text-info bg-info/10",
    out_for_delivery: "text-info bg-info/10",
    delivered: "text-success bg-success/10",
    cancelled: "text-destructive bg-destructive/10",
  };
  const label = /^[a-z_]+$/.test(status)
    ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : status;
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${map[status] ?? "bg-muted"}`}>
      {label}
    </span>
  );
}

/** A grey block that stands in for content while it loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-secondary/60 motion-reduce:animate-none ${className}`} />;
}

/** An empty list is an invitation: say what is missing and, if there is one, what to do about it. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-2xl text-muted-foreground">
        <i className={`bx ${icon}`} />
      </span>
      <p className="font-display text-base font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
