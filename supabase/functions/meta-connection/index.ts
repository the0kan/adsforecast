import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { getWorkspaceIdForAuthUser } from "../_shared/workspace.ts";

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
      .select(
        "account_id, account_name, currency, timezone_name, status, connected_at, updated_at, access_token_encrypted",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!row.data?.access_token_encrypted) {
      return jsonOk({ success: true, connection: null });
    }

    if (!row.data.account_id) {
      return jsonOk({ success: true, connection: null });
    }

    const c = row.data;
    const latestSync = await auth.admin
      .from("meta_sync_logs")
      .select("status,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return jsonOk({
      success: true,
      connection: {
        accountId: c.account_id,
        accountName: c.account_name,
        currency: c.currency,
        timezoneName: c.timezone_name,
        status: c.status,
        connectedAt: c.connected_at,
        updatedAt: c.updated_at,
        lastSyncAt: latestSync.data?.created_at || null,
        lastSyncStatus: latestSync.data?.status || null,
      },
    });
  } catch {
    return jsonError(500, "INTERNAL_ERROR", "Could not load Meta connection.");
  }
});
