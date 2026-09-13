import { getFunctionsBase, isSupabaseMode } from "./config.js";
import { setSession, signOutEverywhere } from "./auth.js";
import { getSupabaseAccessToken, getSupabaseClient } from "./supabase.js";

export async function requireAppSession() {
  if (!isSupabaseMode()) {
    return {
      ok: false,
      reason: "supabase_not_configured",
      uiMessage: "Supabase is not configured on this page. Check meta tags.",
    };
  }
  const sb = await getSupabaseClient();
  if (!sb) {
    return {
      ok: false,
      reason: "supabase_client_failed",
      uiMessage: "Could not initialize Supabase client. Check network or script policy.",
    };
  }
  const { data } = await sb.auth.getSession();
  const session = data?.session || null;
  if (!session?.access_token || !session.user) {
    return {
      ok: false,
      reason: "not_authenticated",
      uiMessage: "Please sign in to continue.",
    };
  }
  return { ok: true, session };
}

export async function bootstrapWorkspace(session) {
  const functionsBase = getFunctionsBase();
  if (!functionsBase) {
    return {
      ok: false,
      reason: "functions_base_missing",
      uiMessage: "Supabase functions URL is missing.",
    };
  }
  try {
    const res = await fetch(`${functionsBase}/workspace-bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email: session.user.email || "" }),
      cache: "no-store",
      credentials: "omit",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data?.workspace?.id !== "string") {
      return {
        ok: false,
        reason: "workspace_bootstrap_failed",
        data,
        uiMessage: data?.message || data?.error || "Could not initialize workspace.",
      };
    }
    const profile = {
      userId: session.user.id,
      email: session.user.email || "user@example.com",
      displayName:
        data.profile?.display_name ||
        session.user.user_metadata?.display_name ||
        (session.user.email || "member").split("@")[0],
      workspaceId: data.workspace.id,
      workspaceName: data.workspace.name || "Workspace",
      membershipRole: data.membership?.role || "member",
      companyName: data.profile?.company_name || "",
      roleTitle: data.profile?.role_title || "",
      locale: data.profile?.locale || "en-US",
      workspaceSettings: data.settings || null,
      subscription: data.subscription || null,
      platformAdmin: data.platformAdmin || null,
      accessToken: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
      issuedAt: new Date().toISOString(),
    };
    setSession(profile);
    return { ok: true, profile };
  } catch (error) {
    return {
      ok: false,
      reason: "workspace_bootstrap_network_failed",
      data: { message: error instanceof Error ? error.message : "network_error" },
      uiMessage: "Could not reach workspace bootstrap. Check Edge Function deployment and CORS.",
    };
  }
}

export function renderAuthRequiredScreen(container, nextPage, details = "") {
  if (!container) return;
  const safeDetails = String(details || "Your session is missing or expired.")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  container.innerHTML = `
    <section class="app-auth-state">
      <div class="app-auth-state__orb" aria-hidden="true"></div>
      <div class="app-auth-state__card">
        <span class="account-kicker">Authentication required</span>
        <h2>Sign in to continue</h2>
        <p>${safeDetails}</p>
        <a class="btn btn--primary" href="login.html?next=${encodeURIComponent(nextPage)}">Sign in to continue</a>
      </div>
    </section>`;
}

export async function signOutAndRedirect() {
  await signOutEverywhere();
  window.location.href = "login.html";
}

export async function getAccessTokenOrNull() {
  return getSupabaseAccessToken();
}
