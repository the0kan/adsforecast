import { getFunctionsBase } from "./config.js";
import { getAccessTokenOrNull } from "./app-auth.js";

function normalizeError(data, fallback) {
  return {
    message:
      data?.message ||
      data?.error_description ||
      data?.error ||
      fallback,
  };
}

const REQUEST_TIMEOUT_MS = 15_000;

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
        await delay(350 * (2 ** attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) throw error;
      await delay(350 * (2 ** attempt));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Network request failed.");
}

async function authedFetch(path, options = {}) {
  const base = getFunctionsBase();
  if (!base) {
    return {
      ok: false,
      status: 0,
      data: { message: "Supabase Functions base is missing." },
    };
  }

  const token = await getAccessTokenOrNull();
  if (!token) {
    return {
      ok: false,
      status: 401,
      data: { message: "No Supabase session token found." },
    };
  }

  try {
    const hasBody = options.body != null;
    const method = options.method || "GET";
    const response = await fetchWithPolicy(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      credentials: "omit",
    }, method === "GET");

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: normalizeError(data, "Supabase function request failed."),
      };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {
        message: error instanceof DOMException && error.name === "AbortError"
          ? "The Meta service timed out. Try again in a moment."
          : error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}

export async function fetchMetaConnection() {
  return authedFetch("/meta-connection");
}

export async function fetchMetaAccounts() {
  return authedFetch("/meta-accounts");
}

export async function postMetaConnect(body) {
  return authedFetch("/meta-connect", { method: "POST", body });
}

export async function fetchMetaCampaigns(range = null) {
  const params = new URLSearchParams();
  if (range?.since && range?.until) {
    params.set("since", range.since);
    params.set("until", range.until);
  }
  return authedFetch(`/meta-campaigns${params.size ? `?${params.toString()}` : ""}`);
}

export async function startMetaOauth() {
  const result = await authedFetch("/meta-start");
  if (!result.ok) return result;
  if (typeof result.data?.authUrl !== "string" || !result.data.authUrl.startsWith("http")) {
    return {
      ok: false,
      status: 500,
      data: { message: "Meta OAuth start did not return a valid authUrl." },
    };
  }
  return result;
}

export async function getMetaCampaignContext(knownConnection = null, range = null) {
  const connection = knownConnection
    ? { ok: true, data: { connection: knownConnection } }
    : await fetchMetaConnection();
  if (!connection.ok || !connection.data?.connection) {
    return {
      connected: false,
      connection: null,
      campaigns: [],
      live: false,
      message: connection.data?.message || "No verified Meta connection is available.",
    };
  }

  const campaigns = await fetchMetaCampaigns(range);
  if (!campaigns.ok || !Array.isArray(campaigns.data?.campaigns)) {
    return {
      connected: true,
      connection: connection.data.connection,
      campaigns: [],
      live: false,
      message: campaigns.data?.message || "Live Meta campaigns could not be loaded. No sample data is being shown.",
    };
  }

  return {
    connected: true,
    connection: connection.data.connection,
    campaigns: campaigns.data.campaigns,
    range: campaigns.data.range || range,
    live: true,
    message: "",
  };
}
