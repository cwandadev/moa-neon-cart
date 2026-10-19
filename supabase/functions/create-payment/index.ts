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

const BASE = Deno.env.get("PAWAPAY_BASE_URL") ?? "https://api.sandbox.pawapay.io";
const PROVIDERS = ["MTN_MOMO_RWA", "AIRTEL_RWA"];
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

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
};
const friendly = (code?: string | null) =>
  (code && FRIENDLY[code]) || "The payment could not be completed. Please try again.";

// Accepts 0783456789, 783456789, 250783456789 and +250 783 456 789.
function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "250" + d.slice(1);
  else if (d.length === 9) d = "250" + d;
  return /^250\d{9}$/.test(d) ? d : null;
}

async function pawa(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get("PAWAPAY_API_TOKEN")}`,
      "Content-Type": "application/json",
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data };
}

// Ask PawaPay which network a number belongs to. Returns null when it cannot tell.
async function detectProvider(phone: string): Promise<string | null> {
  try {
    const r = await pawa("/v2/predict-provider", { method: "POST", body: JSON.stringify({ phoneNumber: phone }) });
    const p = r.data?.provider;
    return r.ok && PROVIDERS.includes(p) ? p : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Who is calling? Verify the sign-in token ourselves.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in required" }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u.user) return json({ error: "Sign in required" }, 401);
    const userId = u.user.id;

    if (!Deno.env.get("PAWAPAY_API_TOKEN")) {
      return json({ error: "Online payments are not switched on yet." }, 503);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const action = String(body?.action ?? "pay");

    // 2. Clean the number and guess the provider (used by the retry screen).
    if (action === "predict") {
      const phone = normalizePhone(body.phone);
      if (!phone) return json({ error: "Enter a valid Rwandan phone number." }, 400);
      const r = await pawa("/v2/predict-provider", { method: "POST", body: JSON.stringify({ phoneNumber: phone }) });
      if (!r.ok || !r.data?.phoneNumber) return json({ phone, provider: null });
      const provider = PROVIDERS.includes(r.data.provider) ? r.data.provider : null;
      return json({ phone: String(r.data.phoneNumber), provider });
    }

    if (action !== "pay") return json({ error: "Unknown action" }, 400);

    // 3. Pay an order. The amount comes from the order, never from the browser.
    const code = clip(body.order_code, 40).toUpperCase();
    const hint = String(body.provider ?? "");
    const phone = normalizePhone(body.phone);
    if (!code) return json({ error: "Missing order number" }, 400);
    if (!phone) return json({ error: "Enter a valid Rwandan phone number." }, 400);

    // The network comes from PawaPay. The screen's own guess (if any) is only a fallback.
    const provider = (await detectProvider(phone)) ?? (PROVIDERS.includes(hint) ? hint : "");
    if (!provider) {
      return json(
        { error: "We could not tell which network this number is on. Check the number: only MTN and Airtel numbers can be used." },
        400,
      );
    }

    const { data: order } = await admin
      .from("orders")
      .select("id, code, total")
      .eq("code", code)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order) return json({ error: "Order not found." }, 404);

    // 4. Store the deposit ID BEFORE calling PawaPay (the database also checks the order is payable).
    const depositId = crypto.randomUUID();
    const { error: startErr } = await admin.rpc("start_payment", {
      p_order_id: order.id,
      p_user_id: userId,
      p_deposit_id: depositId,
      p_provider: provider,
    });
    if (startErr) return json({ error: startErr.message }, 400);

    // 5. Ask PawaPay to collect the money.
    let res;
    try {
      res = await pawa("/v2/deposits", {
        method: "POST",
        body: JSON.stringify({
          depositId,
          amount: String(order.total),
          currency: "RWF",
          payer: { type: "MMO", accountDetails: { phoneNumber: phone, provider } },
        }),
      });
    } catch (e) {
      console.error("PawaPay call failed", e);
      // The deposit may or may not have reached PawaPay. The status check will settle it.
      return json({ ok: true, deposit_id: depositId, code: order.code, status: "PENDING" });
    }

    const status = res.data?.status;
    if (status === "ACCEPTED") {
      await admin.rpc("apply_payment_result", {
        p_order_id: order.id,
        p_deposit_id: depositId,
        p_status: "ACCEPTED",
        p_amount: null,
        p_failure_code: null,
        p_source: "create",
        p_payload: res.data,
      });
      return json({ ok: true, deposit_id: depositId, code: order.code, status: "ACCEPTED" });
    }

    if (status === "REJECTED") {
      const fc = res.data?.failureReason?.failureCode ?? null;
      await admin.rpc("apply_payment_result", {
        p_order_id: order.id,
        p_deposit_id: depositId,
        p_status: "REJECTED",
        p_amount: null,
        p_failure_code: fc,
        p_source: "create",
        p_payload: res.data,
      });
      return json({ error: friendly(fc), failure_code: fc }, 400);
    }

    if (res.status >= 500 || !status) {
      return json({ ok: true, deposit_id: depositId, code: order.code, status: "PENDING" });
    }
    return json({ error: friendly(null) }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
