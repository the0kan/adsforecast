import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { getWorkspaceIdForAuthUser } from "../_shared/workspace.ts";
import { decryptAccessToken } from "../_shared/crypto.ts";
import { fetchAdAccounts } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "GET") {
    return jsonError(405, "INTERNAL_ERROR", "Method not allowed.");
  }

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const workspaceId = await getWorkspaceIdForAuthUser(auth.admin, auth.user);
    const row = await auth.admin
      .from("meta_connections")
      .select("access_token_encrypted")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!row.data?.access_token_encrypted) {
      return jsonError(400, "META_NO_TOKEN", "Connect Meta Ads first to load ad accounts.");
    }

    let accessToken: string;
    try {
      accessToken = await decryptAccessToken(row.data.access_token_encrypted);
    } catch {
      return jsonError(400, "META_TOKEN_INVALID", "Stored Meta token could not be decrypted. Reconnect Meta.");
    }

    let accounts: Awaited<ReturnType<typeof fetchAdAccounts>>;
    try {
      accounts = await fetchAdAccounts(accessToken);
    } catch (e) {
      const meta = (e as Error & { meta?: unknown }).meta;
      const msg =
        meta && typeof meta === "object" && "error" in meta
          ? String((meta as { error?: { message?: string } }).error?.message || "Meta API error.")
          : "Meta API request failed.";
      return jsonError(502, "META_API_ERROR", msg);
    }

    return jsonOk({
      success: true,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency || "",
        timezone_name: a.timezone_name || "",
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "CONFIG_MISSING") {
      return jsonError(500, "CONFIG_MISSING", "TOKEN_ENCRYPTION_SECRET or Supabase configuration is missing.");
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not load Meta ad accounts.");
  }
});
