import { getFunctionsBase } from "./config.js";
import { getAccessTokenOrNull } from "./app-auth.js";

const REQUEST_TIMEOUT_MS = 20_000;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithPolicy(url, init, retrySafe) {
  const attempts = retrySafe ? 2 : 1;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (retrySafe && response.status >= 500 && attempt + 1 < attempts) {
        await delay(400 * (2 ** attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) throw error;
      await delay(400 * (2 ** attempt));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError || new Error("AI request failed.");
}

async function request(path, method = "GET", body = null) {
  const base = getFunctionsBase();
  const token = await getAccessTokenOrNull();
  if (!base || !token) return { ok: false, status: 401, data: { message: "Sign in to use AI analysis." } };
  try {
    const response = await fetchWithPolicy(`${base}${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
    }, method === "GET");
    const data = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, data: { ...data, message: data?.message || data?.error || "AI request failed." } };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return { ok: false, status: 0, data: { message: timedOut ? "AI analysis timed out. Try again in a moment." : "AI service is temporarily unreachable." } };
  }
}

export function fetchAiInsights() { return request("/ai-insights"); }
export function runAiAnalysis(range = null) { return request("/ai-analyze", "POST", range || {}); }
