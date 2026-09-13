# AdsForecast — API integration plan (v0)

Planning document for connecting Meta Ads, WooCommerce, and Shopify. Verify endpoints, scopes, and API versions against official docs before implementation.

## 1. Shared practices

| Topic | Guidance |
|--------|----------|
| **Versions** | Pin Marketing API version, Woo REST `wc/v3`, Shopify Admin API date version (e.g. `2025-10`) — update on a schedule. |
| **Auth storage** | Long-lived tokens encrypted at rest; rotate on reconnect; never log secrets. |
| **Rate limits** | Centralize HTTP client with retry + exponential backoff + jitter; respect `Retry-After` / GraphQL cost throttling. |
| **Pagination** | Cursor / page links until exhausted; checkpoint cursors in `sync_jobs`. |
| **Idempotency** | Upsert by `(workspace_id, provider, external_id, date)` for facts. |
| **Webhooks** | Verify signatures (Shopify HMAC, Woo secret); idempotent handler by delivery id. |

## 2. Meta (Marketing API)

### 2.1 Purpose

Pull **campaign / ad set / ad** performance and spend; optional **conversion** metrics where configured. Join in app with store revenue using your attribution model (v1: time-window or rules table).

### 2.2 Access

- **OAuth** via Meta for Business / System User (exact flow depends on app review and use case).
- Store: long-lived user or system user token; track expiry.

### 2.3 Data to fetch (initial scope)

| Entity | Typical use |
|--------|-------------|
| `adaccount` | Validate account id, currency, timezone. |
| `campaigns` | Names, status, objective. |
| `insights` | `level=campaign` (then adset/ad later), `time_range`, fields: `spend`, `impressions`, `clicks`, `actions` / `action_values` for purchases/revenue if available. |

### 2.4 Notes

- **Attribution**: Meta-reported revenue may differ from store revenue; product truth for profit is usually **store orders** + your cost model.
- **Breaking changes**: Subscribe to Meta changelog; version Marketing API in URL.

### 2.5 References (official)

- [Marketing API overview](https://developers.facebook.com/docs/marketing-apis)
- [Insights edge](https://developers.facebook.com/docs/marketing-api/insights)

## 3. WooCommerce (REST API)

### 3.1 Purpose

Read **orders** (and refunds) to compute revenue, COGS hooks (line items / product meta), returns.

### 3.2 Access

- **REST API keys** (read) or **OAuth** for hosted Woo; HTTPS required.
- Store **consumer key/secret** or OAuth tokens encrypted.

### 3.3 Data to fetch (initial scope)

| Endpoint area | Typical use |
|---------------|-------------|
| `GET /wp-json/wc/v3/orders` | Paginated; filter `after` by `modified` for incremental sync. |
| `GET /wp-json/wc/v3/orders/{id}` | Detail when needed. |
| Refunds | Via order object or refunds endpoint per WC version. |

### 3.4 Webhooks (recommended)

- Register WooCommerce webhooks for `order.created`, `order.updated` → your HTTPS endpoint → enqueue incremental sync.

### 3.5 References (official)

- [WooCommerce REST API](https://woocommerce.github.io/woocommerce-rest-api-docs/)

## 4. Shopify (Admin API)

### 4.1 Purpose

Read **orders** and financial status for revenue; line items for margin analysis later.

### 4.2 Access

- **OAuth** install flow; store offline access token (encrypted).
- Request minimal **scopes**: e.g. `read_orders`, `read_products` (only if needed for COGS).

### 4.3 Data to fetch (initial scope)

| API | Typical use |
|-----|----------------|
| GraphQL or REST Orders | Paginated list; `updated_at` filter for incremental. |
| Optional: `Shop` | Currency, timezone, domain. |

### 4.4 Webhooks

- Subscribe to `orders/create`, `orders/updated`, `orders/paid` (as needed); verify **HMAC** on each payload.

### 4.5 References (official)

- [Shopify Admin API](https://shopify.dev/docs/api/admin-rest)
- [Shopify GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql)

## 5. Join strategy (product logic, not API)

APIs do not return “Meta campaign X → Woo order Y” by default. Plan explicitly:

1. **v1 heuristic**: attribute store orders in a **time window** after click (requires click/UTM data from storefront or Meta — often incomplete).
2. **v2**: UTM / order note / first-party pixel events stored in your DB for join keys.
3. **Reporting**: Separate **“Meta ROAS (platform)”** from **“True profit (store)”** until attribution improves.

Document chosen rule in app; surface in dashboard copy to avoid false precision.

## 6. Sync sequence (recommended job order)

1. Validate connections (token probe).
2. Pull **Meta insights** for date range → `campaign_facts`.
3. Pull **orders** from Woo / Shopify → `order_facts`.
4. Run **rollup** job → `metric_rollups` / dashboard payload.
5. Run **insights engine** (server) → persist `insight_records` / `alert_records`.

On failure: mark `sync_jobs` failed, surface connection status in UI (already styled in dashboard).

## 7. Contract with frontend

- Backend response for `GET /v1/workspaces/:id/dashboard` should converge to **`getDashboardPayload()`** shape (`data.js`) with stable field names for `campaigns`, `integrations`, `portfolioMetrics`, etc.
- Add `meta.syncedAt` and per-connection `lastSyncAt` for transparency.

---

*Prior docs: `backend-plan.md`, `database-plan.md`. Next: real backend implementation spikes (per provider) or CI/deploy.*
