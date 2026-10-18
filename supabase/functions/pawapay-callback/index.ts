import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = Deno.env.get("PAWAPAY_BASE_URL") ?? "https://api.sandbox.pawapay.io";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function check(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("PAWAPAY_API_TOKEN")}` },
  });
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Refund callbacks: ask PawaPay for the real result.
  const refundId = String(body?.refundId ?? "").trim();
  if (UUID.test(refundId)) {
    const { data: ref } = await admin.from("refunds").select("id").eq("id", refundId).maybeSingle();
    if (!ref) return reply({ ok: true });
    let result: any;
    try {
      result = await check(`/v2/refunds/${refundId}`);
    } catch (e) {
      console.error("PawaPay refund check failed", e);
      return reply({ error: "Could not verify" }, 500);
    }
    if (result?.status === "REJECTED") return reply({ error: "Could not verify" }, 500);
    if (result?.status !== "FOUND" || !result.data) return reply({ ok: true });
    const { error } = await admin.rpc("apply_refund_result", {
      p_refund_id: refundId,
      p_status: String(result.data.status ?? ""),
      p_failure_code: result.data.failureReason?.failureCode ?? null,
    });
    if (error) {
      console.error("apply_refund_result failed", error.message);
      return reply({ error: "Could not record" }, 500);
    }
    return reply({ ok: true });
  }

  // Deposit callbacks.
  const depositId = String(body?.depositId ?? "").trim();
  if (!UUID.test(depositId)) return reply({ error: "Invalid request" }, 400);

  const { data: ev } = await admin
    .from("payment_events")
    .select("order_id")
    .eq("deposit_id", depositId)
    .eq("source", "create")
    .limit(1)
    .maybeSingle();
  if (!ev) return reply({ ok: true });

  let result: any;
  try {
    result = await check(`/v2/deposits/${depositId}`);
  } catch (e) {
    console.error("PawaPay status check failed", e);
    return reply({ error: "Could not verify" }, 500);
  }
  if (result?.status === "REJECTED") {
    console.error("PawaPay rejected the status check", JSON.stringify(result?.failureReason ?? {}));
    return reply({ error: "Could not verify" }, 500);
  }
  if (result?.status !== "FOUND" || !result.data) return reply({ ok: true });

  const d = result.data;
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
