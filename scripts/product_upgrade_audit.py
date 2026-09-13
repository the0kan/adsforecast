import json
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:5173"
OUT = Path("artifacts/product-upgrade-local")
OUT.mkdir(parents=True, exist_ok=True)

PAGES = [
    ("overview", "overview.html?demo=1"),
    ("campaigns", "campaigns.html?demo=1"),
    ("profitability", "profitability.html?demo=1"),
    ("ai-analyst", "insights.html?demo=1"),
    ("integrations", "integrations.html?demo=1"),
    ("profile", "profile.html?demo=1"),
    ("settings", "settings.html?demo=1"),
    ("billing", "billing.html?demo=1"),
    ("support", "support.html?demo=1"),
]

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 960}),
    ("tablet", {"width": 768, "height": 1024}),
    ("mobile", {"width": 375, "height": 812}),
    ("landscape", {"width": 812, "height": 375}),
]


def inspect_page(page):
    return page.evaluate(
        """
        () => {
          const root = document.documentElement;
          const interactive = [...document.querySelectorAll('a,button,input,select,textarea,summary')]
            .filter((el) => {
              const s = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
            });
          const tiny = interactive.flatMap((el) => {
            const r = el.getBoundingClientRect();
            return r.width < 24 || r.height < 24 ? [{tag:el.tagName, text:(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0,50), width:Math.round(r.width), height:Math.round(r.height)}] : [];
          });
          return {
            overflow: root.scrollWidth > window.innerWidth + 1,
            scrollWidth: root.scrollWidth,
            viewportWidth: window.innerWidth,
            fontFamily: getComputedStyle(document.body).fontFamily,
            h1: document.querySelector('h1')?.textContent?.trim() || '',
            activeNav: document.querySelector('[aria-current="page"]')?.textContent?.trim() || '',
            tinyTargets: tiny.slice(0,20),
            navLinks: document.querySelectorAll('[data-app-nav]').length,
          };
        }
        """
    )


def main():
    report = {"pages": [], "interactions": {}, "failures": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for viewport_name, viewport in VIEWPORTS:
            for page_name, route in PAGES:
                context = browser.new_context(viewport=viewport, reduced_motion="reduce")
                page = context.new_page()
                console_errors = []
                page_errors = []
                page.on("console", lambda msg, bucket=console_errors: bucket.append(msg.text) if msg.type == "error" else None)
                page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
                page.goto(f"{BASE}/{route}", wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(350)
                metrics = inspect_page(page)
                screenshot = OUT / f"{page_name}-{viewport_name}.png"
                page.screenshot(path=str(screenshot), full_page=True)
                entry = {"page": page_name, "viewport": viewport_name, **metrics, "consoleErrors": console_errors, "pageErrors": page_errors}
                report["pages"].append(entry)
                if metrics["overflow"]:
                    report["failures"].append(f"{page_name}/{viewport_name}: horizontal overflow {metrics['scrollWidth']} > {metrics['viewportWidth']}")
                if "Plus Jakarta Sans" not in metrics["fontFamily"]:
                    report["failures"].append(f"{page_name}/{viewport_name}: product font missing")
                if metrics["navLinks"] != 9:
                    report["failures"].append(f"{page_name}/{viewport_name}: expected 9 navigation destinations, found {metrics['navLinks']}")
                if console_errors or page_errors:
                    report["failures"].append(f"{page_name}/{viewport_name}: browser errors {console_errors + page_errors}")
                if metrics["tinyTargets"]:
                    report["failures"].append(f"{page_name}/{viewport_name}: targets below 24px {metrics['tinyTargets']}")
                context.close()

        context = browser.new_context(viewport={"width": 1440, "height": 960}, accept_downloads=True)
        page = context.new_page()

        page.goto(f"{BASE}/overview.html?demo=1", wait_until="networkidle")
        page.locator(".app-account__trigger").click()
        account_open = page.locator("#app-account-menu").is_visible()
        page.keyboard.press("Escape")
        account_closed = not page.locator("#app-account-menu").is_visible()
        report["interactions"]["accountMenu"] = account_open and account_closed

        page.goto(f"{BASE}/campaigns.html?demo=1", wait_until="networkidle")
        page.locator("#campaign-search-input").fill("Retargeting")
        page.wait_for_timeout(100)
        result_text = page.locator("#campaign-result-count").inner_text()
        page.locator(".campaign-detail-button").first.click()
        campaign_dialog = page.locator("#campaign-detail-dialog").is_visible()
        page.locator("[data-dialog-close]").click()
        report["interactions"]["campaignSearchAndDetail"] = {"result": result_text, "dialog": campaign_dialog}

        page.goto(f"{BASE}/profitability.html?demo=1", wait_until="networkidle")
        page.locator("#profit-model-cogs").fill("50")
        page.locator("#profit-model-fulfillment").fill("6")
        page.locator("#profit-model-fees").fill("3")
        page.locator("#profit-model-form button[type=submit]").click()
        report["interactions"]["profitModel"] = {
            "formula": page.locator("#profit-formula-copy").inner_text(),
            "feedback": page.locator("#profit-model-feedback").inner_text(),
        }

        page.goto(f"{BASE}/insights.html?demo=1", wait_until="networkidle")
        page.locator("#ai-focus-select").select_option("risk")
        ai_count = page.locator("#insights-list .insight-card").count()
        with page.expect_download() as download_info:
            page.locator("#ai-export-btn").click()
        report["interactions"]["aiControlsAndExport"] = {"riskCards": ai_count, "download": bool(download_info.value.suggested_filename)}

        page.goto(f"{BASE}/settings.html?demo=1", wait_until="networkidle")
        page.locator('[data-settings-tab="notifications"]').click()
        notifications_visible = page.locator("#settings-notifications").is_visible()
        page.locator('[data-settings-tab="billing"]').click()
        billing_visible = page.locator("#settings-billing").is_visible()
        report["interactions"]["settingsTabs"] = notifications_visible and billing_visible

        page.goto(f"{BASE}/profile.html?demo=1", wait_until="networkidle")
        page.locator("#profile-display-name").fill("Okan Workspace")
        page.locator("#profile-edit-form button[type=submit]").click()
        report["interactions"]["profileSave"] = page.locator("#profile-save-feedback").inner_text()

        page.goto(f"{BASE}/billing.html?demo=1", wait_until="networkidle")
        page.locator('[data-billing-cadence="annual"]').click()
        annual_pressed = page.locator('[data-billing-cadence="annual"]').get_attribute("aria-pressed") == "true"
        page.locator('[data-choose-plan="growth"]').click()
        billing_dialog = page.locator("#billing-dialog").is_visible()
        page.locator("#billing-save-draft").click()
        draft = page.locator("#billing-checkout-draft").inner_text()
        report["interactions"]["billingDraft"] = {"annual": annual_pressed, "dialog": billing_dialog, "draft": draft}

        mobile = browser.new_context(viewport={"width": 375, "height": 812})
        mobile_page = mobile.new_page()
        mobile_page.goto(f"{BASE}/overview.html?demo=1", wait_until="networkidle")
        mobile_page.locator(".dashboard-menu-toggle").click()
        drawer_open = "dashboard-nav-open" in (mobile_page.locator("body").get_attribute("class") or "")
        mobile_page.keyboard.press("Escape")
        drawer_closed = "dashboard-nav-open" not in (mobile_page.locator("body").get_attribute("class") or "")
        report["interactions"]["mobileDrawer"] = drawer_open and drawer_closed
        mobile.close()

        for key, value in report["interactions"].items():
            passed = value if isinstance(value, bool) else all(value.values()) if isinstance(value, dict) else bool(value)
            if not passed:
                report["failures"].append(f"interaction {key} failed: {value}")
        context.close()
        browser.close()

    (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(report["pages"]), "interactions": report["interactions"], "failures": report["failures"]}, indent=2))
    raise SystemExit(1 if report["failures"] else 0)


if __name__ == "__main__":
    main()
