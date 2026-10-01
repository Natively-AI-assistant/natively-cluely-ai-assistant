# Funnel telemetry

Install → trial → checkout → paid, for every user. Added 2026-10-01 after the trial review found
that the funnel could only be measured for 59% of buyers, through a device id that happened to
appear in an unrelated table, and not at all for anyone who did not buy.

Events are tied to the person, not only to an install: the device (`device_id`, the hardware id),
the trial (`trial_id`) and the account (`license_id`). The trial and the account are worked out by
the server from the trial token and Natively key a request carries; an event never names them.

## What is recorded

One table, `funnel_events` (natively-api migrations 025 and 026).

| Event | Written by | When |
|---|---|---|
| `app_first_run` | app | first launch of a new install |
| `app_active_day` | app | once per local day the app is open, with yes/no state (own AI, API key, Pro) |
| `onboarding_stage` | app | welcome, tour and permissions: shown, completed |
| `meeting_started`, `meeting_ended` | app | every meeting; whose AI answers, whole minutes, how many answers (a count) |
| `feature_used` | app | which features were used that day, once per feature per day |
| `card` | app | every card the app raises, from the card ledger: shown, acted, later, never |
| `trial_start_result` | app | every trial start, including the ones that fail and why |
| `trial_expired` | app | the trial ran out |
| `trial_card` | app | end-of-trial card: shown, plan clicked, own keys, dismissed |
| `checkout_opened` | app | any Dodo checkout link opened, with product and screen |
| `key_entered` | app | API key or Pro licence entered; accepted or not; minutes since trial start / own-keys exit |
| `upgrade_prompt`, `paywall_hit` | app | quota banner shown; locked Modes / Profile Intelligence opened |
| `trial_started`, `trial_reissued` | server | a trial row was created or re-issued; ties trial to install |
| `purchase_completed`, `checkout_failed`, `subscription_cancelled` | server | from Dodo webhooks; carries the install and screen the checkout link was opened from, and the amount |
| `subscription_renewed`, `subscription_on_hold` | server | the customer paid again (one row per billing period); a renewal payment failed and access stopped |
| `purchase_refunded`, `purchase_disputed` | server | a refund went through; a chargeback was opened. Filed under the purchase they reverse |

Rows with `props.backfill = true` are history from before 2026-10-01, written once by
`natively-api/scripts/funnel-backfill.mjs` from `free_trials` and Dodo: server events only, with the
ids the live server gives the same thing, so a replayed webhook cannot double them.

Properties are enums, whole numbers and booleans only. The allowlist is
`src/lib/funnel/funnelCatalog.mjs` and its twin `natively-api/lib/funnelCatalog.js`.

Never recorded: IP address, email (reach it through `license_id`), key, model name, any text.

## How the joins work

- **Event ↔ person:** `device_id` equals `free_trials.hwid` and `review_prompt_state.hardware_id`;
  `license_id` is `api_keys.id`; `trial_id` is `free_trials.id`. The report stitches every
  identifier that shares a row into one person, so a reinstall or a second install is the same person.

- **Trial ↔ install:** the app sends `install_id` with `/v1/trial/start`; the server writes `trial_started`.
- **Purchase ↔ install:** the main process adds `metadata_install_id`, `metadata_surface` and
  `metadata_product` to every Dodo checkout link as it is opened: the `open-external` handler, and
  the window-open handler in `main.ts` for a `target="_blank"` link, both through
  `FunnelTelemetry`. Dodo returns them on the webhook; the server writes `purchase_completed`.
- **Purchase ↔ account ↔ device:** no funnel row carries both a Dodo reference and an account, so
  the report reads the links from the tables that know (`natively-api/lib/funnelLinks.js`):
  `api_keys` (account ↔ subscription), `review_prompt_state` (device ↔ account), `pro_licenses`
  (a Pro purchase ↔ the accounts under the same email), `free_trials` (trial ↔ device).
- **Not joinable:** a Pro licence bought on the website by someone with no Natively API account.
  The app checks that licence with Dodo, not with our server, so nothing ties the purchase to the
  install. It counts as a buyer who never ran the app, and the install as an existing customer.

## Where it is off

- Unpackaged builds (`npm run dev`, `dev:agent`). Set `NATIVELY_FUNNEL_ENDPOINT` to a server of
  your own to exercise it in development; it never posts to production from a dev build.
- Settings › General › Advanced › Usage statistics turned off (`telemetryEnabled: false`). Nothing
  is recorded, checkout links are not tagged, and anything already queued is discarded. On by default.
- Server: `FUNNEL_EVENTS_ENABLED=0` answers 503 and clients keep their events.

## Made-up events

The endpoint takes no key and the app is open source, so nothing can prove an event came from the
real app. It is bounded instead (`natively-api/lib/funnelGuard.js`):

- every install registers once: it asks for a challenge, solves a small puzzle (about 2^19 hashes,
  a second or so, in background slices, never during a meeting) and gets a signed token that every
  funnel request must carry. The puzzle gets one bit harder for each further challenge an address
  asks for in a day, so minting installs from one address costs exponentially more
  (`natively-api/lib/funnelInstall.js`, `src/lib/funnel/funnelInstall.mjs`; base difficulty is
  `FUNNEL_POW_BITS` on the server and can be raised during an attack without an app release);
- one install per request;
- 300 events per install per day; per address, 50 installs and 3,000 events per day, with IPv6
  addresses grouped by /64; 250,000 rows per day overall (`FUNNEL_MAX_EVENTS_PER_INSTALL_PER_DAY`,
  `FUNNEL_MAX_INSTALLS_PER_IP_PER_DAY`, `FUNNEL_MAX_EVENTS_PER_IP_PER_DAY`, `FUNNEL_MAX_EVENTS_PER_DAY`);
- an event must claim a time no more than 35 days back or 2 days ahead;
- past the overall cap the endpoint answers 503, clients keep their events, and an alert goes out once;
- installs the server has itself recorded a new trial or a purchase for are **confirmed** and are not
  subject to the overall cap, so filling it with made-up installs cannot pause them. A failed checkout
  or a re-issued trial token confirms nothing: both can be produced for any install at no cost.

The counters live in the server's memory only; an address is held as a salted hash and never written.

Not stopped: someone with many real addresses can still post made-up installs up to the overall cap
and pause unconfirmed installs until UTC midnight (they keep their events and deliver the next day).
Only requiring an account would stop that.

Trial starts and purchases are written by the server from what it saw, and cannot be made up. The
report's "Can the client-side numbers be believed?" section sets claimed trial starts beside
confirmed ones; a wide gap means the client-side counts for that period should not be trusted.

## Order of release

1. Apply migration 025 (additive; safe before or after the code).
2. Deploy natively-api. Until the table exists the endpoint answers 503 and clients hold.
3. Ship the app.

To add an event or a value later: server catalogue first, deploy, then the app. The server refuses
what it does not know and the app drops a refused event for good.

## Reading it

```
cd natively-api
node scripts/funnel-report.mjs --days 30
node scripts/funnel-report.mjs --from 2026-10-01 --to 2026-10-15 --json
```

Read-only; prints counts and rates, never an id: by install, then by person. People are split into
NEW (first ran the app in the period: the stage table, where they stopped, every "install → …" rate,
retention, cohorts by week, platform and version), EXISTING (ran the app but were here before, with
how many were already paying) and people who never ran a reporting app. Trial → paid covers everyone
who started a trial; buyers get cancellations, failed renewals, refunds, chargebacks, "paid and
kept", renewals and revenue per currency. `lib/funnelReport.js` says what each number means and what
it cannot see (telemetry off, older app versions, purchases made outside the app).

One person's history, by email, device, install, trial or account:

```
node scripts/funnel-user.mjs --email someone@example.com
```

It prints that one person's events. Use it for a reason.

## Open before release

- **Notice.** PRIVACY.md promises notice before collection expands. §3.2.1 is a draft, and the policy
  the app links to is the one on the website, which needs the same section.
- **Dodo metadata.** Verified 2026-10-01 that a tagged link opens the same checkout page and that the
  session holds `metadata.install_id / surface / product`. Not yet seen on a webhook: after the first
  purchase from a tagged link, `attribution_coverage` in the report should be above zero.
- **GA4.** `src/lib/analytics/analytics.service.ts` loads Google Analytics in the renderer, while
  PRIVACY.md §2 says the app uses no third-party analytics. Not changed here.
