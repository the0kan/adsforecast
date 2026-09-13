# Changelog

## 0.11.0 — 2026-08-31

- Split the public marketing experience into focused `Product`, `How it works`, `Pricing`, and `FAQ` pages.
- Reduced the public homepage to four concise decision blocks; the 320 px layout is less than half the previous page height.
- Added a lightweight desktop-only depth treatment with static mobile and reduced-motion fallbacks.
- Added accessible mobile navigation, active-page states, responsive pricing comparison, and working monthly/annual plan controls.
- Added public-route browser coverage, semantic accessibility checks, a sitemap, and expanded visual audit coverage.

## 0.2.0 — 2026-04-20

- **Backend foundation:** PostgreSQL via Prisma (`User`, `Workspace`, `WorkspaceMember`, `Connection`, `SyncJob`), modular `app.js`, routes, controllers, services
- **Auth:** `POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/auth/me` (bcrypt + JWT); `GET /v1/workspaces/:id/dashboard` requires Bearer token + membership (demo metrics + insights merged with DB workspace)
- **Seed:** `npm run db:seed` for demo user/workspace
- **Frontend:** when `adsforecast.apiBase` is set, login/signup call the API and store JWT + workspace id; dashboard sends `Authorization`; 401 redirects to login
- **Docs:** `docs/backend-setup.md`, README backend section; Dockerfile runs `prisma generate`

## 0.1.3 — 2026-04-20

- Alerts: deduplicated dismiss IDs in localStorage; restore-dismissed control; notification badge counts only non-dismissed alerts; empty-state copy for “all dismissed” vs “no engine alerts”
- Integrations: prune stale override keys when payload changes; “Sync now” persists demo meta to localStorage
- Chart: axis lines, grid, point markers, header, pointer tooltips with positioning; dots ignore pointer for hit-testing
- Insights: empty state when the engine returns zero items
- Auth: shared `validateDemoEmail` / `validateDemoPassword` (signup min length 8); `aria-invalid` styling; cross-links preserve `next=` query
- Mobile: fixed notification sheet, full-width alert toolbar + integration buttons, larger dismiss targets

## 0.1.2 — 2026-04-20

- Dashboard: spend vs revenue SVG chart from `performanceSeries`, campaign search (name / status / tags), notifications popover, dismissible alerts (localStorage), integration demo actions + overrides, profit explainer block, loading/skeleton shells, toast feedback for demo actions
- Data: `tags` on campaigns, `profitExplainer` copy in the mock bundle
- Auth: signup respects safe `next=` redirect like login
- Styles: new components (notify panel, chart legend, integration buttons, explainer) aligned with existing tokens

## 0.1.1 — 2026-04-20

- Hardening: validate API base URLs (`http`/`https` only), safe post-login `next` path, stricter dashboard API response checks, defensive rendering
- Server: `X-Powered-By` off, configurable `HOST`, clearer `CORS_ORIGIN` handling

## 0.1.0 — 2026-04-20

- Marketing landing (`index.html`), dashboard UI, mock data layer
- Client metrics (`metrics.js`), rule-based insights (`insights-engine.js`)
- Auth demo (`login.html` / `signup.html`, `auth.js`)
- Express API (`backend/`) with health + dashboard JSON endpoints
- Deployment docs, Dockerfile for API, static hosting configs
