import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AuthLayout({
  heading,
  text,
  steps,
  children,
}: {
  heading: string;
  text: string;
  steps: string[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background p-3 lg:p-4">
      <div className="grid lg:min-h-[calc(100vh-2rem)] lg:grid-cols-2 lg:gap-4">
        <aside
          className="relative hidden flex-col items-center justify-center overflow-hidden rounded-3xl p-8 lg:flex"
          style={{
            background:
              `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.16 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"), linear-gradient(180deg, color-mix(in oklab, var(--primary) 58%, var(--background)) 0%, color-mix(in oklab, var(--primary) 42%, var(--background)) 25%, color-mix(in oklab, var(--primary) 14%, var(--background)) 55%, var(--background) 85%)`,
          }}
        >
          <Link to="/" className="mb-4 flex items-center gap-2">
            <img src="/logo.svg" alt="" className="h-9 w-9" />
            <span className="font-display text-xl font-semibold tracking-tight">
              MOA <span className="text-gradient">Mart</span>
            </span>
          </Link>
          <h2 className="text-center font-display text-2xl font-semibold tracking-tight">{heading}</h2>
          <p className="mt-3 max-w-xs text-center font-body text-muted-foreground">{text}</p>
          <ol className="mt-6 w-full max-w-sm space-y-2">
            {steps.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2 font-body text-sm",
                  i === 0
                    ? "border-transparent bg-foreground font-medium text-background"
                    : "border-transparent bg-foreground/10 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                    i === 0 ? "bg-background text-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </aside>

        <main className="flex items-center justify-center px-2 py-6 sm:px-6">
          <div className="w-full max-w-sm">
            <Link to="/" className="mb-5 flex items-center justify-center gap-2 lg:hidden">
              <img src="/logo.svg" alt="" className="h-9 w-9" />
              <span className="font-display text-xl font-semibold tracking-tight">
                MOA <span className="text-gradient">Mart</span>
              </span>
            </Link>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function SocialButtons({ onSocial }: { onSocial: (p: "google" | "facebook") => void }) {
  const btn =
    "flex h-10 items-center justify-center gap-2 rounded-xl border border-transparent bg-card font-body text-sm font-medium transition-colors hover:text-primary";
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={btn} onClick={() => onSocial("google")}>
          <i className="bx bxl-google text-lg" /> Google
        </button>
        <button type="button" className={btn} onClick={() => onSocial("facebook")}>
          <i className="bx bxl-facebook-circle text-lg" /> Facebook
        </button>
      </div>
      <div className="my-4 flex items-center gap-3 font-body text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        Or
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block font-body text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

export const inputClass = "h-10 rounded-xl border-transparent bg-card font-body";

export function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, "pr-11")}
        autoComplete="current-password"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <i className={cn("bx text-xl", show ? "bx-hide" : "bx-show")} />
      </button>
    </div>
  );
}
