# AdsForecast — database plan (PostgreSQL, v0)

Planning artifact. Revise after legal review (PII, retention) and first integration spikes.

## 1. Principles

- **Tenant isolation**: every business row carries `workspace_id`; prefer **Row Level Security (RLS)** on app role connections.
- **Immutable-ish facts**: raw metrics ingested from providers are **append/update by natural key**, not destructive overwrites without audit.
- **Surrogate keys**: UUIDv7 or ULID for public IDs; bigint PKs optional for hot tables.
- **Soft delete** where users “disconnect” things; hard delete only via retention jobs.

## 2. Entity overview (ER sketch)

```
workspace ─┬─< workspace_member >── user
           ├─< connection (meta | woocommerce | shopify)
           ├─< sync_job
           ├─< ad_account_ref / store_ref (provider-specific external ids)
           ├─< campaign_fact (daily or hourly grain)
           ├─< order_fact (aggregated or line-level per privacy policy)
           ├─< metric_rollup (materialized or table)
           ├─< insight_record / alert_record
           └─< subscription (later)
```

## 3. Core tables (suggested)

### 3.1 Identity

| Table | Purpose |
|--------|---------|
| `users` | id, email (unique), password_hash or null (OAuth later), name, created_at, updated_at |
| `workspaces` | id, name, slug (unique per env), default_currency, timezone, created_at |
| `workspace_members` | workspace_id, user_id, role (`owner`, `admin`, `member`), created_at; PK (workspace_id, user_id) |

Indexes: `workspace_members(user_id)`, `workspaces(slug)`.

### 3.2 Connections (integrations)

| Table | Purpose |
|--------|---------|
| `connections` | id, workspace_id, provider (`meta_ads`, `woocommerce`, `shopify`), status (`connected`, `syncing`, `error`, `disconnected`), display_label, external_ref (e.g. ad account id, shop domain), encrypted_credentials_ref or vault pointer, last_success_sync_at, last_error (text/json), created_at, updated_at |

Optional detail tables to avoid wide nullable columns:

| Table | Purpose |
|--------|---------|
| `connection_meta` | connection_id (PK), ad_account_id, business_id, token_expires_at |
| `connection_woocommerce` | connection_id, base_url, key_id reference |
| `connection_shopify` | connection_id, shop_domain, scopes |

### 3.3 Sync & jobs

| Table | Purpose |
|--------|---------|
| `sync_jobs` | id, workspace_id, connection_id, job_type (`full`, `incremental`, `reconcile`), status (`queued`, `running`, `success`, `failed`), cursor_before, cursor_after, started_at, finished_at, error_payload (jsonb), row_counts (jsonb) |

Index: `(workspace_id, created_at DESC)`, `(connection_id, status)`.

### 3.4 Advertising facts (Meta)

Grain: **campaign + date** (extend to ad set / ad later).

| Column | Notes |
|--------|--------|
| `id` | bigserial or UUID |
| `workspace_id` | FK |
| `connection_id` | FK |
| `date` | date (store in workspace TZ or UTC; pick one and document) |
| `external_campaign_id` | Meta id |
| `campaign_name` | snapshot at sync |
| `spend` | numeric(14,2) |
| `impressions`, `clicks`, `purchases` | bigint / numeric as needed |
| `revenue_attributed` | optional if Meta reports conversion value |
| `raw_payload` | jsonb optional for debugging (truncate in prod) |
| `updated_at` | |

**Unique**: `(workspace_id, connection_id, external_campaign_id, date)`.

### 3.5 Commerce facts (Woo / Shopify)

Start with **order-level or daily aggregates** per privacy/minimization policy.

| `order_facts` (example) | |
|-------------------------|---|
| `id` | |
| `workspace_id`, `connection_id` | |
| `external_order_id` | |
| `ordered_at` | timestamptz |
| `currency` | |
| `subtotal`, `total`, `refund_total` | numeric |
| `line_items_count` | int |
| `attribution_source` | text nullable (for future marketing attribution joins) |
| `created_at`, `updated_at` | |

**Unique**: `(workspace_id, connection_id, external_order_id)`.

### 3.6 Derived / rollups (dashboard read model)

| Table | Purpose |
|--------|---------|
| `metric_rollups` | workspace_id, period_start, period_end, grain (`7d`, `30d`), jsonb `payload` matching dashboard KPIs + campaign rows snapshot, computed_at |

Alternatively normalize into `portfolio_metrics` + `campaign_metrics` tables; **jsonb snapshot** is faster for v1 API matching `data.js`.

### 3.7 Insights & alerts (persisted)

| Table | Purpose |
|--------|---------|
| `insight_records` | id, workspace_id, rule_id, severity, title, body, related_entity_ids (jsonb), created_at, dismissed_at nullable |
| `alert_records` | same pattern; or unify single `feed_items` with `kind` |

### 3.8 Billing (later)

| Table | Purpose |
|--------|---------|
| `subscriptions` | workspace_id, provider (`stripe`), external_customer_id, plan_id, status, current_period_end |

## 4. Indexing & performance

- **Time-range queries**: `(workspace_id, date)` on `campaign_facts`; `(workspace_id, ordered_at)` on `order_facts`.
- **Heavy dashboards**: materialized view or nightly `metric_rollups`; refresh after sync completion.
- **Partial indexes**: e.g. `WHERE dismissed_at IS NULL` on insights.

## 5. Row Level Security (RLS)

- Enable RLS on: `connections`, `sync_jobs`, `campaign_facts`, `order_facts`, `metric_rollups`, `insight_records`.
- Policy pattern: `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = current_user_id())`.
- Use `SET LOCAL` session variable or JWT claim → `app.current_user_id` in Postgres for policies.

## 6. Migrations & ops

- Tooling: **Flyway**, **Sqitch**, **Prisma migrate**, or **Atlas** — pick one and never hand-edit prod.
- **Backups**: PITR; test restore quarterly.
- **Retention**: define order PII retention; anonymize or delete per policy.

## 7. Mapping to current frontend contract

| Frontend (`data.js`) | DB source (target) |
|----------------------|---------------------|
| `workspace` | `workspaces` |
| `integrations[]` | `connections` (+ detail tables) |
| `campaigns[]` | join `campaign_facts` over window + latest names |
| `portfolioMetrics` | `metric_rollups.payload` or computed query |
| `alerts` / `insights` | `alert_records` / `insight_records` or engine output stored |

---

*Previous: `docs/backend-plan.md`. Next: API integration planning (`docs/api-integration-plan.md`) or start implementation spikes per provider.*
