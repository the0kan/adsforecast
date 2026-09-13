# AdsForecast admin operations

## Access model

Platform access is independent of workspace ownership. Roles live in `platform_admins` and are enforced by `admin-console`:

- `viewer`: read-only visibility.
- `operator`: launch and general operations.
- `support_admin`: customer ticket operations.
- `billing_admin`: plan and subscription operations.
- `super_admin`: administrator management and all capabilities.

Never grant platform access merely because somebody owns a customer workspace.

## Daily checks

1. Review launch readiness and provider status.
2. Triage open and urgent tickets.
3. Review failed billing events and AI runs.
4. Check Meta connection expiry and latest sync evidence.
5. Review audit entries for unexpected changes.

## Subscription handling

- Treat verified webhook state as authoritative.
- A checkout draft is not a paid subscription.
- Never manually mark a workspace paid to fix a browser display issue.
- Investigate the Stripe event, ordering and stored billing event first.
- Keep Stripe mappings synchronized with the public plan catalog.

## Support handling

- Customer replies are visible to the customer; internal notes must remain internal.
- Never request passwords, Meta tokens, API keys or card information.
- Use `urgent` only for material access, data or billing incidents.
- Use `waiting_customer` when customer action is needed.

## Launch states

- `private_beta`: controlled owner testing.
- `invite_only`: approved customer onboarding.
- `public`: unrestricted entry, only after the release gate passes.

Every change is audited. A launch-state change does not deploy files or configure providers.

## Incident response

1. Restrict access to `private_beta`.
2. Identify the affected frontend, function, database or provider boundary.
3. Preserve audit, billing, sync and support records.
4. Rotate any secret with suspected exposure.
5. Use forward database migrations; do not rewrite production history.
6. Verify the fix before restoring access.
