import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout, Field, PasswordInput, SocialButtons, inputClass } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log In — MOA Mart" }] }),
  component: Login,
});

function Login() {
  const { user, ready, logIn, socialLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (ready && user) navigate({ to: "/" });
  }, [ready, user, navigate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = logIn(email, password);
    if (!r.ok) setError(r.error);
  };

  return (
    <AuthLayout
      heading="Welcome Back"
      text="Log in to pick up where you left off."
      steps={["Log in to your account", "Browse the shop"]}
    >
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight">Log In</h1>
      <p className="mb-5 mt-1.5 text-center font-body text-sm text-muted-foreground">
        Enter your email and password to continue.
      </p>
      <SocialButtons onSocial={socialLogin} />
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="eg. johnfrans@gmail.com" className={inputClass} autoComplete="email" />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" />
        </Field>
        {error && <p className="font-body text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-10 w-full rounded-xl bg-foreground text-background shadow-none hover:bg-foreground/90">Log In</Button>
      </form>
      <p className="mt-6 text-center font-body text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link to="/register" className="font-medium text-foreground hover:text-primary">Sign up</Link>
      </p>
    </AuthLayout>
  );
}
