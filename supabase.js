import { getSupabaseAnonKey, getSupabaseUrl } from "./config.js";

/** @type {import("https://esm.sh/@supabase/supabase-js@2").SupabaseClient | null} */
let client = null;

/**
 * @returns {Promise<import("https://esm.sh/@supabase/supabase-js@2").SupabaseClient | null>}
 */
export async function getSupabaseClient() {
  if (client) return client;
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

/**
 * @returns {Promise<string | null>}
 */
export async function getSupabaseAccessToken() {
  const sb = await getSupabaseClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token || null;
}
