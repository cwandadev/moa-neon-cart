import { createClient } from "@supabase/supabase-js";

const supabaseUrl: string | undefined = import.meta.env["VITE_SUPABASE_URL"];
const supabaseKey: string | undefined = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env.local and fill in your project values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
