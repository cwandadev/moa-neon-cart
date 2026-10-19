import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { callFn, guessProvider, normalizePhone, PROVIDERS, type Provider } from "@/lib/momo";
import { money } from "@/lib/products";
import { supabase } from "@/lib/supabase";

type Phase = "loading" | "form" | "starting" | "waiting" | "paid" | "expired" | "cancelled";
type StatusResp = {
  phase: "idle" | "waiting" | "paid" | "failed" | "expired" | "cancelled";
  order: { reserved_until: string | null; provider: string | null };
  message: string | null;
};

export function PaymentPanel({
  code,
  total,
  defaultPhone,
  onPaid,
  onEnded,
  initialError,
  defaultProvider,
  compact = false,
}: {
  code: string;
  total: number;
  defaultPhone?: string;
  onPaid?: () => void;
  /** Called once when the time to pay has ended or the order was cancelled. */
  onEnded?: () => void;
  /** A message to show first, for example when starting the payment did not work. */
  initialError?: string;
  defaultProvider?: Provider | null;
  /** Hide the amount row when the surrounding screen already shows the order and total. */
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [provider, setProvider] = useState<Provider | null>(defaultProvider ?? null);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialError ?? "");
  const [reservedUntil, setReservedUntil] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const waitStart = useRef(0);
  const paidFired = useRef(false);
  const endedFired = useRef(false);

  const applyStatus = useCallback((s: StatusResp) => {
    setReservedUntil(s.order.reserved_until);
    const pv = s.order.provider;
    if (pv === "MTN_MOMO_RWA" || pv === "AIRTEL_RWA") setProvider((p) => p ?? pv);
    switch (s.phase) {
      case "paid":
        setPhase("paid");
        break;
      case "expired":
        setPhase("expired");
        break;
      case "cancelled":
        setPhase("cancelled");
        break;
      case "waiting":
        if (!waitStart.current) waitStart.current = Date.now();
        setPhase("waiting");
        break;
      case "failed":
        waitStart.current = 0;
        setNotice(s.message ?? "The payment could not be completed. Please try again.");
        setPhase("form");
        break;
      default:
        setPhase((p) => (p === "loading" ? "form" : p));
    }
  }, []);

  // Learn the current state of this order's payment (also resumes after a page refresh).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await callFn<StatusResp>("payment-status", { order_code: code });
      if (cancelled) return;
      if (r.data) applyStatus(r.data);
      else {
        setNotice(r.error ?? "");
        setPhase("form");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, applyStatus]);

  // Prefill the number from the account when none was given.
  useEffect(() => {
    if (phone || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle();
        const p = (data?.phone as string | null) ?? "";
        if (!cancelled && p) setPhone((cur) => cur || p);
      } catch {
        /* leave it empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, phone]);

  // One-second clock for the countdown.
  useEffect(() => {
    if (phase !== "waiting" && phase !== "form") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // While waiting for the phone approval, check the payment every 3 seconds.
  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    const tick = async () => {
      const r = await callFn<StatusResp>("payment-status", { order_code: code });
      if (!cancelled && r.data) applyStatus(r.data);
    };
    void tick();
    const t = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [phase, code, applyStatus]);

  useEffect(() => {
    if (phase === "paid" && !paidFired.current) {
      paidFired.current = true;
      onPaid?.();
    }
  }, [phase, onPaid]);

  useEffect(() => {
    if ((phase === "expired" || phase === "cancelled") && !endedFired.current) {
      endedFired.current = true;
      onEnded?.();
    }
  }, [phase, onEnded]);

  const pay = async () => {
    setError("");
    const n = normalizePhone(phone);
    if (!n) {
      setError("Enter a valid Rwandan phone number.");
      return;
    }
    setPhase("starting");
    const g = guessProvider(phone);
    const r = await callFn<{ status: string }>("create-payment", {
      action: "pay",
      order_code: code,
      ...(g ? { provider: g } : {}),
      phone: n,
    });
    if (r.error) {
      setError(r.error);
      setPhase("form");
      const s = await callFn<StatusResp>("payment-status", { order_code: code });
      if (s.data && ["expired", "paid", "cancelled"].includes(s.data.phase)) applyStatus(s.data);
      return;
    }
    setNotice("");
    waitStart.current = Date.now();
    setPhase("waiting");
  };

  const remaining = reservedUntil ? Math.max(0, Math.floor((new Date(reservedUntil).getTime() - now) / 1000)) : 0;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const providerLabel = PROVIDERS.find((p) => p.id === (provider ?? guessProvider(phone)))?.label ?? "mobile money";
  const waited = phase === "waiting" && waitStart.current ? Math.floor((now - waitStart.current) / 1000) : 0;
  const windowOver = phase === "form" && reservedUntil !== null && remaining === 0;

  if (phase === "loading") {
    return <p className="py-6 text-center font-body text-sm text-muted-foreground">Loading payment…</p>;
  }

  if (phase === "paid") {
    return (
      <div className="grid justify-items-center gap-2 py-4 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-success/15 text-success">
          <i className="bx bx-check text-3xl" />
        </div>
        <p className="font-display text-lg font-semibold">Payment received</p>
        <p className="max-w-[18rem] font-body text-sm text-muted-foreground">
          Thank you! Order {code} is paid. We will confirm it shortly.
        </p>
      </div>
    );
  }

  if (phase === "expired" || phase === "cancelled") {
    return (
      <div className="grid justify-items-center gap-2 py-4 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-warning/15 text-warning">
          <i className="bx bx-time-five text-3xl" />
        </div>
        <p className="font-display text-lg font-semibold">
          {phase === "expired" ? "The time to pay has ended" : "This order was cancelled"}
        </p>
        <p className="max-w-[18rem] font-body text-sm text-muted-foreground">
          {phase === "expired"
            ? "The items were released. Please place a new order. If money left your account, message us in the chat and quote "
            : "You cannot pay for it any more. If money left your account, message us in the chat and quote "}
          {code}.
        </p>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="grid justify-items-center gap-3 py-3 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-info/15 text-info">
          <i className="bx bx-mobile-alt animate-pulse text-3xl" />
        </div>
        <p className="font-display text-lg font-semibold">Check your phone</p>
        <p className="max-w-[18rem] font-body text-sm text-muted-foreground">
          Approve the payment of {money(total)} with your {providerLabel} PIN.
        </p>
        {remaining > 0 ? (
          <p className="font-body text-xs text-warning">Time left to pay: {clock}</p>
        ) : (
          <p className="font-body text-xs text-warning">Time is up. We are checking with your provider…</p>
        )}
        {waited >= 15 && (
          <p className="font-body text-xs text-muted-foreground">
            No prompt yet? Check that this number is registered with {providerLabel}.
          </p>
        )}
        {waited >= 90 && (
          <Button
            variant="glass"
            className="rounded-xl font-body"
            onClick={() => {
              waitStart.current = 0;
              setNotice("");
              setPhase("form");
            }}
          >
            Use a different number or provider
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {!compact && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3 font-body text-sm">
          <span className="text-muted-foreground">Amount to pay</span>
          <span className="font-semibold text-primary">{money(total)}</span>
        </div>
      )}
      {reservedUntil && remaining > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 font-body text-xs text-warning">
          <i className="bx bx-time-five text-base" />
          <span>
            Pay within <span className="font-semibold">{clock}</span> to keep your items reserved.
          </span>
        </p>
      )}
      {windowOver && (
        <p className="font-body text-sm text-destructive">The time to pay this order has ended. Please place a new order.</p>
      )}
      {notice && <p className="font-body text-sm text-destructive">{notice}</p>}

      <div className="grid gap-2">
        <Label htmlFor="pay-phone">Phone number</Label>
        <div className="flex gap-2">
          <span className="grid h-11 place-items-center rounded-xl border border-border bg-muted/40 px-3 font-body text-sm text-muted-foreground">
            +250
          </span>
          <Input
            id="pay-phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0783 456 789"
            className="h-11 min-w-0 flex-1 rounded-xl text-base"
          />
        </div>
        <p className="font-body text-xs text-muted-foreground">This number gets the approval prompt.</p>
      </div>

      {error && <p className="font-body text-sm text-destructive">{error}</p>}

      <Button
        variant="neon"
        size="lg"
        className="h-12 rounded-xl text-base"
        disabled={phase === "starting" || windowOver || !normalizePhone(phone)}
        onClick={() => void pay()}
      >
        {phase === "starting" ? "Sending request…" : `Pay ${money(total)}`}
      </Button>
    </div>
  );
}
