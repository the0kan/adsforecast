# AdsForecast agent guide

## Source of truth

- The production architecture is the static web client plus Supabase Auth, Postgres and Edge Functions.
- `supabase/migrations/` is the database history; `supabase/functions/` is the server boundary.
- `?demo=1` is an explicit, labelled and network-isolated sample workspace. Never present demo data as live data.

## Change discipline

1. Read `README.md` and the relevant document under `docs/` or `specs/` before changing behaviour.
2. Keep changes focused. Preserve existing contracts unless the task explicitly changes them.
3. Keep service-role keys, provider credentials, OAuth tokens and webhook secrets out of browser code and logs.
4. Enforce workspace membership before every tenant-scoped operation; do not rely on client-supplied ownership claims.
5. Add or update a browser check when user-visible behaviour changes.
6. Update documentation when architecture, setup, routes or operational procedures change.

## Verification

Install development dependencies as described in `README.md`, then run:

```bash
npm run verify
```

Do not claim a change is complete until the relevant checks pass. Database or deployment changes also require the linked Supabase lint, migration and function checks documented in `README.md`.
