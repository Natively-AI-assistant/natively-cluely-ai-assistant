# Mossgauge 3.0 - Sprint 37 report

Sprint 37: Monday 3 August to Friday 14 August 2026

Report date: Friday 14 August 2026

Compiled by: Halvard Niemczyk, Engineering Manager

## Summary

Sprint 37 finished at 58 of 76 committed points. The plan of record is a feature freeze on Friday 18 September and launch on Tuesday 20 October. All workstreams report green except export, which started late.

## Highlights

- The rebuilt inspection list and detail screens are in the Android nightly build.
- iOS photo capture is complete and in review.
- The design for conflict handling in the new sync API was agreed with the backend team.
- The PDF renderer was chosen at the end of July, so export layout work could finally begin.

## Workstreams

| Workstream | Owner | Complete | Status | Notes |
|---|---|---|---|---|
| Android client | Petra Hollowbrook | 42% | Green | Inspection list and detail screens rebuilt; photo capture next |
| iOS client | Dorrin Ashgrove-Patel | 58% | Green | Ahead of Android on photo capture |
| Report export (PDF, CSV and XLSX) | Yevgenia Marchetti-Oduya | 20% | Amber | Renderer chosen; the XLSX library is still being evaluated |
| Sync API v3 | Tobiah Kessenich | 65% | Green | Conflict handling design agreed |
| Photo annotation | Emeka Rautavaara | 48% | Green | Design and prototype; the build moves to engineering in Sprint 38 |
| Asset tag scanning | Petra Hollowbrook | 15% | Green | Scope agreed this week |

## Release parameters in force

- Minimum systems: Android 9 and iOS 15, the same as the 2.x line.
- Stability bar: 99.0% crash-free sessions.
- Release approach: full release to all users on launch day, as for 2.4.
- Closed beta: two weeks, customers to be confirmed.

## Quality

Open P0: 0. Open P1: 11 (Android 6, iOS 3, backend 2). Crash-free figures are not yet meaningful because the first 3.0 beta build has not shipped.

## Risks raised

- Export started two weeks late because the renderer decision took longer than planned.
- The Android team is one engineer short until September.
- Device lab bookings clash with the billing app team in the week of 7 September.

## Decisions needed

- Whether the minimum systems should move up for 3.0. Dorrin will bring device share numbers to the release review.
- Who builds photo annotation once the prototype is signed off.

## Next sprint

Sprint 38 runs from Monday 17 August to Friday 28 August. Planned: Android photo capture, export PDF layout, the conflict handling build for sync, and the first beta build, b1.
