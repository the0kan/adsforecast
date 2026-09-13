# Reverse-Engineered Specification: AdsForecast

## Overview

AdsForecast is a static HTML/CSS/JavaScript SaaS interface backed by Supabase Auth, Postgres and Edge Functions. The product connects one Meta Ads account to a workspace, reads campaign-level delivery and purchase-value metrics, applies a workspace profit model, and produces advisory AI recommendations. Demo routes are explicit and must never be mixed with authenticated live data.

## Architecture Summary

### Technology stack

- Browser: semantic HTML, shared CSS design tokens and ES modules
- Identity: Supabase Auth with persisted browser sessions
- API: Supabase Edge Functions using bearer-user verification
- Database: Supabase Postgres with strict client-table revocation and Edge Function access
- External services: Meta Marketing API; Gemini/OpenAI with deterministic rules fallback
- Hosting: static frontend on cPanel; Supabase for backend services

### Main data flow

`Browser session -> workspace-bootstrap -> workspace membership -> protected Edge Function -> service-role database access -> external provider`

The browser receives publishable Supabase configuration only. Meta, AI and future Stripe secrets remain server-side.

## Observed Functional Requirements

### Identity and workspace

**OBS-AUTH-001**: While a Supabase session is valid, when a product page opens, the system shall bootstrap the authenticated user's application identity and workspace.

**OBS-AUTH-002**: When a product page has neither a valid session nor explicit demo mode, the system shall render an authentication-required state.

**OBS-TENANT-001**: While a user belongs to a workspace, protected functions shall scope reads and writes to that membership.

### Meta Ads

**OBS-META-001**: When an authenticated workspace completes Meta OAuth and selects an ad account, the system shall store only an encrypted access token server-side.

**OBS-META-002**: When campaign insights are requested, the system shall read campaign delivery metrics from the selected account and log the sync result.

**OBS-META-003**: When live Meta data is unavailable, the system shall show an explicit empty/error state and shall not substitute sample rows.

### Profitability and AI

**OBS-PROFIT-001**: The system shall apply the same saved variable-cost assumptions to Overview, Campaigns, Profitability and AI Analyst.

**OBS-AI-001**: When AI analysis runs, campaign names shall be treated as untrusted labels and recommendations shall be advisory only.

**OBS-AI-002**: When an AI provider is unavailable, the system shall fall back to deterministic recommendation rules.

**OBS-AI-003**: The system shall retain bounded analysis history and numeric evidence for recommendations.

### Demo boundary

**OBS-DEMO-001**: While `demo=1` is present, the system shall use sample data and isolated demo preferences without calling protected Meta or AI endpoints.

## Observed Non-Functional Requirements

### Security

- Protected functions verify the Supabase bearer token server-side.
- Authorization is derived from workspace membership, not user-editable metadata.
- Business tables are RLS-enabled and revoked from `anon` and `authenticated` roles.
- Provider tokens are encrypted and never returned to the browser.
- AI outputs are normalized before persistence and presentation.

### Reliability and integrity

- Safe GET operations use one bounded retry and a timeout.
- Meta synchronization success/failure is logged.
- Live and sample data are visibly and programmatically separated.
- Billing is not labeled active until a payment-provider event verifies it.

### User experience

- Authenticated pages share navigation, identity, Meta connection and account-menu behavior.
- Product pages support 320px through desktop layouts without page-level horizontal overflow.
- Controls are keyboard reachable and use visible focus states.

## Inferred Acceptance Criteria for Launch Readiness

1. Given a platform admin session, when Admin Console opens, then global customer, workspace, subscription, integration, ticket and system data is visible without exposing secrets.
2. Given a normal customer session, when Admin Console opens, then global data is denied with HTTP 403 and no partial result.
3. Given an authenticated workspace, when profile, reporting or notification settings are saved, then the values persist in Postgres and hydrate on another browser session.
4. Given a customer support request, when a ticket is submitted, then it appears in the customer's Support Center and in the platform admin inbox.
5. Given a plan choice while Stripe is not configured, when the customer continues, then a server-side checkout draft is saved and no paid status is asserted.
6. Given Stripe configuration later, when a verified webhook confirms a subscription event, then the workspace subscription record becomes the source of truth.
7. Given a selected reporting period, when Campaigns loads, then the server validates the date range and Meta receives only the allowed bounded range.
8. Given an AI run, when the analyst screen renders, then it presents executive, portfolio, diagnostic, action and governance layers with evidence and confidence.

## Uncertainties and External Dependencies

- Stripe live/test secret, webhook secret and price IDs are intentionally absent until the owner configures them.
- Custom SMTP/email delivery is not yet configured; notification preferences can be persisted but no email should be claimed as sent.
- Meta data currently provides aggregate campaign evidence, not a durable daily warehouse; trend charts must remain honest until time-series snapshots are stored.

## Recommendations Implemented by the Launch Program

1. Replace the obsolete Render admin-token interface with Supabase-authenticated platform RBAC.
2. Persist profile, workspace settings, support and billing state in Postgres.
3. Add a Stripe-ready checkout, portal and signed-webhook boundary without activating payments prematurely.
4. Add bounded date ranges and explicit period context to Meta campaign requests.
5. Expand AI output into a multi-layer decision brief while retaining deterministic fallback and human approval.

