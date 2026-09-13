# Backend setup (Phase 1)

Stack: **Node.js**, **Express**, **PostgreSQL**, **Prisma**, **JWT** (access tokens), **bcrypt** (passwords). Production commonly uses **Neon** (or Supabase / Render / Railway) for Postgres — set `DATABASE_URL` accordingly.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local or Docker)

## 1. Create database

```bash
createdb adsforecast
# or Docker:
# docker run --name adsforecast-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=adsforecast -p 5432:5432 -d postgres:16
```

## 2. Configure environment

```bash
cd backend
cp .env.example .env
```

Edit `DATABASE_URL`, `JWT_SECRET` (≥16 random characters), `CORS_ORIGIN` (comma-separated origins), and **`TOKEN_ENCRYPTION_SECRET`** (any strong random string; **required when `NODE_ENV=production`** — Meta user tokens are encrypted at rest with AES-256-GCM). In non-production, if it is missing, the server logs a warning and uses a dev-only derived key (not for real customers).

**Production (adsforecast.com + Supabase Edge Functions):** Include `https://adsforecast.com` in `CORS_ORIGIN`. Set `FRONTEND_URL=https://adsforecast.com` so Meta OAuth returns users to `integrations.html?meta=…`. Set `META_REDIRECT_URI` to the deployed callback URL, e.g. `https://<project-ref>.supabase.co/functions/v1/meta-callback`. That URL must match **Valid OAuth Redirect URIs** in the Meta app exactly.

**Workspace for Meta (MVP):** By default the API attaches Meta connections to the workspace with slug `adsforecast-demo` (created by `npm run db:seed`). Override with `DEFAULT_META_WORKSPACE_SLUG` or `DEFAULT_META_WORKSPACE_ID`.

**Local dev:** You can use `http://localhost:5173` for `CORS_ORIGIN` and add a second redirect URI in Meta for `http://localhost:3000/v1/integrations/meta/callback` if you test OAuth locally.

For **Meta Ads OAuth**, set `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_API_VERSION`, and `META_SCOPES` — see `backend/.env.example`. Values are read only from the environment; do not commit `.env`.

For internal admin routes, set `ADMIN_TOKEN` to a long random value.

**PostgreSQL hosting** for production: Neon, Supabase, Render Postgres, Railway, or any Postgres compatible with Prisma.

## 3. Install & migrate

```bash
npm install
npx prisma generate
npx prisma migrate deploy
# Dev shortcut (no migration files): npx prisma db push
```

## 4. Seed demo user (optional)

```bash
npm run db:seed
```

Prints demo email/password and **workspace id** — use that id in the dashboard URL/session after API login.

## 5. Run API

```bash
npm run dev
# or npm start
```

Endpoints:

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` | — |
| POST | `/v1/auth/signup` | — |
| POST | `/v1/auth/login` | — |
| GET | `/v1/auth/me` | Bearer JWT |
| GET | `/v1/workspaces/:workspaceId/dashboard` | Bearer JWT + membership |
| GET | `/v1/integrations/meta/start` | — (redirects to Meta; binds OAuth `state` to the resolved workspace) |
| GET | `/v1/integrations/meta/callback` | — (OAuth `code` + `state`; persists encrypted token on `Connection`; redirects to `FRONTEND_URL/dashboard.html?meta=…`; add `format=json` for debug JSON) |
| GET | `/v1/integrations/meta/accounts` | — (lists ad accounts using decrypted token from DB) |
| POST | `/v1/integrations/meta/connect` | — (JSON body; persists selected `act_` account on `Connection`) |
| GET | `/v1/integrations/meta/connection` | — (reads selected account from DB; safe fields only) |
| GET | `/v1/integrations/meta/campaigns` | — (campaign insights from DB connection; updates `lastSuccessSyncAt`) |
| POST | `/v1/billing/create-checkout-session` | — (Stripe placeholder; returns not configured unless keys are set) |
| POST | `/v1/billing/webhook` | — (Stripe placeholder for future event processing) |
| GET | `/v1/admin/summary` | Bearer `ADMIN_TOKEN` |
| GET | `/v1/admin/users` | Bearer `ADMIN_TOKEN` |
| GET | `/v1/admin/workspaces` | Bearer `ADMIN_TOKEN` |
| GET | `/v1/admin/integrations` | Bearer `ADMIN_TOKEN` |
| GET | `/v1/admin/system` | Bearer `ADMIN_TOKEN` |

**Meta prototype note:** `meta.prototype-token-store.js` remains for optional in-memory demos only. Production flow uses the `Connection` row (`provider=META_ADS`) with `secretEncrypted` and `MetaSyncLog` audit rows.

## 6. Frontend with real auth

1. Point the browser at the API: `?api=http://localhost:3000` on `login.html` / `dashboard.html`, or set `localStorage.setItem('adsforecast.apiBase', 'http://localhost:3000')`, or fill `<meta name="adsforecast-api-base" content="...">`.
2. **Sign up or sign in** — the client stores `accessToken` and `workspaceId` from the JSON response.
3. Open the dashboard — requests send `Authorization: Bearer <token>`.

Without an API base URL, login/signup still use the **offline** demo session (`ws_nw_01`).

## Next phases

- OAuth for Meta / Shopify / WooCommerce  
- Persist campaigns, orders, and alerts in PostgreSQL  
- Background workers for `SyncJob` rows  
- Refresh tokens and stricter CORS for production  
