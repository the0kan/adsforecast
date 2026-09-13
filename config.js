/**
 * AdsForecast — runtime config (browser, no bundler)
 * Set API base via: <meta name="adsforecast-api-base" content="https://api.example.com">
 * or query ?api=… or localStorage adsforecast.apiBase (e.g. local http://localhost:3000,
 * production Supabase project URL or your deployed API host)
 * Only **http:** and **https:** URLs are accepted (blocks javascript:, data:, etc.).
 */

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeApiBase(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return t;
  } catch {
    return null;
  }
}

const LEGACY_STORAGE_PREFIX = ["ad", "profit"].join("");

function readStorageWithMigration(key) {
  const current = localStorage.getItem(key);
  if (current != null) return current;
  const legacyKey = key.replace(/^adsforecast/, LEGACY_STORAGE_PREFIX);
  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) localStorage.setItem(key, legacy);
  return legacy;
}

/**
 * @returns {string | null}
 */
export function getApiBase() {
  const meta = document.querySelector('meta[name="adsforecast-api-base"]');
  const fromMeta = normalizeApiBase(meta?.getAttribute("content")?.trim());

  let fromQuery = null;
  try {
    fromQuery = normalizeApiBase(
      new URLSearchParams(window.location.search).get("api")
    );
  } catch {
    /* ignore */
  }

  let fromLs = null;
  try {
    fromLs = normalizeApiBase(readStorageWithMigration("adsforecast.apiBase"));
  } catch {
    /* private mode */
  }

  let fromGlobal = null;
  if (typeof window !== "undefined" && window.__ADSFORECAST_API_BASE__) {
    fromGlobal = normalizeApiBase(String(window.__ADSFORECAST_API_BASE__));
  }

  return fromQuery || fromLs || fromGlobal || fromMeta;
}

/**
 * @returns {string | null}
 */
export function getSupabaseUrl() {
  const meta = document.querySelector('meta[name="adsforecast-supabase-url"]');
  const fromMeta = normalizeApiBase(meta?.getAttribute("content")?.trim());
  let fromLs = null;
  try {
    fromLs = normalizeApiBase(readStorageWithMigration("adsforecast.supabase.url"));
  } catch {
    /* ignore */
  }
  return fromLs || fromMeta;
}

/**
 * @returns {string | null}
 */
export function getSupabaseAnonKey() {
  const meta = document.querySelector('meta[name="adsforecast-supabase-anon-key"]');
  const fromMeta = meta?.getAttribute("content")?.trim() || "";
  let fromLs = "";
  try {
    fromLs = readStorageWithMigration("adsforecast.supabase.anonKey") || "";
  } catch {
    /* ignore */
  }
  const key = fromLs || fromMeta;
  return key ? key : null;
}

/**
 * Returns Supabase Edge Functions base URL.
 * Example: https://xyzcompany.supabase.co/functions/v1
 * @returns {string | null}
 */
export function getFunctionsBase() {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/functions/v1`;
}

/**
 * @returns {boolean}
 */
export function isSupabaseMode() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/**
 * Workspace id for dashboard API URL (future: route param / session).
 * @param {{ workspaceId?: string } | null | undefined} session
 */
export function getWorkspaceIdForApi(session) {
  const fromSession = session?.workspaceId?.trim();
  if (fromSession) return fromSession;
  return "ws_nw_01";
}
