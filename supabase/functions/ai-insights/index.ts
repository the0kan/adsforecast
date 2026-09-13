import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "GET") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }
  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;
  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    const fields = "id,status,provider,model,period_start,period_end,campaign_count,executive_summary,analysis_payload,error_code,created_at,completed_at";
    const [run, history] = await Promise.all([
      auth.admin
        .from("ai_analysis_runs")
        .select(fields)
        .eq("workspace_id", bundle.workspace.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      auth.admin
        .from("ai_analysis_runs")
        .select(fields)
        .eq("workspace_id", bundle.workspace.id)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    if (run.error || history.error) {
      return jsonError(500, "INSIGHTS_LOAD_FAILED", "Could not load AI analysis history.");
    }
    if (!run.data) {
      return jsonOk({ success: true, run: null, recommendations: [], history: history.data || [] });
    }
    const recs = await auth.admin
      .from("ai_recommendations")
      .select("id,campaign_id,campaign_name,action,severity,confidence,title,rationale,evidence,created_at")
      .eq("run_id", run.data.id)
      .order("confidence", { ascending: false });
    if (recs.error) {
      return jsonError(500, "INSIGHTS_LOAD_FAILED", "Could not load AI recommendations.");
    }
    return jsonOk({
      success: true,
      run: run.data,
      recommendations: recs.data || [],
      history: history.data || [],
    });
  } catch {
    return jsonError(500, "INTERNAL_ERROR", "Could not load AI recommendations.");
  }
});
