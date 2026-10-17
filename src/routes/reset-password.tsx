import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout, Field, PasswordInput } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set New Password — MOA Mart" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery link (PKCE code in the URL) is exchanged by supabase-js on
  // load; getSession() waits for that exchange to settle.
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.session) {
          setError("This reset link is invalid or has expired. Request a new one.");
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not verify the reset link. Please try again.");
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else setDone(true);
  };

  const linkExpired = !checking && Boolean(error) && !password && !confirm;

  return (
    <AuthLayout
      heading="Choose a New Password"
      text="Your reset link is verified — pick a fresh password."
      steps={["Open the emailed link", "Set a new password"]}
    >
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight">
        Set New Password
      </h1>
      <p className="mb-5 mt-1.5 text-center font-body text-sm text-muted-foreground">
        {checking ? "Verifying your reset link…" : "Enter and confirm your new password."}
      </p>

      {done ? (
        <div className="grid gap-4 rounded-xl border border-border bg-card/60 p-4 text-center">
          <p className="font-body text-sm text-accent">Password updated — you're all set.</p>
          <Button
            variant="neon"
            onClick={() => navigate({ to: "/" })}
            className="rounded-xl font-body"
          >
            Continue shopping
          </Button>
        </div>
      ) : checking ? null : linkExpired ? (
        <div className="grid gap-3 rounded-xl border border-border bg-card/60 p-4 text-center">
          <p className="font-body text-sm text-destructive">{error}</p>
          <Link
            to="/forgot-password"
            className="font-body text-sm font-medium text-foreground hover:text-primary"
          >
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="New password">
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Confirm password">
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat it" />
          </Field>
          {error && <p className="font-body text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !password || !confirm}
            className="h-10 w-full rounded-xl bg-foreground text-background shadow-none hover:bg-foreground/90"
          >
            {busy ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
