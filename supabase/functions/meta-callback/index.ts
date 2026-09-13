import { handleOptions } from "../_shared/cors.ts";
import { encryptAccessToken } from "../_shared/crypto.ts";
import {
  exchangeCodeForToken,
  fetchAdAccounts,
  loadMetaConfig,
} from "../_shared/meta.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { verifyMetaOAuthState } from "../_shared/auth.ts";
import { assertWorkspaceAccess } from "../_shared/workspace.ts";

function frontendBase(): string {
  return (Deno.env.get("FRONTEND_URL") || "https://adsforecast.com").replace(/\/$/, "");
}

function redirect(meta: string): Response {
  const url = `${frontendBase()}/integrations.html?meta=${encodeURIComponent(meta)}`;
  return Response.redirect(url, 302);
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "GET") {
    return redirect("oauth_error");
  }

  const u = new URL(req.url);
  if (u.searchParams.get("error")) {
    return redirect("denied");
  }

  const code = u.searchParams.get("code") || "";
  const stateRaw = u.searchParams.get("state") || "";
  if (!code || !stateRaw) {
    return redirect("oauth_error");
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
    loadMetaConfig();
  } catch {
    return redirect("oauth_error");
  }

  const state = await verifyMetaOAuthState(stateRaw);
  if (!state) {
    return redirect("oauth_error");
  }

  const { data: authRow } = await admin.auth.admin.getUserById(state.uid);
  if (!authRow?.user) {
    return redirect("oauth_error");
  }

  const allowed = await assertWorkspaceAccess(admin, authRow.user, state.ws);
  if (!allowed) {
    return redirect("oauth_error");
  }

  let token: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    token = await exchangeCodeForToken(code);
  } catch {
    return redirect("oauth_error");
  }

  let encrypted: string;
  try {
    encrypted = await encryptAccessToken(token.access_token);
  } catch {
    return redirect("oauth_error");
  }

  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;

  const upsertPayload = {
    workspace_id: state.ws,
    access_token_encrypted: encrypted,
    token_type: token.token_type || "bearer",
    token_expires_at: expiresAt,
    account_id: null as string | null,
    account_name: null as string | null,
    currency: null as string | null,
    timezone_name: null as string | null,
    status: "connected",
    updated_at: new Date().toISOString(),
    connected_at: new Date().toISOString(),
  };

  const existing = await admin
    .from("meta_connections")
    .select("id")
    .eq("workspace_id", state.ws)
    .maybeSingle();

  let store;
  if (existing.data?.id) {
    store = await admin
      .from("meta_connections")
      .update({
        access_token_encrypted: encrypted,
        token_type: upsertPayload.token_type,
        token_expires_at: expiresAt,
        account_id: null,
        account_name: null,
        currency: null,
        timezone_name: null,
        status: "connected",
        updated_at: upsertPayload.updated_at,
      })
      .eq("workspace_id", state.ws);
  } else {
    const id = `mc_${crypto.randomUUID().replace(/-/g, "")}`;
    store = await admin.from("meta_connections").insert({
      id,
      ...upsertPayload,
    });
  }

  if (store.error) {
    return redirect("oauth_error");
  }

  let accountCount = 0;
  try {
    const accounts = await fetchAdAccounts(token.access_token);
    accountCount = accounts.length;
    if (accounts.length === 1) {
      const a = accounts[0]!;
      await admin
        .from("meta_connections")
        .update({
          account_id: a.id,
          account_name: a.name || null,
          currency: a.currency || null,
          timezone_name: a.timezone_name || null,
          status: "connected",
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", state.ws);
    }
  } catch {
    return redirect("select-account");
  }

  if (accountCount > 1) return redirect("select-account");
  if (accountCount === 0) return redirect("select-account");
  return redirect("connected");
});
