import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { getWorkspaceIdForAuthUser } from "../_shared/workspace.ts";

type Body = {
  accountId?: string;
  accountName?: string;
  currency?: string;
  timezoneName?: string;
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "POST") {
    return jsonError(405, "INTERNAL_ERROR", "Method not allowed.");
  }

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, "INTERNAL_ERROR", "Invalid JSON body.");
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!accountId) {
    return jsonError(400, "META_NO_ACCOUNT", "accountId is required.");
  }

  try {
    const workspaceId = await getWorkspaceIdForAuthUser(auth.admin, auth.user);
    const existing = await auth.admin
      .from("meta_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!existing.data?.id) {
      return jsonError(400, "META_NO_TOKEN", "Connect Meta Ads before selecting an account.");
    }

    const now = new Date().toISOString();
    const upd = await auth.admin
      .from("meta_connections")
      .update({
        account_id: accountId,
        account_name: body.accountName?.trim() || null,
        currency: body.currency?.trim() || null,
        timezone_name: body.timezoneName?.trim() || null,
        status: "connected",
        connected_at: now,
        updated_at: now,
      })
      .eq("workspace_id", workspaceId)
      .select(
        "account_id, account_name, currency, timezone_name, status, connected_at, updated_at",
      )
      .single();

    if (upd.error || !upd.data) {
      return jsonError(500, "INTERNAL_ERROR", "Could not save the selected ad account.");
    }

    const c = upd.data;
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
      },
    });
  } catch {
    return jsonError(500, "INTERNAL_ERROR", "Could not connect the selected account.");
  }
});
