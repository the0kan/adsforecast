from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("UI_AUDIT_BASE", "https://adsforecast.com")
PAGES = [
    ("landing", "/index.html"), ("product-marketing", "/product.html"),
    ("how-it-works", "/how-it-works.html"), ("pricing-marketing", "/pricing.html"),
    ("faq-marketing", "/faq.html"), ("login", "/login.html"), ("signup", "/signup.html"),
    ("overview", "/overview.html?demo=1"), ("campaigns", "/campaigns.html?demo=1"),
    ("profitability", "/profitability.html?demo=1"), ("integrations", "/integrations.html?demo=1"),
    ("ai-analyst", "/insights.html?demo=1"), ("profile", "/profile.html?demo=1"),
    ("settings", "/settings.html?demo=1"),
    ("billing", "/billing.html?demo=1"), ("support", "/support.html?demo=1"),
]
VIEWPORTS = [("mobile", 320, 760), ("tablet", 768, 900), ("desktop", 1440, 900)]
OUT = Path(os.environ.get("UI_AUDIT_OUT", "artifacts/ui-audit"))
OUT.mkdir(parents=True, exist_ok=True)

results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for page_name, route in PAGES:
        for view_name, width, height in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height})
            console_errors = []
            page.on("pageerror", lambda err, target=console_errors: target.append(str(err)))
            page.goto(f"{BASE}{route}", wait_until="networkidle")
            page.wait_for_timeout(350)
            metrics = page.evaluate("""
            () => {
              const root = document.documentElement;
              const visible = [...document.querySelectorAll('a,button,input,select,textarea')]
                .filter(el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden'; });
              const smallTargets = visible.filter(el => {
                const own = el.getBoundingClientRect();
                const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label');
                const labelRect = label ? label.getBoundingClientRect() : own;
                const width = Math.max(own.width, labelRect.width);
                const height = Math.max(own.height, labelRect.height);
                return width < 44 || height < 44;
              })
                .slice(0, 20).map(el => ({tag:el.tagName, text:(el.innerText||el.getAttribute('aria-label')||el.id||'').trim().slice(0,50), width:Math.round(el.getBoundingClientRect().width), height:Math.round(el.getBoundingClientRect().height)}));
              const overflowers = [...document.querySelectorAll('body *')].filter(el => { const r=el.getBoundingClientRect(); return r.width>0 && (r.right > root.clientWidth + 1 || r.left < -1); })
                .slice(0,20).map(el => ({tag:el.tagName, cls:String(el.className||'').slice(0,80), left:Math.round(el.getBoundingClientRect().left), right:Math.round(el.getBoundingClientRect().right)}));
              return {title:document.title, width:root.clientWidth, scrollWidth:root.scrollWidth, horizontalOverflow:root.scrollWidth>root.clientWidth+1, smallTargets, overflowers};
            }
            """)
            metrics.update({"page": page_name, "viewport": view_name, "consoleErrors": console_errors})
            results.append(metrics)
            page.screenshot(path=str(OUT / f"{page_name}-{view_name}.png"), full_page=True)
            page.close()
    browser.close()

(OUT / "report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps({
    "screenshots": len(results),
    "overflow": [f"{r['page']}:{r['viewport']}" for r in results if r['horizontalOverflow']],
    "consoleErrors": sum(len(r['consoleErrors']) for r in results),
    "smallTargetCounts": {f"{r['page']}:{r['viewport']}": len(r['smallTargets']) for r in results if r['smallTargets']},
}, indent=2))
