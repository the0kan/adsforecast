# AdsForecast launch checklist

Use this checklist before changing `launch.state.customerAccess` to `public`.

## Product and data integrity

- [x] Demo data is isolated behind `?demo=1`, labelled as sample and makes no live data requests.
- [x] Live pages do not fall back to invented campaign metrics.
- [x] Meta reporting supports today, 7 days, 30 days, 90 days and custom 1–180 day windows.
- [x] Profitability assumptions are visible and shared across the product.
- [x] AI recommendations expose evidence, confidence, scenarios and a human-approval boundary.
- [x] Support requests and replies are tenant-scoped.
- [x] Admin access uses explicit database roles and writes audit records.

## Security

- [x] Database schema lint returns no errors.
- [x] Browser roles cannot directly read or mutate control-plane tables.
- [x] Meta tokens are encrypted and never returned to the browser.
- [x] Stripe webhook verification is required before subscription status changes.
- [x] Password minimum is 10 characters and password changes require reauthentication.
- [ ] Enable leaked-password protection after moving to a Supabase plan that supports it.
- [ ] Configure CAPTCHA before unrestricted public signup.
- [ ] Rotate any provider key pasted into chat or shown in a screenshot.
- [ ] Complete a final dependency and secret-rotation review before public launch.

## Providers

- [x] Meta OAuth and encrypted token flow are deployed.
- [ ] Complete Meta business verification when commercial access requires it.
- [ ] Reconnect the launch Meta account and verify a fresh production campaign sync.
- [x] AI provider readiness is visible in the admin console.
- [ ] Replace temporary AI keys with restricted production keys and budget limits.
- [ ] Complete every step in `stripe-activation-runbook.md`.
- [ ] Configure production SMTP; test confirmation, recovery, support and billing email.

## Legal and customer operations

- [x] Privacy, terms and data-deletion pages exist.
- [ ] Have legal pages reviewed for the launch entity, jurisdiction and processors.
- [ ] Confirm the support owner and escalation rota.
- [ ] Publish a customer-facing status or incident communication channel.
- [ ] Define retention and deletion procedures for closed customers.

## Release gate

- [x] Responsive, interaction, accessibility-structure and data-integrity suites pass.
- [x] Admin views pass desktop, tablet and mobile tests at their service boundary.
- [ ] Run one real journey: signup, confirmation, Meta connect, sync, AI, support, logout and login.
- [ ] Run Stripe test checkout, signed webhook, portal and cancellation.
- [ ] Back up the cPanel public directory before upload.
- [ ] Upload the reviewed archive and run production smoke tests.
- [ ] Only then change access from private beta/invite-only to public.

## Rollback

1. Return customer access to `private_beta`.
2. Restore the previous cPanel archive.
3. Keep database migrations forward-only; ship a corrective migration.
4. Disable affected functions or provider secrets if an integration is implicated.
5. Preserve billing, support, sync and audit records for investigation.
