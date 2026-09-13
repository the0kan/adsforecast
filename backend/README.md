# AdsForecast backend (Supabase-only)

This directory documents the **Supabase-only** backend: **Postgres** (migrations under `../supabase/migrations/`) and **Edge Functions** (under `../supabase/functions/`). The legacy Node backend lives in `backend-old/` and is **not** used or referenced here.

## Architecture

Frontend (static hosting) → **Supabase Auth** (JWT) → **Edge Functions** (service role) → **Postgres** → **Meta Marketing API**.

The browser never receives Meta access tokens; tokens are stored encrypted in `meta_connections.access_token_encrypted`.

## Database

Apply migrations from the repository root:

```bash
npx supabase db push
```

The canonical v2 schema is created by migration `20260428140000_v2_clean_supabase_meta.sql` (tables: `app_users`, `workspaces`, `workspace_members`, `meta_connections`, `meta_sync_logs`). It preserves the older schema by renaming its tables with a `_v1_archive` suffix, then copies compatible users, workspaces, and memberships into v2. Legacy encrypted Meta tokens remain archived and users reconnect Meta once after migration.

## Edge Functions

Deploy each function (from repo root):

```bash
npx supabase functions deploy backend-health
npx supabase functions deploy workspace-bootstrap
npx supabase functions deploy meta-start
npx supabase functions deploy meta-callback
npx supabase functions deploy meta-accounts
npx supabase functions deploy meta-connect
npx supabase functions deploy meta-connection
npx supabase functions deploy meta-campaigns
```

Public health check (returns no table contents or secrets):

```bash
curl https://<project-ref>.supabase.co/functions/v1/backend-health
```

Shared helpers live in `supabase/functions/_shared/` (`cors.ts`, `supabase.ts`, `auth.ts`, `workspace.ts`, `crypto.ts`, `meta.ts`, `response.ts`).

## Required secrets (function env)

Set these in the Supabase project **Edge Functions** secrets UI (or CLI):

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Project URL (often auto-injected). |
| `SERVICE_ROLE_KEY` **or** `SUPABASE_SERVICE_ROLE_KEY` **or** `PROJECT_SERVICE_ROLE_KEY` | Service role key for Postgres + Auth admin from Edge Functions. Prefer `SERVICE_ROLE_KEY` if the dashboard blocks a `SUPABASE_*` name. |
| `TOKEN_ENCRYPTION_SECRET` | AES-256-GCM key material for Meta access tokens at rest. |
| `OAUTH_STATE_SECRET` | HMAC secret for signed OAuth `state` (workspace + user binding). |
| `FRONTEND_URL` | e.g. `https://adsforecast.com` (OAuth redirects append `/integrations.html?meta=…`). |
| `META_APP_ID` | Meta app ID. |
| `META_APP_SECRET` | Meta app secret. |
| `META_REDIRECT_URI` | Must match Meta app settings, e.g. `https://<project-ref>.supabase.co/functions/v1/meta-callback`. |
| `META_API_VERSION` | Optional; default `v20.0`. |
| `META_SCOPES` | Optional; default `ads_read`. |

## CORS

Functions answer **OPTIONS** with **204** and allow browser origins because authentication uses explicit Bearer JWTs rather than cookies. Protected operations still validate the Supabase JWT before accessing data.

## Manual test sequence

1. Run `npx supabase db push` on a linked project (or apply the migration in the SQL editor).
2. Deploy all seven functions with the commands above; set secrets.
3. In the Meta Developer app, confirm **Valid OAuth Redirect URIs** include your `META_REDIRECT_URI`.
4. Sign up or sign in on the live frontend; confirm **POST** `workspace-bootstrap` returns **200** and JSON includes `workspace.id` (string).
5. On **integrations**, click **Connect Meta Ads**; confirm **GET** `meta-start` returns JSON with `authUrl` starting with `https://www.facebook.com/`.
6. Complete OAuth; you should land on `…/integrations.html?meta=connected` or `?meta=select-account`.
7. If prompted, pick an account; confirm **POST** `meta-connect` succeeds and campaigns page loads live data (**GET** `meta-campaigns`).
8. **GET** `meta-connection` returns `connection: null` before connect and a populated object after account selection.

## Meta Developer Console (manual)

- Add **Facebook Login** (or Marketing API product as needed) and set **App ID / Secret** in Supabase secrets.
- Under **Settings → Basic**, note **App ID** and **App Secret**.
- **Valid OAuth Redirect URIs**: exact `META_REDIRECT_URI` (Supabase function URL for `meta-callback`).
- Request **`ads_read`** (or the scopes you set in `META_SCOPES`) and complete **App Review** for production access beyond developers/testers.
- Add your Supabase **Edge Function domain** and **frontend domain** to **App Domains** / **Website** as required by Meta.

## Error contract (JSON)

Failures use:

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Human readable message",
  "error": "Human readable message"
}
```

Codes include: `AUTH_REQUIRED`, `WORKSPACE_NOT_FOUND`, `META_NO_TOKEN`, `META_NO_ACCOUNT`, `META_TOKEN_INVALID`, `META_API_ERROR`, `CONFIG_MISSING`, `INTERNAL_ERROR`.
