import { corsHeaders } from "./cors.ts";

const JSON_TYPE = "application/json; charset=utf-8";

export function jsonOk(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": JSON_TYPE },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code,
      message,
      error: message,
    }),
    { status, headers: { ...corsHeaders(), "Content-Type": JSON_TYPE } },
  );
}
