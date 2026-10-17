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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);

  // 1. Who is calling? Verify the sign-in token ourselves.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "Sign in required" }, 401);
  const userId = userData.user.id;

  // 2. Read and clean the request.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  const items = rawItems.map((i: any) => ({
    product_id: clip(i?.product_id, 200),
    qty: Math.floor(Number(i?.qty)),
  }));
  if (items.length === 0 || items.some((i: any) => !i.product_id || !(i.qty >= 1 && i.qty <= 100))) {
    return json({ error: "Your cart is empty or invalid" }, 400);
  }
  const c = body?.customer ?? {};
  const customer = {
    customer_name: clip(c.customer_name, 100),
    phone: clip(c.phone, 30),
    location: clip(c.location, 200),
    preferred_time: clip(c.preferred_time, 100),
    notes: clip(c.notes, 500),
  };

  // 3. Simple spam guard: at most 5 unpaid orders per hour per visitor.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("payment_status", "awaiting_payment")
    .gte("created_at", since);
  if ((count ?? 0) >= 5) {
    return json({ error: "Too many unpaid orders. Please try again later." }, 429);
  }

  // 4. Create the order. Stock is reserved only when payments are switched on.
  const paymentsEnabled = Boolean(Deno.env.get("PAWAPAY_API_TOKEN"));
  const { data, error } = await admin.rpc("create_checkout_order", {
    p_user_id: userId,
    p_items: items,
    p_customer: customer,
    p_reserve: paymentsEnabled,
  });
  if (error) return json({ error: error.message }, 400);

  return json({ order: data, payments_enabled: paymentsEnabled });
});
