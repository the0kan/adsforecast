import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { getWorkspaceIdForAuthUser } from "../_shared/workspace.ts";
import { decryptAccessToken } from "../_shared/crypto.ts";
import { fetchCampaignInsights } from "../_shared/meta.ts";

function reportingRange(req: Request): { since: string; until: string; days: number } | null {
  const url = new URL(req.url);
  const since = (url.searchParams.get("since") || "").trim();
  const until = (url.searchParams.get("until") || "").trim();
  if (!since && !until) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("RANGE_INVALID");
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  if (!Number.isFinite(days) || days < 1 || days > 180 || end.getTime() >= tomorrow.getTime()) throw new Error("RANGE_INVALID");
  return { since, until, days };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "GET") {
    return jsonError(405, "INTERNAL_ERROR", "Method not allowed.");
  }

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const range = reportingRange(req);
    const workspaceId = await getWorkspaceIdForAuthUser(auth.admin, auth.user);
    const row = await auth.admin
      .from("meta_connections")
      .select("access_token_encrypted, account_id, currency")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!row.data?.access_token_encrypted) {
      return jsonError(400, "META_NO_TOKEN", "Connect Meta Ads before loading campaigns.");
    }

    const accountId = row.data.account_id;
    if (!accountId) {
      return jsonError(400, "META_NO_ACCOUNT", "Select a Meta ad account before loading campaigns.");
    }

    let accessToken: string;
    try {
      accessToken = await decryptAccessToken(row.data.access_token_encrypted);
    } catch {
      return jsonError(400, "META_TOKEN_INVALID", "Stored Meta token is invalid. Reconnect Meta.");
    }

    const currency = row.data.currency || "USD";

    let campaigns: Awaited<ReturnType<typeof fetchCampaignInsights>>;
    try {
      campaigns = await fetchCampaignInsights(accessToken, accountId, currency, range || undefined);
    } catch (e) {
      const meta = (e as Error & { meta?: unknown }).meta;
      const msg =
        meta && typeof meta === "object" && "error" in meta
          ? String((meta as { error?: { message?: string } }).error?.message || "Meta API error.")
          : e instanceof Error
          ? e.message
          : "Meta API request failed.";
      await auth.admin.from("meta_sync_logs").insert({
        workspace_id: workspaceId,
        status: "error",
        message: msg.slice(0, 2000),
      });
      return jsonError(502, "META_API_ERROR", msg);
    }

    await auth.admin.from("meta_sync_logs").insert({
      workspace_id: workspaceId,
      status: "success",
      message: `campaigns:${campaigns.length};range:${range?.since || "last_30d"}:${range?.until || "preset"}`,
    });

    const filtered = campaigns.filter((c) => c.campaignId);
    return jsonOk({
      success: true,
      campaigns: filtered,
      range: range || { since: filtered[0]?.dateStart || null, until: filtered[0]?.dateStop || null, days: 30 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "RANGE_INVALID") {
      return jsonError(422, "RANGE_INVALID", "Reporting range must use valid dates and contain between 1 and 180 days.");
    }
    if (msg === "CONFIG_MISSING") {
      return jsonError(500, "CONFIG_MISSING", "TOKEN_ENCRYPTION_SECRET or Supabase configuration is missing.");
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not load campaign insights.");
  }
});
