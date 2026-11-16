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
import { captchaOptions } from "./turnstile";

export type Role = "customer" | "staff" | "admin" | "rider";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  /** The photo they uploaded themselves (a public address in our own storage), or null. */
  avatarUrl: string | null;
  /** The photo from their Google account, if they signed in with Google, or null. */
  googlePhoto: string | null;
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
  /** True while this browser holds a guest session (someone who ordered without an account). */
  isGuest: boolean;
  /** Adds an email to the guest session. The person confirms it with the link we send, then chooses a password. Their orders stay with them. */
  saveWithEmail: (email: string, name?: string) => Promise<AuthResult>;
  /** Adds Google to the guest session: the browser goes to Google and comes back signed in, with the same orders. */
  saveWithGoogle: () => Promise<AuthResult>;
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
  if (m.includes("captcha")) return "The security check did not pass. Please try again.";
  return message;
}

/** The same, for adding Google or an email to a guest session. */
function friendlyLinkError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("manual linking") || m.includes("linking is disabled")) return "Saving this way is not switched on yet. Please try the other way.";
  if (m.includes("already") && (m.includes("registered") || m.includes("linked") || m.includes("exists")))
    return "That already has an account here. Log in with it instead.";
  return friendlyAuthError(message);
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
        // Ask for the profile photo too; if the database has not been updated for it yet, ask the old way, so that nobody is ever signed out by it.
        let found = await supabase.from("profiles").select("first_name, last_name, role, avatar_path").eq("id", sessionUserId).maybeSingle();
        if (found.error) found = await supabase.from("profiles").select("first_name, last_name, role").eq("id", sessionUserId).maybeSingle();
        const data = found.data as { first_name?: string; last_name?: string; role?: string; avatar_path?: string | null } | null;
        if (cancelled || !data) return;
        // Their own photo if they added one, otherwise the one Google gave us (looked up on this phone, not over the network).
        const { data: sess } = await supabase.auth.getSession();
        const meta = (sess.session?.user.user_metadata ?? {}) as Record<string, unknown>;
        const google = [meta["avatar_url"], meta["picture"]].find((v): v is string => typeof v === "string" && v.startsWith("https://")) ?? null;
        setProfile({
          id: sessionUserId,
          firstName: data.first_name ?? "",
          lastName: data.last_name ?? "",
          email: sessionEmail,
          role: (data.role as Role) ?? "customer",
          avatarUrl: data.avatar_path ? supabase.storage.from("avatars").getPublicUrl(data.avatar_path).data.publicUrl : null,
          googlePhoto: google,
        });
        // A rider lives in the rider screen: anywhere else in the app they are sent back to it (the password pages excepted).
        try {
          const path = window.location.pathname;
          const free = path.startsWith("/rider") || path.startsWith("/forgot-password") || path.startsWith("/reset-password");
          if (data.role === "rider" && !free) window.location.replace("/rider");
        } catch {
          /* no window: nothing to do */
        }
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
      options: { data: { first_name: firstName, last_name: lastName }, ...(await captchaOptions()) },
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
      options: await captchaOptions(),
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
      const { data: res, error } = await supabase.auth.signInAnonymously({ options: await captchaOptions() });
      if (error) return null;
      return res.user?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const isGuest = Boolean(sessionUserId) && sessionAnon;

  const saveWithEmail = useCallback<AuthValue["saveWithEmail"]>(async (emailRaw, name = "") => {
    const email = normEmail(emailRaw);
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Please enter a valid email." };
    const [first = "", ...rest] = name.trim().split(/\s+/);
    const { error } = await supabase.auth.updateUser(
      { email, ...(first ? { data: { first_name: first, last_name: rest.join(" ") } } : {}) },
      { emailRedirectTo: `${window.location.origin}/reset-password` },
    );
    if (error) return { ok: false, error: friendlyLinkError(error.message) };
    return { ok: true };
  }, []);

  const saveWithGoogle = useCallback<AuthValue["saveWithGoogle"]>(async () => {
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) return { ok: false, error: friendlyLinkError(error.message) };
    return { ok: true };
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
      isGuest,
      saveWithEmail,
      saveWithGoogle,
      refreshProfile: () => setProfileTick((n) => n + 1),
    }),
    [profile, ready, signUp, logIn, socialLogin, logOut, ensureSession, isGuest, saveWithEmail, saveWithGoogle],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}


