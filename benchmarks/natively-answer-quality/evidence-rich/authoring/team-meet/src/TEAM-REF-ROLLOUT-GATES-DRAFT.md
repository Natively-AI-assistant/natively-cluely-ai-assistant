# Rollout gates v2 - DRAFT

Status: DRAFT for discussion. Not approved. Proposed for the release review on Wednesday 14 October 2026.

Author: Corbin Thistlewood, QA Lead

Circulated: Wednesday 30 September 2026

## Why this proposal

The rollout rules agreed in September were written before we had any beta data. After two weeks of beta builds I think the stages are slower than they need to be at the start and too lenient on stability at the end. This note proposes changes for the team to argue about. Until the release review accepts them, the decision log stands.

## Proposed stages (Android)

| Stage | Share of devices | Minimum time at stage |
|---|---|---|
| 1 | 10% | 2 days |
| 2 | 40% | 5 days |
| 3 | Everyone | No minimum |

Fewer and larger stages give us numbers we can trust sooner. With a very small first stage the daily session count is too low to tell a real regression from noise in under three days.

## Proposed stability gates

- Raise the crash-free sessions bar to 99.7% on each platform.
- Halt the rollout if crash-free sessions fall below 99.4% at any stage.
- Add an ANR gate on Android: halt if the ANR rate goes above 0.3% of sessions.
- Add a sync error gate: halt if more than 1 in 500 sync attempts fail.

## What this would cost

- Roughly one more week of stabilisation on Android before the release candidate, judging by where beta build b5 stands.
- A dashboard for the ANR rate, which we do not have. I estimate two days of work.
- Someone on a rota to watch the numbers over the weekend during stage 2.

## What I am not proposing

No change to the iOS phased release, to the go/no-go meeting, or to who can halt the rollout.

## Open points

- Is the higher bar realistic for Android, given the low-memory devices?
- Should the gates apply from the 3.0 launch or from the first maintenance release?
- Who would own the ANR dashboard?

## Feedback so far

Dorrin supports fewer stages. Tobiah wants the sync error gate whatever happens to the rest. Ilka has not yet reviewed the proposal.
