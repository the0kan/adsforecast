# AdsForecast Publish Checklist

Use this checklist before each production release.

## 1) Frontend Upload (cPanel)

Upload these files to the live web root:

- `index.html`
- `login.html`
- `signup.html`
- `overview.html`
- `campaigns.html`
- `insights.html`
- `profitability.html`
- `integrations.html`
- `profile.html`
- `settings.html`
- `control-center.html`
- `privacy.html`
- `terms.html`
- `data-deletion.html`
- `styles.css`
- `auth.css`
- `dashboard.css`
- `app.css`
- `admin.css`
- all JS files in root (`*.js`)
- `assets/favicon.svg`

Then hard refresh in browser (`Cmd+Shift+R`) and test in an incognito window.

## 2) Supabase Edge Functions Deploy

Deploy all auth/integration functions after code updates:

```bash
supabase functions deploy workspace-bootstrap
supabase functions deploy meta-start
supabase functions deploy meta-connect
supabase functions deploy meta-connection
supabase functions deploy meta-accounts
supabase functions deploy meta-campaigns
supabase functions deploy meta-callback
```

## 3) Supabase Secrets Required

Set or verify:

```bash
supabase secrets set SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
supabase secrets set FRONTEND_URL="https://YOUR_DOMAIN"
supabase secrets set META_APP_ID="..."
supabase secrets set META_APP_SECRET="..."
supabase secrets set META_REDIRECT_URI="https://YOUR_PROJECT.supabase.co/functions/v1/meta-callback"
supabase secrets set META_API_VERSION="v19.0"
supabase secrets set TOKEN_ENCRYPTION_SECRET_B64="32-byte-base64-secret"
```

## 4) Backend API (Render/Node) Required

Verify backend `.env` has:

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN` (must include your live domain)
- `FRONTEND_URL`
- Stripe and Meta keys if used

Confirm health endpoint returns OK:

- `GET /v1/health`

## 5) Auth and Workspace Tests

1. Open `signup.html`.
2. Create account.
3. If email confirmation is enabled, verify email then sign in.
4. On sign in, verify `workspace-bootstrap` returns 200.
5. Confirm redirect to `overview.html`.
6. Confirm `overview.html` does not show "Sign in required".

## 6) Integration Tests

1. Open `integrations.html`.
2. Start Meta OAuth.
3. Return from callback and select account if prompted.
4. Verify:
   - `meta-connection` returns 200
   - `meta-accounts` returns 200
   - `meta-campaigns` returns 200 or a controlled message

## 7) Browser Console and Network

Check production pages for:

- no uncaught JS errors
- no CORS failures
- no 401 loops after login
- no missing module imports

## 8) Visual QA

Verify responsive layouts at:

- 1200px
- 900px
- 600px
- 375px

Pages to verify:

- marketing (`index`)
- auth (`login`, `signup`)
- app (`overview`, `campaigns`, `insights`, `profitability`, `integrations`, `profile`, `settings`)
- legal (`privacy`, `terms`, `data-deletion`)
- admin (`admin`)

## 9) Rollback Package

Keep a zip of previous working release with:

- all HTML
- all CSS
- all root JS
- release timestamp in filename

If issues appear after release, roll back frontend bundle first, then investigate backend/functions logs.
