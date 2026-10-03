# Fernlatch booking flow: project notes

Catarina Velmonte · Lumenquay · last updated 21 September 2026

Notes I keep on the Fernlatch rebuild: what we built, what we measured and what went wrong. Written up from the launch review of May 2023 and the experiment report, and tidied whenever I present the project. Traffic figures are from the launch quarter.

## 1. Context

Fernlatch is the flow a pet owner goes through to book an appointment at one of the clinics on Lumenquay. The flow we replaced was a single client-rendered application that shipped one 1.9 MB JavaScript bundle before anything appeared on screen. I was tech lead of 3 frontend engineers, working with 1 designer, from September 2022 to April 2023.

## 2. Traffic and devices

| Measure | Value |
|---|---|
| Booking sessions started on a typical weekday | about 52,000 |
| Busiest hour (Monday, 08:00 to 09:00) | about 6,900 sessions |
| Share of sessions on a phone | 78% |
| Weekend volume | roughly 40% of a weekday |
| Reference device for lab runs | a three-year-old mid-range Android phone on throttled 4G |

## 3. Rendering strategy

- Next.js 13 with the pages router. The first step (clinic page and service list) is rendered on the server, so that the largest element is already in the HTML.
- Clinic profile data uses incremental static regeneration with a revalidation time of 300 seconds; it changes a few times a week at most.
- Appointment slots are fetched in the browser and never cached for longer than 30 seconds, because a stale slot is a double booking waiting to happen.
- The five steps of the flow are client-side transitions with route-level code splitting; each later step is prefetched while the owner fills in the one before.

Considered and rejected:

- A fully static export: slots change too often and clinics edit their services daily.
- Keeping the single-page application and only splitting the bundle: the prototype got mobile LCP down to 3.1 s and no further.
- An islands framework: the booking flow shares components with the clinic web app, which is React, and we did not want two component models.

## 4. Bundle budget

First-load JavaScript at launch was 610 kB, which is 178 kB over the wire with Brotli.

| Part | Size |
|---|---|
| Framework and runtime | 190 kB |
| Date and calendar code | 85 kB |
| Application code | 335 kB |

The biggest single saving was replacing a 290 kB date library with a tree-shaken subset. The budget for the booking route is 650 kB of first-load JavaScript, enforced in Lighthouse CI; a pull request that adds more than 25 kB is blocked until someone signs off.

## 5. State management

- The URL is the source of truth for the current step and the selected service, so that back, forward and refresh behave.
- Server state (clinic, services, slots) lives in TanStack Query v4.
- The draft booking is a small Zustand store persisted to sessionStorage, so a refresh does not lose it.
- Forms use React Hook Form.
- We removed Redux. The old flow's store had 41 reducers, most of them caching server responses by hand.

## 6. Accessibility

Built to WCAG 2.1 AA, the current version at the time; the flow moved to 2.2 AA in 2024 when Pebblekit components replaced the hand-built ones.

- The date picker was rebuilt as an ARIA grid with a roving tabindex and arrow-key navigation.
- On every step change, focus moves to the step heading and the step is announced.
- Changes in slot availability are announced through a polite live region.
- Validation errors appear in a summary at the top of the step, each linked to its field.
- Touch targets are at least 44 px.

An internal audit two weeks before the experiment found 23 issues, 4 of them blocking; all 23 were fixed before it started. Manual passes used NVDA with Firefox and VoiceOver with Safari on iOS.

## 7. The March 2023 regression

| When (WET) | What happened |
|---|---|
| Wed 8 March 2023, 16:40 | Release 0.19 goes out. It formats slot times during server rendering. |
| Thu 9 March 2023, 18:55 | A support ticket from a clinic in the Azores and a real-user-monitoring alert arrive within minutes of each other. |
| Thu 9 March 2023, 19:20 | Release rolled back, 25 minutes after detection. |
| Mon 13 March 2023 | Fix released. |

Root cause: slot times were formatted on the server in the server's time zone and again in the browser in the clinic's. Where the two differed, the markup did not match, React threw away the server-rendered tree and rendered the page again in the browser, and for clinics outside the server's zone the first paint showed slots one hour off. Interaction delay at p75 went from 130 ms to 410 ms while the release was live, and 312 bookings were made at the wrong hour in the 26 hours before we caught it.

What we did: support contacted every affected clinic and owner within 2 days. The fix sends slots as ISO strings with the clinic's time zone and formats them only in the browser after mount. We added a Playwright run in three time zones and a rule that any hydration error fails the build.

## 8. Experiment results

A six-week A/B experiment, 20 February to 2 April 2023, split evenly by pet-owner account. Data from 8 and 9 March was dropped from both arms.

| Metric | Old flow | Fernlatch |
|---|---|---|
| Sessions | 853,400 | 852,100 |
| Booking completion, all devices | 61.2% | 66.8% |
| Booking completion, phones | 58.0% | 65.0% |
| Booking completion, desktop | 72.5% | 73.2% |
| Cancelled within one day | 4.1% | 4.0% |
| Support contacts per 1,000 bookings | 6.3 | 5.1 |

Completion rose by 5.6 percentage points. Almost all of the gain came from phones.

## 9. Performance, field data

Measured with real-user monitoring over the 28 days after full launch, mobile, p75:

- LCP from 4.3 s to 1.7 s.
- Interaction delay from 380 ms to 120 ms.
- Layout shift (CLS) from 0.21 to 0.04.

## 10. Rollout

Next.js on Node 18 containers behind the CDN. After the experiment, traffic moved to the new flow in three steps, 10%, 50% and 100%, over 9 days. The old flow was deleted in June 2023.

## 11. What I would change

I would put the multi-time-zone run in place before the first server-rendered release, not after the regression, and I would have measured on the reference phone from the first week instead of trusting laptop numbers.
