import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout, Field, inputClass } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password — MOA Mart" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: typeof window === "undefined" ? "/" : `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  return (
    <AuthLayout
      heading="Reset Your Password"
      text="We email you a secure link to set a new password."
      steps={["Request a reset link", "Open it and choose a new password"]}
    >
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight">
        Forgot Password
      </h1>
      <p className="mb-5 mt-1.5 text-center font-body text-sm text-muted-foreground">
        Enter your account email and we'll send a reset link.
      </p>

      {sent ? (
        <div className="grid gap-4 rounded-xl border border-border bg-card/60 p-4 text-center">
          <p className="font-body text-sm text-accent">
            If an account exists for that email, a reset link is on its way. Open it in this
            browser to continue.
          </p>
          <Link to="/login" className="font-body text-sm font-medium text-foreground hover:text-primary">
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="eg. alice@gmail.com"
              className={inputClass}
              autoComplete="email"
            />
          </Field>
          {error && <p className="font-body text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !email.trim()}
            className="h-10 w-full rounded-xl bg-foreground text-background shadow-none hover:bg-foreground/90"
          >
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center font-body text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="font-medium text-foreground hover:text-primary">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
