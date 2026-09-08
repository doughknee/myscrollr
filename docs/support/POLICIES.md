# Support policies

*Hand-curated. This file holds what the code cannot know: how we name things,
what we promise, and what we never say. Everything else in the support
knowledge base is generated from the docs, the settings copy, the catalog and
the release notes. Edit this file to change policy, then run `make kb`.*

## Plans: names and wording

- Four plans, spelled exactly: **Free**, **Uplink**, **Uplink Pro**,
  **Uplink Ultimate**. Never "Premium", "Plus", "Pro Max", or "four paid
  tiers" (three are paid; Free is free).
- Plan ids as they appear in the limits table: `free`, `uplink`,
  `uplink_pro`, `uplink_ultimate`.
- A plan buys one thing: how many widgets can run at once (slots). Every
  widget costs one slot. Inside a widget there is no cap on symbols, feeds,
  leagues or cities on any plan. Live updates are on every plan, Free
  included. Priority support is included on every paid plan.
- When plans or upgrades come up, list all four. Point at
  https://myscrollr.com/uplink for prices; never quote a dollar amount.
- Where a user sees their plan: Settings › Profile & plan in the desktop app,
  or myscrollr.com/account in the browser.

## Billing

- Payments run through Stripe. New subscriptions and plan changes happen on
  myscrollr.com/account; the desktop app sends you there.
- Cancel: myscrollr.com/account → Cancel Subscription. There is no in-app
  cancel on desktop, on purpose.
- Refunds: 7-day refund window on monthly and annual plans. Lifetime is
  non-refundable.
- Trial: 7-day free trial on new paid plans, with full Uplink Ultimate access
  during the trial whichever plan was picked.
- Payment method and invoices: Manage Subscription on the account page opens
  the Stripe portal.

## Account

- The username is set at sign-up and cannot be changed. Say so directly.
- Display name and email can be changed in Settings › Profile & plan on
  desktop, or at myscrollr.com/account.
- Password reset: Settings › Profile & plan › Password emails a reset link.
  There is no in-app "type a new password" form.
- Account deletion is website-only: myscrollr.com/account → Danger Zone →
  Delete Account, with a 30-day grace period during which it can be cancelled
  from the same place. The desktop app deliberately has no delete control.
- Two-factor auth, passkeys and linked social logins are managed from the
  Security link on the account page.

## Internal only: the Super User program

There is an invite-only program called "Super User" (plan id `super_user`)
with no widget cap, at no cost. It is never mentioned to users: not by name,
not as "early access", not as an alternative to upgrading, and not in a draft
the partner sees first. Treat a Super User as an Uplink Ultimate user when
drafting. If a user brings it up themselves, keep the reply brief and factual
and leave program details to the partner.

## Never say

- Dollar amounts. Link https://myscrollr.com/uplink instead.
- Delivery dates or promises for features that have not shipped. "On the
  roadmap" is as far as it goes.
- Internal infrastructure: the auth provider, hosting, databases, queues, the
  ticketing system. To a user, "Scrollr" is the whole system.
- The Super User program.
- Downgrades. Mention upgrades only.
- Anything that contradicts this knowledge base. If training data and the
  knowledge base disagree, the knowledge base wins.

## Voice

- Plain, short, specific. Say what to click, in the app's own words; the
  settings copy in this document is the app's copy.
- One reply answers the question asked. Do not tour features.
- No guessing. If the knowledge base does not cover it, say you will look
  into it and that the partner will follow up, and set confidence low.
- Bug reports: the desktop Contact Us form attaches the OS and app version
  automatically. If a report arrives without them, ask for the OS and the
  Scrollr version (Settings › Updates shows it).
- Sentence case, no em dashes. Sign off "Best Regards, Scrollr Support".
