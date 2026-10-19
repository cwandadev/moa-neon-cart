import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";

export type Role = "customer" | "staff" | "admin";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
};

export type AuthResult = { ok: true; notice?: string } | { ok: false; error: string };

type AuthValue = {
  user: AuthUser | null;
  ready: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  signUp: (d: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<AuthResult>;
  logIn: (email: string, password: string) => Promise<AuthResult>;
  socialLogin: (provider: "google" | "facebook") => void;
  logOut: () => void;
  /** Returns a user id usable for RLS (anonymous sessions included), or null. */
  ensureSession: () => Promise<string | null>;
  /** Reloads the profile (name, role) after it changed. */
  refreshProfile: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

const normEmail = (e: string) => e.trim().toLowerCase();

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("already registered")) return "An account with this email already exists.";
  if (m.includes("email not confirmed"))
    return "Please confirm your email first — check your inbox for the link.";
  if (m.includes("password should be at least")) return "Password must be at least 8 characters.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState("");
  const [sessionAnon, setSessionAnon] = useState(true);
  const [sessionChecked, setReady] = useState(false);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [profileTick, setProfileTick] = useState(0);

  // Remove leftovers from the old localStorage demo login.
  useEffect(() => {
    try {
      localStorage.removeItem("moa-demo-users");
      localStorage.removeItem("moa-demo-session");
    } catch {
      /* storage blocked: ignore */
    }
  }, []);

  // Resolve the initial session once.
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const u = data.session?.user;
        if (u) {
          setSessionUserId(u.id);
          setSessionEmail(u.email ?? "");
          setSessionAnon(Boolean(u.is_anonymous));
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track auth state. No Supabase queries are awaited inside this callback
  // (documented deadlock risk) — profile loading lives in its own effect.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setSessionUserId(null);
        setSessionEmail("");
        setProfile(null);
        setReady(true);
        return;
      }
      const u = session?.user;
      if (u) {
        setSessionUserId(u.id);
        setSessionEmail(u.email ?? "");
        setSessionAnon(Boolean(u.is_anonymous));
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load the profile (name + role) for real users; guests stay user: null so
  // login/register pages and the UserMenu keep behaving exactly as before.
  useEffect(() => {
    if (!sessionUserId || sessionAnon) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    // Keep the profile while it refreshes; only drop it when the account changes.
    setProfile((p) => (p && p.id === sessionUserId ? p : null));
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("first_name, last_name, role")
          .eq("id", sessionUserId)
          .maybeSingle();
        if (cancelled || !data) return;
        setProfile({
          id: sessionUserId,
          firstName: data.first_name ?? "",
          lastName: data.last_name ?? "",
          email: sessionEmail,
          role: (data.role as Role) ?? "customer",
        });
      } catch {
        if (!cancelled) setProfile((p) => (p && p.id === sessionUserId ? p : null));
      } finally {
        if (!cancelled) setProfileFor(sessionUserId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, sessionEmail, sessionAnon, profileTick]);

  // "Ready" also waits for the profile (name and role) of a signed-in account. Without this, pages treat
  // the person as signed out while the profile is still loading after a reload and send them away.
  const needsProfile = Boolean(sessionUserId) && !sessionAnon;
  const ready = sessionChecked && (!needsProfile || profileFor === sessionUserId);

  const signUp = useCallback<AuthValue["signUp"]>(async (d) => {
    const firstName = d.firstName.trim();
    const lastName = d.lastName.trim();
    const email = normEmail(d.email);
    if (!firstName || !lastName) return { ok: false, error: "Please enter your first and last name." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Please enter a valid email." };
    if (d.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

    const { data, error } = await supabase.auth.signUp({
      email,
      password: d.password,
      options: { data: { first_name: firstName, last_name: lastName } },
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    if (!data.session) {
      return { ok: true, notice: "Check your email to confirm your account, then log in." };
    }
    return { ok: true };
  }, []);

  const logIn = useCallback<AuthValue["logIn"]>(async (emailRaw, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: normEmail(emailRaw),
      password,
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  }, []);

  const socialLogin = useCallback<AuthValue["socialLogin"]>((provider) => {
    void supabase.auth
      .signInWithOAuth({
        provider,
        options: { redirectTo: typeof window === "undefined" ? "/" : window.location.origin },
      })
      .then(({ error }) => {
        if (error) console.error("Social login failed:", error.message);
      });
  }, []);

  const logOut = useCallback(() => {
    void supabase.auth.signOut();
  }, []);

  const ensureSession = useCallback<AuthValue["ensureSession"]>(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session.user.id;
      const { data: res, error } = await supabase.auth.signInAnonymously();
      if (error) return null;
      return res.user?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user: profile,
      ready,
      isAdmin: profile?.role === "admin",
      isStaff: profile?.role === "staff" || profile?.role === "admin",
      signUp,
      logIn,
      socialLogin,
      logOut,
      ensureSession,
      refreshProfile: () => setProfileTick((n) => n + 1),
    }),
    [profile, ready, signUp, logIn, socialLogin, logOut, ensureSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}


