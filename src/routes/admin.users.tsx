import { FunctionsHttpError } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHead, Panel } from "@/components/moa/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { usePersistedState } from "@/lib/persist";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users — MOA Mart Suite" }] }),
  component: Users,
});

type Role = "customer" | "staff" | "admin";
type U = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: Role;
  provider: "email" | "google" | "facebook";
  last_sign_in_at: string | null;
  created_at: string;
  disabled: boolean;
  orders: number;
};

const ROLE_TONE: Record<Role, string> = {
  admin: "bg-destructive/10 text-destructive",
  staff: "bg-info/10 text-info",
  customer: "bg-secondary text-muted-foreground",
};

const fieldClass =
  "w-full rounded-xl border border-[#262626] bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/50";

async function call<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>("manage-users", { body });
  if (error) {
    let msg = "Something went wrong. Please try again.";
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (b?.error) msg = String(b.error);
      } catch {
        /* keep the generic message */
      }
    }
    return { error: msg };
  }
  return { data: data as T };
}

const nameOf = (u: U) => `${u.first_name} ${u.last_name}`.trim() || u.email;
const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never");

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function UserDialog({
  user,
  isMe,
  onClose,
  onDone,
}: {
  user?: U | undefined;
  isMe: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [first, setFirst] = useState(user?.first_name ?? "");
  const [last, setLast] = useState(user?.last_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "customer");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!first.trim() || !last.trim()) {
      setError("Enter a first and last name.");
      return;
    }
    if (!user && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email.");
      return;
    }
    if ((!user || password) && password.length < 8) {
      setError("The password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    const r = user
      ? await call({
          action: "update",
          id: user.id,
          first_name: first,
          last_name: last,
          phone,
          ...(isMe ? {} : { role }),
          ...(password ? { password } : {}),
        })
      : await call({ action: "create", email, first_name: first, last_name: last, phone, role, password });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    onDone(user ? "Changes saved." : "Account created. Give the person their email and temporary password.");
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="moa-admin-dialog max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border-[#262626] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "Create account"}</DialogTitle>
          <DialogDescription>
            {user ? user.email : "The account works right away. No confirmation email is sent."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <input value={first} onChange={(e) => setFirst(e.target.value)} className={`${fieldClass} h-10`} />
            </Field>
            <Field label="Last name">
              <input value={last} onChange={(e) => setLast(e.target.value)} className={`${fieldClass} h-10`} />
            </Field>
          </div>
          {!user && (
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldClass} h-10`} />
            </Field>
          )}
          <Field label="Phone (optional)">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250 78..." className={`${fieldClass} h-10`} />
          </Field>
          <Field label="Role">
            <select
              value={role}
              disabled={isMe}
              onChange={(e) => setRole(e.target.value as Role)}
              className={`${fieldClass} h-10 disabled:opacity-60`}
            >
              <option value="customer" className="bg-card">Customer</option>
              <option value="staff" className="bg-card">Staff (orders, inventory, inbox)</option>
              <option value="admin" className="bg-card">Admin (everything)</option>
            </select>
            {isMe && <span className="text-[11px]">You cannot change your own role.</span>}
          </Field>
          <Field label={user ? "New temporary password (leave empty to keep the current one)" : "Temporary password"}>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              className={`${fieldClass} h-10`}
            />
          </Field>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-[#262626] px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : user ? "Save changes" : "Create account"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Confirm = { kind: "disable" | "enable" | "delete"; user: U } | null;

function Users() {
  const { isAdmin, ready } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = usePersistedState("moa:users:q", "");
  const [roleFilter, setRoleFilter] = usePersistedState<"all" | Role>("moa:users:role", "all");
  const [dialog, setDialog] = useState<{ user?: U | undefined } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = useCallback(async () => {
    const r = await call<{ users: U[]; me: string }>({ action: "list" });
    if (r.error || !r.data) {
      setError(r.error ?? "Could not load users.");
    } else {
      setUsers(r.data.users);
      setMe(r.data.me);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleFilter === "all" || u.role === roleFilter) &&
        (!t || `${u.first_name} ${u.last_name} ${u.email} ${u.phone}`.toLowerCase().includes(t)),
    );
  }, [users, q, roleFilter]);

  const count = (r: Role) => users.filter((u) => u.role === r).length;

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    setConfirm(null);
    setError("");
    const r = await call({ action: kind, id: user.id });
    if (r.error) {
      setError(r.error);
      return;
    }
    setNotice(kind === "delete" ? "Account deleted." : kind === "disable" ? "Account disabled." : "Account enabled.");
    void load();
  };

  if (ready && !isAdmin) {
    return (
      <>
        <PageHead title="Users" subtitle="Manage accounts and roles." />
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">Only admins can manage users.</p>
        </Panel>
      </>
    );
  }

  const act = "text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline";

  return (
    <>
      <PageHead
        title="Users"
        subtitle="Create accounts, change roles, and disable or delete people. Guest visitors are not listed."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "All", users.length, "border-border text-muted-foreground"],
            ["admin", "Admins", count("admin"), "border-destructive/40 text-destructive"],
            ["staff", "Staff", count("staff"), "border-info/40 text-info"],
            ["customer", "Customers", count("customer"), "border-border text-muted-foreground"],
          ] as Array<["all" | Role, string, number, string]>
        ).map(([key, label, n, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRoleFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${tone} ${roleFilter === key ? "bg-secondary/70 ring-1 ring-current" : "hover:bg-secondary/30"}`}
          >
            {label} <span className="ml-1 font-semibold">{n}</span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <i className="bx bx-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or phone"
            className="hairline h-10 w-full rounded-xl bg-card/60 pl-9 pr-3 text-sm outline-none focus:neon-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice("");
            setDialog({});
          }}
          className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <i className="bx bx-plus text-lg" /> Create account
        </button>
      </div>

      {notice && <p className="mb-4 text-sm text-success">{notice}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[#262626] text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-4">Person</th>
              <th className="p-4">Role</th>
              <th className="p-4">Signs in with</th>
              <th className="p-4">Last login</th>
              <th className="p-4">Orders</th>
              <th className="p-4">Status</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const mine = u.id === me;
              return (
                <tr
                  key={u.id}
                  className={`border-b border-[#262626]/60 align-top hover:bg-secondary/30 ${
                    u.disabled ? "border-l-4 border-l-destructive" : "border-l-4 border-l-success"
                  }`}
                >
                  <td className="p-4">
                    <p className="text-xs">
                      {nameOf(u)} {mine && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{u.email}</p>
                    {u.phone && <p className="text-[11px] text-muted-foreground">{u.phone}</p>}
                  </td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${ROLE_TONE[u.role]}`}>{u.role}</span>
                  </td>
                  <td className="p-4 text-xs capitalize text-muted-foreground">{u.provider}</td>
                  <td className="p-4 text-xs text-muted-foreground">{ago(u.last_sign_in_at)}</td>
                  <td className="p-4 text-xs">{u.orders}</td>
                  <td className="p-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] ${u.disabled ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}
                    >
                      {u.disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button
                        type="button"
                        className={act}
                        onClick={() => {
                          setNotice("");
                          setDialog({ user: u });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={act}
                        disabled={mine}
                        title={mine ? "You cannot disable yourself" : ""}
                        onClick={() => setConfirm({ kind: u.disabled ? "enable" : "disable", user: u })}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                      <button
                        type="button"
                        className={`${act} !text-destructive`}
                        disabled={mine || u.orders > 0}
                        title={mine ? "You cannot delete yourself" : u.orders > 0 ? "Has orders: disable instead" : ""}
                        onClick={() => setConfirm({ kind: "delete", user: u })}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && shown.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No users match.</p>
        )}
        {loading && <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>}
      </Panel>

      {dialog && (
        <UserDialog
          key={dialog.user?.id ?? "new"}
          user={dialog.user}
          isMe={dialog.user?.id === me}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            setNotice(msg);
            void load();
          }}
        />
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <AlertDialogContent className="moa-admin-dialog rounded-2xl border-[#262626]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete"
                ? "Delete this account?"
                : confirm?.kind === "disable"
                  ? "Disable this account?"
                  : "Enable this account?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm
                ? confirm.kind === "delete"
                  ? `${nameOf(confirm.user)} will be removed permanently. This cannot be undone.`
                  : confirm.kind === "disable"
                    ? `${nameOf(confirm.user)} will not be able to log in. Their orders and history stay. You can enable them again any time.`
                    : `${nameOf(confirm.user)} will be able to log in again.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runConfirm()}>
              {confirm?.kind === "delete" ? "Delete" : confirm?.kind === "disable" ? "Disable" : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
