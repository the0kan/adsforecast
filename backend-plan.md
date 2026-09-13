# AdsForecast — backend plan (v0)

Planning-only document. No implementation commitment; revise as product and compliance requirements firm up.

## 1. Goals

- **Unify** Meta Ads performance with WooCommerce / Shopify revenue in a **tenant-scoped** API the dashboard (and future mobile) can trust.
- **Compute** ROAS, CPA, net profit, margin server-side using the same definitions as `metrics.js` (single source of truth in code shared or mirrored).
- **Run** scheduled and on-demand **sync jobs** with clear **audit trails** and **retry** semantics.
- **Scale** to multiple workspaces, stores, and ad accounts per customer without cross-tenant data leaks.

## 2. High-level architecture

| Layer | Role |
|--------|------|
| **API service** | AuthN/Z, CRUD for workspaces, connections, read models for dashboard; issues short-lived tokens. |
| **Worker / queue** | Pulls from Meta / Woo / Shopify; normalizes rows; writes facts + rollups; triggers insight rules. |
| **Integration adapters** | One module per provider: OAuth or API keys, pagination, rate limits, field mapping. |
| **Data store** | PostgreSQL (relational source of truth); optional cache (Redis) for sessions and rate-limit counters. |
| **Object storage** (optional later) | Raw export blobs, large CSV archives. |

Suggested stack (aligns with your notes): **Node.js** (TypeScript) + **PostgreSQL** + **Redis** + **a queue** (e.g. BullMQ / SQS / Cloud Tasks). Framework: Fastify, Nest, or Hono — pick by team preference.

## 3. Core domains (bounded contexts)

1. **Identity & billing** — users, orgs/workspaces, roles, subscription state (stub until billing is live).
2. **Connections** — Meta ad account(s), Woo store URL + app keys, Shopify shop + OAuth; encrypted secrets; connection health.
3. **Sync** — job types (full / incremental), cursors, last success, error payloads, backoff.
4. **Facts** — normalized spend, impressions, purchases, revenue lines at grain you choose (e.g. campaign-day + order-day).
5. **Metrics & insights** — rollups, portfolio KPIs, rule engine output (server-side mirror of `insights-engine.js` logic, with versioning).

## 4. API surface (sketch)

Version prefix: `/v1`.

| Area | Examples |
|------|-----------|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` |
| Workspace | `GET /workspaces/:id`, `PATCH /workspaces/:id` |
| Connections | `POST /workspaces/:id/connections/meta`, `GET .../connections`, `DELETE .../connections/:cid` |
| Sync | `POST /workspaces/:id/sync` (on-demand), `GET .../sync/jobs/:jid` |
| Dashboard | `GET /workspaces/:id/dashboard?range=30d` — returns payload shaped like current `getDashboardPayload()` |

Use **cursor-based pagination** for large lists (campaigns, orders). Return **ETags** on dashboard aggregates when possible for caching.

## 5. Integration specifics

### Meta (Marketing API)

- OAuth for System User or Business; store long-lived token encrypted.
- Entities: campaigns, ad sets, ads, insights with `time_increment` / breakdowns as needed.
- Respect **rate limits**; batch requests where allowed; backoff on `4xx/5xx` and `rate limit` headers.

### WooCommerce (REST API)

- Keys or OAuth depending on host; **read** orders, refunds, line items for revenue and COGS hooks.
- Webhook endpoints for `order.created` / `order.updated` to drive incremental sync (verify signatures).

### Shopify (Admin API)

- OAuth; **read_orders** and related scopes; GraphQL or REST per API version policy.
- Webhooks for orders; **compliance** with Shopify’s data handling and rotation requirements.

## 6. Sync strategy

- **Incremental** by default using provider cursors / `updated_at` watermarks.
- **Idempotent** writes: natural keys `(workspace_id, provider, external_id, date)` for facts.
- **Reconciliation** job: periodic full re-pull for a short window to fix drift.
- **Dead-letter** queue for rows that fail validation; admin visibility later.

## 7. Security

- **Secrets**: encrypt at rest (KMS or libsodium); never log tokens.
- **Tenant isolation**: every query scoped by `workspace_id` + RLS in Postgres if feasible.
- **Transport**: TLS everywhere; HSTS in production.
- **Audit**: who connected/disconnected integrations, who exported data.

## 8. Observability

- Structured logs with `workspace_id`, `job_id`, `provider`.
- Metrics: sync duration, rows ingested, API error rates, queue depth.
- Tracing optional (OpenTelemetry) once traffic warrants it.

## 9. Phased delivery (suggested)

1. **API shell** — auth, workspace, health; dashboard returns **mock** from DB seed.
2. **One integration read path** — e.g. Meta insights → facts table → dashboard endpoint.
3. **Woo or Shopify** — second revenue source; join rules for attribution (even v1 heuristic documented).
4. **Workers at scale** — queue, retries, DLQ, monitoring.
5. **Insights service** — persist generated alerts; user dismissals; email/Slack later.

## 10. Relation to current frontend

- **`data.js` / `getDashboardPayload()`** remains the **contract** the UI expects; backend should converge to that JSON shape (plus `meta`, pagination wrappers as needed).
- **`metrics.js`** definitions should be **ported** to shared package or duplicated with tests to prevent drift.
- **`insights-engine.js`** becomes a **server job** or library with the same rule names and thresholds stored per workspace.

---

*Next planning artifact: `docs/database-plan.md` (tables, keys, RLS notes).*
