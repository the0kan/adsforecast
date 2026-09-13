export const USER_PREFS_KEY = "adsforecast.user.preferences.v2";
export const DEMO_PREFS_KEY = "adsforecast.demo.preferences.v2";
export const BILLING_PREFS_KEY = "adsforecast.billing.preferences.v1";
export const DEMO_BILLING_PREFS_KEY = "adsforecast.demo.billing.preferences.v1";
const LEGACY_STORAGE_PREFIX = ["ad", "profit"].join("");

function legacyStorageKey(key) {
  return key.replace(/^adsforecast/, LEGACY_STORAGE_PREFIX);
}

export const DEFAULT_PREFERENCES = Object.freeze({
  displayName: "",
  timezone: "Europe/Warsaw",
  currency: "USD",
  compactMode: false,
  notifications: {
    analysisReady: true,
    performanceRisk: true,
    weeklyDigest: true,
    productUpdates: false,
  },
  profitModel: {
    cogs: 55,
    fulfillment: 7,
    fees: 3,
  },
});

export const PLAN_CATALOG = Object.freeze([
  {
    id: "starter",
    name: "Starter",
    monthly: 29,
    annualMonthly: 24,
    annualTotal: 290,
    description: "For solo operators proving profitable acquisition.",
    accounts: "1 Meta ad account",
    features: ["1 Meta ad account", "90-day evidence history", "5-layer AI analyst", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 79,
    annualMonthly: 66,
    annualTotal: 790,
    description: "For teams optimizing paid growth every day.",
    accounts: "3 Meta ad accounts",
    recommended: true,
    features: ["Everything in Starter", "3 Meta ad accounts", "395-day history", "Priority analysis and support"],
  },
  {
    id: "scale",
    name: "Scale",
    monthly: 179,
    annualMonthly: 149,
    annualTotal: 1790,
    description: "For agencies and multi-account commerce teams.",
    accounts: "10 Meta ad accounts",
    features: ["Everything in Growth", "10 Meta ad accounts", "Team workflows", "Advanced exports and governance"],
  },
]);

function mergePreferences(value) {
  const parsed = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_PREFERENCES,
    ...parsed,
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...(parsed.notifications || {}) },
    profitModel: { ...DEFAULT_PREFERENCES.profitModel, ...(parsed.profitModel || {}) },
  };
}

function readJson(key) {
  try {
    let raw = localStorage.getItem(key);
    if (raw == null) {
      raw = localStorage.getItem(legacyStorageKey(key));
      if (raw != null) localStorage.setItem(key, raw);
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readPreferences(demo = false) {
  return mergePreferences(readJson(demo ? DEMO_PREFS_KEY : USER_PREFS_KEY));
}

export function writePreferences(value, demo = false) {
  return writeJson(demo ? DEMO_PREFS_KEY : USER_PREFS_KEY, mergePreferences(value));
}

export function updatePreferences(partial, demo = false) {
  const current = readPreferences(demo);
  return writePreferences({
    ...current,
    ...partial,
    notifications: { ...current.notifications, ...(partial.notifications || {}) },
    profitModel: { ...current.profitModel, ...(partial.profitModel || {}) },
  }, demo);
}

export function readBillingPreference(demo = false) {
  const raw = readJson(demo ? DEMO_BILLING_PREFS_KEY : BILLING_PREFS_KEY);
  const validPlan = PLAN_CATALOG.some((plan) => plan.id === raw.plan);
  return {
    cadence: raw.cadence === "annual" ? "annual" : "monthly",
    plan: validPlan ? raw.plan : "growth",
    selectedAt: typeof raw.selectedAt === "string" ? raw.selectedAt : null,
  };
}

export function writeBillingPreference(value, demo = false) {
  const next = {
    cadence: value?.cadence === "annual" ? "annual" : "monthly",
    plan: PLAN_CATALOG.some((plan) => plan.id === value?.plan) ? value.plan : "growth",
    selectedAt: typeof value?.selectedAt === "string" ? value.selectedAt : null,
  };
  return writeJson(demo ? DEMO_BILLING_PREFS_KEY : BILLING_PREFS_KEY, next);
}

export function clearPreferences(demo = false) {
  try {
    const preferenceKey = demo ? DEMO_PREFS_KEY : USER_PREFS_KEY;
    const billingKey = demo ? DEMO_BILLING_PREFS_KEY : BILLING_PREFS_KEY;
    localStorage.removeItem(preferenceKey);
    localStorage.removeItem(billingKey);
    localStorage.removeItem(legacyStorageKey(preferenceKey));
    localStorage.removeItem(legacyStorageKey(billingKey));
    return true;
  } catch {
    return false;
  }
}
