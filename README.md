# AdsForecast

AdsForecast is a profit-first Meta Ads operating workspace. It combines live campaign evidence, a saved contribution model, five-layer AI decision support, workspace settings, customer support, subscription readiness and a database-backed platform admin console.

## Current architecture

- Frontend: responsive static HTML, CSS and ES modules.
- Identity and session: Supabase Auth.
- Source of truth: Supabase PostgreSQL.
- Server logic: bounded Supabase Edge Functions.
- Acquisition data: Meta Marketing API through OAuth; tokens are encrypted server-side.
- AI: Gemini or OpenAI when configured, with a deterministic rules fallback and explicit evidence boundaries.
- Billing: Stripe-ready checkout, portal and signed webhook flow. Paid access is never inferred from a browser action.
- Operations: tenant-scoped support tickets plus explicit platform administrator roles and audit logs.

The old Express/Prisma implementation under `backend-old/` is retained only as historical reference. It is not the production path.

## Product routes

- `index.html`: marketing and pricing.
- `login.html`, `signup.html`: Supabase authentication.
- `overview.html`: portfolio summary and decision queue.
- `campaigns.html`: daily, weekly, monthly, 90-day and custom campaign reporting.
- `profitability.html`: contribution model and break-even analysis.
- `insights.html`: five-layer AI Analyst, scenarios, recommendation queue and run history.
- `integrations.html`: Meta connection and provider boundaries.
- `profile.html`, `settings.html`: customer and workspace controls.
- `billing.html`: plan comparison, checkout draft and Stripe activation boundary.
- `support.html`: customer ticket queue and replies.
- `control-center.html`: platform-only customer, workspace, plan, subscription, ticket, integration, system and audit operations.

Append `?demo=1` only for the explicit sample workspace. Demo mode is visually labelled, makes no Supabase data request and never appears as live customer data.

## Local development

```bash
npm run dev
```

Open `http://localhost:5173/index.html`. The included `serve.json` preserves `.html` routes and query parameters so demo and post-auth redirects behave like production.

## Supabase workflow

```bash
npx supabase link --project-ref qlwaxfkmeukhhuwwgllk
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
npm run backend:deploy
```

Required server secrets depend on the enabled providers:

- Core: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_SECRET`, `FRONTEND_URL`.
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_API_VERSION`, `META_SCOPES`, `OAUTH_STATE_SECRET`.
- AI: `GEMINI_API_KEY` and optional `GEMINI_MODEL`, or `OPENAI_API_KEY` and optional `OPENAI_MODEL`.
- Stripe activation: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, plus the product and monthly/annual price IDs saved from the admin plan editor.

Never put provider secrets, service-role keys, Meta tokens or Stripe secrets in browser code.

## Verification

Use the bundled Codex Python runtime when the system Python does not include Playwright.

```bash
python3 tests/marketing_e2e.py
python3 tests/product_intelligence_e2e.py
python3 tests/launch_control_plane_e2e.py
python3 scripts/data_integrity_audit.py
python3 scripts/product_quality_audit.py
python3 scripts/product_upgrade_audit.py
python3 scripts/auth_quality_audit.py
python3 scripts/ui_audit.py
```

Database and deployment checks:

```bash
npx supabase db lint --linked --level error
npx supabase migration list --linked
npx supabase functions list --project-ref qlwaxfkmeukhhuwwgllk
```

## Launch documents

- [Launch checklist](docs/launch-checklist.md)
- [Stripe activation runbook](docs/stripe-activation-runbook.md)
- [Admin operations](docs/admin-operations.md)
- [Architecture decision](docs/adr/0001_launch_architecture.md)
- [Reverse-engineered product specification](specs/adsforecast_reverse_spec.md)
- [Launch-readiness design](specs/launch_readiness_design.md)

The application can operate in private beta without Stripe. Public paid launch remains intentionally gated until Stripe keys, price mappings, webhook delivery and Customer Portal are configured and verified in test mode, then live mode.
