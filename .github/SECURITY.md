# Security Policy

Thanks for helping keep Scrollr safe for its users.

## Supported versions

| Area               | Supported branch | Supported releases                                |
|--------------------|------------------|---------------------------------------------------|
| Desktop app        | `main`           | Most recent two minor versions (e.g. 1.0.x, 0.9.x) |
| Server & channels  | `main`           | Whatever is running in production                 |
| Marketing site     | `main`           | Whatever is running at `myscrollr.com`            |

Older releases are out of support. If you find a vulnerability that
only affects an older desktop build, upgrade first and re-verify before
reporting.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for suspected security
problems. Instead:

- Email **[security@myscrollr.com](mailto:security@myscrollr.com)**
  with a clear description, reproduction steps, and (if you can) a
  proof-of-concept.
- If you prefer encrypted email, request our PGP key in an initial
  unencrypted message.
- You will receive an acknowledgement within **three business days**.
- We aim to ship a fix for critical issues within **14 days**, and
  moderate issues within **30 days**. Complex fixes may take longer;
  we will keep you updated.

## What counts

These are in scope and we want to hear about them:

- Authentication or authorization bypasses (Logto session, JWT, Yahoo
  OAuth state validation, invite-token flow).
- Any way to read or modify another user's data.
- Remote code execution, command injection, SQL injection,
  deserialization bugs.
- Broken access control on `/users/me/*` or `/admin/*` endpoints.
- Leaks of Stripe IDs, Yahoo refresh tokens, Logto `sub` values, or
  other personally identifying data.
- Account takeover through password reset, invite flow, or OAuth.
- SSRF, cache poisoning, or cross-tenant data access in any channel
  ingestion service (finance / sports / rss / fantasy).
- Supply-chain compromises in our published desktop binaries.

These are **not** in scope — please don't send reports about them:

- Missing security headers on non-sensitive static pages.
- Self-XSS that requires the user to paste attacker-supplied code into
  their own devtools console.
- Rate-limit behavior on unauthenticated endpoints (we already
  rate-limit them; please don't stress-test production).
- Reports from automated scanners without verification.
- Social-engineering the team.

## What to expect

- We review every report. If we confirm a valid issue, we will discuss
  disclosure timing with you and credit you in the advisory (or keep
  you anonymous if you prefer).
- We do not currently pay bounties. We are a small team and fund the
  project from subscription revenue — but we will happily list
  reporters on the project's security advisories.
- We will not pursue legal action against researchers who follow this
  policy in good faith.

## Responsible disclosure

- Give us a reasonable window to ship a fix before disclosing publicly.
- Do not access accounts other than your own. Do not destroy or
  exfiltrate user data.
- If you accidentally access another user's data, stop and tell us —
  we will not hold it against you.

Thank you for helping keep Scrollr users safe.
