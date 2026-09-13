export type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

export function loadMetaConfig(): {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion: string;
  scopes: string;
} {
  const appId = (Deno.env.get("META_APP_ID") || "").trim();
  const appSecret = (Deno.env.get("META_APP_SECRET") || "").trim();
  const redirectUri = (Deno.env.get("META_REDIRECT_URI") || "").trim();
  const apiVersion = (Deno.env.get("META_API_VERSION") || "v20.0").trim();
  const scopes = (Deno.env.get("META_SCOPES") || "ads_read").trim();
  if (!appId || !appSecret || !redirectUri) throw new Error("CONFIG_MISSING");
  return { appId, appSecret, redirectUri, apiVersion, scopes };
}

export function buildMetaOAuthUrl(state: string): string {
  const cfg = loadMetaConfig();
  const v = cfg.apiVersion.replace(/^v?/, "v");
  const url = new URL(`https://www.facebook.com/${v}/dialog/oauth`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes);
  return url.toString();
}

export async function exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
  const cfg = loadMetaConfig();
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const err = new Error("meta_token_exchange_failed");
    (err as Error & { meta?: unknown }).meta = data;
    throw err;
  }
  return data as unknown as MetaTokenResponse;
}

export type MetaAdAccount = {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
};

export async function fetchAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const cfg = loadMetaConfig();
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/me/adaccounts`);
  url.searchParams.set("fields", "id,name,account_id,currency,timezone_name");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as {
    data?: MetaAdAccount[];
    error?: { message?: string };
  };
  if (!res.ok) {
    const err = new Error(data?.error?.message || "Meta API request failed.");
    (err as Error & { meta?: unknown }).meta = data;
    throw err;
  }
  return Array.isArray(data.data) ? data.data : [];
}

const PURCHASE_ACTION_TYPES = new Set([
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
  "onsite_conversion.purchase",
]);

function pickPurchaseMetric(actions: Array<{ action_type?: string; value?: string }> | undefined) {
  if (!Array.isArray(actions)) return 0;
  // Meta exposes the same conversion through several aliases (purchase,
  // omni_purchase and pixel purchase). Summing aliases multiplies revenue and
  // purchase counts. The largest equivalent value is the safest canonical row.
  return actions.reduce((best, item) => {
    if (!item.action_type || !PURCHASE_ACTION_TYPES.has(item.action_type)) return best;
    return Math.max(best, Number(item.value || 0) || 0);
  }, 0);
}

export type CampaignInsightRow = {
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpc: number;
  ctr: number;
  impressions: number;
  clicks: number;
  dateStart: string | null;
  dateStop: string | null;
  currency: string;
};

export async function fetchCampaignInsights(
  accessToken: string,
  accountId: string,
  currency: string,
  range?: { since: string; until: string },
): Promise<CampaignInsightRow[]> {
  const cfg = loadMetaConfig();
  const clean = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${clean}/insights`);
  if (range) url.searchParams.set("time_range", JSON.stringify({ since: range.since, until: range.until }));
  else url.searchParams.set("date_preset", "last_30d");
  url.searchParams.set("level", "campaign");
  url.searchParams.set("limit", "500");
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,spend,actions,action_values,purchase_roas,cpc,ctr,clicks,impressions,date_start,date_stop",
  );
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>[];
    error?: { message?: string };
    paging?: { next?: string };
  };

  if (!res.ok) {
    const err = new Error(data?.error?.message || "Meta API request failed.");
    (err as Error & { meta?: unknown }).meta = data;
    throw err;
  }

  const rows: Record<string, unknown>[] = [];
  let page = data;
  for (let i = 0; i < 10 && page?.data; i++) {
    rows.push(...page.data);
    if (!page.paging?.next) break;
    const nextRes = await fetch(page.paging.next, { headers: { Accept: "application/json" } });
    page = (await nextRes.json().catch(() => ({}))) as typeof data;
    if (!nextRes.ok) break;
  }

  return rows.map((r) => {
    const actions = r.actions as Array<{ action_type?: string; value?: string }> | undefined;
    const actionValues = r.action_values as
      | Array<{ action_type?: string; value?: string }>
      | undefined;
    const purchases = pickPurchaseMetric(actions);
    const purchaseValue = pickPurchaseMetric(actionValues);
    const spend = Number(r.spend || 0) || 0;
    const roasArr = r.purchase_roas as Array<{ value?: string }> | undefined;
    const roasFromApi = Number(Array.isArray(roasArr) ? roasArr[0]?.value : 0) || 0;
    const roas = roasFromApi > 0 ? roasFromApi : spend > 0 ? purchaseValue / spend : 0;
    return {
      campaignId: String(r.campaign_id || ""),
      campaignName: String(r.campaign_name || "Campaign"),
      spend,
      purchases,
      purchaseValue,
      roas,
      cpc: Number(r.cpc || 0) || 0,
      ctr: Number(r.ctr || 0) || 0,
      impressions: Number(r.impressions || 0) || 0,
      clicks: Number(r.clicks || 0) || 0,
      dateStart: typeof r.date_start === "string" ? r.date_start : null,
      dateStop: typeof r.date_stop === "string" ? r.date_stop : null,
      currency,
    };
  });
}
