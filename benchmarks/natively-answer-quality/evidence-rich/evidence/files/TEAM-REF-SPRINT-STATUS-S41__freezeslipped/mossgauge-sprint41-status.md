# Mossgauge 3.0 - Sprint 41 status

Sprint 41: Monday 28 September to Friday 9 October 2026

Status as of: Friday 2 October 2026 (end of week 1)

Compiled by: Halvard Niemczyk, Engineering Manager

Audience: Mossgauge mobile team and Farrowgate Systems product leadership

## Headline

Overall status is AMBER. The feature freeze has moved by two working days to Tuesday 13 October. The device lab is closed for a power shutdown on Thursday 8 and Friday 9 October, so the regression pass that has to finish before the freeze cannot complete until Monday 12 October, and Halvard moved the freeze rather than freeze without it. Release candidate 1 stays on Wednesday 14 October. Export and store submission prep remain at amber. The launch date on the roadmap is unchanged.

## Sprint numbers

- Committed: 84 points
- Done: 52 points
- In progress: 21 points
- Not started: 11 points
- Carried over from Sprint 40: 3 points, both export stories

Sprint 40 closed at 78 of 81 points, so the team is running slightly ahead of its usual pace for the first week.

## Workstreams

| Workstream | Owner | Complete | Status | Due | Blocker |
|---|---|---|---|---|---|
| Android client | Ilka Vantongeren | 85% | Green | Thursday 8 October | None |
| iOS client | Dorrin Ashgrove-Patel | 90% | Green | Thursday 8 October | None |
| Report export (PDF and CSV) | Yevgenia Marchetti-Oduya | 70% | Amber | Wednesday 7 October | MG-2291: PDF renderer drops embedded fonts |
| Sync API v3 | Tobiah Kessenich | 95% | Green | Tuesday 6 October | None |
| Photo annotation | Lucinda Farthingale | 100% | Done | Closed Wednesday 30 September | None |
| Regression and release QA | Corbin Thistlewood | 55% | Amber | Tuesday 13 October | Device lab closed on Thursday 8 and Friday 9 October |
| Store submission prep | Dorrin Ashgrove-Patel | 30% | Amber | Thursday 29 October | Play Data safety form is waiting on the updated third-party SDK list from Tobiah |

## Blockers this week

MG-2291 (export). The Inkspindle PDF renderer drops embedded fonts for site names written in non-Latin scripts, so those names print as empty boxes. The licence problem that held export up at the start of the sprint is closed: finance approved the Inkspindle purchase order on Thursday 1 October. Inkspindle has promised patch 4.2.1 for Tuesday 6 October. Yevgenia is also preparing a workaround that bundles Noto fonts with the app, which adds about 6 MB to the download. CSV export is finished and has passed QA.

Play Data safety form (store submission). Dorrin cannot complete the form until Tobiah sends the updated SDK list. This does not threaten the freeze, only the submission milestone.

No other workstream reported a blocker.

## Quality

- Open P0 defects: none on either platform or on the backend.
- Open P1 defects: 4 on Android, 2 on iOS, 1 on the backend.
- Crash-free sessions on beta build b6 since it reached the beta track: 99.2% on Android and 99.6% on iOS. These are early figures; the seven-day figures follow next week.
- MG-2240, the camera-permission resume crash that was the largest Android crash cluster, is fixed and shipped in b6 on Thursday 1 October.
- The two remaining Android crash clusters are the sync worker running out of memory on low-RAM devices and the map tile cache. Fixes for both are planned for beta build b7.

## Workstream notes

Android. Remaining work is dark theme polish on the inspection list and the permission flow for the asset tag scanner. No scope has been added this sprint.

iOS. Remaining work is the split view for photo annotation on iPad and two accessibility labels on the export sheet.

Sync API v3. All client work is merged. The production cut-over is booked for Tuesday 6 October, outside the working hours of the pilot customers. Dual-write stays on after the cut-over so that 2.x clients keep working.

Regression and release QA. The smoke subset runs on every merge. The full regression pass before the freeze starts on Wednesday 7 October.

## People and calendar

- Tobiah Kessenich is on leave from Monday 12 October and is back on Monday 19 October.
- Sprint 41 review and demo: Friday 9 October at 15:00.
- Sprint 42 runs from Monday 12 October to Friday 23 October and covers release candidate support and the closed beta.
