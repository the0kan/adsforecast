/**
 * AdsForecast API — minimal server (v0)
 * Serves dashboard-shaped JSON for future frontend wiring; add auth + DB later.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { getDashboardPayload } from "../../data.js";
import { runInsightsEngine, DEMO_SIGNALS } from "../../insights-engine.js";

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 3000;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const corsRaw = process.env.CORS_ORIGIN?.trim();
let corsOption = true;
if (corsRaw && corsRaw !== "*") {
  const list = corsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length) corsOption = list;
}

app.use(
  cors({
    origin: corsOption,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "adsforecast-api",
    version: "0.1.1",
    time: new Date().toISOString(),
  });
});

/**
 * Dashboard payload — same shape as client `getDashboardPayload()` + rule engine.
 * Replace with DB-backed assembly when persistence exists.
 */
app.get("/v1/workspaces/:workspaceId/dashboard", (req, res) => {
  const payload = getDashboardPayload();
  if (req.params.workspaceId && payload.workspace?.id) {
    if (req.params.workspaceId !== payload.workspace.id) {
      return res.status(404).json({
        error: "workspace_not_found",
        message: "Unknown workspace (mock only knows seeded id).",
      });
    }
  }

  const { alerts, insights } = runInsightsEngine(payload, {
    signals: DEMO_SIGNALS,
  });

  res.json({
    ...payload,
    alerts,
    insights,
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`AdsForecast API listening on http://${HOST}:${PORT}`);
  console.log(`  GET /v1/health`);
  console.log(`  GET /v1/workspaces/${getDashboardPayload().workspace.id}/dashboard`);
});
