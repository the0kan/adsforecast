import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("UI_AUDIT_BASE", "http://127.0.0.1:4173")
OUT = Path(os.environ.get("UI_AUDIT_OUT", "artifacts/product-quality"))
OUT.mkdir(parents=True, exist_ok=True)
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


def audit_page(page):
    return page.evaluate(
        r"""
        () => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const text = (el) => (el.innerText || el.textContent || '').trim();
          const accessibleName = (el) =>
            (el.getAttribute('aria-label') ||
             (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
             (el.labels && [...el.labels].map((label) => text(label)).join(' ')) ||
             text(el) || el.getAttribute('title') || '').trim();
          const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
          const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
          const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .filter(visible).map((el) => ({ level: Number(el.tagName.slice(1)), text: text(el).slice(0, 80) }));
          const headingSkips = headings.filter((h, i) => i && h.level > headings[i - 1].level + 1);
          const unnamedControls = [...document.querySelectorAll('a,button,input,select,textarea')]
            .filter(visible).filter((el) => !accessibleName(el)).map((el) => el.outerHTML.slice(0, 140));
          const unlabeledFields = [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')]
            .filter(visible).filter((el) => {
              if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
              if (el.labels && el.labels.length) return false;
              return !el.closest('label');
            }).map((el) => el.id || el.outerHTML.slice(0, 100));
          const imagesWithoutAlt = [...document.querySelectorAll('img')]
            .filter(visible).filter((el) => !el.hasAttribute('alt')).map((el) => el.src);
          const pageText = document.body.innerText;
          return {
            duplicateIds,
            h1Count: headings.filter((h) => h.level === 1).length,
            headingSkips,
            unnamedControls,
            unlabeledFields,
            imagesWithoutAlt,
            mainCount: document.querySelectorAll('main').length,
            skipLink: Boolean(document.querySelector('.skip-link[href="#main-content"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            hasRawMockLabel: /\(mock\)/i.test(pageText),
            hasDemoAuthContradiction: /Auth needed|Session needs refresh/.test(pageText),
          };
        }
        """
    )


results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for route in ROUTES:
        for label, width, height in [("phone", 375, 812), ("landscape", 812, 375), ("desktop", 1440, 900)]:
            page = browser.new_page(viewport={"width": width, "height": height})
            errors = []
            page.on("pageerror", lambda error, bag=errors: bag.append(str(error)))
            page.emulate_media(reduced_motion="reduce")
            page.goto(f"{BASE}/{route}", wait_until="networkidle")
            page.wait_for_timeout(250)
            row = audit_page(page)
            row.update({"route": route, "viewport": label, "consoleErrors": errors})

            if width <= 900:
                menu = page.locator('.dashboard-menu-toggle')
                if menu.count() and menu.is_visible():
                    menu.focus()
                    menu.press('Enter')
                    row["drawerOpensFromKeyboard"] = page.locator('body').evaluate("el => el.classList.contains('dashboard-nav-open')")
                    page.keyboard.press('Escape')
                    row["drawerClosesWithEscape"] = not page.locator('body').evaluate("el => el.classList.contains('dashboard-nav-open')")

            results.append(row)
            page.close()
    browser.close()

failures = []
for row in results:
    for key in [
        "duplicateIds", "headingSkips", "unnamedControls", "unlabeledFields",
        "imagesWithoutAlt", "consoleErrors",
    ]:
        if row.get(key):
            failures.append({"route": row["route"], "viewport": row["viewport"], "check": key, "detail": row[key]})
    for key in ["horizontalOverflow", "hasRawMockLabel", "hasDemoAuthContradiction"]:
        if row.get(key):
            failures.append({"route": row["route"], "viewport": row["viewport"], "check": key})
    for key in ["skipLink", "drawerOpensFromKeyboard", "drawerClosesWithEscape"]:
        if key in row and not row[key]:
            failures.append({"route": row["route"], "viewport": row["viewport"], "check": key})
    if row["h1Count"] != 1 or row["mainCount"] != 1:
        failures.append({"route": row["route"], "viewport": row["viewport"], "check": "documentStructure", "detail": {"h1": row["h1Count"], "main": row["mainCount"]}})

(OUT / "report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps({"checks": len(results), "failures": failures}, indent=2))
