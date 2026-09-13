import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("ADSFORECAST_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
OUT = Path("artifacts/launch-control-plane")
OUT.mkdir(parents=True, exist_ok=True)

MOCK_ACCOUNT_MODULE = r'''
const now = new Date().toISOString();
const plan = {id:"growth",name:"Growth",tagline:"For growing teams",status:"active",currency:"USD",monthly_price_cents:7900,annual_price_cents:79000,recommended:true,sort_order:2,features:["Five-layer AI Analyst"],limits:{aiRunsMonthly:60,metaAccounts:3},stripe_product_id:null,stripe_monthly_price_id:null,stripe_annual_price_id:null};
const datasets = {
  overview:{counts:{customers:12,workspaces:8,connectedMetaAccounts:5,openTickets:2,activeSubscriptions:3,failedAiRuns24h:0},readiness:{stripeSecret:false,stripeWebhook:false,metaApp:true,aiProvider:true,tokenEncryption:true,mode:"test"},settings:[{key:"launch.state",value:{customerAccess:"private_beta"}}],billingEvents:[]},
  customers:{total:1,items:[{name:"Okan",email:"owner@example.test",created_at:now,profile:{display_name:"Okan",company_name:"Northwind"},workspace:{name:"Northwind Commerce"},membership:{role:"owner"},subscription:{status:"inactive",plan_id:null}}]},
  workspaces:{total:1,items:[{id:"ws_test",name:"Northwind Commerce",created_at:now,memberCount:2,openTicketCount:1,settings:{currency:"USD",default_period:"30d"},subscription:{status:"inactive"},metaConnection:{status:"connected",account_name:"Meta Test"}}]},
  subscriptions:{total:1,items:[{workspace_id:"ws_test",workspace:{name:"Northwind Commerce"},plan:null,draftPlan:plan,status:"draft",draft_cadence:"annual",current_period_end:null,stripe_subscription_id:null}]},
  plans:{total:1,items:[plan]},
  tickets:{total:1,items:[{id:"tkt_test",subject:"Billing question",category:"billing",priority:"normal",status:"open",last_activity_at:now,customer:{email:"owner@example.test"},workspace:{name:"Northwind Commerce"}}]},
  integrations:{total:1,items:[{workspace_id:"ws_test",workspace:{name:"Northwind Commerce"},account_name:"Meta Test",account_id:"act_1234",currency:"USD",status:"connected",token_expires_at:now,updated_at:now,latestSync:{status:"completed",message:"Campaign evidence refreshed"}}]},
  system:{settings:[{key:"launch.state",value:{customerAccess:"private_beta"},description:"Customer access gate"}],failedBillingEvents:[],failedAiRuns:[]},
  admins:{total:1,items:[{user_id:"usr_test",role:"super_admin",status:"active",created_at:now,user:{name:"Okan",email:"owner@example.test"}}]},
  audit:{total:1,items:[{created_at:now,admin_user_id:"usr_test",action:"plan.updated",target_type:"plan",target_id:"growth",safe_metadata:{fields:["price"]}}]}
};
export async function fetchAdminConsole(view="overview"){return {ok:true,status:200,data:{admin:{role:"super_admin"},data:datasets[view]||datasets.overview}}}
export async function updateAdminConsole(){return {ok:true,status:200,data:{saved:true}}}
export async function fetchAccountCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
export async function updateAccountCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
export async function fetchBillingCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
export async function updateBillingCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
export async function fetchSupportCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
export async function updateSupportCenter(){return {ok:false,status:401,data:{message:"Not used"}}}
'''


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    for label, viewport in [
        ("desktop", {"width": 1440, "height": 960}),
        ("tablet", {"width": 768, "height": 1024}),
        ("mobile", {"width": 375, "height": 812}),
        ("small-mobile", {"width": 320, "height": 760}),
    ]:
        context = browser.new_context(viewport=viewport, reduced_motion="reduce")
        page = context.new_page()
        page.route("**/app-account.js?v=1", lambda route: route.fulfill(status=200, content_type="application/javascript", body=MOCK_ACCOUNT_MODULE))
        page.on("console", lambda message, name=label: errors.append(f"{name}:console:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error, name=label: errors.append(f"{name}:page:{error}"))
        page.goto(f"{BASE}/control-center.html?demo=1", wait_until="networkidle")
        page.wait_for_selector("#admin-view .metric-card")
        assert "super admin" in page.locator("#admin-role-copy").inner_text().lower()
        assert page.locator('[data-admin-view="overview"]').get_attribute("aria-pressed") == "true"
        for view in ["customers", "workspaces", "subscriptions", "plans", "tickets", "integrations", "system", "admins", "audit"]:
            page.locator(f'[data-admin-view="{view}"]').click()
            page.wait_for_timeout(40)
            assert page.locator("#admin-view h2").count() > 0, view
        page.locator('[data-admin-view="plans"]').click()
        page.locator('[data-edit-plan="growth"]').click()
        assert page.locator("#admin-record-dialog").evaluate("dialog => dialog.open")
        page.locator("[data-admin-dialog-close]").first.click()
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(80)
        dimensions = page.evaluate("() => ({page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})")
        assert dimensions["page"] <= dimensions["viewport"] + 1, f"{label}: {dimensions}"
        page.screenshot(path=str(OUT / f"admin-{label}.png"), full_page=True)
        context.close()
    browser.close()

assert not errors, "\n".join(errors)
print("launch-control-plane-e2e: all admin views and breakpoints passed")
