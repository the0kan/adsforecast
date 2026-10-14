# Contributing to AdsForecast

Thanks for improving AdsForecast. The project favours small, reviewable changes that preserve tenant isolation and make the product easier to operate.

## Before you start

1. Check existing issues and open a proposal before a large architecture or product change.
2. Read `README.md`, `AGENTS.md` and the relevant document under `docs/` or `specs/`.
3. Never include real customer data, access tokens, service-role keys or provider secrets in code, fixtures, screenshots or logs.

## Development workflow

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
npm run verify
```

Use a focused branch and keep commits scoped to one concern. If behaviour changes, update or add a browser check. If setup, architecture or operations change, update the corresponding documentation in the same pull request.

## Pull requests

A pull request should explain:

- the problem and why it matters;
- the chosen solution and important trade-offs;
- how the change was verified;
- any rollout, migration or security impact.

Before requesting review, confirm that `npm run verify` passes and that the pull request contains no secrets or unrelated generated files.

## Security issues

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.
