import { FunctionsHttpError } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ActionMenu, type MenuItem } from "@/components/admin/ActionMenu";
import { AdminSheet } from "@/components/admin/AdminSheet";
import { btn, field, FilterTabs, SearchField, type TabItem } from "@/components/admin/controls";
import { EmptyState, PageHead, Skeleton } from "@/components/moa/ui";
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
import { useAuth } from "@/lib/auth";
import { usePersistedState } from "@/lib/persist";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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

const ROLES: Array<[Role, string, string]> = [
  ["customer", "Customer", "Shops on the storefront."],
  ["staff", "Staff", "Orders, inventory and the inbox."],
  ["admin", "Admin", "Everything, including users and money."],
];

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
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never";

/** A readable temporary password without look-alike characters. */
function makePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", className)}>{children}</span>;
}

// ---------- create or edit ----------

function UserSheet({
  open,
  user,
  isMe,
  onClose,
  onDone,
}: {
  open: boolean;
  user: U | undefined;
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
    if (!first.trim() || !last.trim()) return setError("Enter a first and last name.");
    if (!user && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email.");
    if ((!user || password) && password.length < 8) return setError("The password must be at least 8 characters.");
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
    if (r.error) return setError(r.error);
    onDone(user ? "Changes saved." : "Account created. Give the person their email and temporary password.");
  };

  return (
    <AdminSheet
      open={open}
      onClose={() => !busy && onClose()}
      title={user ? "Edit user" : "Create account"}
      subtitle={user ? user.email : "The account works right away. No confirmation email is sent."}
      footer={
        <div className="grid gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void submit()} className={btn.primary}>
              {busy ? "Saving…" : user ? "Save changes" : "Create account"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" className={field} />
          </Field>
          <Field label="Last name">
            <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" className={field} />
          </Field>
        </div>
        {!user && (
          <Field label="Email">
            <input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </Field>
        )}
        <Field label="Phone (optional)">
          <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250 78…" className={field} />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm text-muted-foreground">Role</legend>
          {ROLES.map(([key, label, hint]) => (
            <label
              key={key}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                role === key ? "border-foreground/60 bg-white/5" : "border-[#262626]",
                isMe ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-white/5",
              )}
            >
              <input type="radio" name="role" className="size-5" checked={role === key} disabled={isMe} onChange={() => setRole(key)} />
              <span>
                <span className="block text-base">{label}</span>
                <span className="block text-sm text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
          {isMe && <span className="text-sm text-muted-foreground">You cannot change your own role.</span>}
        </fieldset>

        <Field
          label={user ? "New temporary password (leave empty to keep the current one)" : "Temporary password"}
          hint="At least 8 characters. Tell the person to change it after signing in."
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={field}
            />
            <button type="button" onClick={() => setPassword(makePassword())} className={btn.ghost}>
              Generate
            </button>
          </div>
        </Field>
      </div>
    </AdminSheet>
  );
}

type Confirm = { kind: "disable" | "enable" | "delete"; user: U } | null;

// ---------- the list ----------

function menuFor(u: U, mine: boolean, h: { edit: (u: U) => void; ask: (c: NonNullable<Confirm>) => void }): MenuItem[] {
  return [
    { label: "Edit", icon: "bx-edit", onSelect: () => h.edit(u) },
    {
      label: u.disabled ? "Enable account" : "Disable account",
      icon: u.disabled ? "bx-lock-open" : "bx-block",
      disabled: mine,
      hint: mine ? "You cannot disable yourself" : u.disabled ? "They can sign in again" : "They cannot sign in. Orders and history stay.",
      onSelect: () => h.ask({ kind: u.disabled ? "enable" : "disable", user: u }),
    },
    {
      label: "Delete account",
      icon: "bx-trash",
      danger: true,
      disabled: mine || u.orders > 0,
      hint: mine ? "You cannot delete yourself" : u.orders > 0 ? "Has orders: disable instead" : "Removed permanently",
      onSelect: () => h.ask({ kind: "delete", user: u }),
    },
  ];
}

function Users() {
  const { isAdmin, ready } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [q, setQ] = usePersistedState("moa:users:q", "");
  const [roleFilter, setRoleFilter] = usePersistedState<"all" | Role>("moa:users:role", "all");
  const [sheet, setSheet] = useState<{ user?: U | undefined } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = useCallback(async () => {
    const r = await call<{ users: U[]; me: string }>({ action: "list" });
    if (r.error || !r.data) {
      setLoadError(r.error ?? "Could not load users.");
    } else {
      setUsers(r.data.users);
      setMe(r.data.me);
      setLoadError("");
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
    const r = await call({ action: kind, id: user.id });
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(kind === "delete" ? "Account deleted." : kind === "disable" ? "Account disabled." : "Account enabled.");
    void load();
  };

  const openSheet = (u?: U) => {
    setSheet({ user: u });
    setSheetOpen(true);
  };

  const handlers = { edit: (u: U) => openSheet(u), ask: (c: NonNullable<Confirm>) => setConfirm(c) };

  if (ready && !isAdmin) {
    return (
      <>
        <PageHead title="Users" subtitle="Manage accounts and roles." />
        <div className="rounded-2xl border border-[#262626] bg-card">
          <EmptyState icon="bx-lock-alt" title="Only admins can manage users" hint="Ask an admin if someone needs an account or a different role." />
        </div>
      </>
    );
  }

  const tabs: TabItem<"all" | Role>[] = [
    { key: "all", label: "All", count: users.length },
    { key: "admin", label: "Admins", count: count("admin") },
    { key: "staff", label: "Staff", count: count("staff"), tone: "info" },
    { key: "customer", label: "Customers", count: count("customer") },
  ];

  return (
    <>
      <PageHead
        title="Users"
        subtitle="Create accounts, change roles, and disable or delete people. Guest visitors are not listed."
        actions={
          <button type="button" onClick={() => openSheet()} className={btn.primary}>
            <i aria-hidden className="bx bx-plus text-lg" /> Create account
          </button>
        }
      />

      <div className="grid gap-3">
        <SearchField value={q} onChange={setQ} label="Search users" placeholder="Search name, email or phone" />
        <FilterTabs items={tabs} value={roleFilter} onChange={setRoleFilter} label="Role" />
      </div>

      <div className="mt-4">
        {loadError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
            <p className="text-destructive">{loadError}</p>
            <button type="button" onClick={() => void load()} className={cn(btn.ghost, "mt-3")}>
              Try again
            </button>
          </div>
        )}

        {loading && !loadError && (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1" aria-label="Loading users">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="rounded-2xl border border-[#262626] bg-card p-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-3 h-4 w-56" />
              </li>
            ))}
          </ul>
        )}

        {!loading && !loadError && shown.length === 0 && (
          <div className="rounded-2xl border border-[#262626] bg-card">
            <EmptyState
              icon="bx-user-x"
              title="No users match"
              hint="Try a different name, or show everyone."
              action={
                <button
                  type="button"
                  className={btn.ghost}
                  onClick={() => {
                    setQ("");
                    setRoleFilter("all");
                  }}
                >
                  Clear search and filter
                </button>
              }
            />
          </div>
        )}

        {shown.length > 0 && (
          <>
            <ul className="grid gap-3 md:grid-cols-2 lg:hidden" aria-label="Users">
              {shown.map((u) => {
                const mine = u.id === me;
                return (
                  <li key={u.id} className="rounded-2xl border border-[#262626] bg-card p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">
                          {nameOf(u)} {mine && <span className="text-sm text-muted-foreground">(you)</span>}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                        {u.phone && <p className="text-sm text-muted-foreground">{u.phone}</p>}
                      </div>
                      <ActionMenu label={`Actions for ${nameOf(u)}`} items={menuFor(u, mine, handlers)} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Pill className={cn("capitalize", ROLE_TONE[u.role])}>{u.role}</Pill>
                      <Pill className={u.disabled ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}>
                        {u.disabled ? "Disabled" : "Active"}
                      </Pill>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      <span className="capitalize">{u.provider}</span> sign-in · last login {day(u.last_sign_in_at)} · {u.orders} order{u.orders === 1 ? "" : "s"}
                    </p>
                    <button type="button" onClick={() => openSheet(u)} className={cn(btn.ghost, "mt-3 w-full")}>
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-hidden rounded-2xl border border-[#262626] bg-card lg:block">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col />
                  <col className="w-28" />
                  <col className="w-32" />
                  <col className="w-36" />
                  <col className="w-20" />
                  <col className="w-28" />
                  <col className="w-16" />
                </colgroup>
                <thead className="border-b border-[#262626] text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Person</th>
                    <th className="px-3 py-3 font-medium">Role</th>
                    <th className="px-3 py-3 font-medium">Signs in with</th>
                    <th className="px-3 py-3 font-medium">Last login</th>
                    <th className="px-3 py-3 font-medium">Orders</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => {
                    const mine = u.id === me;
                    return (
                      <tr key={u.id} className="border-b border-[#262626]/70 align-middle last:border-0 hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <p className="truncate">
                            {nameOf(u)} {mine && <span className="text-xs text-muted-foreground">(you)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Pill className={cn("capitalize", ROLE_TONE[u.role])}>{u.role}</Pill>
                        </td>
                        <td className="px-3 py-3 capitalize text-muted-foreground">{u.provider}</td>
                        <td className="px-3 py-3 text-muted-foreground">{day(u.last_sign_in_at)}</td>
                        <td className="px-3 py-3">{u.orders}</td>
                        <td className="px-3 py-3">
                          <Pill className={u.disabled ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}>
                            {u.disabled ? "Disabled" : "Active"}
                          </Pill>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <ActionMenu label={`Actions for ${nameOf(u)}`} items={menuFor(u, mine, handlers)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {shown.length} of {users.length} people
            </p>
          </>
        )}
      </div>

      {sheet && (
        <UserSheet
          key={sheet.user?.id ?? "new"}
          open={sheetOpen}
          user={sheet.user}
          isMe={sheet.user?.id === me}
          onClose={() => setSheetOpen(false)}
          onDone={(msg) => {
            setSheetOpen(false);
            toast.success(msg);
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
              {confirm?.kind === "delete" ? "Delete this account?" : confirm?.kind === "disable" ? "Disable this account?" : "Enable this account?"}
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
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className={cn("h-11", confirm?.kind === "delete" && "bg-destructive text-white hover:bg-destructive/90")} onClick={() => void runConfirm()}>
              {confirm?.kind === "delete" ? "Delete" : confirm?.kind === "disable" ? "Disable" : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
