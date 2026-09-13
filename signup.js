/**
 * AdsForecast — Supabase sign-up
 */

import {
  setSession,
  sanitizeNextPageFilename,
  validateDemoEmail,
  validateDemoPassword,
} from "./auth.js";
import { getFunctionsBase, isSupabaseMode } from "./config.js";
import { getSupabaseClient } from "./supabase.js";

const form = document.getElementById("signup-form");
const err = document.getElementById("signup-error");
const emailInput = document.getElementById("signup-email");
const passwordInput = document.getElementById("signup-password");
const submitBtn = form instanceof HTMLFormElement
  ? form.querySelector('button[type="submit"]')
  : null;
const submitBtnLabel = submitBtn?.querySelector("span");

const loginLink = document.querySelector('a[href="login.html"]');
const nextParam = new URLSearchParams(window.location.search).get("next");
const requestedPlan = new URLSearchParams(window.location.search).get("plan");
const planParam = ["starter", "growth", "scale"].includes(requestedPlan) ? requestedPlan : "";
const requestedCadence = new URLSearchParams(window.location.search).get("cadence");
const cadenceParam = ["monthly", "annual"].includes(requestedCadence) ? requestedCadence : "";
if (loginLink instanceof HTMLAnchorElement && nextParam) {
  loginLink.href = `login.html?next=${encodeURIComponent(nextParam)}${planParam ? `&plan=${planParam}` : ""}${cadenceParam ? `&cadence=${cadenceParam}` : ""}`;
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
    submitBtnLabel.textContent = submitting ? "Creating workspace..." : "Create workspace";
  }
}

function friendlySignupError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("already registered") || message.includes("already been registered")) {
    return "An account already exists for this email. Sign in instead.";
  }
  if (message.includes("rate limit")) return "Too many attempts. Wait a moment, then try again.";
  if (message.includes("password")) return "Use a stronger password with at least 8 characters.";
  return error?.message || "Could not create account. Please try again.";
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

    const passRes = validateDemoPassword(password, "signup");
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
          "Supabase configuration is missing. Contact support before signing up.";
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
      const next = sanitizeNextPageFilename(new URLSearchParams(window.location.search).get("next"));
      const redirectUrl = new URL("login.html", window.location.href);
      redirectUrl.searchParams.set("next", next);
      if (planParam && next === "billing.html") redirectUrl.searchParams.set("plan", planParam);
      if (cadenceParam && next === "billing.html") redirectUrl.searchParams.set("cadence", cadenceParam);
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: email.split("@")[0] },
          emailRedirectTo: redirectUrl.toString(),
        },
      });
      if (error) {
        if (err) err.textContent = friendlySignupError(error);
        setSubmitting(false);
        return;
      }

      // Some Supabase projects require email confirmation and return no active session.
      if (!data?.session?.access_token) {
        if (err) {
          err.classList.add("auth-error--success");
          err.textContent =
            "Account created. Check your inbox and spam folder, verify your email, then sign in.";
        }
        setSubmitting(false);
        return;
      }

      const accessToken = data.session.access_token;
      const functionsBase = getFunctionsBase();
      if (!functionsBase) {
        if (err) err.textContent = "Supabase functions URL is missing.";
        setSubmitting(false);
        return;
      }
      const wsRes = await fetch(`${functionsBase}/workspace-bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email }),
      });
      const wsData = await wsRes.json().catch(() => ({}));
      if (!wsRes.ok || typeof wsData?.workspace?.id !== "string") {
        if (err) {
          err.textContent = wsData?.error
            ? `Could not initialize workspace (${wsData.error}).`
            : "Could not initialize workspace. Try again.";
        }
        setSubmitting(false);
        return;
      }

      setSession({
        userId: data.user?.id || `usr_${Date.now()}`,
        email: data.user?.email || email,
        displayName: data.user?.email?.split("@")[0] || email.split("@")[0],
        workspaceId: wsData.workspace.id,
        accessToken,
        expiresAt: data.session.expires_at
          ? new Date(data.session.expires_at * 1000).toISOString()
          : null,
        issuedAt: new Date().toISOString(),
      });

      if (next === "billing.html" && (planParam || cadenceParam)) {
        const destinationParams = new URLSearchParams();
        if (planParam) destinationParams.set("plan", planParam);
        if (cadenceParam) destinationParams.set("cadence", cadenceParam);
        window.location.href = `${next}?${destinationParams.toString()}`;
      } else {
        window.location.href = next;
      }
    } catch {
      if (err) err.textContent = "Could not create account. Please try again.";
      setSubmitting(false);
    }
  });
}
