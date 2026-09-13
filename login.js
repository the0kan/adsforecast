/**
 * AdsForecast — Supabase sign-in
 */

import {
  setSession,
  sanitizeNextPageFilename,
  validateDemoEmail,
  validateDemoPassword,
} from "./auth.js";
import { getFunctionsBase, isSupabaseMode } from "./config.js";
import { getSupabaseClient } from "./supabase.js";

const form = document.getElementById("login-form");
const err = document.getElementById("login-error");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const submitBtn = form instanceof HTMLFormElement
  ? form.querySelector('button[type="submit"]')
  : null;
const submitBtnLabel = submitBtn?.querySelector("span");
const magicLinkBtn = document.getElementById("login-magic-link-btn");
const magicLinkBtnLabel = magicLinkBtn?.querySelector("span");

const signupLink = document.querySelector('a[href="signup.html"]');
const nextParam = new URLSearchParams(window.location.search).get("next");
const requestedPlan = new URLSearchParams(window.location.search).get("plan");
const planParam = ["starter", "growth", "scale"].includes(requestedPlan) ? requestedPlan : "";
const requestedCadence = new URLSearchParams(window.location.search).get("cadence");
const cadenceParam = ["monthly", "annual"].includes(requestedCadence) ? requestedCadence : "";
if (signupLink instanceof HTMLAnchorElement && nextParam) {
  signupLink.href = `signup.html?next=${encodeURIComponent(nextParam)}${planParam ? `&plan=${planParam}` : ""}${cadenceParam ? `&cadence=${cadenceParam}` : ""}`;
}

function destinationFromParams(next) {
  const safe = sanitizeNextPageFilename(next);
  if (safe !== "billing.html" || (!planParam && !cadenceParam)) return safe;
  const params = new URLSearchParams();
  if (planParam) params.set("plan", planParam);
  if (cadenceParam) params.set("cadence", cadenceParam);
  return `${safe}?${params.toString()}`;
}

function clearErrors() {
  if (err) {
    err.textContent = "";
    err.classList.remove("auth-error--success");
  }
  emailInput?.removeAttribute("aria-invalid");
  passwordInput?.removeAttribute("aria-invalid");
}

function setSubmitting(submitting) {
  if (!(submitBtn instanceof HTMLButtonElement)) return;
  submitBtn.disabled = submitting;
  submitBtn.setAttribute("aria-busy", submitting ? "true" : "false");
  if (submitBtnLabel) {
    submitBtnLabel.textContent = submitting ? "Signing in..." : "Continue to dashboard";
  }
}

function setMagicSubmitting(submitting) {
  if (!(magicLinkBtn instanceof HTMLButtonElement)) return;
  magicLinkBtn.disabled = submitting;
  magicLinkBtn.setAttribute("aria-busy", submitting ? "true" : "false");
  if (magicLinkBtnLabel) magicLinkBtnLabel.textContent = submitting ? "Sending secure link..." : "Email me a secure login link";
}

function friendlyLoginError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) {
    return "That email and password do not match. If you joined with an email link, use ‘Email me a secure login link’ below.";
  }
  if (message.includes("email not confirmed")) return "Confirm your email first, or request a new secure login link below.";
  if (message.includes("rate limit")) return "Too many attempts. Wait a moment, then request a secure login link.";
  return error?.message || "Could not sign in. Please try again.";
}

async function bootstrapWorkspaceSession(sbSession) {
  const accessToken = sbSession?.access_token || null;
  const user = sbSession?.user || null;
  if (!accessToken || !user?.email) return false;

  const functionsBase = getFunctionsBase();
  if (!functionsBase) throw new Error("missing_functions_url");

  const wsRes = await fetch(`${functionsBase}/workspace-bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email: user.email }),
  });
  const wsData = await wsRes.json().catch(() => ({}));
  if (!wsRes.ok || typeof wsData?.workspace?.id !== "string") {
    throw new Error(wsData?.error || "workspace_bootstrap_failed");
  }

  setSession({
    userId: user.id || `usr_${Date.now()}`,
    email: user.email,
    displayName: user.email.split("@")[0],
    workspaceId: wsData.workspace.id,
    accessToken,
    expiresAt: sbSession?.expires_at
      ? new Date(sbSession.expires_at * 1000).toISOString()
      : null,
    issuedAt: new Date().toISOString(),
  });
  return true;
}

async function completeMagicLinkSignIn() {
  if (!isSupabaseMode()) return;
  const hasAuthReturn = window.location.hash.includes("access_token=") || window.location.search.includes("code=");
  if (!hasAuthReturn) return;
  setSubmitting(true);
  try {
    const sb = await getSupabaseClient();
    if (!sb) throw new Error("supabase_init_failed");
    let { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const code = new URL(window.location.href).searchParams.get("code");
    if (!data?.session && code) {
      const exchange = await sb.auth.exchangeCodeForSession(code);
      if (exchange.error) throw exchange.error;
      data = exchange.data;
    }
    if (!(await bootstrapWorkspaceSession(data?.session))) {
      throw new Error("missing_session");
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.replace(destinationFromParams(next));
  } catch {
    if (err) err.textContent = "Magic link sign-in could not be completed. Please request a new link.";
    setSubmitting(false);
  }
}

void completeMagicLinkSignIn();

if (magicLinkBtn instanceof HTMLButtonElement) {
  magicLinkBtn.addEventListener("click", async () => {
    clearErrors();
    const email = String(emailInput?.value || "").trim();
    const emailRes = validateDemoEmail(email);
    if (!emailRes.ok) {
      if (err) err.textContent = emailRes.message;
      emailInput?.setAttribute("aria-invalid", "true");
      emailInput?.focus();
      return;
    }
    setMagicSubmitting(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) throw new Error("supabase_init_failed");
      const next = sanitizeNextPageFilename(new URLSearchParams(window.location.search).get("next"));
      const redirectUrl = new URL("login.html", window.location.href);
      redirectUrl.searchParams.set("next", next);
      if (planParam && next === "billing.html") redirectUrl.searchParams.set("plan", planParam);
      if (cadenceParam && next === "billing.html") redirectUrl.searchParams.set("cadence", cadenceParam);
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectUrl.toString(), shouldCreateUser: false },
      });
      if (error) throw error;
      if (err) {
        err.classList.add("auth-error--success");
        err.textContent = "Secure link sent. Open the email on this device to enter your dashboard.";
      }
    } catch (error) {
      if (err) err.textContent = friendlyLoginError(error);
    } finally {
      setMagicSubmitting(false);
    }
  });
}

/**
 * @param {HTMLElement | null} el
 * @param {boolean} invalid
 */
function setInvalid(el, invalid) {
  if (el) el.setAttribute("aria-invalid", invalid ? "true" : "false");
}

if (form instanceof HTMLFormElement) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    setSubmitting(true);

    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");

    const emailRes = validateDemoEmail(email);
    if (!emailRes.ok) {
      if (err) err.textContent = emailRes.message;
      setInvalid(
        emailInput instanceof HTMLElement ? emailInput : null,
        true
      );
      if (emailInput instanceof HTMLElement) emailInput.focus();
      setSubmitting(false);
      return;
    }

    const passRes = validateDemoPassword(password, "login");
    if (!passRes.ok) {
      if (err) err.textContent = passRes.message;
      setInvalid(
        passwordInput instanceof HTMLElement ? passwordInput : null,
        true
      );
      if (passwordInput instanceof HTMLElement) passwordInput.focus();
      setSubmitting(false);
      return;
    }

    if (!isSupabaseMode()) {
      if (err) {
        err.textContent =
          "Supabase configuration is missing. Contact support before signing in.";
      }
      setSubmitting(false);
      return;
    }

    const sb = await getSupabaseClient();
    if (!sb) {
      if (err) err.textContent = "Could not initialize Supabase client. Check network/CSP and try again.";
      setSubmitting(false);
      return;
    }

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (err) err.textContent = friendlyLoginError(error);
        setSubmitting(false);
        return;
      }
      const session = data?.session;
      if (!session?.access_token) {
        if (err) err.textContent = "Could not read Supabase session. Please sign in again.";
        setSubmitting(false);
        return;
      }
      await bootstrapWorkspaceSession(session);

      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = destinationFromParams(next);
    } catch {
      if (err) err.textContent = "Could not sign in. Please try again.";
      setSubmitting(false);
    }
  });
}
