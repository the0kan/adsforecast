/**
 * Public browser origins are safe here because every protected operation still
 * requires a valid Supabase JWT. No cookies are used by these functions.
 */
export const ALLOWED_ORIGIN = "*";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

/** Return 204 response for OPTIONS preflight, or null. */
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return null;
}
