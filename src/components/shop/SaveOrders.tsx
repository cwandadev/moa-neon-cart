import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

/**
 * Shown to someone who ordered as a guest, once the order is placed (the moment they are most willing to, and Baymard's advice): a guest
 * session lives only in this browser, so this offers to keep the orders safe by adding Google or an email to the same session. Nothing is
 * created again: the orders already placed stay with them. It shows nothing to a signed-in account.
 */
export function SaveOrders({ defaultName = "" }: { defaultName?: string }) {
  const { isGuest, saveWithEmail, saveWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [hidden, setHidden] = useState(false);

  if (!isGuest || hidden) return null;

  const google = async () => {
    setBusy(true);
    setError("");
    const r = await saveWithGoogle(); // on success the browser goes to Google and comes back
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
    }
  };

  const byEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await saveWithEmail(email, defaultName);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else setSentTo(email.trim());
  };

  return (
    <section aria-label="Keep your orders" className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 font-body">
      <div>
        <h3 className="font-display text-sm font-semibold">Keep your orders</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          You ordered as a guest, so your orders are only saved in this browser. Add Google or your email to track this order and find your orders on any phone.
        </p>
      </div>
      {sentTo ? (
        <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">
          We sent a link to <strong className="font-semibold">{sentTo}</strong>. Open it to finish, then choose a password.
        </p>
      ) : (
        <>
          <Button type="button" variant="glass" className="h-11 rounded-xl" disabled={busy} onClick={() => void google()}>
            <i aria-hidden className="bx bxl-google text-lg" /> Continue with Google
          </Button>
          <form noValidate onSubmit={(e) => void byEmail(e)} className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="or use your email"
              autoComplete="email"
              aria-label="Your email"
              className="h-11 min-w-0 flex-1 text-base sm:h-10 sm:text-sm"
            />
            <Button type="submit" variant="neon" className="h-11 rounded-xl sm:h-10" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send link"}
            </Button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <button type="button" onClick={() => setHidden(true)} className="w-fit text-xs text-muted-foreground hover:text-foreground">
        Not now
      </button>
    </section>
  );
}
