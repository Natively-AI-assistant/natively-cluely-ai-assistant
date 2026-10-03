# Televisit platform: on-call onboarding checklist

Brackenmoor Health · Platform Reliability · revision 7 · 11 August 2026

Owner: Ilse Varnholt, Reliability Lead

This checklist is for engineers joining the Televisit on-call rotation. Televisit is the video-visit product that connects patients with clinicians; it is separate from the Pharmacy and Billing platforms, which have their own rotations. Work through every section with your onboarding buddy and have your manager sign the last section before your first solo shift.

## 1. Before your first shadow shift

- Request pager access and confirm that the app rings through Do Not Disturb.
- Read the 42 runbooks in the Televisit space. Start with "Visit will not connect" and "Media relay saturation".
- Get read access to the production dashboards and to the visit-events Kafka cluster (5 brokers, 36 partitions on the main topic).
- Join the incident channel and the weekly reliability review on Thursdays.
- Install the incident tooling and run the paging drill with your buddy.

## 2. How the rotation works

| Item | Rule |
|---|---|
| Rotation | One week in four as primary, handover on Wednesday at 11:00 |
| Shadowing | Two full shadow shifts before going solo |
| Acknowledge a Sev-1 page | within 5 minutes |
| Acknowledge a Sev-2 page | within 15 minutes |
| Escalate to the secondary | after 10 minutes without progress |
| Compensation | A flat stipend per on-call week, and time off in lieu for night pages |

Swaps are arranged between engineers and recorded in the scheduling tool at least 48 hours ahead. Nobody carries the pager two weeks running.

## 3. What good looks like

The service levels you are defending:

| Objective | Target |
|---|---|
| Visit join success | 99.9% per calendar month |
| Time to join a visit | p99 under 1.8 seconds |
| Media relay packet loss | under 0.5% |
| Peak load the platform is sized for | 3,400 concurrent visits |

A 99.9% monthly objective leaves about 43 minutes of error budget. When more than half of it is gone before the 15th of the month, feature releases pause until the reliability review lifts the freeze.

## 4. Your first incident

1. Acknowledge the page and say so in the incident channel.
2. Open the runbook linked in the alert. If there is none, say that too.
3. Declare the severity. When in doubt, go one level higher; downgrading is free.
4. Ask for an incident commander for anything at Sev-2 or above. You do not have to run it yourself in your first three months.
5. Write the timeline as you go. Reconstructing it afterwards costs the review an hour.

Last year the rotation handled 31 incidents at Sev-2 or above, with a median time to restore of 34 minutes.

## 5. Systems to know

- The visit signalling service, written in Kotlin and backed by PostgreSQL 14.
- Media relays in 4 regions.
- The visit-events pipeline, which feeds clinician scheduling and billing.
- The patient notification worker, which sends text messages and email reminders.

## 6. Sign-off

| Step | Done by | Date |
|---|---|---|
| Shadow shift 1 | | |
| Shadow shift 2 | | |
| Paging drill completed | | |
| Manager sign-off | | |
