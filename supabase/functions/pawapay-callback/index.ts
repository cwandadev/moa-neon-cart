import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = Deno.env.get("PAWAPAY_BASE_URL") ?? "https://api.sandbox.pawapay.io"\;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  const depositId = String(body?.depositId ?? "").trim();
  if (!UUID.test(depositId)) return reply({ error: "Invalid request" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Is this one of our deposits? We stored the id before asking PawaPay.
  const { data: ev } = await admin
    .from("payment_events")
    .select("order_id")
    .eq("deposit_id", depositId)
    .eq("source", "create")
    .limit(1)
    .maybeSingle();
  if (!ev) return reply({ ok: true });

  // Never trust the callback body: ask PawaPay for the real status.
  let check: any;
  try {
    const res = await fetch(`${BASE}/v2/deposits/${depositId}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("PAWAPAY_API_TOKEN")}` },
    });
    check = await res.json();
  } catch (e) {
    console.error("PawaPay status check failed", e);
    return reply({ error: "Could not verify" }, 500);
  }
  if (check?.status === "REJECTED") {
    console.error("PawaPay rejected the status check", JSON.stringify(check?.failureReason ?? {}));
    return reply({ error: "Could not verify" }, 500);
  }
  if (check?.status !== "FOUND" || !check.data) return reply({ ok: true });

  const d = check.data;
  const amount = d.currency === "RWF" ? Number(d.amount) : null;
  const { error } = await admin.rpc("apply_payment_result", {
    p_order_id: ev.order_id,
    p_deposit_id: depositId,
    p_status: String(d.status ?? ""),
    p_amount: amount !== null && Number.isFinite(amount) ? amount : null,
    p_failure_code: d.failureReason?.failureCode ?? null,
    p_source: "callback",
    p_payload: d,
  });
  if (error) {
    console.error("apply_payment_result failed", error.message);
    return reply({ error: "Could not record" }, 500);
  }
  return reply({ ok: true });
});
