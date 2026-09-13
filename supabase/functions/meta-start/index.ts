import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser, signMetaOAuthState } from "../_shared/auth.ts";
import { getWorkspaceIdForAuthUser } from "../_shared/workspace.ts";
import { buildMetaOAuthUrl, loadMetaConfig } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "GET") {
    return jsonError(405, "INTERNAL_ERROR", "Method not allowed.");
  }

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    loadMetaConfig();
  } catch {
    return jsonError(
      500,
      "CONFIG_MISSING",
      "Meta OAuth is not configured (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI).",
    );
  }

  try {
    const workspaceId = await getWorkspaceIdForAuthUser(auth.admin, auth.user);
    const state = await signMetaOAuthState({ uid: auth.user.id, ws: workspaceId });
    const authUrl = buildMetaOAuthUrl(state);
    return jsonOk({ success: true, authUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "CONFIG_MISSING") {
      return jsonError(500, "CONFIG_MISSING", "OAUTH_STATE_SECRET or Supabase configuration is missing.");
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not start Meta OAuth.");
  }
});
