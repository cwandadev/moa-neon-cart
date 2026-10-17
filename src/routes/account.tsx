import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/shop/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, type Role } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AccountSettings } from "@/components/account/AccountSettings";
import { money } from "@/lib/products";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "My Account — MOA Mart" }] }),
  component: Account,
});

type OrderRow = {
  id: string;
  code: string;
  created_at: string;
  total: number;
  payment_status: string;
  fulfilment_status: string;
};

type WishRow = {
  product_id: string;
  products: { id: string; name: string; price: number; images: string[] } | null;
};

type ProfileRow = { id: string; first_name: string; last_name: string; email: string | null; role: Role };

const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const statusClass = (s: string) => {
  switch (s) {
    case "paid":
    case "delivered":
      return "bg-success/10 text-success";
    case "awaiting_payment":
    case "pending":
    case "confirmed":
      return "bg-warning/10 text-warning";
    case "out_for_delivery":
      return "bg-accent/10 text-accent";
    default:
      return "bg-destructive/10 text-destructive";
  }
};

function Account() {
  const { user, ready, isAdmin, logOut } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [wishlist, setWishlist] = useState<WishRow[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login" });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const { data } = await supabase
          .from("orders")
          .select("id, code, created_at, total, payment_status, fulfilment_status")
          .order("created_at", { ascending: false })
          .eq("user_id", user.id)
          .limit(20);
        setOrders((data as OrderRow[]) ?? []);
      } catch {
        setOrders([]);
      }
      try {
        const { data } = await supabase
          .from("wishlist_items")
          .select("product_id, products(id, name, price, images)")
          .order("created_at", { ascending: false });
        setWishlist((data as unknown as WishRow[]) ?? []);
      } catch {
        setWishlist([]);
      }
    })();
  }, [user]);

  if (!ready || !user) return null;

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 8) {
      setPwMsg({ kind: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (newPassword !== pwConfirm) {
      setPwMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwBusy(false);
    if (error) setPwMsg({ kind: "err", text: error.message });
    else {
      setPwMsg({ kind: "ok", text: "Password updated." });
      setNewPassword("");
      setPwConfirm("");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">My Account</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {user.firstName} {user.lastName} · {user.email} ·{" "}
              <span className="uppercase">{user.role}</span>
            </p>
          </div>
          <Button variant="glass" className="rounded-xl font-body" onClick={() => { logOut(); navigate({ to: "/" }); }}>
            <i className="bx bx-log-out text-lg" /> Log out
          </Button>
        </div>

        <div className="mt-6 grid gap-4">
          <AccountSettings />
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="font-display text-sm font-medium tracking-tight">Change password</h2>
            <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="np" className="font-body text-sm">New password</Label>
                <Input id="np" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" className="h-10 rounded-xl" autoComplete="new-password" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cp" className="font-body text-sm">Confirm</Label>
                <Input id="cp" type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="Repeat it" className="h-10 rounded-xl" autoComplete="new-password" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={pwBusy || !newPassword || !pwConfirm} className="h-10 w-full rounded-xl font-body">
                  {pwBusy ? "Saving…" : "Update"}
                </Button>
              </div>
            </form>
            {pwMsg && (
              <p className={`mt-2 font-body text-sm ${pwMsg.kind === "ok" ? "text-accent" : "text-destructive"}`}>
                {pwMsg.text}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-medium tracking-tight">Order history</h2>
              <span className="font-body text-xs text-muted-foreground">{orders.length} orders</span>
            </div>
            {orders.length === 0 ? (
              <p className="mt-3 font-body text-sm text-muted-foreground">
                No orders yet — your orders will appear here after checkout.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {orders.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link to="/orders/$orderId" params={{ orderId: o.code }} className="font-body text-sm font-medium text-primary hover:underline">{o.code}</Link>
                      <p className="font-body text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString()} · {money(o.total)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 font-body text-[11px] ${statusClass(o.payment_status)}`}>
                        {statusLabel(o.payment_status)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 font-body text-[11px] ${statusClass(o.fulfilment_status)}`}>
                        {statusLabel(o.fulfilment_status)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-medium tracking-tight">Wishlist</h2>
              <span className="font-body text-xs text-muted-foreground">{wishlist.length} saved</span>
            </div>
            {wishlist.length === 0 ? (
              <p className="mt-3 font-body text-sm text-muted-foreground">
                Nothing saved yet — tap the heart on any product.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {wishlist.map((w) => (
                  <li
                    key={w.product_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {w.products?.images?.[0] && (
                        <img
                          src={w.products.images[0]}
                          alt=""
                          className="size-10 shrink-0 rounded-lg object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-body text-sm">
                          {w.products?.name ?? "Unavailable item"}
                        </p>
                        {w.products && (
                          <p className="font-body text-xs text-muted-foreground">
                            {money(w.products.price)}
                          </p>
                        )}
                      </div>
                    </div>
                    {w.products && (
                      <Link
                        to="/product/$productId"
                        params={{ productId: w.products.id }}
                        className="shrink-0 font-body text-xs text-primary hover:underline"
                      >
                        View
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isAdmin && <RoleManager />}
        </div>
      </main>
    </div>
  );
}

function RoleManager() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, role")
          .order("created_at", { ascending: true });
        setProfiles((data as ProfileRow[]) ?? []);
      } catch {
        setProfiles([]);
      }
    })();
  }, []);

  const setRole = async (id: string, role: Role) => {
    setMsg("");
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    setBusyId(null);
    if (error) {
      setMsg(error.message);
      return;
    }
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)));
  };

  const nameOf = (p: ProfileRow) =>
    `${p.first_name} ${p.last_name}`.trim() || p.email || "Unnamed user";

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-medium tracking-tight">
          User roles <span className="text-muted-foreground">(admin only)</span>
        </h2>
        <span className="font-body text-xs text-muted-foreground">{profiles.length} users</span>
      </div>
      {msg && <p className="mt-2 font-body text-sm text-destructive">{msg}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {profiles.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate font-body text-sm">{nameOf(p)}</p>
              {p.email && (
                <p className="truncate font-body text-xs text-muted-foreground">{p.email}</p>
              )}
            </div>
            <select
              value={p.role}
              disabled={busyId === p.id}
              onChange={(e) => void setRole(p.id, e.target.value as Role)}
              className="h-9 rounded-lg border border-border bg-card/60 px-2 font-body text-xs outline-none"
            >
              <option value="customer" className="bg-card">Customer</option>
              <option value="staff" className="bg-card">Staff</option>
              <option value="admin" className="bg-card">Admin</option>
            </select>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-body text-xs text-muted-foreground">
        Roles are enforced by the database — staff can access the admin console, only admins can
        manage products, finance and roles.
      </p>
    </section>
  );
}


