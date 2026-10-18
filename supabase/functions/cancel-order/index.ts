import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BASE = Deno.env.get("PAWAPAY_BASE_URL") ?? "https://api.sandbox.pawapay.io";
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function pawa(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get("PAWAPAY_API_TOKEN")}`, "Content-Type": "application/json" },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in required" }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u.user) return json({ error: "Sign in required" }, 401);
    const userId = u.user.id;
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    const role = me?.role;
    if (role !== "staff" && role !== "admin") return json({ error: "Only staff can do this" }, 403);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const action = String(body?.action ?? "");
    const code = clip(body?.order_code, 40).toUpperCase();
    if (!code) return json({ error: "Missing order number" }, 400);

    const { data: order } = await admin
      .from("orders")
      .select("id, code, total, payment_status, fulfilment_status, deposit_id, refund_status")
      .eq("code", code)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    // Record the refund first, then ask PawaPay (their guide says to store the id before calling).
    const startRefund = async (reason: string): Promise<{ state: "pending" | "failed"; error?: string }> => {
      if (!order.deposit_id) return { state: "failed", error: "This order has no payment reference. Refund it by hand." };
      const refundId = crypto.randomUUID();
      const { error: insErr } = await admin.from("refunds").insert({
        id: refundId,
        order_id: order.id,
        deposit_id: order.deposit_id,
        amount: order.total,
        reason,
        created_by: userId,
      });
      if (insErr) return { state: "failed", error: insErr.message };
      await admin.from("orders").update({ refund_status: "pending" }).eq("id", order.id);
      let res;
      try {
        res = await pawa("/v2/refunds", {
          method: "POST",
          body: JSON.stringify({
            refundId,
            depositId: order.deposit_id,
            amount: String(order.total),
            currency: "RWF",
          }),
        });
      } catch (e) {
        console.error("PawaPay refund call failed", e);
        return { state: "pending" };
      }
      if (res.data?.status === "REJECTED") {
        const fc = res.data?.failureReason?.failureCode ?? "REJECTED";
        await admin.rpc("apply_refund_result", { p_refund_id: refundId, p_status: "REJECTED", p_failure_code: fc });
        return { state: "failed", error: `PawaPay rejected the refund (${fc}).` };
      }
      return { state: "pending" };
    };

    if (action === "cancel") {
      const reason = clip(body?.reason, 300);
      if (!reason) return json({ error: "Please give a reason." }, 400);
      if (order.payment_status === "paid" && role !== "admin") {
        return json({ error: "Only admins can cancel a paid order, because it refunds the customer." }, 403);
      }
      const { data, error } = await admin.rpc("do_cancel_order", {
        p_order_id: order.id,
        p_by: userId,
        p_reason: reason,
        p_restock: Boolean(body?.restock),
      });
      if (error) return json({ error: error.message }, 400);
      if (!data?.needs_refund) return json({ ok: true, refund: "none" });
      const r = await startRefund(reason);
      return json({ ok: true, refund: r.state, ...(r.error ? { refund_error: r.error } : {}) });
    }

    if (action === "retry-refund") {
      if (role !== "admin") return json({ error: "Only admins can refund" }, 403);
      if (
        order.fulfilment_status !== "cancelled" ||
        order.payment_status !== "paid" ||
        !["none", "failed"].includes(order.refund_status)
      ) {
        return json({ error: "This order does not need a refund." }, 400);
      }
      const r = await startRefund("Refund retry");
      return json({ ok: true, refund: r.state, ...(r.error ? { refund_error: r.error } : {}) });
    }

    if (action === "refund-status") {
      const { data: ref } = await admin
        .from("refunds")
        .select("id, status")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ref && ref.status === "PENDING") {
        try {
          const res = await pawa(`/v2/refunds/${ref.id}`);
          if (res.data?.status === "FOUND" && res.data.data) {
            await admin.rpc("apply_refund_result", {
              p_refund_id: ref.id,
              p_status: String(res.data.data.status ?? ""),
              p_failure_code: res.data.data.failureReason?.failureCode ?? null,
            });
          }
        } catch (e) {
          console.error("PawaPay refund check failed", e);
        }
      }
      const { data: o } = await admin.from("orders").select("refund_status").eq("id", order.id).maybeSingle();
      return json({ ok: true, refund_status: o?.refund_status ?? order.refund_status });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
