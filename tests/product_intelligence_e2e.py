import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("ADSFORECAST_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
ARTIFACTS = Path("artifacts/product-intelligence-v2")
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def wait_for_app(page, path):
    page.goto(f"{BASE_URL}/{path}", wait_until="networkidle")
    page.wait_for_selector("html.app-shell-ready")
    page.wait_for_timeout(500)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []

    desktop = browser.new_page(viewport={"width": 1440, "height": 1000})
    desktop.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)
    desktop.on("pageerror", lambda error: errors.append(f"page:{error}"))

    wait_for_app(desktop, "campaigns.html?demo=1")
    logo_href = desktop.locator(".dashboard-sidebar__header .dashboard-logo").get_attribute("href")
    assert logo_href == "overview.html?demo=1", f"{logo_href}; url={desktop.url}; search={desktop.evaluate('location.search')}; errors={errors}"
    assert desktop.locator("#campaign-summary-grid .metric-card").count() == 6
    assert desktop.locator("#campaign-decision-rail article").count() == 4
    assert desktop.locator("#campaign-diagnostic-strip > div").count() == 4
    assert desktop.locator("#campaign-allocation-list .campaign-allocation-row").count() > 0
    assert desktop.locator("#campaign-ai-list li").count() == 3
    assert "Sample Meta dataset" in desktop.locator("#campaign-scope-source").inner_text()
    assert "Sample Meta account" in desktop.locator(".app-sidebar-status").inner_text()

    desktop.locator("#campaign-filter-select").select_option("strong")
    assert "Showing" in desktop.locator("#campaign-result-count").inner_text()
    desktop.locator("#campaign-clear-filters").click()
    desktop.locator(".campaign-detail-button").first.click()
    assert desktop.locator("#campaign-detail-dialog").evaluate("element => element.open")
    dialog_text = desktop.locator("#campaign-detail-dialog").inner_text()
    assert "break-even roas" in dialog_text.lower(), dialog_text
    desktop.locator("[data-dialog-close]").click()
    desktop.screenshot(path=str(ARTIFACTS / "campaigns-desktop.png"), full_page=True)

    desktop.locator(".dashboard-sidebar__header .dashboard-logo").click()
    desktop.wait_for_load_state("networkidle")
    assert desktop.url.endswith("/overview.html?demo=1"), desktop.url

    wait_for_app(desktop, "insights.html?demo=1")
    assert desktop.locator(".ai-summary-grid .metric-card").count() == 6
    assert desktop.locator("#ai-diagnostic-grid > div").count() == 6
    assert desktop.locator("#insights-list .insight-card").count() == 3
    assert desktop.locator("#ai-history-list li").count() >= 2
    assert desktop.locator("#ai-run-status").inner_text().lower() == "sample"
    desktop.locator("#ai-focus-select").select_option("risk")
    assert desktop.locator("#insights-list .insight-card").count() == 1
    desktop.locator("#ai-reset-controls").click()
    assert desktop.locator("#insights-list .insight-card").count() == 3
    desktop.screenshot(path=str(ARTIFACTS / "ai-analyst-desktop.png"), full_page=True)

    for width, height, path in [
        (768, 900, "campaigns.html?demo=1"),
        (320, 850, "campaigns.html?demo=1"),
        (320, 850, "insights.html?demo=1"),
    ]:
        page = browser.new_page(viewport={"width": width, "height": height})
        page.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(f"page:{error}"))
        wait_for_app(page, path)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 2, f"horizontal overflow {overflow}px at {width}px on {path}"
        safe_name = path.split(".")[0]
        page.screenshot(path=str(ARTIFACTS / f"{safe_name}-{width}.png"), full_page=True)
        page.close()

    marketing = browser.new_page(viewport={"width": 1280, "height": 800})
    marketing.route(
        "https://esm.sh/**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/javascript",
            body='export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"test-session"}},error:null})}}}',
        ),
    )
    marketing.goto(f"{BASE_URL}/index.html", wait_until="networkidle")
    marketing.locator("[data-session-action=primary]").first.wait_for()
    marketing.wait_for_function("document.querySelector('[data-session-action=primary]').textContent === 'Open dashboard'")
    assert marketing.locator("[data-session-action=primary]").first.get_attribute("href") == "overview.html"
    assert marketing.locator("[data-session-action=secondary]").first.inner_text() == "Plans & billing"
    marketing.close()

    browser.close()
    assert not errors, "\n".join(errors)

print("Product intelligence browser checks passed.")
