# AdsForecast Launch Readiness Design

## Requirements

- While a customer is authenticated, when account settings are changed, the system shall persist them to the customer's workspace.
- While a platform administrator is authenticated, when the admin console is opened, the system shall expose operational data according to the administrator's role.
- When a support ticket is created or replied to, the system shall persist an auditable message thread.
- When Stripe configuration is absent, the system shall expose readiness state and allow checkout drafts without creating payment claims.
- When Stripe configuration is present, checkout and portal sessions shall be created only by authenticated Edge Functions and subscription access shall change only from verified webhooks.
- When a reporting period is selected, campaign requests shall use a validated range no longer than 180 days.
- When an AI run completes, the system shall persist a structured, multi-layer analysis and its evidence.

## Architecture

### Frontend

- Shared authenticated shell with Support and conditional Admin navigation.
- Campaign period presets: today, 7, 30 and 90 days plus bounded custom dates.
- Five-layer AI Analyst: executive posture, portfolio economics, signal diagnosis, prioritized actions and guardrails/scenarios.
- Profile and Settings backed by a server account-center endpoint.
- Plans & Billing backed by a server billing-center endpoint, with honest not-configured states.
- Support Center with ticket creation, list, detail and replies.
- Admin Console with overview, customers, subscriptions, plans, tickets, integrations, audit and system-readiness views.

### Backend

- `account-center`: read/update own profile and workspace settings.
- `billing-center`: plan catalog, subscription state, checkout draft, Stripe checkout and portal session creation.
- `stripe-webhook`: signature-verified subscription synchronization.
- `support-center`: workspace-scoped ticket and reply workflow.
- `admin-console`: platform-RBAC global read and bounded management actions.
- Existing Meta and AI functions extended for date ranges and structured analysis.

### Database

- `platform_admins`, `user_profiles`, `workspace_settings`
- `plan_catalog`, `workspace_subscriptions`, `billing_events`
- `support_tickets`, `support_ticket_messages`
- `admin_audit_logs`, `platform_settings`
- `ai_analysis_runs.analysis_payload` for structured analyst output

### Security

- Global admin authorization is database-backed and independent of workspace roles.
- Normal browser roles have no direct grants to business/admin tables.
- All mutation payloads are bounded, type-checked and length-limited server-side.
- Stripe plan/price mappings are selected server-side; the browser cannot submit arbitrary price IDs.
- Webhook requests use raw-body signature verification and idempotent event IDs.
- Admin actions create immutable audit records with safe metadata only.
- Ticket output is HTML-escaped in the UI and never interpreted as markup.

## Failure Modes

| Failure | User-visible behavior | System behavior |
|---|---|---|
| Stripe secrets missing | Readiness card and disabled checkout | No charge attempt; draft can still persist |
| Stripe webhook duplicate | No duplicate subscription mutation | Unique provider event ID enforces idempotency |
| Meta token expired | Reconnect guidance | Sync error audit; no sample fallback |
| AI provider unavailable | Rules-based brief | Provider error stays server-side; run remains usable |
| Ticket write fails | Inline recovery message | No optimistic success state |
| Non-admin opens admin | Access-denied screen | HTTP 403; no global rows returned |

## Acceptance Criteria

- Backend, frontend and authorization tests cover every new critical path.
- No secret, token, raw webhook payload or private provider response appears in UI/API output.
- All new customer surfaces work at 320, 375, 768, 1024 and 1440 widths.
- No payment state is described as active without a verified subscription row.
- Demo mode remains isolated from live tables and provider requests.

