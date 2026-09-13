import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_ORIGIN = os.environ.get("ADSFORECAST_TEST_ORIGIN", "http://127.0.0.1:4173").rstrip("/")
SCREENSHOT_DIR = Path(os.environ.get("MARKETING_SCREENSHOT_DIR", "/tmp/adsforecast-marketing-tests"))
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

PUBLIC_PAGES = [
    ("home", "index.html", "Find the campaigns worth your next dollar."),
    ("product", "product.html", "From ad metrics to margin decisions."),
    ("how", "how-it-works.html", "Connected in minutes. Controlled by you."),
    ("pricing", "pricing.html", "Choose capacity, not complexity."),
    ("faq", "faq.html", "Clear before you connect."),
]

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 1000}),
    ("tablet", {"width": 768, "height": 1024}),
    ("mobile", {"width": 375, "height": 812}),
    ("small-mobile", {"width": 320, "height": 700}),
    ("landscape", {"width": 812, "height": 375}),
]


def assert_no_page_overflow(page, label):
    dimensions = page.evaluate(
        """() => ({
          viewport: document.documentElement.clientWidth,
          page: document.documentElement.scrollWidth,
          body: document.body.scrollWidth
        })"""
    )
    assert dimensions["page"] <= dimensions["viewport"] + 1, f"{label} document overflow: {dimensions}"
    assert dimensions["body"] <= dimensions["viewport"] + 1, f"{label} body overflow: {dimensions}"


def assert_accessibility_basics(page, label):
    audit = page.evaluate(
        """() => {
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
          const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .filter(visible).map((el) => Number(el.tagName.slice(1)));
          return {
            duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
            headingSkips: headings.filter((level, index) => index && level > headings[index - 1] + 1),
            unnamedControls: [...document.querySelectorAll('a,button,input,select,textarea')]
              .filter(visible).filter((el) => {
                const label = el.getAttribute('aria-label') || el.getAttribute('title') ||
                  el.innerText || el.textContent || el.getAttribute('value');
                return !String(label || '').trim();
              }).length,
            imagesWithoutAlt: [...document.querySelectorAll('img')].filter((el) => !el.hasAttribute('alt')).length
          };
        }"""
    )
    assert not audit["duplicateIds"], f"{label} duplicate IDs: {audit['duplicateIds']}"
    assert not audit["headingSkips"], f"{label} skipped heading levels: {audit['headingSkips']}"
    assert audit["unnamedControls"] == 0, f"{label} has unnamed controls"
    assert audit["imagesWithoutAlt"] == 0, f"{label} has images without alt text"


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    console_errors = []

    for page_name, route, expected_h1 in PUBLIC_PAGES:
        for viewport_name, viewport in VIEWPORTS:
            label = f"{page_name}-{viewport_name}"
            page = browser.new_page(viewport=viewport, reduced_motion="reduce")
            page.set_default_timeout(10_000)
            page.route("https://fonts.googleapis.com/**", lambda request: request.fulfill(status=200, content_type="text/css", body=""))
            page.route("https://fonts.gstatic.com/**", lambda request: request.fulfill(status=204, body=""))
            page.on("console", lambda message, name=label: console_errors.append((name, message.text)) if message.type == "error" else None)

            response = page.goto(f"{BASE_ORIGIN}/{route}", wait_until="networkidle", timeout=15_000)
            assert response and response.ok, f"{label} did not load successfully"
            assert page.locator("h1").count() == 1
            assert page.locator("h1").inner_text() == expected_h1
            assert page.locator("main").count() == 1
            assert page.locator(".site-nav a").count() == 4
            assert_no_page_overflow(page, label)
            assert_accessibility_basics(page, label)

            heading_size = float(page.locator("h1").evaluate("el => parseFloat(getComputedStyle(el).fontSize)"))
            assert heading_size <= 68, f"{label} hero heading is oversized: {heading_size}px"

            if page_name == "home":
                assert page.locator("main > section").count() == 4
                assert page.locator('.site-nav a[href="product.html"]').count() == 1
                assert page.locator('.site-nav a[href="how-it-works.html"]').count() == 1
                assert page.locator('.site-nav a[href="pricing.html"]').count() == 1
                assert page.locator('.site-nav a[href="faq.html"]').count() == 1
                page_height = page.evaluate("document.documentElement.scrollHeight")
                if viewport_name == "desktop":
                    assert page_height <= 3400, f"desktop homepage became too long: {page_height}px"
                elif viewport_name in {"mobile", "small-mobile"}:
                    assert page_height <= 5000, f"mobile homepage became too long: {page_height}px"

            if page_name != "home":
                active = page.locator('.site-nav a[aria-current="page"]')
                assert active.count() == 1

            if page_name == "pricing" and viewport_name == "desktop":
                page.locator('[data-pricing-cadence="annual"]').click()
                assert page.locator(".pricing-card--featured [data-price]").inner_text() == "$66"
                growth_href = page.locator('.pricing-card [data-plan-link][data-plan="growth"]').get_attribute("href")
                assert growth_href.endswith("plan=growth&cadence=annual")

            if viewport["width"] <= 900:
                toggle = page.locator(".mobile-nav-toggle")
                assert toggle.is_visible()
                assert toggle.get_attribute("aria-label") == "Open navigation"
                toggle.focus()
                page.keyboard.press("Enter")
                assert toggle.get_attribute("aria-expanded") == "true"
                assert page.locator(".site-nav").get_attribute("aria-hidden") == "false"
                page.keyboard.press("Escape")
                assert toggle.get_attribute("aria-expanded") == "false"

            page.screenshot(path=str(SCREENSHOT_DIR / f"{label}.png"), full_page=True)
            page.close()

    flow_page = browser.new_page(viewport={"width": 1280, "height": 800})
    flow_page.route("https://fonts.googleapis.com/**", lambda request: request.fulfill(status=200, content_type="text/css", body=""))
    flow_page.goto(f"{BASE_ORIGIN}/signup.html?next=billing.html&plan=growth&cadence=annual", wait_until="networkidle")
    login_href = flow_page.locator('.auth-footer a[href^="login.html"]').get_attribute("href")
    assert login_href == "login.html?next=billing.html&plan=growth&cadence=annual"
    flow_page.goto(f"{BASE_ORIGIN}/login.html?next=billing.html&plan=growth&cadence=annual", wait_until="networkidle")
    signup_href = flow_page.locator('.auth-footer a[href^="signup.html"]').get_attribute("href")
    assert signup_href == "signup.html?next=billing.html&plan=growth&cadence=annual"
    flow_page.close()

    assert not console_errors, f"Browser console errors: {console_errors}"
    browser.close()

print("marketing-e2e: public routes, responsive navigation and pricing passed")
