import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

const REQUIRED_TABLES = [
  "app_users",
  "workspaces",
  "workspace_members",
  "meta_connections",
  "meta_sync_logs",
] as const;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "GET") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return jsonError(503, "CONFIG_MISSING", "Backend configuration is incomplete.");
  }

  const checks = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const { error } = await admin.from(table).select("id", { head: true }).limit(1);
      return { table, ok: !error };
    }),
  );

  const failed = checks.filter((check) => !check.ok).map((check) => check.table);
  if (failed.length) {
    return jsonError(503, "DATABASE_NOT_READY", "Backend database schema is incomplete.");
  }

  return jsonOk({
    success: true,
    status: "ok",
    service: "adsforecast-backend",
    database: "connected",
    version: "0.3.0",
    time: new Date().toISOString(),
  });
});
