import type { ReactNode } from "react";

export function PageHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
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
          <h2 className="font-display text-sm font-medium tracking-tight">{title}</h2>
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
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  icon: string;
}) {
  return (
    <div className="glass card-hover rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <i className={`bx ${icon}`} />
        </span>
      </div>
      <p className="mt-4 font-display text-2xl font-semibold">{value}</p>
      {delta && <p className="mt-1 text-xs text-success">{delta}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Pending Confirmation": "text-warning bg-warning/10",
    "Payment Verified": "text-primary bg-primary/10",
    "Out for Delivery": "text-accent bg-accent/10",
    Fulfilled: "text-success bg-success/10",
    Cancelled: "text-destructive bg-destructive/10",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] ${map[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}
