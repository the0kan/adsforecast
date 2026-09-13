# Stripe activation runbook

The product is Stripe-ready but deliberately does not claim to accept payments until this runbook is complete.

## 1. Build the test catalog

Create Starter, Growth and Scale products in Stripe test mode. Create one recurring monthly and one recurring annual USD price for each product using the amounts in the admin catalog. Do not reuse a price across plans or cadences.

## 2. Map prices in AdsForecast

Open `control-center.html` as a `super_admin`, select **Plans**, edit each plan and save its Stripe product ID, monthly price ID and annual price ID. Keep a plan active only when public copy, limits and mappings match.

## 3. Configure secrets

Set these only in Supabase Edge Function secrets:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_MODE=test
ADSFORECAST_APP_URL=https://your-production-domain.example
```

Never put these values in HTML, JavaScript, cPanel files or screenshots.

## 4. Create the webhook

Point Stripe to:

```text
https://qlwaxfkmeukhhuwwgllk.supabase.co/functions/v1/stripe-webhook
```

Subscribe to the checkout, customer subscription and invoice events handled by `stripe-webhook`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`, then redeploy `billing-center`, `stripe-webhook` and `admin-console`.

## 5. Configure Customer Portal

Enable plan management, invoice history and cancellation behavior. Decide whether downgrades and cancellations apply immediately or at period end, then keep product copy consistent with that policy.

## 6. Test-mode acceptance

- Start checkout from each plan and cadence.
- Confirm hosted checkout product, amount and currency.
- Confirm cancellation does not activate a plan.
- Confirm success remains pending until the signed webhook arrives.
- Confirm duplicate webhooks do not duplicate billing events.
- Confirm older events cannot overwrite newer subscription state.
- Confirm invoice success/failure, upgrade, downgrade, cancellation and portal return.
- Confirm customer and admin screens show the same verified state.

## 7. Live activation

Repeat catalog, mapping, webhook and portal setup with live Stripe objects. Replace secrets, set `STRIPE_MODE=live`, redeploy and run one low-value real transaction. Verify subscription, invoice, portal and cancellation records before public access.
