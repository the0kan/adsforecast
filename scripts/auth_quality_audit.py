import json
import os

from playwright.sync_api import sync_playwright


BASE = os.environ.get("UI_AUDIT_BASE", "http://127.0.0.1:4173")
results = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for route in ["login.html", "signup.html"]:
        for viewport, width, height in [("mobile", 320, 760), ("desktop", 1440, 900)]:
            page = browser.new_page(viewport={"width": width, "height": height})
            errors = []
            page.on("pageerror", lambda error, bag=errors: bag.append(str(error)))
            page.goto(f"{BASE}/{route}", wait_until="networkidle")
            page.wait_for_timeout(150)
            password_id = "login-password" if route == "login.html" else "signup-password"
            password = page.locator(f"#{password_id}")
            toggle = page.locator("[data-password-toggle]")
            toggle.click()
            reveal_works = password.get_attribute("type") == "text" and toggle.get_attribute("aria-label") == "Hide password"
            toggle.click()
            hide_works = password.get_attribute("type") == "password" and toggle.get_attribute("aria-label") == "Show password"

            page.locator('button[type="submit"]').click()
            expected_focus = "login-email" if route == "login.html" else "signup-email"
            row = page.evaluate(
                """
                ({ expectedFocus, errors, revealWorks, hideWorks }) => ({
                  expectedFocus,
                  focused: document.activeElement?.id || '',
                  errorText: document.querySelector('.auth-error')?.textContent?.trim() || '',
                  buttonEnabled: !document.querySelector('button[type="submit"]')?.disabled,
                  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                  h1Count: document.querySelectorAll('h1').length,
                  unlabeled: [...document.querySelectorAll('input,button,a')].filter((el) => {
                    const visible = el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
                    const labels = el.labels ? [...el.labels].map((label) => label.textContent).join(' ') : '';
                    const name = el.getAttribute('aria-label') || labels || el.textContent || el.getAttribute('title');
                    return visible && !String(name || '').trim();
                  }).map((el) => el.outerHTML.slice(0, 120)),
                  smallTargets: [...document.querySelectorAll('input,button,a')].filter((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
                  }).map((el) => ({ tag: el.tagName, text: (el.textContent || el.id || '').trim(), width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) })),
                  consoleErrors: errors,
                  revealWorks,
                  hideWorks,
                })
                """,
                {"expectedFocus": expected_focus, "errors": errors, "revealWorks": reveal_works, "hideWorks": hide_works},
            )
            row.update({"route": route, "viewport": viewport})
            results.append(row)
            page.close()
    browser.close()

failures = []
for row in results:
    if row["focused"] != row["expectedFocus"]:
        failures.append(f"focus:{row['route']}:{row['viewport']}")
    for key in ["buttonEnabled", "revealWorks", "hideWorks"]:
        if not row[key]:
            failures.append(f"{key}:{row['route']}:{row['viewport']}")
    if not row["errorText"]:
        failures.append(f"errorFeedback:{row['route']}:{row['viewport']}")
    if row["horizontalOverflow"] or row["h1Count"] != 1 or row["unlabeled"] or row["smallTargets"] or row["consoleErrors"]:
        failures.append(f"structure:{row['route']}:{row['viewport']}")

print(json.dumps({"checks": results, "failures": failures}, indent=2))
if failures:
    raise SystemExit(1)
