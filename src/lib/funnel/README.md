# Funnel telemetry

Install → trial → checkout → paid, for every install. Added 2026-10-01 after the trial review
found that the funnel could only be measured for 59% of buyers, through a device id that happened
to appear in an unrelated table, and not at all for anyone who did not buy.

## What is recorded

One table, `funnel_events` (natively-api migration 025), keyed on the random install id.

| Event | Written by | When |
|---|---|---|
| `app_first_run` | app | first launch of a new install |
| `app_active_day` | app | once per local day the app is open, with yes/no state (own AI, API key, Pro) |
| `meeting_started`, `meeting_ended` | app | every meeting; whose AI answers, whole minutes |
| `card` | app | every card the app raises, from the card ledger: shown, acted, later, never |
| `trial_start_result` | app | every trial start, including the ones that fail and why |
| `trial_expired` | app | the trial ran out |
| `trial_card` | app | end-of-trial card: shown, plan clicked, own keys, dismissed |
| `checkout_opened` | app | any Dodo checkout link opened, with product and screen |
| `key_entered` | app | API key or Pro licence entered; accepted or not; minutes since trial start / own-keys exit |
| `upgrade_prompt`, `paywall_hit` | app | quota banner shown; locked Modes / Profile Intelligence opened |
| `trial_started`, `trial_reissued` | server | a trial row was created or re-issued; ties trial to install |
| `purchase_completed`, `checkout_failed`, `subscription_cancelled` | server | from Dodo webhooks; carries the install and screen the checkout link was opened from |

Properties are enums, whole numbers and booleans only. The allowlist is
`src/lib/funnel/funnelCatalog.mjs` and its twin `natively-api/lib/funnelCatalog.js`.

Never recorded: IP address, hardware id, email, key, model name, any text.

## How the joins work

- **Trial ↔ install:** the app sends `install_id` with `/v1/trial/start`; the server writes `trial_started`.
- **Purchase ↔ install:** the main process adds `metadata_install_id`, `metadata_surface` and
  `metadata_product` to every Dodo checkout link as it is opened (the `open-external` handler, so
  no link can be missed). Dodo returns them on the webhook; the server writes `purchase_completed`.
- **Purchase ↔ account:** `funnel_events.dodo_ref` equals `api_keys.dodo_subscription_id` or
  `pro_licenses.dodo_payment_id`.

## Where it is off

- Unpackaged builds (`npm run dev`, `dev:agent`). Set `NATIVELY_FUNNEL_ENDPOINT` to a server of
  your own to exercise it in development; it never posts to production from a dev build.
- Settings › General › Advanced › Usage statistics turned off (`telemetryEnabled: false`). Nothing
  is recorded, checkout links are not tagged, and anything already queued is discarded. On by default.
- Server: `FUNNEL_EVENTS_ENABLED=0` answers 503 and clients keep their events.

## Made-up events

The endpoint takes no key and the app is open source, so nothing can prove an event came from the
real app. It is bounded instead (`natively-api/lib/funnelGuard.js`):

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

Read-only; prints counts and rates, never an id. `lib/funnelReport.js` says what each number
means and what it cannot see (telemetry off, older app versions, purchases made outside the app).

## Open before release

- **Notice.** PRIVACY.md promises notice before collection expands. §3.2.1 is a draft, and the policy
  the app links to is the one on the website, which needs the same section.
- **Dodo metadata.** Verified 2026-10-01 that a tagged link opens the same checkout page and that the
  session holds `metadata.install_id / surface / product`. Not yet seen on a webhook: after the first
  purchase from a tagged link, `attribution_coverage` in the report should be above zero.
- **GA4.** `src/lib/analytics/analytics.service.ts` loads Google Analytics in the renderer, while
  PRIVACY.md §2 says the app uses no third-party analytics. Not changed here.
