/**
 * AdsForecast — client session layer (localStorage today; JWT / cookies later)
 * @module auth
 */

export const SESSION_STORAGE_KEY = "adsforecast.session.v1";
export const AUTH_REQUIRED_STORAGE_KEY = "adsforecast.auth.required";
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
 * @typedef {object} Session
 * @property {string} userId
 * @property {string} email
 * @property {string} [displayName]
 * @property {string} [workspaceId]
 * @property {string | null} [accessToken] Bearer token when backend exists
 * @property {string | null} [expiresAt] ISO-8601
 * @property {string} issuedAt ISO-8601
 */

/**
 * @returns {Session | null}
 */
export function getSession() {
  try {
    const raw = readStorageWithMigration(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.userId !== "string") return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      clearSession();
      return null;
    }
    return /** @type {Session} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * @param {Omit<Session, 'issuedAt'> & Partial<Pick<Session, 'issuedAt'>>} session
 */
export function setSession(session) {
  const full = {
    ...session,
    issuedAt: session.issuedAt || new Date().toISOString(),
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(full));
}

export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY.replace(/^adsforecast/, LEGACY_STORAGE_PREFIX));
}

export function isAuthenticated() {
  return getSession() != null;
}

/** When `"1"`, protected shells redirect to login if no session. Default off for static demos. */
export function isAuthRequired() {
  try {
    return readStorageWithMigration(AUTH_REQUIRED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {string} email
 * @returns {Session}
 */
export function createSessionFromEmail(email) {
  const safe = String(email).trim().toLowerCase();
  const local = safe.split("@")[0] || "member";
  const display = local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    userId: `usr_${safe ? btoa(unescape(encodeURIComponent(safe))).slice(0, 16) : "anon"}`,
    email: safe || "user@example.com",
    displayName: display,
    workspaceId: "ws_nw_01",
    accessToken: null,
    expiresAt: null,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Build a session from POST /v1/auth/login or /v1/auth/signup JSON.
 * @param {{
 *   user: { id: string, email: string, name?: string | null },
 *   workspace: { id: string },
 *   accessToken: string,
 * }} data
 * @returns {Session}
 */
export function createSessionFromAuthResponse(data) {
  const email = data.user.email;
  const name = data.user.name?.trim();
  const local = email.split("@")[0] || "member";
  const display = name
    ? name
    : local
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    userId: data.user.id,
    email,
    displayName: display,
    workspaceId: data.workspace.id,
    accessToken: data.accessToken,
    expiresAt: null,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Redirect unauthenticated users when enforcement is enabled.
 * Skipped when `?dev=1` is present (local debugging).
 */
export function assertAuthenticatedAppShell() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("dev") === "1") return;
  if (!isAuthRequired()) return;
  if (isAuthenticated()) return;

  const file = window.location.pathname.split("/").pop() || "dashboard.html";
  const next = encodeURIComponent(file);
  window.location.replace(`login.html?next=${next}`);
}

export function signOutToLogin() {
  clearSession();
  window.location.href = "login.html";
}

/**
 * Signs out Supabase session if configured, then clears local session.
 * @returns {Promise<void>}
 */
export async function signOutEverywhere() {
  try {
    const { getSupabaseClient } = await import("./supabase.js");
    const sb = await getSupabaseClient();
    if (sb) await sb.auth.signOut();
  } catch {
    /* ignore */
  }
  clearSession();
}

/**
 * Only allow same-site HTML filenames after login (blocks protocol-relative and external redirects).
 * @param {string | null | undefined} next
 * @param {string} [fallback='overview.html']
 * @returns {string}
 */
export function sanitizeNextPageFilename(next, fallback = "overview.html") {
  if (!next || typeof next !== "string") return fallback;
  let s = next.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    return fallback;
  }
  if (
    s.includes("/") ||
    s.includes("\\") ||
    s.includes("..") ||
    s.includes(":") ||
    s.includes("?") ||
    s.includes("#")
  ) {
    return fallback;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html$/.test(s)) {
    return fallback;
  }
  return s;
}

/** Demo signup: minimum password length (not enforced server-side). */
export const DEMO_SIGNUP_PASSWORD_MIN = 8;

/**
 * @param {string} email
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateDemoEmail(email) {
  const s = String(email ?? "").trim();
  if (!s) {
    return { ok: false, message: "Enter your work email." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return { ok: true };
}

/**
 * @param {string} password
 * @param {'login' | 'signup'} mode
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateDemoPassword(password, mode) {
  const s = String(password ?? "");
  if (!s) {
    return { ok: false, message: "Enter your password." };
  }
  if (mode === "signup" && s.length < DEMO_SIGNUP_PASSWORD_MIN) {
    return {
      ok: false,
      message: `Use at least ${DEMO_SIGNUP_PASSWORD_MIN} characters.`,
    };
  }
  return { ok: true };
}
