import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout, Field, PasswordInput, SocialButtons, inputClass } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Sign Up — MOA Mart" }] }),
  component: Register,
});

function Register() {
  const { user, ready, signUp, socialLogin } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (ready && user) navigate({ to: "/" });
  }, [ready, user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    const r = await signUp({ firstName, lastName, email, password });
    if (!r.ok) setError(r.error);
    else if (r.notice) setNotice(r.notice);
  };

  return (
    <AuthLayout
      heading="Create your MOA Mart account"
      text="Sign up to save your wishlist, track your orders and check out faster."
      steps={["Create your account", "Start shopping"]}
    >
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight">Sign Up Account</h1>
      <p className="mb-5 mt-1.5 text-center font-body text-sm text-muted-foreground">
        Enter your details below to get started.
      </p>
      <SocialButtons onSocial={socialLogin} />
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First Name">
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="eg. Alice" className={inputClass} />
          </Field>
          <Field label="Last Name">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="eg. Uwase" className={inputClass} />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="eg. alice@gmail.com" className={inputClass} autoComplete="email" />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" />
          <p className="mt-1.5 font-body text-xs text-muted-foreground">Must be at least 8 characters.</p>
        </Field>
        {notice && <p className="font-body text-sm text-accent">{notice}</p>}
        {error && <p className="font-body text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-10 w-full rounded-xl bg-foreground text-background shadow-none hover:bg-foreground/90">Sign Up</Button>
      </form>
      <p className="mt-6 text-center font-body text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-foreground hover:text-primary">Log in</Link>
      </p>
    </AuthLayout>
  );
}
