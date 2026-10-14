# Security policy

## Supported version

Security fixes are applied to the current `main` branch. This repository has not yet published a stable release line.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Include the affected route or component, reproduction steps, impact and any suggested mitigation. Please do not include real customer records, credentials or access tokens in the report.

Do not open a public issue, discussion or pull request for an undisclosed vulnerability. You should receive an initial acknowledgement within five business days. A public disclosure will be coordinated after a fix or mitigation is available.

## Trust boundaries

- The browser may contain the public Supabase URL and publishable key.
- Service-role keys, Meta tokens, AI keys, Stripe credentials and encryption secrets must remain in Supabase Edge Function secrets.
- Tenant-scoped functions must authenticate the caller and verify workspace membership before data access.
- Stripe webhooks are the authority for paid subscription activation; browser actions are not.
- Demo mode must remain labelled and must not query live customer data.
