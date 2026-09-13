import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";
import { decryptAccessToken } from "../_shared/crypto.ts";
import { fetchCampaignInsights } from "../_shared/meta.ts";
import { analyzeCampaigns } from "../_shared/ai.ts";
import { inputErrorResponse, readJsonObject } from "../_shared/validation.ts";

function analysisRange(body: Record<string, unknown>) {
  const until = typeof body.until === "string" ? body.until.trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("RANGE_INVALID");
  const defaultStart = new Date(`${until}T00:00:00Z`);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);
  const since = typeof body.since === "string" ? body.since.trim() : defaultStart.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("RANGE_INVALID");
  const start = new Date(`${since}T00:00:00Z`); const end = new Date(`${until}T00:00:00Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 180) throw new Error("RANGE_INVALID");
  return { since, until, days };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req); if (opt) return opt;
  if (req.method !== "POST") return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  const auth = await requireBearerUser(req); if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(req);
    const range = analysisRange(body);
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    const workspaceId = bundle.workspace.id;
    const recent = await auth.admin.from("ai_analysis_runs").select("id,created_at").eq("workspace_id", workspaceId).eq("requested_by", bundle.user.id).gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1).maybeSingle();
    if (recent.data) return jsonError(429, "ANALYSIS_RATE_LIMITED", "Wait one minute before running another analysis.");
    const connection = await auth.admin.from("meta_connections").select("access_token_encrypted,account_id,currency").eq("workspace_id", workspaceId).maybeSingle();
    if (!connection.data?.access_token_encrypted || !connection.data.account_id) return jsonError(400, "META_NOT_READY", "Connect Meta and select an ad account before running AI analysis.");
    const accessToken = await decryptAccessToken(connection.data.access_token_encrypted);
    const campaigns = await fetchCampaignInsights(accessToken, connection.data.account_id, connection.data.currency || "USD", range);
    const run = await auth.admin.from("ai_analysis_runs").insert({ workspace_id: workspaceId, requested_by: bundle.user.id, period_start: range.since, period_end: range.until, campaign_count: campaigns.length }).select("id").single();
    if (run.error || !run.data) return jsonError(500, "ANALYSIS_CREATE_FAILED", "Could not start the analysis.");
    try {
      const analysis = await analyzeCampaigns(campaigns);
      if (analysis.recommendations.length) {
        const rows = analysis.recommendations.map((item) => ({ run_id: run.data.id, workspace_id: workspaceId, campaign_id: item.campaignId, campaign_name: item.campaignName, action: item.action, severity: item.severity, confidence: Math.max(0, Math.min(1, item.confidence)), title: item.title.slice(0,120), rationale: item.rationale.slice(0,600), evidence: item.evidence }));
        const inserted = await auth.admin.from("ai_recommendations").insert(rows);
        if (inserted.error) throw new Error("RECOMMENDATIONS_INSERT_FAILED");
      }
      const analysisPayload = { version: 1, layers: analysis.layers, scenarios: analysis.scenarios, advisoryOnly: true, automaticExecution: false };
      await auth.admin.from("ai_analysis_runs").update({ status: "completed", provider: analysis.provider, model: analysis.model, executive_summary: analysis.executiveSummary.slice(0,700), analysis_payload: analysisPayload, completed_at: new Date().toISOString() }).eq("id", run.data.id);
      return jsonOk({ success: true, runId: run.data.id, provider: analysis.provider, model: analysis.model, executiveSummary: analysis.executiveSummary, recommendations: analysis.recommendations, analysisPayload, range });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0,80) : "ANALYSIS_FAILED";
      await auth.admin.from("ai_analysis_runs").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", run.data.id);
      return jsonError(502, "ANALYSIS_FAILED", "The analysis service could not complete this run. Try again later.");
    }
  } catch (error) {
    const input = inputErrorResponse(error, jsonError); if (input) return input;
    if (error instanceof Error && error.message === "RANGE_INVALID") return jsonError(422, "RANGE_INVALID", "Analysis range must contain between 1 and 180 valid calendar days.");
    return jsonError(500, "INTERNAL_ERROR", "Could not analyze campaign data.");
  }
});
