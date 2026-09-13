import { jsonError } from "./response.ts";
import { getSupabaseAdmin } from "./supabase.ts";
import type { User } from "jsr:@supabase/supabase-js@2";

const encoder = new TextEncoder();

function b64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const str = atob(padded);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = (Deno.env.get("OAUTH_STATE_SECRET") || "").trim();
  if (!secret) throw new Error("CONFIG_MISSING");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signed OAuth state: workspace id + Supabase auth user id (JWT subject). */
export async function signMetaOAuthState(payload: { uid: string; ws: string }): Promise<string> {
  const data = {
    ...payload,
    iat: Date.now(),
    nonce: crypto.randomUUID(),
  };
  const body = encoder.encode(JSON.stringify(data));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), body));
  return `${b64Url(body)}.${b64Url(sig)}`;
}

export async function verifyMetaOAuthState(
  state: string,
): Promise<{ uid: string; ws: string } | null> {
  const [b, s] = state.split(".");
  if (!b || !s) return null;
  const body = fromB64Url(b);
  const sig = fromB64Url(s);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), sig, body);
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(body)) as {
    uid?: string;
    ws?: string;
    iat?: number;
  };
  if (!data.uid || !data.ws || !data.iat) return null;
  if (Date.now() - Number(data.iat) > 10 * 60 * 1000) return null;
  return { uid: data.uid, ws: data.ws };
}

export function readBearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

export type AuthResult =
  | { ok: true; user: User; admin: ReturnType<typeof getSupabaseAdmin> }
  | { ok: false; response: Response };

export async function requireBearerUser(req: Request): Promise<AuthResult> {
  const token = readBearer(req);
  if (!token) {
    return {
      ok: false,
      response: jsonError(401, "AUTH_REQUIRED", "Authorization Bearer token is required."),
    };
  }
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return {
      ok: false,
      response: jsonError(
        500,
        "CONFIG_MISSING",
        "Server configuration is incomplete. Missing Supabase credentials.",
      ),
    };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: jsonError(401, "AUTH_REQUIRED", "Invalid or expired session."),
    };
  }
  return { ok: true, user: data.user, admin };
}
