# AdsForecast Supabase Migration

This migration keeps the product working while moving backend responsibilities from Render/Express to Supabase:

- Postgres schema: `supabase/migrations/20260425132000_adsforecast_init.sql`
- Auth: Supabase Auth (email/password)
- Backend endpoints: Supabase Edge Functions

## Edge Functions

Created:

- `workspace-bootstrap`
- `meta-start`
- `meta-callback`
- `meta-accounts`
- `meta-connect`
- `meta-connection`
- `meta-campaigns`

## Required Supabase Secrets

Set in Supabase project secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_SECRET`
- `OAUTH_STATE_SECRET`
- `FRONTEND_URL` (`https://adsforecast.com`)
- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI` (`https://<project-ref>.supabase.co/functions/v1/meta-callback`)
- `META_API_VERSION` (for example `v20.0`)
- `META_SCOPES` (for example `ads_read`)

## Frontend runtime config

Set these in page `<meta>` tags or localStorage:

- `adsforecast-supabase-url` => `https://<project-ref>.supabase.co`
- `adsforecast-supabase-anon-key` => public anon key

When both are set, login/signup and Meta requests use Supabase.

## Deployment (CLI)

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy workspace-bootstrap
supabase functions deploy meta-start
supabase functions deploy meta-callback
supabase functions deploy meta-accounts
supabase functions deploy meta-connect
supabase functions deploy meta-connection
supabase functions deploy meta-campaigns
```

## Meta App setup

In Meta app settings, add this exact OAuth redirect URI:

`https://<project-ref>.supabase.co/functions/v1/meta-callback`

## Security notes

- Access tokens are stored encrypted in `connections.secret_encrypted`.
- Tokens are never sent to the browser.
- Browser storage only keeps session + UI state.
