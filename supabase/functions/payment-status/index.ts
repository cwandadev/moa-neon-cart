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

const BASE = Deno.env.get("PAWAPAY_BASE_URL") ?? "https://api.sandbox.pawapay.io"\;
const PENDING = ["SUBMITTED", "ACCEPTED", "PROCESSING", "IN_RECONCILIATION"];

const FRIENDLY: Record<string, string> = {
  PAYER_NOT_FOUND: "We could not find a mobile money account for that number. Check the number and the provider.",
  INVALID_PHONE_NUMBER: "That phone number is not valid. Check it and try again.",
  PAYMENT_NOT_APPROVED: "The payment was not approved on your phone.",
  INSUFFICIENT_BALANCE: "Your mobile money balance is too low for this payment.",
  PAYER_LIMIT_REACHED: "You have reached a limit on your mobile money account.",
  WALLET_LIMIT_REACHED: "You have reached a limit on your mobile money account.",
  AMOUNT_OUT_OF_BOUNDS: "This amount is outside what that provider allows. Try the other provider or contact us.",
  INVALID_AMOUNT: "This amount is outside what that provider allows. Try the other provider or contact us.",
  PROVIDER_TEMPORARILY_UNAVAILABLE: "That provider is not available right now. Try the other one, or try again later.",
  NOT_FOUND: "The payment request did not go through. Please try again.",
};
const friendly = (code?: string | null) =>
  (code && FRIENDLY[code]) || "The payment could not be completed. Please try again.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is asking? Only the owner of an order may see its payment state.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in required" }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u.user) return json({ error: "Sign in required" }, 401);
    const userId = u.user.id;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const code = String(body?.order_code ?? "").trim().toUpperCase().slice(0, 40);
    if (!code) return json({ error: "Missing order number" }, 400);

    const COLS = "id, code, total, payment_status, fulfilment_status, deposit_id, reserved_until, payment_method";
    const loadOrder = async () =>
      (await admin.from("orders").select(COLS).eq("code", code).eq("user_id", userId).maybeSingle()).data as any;

    let order = await loadOrder();
    if (!order) return json({ error: "Order not found." }, 404);

    const lastEvent = async () => {
      if (!order.deposit_id) return null;
      const { data } = await admin
        .from("payment_events")
        .select("status, payload, created_at")
        .eq("order_id", order.id)
        .eq("deposit_id", order.deposit_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    };

    let last = await lastEvent();

    // Safety net for missed callbacks: ask PawaPay directly while a payment is pending.
    if (order.payment_status === "awaiting_payment" && order.deposit_id && last && PENDING.includes(last.status)) {
      try {
        const res = await fetch(`${BASE}/v2/deposits/${order.deposit_id}`, {
          headers: { Authorization: `Bearer ${Deno.env.get("PAWAPAY_API_TOKEN")}` },
        });
        const check: any = await res.json();
        if (check?.status === "FOUND" && check.data) {
          const d = check.data;
          const amount = d.currency === "RWF" ? Number(d.amount) : null;
          await admin.rpc("apply_payment_result", {
            p_order_id: order.id,
            p_deposit_id: order.deposit_id,
            p_status: String(d.status ?? ""),
            p_amount: amount !== null && Number.isFinite(amount) ? amount : null,
            p_failure_code: d.failureReason?.failureCode ?? null,
            p_source: "recheck",
            p_payload: d,
          });
        } else if (check?.status === "NOT_FOUND") {
          // PawaPay never heard of it. Only treat that as a failure once enough time has passed.
          const { data: created } = await admin
            .from("payment_events")
            .select("created_at")
            .eq("order_id", order.id)
            .eq("deposit_id", order.deposit_id)
            .eq("source", "create")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (created && Date.now() - new Date((created as any).created_at).getTime() > 60_000) {
            await admin.rpc("apply_payment_result", {
              p_order_id: order.id,
              p_deposit_id: order.deposit_id,
              p_status: "FAILED",
              p_amount: null,
              p_failure_code: "NOT_FOUND",
              p_source: "recheck",
              p_payload: check,
            });
          }
        }
      } catch (e) {
        console.error("PawaPay recheck failed", e);
      }
      order = (await loadOrder()) ?? order;
      last = await lastEvent();
    }

    const attempt: string | null = last?.status ?? null;
    const failureCode: string | null = last?.payload?.failure_code ?? last?.payload?.failureReason?.failureCode ?? null;

    let phase: "idle" | "waiting" | "paid" | "failed" | "expired" | "cancelled" = "idle";
    if (order.payment_status === "paid") phase = "paid";
    else if (order.payment_status === "expired") phase = "expired";
    else if (order.fulfilment_status === "cancelled") phase = "cancelled";
    else if (order.payment_status === "failed") phase = "failed";
    else if (attempt && PENDING.includes(attempt)) phase = "waiting";
    else if (attempt === "FAILED" || attempt === "REJECTED") phase = "failed";

    return json({
      phase,
      order: {
        code: order.code,
        total: order.total,
        payment_status: order.payment_status,
        fulfilment_status: order.fulfilment_status,
        reserved_until: order.reserved_until,
        provider: order.payment_method,
      },
      message: phase === "failed" ? friendly(failureCode) : null,
      failure_code: phase === "failed" ? failureCode : null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
