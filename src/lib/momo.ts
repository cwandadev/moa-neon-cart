import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type Provider = "MTN_MOMO_RWA" | "AIRTEL_RWA";

export const PROVIDERS: { id: Provider; label: string; logo: string }[] = [
  { id: "MTN_MOMO_RWA", label: "MTN MoMo", logo: "https://static-content.pawapay.io/company_logos/mtn.png" },
  { id: "AIRTEL_RWA", label: "Airtel Money", logo: "https://static-content.pawapay.io/company_logos/airtel.png" },
];

/** Accepts 0783456789, 783456789, 250783456789 and +250 783 456 789. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = "250" + d.slice(1);
  else if (d.length === 9) d = "250" + d;
  return /^250\d{9}$/.test(d) ? d : null;
}

/** The network a Rwandan number belongs to, judged by its prefix (the server double-checks with PawaPay). */
export function guessProvider(raw: string): Provider | null {
  const n = normalizePhone(raw);
  if (!n) return null;
  const p = n.slice(3, 5);
  if (p === "78" || p === "79") return "MTN_MOMO_RWA";
  if (p === "72" || p === "73") return "AIRTEL_RWA";
  return null;
}

/** Calls an Edge Function and turns its error into a friendly message. */
export async function callFn<T>(name: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
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
