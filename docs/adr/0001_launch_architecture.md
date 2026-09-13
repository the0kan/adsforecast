# ADR-0001: Keep a Supabase modular serverless architecture for launch

## Status

Accepted

## Context

AdsForecast is a pre-launch SaaS with a small operating team, a static browser application, Supabase identity/database/functions, and a small number of provider integrations. The launch program adds billing, support, persistent settings and platform administration. Splitting these capabilities into separate infrastructure services would increase operational complexity without a demonstrated scaling need.

## Decision

Keep Supabase Postgres as the source of truth and implement bounded domain Edge Functions for account, billing, support and admin operations. Keep provider secrets in Edge Function environment variables. Use database-backed platform RBAC and workspace tenancy. Treat Stripe webhooks as the only authority for paid subscription activation.

## Consequences

### Positive

- One identity and tenancy model across the product.
- Reproducible schema and authorization through migrations.
- Low operational overhead before product-market fit.
- Clear future boundaries for extracting billing or analytics services if scale requires it.

### Negative

- Edge Function cold starts can affect the first request.
- The static frontend has no compile-time shared types.
- PostgREST/service-role code requires careful response filtering and explicit authorization.

### Neutral

- Payment pages and subscription management remain Stripe-hosted.
- Email delivery remains a separate launch dependency.

## Alternatives Considered

- Reuse the legacy Render API admin token: rejected because it is disconnected from the active Supabase source of truth and stores a long-lived token in the browser.
- Introduce microservices and a queue immediately: rejected because current load and team size do not justify the operational cost.
- Allow every workspace owner into the global admin panel: rejected as a critical tenant-isolation failure.

