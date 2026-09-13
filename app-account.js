import { getFunctionsBase } from "./config.js";
import { getAccessTokenOrNull } from "./app-auth.js";

const TIMEOUT_MS = 20_000;

async function request(path, options = {}) {
  const base = getFunctionsBase();
  const token = await getAccessTokenOrNull();
  if (!base || !token) return { ok: false, status: 401, data: { message: "Sign in to continue." } };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const method = options.method || "GET";
    const hasBody = options.body != null;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, data: { ...data, message: data?.message || data?.error || "Request could not be completed." } };
  } catch (error) {
    return { ok: false, status: 0, data: { message: error instanceof DOMException && error.name === "AbortError" ? "The request timed out. Please try again." : "The service is temporarily unreachable." } };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchAccountCenter() { return request("/account-center"); }
export function updateAccountCenter(section, fields) { return request("/account-center", { method: "PATCH", body: { section, ...fields } }); }
export function fetchBillingCenter() { return request("/billing-center"); }
export function updateBillingCenter(action, fields = {}) { return request("/billing-center", { method: "POST", body: { action, ...fields } }); }
export function fetchSupportCenter(ticketId = "") { return request(`/support-center${ticketId ? `?ticketId=${encodeURIComponent(ticketId)}` : ""}`); }
export function updateSupportCenter(action, fields) { return request("/support-center", { method: "POST", body: { action, ...fields } }); }
export function fetchAdminConsole(view = "overview", params = {}) {
  const search = new URLSearchParams({ view, ...Object.fromEntries(Object.entries(params).filter(([, value]) => value != null && value !== "").map(([key, value]) => [key, String(value)])) });
  return request(`/admin-console?${search.toString()}`);
}
export function updateAdminConsole(action, fields) { return request("/admin-console", { method: "POST", body: { action, ...fields } }); }
