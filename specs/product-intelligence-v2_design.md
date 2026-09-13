# AdsForecast Product Intelligence v2 — Technical Design

## Objective

Turn the authenticated product into a coherent paid-media decision workspace without changing the public-site brand direction or fabricating live data. The upgrade fixes the signed-in logo route, exposes the connected Meta account and synchronization state, expands Campaigns into a technically credible command center, and turns AI Analyst into a comprehensive evidence-led workspace.

## Scope and requirements

### Session-aware navigation

- When an authenticated or demo user selects the AdsForecast logo inside the product, the system shall navigate to the matching Overview route and shall preserve demo mode when applicable.
- When an authenticated user visits the public landing page, the primary authentication actions shall become an “Open dashboard” action without automatically redirecting the user.
- The system shall only terminate a Supabase session after an explicit sign-out action.

### Connected Meta workspace

- When a Meta connection exists, the sidebar shall show the connected account name, masked account identifier, connection state, and latest synchronization time/status.
- When no Meta connection exists, the sidebar shall show an honest setup state and a direct route to Integrations.
- When demo mode is active, the sidebar shall clearly label the account and synchronization data as sample data.
- The backend shall derive the latest sync state from the existing private `meta_sync_logs` table; browser clients shall not query that table directly.

### Campaign command center

- When campaigns are loaded, Campaigns shall show reporting scope, account/source state, spend, attributed purchase value, modeled profit, purchases, risk spend, blended ROAS, break-even ROAS, attribution coverage, and spend concentration.
- When the user changes the saved profit model, campaign profit, margin, break-even ROAS, decisions, and portfolio totals shall use that same model.
- Campaign decisions shall distinguish scale, hold, repair, and stop/review conditions using purchase coverage, modeled profit, ROAS relative to break-even, and spend.
- Technical diagnostics shall use only available Meta fields; unavailable impressions, clicks, time-series, or forecasts shall not be invented.
- The table shall remain keyboard accessible and shall transform into readable cards on narrow screens.
- Campaigns shall include a concise AI recommendation preview and a clear path to the complete AI Analyst workspace.

### AI Analyst workspace

- When a completed analysis exists, AI Analyst shall show provider/model, reporting scope, run timestamp, campaign count, executive summary, recommendations, confidence, evidence, rationale, and human-review guardrails.
- The workspace shall show portfolio diagnostics derived from the same live campaign data and saved profit model as Campaigns.
- Users shall be able to filter recommendations by decision lens and confidence without re-running analysis.
- The backend shall return recent analysis-run history from the existing indexed run table.
- The interface shall explicitly state that analysis is advisory and that no Meta campaign changes are made automatically.

### Reliability, security, and accessibility

- Authenticated Edge Functions shall continue to validate the Supabase bearer token server-side and resolve workspace ownership from the verified user.
- Secret Meta and AI credentials shall remain server-side; browser responses and UI shall not expose them.
- Read-only browser requests may retry once with bounded exponential backoff after timeout/network/5xx failures; mutation requests shall not be retried automatically.
- Empty, loading, live, demo, setup-required, and error states shall remain visually and semantically distinct.
- Interactive controls shall have visible focus, meaningful accessible names, and at least a 44px practical hit target where layout permits.
- Status meaning shall never rely on color alone.

## Architecture

### Frontend

- `app-shell.js`: route-safe logo, session-aware shared shell, connected Meta sidebar card.
- `marketing.js`: non-blocking Supabase session detection that upgrades public calls to action.
- `profit-model.js`: one source of truth for cost rate, break-even ROAS, modeled campaign profit, portfolio diagnostics, and campaign decisions.
- `campaigns.js` / `campaigns.html`: command-center presentation and compact AI preview.
- `insights.js` / `insights.html`: analysis scope, portfolio diagnostics, evidence-led recommendations, history, and governance.
- `app-meta.js` / `app-ai.js`: bounded timeouts and GET-only retry behavior.

### Backend

- `meta-connection`: returns the user-authorized connection plus its latest private synchronization log.
- `ai-insights`: returns the latest completed run, its recommendations, and a bounded recent run history.
- Existing `ai-analyze`: remains the only analysis mutation endpoint and retains rate limiting, prompt-injection boundaries, schema validation, provider fallback, and advisory-only output.

### Data and privacy

- One non-destructive composite index is added for the frequent “latest sync for workspace” lookup. The existing analysis-run index already supports bounded history reads.
- Meta tokens and AI provider keys remain encrypted/server-side and are never serialized to the client.
- Live product views never fall back to demo rows. Sample rows are only available through explicit demo mode and are labeled.

## Error handling and observability

- Network calls use an abort timeout and one bounded retry only for safe GET requests.
- The sidebar exposes the latest synchronization success/failure state from `meta_sync_logs` without leaking internal error detail.
- AI and Meta failures render actionable setup/retry states while keeping existing data source labels visible.
- Edge Functions return the existing structured JSON errors and security headers.

## Acceptance criteria

1. Clicking the product logo from any authenticated product page opens Overview and does not call sign-out.
2. Visiting the public landing page with an active Supabase session shows “Open dashboard” instead of “Sign in” / “Create workspace”.
3. Connected Meta account and last sync state appear in the sidebar on every product page; demo and disconnected states are explicit.
4. Campaign totals and decisions change consistently with the saved cost model and use a visible break-even ROAS.
5. Campaigns shows real account scope, portfolio diagnostics, allocation context, an accessible responsive table, and a short AI preview.
6. AI Analyst shows run metadata, live portfolio diagnostics, evidence/confidence, filters, recent run history, and a human-approval boundary.
7. No live page displays sample campaign values or fabricated technical metrics.
8. Keyboard navigation, focus visibility, reduced-motion behavior, 320px layout, and desktop layout pass browser checks.
9. Frontend syntax/tests, Edge Function checks, authenticated-boundary tests, and live deployment smoke tests pass before handoff.

## Rollout and rollback

- Deploy Edge Functions first because added response fields are backward compatible.
- Deploy versioned frontend assets and HTML second.
- Back up each existing remote file before upload and verify remote checksums after upload.
- Rollback is a direct restore of the backed-up frontend files and previous Edge Function source. The additive sync-log index may safely remain; it does not change application data or behavior.
