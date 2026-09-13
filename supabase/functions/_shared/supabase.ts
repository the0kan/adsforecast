import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AdminClient = SupabaseClient;

export function getSupabaseAdmin(): AdminClient {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY") ||
    ""
  ).trim();
  if (!url || !key) {
    throw new Error("CONFIG_MISSING");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
