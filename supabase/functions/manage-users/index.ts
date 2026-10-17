import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const ROLES = ["customer", "staff", "admin"];
const EMAIL = /^\S+@\S+\.\S+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Who is calling? Must be a signed-in admin.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in required" }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u.user) return json({ error: "Sign in required" }, 401);
    const callerId = u.user.id;
    const { data: me } = await admin.from("profiles").select("role").eq("id", callerId).maybeSingle();
    if (me?.role !== "admin") return json({ error: "Only admins can manage users" }, 403);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const action = String(body?.action ?? "");

    const otherAdminExists = async (excludeId: string) => {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .neq("id", excludeId);
      return (count ?? 0) > 0;
    };

    // ---- list ----
    if (action === "list") {
      const authUsers: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return json({ error: error.message }, 400);
        authUsers.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const real = authUsers.filter((x) => !x.is_anonymous);
      const { data: profs } = await admin.from("profiles").select("id, first_name, last_name, phone, role").limit(10000);
      const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const { data: ords } = await admin.from("orders").select("user_id").limit(50000);
      const counts = new Map<string, number>();
      for (const o of ords ?? []) counts.set(o.user_id, (counts.get(o.user_id) ?? 0) + 1);

      const users = real.map((x) => {
        const p: any = pmap.get(x.id);
        const providers: string[] = x.app_metadata?.providers ?? [];
        return {
          id: x.id,
          email: x.email ?? "",
          first_name: p?.first_name ?? "",
          last_name: p?.last_name ?? "",
          phone: p?.phone ?? "",
          role: p?.role ?? "customer",
          provider: providers.includes("google") ? "google" : providers.includes("facebook") ? "facebook" : "email",
          last_sign_in_at: x.last_sign_in_at ?? null,
          created_at: x.created_at,
          disabled: x.banned_until ? new Date(x.banned_until).getTime() > Date.now() : false,
          orders: counts.get(x.id) ?? 0,
        };
      });
      users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json({ users, me: callerId });
    }

    // ---- create ----
    if (action === "create") {
      const email = clip(body.email, 200).toLowerCase();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "customer");
      const first = clip(body.first_name, 60);
      const last = clip(body.last_name, 60);
      const phone = clip(body.phone, 30);
      if (!EMAIL.test(email)) return json({ error: "Enter a valid email" }, 400);
      if (password.length < 8) return json({ error: "The password must be at least 8 characters" }, 400);
      if (!ROLES.includes(role)) return json({ error: "Pick a valid role" }, 400);
      if (!first || !last) return json({ error: "Enter a first and last name" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: first, last_name: last },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin
        .from("profiles")
        .update({ first_name: first, last_name: last, phone: phone || null, role })
        .eq("id", data.user.id);
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true, id: data.user.id });
    }

    const id = clip(body.id, 64);

    // ---- update ----
    if (action === "update") {
      if (!id) return json({ error: "Missing user" }, 400);
      const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
      if (!target) return json({ error: "User not found" }, 404);

      const patch: Record<string, unknown> = {};
      if (body.first_name !== undefined) patch.first_name = clip(body.first_name, 60);
      if (body.last_name !== undefined) patch.last_name = clip(body.last_name, 60);
      if (body.phone !== undefined) patch.phone = clip(body.phone, 30) || null;
      if (body.role !== undefined) {
        const role = String(body.role);
        if (!ROLES.includes(role)) return json({ error: "Pick a valid role" }, 400);
        if (role !== target.role) {
          if (id === callerId) return json({ error: "You cannot change your own role" }, 400);
          if (target.role === "admin" && !(await otherAdminExists(id))) {
            return json({ error: "The last admin cannot be demoted" }, 400);
          }
          patch.role = role;
        }
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from("profiles").update(patch).eq("id", id);
        if (error) return json({ error: error.message }, 400);
      }
      if (body.password) {
        const password = String(body.password);
        if (password.length < 8) return json({ error: "The password must be at least 8 characters" }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    // ---- disable / enable ----
    if (action === "disable" || action === "enable") {
      if (!id) return json({ error: "Missing user" }, 400);
      if (action === "disable") {
        if (id === callerId) return json({ error: "You cannot disable your own account" }, 400);
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        if (target?.role === "admin" && !(await otherAdminExists(id))) {
          return json({ error: "The last admin cannot be disabled" }, 400);
        }
      }
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: action === "disable" ? "876000h" : "none",
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---- delete ----
    if (action === "delete") {
      if (!id) return json({ error: "Missing user" }, 400);
      if (id === callerId) return json({ error: "You cannot delete your own account" }, 400);
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("user_id", id);
      if ((count ?? 0) > 0) {
        return json({ error: "This person has orders. Disable the account instead, so your sales records stay intact." }, 400);
      }
      const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
      if (target?.role === "admin" && !(await otherAdminExists(id))) {
        return json({ error: "The last admin cannot be deleted" }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
