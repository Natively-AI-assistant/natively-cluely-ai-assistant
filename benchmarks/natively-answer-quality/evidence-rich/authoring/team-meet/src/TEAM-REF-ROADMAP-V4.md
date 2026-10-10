# Mossgauge 3.0 Roadmap

Version 4. Approved Monday 14 September 2026. Farrowgate Systems, Mobile Products.

Approved by Halvard Niemczyk (Engineering Manager) and Saoirse Lindqvang (Product Manager). Supersedes version 3 of 20 July 2026.

## 1. About this release

Mossgauge is the inspection app that utility field crews use to record site visits, photograph defects and file reports from their phones. Release 3.0 is the largest update since the app first shipped. It is built for the crews of our existing customers and does not change pricing or contracts.

At the start of September the app had roughly 48,000 active devices: 31,000 on Android and 17,000 on iOS.

## 2. Themes and scope

| Theme | What ships in 3.0 | Notes |
|---|---|---|
| Report export | Crews and supervisors can export inspection reports from the app | Formats and limits are recorded in the decision log |
| Photo annotation | Draw, label and measure on photos attached to an inspection | Phone and iPad |
| Sync API v3 | Quicker sync and server-side conflict handling | 2.x clients keep working during the changeover |
| Asset tag scanning | Scan the tag on an asset to open its inspection history | Supported tag types are recorded in the decision log |
| Dark theme | Follows the system setting on both platforms | No in-app switch in 3.0 |
| Stability | A crash-free sessions bar that both platforms must meet before and during rollout | The figure is recorded in the decision log |

Scope changes are recorded in the decision log, which is the source of record for what is in and out of the release. This roadmap lists themes, not every scope decision.

Candidates for 3.1 (target February 2027, not committed): Android tablet layout, saved export templates and a supervisor sign-off flow.

## 3. Milestones

| Milestone | Date | State |
|---|---|---|
| M1 Design complete | Thursday 27 August | Done |
| M2 Feature freeze | Friday 9 October | Planned |
| M3 Release candidate 1 | Wednesday 14 October | Planned |
| M4 Closed beta with three pilot customers | Thursday 15 October to Wednesday 28 October | Planned |
| M5 Store submission, both stores | Thursday 29 October | Planned |
| M6 Launch: rollout begins | Tuesday 3 November | Planned |
| M7 Maintenance release 3.0.1 | Tuesday 1 December | Planned |

We allow three working days for store review between submission and launch. If review takes longer, launch moves day for day.

## 4. Dependencies

- The Inkspindle PDF renderer, under a commercial licence, for PDF export.
- Sync API v3 running in production before the closed beta starts.
- Pilot customers nominate their crews before the release candidate is cut.
- Updated store listings: screenshots, description, and the data-safety and privacy declarations.

## 5. How we will launch

Rollout stages, the crash-free bar and the go/no-go rules are kept in the decision log and are not repeated here. Halvard chairs the weekly release review on Wednesdays. The weekly team sync is on Mondays.

## 6. Team

| Area | Lead |
|---|---|
| Android lead and release captain | Ilka Vantongeren |
| iOS | Dorrin Ashgrove-Patel |
| Backend and sync | Tobiah Kessenich |
| Report export | Yevgenia Marchetti-Oduya |
| Photo annotation | Lucinda Farthingale |
| QA | Corbin Thistlewood |
| Design | Emeka Rautavaara |
| Product | Saoirse Lindqvang |
| Engineering management | Halvard Niemczyk |

## 7. Not covered here

Pricing, customer contracts and the supervisor web console have their own plans and are not part of this roadmap.

## 8. Version history

- Version 4 (14 September 2026): launch moved out by two weeks and feature freeze by three weeks after the 9 September scope review; maintenance release added.
- Version 3 (20 July 2026): asset tag scanning added to scope.
- Version 2 (8 June 2026): first dated plan.
