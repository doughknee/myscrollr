# myscrollr.com

The marketing site, legal hub, and billing surface for
[Scrollr](https://myscrollr.com) — the desktop app that pins a live
ticker on top of whatever you're working on.

> This package is the **website**, not the product. The actual ticker
> lives in [`desktop/`](../desktop/). See the
> [root README](../README.md) for the full architecture.

## What this site does

- Landing page, pricing page, channel catalog, download page, legal
  hub.
- Auth handoff via Logto (`/callback`).
- Stripe checkout for subscriptions and lifetime purchases, including
  trial setup, proration previews, and plan switching.
- Account dashboard (`/account`) — subscription management, GDPR
  export + 30-day soft-delete.
- Public pricing data comes from the core API at
  `GET https://api.myscrollr.com/tier-limits` so desktop, website, and
  backend never disagree about caps.

## Tech

React 19, Vite 7, TanStack Router (file-based), Tailwind v4,
`@logto/react`, `@stripe/react-stripe-js`, Motion. Node 22 in CI.

## Local development

```sh
npm install
cp .env.example .env   # fill in VITE_API_URL, Logto, Stripe publishable
npm run dev            # http://localhost:3000
```

You will also need the core API running (see [`../api/`](../api/)),
which itself needs Postgres, Redis, Logto, and Stripe. For
website-only work against production APIs, set
`VITE_API_URL=https://api.myscrollr.com` in `.env` — all the
tier-limit, billing, and legal endpoints are live and safe to read.

## Scripts

| Script           | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `npm run dev`    | Vite dev server on port 3000.                                      |
| `npm run build`  | `vite build && tsc` — ships to `dist/`.                            |
| `npm run serve`  | Preview the production build locally.                              |
| `npm run check`  | `prettier --write . && eslint --fix` — run this before committing. |
| `npm run lint`   | ESLint only.                                                       |
| `npm run format` | Prettier only.                                                     |

## Deployment

Built as a Docker image via `Dockerfile`, pushed to DigitalOcean
Container Registry by `.github/workflows/deploy.yml`, served by nginx
behind the `scrollr.myscrollr.com` ingress. Environment variables are
injected from the `scrollr-secrets` k8s secret. CSP, HSTS, and
Permissions-Policy are configured in the image's nginx.conf.

## Conventions

- **No semicolons, single quotes, trailing commas.** Prettier + ESLint
  are the source of truth; run `npm run check` before a PR.
- **Named exports only** (except route modules, which must default-
  export via `createFileRoute`).
- **Path alias `@/`** maps to `src/`.
- **Tailwind v4 zero-config** via `@tailwindcss/vite`. No
  `tailwind.config.*`.
- **Dark mode** toggles via `.dark` class on `<html>` (see
  `useTheme`).
- **Fonts** are self-hosted in `public/fonts/` via `@font-face` so we
  can ship a tight CSP.
- **Analytics:** none. Zero tracking pixels, zero telemetry — this is
  a public product promise. Don't add any without a conversation
  first.

## Structure

```
src/
├── api/                 # fetch client, typed endpoint wrappers
├── components/          # UI components (hero, pricing cards, legal docs, etc.)
├── hooks/               # useScrollrAuth, useGetToken, useTheme, etc.
├── lib/                 # seo(), structured-data templates, seededRandom, etc.
├── routes/              # file-based TanStack Router routes
│   ├── __root.tsx       # shell + error boundary + global layout
│   ├── index.tsx        # home / landing
│   ├── uplink.tsx       # pricing
│   ├── uplink_.lifetime.tsx  # lifetime pitch
│   ├── account.tsx      # authed account dashboard
│   ├── channels.tsx     # channel catalog
│   ├── architecture.tsx # tech stack explainer
│   ├── download.tsx     # OS-detecting download page
│   ├── legal.tsx        # 14-document legal hub
│   ├── status.tsx       # system status
│   ├── invite.tsx       # super-user invite completion
│   ├── callback.tsx     # Logto OAuth redirect
│   └── u.$username.tsx  # public profile
├── main.tsx             # entry — Logto provider, router
└── styles.css           # Tailwind + design tokens
```

## License

AGPL-3.0-or-later. See the [root LICENSE](../LICENSE).

## Contributing

See the [root `CONTRIBUTING.md`](../CONTRIBUTING.md).
