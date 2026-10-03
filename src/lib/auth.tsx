import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// DEMO ONLY: users live in this browser's localStorage and the admin
// password is visible in the code. Replace with real auth (Supabase) later.

export type Role = "user" | "admin";
export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
};
type StoredUser = AuthUser & { password: string };
export type AuthResult = { ok: true } | { ok: false; error: string };

const USERS_KEY = "moa-demo-users";
const SESSION_KEY = "moa-demo-session";

const DEMO_ADMIN: StoredUser = {
  id: "admin-1",
  firstName: "Admin",
  lastName: "MOA",
  email: "admin@moamart.com",
  password: "Admin1234",
  role: "admin",
};

const normEmail = (e: string) => e.trim().toLowerCase();

function readUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? (JSON.parse(raw) as StoredUser[]) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    /* storage blocked: ignore */
  }
}

function setSession(email: string | null) {
  try {
    if (email) localStorage.setItem(SESSION_KEY, email);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: ignore */
  }
}

function findUser(email: string): StoredUser | undefined {
  const e = normEmail(email);
  return [DEMO_ADMIN, ...readUsers()].find((u) => u.email === e);
}

function publicUser(u: StoredUser): AuthUser {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
  };
}

type AuthValue = {
  user: AuthUser | null;
  ready: boolean;
  isAdmin: boolean;
  signUp: (d: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => AuthResult;
  logIn: (email: string, password: string) => AuthResult;
  socialLogin: (provider: "google" | "facebook") => void;
  logOut: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const email = localStorage.getItem(SESSION_KEY);
      const found = email ? findUser(email) : undefined;
      if (found) setUser(publicUser(found));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const signUp = useCallback<AuthValue["signUp"]>((d) => {
    const firstName = d.firstName.trim();
    const lastName = d.lastName.trim();
    const email = normEmail(d.email);
    if (!firstName || !lastName) return { ok: false, error: "Please enter your first and last name." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Please enter a valid email." };
    if (d.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
    if (findUser(email)) return { ok: false, error: "An account with this email already exists." };
    const created: StoredUser = {
      id: "u-" + Date.now(),
      firstName,
      lastName,
      email,
      password: d.password,
      role: "user",
    };
    writeUsers([...readUsers(), created]);
    setSession(email);
    setUser(publicUser(created));
    return { ok: true };
  }, []);

  const logIn = useCallback<AuthValue["logIn"]>((emailRaw, password) => {
    const found = findUser(emailRaw);
    if (!found || found.password !== password) {
      return { ok: false, error: "Wrong email or password." };
    }
    setSession(found.email);
    setUser(publicUser(found));
    return { ok: true };
  }, []);

  const socialLogin = useCallback<AuthValue["socialLogin"]>((provider) => {
    const email = "demo." + provider + "@moamart.demo";
    let found = findUser(email);
    if (!found) {
      found = {
        id: "u-" + provider,
        firstName: provider === "google" ? "Google" : "Facebook",
        lastName: "User",
        email,
        password: "",
        role: "user",
      };
      writeUsers([...readUsers(), found]);
    }
    setSession(found.email);
    setUser(publicUser(found));
  }, []);

  const logOut = useCallback(() => {
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, ready, isAdmin: user?.role === "admin", signUp, logIn, socialLogin, logOut }),
    [user, ready, signUp, logIn, socialLogin, logOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
