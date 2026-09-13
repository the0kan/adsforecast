import json
import os

from playwright.sync_api import sync_playwright


BASE = os.environ.get("UI_AUDIT_BASE", "http://127.0.0.1:4173")
ROUTES = [
    "overview.html?demo=1",
    "campaigns.html?demo=1",
    "profitability.html?demo=1",
    "integrations.html?demo=1",
    "insights.html?demo=1",
    "profile.html?demo=1",
    "settings.html?demo=1",
    "billing.html?demo=1",
    "support.html?demo=1",
]


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")

    data_checks = page.evaluate(
        """
        async (base) => {
          const { buildPageData, normalizeLiveCampaignRows } = await import(`${base}/app-data.js?audit=1`);
          const demo = buildPageData({ useDemoFallback: true });
          const offline = buildPageData({ useDemoFallback: false, liveSource: false });
          const rows = normalizeLiveCampaignRows([{
            campaignId: '1', campaignName: 'Live', spend: 100, purchases: 2,
            purchaseValue: 450, clicks: 20, impressions: 1000, currency: 'PLN'
          }]);
          const live = buildPageData({
            liveCampaigns: rows, useDemoFallback: false, liveSource: true, liveCurrency: 'PLN'
          });
          return {
            demoHasRows: demo.campaigns.length > 0,
            demoIsExplicit: demo.demo && !demo.live,
            demoHasSampleSeries: demo.series.points.length > 0,
            offlineHasNoRows: offline.campaigns.length === 0,
            offlineHasNoSampleSeries: !offline.demo && !offline.live && offline.series.points.length === 0,
            liveHasOneRow: live.campaigns.length === 1,
            liveIsExplicit: live.live && !live.demo,
            liveHasNoSampleSeries: live.series.points.length === 0,
            liveRoasMatchesDisplayedValues: live.metrics.roas === 4.5,
            liveCurrencyPreserved: live.metrics.currency === 'PLN',
            liveHasNoDemoTrendSignal: !live.alerts.some((item) => item.type === 'PROFIT_TREND_DOWN'),
          };
        }
        """,
        BASE,
    )

    demo_results = []
    for route in ROUTES:
        requests = []
        page.on("request", lambda request, bag=requests: bag.append(request.url) if "supabase.co" in request.url else None)
        page.goto(f"{BASE}/{route}", wait_until="networkidle")
        page.wait_for_timeout(200)
        demo_results.append(
            {
                "route": route,
                "remoteDataRequests": requests,
                "badge": page.locator("#dashboard-env-badge").inner_text(),
                "sourceCopy": page.locator("#app-sidebar-status-copy").inner_text(),
            }
        )

    page.goto(f"{BASE}/campaigns.html?demo=1", wait_until="networkidle")
    page.locator("#campaigns-body tr").first.wait_for()
    initial_campaigns = page.locator("#campaigns-body tr").count()
    page.locator("#campaign-search-input").fill("Retargeting")
    searched_campaigns = page.locator("#campaigns-body tr").count()
    page.locator("#campaign-search-input").fill("")
    page.locator("#campaign-filter-select").select_option("losing")
    losing_campaigns = page.locator("#campaigns-body tr").count()
    page.locator('[data-chip-filter="all"]').click()
    restored_campaigns = page.locator("#campaigns-body tr").count()
    campaign_controls = {
        "initialRows": initial_campaigns,
        "searchNarrowsToOne": searched_campaigns == 1,
        "losingFilterWorks": 0 < losing_campaigns < initial_campaigns,
        "allFilterRestoresRows": restored_campaigns == initial_campaigns,
    }

    page.goto(f"{BASE}/overview.html?demo=1", wait_until="networkidle")
    chart_state = {
        "sampleLabelVisible": "Sample data" in page.locator(".performance-chart__head-sub").inner_text(),
        "chartHasAccessibleName": bool(page.locator(".performance-chart__svg").get_attribute("aria-label")),
    }

    page.goto(f"{BASE}/insights.html?demo=1", wait_until="networkidle")
    insight_count_before = page.locator("#insights-list .insight-card").count()
    page.locator("#insights-refresh-btn").click()
    insight_controls = {
        "previewRendersRecommendations": insight_count_before == 3,
        "previewRefreshRemainsStable": page.locator("#insights-list .insight-card").count() == insight_count_before,
    }

    page.goto(f"{BASE}/settings.html?demo=1", wait_until="networkidle")
    page.evaluate(
        """
        () => {
          localStorage.setItem('adsforecast.user.preferences.v2', 'REAL_PREFS_SENTINEL');
          localStorage.removeItem('adsforecast.demo.preferences.v2');
        }
        """
    )
    page.locator("#settings-display-name").fill("Demo-only preference")
    page.locator("#settings-save-preferences").click()
    preference_isolation = page.evaluate(
        """
        () => ({
          realUntouched: localStorage.getItem('adsforecast.user.preferences.v2') === 'REAL_PREFS_SENTINEL',
          demoSavedSeparately: JSON.parse(localStorage.getItem('adsforecast.demo.preferences.v2') || '{}').displayName === 'Demo-only preference'
        })
        """
    )

    page.goto(f"{BASE}/overview.html?demo=1", wait_until="networkidle")
    page.evaluate("() => localStorage.setItem('adsforecast.session.v1', 'REAL_SESSION_SENTINEL')")
    page.locator(".app-account__trigger").click()
    page.locator(".app-account__signout").click()
    page.wait_for_url(f"{BASE}/index.html")
    exit_demo = {
        "landsOnMarketingPage": page.url.endswith("/index.html"),
        "realSessionUntouched": page.evaluate("() => localStorage.getItem('adsforecast.session.v1') === 'REAL_SESSION_SENTINEL'"),
    }

    browser.close()

failures = []
for name, passed in data_checks.items():
    if not passed:
        failures.append(f"data:{name}")
for row in demo_results:
    if row["remoteDataRequests"]:
        failures.append(f"network:{row['route']}")
    if row["badge"].strip().lower() != "demo":
        failures.append(f"badge:{row['route']}")
    if "no live sync" not in row["sourceCopy"].lower():
        failures.append(f"source:{row['route']}")
for name, passed in preference_isolation.items():
    if not passed:
        failures.append(f"preferences:{name}")
for name, passed in exit_demo.items():
    if not passed:
        failures.append(f"exit:{name}")
for name, value in campaign_controls.items():
    if name != "initialRows" and not value:
        failures.append(f"campaignControls:{name}")
for group_name, group in [("chart", chart_state), ("insights", insight_controls)]:
    for name, passed in group.items():
        if not passed:
            failures.append(f"{group_name}:{name}")

print(json.dumps({
    "dataChecks": data_checks,
    "demoRoutes": demo_results,
    "preferenceIsolation": preference_isolation,
    "exitDemo": exit_demo,
    "campaignControls": campaign_controls,
    "chartState": chart_state,
    "insightControls": insight_controls,
    "failures": failures,
}, indent=2))

if failures:
    raise SystemExit(1)
