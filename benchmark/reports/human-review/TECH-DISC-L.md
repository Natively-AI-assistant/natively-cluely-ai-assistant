# TECH-DISC-L — technical_discussion, long (53.7 min, 7522 words)

**Source transcript:** `benchmark/transcripts/src/TECH-DISC-L.txt`  
**Reference fact sheet:** `benchmark/references/TECH-DISC-L.json`  
**Context:** An internal engineering meeting at Kestrel Health, a patient appointment-reminder platform, held two days after a notification pipeline outage on September 8th. The first part is a mini post-incident review; the rest debates keeping RabbitMQ versus migrating to Kafka (MSK) or SQS/SNS, plus outbox, idempotency, DLQ, autoscaling and alerting fixes, with the engineering director joining late to make the final call.

## What a good summary must include
- Outage on September 8th: 4h53m, backlog peaked at 1.8M, p99 2.1s to 47 min (F01, F09, F07, F10)
- Impact: 420 clinics, ~61,000 late reminders, 9,400 duplicate SMS, ~2,300 never sent (F14, F15, F24)
- Root cause refined: RETRY_MODE=inline no-backoff retry storm, not prefetch/OOM; triggered by Northgate 240k batch (F19, F21)
- DLQ was never enabled on notifications.v2 (F17)
- Decision: stay on RabbitMQ for peak (3.13.7 + quorum queues + consumer fixes), ratified by Grace (F44)
- Kafka/MSK rejected: cost over $6,000 ceiling, misses October 23rd freeze, does not fix root cause (F45, F28, F25)
- SQS/SNS 5-day prototype by Ravi (readout October 2nd), decision January 13th (F55, F46)
- Idempotency via Postgres unique index; outbox pattern in notify-gateway by Joaquin (F40, F57)
- Max replicas capped at 16; alerts: oldest message age >180s, 429 rate >2%, DLQ thresholds (F41, F43)
- Owner changes: Pam takes RabbitMQ upgrade (Oct 9th), Dana takes runbook (Sep 24th) (F50, F51)
- Sam: backoff + rate limiter by September 25th (F47)

## Most important disagreements (judge fact checks)

✔ present · ◐ partial · ✘ missing · ⚠ contradicted

| Fact | Imp. | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|
| F57: Joaquin (back from leave September 21st) implements the outbox pattern and relay in notify-gateway; Dana briefs him on his first day. | important | ✔ | ✔ | ⚠ | ⚠ | ✔ | ✔ |
| F55: Ravi runs the SQS/SNS prototype, timeboxed to 5 working days: notif-worker SMS path only, redrive policy, visibility timeout backoff, KMS CMK, and a check of largest payloads against 256 KB. | critical | ✔ | ✔ | ✔ | ⚠ | ✔ | ✔ |
| F50: Pam owns the RabbitMQ 3.11.9 to 3.13.7 upgrade and migration of notifications.v2 to quorum queues with a delivery limit of 5 (reassigned from Ravi). | critical | ✔ | ✔ | ✔ | ⚠ | ✔ | ✔ |
| F01: The notification pipeline outage under review happened on Tuesday, September 8th. | critical | ✘ | ✔ | ◐ | ◐ | ✔ | ✔ |

## Judge-flagged problems

**A** — overall 4/10, accuracy 4, retention 8, conciseness 2
- critical: Reported a tentative, later-rejected decision to migrate to Kafka as a final decision.
- critical: Reported a cancelled action item (Ravi's two-week Kafka spike plan) as an active action item.
- critical: Contradicted itself by listing the Kafka migration and spike plan as both approved and rejected/cancelled in different sections.
- critical: Hallucinated Joaquin's return date as October 21 instead of September 21.
- hallucination: Joaquin returns from leave on October 21 (the transcript states September 21st).
- superseded value: C04 → An eight- to twelve-week Kafka migration
- superseded value: C08 → The team tentatively selected migration to Kafka on Amazon MSK as the direction for the notification pipeline before the October 23 freeze.
- superseded value: C11 → Ravi will prepare a two-week plan for prototyping notif-worker against MSK with retry topics by Monday.
- suggestion reported as decision: Migrating the notification pipeline to Kafka on MSK (floated as the tentative direction at the midpoint, then rejected)
- suggestion reported as decision: A two-week Kafka consumer spike plan by Ravi (cancelled)

**B** — overall 3/10, accuracy 5, retention 9, conciseness 1
- critical: Reports a cancelled action item (Ravi's Kafka spike plan) as an active action item in the structured list.
- critical: Reports a rejected decision (migrating to Kafka on MSK) as an active decision in the structured list.
- critical: Massive duplication of sections (e.g., 'Action items' and 'Action items (structured)'), leading to extreme bloat and internal contradictions.
- critical: The first summary bullet point is cut off mid-sentence ('while surfa').
- superseded value: C08 → Tentatively agreed that the direction is to migrate the notification pipeline to Kafka on Amazon MSK before the October 23rd code freeze.
- superseded value: C11 → Ravi: Ravi to write a two-week spike plan for the Kafka consumer — a prototype of notif-worker reading from MSK with the retry topics. (deadline: Monday)
- suggestion reported as decision: Tentatively agreed that the direction is to migrate the notification pipeline to Kafka on Amazon MSK before the October 23rd code freeze.

**C** — overall 6/10, accuracy 8, retention 9, conciseness 2
- critical: Massive duplication of sections (e.g., 'Action items' and 'Action items (structured)') severely degrades the structure and conciseness of the notes.
- hallucination: Joaquin's return date is stated as October 21st instead of September 21st.

**D** — overall 4/10, accuracy 4, retention 8, conciseness 2
- critical: The cancelled Kafka spike plan is listed as an active action item for Ravi.
- critical: The RabbitMQ upgrade is assigned to Speaker 3, Ravi, and Pam simultaneously in the action items list.
- critical: The notify-gateway outbox task is assigned to Speaker 1 (Ravi) in one bullet, and correctly to Joaquin in another.
- critical: The SQS prototype is assigned to Speaker 2 (Pam) in one bullet, and correctly to Ravi in another.
- hallucination: Assigning the notify-gateway outbox task to Speaker 1.
- hallucination: Assigning the SQS prototype to Speaker 2.
- hallucination: Assigning the RabbitMQ upgrade to Speaker 3.
- superseded value: C07 → The proposed alert thresholds are oldest notification message age above 120 seconds for five minutes...
- superseded value: C09 → Ravi: Ravi will upgrade RabbitMQ from 3.11.9 to 3.13.7...
- superseded value: C11 → Ravi: Write a two-week spike plan for a Kafka consumer prototype in notif-worker reading from MSK with retry topics. (deadline: Monday)
- suggestion reported as decision: Ravi: Write a two-week spike plan for a Kafka consumer prototype in notif-worker reading from MSK with retry topics. (deadline: Monday)

**E** — overall 5/10, accuracy 6, retention 10, conciseness 2
- critical: Included the cancelled Kafka spike plan as an active action item.
- critical: Included the rejected Kafka migration as an active decision.
- critical: Included bizarre '[inferred]' non-action items in the action items list (e.g., 'Open enrollment starts').
- hallucination: Created fake action items labeled '[inferred]' such as 'Peak season code freeze', 'Joaquin returns from parental leave', and 'Open enrollment starts'.
- superseded value: C08 → Tentatively (explicitly framed as 'in pencil') the direction is to migrate the notification pipeline to Kafka on MSK before the October 23rd code freeze.
- superseded value: C11 → Ravi: Write up a two-week spike plan for the Kafka consumer — a prototype of notif-worker reading from MSK with the retry topics. (deadline: Monday)
- suggestion reported as decision: Migrating the notification pipeline to Kafka on MSK
- suggestion reported as decision: A two-week Kafka consumer spike plan by Ravi

**F** — overall 5/10, accuracy 7, retention 8, conciseness 2
- critical: Listed the tentative Kafka migration as a decision, contradicting the final decision to stay on RabbitMQ.
- critical: Massive duplication of sections (Action items, Decisions, Open questions, Risks are all repeated as 'structured' sections), severely degrading structure and conciseness.
- hallucination: Stated 'The existing 24-hour Redis idempotency TTL' when Redis was only a proposed idea, not an existing implementation.
- suggestion reported as decision: The team tentatively converged on migrating the notification pipeline to Kafka on Amazon MSK before the October 23 freeze.


---

# Summary A

_(run1)_

### Title: Notification Pipeline Outage Review

#### Overview
The team refined the outage diagnosis: a 240,000-message Northgate batch triggered a retry storm caused by inline retries without backoff, with high prefetch, a disabled DLQ, and autoscaling amplifying the impact. The team attributed the incident to the Northgate batch and retry/autoscaling design, tentatively favored migrating to Amazon MSK before the October 23 freeze, and then surfaced a materially higher estimated MSK cost of about $5,200 per month. The group revised MSK costs and migration timing upward, compared RabbitMQ, Kafka, and SQS, updated the incident impact to 420 clinics, and outlined RabbitMQ, outbox, and idempotency requirements. The team chose RabbitMQ with reliability fixes for peak season, rejected Kafka before peak, and scheduled an SQS/SNS prototype for a January 13 architecture decision. The team reassigned ownership, finalized alert and delivery thresholds, scheduled resilience work, and documented unresolved patient-safety, provider-limit, payload-size, migration, and deployment questions. Key decisions: The incident was classified as a retry storm caused primarily by RETRY_MODE=inline, which immediately requeued retryable provider failures without backoff.; The Northgate Medical Group batch of 240,000 reminders was identified as the trigger that pushed the system over Twilio's limit.; Prefetch 200 and the missing DLQ were categorized as amplifiers rather than the primary root cause..

#### Summary
- The meeting refined the outage diagnosis and reviewed messaging-platform options for the notification pipeline.
- The incident was classified as a retry storm primarily caused by RETRY_MODE=inline, with the Northgate batch as the trigger and high prefetch, a missing DLQ, and autoscaling as amplifiers.
- RabbitMQ with quorum queues, dead lettering, backoff, PostgreSQL idempotency, a replica cap, and age-based scaling was selected for peak season; Kafka will not be migrated before peak, while SQS/SNS will be evaluated through a timeboxed prototype for a January 13 decision.
- The updated impact included affected clinics, late notifications, and duplicates.

#### What changed
- The refined incident diagnosis shifted primary blame from prefetch and OOM kills to RETRY_MODE=inline, which removed retry backoff and caused an immediate-requeue storm.
- The team identified the 240,000-reminder Northgate batch as the traffic trigger at 14:00.
- The team discovered that notifications.v2 had never actually used its documented DLQ because the Terraform policy matched notifications-v2 rather than notifications.v2.
- The team established that notif-worker was deployed directly to all replicas rather than through the canary pipeline.
- The rollback was shown to be ineffective because it reverted the image but left the separately managed ConfigMap setting in place.
- Manually changing RETRY_MODE back to delayed at 16:52 was followed by a decline in the 429 rate within about four minutes.
- KEDA scaled notif-worker from 8 to 40 pods as the queue depth increased.
- The incident trigger was identified as Northgate Medical Group uploading 240,000 reminders at 14:00.
- The incident analysis identified inline retries without backoff as the root cause, with prefetch 200 and no DLQ as amplifiers.
- KEDA increased notif-worker from 8 to 40 pods as queue depth rose, multiplying concurrent pressure on Twilio.
- The duplicate-notification mechanism was attributed primarily to OOM kills occurring after Twilio accepted a message but before RabbitMQ acknowledgement.
- Approximately 2,300 incident-period notifications were found queued in Postgres but never published to RabbitMQ.
- The team established peak planning assumptions of approximately 9 million messages per day during November through mid-December, compared with 3 million currently.
- The migration window was established as roughly six weeks, ending at the October 23 code freeze.
- The initial MSK estimate of about $1,900 per month was challenged and replaced by a data-team-bill-based estimate of about $5,200 per month.
- The MSK estimate increased from $1,900 to approximately $5,200 per month after accounting for larger brokers, storage, provisioned throughput, replication, and cross-AZ transfer.
- The incident clinic count was corrected from 312 to 420 after matching delivery logs to clinic accounts.
- Three messaging options were explicitly laid out: fixing RabbitMQ, migrating to MSK Kafka, or using managed SQS with SNS fan-out.
- The estimated RabbitMQ remediation steady state is approximately $4,300 per month, below the $6,000 ceiling.
- The estimated SQS cost is approximately $1,100 per month, rising to about $2,500 in peak months, with dual-run totaling roughly $4,900.
- RabbitMQ remediation was estimated at about three weeks, inside the October 23rd freeze.
- The updated outbox design uses a relay that publishes at least once and therefore requires consumer-side idempotency.
- The idempotency approach changed from a proposed Redis key with a 24-hour TTL to a PostgreSQL delivery_attempts table with a unique notification ID and channel index.
- The autoscaling ceiling changed from the proposed 40 replicas to 16 notif-worker replicas, with six concurrent sends per pod.
- Scaling will use oldest message age and consumer utilization instead of queue depth.
- Alerting proposals shifted from a queue-depth page to oldest-message-age and Twilio-429 pages, with separate DLQ ticket and page thresholds.
- The worker prefetch target changed from 200 to 30 to reduce buffering-related latency.
- The incident impact was updated to 420 affected clinics, 61,000 late reminders, 9,400 duplicates, and about 2,300 unsent notifications.
- Customer-facing incident reporting will use 420 affected clinics rather than the earlier figure of 312 clinic callers.
- RabbitMQ upgrade and quorum-queue migration ownership moved from Ravi to Pam, while the runbook moved from Pam to Me.
- The notifications.v2 oldest-message-age alert threshold increased from 120 to 180 seconds for 5 minutes.
- The autoscaling target changed from queue depth to oldest message age, and the max replica target is 16 instead of 40.
- The Kafka spike plan was removed from the work list.
- The team retained the outbox-pattern assignment for Joaquin despite his return from leave on October 21.

#### Decisions
- The incident's causal chain was agreed as Northgate batch trigger, inline retry without backoff as root cause, and prefetch 200 plus missing DLQ as amplifiers.
- The autoscaler was added to the incident summary as a fourth amplifier.
- The team tentatively selected migration to Kafka on Amazon MSK as the direction for the notification pipeline before the October 23 freeze.
- The working MSK cost estimate is $5,200 per month rather than $1,900.
- The incident impact figure is 420 clinics, not 312.
- The team agreed that Kafka would not itself solve the retry storm or related consumer and rate-limit failures.
- The Kafka-before-peak decision was deferred until Grace hears the options.
- The outbox row will be written in the same transaction as the notification row.
- The outbox relay will be a standalone deployment with independent alerting.
- The team confirmed RabbitMQ with the reliability fixes as the peak-season platform.
- Kafka on MSK was rejected because of cost, timeline, root-cause mismatch, and limited operational experience.
- SQS/SNS will receive a timeboxed prototype, with the migration decision scheduled for January 13.
- The prefetch reduction to 30 must be shipped separately from other changes.
- Pam owns the RabbitMQ 3.13.7 upgrade and notifications.v2 quorum-queue migration due October 9.
- Me owns the notification backlog runbook due September 24.
- The age alert threshold is 180 seconds for 5 minutes, with the other alert thresholds unchanged.
- The Kafka spike plan will not be written.

#### Action items
- Record in the incident notes that notifications.v2 had no functioning DLQ and that failed messages were requeued indefinitely.
- Ravi will prepare a two-week plan for prototyping notif-worker against MSK with retry topics by Monday.
- Send the data team's actual MSK bill.
- Prototype SQS before making a commitment to the October 23rd target.
- Implement exponential retry backoff with five maximum attempts followed by dead-lettering.
- Remove inline retry mode from the system.
- Upgrade RabbitMQ and migrate notifications.v2 to quorum queues.
- Implement the standalone outbox relay with retry-on-failure and publish confirmation handling.
- Sam will implement the retry, dead-lettering, and Twilio rate-limiting changes by September 25, with the DLQ Terraform fix due September 14.
- Sam will deploy the prefetch reduction to 30 by September 15 as a separate deployment.
- Sam will implement PostgreSQL delivery-attempt idempotency by October 7.
- Ravi will complete the RabbitMQ 3.13.7 upgrade and quorum-queue migration by October 9.
- A timeboxed SQS/SNS prototype is required before the January 13 architecture review.
- Sam will implement idempotency with a uniquely indexed delivery_attempts table.
- Pam will implement the alerts and autoscaling changes, including the 16-replica maximum and age-based scaling.
- Pam will produce the 12-month cost estimate covering all three options and SQS dual-run costs.
- Ravi will prototype SQS/SNS for the SMS path and provide a readout after five working days.
- Me will write the ADR and send the notes and ADR draft in the channel.
- Speaker 4 will send the incident note to 420 clinics through customer success.

#### Open questions
- The team deferred examining why the post-fix p99 latency remained at 3.4 seconds and suspected prefetch as a contributor.
- The detailed effect of scaling notif-worker to 40 pods remained to be discussed.
- The team still needs to decide whether the approximately 2,300 never-published notifications should be resent.
- The appropriate MSK broker size and complete monthly cost, including data transfer and peak requirements, still need validation.
- The team still needs to validate whether a six-week migration is feasible with the available engineering and shared-SRE capacity.
- Whether any email payload exceeds SQS's 256 KB limit has not been checked.
- The appropriate idempotency store and retention period remain unresolved because retries can extend to 72 hours.
- The SQS migration timeline remains unknown pending a prototype.
- The final broker choice remains pending Grace's input.
- The team still needs to determine whether Twilio can raise the short-code throughput above 100 messages per second.
- The team has not decided whether to throttle large clinic uploads at the gateway.
- The SQS/SNS migration choice remains deferred to the January 13 architecture review.
- The disposition of the 2,300 unsent notifications remains unresolved.
- The scope and possible increase of Twilio's 100-per-second limit remain unknown.
- The team does not yet know whether insurance-card email payloads exceed 256 KB.
- The required migration method and maintenance-window needs for quorum queues remain unresolved.
- Throttling large per-clinic uploads has no owner or decision and requires product input.
- Separating email and SMS into distinct notif-worker deployments remains undecided.

#### Risks / blockers
- Immediate requeues created a retry storm against Twilio, driving the provider's 429 rate from a 0.2% baseline to 38%.
- The ineffective DLQ left poison messages circulating on the main queue indefinitely.
- The direct-to-all-replicas deployment model allowed the retry configuration to reach the full worker fleet without canary protection.
- The 200-message prefetch setting caused memory pressure and 212 OOM kills, returning large groups of unacked messages to the queue.
- The incident produced 47-minute p99 delivery latency, an 11% failure rate, 61,000 late reminders, and 9,400 duplicate SMS recipients.
- Resending stale appointment reminders could cause patients to attend appointments that no longer exist.
- The current dual-write sequence can leave database rows queued indefinitely when broker publisher confirms time out.
- The proposed Kafka migration is constrained by a six-week implementation-and-soak window before the October 23 freeze.
- The initial MSK broker size may be inadequate for peak volume and burst traffic because the data team had to move off m5.large within a month.
- The revised MSK estimate of about $5,200 per month would consume most of the $6,000 monthly messaging budget.
- The migration must preserve HIPAA controls for PHI, including BAA coverage, customer-managed KMS encryption, and retention of no more than 14 days.
- MSK's dual-run cost would exceed the $6,000 ceiling by about 50%.
- Kafka migration timing could extend into mid-November and overlap open enrollment.
- SQS standard queues do not provide ordering and require idempotency because delivery is at least once.
- Moving oversized payloads to S3 could create additional PHI storage locations.
- A 24-hour Redis key would expire before some legitimate 72-hour retries complete.
- Twilio throttling remains a capacity risk because the provider limit is 100 messages per second while autoscaling could otherwise create excess concurrency.
- The DLQ was not functioning because of a Terraform pattern typo, increasing the risk that failed notifications were not isolated.
- Peak-season readiness is constrained by the immovable October 23 freeze and November 1 open-enrollment start.
- The existing prefetch value of 200 may keep p99 latency elevated by allowing slow sends to block many buffered messages.
- A 240,000-message clinic upload can create a substantial but legitimate drain period, making queue-depth-based alerts unreliable.
- The 2,300 unsent notifications pose a patient-safety risk because stale reminders may be inappropriate.
- A 120-second age threshold would have caused nightly false-positive pages and alert fatigue during the 02:00 batch.
- Unknown Twilio throughput semantics could block or constrain peak-volume planning.
- Payloads over 256 KB could block the intended SQS path for insurance-card emails.
- The quorum-queue migration may require a maintenance window and its live-migration approach is not yet known.

#### Notes
- The outage began after notif-worker 2.14.0 was deployed at 14:02, with the first queue-depth alert at 14:19 and resolution at 19:12.
- The backlog peaked at 1.8 million messages at 16:40 and drained by 18:35 after the retry mode was corrected.
- The worker normally used delayed retries of 5 seconds, 30 seconds, and 2 minutes before inline mode was introduced.
- The team clarified that notif-worker consumes RabbitMQ messages while notify-gateway publishes them.
- After the fix, p99 latency improved to 3.4 seconds but remained above the 2.1-second pre-incident baseline.
- The notification pipeline currently handles approximately 3 million messages per day, or about 90 million per month.
- The team has four engineers, Joaquin is unavailable until September 21, and Pam is realistically available about half time because she supports three teams.
- The current RabbitMQ cluster costs about $3,800 per month, while finance set a $6,000 monthly ceiling for messaging.
- The proposed MSK design uses retry topics for 30 seconds, 2 minutes, and 10 minutes, followed by a DLQ topic.
- Ravi estimated the migration at one week for the producer, three weeks for the consumer rewrite, and two weeks for dual-running and soak.
- Kafka was proposed to provide replay through consumer offsets, disk-backed handling of large backlogs, and per-clinic ordering through partitioning by clinic ID.
- The proposed Kafka version is 3.6 on MSK, based partly on existing knowledge from the data team's analytics cluster.
- The revised sizing assumption is three m5.xlarge brokers with storage, provisioned throughput, and cross-availability-zone replication traffic.
- The original $1,900 estimate assumed 500 GB per broker and excluded data transfer.
- The Kafka design would need a scheduler for quiet-hours handling because Kafka has no per-message delay equivalent to RabbitMQ's delayed exchange and TTL.
- Kafka retry topics can block later messages in the same partition, requiring sufficient partitions and per-partition pause/resume behavior.
- SQS provides redrive policies, visibility-timeout-based backoff, BAA coverage, and support for customer-managed KMS keys.
- The reschedule-cancel race is not solved by changing the queue and would instead require an appointment version number.
- RabbitMQ quorum queues provide a delivery-limit setting that can automatically dead-letter repeatedly redelivered messages.
- The outbox relay can use SELECT FOR UPDATE SKIP LOCKED to support two concurrent relays.
- The relay is intended to run as its own deployment with its own alert rather than as a goroutine or Node worker thread.
- PostgreSQL 14 supports the planned SELECT FOR UPDATE SKIP LOCKED approach for running two relays.
- The relay also publishes at least once, so consumer-side idempotency is required.
- The proposed alert thresholds were oldest notification age over 120 seconds for five minutes, Twilio 429 rate over 2% for five minutes, any DLQ message for a ticket, and more than 500 DLQ messages for a page.
- The incident lasted 4 hours and 53 minutes, with backlog peaking at 1.8 million messages and p99 delivery latency reaching 47 minutes.
- The incident root cause was RETRY_MODE inline causing immediate requeue of every Twilio 429, while the prefetch change was characterized as an amplifier.
- The incident trigger was a 240,000-reminder batch from Northgate Medical Group at 14:00.
- Kafka was estimated at $5,200 per month steady state, $9,000 during dual-run, and 10 to 12 weeks to implement, while RabbitMQ upgrade was estimated at $4,300 per month and about three weeks.
- Pam previously handled most of the RabbitMQ 3.8-to-3.11 upgrade, supporting the reassignment of the next upgrade to her.
- The nightly next-day appointment batch runs at 02:00 and typically raises oldest-message age to about 150 seconds while draining.
- Grace has a budget review in the first week of October and will use the cost estimate for budget planning.
- The SQS/SNS prototype is restricted to the notif-worker SMS path and includes a customer-managed KMS key and redrive behavior.
- A staging game day involving broker failure during a large batch was suggested but explicitly not assigned.
- The outbox relay is intended to be a separate deployment with a separate alert from the transactional outbox table.

#### Action items (structured)
- Capture in the incident notes that the DLQ was not enabled on notifications.v2 because the Terraform policy pattern used a hyphen instead of a dot.
- Ravi: Write a two-week spike plan for a Kafka consumer prototype in which notif-worker reads from MSK and uses retry topics. (deadline: Monday)
- Open enrollment begins November 1st. [inferred]
- Production-pipeline changes must be completed and soaked before the October 23rd code freeze. [inferred]
- Joaquin is on parental leave until September 21st. [inferred]
- The RabbitMQ TLS auditor remediation is due by the end of the year. [inferred]
- Ravi committed to provide the spike plan by Monday. [inferred]
- Send the data team's MSK bill as supporting evidence for the cost estimate.
- Prototype SQS before committing to completing it before the October 23rd freeze. (deadline: Before committing to completion before October 23rd) [inferred]
- Implement consumer retry handling with exponential backoff of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes, capped at five attempts before dead-lettering. [inferred]
- Delete the inline retry mode rather than merely disabling it. [inferred]
- Upgrade RabbitMQ from 3.11.9 to 3.13.7 and migrate notifications.v2 from classic mirrored queues to quorum queues. [inferred]
- Build the outbox relay as a separate deployment that retries failed publishes and marks rows published after broker confirmation. [inferred]
- Determine an idempotency approach that covers retries occurring up to 72 hours after the initial attempt. [inferred]
- October 23rd freeze [inferred]
- Joaquin returns on the 21st [inferred]
- Sam: Sam will remove inline retry mode, implement exponential backoff of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes with a maximum of five attempts before dead lettering, and add a Twilio token-bucket limiter at 100 sends per sec (deadline: Friday, September 25th)
- Sam: Sam will fix the Terraform dead-letter queue policy pattern so notifications.v2 actually dead-letters. (deadline: Monday, September 14th)
- Sam: Sam will reduce prefetch to 30 in a separate deployment. (deadline: Tuesday, September 15th)
- Sam: Implement idempotency using a delivery_attempts table with a unique index on notification ID and channel. (deadline: Wednesday, October 7th)
- Ravi: Ravi will upgrade RabbitMQ from 3.11.9 to 3.13.7 and migrate notifications.v2 to quorum queues with a delivery limit of 5. (deadline: Friday, October 9th)
- Prototype SQS/SNS on a timeboxed basis before the January 13 architecture review.
- Sam: Fix DLQ Terraform policy pattern (deadline: Monday, September 14th) [inferred]
- Sam: Deploy prefetch reduction to 30 separately (deadline: Tuesday, September 15th) [inferred]
- Sam: Implement retry backoff and Twilio limiter (deadline: Friday, September 25th) [inferred]
- Sam: Implement PostgreSQL idempotency table and unique index (deadline: Wednesday, October 7th) [inferred]
- Ravi: Upgrade RabbitMQ and migrate notifications.v2 to quorum queues (deadline: Friday, October 9th) [inferred]
- Make SQS migration decision (deadline: January 13th architecture review) [inferred]
- Pam: Complete the RabbitMQ 3.13.7 upgrade and notifications.v2 quorum-queue migration with a delivery limit of 5. (deadline: Friday, October 9)
- Me: Write the notification backlog runbook covering RETRY_MODE configuration drift, DLQ checks, manual replica caps, Northgate-style batch pauses, and rollback including the ConfigMap chart. (deadline: Thursday, September 24)
- Pam: Configure alerts for notifications.v2 age over 180 seconds for 5 minutes, Twilio 429 rate over 2% for 5 minutes, any DLQ message as a ticket, and DLQ size over 500 as a page. (deadline: Friday, September 18)
- Pam: Reduce max replicas from 40 to 16 and change autoscaling to use oldest message age instead of queue depth. (deadline: Max-replica change today; age-based scaling by September 18)
- Pam: Prepare a 12-month cost estimate for all three options, including peak months and SQS dual-run costs, for Grace's budget planning. (deadline: Wednesday, September 30)
- Ravi: Run the five-working-day SQS/SNS prototype for the notif-worker SMS path, including redrive policy, visibility-timeout backoff, a customer-managed KMS key, and checks against the 256 KB payload limit. (deadline: Start Monday, September 28; readout Friday, October 2)
- Ravi: Move notif-worker onto the Argo Rollouts canary pipeline. (deadline: Friday, October 16)
- Joaquin: Implement the notify-gateway outbox table in the same Postgres transaction and deploy the relay separately with its own alert. (deadline: Friday, October 16)
- Me: Write the architecture decision record for the agreed resilience and notification-pipeline changes. (deadline: Tuesday, September 15)
- Speaker 4: Send the incident note to the 420 clinics through customer success. (deadline: Monday, September 14)
- Me: Send the meeting notes and ADR draft in the channel.
- Speaker 4: Send the incident note to 420 clinics. (deadline: Monday, September 14) [inferred]

#### Decisions (structured)
- The incident was classified as a retry storm caused primarily by RETRY_MODE=inline, which immediately requeued retryable provider failures without backoff.
- The Northgate Medical Group batch of 240,000 reminders was identified as the trigger that pushed the system over Twilio's limit.
- Prefetch 200 and the missing DLQ were categorized as amplifiers rather than the primary root cause.
- The team's incident summary also identified the autoscaler as a fourth amplifier.
- The tentative direction is to migrate the notification pipeline to Kafka on Amazon MSK before the October 23 production code freeze.
- Use approximately $5,200 per month as the MSK steady-state estimate, based on the data team's actual bill and including transfer-related costs.
- Treat the retry storm as a consumer design problem rather than something Kafka would automatically fix.
- The updated incident impact count is 420 affected clinics, while patient impact remains approximately 61,000 late notifications and 9,400 duplicates.
- The group will keep Kafka-before-peak as an unresolved option rather than deciding on it before Grace joins.
- The notification gateway should use an outbox pattern with the notification row and outbox row written in the same Postgres transaction.
- The outbox relay should be a separate deployment with its own alerting rather than an in-process goroutine or worker thread.
- Use PostgreSQL-based idempotency with a unique index on notification ID and channel instead of Redis.
- Cap notif-worker at 16 replicas, yielding 96 concurrent sends per second at six sends per pod, below Twilio's 100 messages-per-second limit.
- Scale notifications using oldest message age and consumer utilization rather than queue depth.
- Drop notif-worker prefetch from 200 to 30 in a separate deployment.
- Stay on RabbitMQ for peak season and implement the broker-independent consumer fixes, including quorum queues, dead lettering, and backoff.
- Do not migrate to Kafka before peak, and do not place Kafka on the post-peak roadmap unless circumstances change.
- Evaluate SQS/SNS through a timeboxed prototype and make the migration decision at the January 13 architecture review.
- Pam will own the RabbitMQ upgrade from 3.11.9 to 3.13.7 and the notifications.v2 quorum-queue migration, replacing Ravi, with the same Friday, October 9 deadline. (owner: Pam)
- The notification backlog runbook moved from Pam to Me and is due Thursday, September 24. (owner: Me)
- The oldest-message-age paging threshold for notifications.v2 was changed from 120 seconds to 180 seconds for 5 minutes; the other alert conditions remain unchanged. (owner: Pam)
- The Kafka spike plan was canceled and should not be written. (owner: Ravi)
- Joaquin will keep ownership of the self-contained notify-gateway outbox-pattern work after returning on October 21. (owner: Joaquin)

#### Open questions (structured)
- The team still needs to examine the autoscaler's detailed impact after KEDA scaled notif-worker from 8 to 40 pods. [open]
- The reason the post-fix p99 latency remained at 3.4 seconds instead of the 2.1-second baseline was deferred for later discussion and suspected to involve prefetch. [open]
- Whether to resend the approximately 2,300 notifications that were written to Postgres but never published to RabbitMQ remains unresolved. [open]
- The final MSK cost and sizing remain unresolved because the initial estimate excluded data transfer and used brokers that may be too small for peak volume. [open]
- Whether the proposed six-week migration can be completed and soaked before the October 23 freeze remains uncertain. [open]
- Whether any insurance-card reminder payloads exceed SQS's 256 KB message-size limit remains unknown. [open]
- Whether oversized SQS payloads should be stored in S3 with a pointer in the message remains unresolved. [open]
- What idempotency mechanism should replace the proposed Redis key with a 24-hour TTL remains unresolved. [open]
- Whether Kafka should be selected before peak has not been decided. [open]
- The completion timeline for an SQS migration is not yet known. [open]
- Whether Twilio's 100 messages-per-second short-code throughput is a hard limit or can be increased for peak season remains unresolved. [open]
- Whether notify-gateway should throttle large uploads per clinic remains undecided. [open]
- The SQS/SNS migration decision remains open until the January 13 architecture review. [open]
- Should the 2,300 notifications that were never sent be resent, communicated through another channel, or left unresolved? [open]
- Is Twilio's 100-per-second limit specific to the short code or the account, and can it be raised for peak demand? [open]
- Do any insurance-card email payloads exceed 256 KB? [open]
- Does the quorum-queue migration require a maintenance window, or can it be performed live with a shovel? [open]
- Should email and SMS use separate notif-worker deployments? [open]

#### Risks (structured)
- [high] Immediate requeue without backoff can create a feedback loop in which provider 429s generate more immediate retries and additional 429s.
- [high] The DLQ configuration was ineffective, so repeatedly failing messages were requeued indefinitely instead of being isolated for replay.
- [high] The notif-worker deployment went directly to all replicas because it was not included in the canary pipeline.
- [high] The prefetch increase to 200 caused pods to be OOM-killed, with 212 OOM kills recorded between 14:20 and 16:50.
- [high] The Helm rollback did not restore delayed retry behavior because the relevant ConfigMap was managed in a separate chart.
- [high] The outage caused a peak backlog of 1.8 million messages, 38% Twilio 429 responses, an 11% notification failure rate, and significant duplicate and late reminders.
- [high] The Northgate Medical Group batch sent 240,000 reminders at once and triggered the incident when combined with inline retries.
- [high] Inline retries without backoff, prefetch of 200, and no dead-letter queue amplified the incident.
- [high] KEDA scaled notif-worker from 8 to 40 pods, creating approximately 240 attempted sends per second against Twilio's 100 messages-per-second limit.
- [high] OOM kills after Twilio accepted messages caused RabbitMQ messages to be requeued and resent because the send side has no idempotency check, producing duplicates.
- [high] Publisher-confirm timeouts caused approximately 2,300 Postgres rows to remain queued even though their messages were never published or sent.
- [high] The October 23 code freeze leaves about six weeks to implement and soak production-pipeline changes before peak season.
- [high] MSK sizing and cost may exceed the initial estimate because peak traffic, replication, provisioned throughput, storage, and cross-AZ transfer must be included.
- [medium] RabbitMQ inter-node traffic is not using TLS, and the auditor finding remains open with a remediation due date at the end of the year.
- [high] Any replacement messaging system must satisfy HIPAA requirements, including AWS BAA coverage, customer-managed KMS encryption at rest, and a maximum 14-day PHI retention period.
- [high] MSK would cost about $9,000 per month during dual-run, exceeding the $6,000 ceiling by roughly 50%.
- [high] An eight- to twelve-week Kafka migration would miss the October 23rd freeze and could extend into mid-November during open enrollment.
- [high] Kafka would not inherently prevent retry storms, missing DLQs, or autoscaling into Twilio's rate limit.
- [medium] SQS standard queues are at-least-once and unordered, requiring idempotency and potentially creating per-clinic ordering concerns.
- [high] Using S3 for oversized SQS payloads could increase the number of locations containing PHI.
- [high] A 24-hour Redis idempotency TTL would not cover legitimate retries that can occur up to 72 hours later.
- [high] Twilio's 100 messages-per-second limit can be exceeded if replica counts rise without an in-worker rate limiter.
- [medium] Queue depth can trigger misleading scaling or alerts because legitimate batches can create very large backlogs, such as 240,000 messages in four minutes.
- [high] The existing dead-letter queue was effectively disabled by a Terraform policy-pattern typo, reportedly since the queue was created in March 2024.
- [high] The October 23 freeze and November 1 open enrollment leave little time for peak-season reliability work.
- [high] The $6,000 monthly messaging ceiling prevents approval of Kafka's estimated $9,000 dual-run cost and makes its $5,200 steady-state cost constrained.
- [high] Kafka would not address the actual retry-storm root cause and the team lacks Kafka operations experience.
- [medium] High prefetch of 200 allows slow sends to hold many messages in a pod buffer and contributes to elevated p99 latency.
- [high] The 2,300 unsent notifications create a patient-safety concern because stale reminders may be inappropriate.
- [medium] Paging at 120 seconds would have caused nightly alert fatigue because the 02:00 next-day appointment batch routinely reaches about 150 seconds.
- [medium] The Twilio throughput limit may constrain peak demand, but its scope and raiseability are unknown.
- [medium] Unknown insurance-card payload sizes could exceed the 256 KB limit relevant to the SQS prototype.
- [medium] The quorum-queue migration may require a maintenance window, with the prior RabbitMQ migration using a 20-minute window at 03:00.
- [medium] No owner or decision exists for throttling large per-clinic uploads, and product input is required.

#### Follow-up draft
Subject: Follow-up: Notification pipeline outage and peak-season plan

Hi team,

Thanks for the thorough discussion on the notification pipeline outage and messaging-platform options. We aligned that the Northgate 240,000-reminder batch triggered a retry storm driven primarily by RETRY_MODE=inline, with high prefetch, the missing DLQ, and autoscaling as amplifiers; RabbitMQ with the agreed reliability fixes will remain in place for peak season, while SQS/SNS will be prototyped for a January 13 decision. The incident impact is recorded as 420 affected clinics, 61,000 late reminders, 9,400 duplicates, and approximately 2,300 notifications that were never published. The most important open question is whether those 2,300 unsent notifications should be resent, communicated through another channel, or left unresolved.

Best,

---

# Summary B

_(run1)_

### Title: notif-worker 2.14.0 Retry Storm Postmortem

#### Overview
A mini post-incident review of the Tuesday September 8 notification outage walked the timeline and refined the root cause from the RabbitMQ prefetch/OOM theory to the RETRY_MODE=inline ConfigMap shipped with notif-worker 2.14.0, while surfacing that the DLQ was never enabled and notif-worker has no canary deploy. The team root-caused Tuesday's notification outage (Northgate bulk batch trigger, inline retry with no backoff, prefetch 200/no DLQ/KEDA autoscaler amplifiers, 9,400 duplicates from OOM kills with no idempotency, and ~2,300 never-published notifications from a dual-write confirm timeout), then tentatively converged on migrating the notification pipeline to Kafka on Amazon MSK before the October 23rd code freeze, with Pam disputing Ravi's $1,900 MSK estimate and putting it at roughly $5,200/month The team revised the MSK cost to ~$5,200/month over Ravi's $1,900, estimated a Kafka migration at 10-12 weeks (past the Oct 23 freeze), corrected the incident to 420 clinics, laid out three broker options (RabbitMQ fix ~$4,300, MSK $5,200, SQS ~$1,100), and started designing the outbox pattern and idempotency approach. Grace declined the Kafka/MSK migration on cost ($5,200 steady state, $9,000 dual-run vs a $6,000 ceiling) and timeline grounds, confirming RabbitMQ 3.13 as the peak-season path with SQS evaluated via a timeboxed prototype and a decision at the January 13th architecture review; the team also settled the idempotency design on a Postgres delivery_attempts unique index, a 16-pod notif-worker cap, and age-based alerting. The team reassigned the RabbitMQ 3.13.7 upgrade and quorum queue migration from Ravi to Pam, finalized owners and deadlines for the runbook, alerts, autoscaling, cost estimate, SQS prototype, canary pipeline, outbox pattern, ADR and clinic incident note, and enumerated six unresolved open questions before closing. Key decisions: Refined root cause agreed: the RETRY_MODE=inline config shipped with notif-worker 2.14.0 turned every retryable provider error into an immediate requeue with no backoff, creating the Twilio retry storm.; Agreed that the Northgate Medical Group bulk batch was the trigger, while prefetch 200 and the missing DLQ were amplifiers/symptoms rather than the cause.; Agreed the session would spend roughly 15 minutes on a mini post-incident review of the Tuesday, September 8 notification outage and the rest on architectural remediation..

#### Summary
- A mini post-incident review of the Tuesday September 8 notification outage walked the timeline and refined the root cause from the RabbitMQ prefetch/OOM theory to the RETRY_MODE=inline ConfigMap shipped with notif-worker 2.14.0, while surfa
- Refined root cause agreed: the RETRY_MODE=inline config shipped with notif-worker 2.14.0 turned every retryable provider error into an immediate requeue with no backoff, creating the Twilio retry storm.
- Agreed that the Northgate Medical Group bulk batch was the trigger, while prefetch 200 and the missing DLQ were amplifiers/symptoms rather than the cause.
- The dead letter queue was never enabled on notifications.v2 because the Terraform policy pattern matched 'notifications-v2' with a hyphen while the queue is 'notifications.v2' with a dot, so failed messages were requeued forever.

#### What changed
- The backlog peaked at 1.8 million messages on the main queue at 16:40, drained by 18:35, and the incident was called resolved at 19:12.
- The change that stopped the bleeding at 16:52 was Sam flipping RETRY_MODE back to delayed by hand, after which the 429 rate started falling within about four minutes.
- p99 end-to-end delivery latency improved from 47 minutes at the worst point to 3.4 seconds after the fix, still above the 2.1-second baseline.
- The root-cause understanding shifted from the channel's prefetch/OOM theory to the RETRY_MODE=inline config, with OOM kills characterized as an amplifier and symptom rather than the cause.
- Sam discovered that the DLQ on notifications.v2 was never actually enabled and has had zero messages since March 2024, contradicting the assumption Ravi and Pam held.
- Pam corrected her own Tuesday claim that 2.14.0 had gone through canary, confirming notif-worker is not on the canary pipeline at all.
- The 14:45 rollback to 2.13.2 did nothing because 2.13.2 also read RETRY_MODE and ran with the inline value, since the ConfigMap was managed in a separate chart from the image.
- KEDA scaled notif-worker from 8 pods to the 40-pod maximum by about 15:05 as queue depth climbed.
- The team identified the incident trigger as Northgate Medical Group's 14:00 bulk upload of 240,000 flu clinic reminders through notify-gateway.
- Root cause was settled as inline retry with no backoff, with prefetch 200, no DLQ, and the KEDA autoscaler named as amplifiers.
- The autoscaler produced 240 attempted sends per second (40 pods × 6 concurrent sends) against Twilio's 100 messages/second short code limit.
- The main source of the 9,400 duplicates was established as OOM kills occurring after Twilio accepted a message but before the RabbitMQ ack.
- A query run that morning found about 2,300 notifications in Postgres with status queued, created during the incident, that were never published and never sent.
- The framing shifted from fixing the consumer to considering a Kafka migration, driven by the replay argument, the auditor finding, and cost.
- Pam revised the MSK cost picture downward in attractiveness, replacing Ravi's $1,900/month estimate with about $5,200/month based on the data team's actual bill.
- The MSK cost estimate was revised up from Ravi's $1,900 to about $5,200/month using the data team's actual bill as a model
- Ravi acknowledged his original estimate omitted cross-AZ data transfer and was underestimating transfer
- The incident clinic count was corrected from 312 to 420 after customer success matched delivery logs to clinic accounts
- Patient impact numbers were unchanged: around 61,000 late and 9,400 duplicates
- The Kafka migration estimate moved to 10-12 weeks, which Ravi noted still misses the freeze even if it were eight weeks
- Option one (fix RabbitMQ) cost rose from $3,800 to about $4,300/month because quorum queues need bigger m5.xlarge nodes
- Three options were consolidated with costs: RabbitMQ fix ~$4,300 steady, MSK $5,200 steady / $9,000 dual-run, SQS ~$1,100 (peaks ~$2,500)
- Ravi conceded the retry storm is a consumer design problem rather than a broker problem, shifting the framing away from Kafka as the fix
- Kafka on MSK was rejected outright, reversing the direction the team appeared to be converging on halfway through the meeting.
- The peak-season path was locked to RabbitMQ option one: 3.13 upgrade, quorum queues, consumer fixes, DLQ, and backoff.
- SQS/SNS moved from an option in the comparison to the post-peak evaluation path with a timeboxed prototype.
- The idempotency approach shifted from a Redis SETNX key with 24-hour TTL to a Postgres unique index on notification ID plus channel.
- Autoscaler max replicas were reduced from 40 to 16 after Speaker 2 corrected the arithmetic (20 pods × 6 = 120/second, over Twilio's 100/second limit).
- The scaling signal was changed away from queue depth to oldest message age and consumer utilization, with depth described as misleading.
- The incident's affected-clinic count was corrected from 312 to 420 using delivery logs, which Grace will use in the customer note.
- The incident root cause was reclassified: the prefetch change in notif-worker 2.14.0 was only an amplifier, while the actual cause was an inline RETRY_MODE config change in the same deploy that requeued every Twilio 429 with no backoff.
- The DLQ was revealed to have been off since the queue was created in March 2024 due to a hyphen-vs-dot Terraform policy pattern typo.
- The alert redesign was justified by a counterfactual: the new 429-rate alert would have fired around 14:08 rather than 14:19, nine minutes earlier and more specific.
- The RabbitMQ 3.13.7 upgrade and quorum queue migration moved from Ravi to Pam so Ravi can stay focused on the SQS prototype.
- The notification backlog runbook was reassigned from Pam to the facilitator after Pam said something had to come off her plate.
- Oldest message age page threshold was raised from 120 to 180 seconds for 5 minutes while the rest of the alert rules stay the same.
- Autoscaling scope changed to max replicas 40 down to 16 and scaling on oldest message age instead of depth.
- The Kafka spike plan Ravi intended to write Monday was killed outright.
- The SQS/SNS prototype was scoped to a 5-day timebox on notif-worker's SMS path only, starting September 28th with a readout October 2nd.
- The outbox pattern in notify-gateway was assigned to Joaquin on his return on the 21st, due October 16th, with the facilitator to brief him on his first day.
- A 12-month, three-option cost estimate including peak months and SQS dual-run was added for Grace's budget planning, due September 30th.
- An architecture decision record covering all these decisions was added, due Tuesday September 15th.
- Six open questions were explicitly listed into the notes so nothing unresolved was lost.

#### Decisions
- The team settled on a refined root cause: RETRY_MODE=inline shipped with 2.14.0 turned every retryable provider error into an immediate requeue with no backoff, driving the Twilio 429 rate to 38%.
- Agreed causal structure: Northgate batch as trigger, inline retry with no backoff as root cause, prefetch 200 and no DLQ as amplifiers.
- Agreed to allocate about fifteen minutes to the mini post-incident review and devote the remainder to architectural remediation.
- The team tentatively agreed the direction is to migrate the notification pipeline to Kafka on MSK before the October 23rd freeze, explicitly framed as pencil not pen.
- The question of resending the ~2,300 never-published notifications was set aside as an open item rather than decided.
- The team decided not to choose a broker yet and to wait until Grace joins to hear the options
- The inline retry mode will be deleted entirely, not just defaulted off
- The outbox relay is to be its own separate deployment with its own alert, not a goroutine or Node worker inside notify-gateway
- The outbox pattern will be used for notify-gateway so a message cannot be lost between Postgres and the broker
- Ravi accepted the $5,200 MSK figure rather than his original $1,900
- Idempotency is decided as a Postgres unique index on notification ID plus channel, explicitly not Redis.
- The relay becomes its own deployment with its own alert rather than a goroutine in notify-gateway.
- notif-worker max replicas are capped at 16 to stay under Twilio's 100/second short code limit.
- A per-provider token bucket rate limiter goes inside the worker as a guardrail against future replica increases.
- Autoscaling moves to oldest message age plus consumer utilization, dropping queue depth as a signal.
- New paging thresholds: oldest message age over 120 seconds for 5 minutes on notifications.v2, and Twilio 429 rate over 2% for 5 minutes.
- DLQ alerting is split: any messages create a ticket, and over 500 messages creates a page.
- Kafka on MSK is not on the roadmap for before or after peak unless something changes.
- The SQS migration decision is scheduled for the January 13th architecture review.
- Prefetch drops to 30 and ships in a deploy separate from anything else.
- Pam replaces Ravi on the RabbitMQ upgrade and quorum queue migration with the same Friday October 9th deadline.
- Runbook ownership moved from Pam to the facilitator.
- The age alert page threshold was set at 180 seconds for 5 minutes rather than 120 seconds.
- The Kafka spike plan was cancelled.
- Max replicas will drop from 40 to 16 and autoscaling will key on oldest message age instead of depth.
- The outbox pattern stays assigned to Joaquin after Grace's fairness concern was raised and the facilitator noted Joaquin asked for self-contained work.
- A pipeline game day was deferred and explicitly not assigned today.

#### Action items
- Sam flagged and parked for later the investigation into whether the prefetch setting explains the remaining 3.4-second p99.
- Pam to cover the autoscaler as a fourth amplifier of the incident.
- Ravi committed to delivering a two-week spike plan for the Kafka consumer prototype, including notif-worker reading from MSK with retry topics, by Monday.
- Pam will send the data team's MSK bill to Ravi to justify the $5,200 estimate
- Someone needs to check whether insurance card reminder payloads exceed SQS's 256 KB limit
- Pam needs to build a prototype before committing to an SQS migration timeline ahead of October 23rd
- Sam will implement the consumer-side fixes needed regardless of broker (proper exponential backoff, max five attempts, then dead letter)
- Sam to finalize an idempotency approach for the consumer, since the Redis SETNX idea has open issues
- Sam: delete inline retry mode and add exponential backoff on the delayed exchange at 1s, 5s, 30s, 2 min, 10 min, max five attempts then dead letter, plus the Twilio token bucket limiter at 100/second — by Friday, September 25th.
- Sam: fix the DLQ policy pattern in Terraform so notifications.v2 dead-letters, flagged urgent — by Monday, September 14th, though Sam offered to do it today.
- Sam: change notif-worker prefetch to 30 in a separate deploy — by Tuesday, September 15th.
- Sam: build the delivery_attempts table with a unique index on notification ID and channel — by Wednesday, October 7th.
- Pam to run the RabbitMQ 3.11.9 to 3.13.7 upgrade and migrate notifications.v2 to quorum queues with a delivery limit of 5, by Friday October 9th.
- Grace: use 420 rather than 312 in the customer note.
- Dana walked the action list item by item and invited people to correct any wrong dates.
- No owner was assigned for investigating whether Twilio will raise short code throughput for peak season — Dana said only "let's see if it lands with someone."
- Gateway per-clinic throttling is deliberately left without an owner today, placed on the maybe list.
- Sam's workload was acknowledged as heavy, with Sam noting the backoff and the limiter are essentially the same pull request.
- Sam to implement idempotency via a delivery_attempts table with a unique index on notification ID and channel, backoff and limiter in the same PR, by Wednesday October 7th.
- Facilitator to write the notification backlog runbook (RETRY_MODE drift, DLQ checks, manual replica cap, pausing Northgate batches) by Thursday September 24th, with rollback explicitly including the ConfigMap chart.
- Pam to build the alert set (age 180s/5min page, Twilio 429 over 2% page, DLQ any message ticket, DLQ over 500 page) by Friday September 18th.
- Pam to do the max replica reduction to 16 today and the age-based scaling by the 18th.
- Pam to deliver the 12-month cost estimate for all three options including peak months and SQS dual-run by Wednesday September 30th.
- Ravi to run the 5-working-day SQS/SNS prototype on the SMS path with redrive policy, visibility timeout backoff, KMS CMK and 256KB payload checks, starting September 28th and reading out October 2nd.
- Ravi to put notif-worker on the Argo Rollouts canary pipeline like notify-gateway by Friday October 16th.
- Joaquin to deliver the notify-gateway outbox pattern (outbox table in the same Postgres transaction, relay as its own deployment with its own alert) due Friday October 16th, briefed by the facilitator on his first day.
- Facilitator to write the architecture decision record by Tuesday September 15th.
- Grace to send the incident note to the 420 clinics through customer success by Monday September 14th.
- Facilitator to send the notes and the ADR draft in the channel after the meeting.

#### Open questions
- Why p99 is still at 3.4 seconds instead of the 2.1-second baseline remains unresolved and was deferred.
- What to do architecturally about the notification pipeline was deliberately deferred to the second part of the meeting.
- Whether to resend the ~2,300 notifications left sitting in Postgres with status queued remains unresolved.
- Pam questioned Ravi's $1,900 MSK estimate on both storage assumptions and whether data transfer was included.
- How long the notif-worker rewrite would take is still open, with Ravi estimating six weeks and calling the October 23rd window tight but doable if work starts Monday.
- It remains open which broker option to pick, deferred until Grace can weigh in
- Whether any email template payload exceeds the 256 KB SQS message size limit is unresolved
- The SQS migration timeline is unknown and would require a prototype
- How to fix the reschedule-cancel race is still open, with a version number on the appointment suggested
- The idempotency design is unresolved because a 24-hour TTL is too short given up to 72-hour retries
- Whether Twilio's 100 messages/second short code throughput is a hard limit or simply what was requested three years ago, raising the possibility of a peak-season increase.
- Whether notify-gateway should impose a per-clinic rate on large uploads, given Northgate dropped 240,000 messages in four minutes — no owner assigned.
- What the SQS/SNS migration timeline actually is — unresolved because there is no solid timeline without a prototype.
- Whether Tuesday or the April SSO incident counts as the worst incident of the year — Grace asked, and the answer was that April was worse for employees while Tuesday was worse for patients.
- The fate of the 2,300 never-sent notifications (resend, contact patients another way, or leave) is unresolved, and Pam worries about stale reminders.
- Grace needs to think about the never-sent notifications and will not guess on a patient safety question.
- Whether Twilio's 100-per-second limit is per short code or per account, and whether it can be raised for peak, remains unanswered and unassigned.
- Whether any insurance card email payloads exceed 256 kilobytes is unknown and will be checked by the prototype.
- Whether the quorum queue migration needs a maintenance window or can be done live remains open; Pam has to read up on how quorum queues differ from the 3.11 upgrade.
- Pam's idea of throttling large per-clinic uploads at notify-gateway has no owner, no decision, and would need product to weigh in.
- Whether to split email and SMS into separate notif-worker deployments is undecided even though the team considers it ideal.

#### Risks / blockers
- The DLQ pattern typo ('notifications-v2' with a hyphen vs the 'notifications.v2' queue) meant no dead letter exchange policy ever applied, so failed messages requeued forever.
- The service that sends patient messages has less deployment safety than the one that accepts them because notif-worker is not on the canary pipeline.
- Because the RETRY_MODE ConfigMap lives in a separate Helm chart, a rollback of the image alone cannot revert a configuration change.
- KEDA's queue-depth scaling to 40 replicas acted as an additional amplifier during the incident.
- Duplicate SMS messages drove the angry customer calls, with one patient replying STOP to all four.
- Pam's ~$5,200/month MSK figure sits close to the $6,000/month finance ceiling, leaving little room for error in the messaging budget.
- The October 23rd code freeze gives only about six weeks for any production pipeline change to be done and soaked.
- m5.large brokers were flagged as undersized, since the data team had to upgrade off them within a month and now run m5.xlarge.
- The auditor's March finding that RabbitMQ inter-node traffic lacks TLS is still open with an end-of-year remediation due date.
- Pam raised that retention policy on PHI-filled Kafka topics is a compliance concern the conference talk glossed over, despite retention.ms being configurable to 14 days.
- HIPAA constraints require that anything used be covered by the AWS BAA and encrypted at rest with customer managed KMS keys.
- The MSK dual-run period costs $9,000/month, 50% above the $6,000 ceiling
- Even steady-state MSK plus needed Postgres capacity sits right at the $6,000 ceiling
- The 10-12 week Kafka plan slips past the October 23rd freeze into mid-November, during open enrollment
- Kafka doesn't inherently prevent a retry storm, an unwired DLQ, or autoscaling into Twilio's rate limit
- SQS's 256 KB limit is a real concern because the insurance card reminder email has an inline image
- The S3-pointer workaround for large payloads spreads PHI into more locations
- Adding Redis for idempotency introduces another BAA review and KMS configuration in the notification path
- Classic mirrored queues are removed in RabbitMQ 4, so the quorum queue migration has to happen eventually regardless
- The $6,000/month messaging ceiling cannot be raised before February, which blocks any $9,000 dual-run month.
- The October 23rd freeze plus a November 1st open enrollment start leaves no room for a 10-12 week migration.
- Sales has already promised two large hospital groups that reminders will be "bulletproof," raising the stakes on peak reliability.
- The dead letter queue was never enabled since March 2024 because of a hyphen-vs-dot typo in the Terraform policy pattern, meaning messages were silently lost rather than dead-lettered.
- The autoscaler's 40-pod ceiling exceeded Twilio's 100/second capacity and acted as an incident amplifier.
- notif-worker was not on the canary pipeline, another amplifier that let the bad config reach production broadly.
- The team of four with a half-time SRE lacks Kafka operations experience, a stated reason against MSK.
- Redis/ElastiCache in the notification path would trigger another BAA review and KMS configuration.
- A 24-hour idempotency TTL would be too short, since backoff plus quiet hours can stretch retries to 72 hours.
- The existing depth-50,000 page fires on routine Monday clinic uploads, training the team to ignore it.
- Kafka would not have fixed the retry storm, since that was a consumer design problem rather than a broker problem.
- Product stakeholders are expected to object to throttling large clinic uploads since clinics value immediate completion.
- A 120-second age threshold would page every night due to the 02:00 batch reaching about 150 seconds, driving alert fatigue exactly like the Monday morning problem.
- Grace refuses to guess on the patient safety question of the 2,300 never-sent notifications, so it stays open.
- Twilio's 100-per-second limit is an unresolved constraint that has stood since before the current team joined.
- The previous RabbitMQ 3.11 upgrade required a 20-minute 03:00 maintenance window, and it is unknown whether the quorum queue migration will need similar downtime.
- Payload size risk: it is unknown whether insurance card email payloads breach the 256 kilobyte SQS limit, dependent on the prototype.
- Fairness concern raised that the outbox task lands on Joaquin on his first day back from leave; kept after the facilitator confirmed Joaquin asked for self-contained work.
- The cost estimate must land by September 30th to feed Grace's budget review in the first week of October.

#### Notes
- Definitions were clarified for the record: notif-worker is the RabbitMQ consumer, while notify-gateway is the HTTP service clinics hit that publishes onto the queue.
- The two services were named in 2021 by someone who has left the company, which the team blamed for the persistent naming confusion.
- Timeline anchors from the review: deploy at 14:02, first queue-depth alert at 14:19 at 50,000 messages, SEV-2 declared at 14:31, SEV-1 at 15:10, resolution at 19:12, a total of 4 hours 53 minutes.
- Error-rate figures cited: Twilio 429 rate rose from a 0.2% baseline to 38% of sends at peak, with an 11% overall notification failure rate during the incident window.
- Customer impact: 312 clinics affected, roughly 61,000 patients received late reminders, and 9,400 patients got duplicate SMS messages, some three or four times.
- Pam counted 212 OOM kills across the notif-worker pods between 14:20 and 16:50 from the Kubernetes events.
- The trigger was Northgate Medical Group uploading a bulk reminder batch through notify-gateway at 14:00, 240,000 reminders in one go for their flu clinic campaign.
- Before 2.14.0, retryable Twilio/SendGrid errors were published to a delayed retry exchange with backoff of 5 seconds, then 30 seconds, then 2 minutes.
- The RETRY_MODE inline setting was originally added by Sam for a latency experiment on the email path, not for the SMS flow that broke.
- Grace was expected to join only for the last twenty minutes or so to hear where the team landed.
- The team noted the architecture diagram showed a DLQ that was never actually in place.
- Ravi's three arguments for MSK were replay via consumer offset resets, natural backpressure with consumer lag as a first-class on-disk metric, and per-clinic ordering via partitioning by clinic ID.
- Ravi said the reschedule-then-cancel race condition has been wanted fixed for about a year, and Sam agreed the reschedule-cancel bug is real.
- MSK was described as HIPAA eligible under the BAA with KMS customer managed keys and TLS in transit, which would clear the auditor finding.
- The proposed version is Kafka 3.6 on MSK, which the data team already runs for the analytics pipeline, though Pam noted that is a different team and a different account.
- Ravi cited a QCon San Francisco talk where a food delivery company moved order notifications from RabbitMQ to Kafka in about eight weeks after a similar retry storm, with p99 down around 60%.
- Pam was skeptical of the conference-talk evidence, noting nobody presents a migration that required hiring six more SREs.
- The proposed retry design uses notifications.retry.30s, notifications.retry.2m, notifications.retry.10m, and a DLQ topic — a pattern Ravi attributed to an Uber post.
- Current messaging spend on the RabbitMQ EC2 cluster is about $3,800/month, and Ravi's initial MSK estimate of ~$1,900/month was lower than that.
- Current volume is about 3 million messages a day (roughly 90 million a month), with peak expected to reach about 9 million a day.
- Sam owned the RETRY_MODE change and apologized for not splitting it into its own deploy; the facilitator reaffirmed the review is blameless and called it a system problem.
- Team composition named as four engineers — the facilitator, Ravi, Sam, and Joaquin — plus Pam as shared SRE at about half time.
- Kafka.m5.large was deemed too small; the data team had to upgrade off it within a month and now runs kafka.m5.xlarge
- Expected peak load is 9 million messages a day (with bursts like the Northgate batch), and SQS sizing was based on 90 million messages a month
- The data team's MSK bill is $5,400 for their cluster, with ours expected to be slightly smaller
- notif-worker carries quiet hours logic (no texting patients 9pm-8am local), per-clinic template rendering, STOP-list opt-out checks, and SendGrid bounce handling
- Quiet hours is implemented by republishing to a delayed exchange with a TTL until 8am, which Kafka cannot do per-message and would require a scheduler
- Kafka retry topics block every message behind a stuck one in the same partition, requiring enough partitions and per-partition pause/resume
- Quorum queues support a delivery-limit setting that auto-dead-letters after N redeliveries, making Tuesday's retry loop impossible at the broker level
- SQS for ~90 million messages/month (3-4 API calls each) is estimated at hundreds of dollars, $600-$1,100 with SNS and KMS, conservatively $1,100
- SQS has no brokers to patch, no Erlang upgrades, and no inter-node TLS, and includes redrive-to-DLQ, visibility-timeout backoff, BAA coverage, and KMS customer managed keys
- Northgate alone accounts for 38 clinic locations
- The option-one RabbitMQ plan is a 3.11.9 to 3.13.7 upgrade plus moving notifications.v2 from classic mirrored queues to quorum queues, estimated at three weeks total
- Option three (SQS) also has a dual-run period but is cheap, roughly $4,900 total
- The outbox relay publishing at-least-once is another reason consumer-side idempotency is required
- Because the relay publishes at-least-once, consumer-side idempotency is required regardless of broker choice.
- The team is on Postgres 14, and SELECT FOR UPDATE SKIP LOCKED would let two relays run concurrently.
- Sam's original Redis idea was SETNX on the notification ID with a 24-hour TTL, skipping the send if the key already existed.
- The Postgres idempotency design inserts into delivery_attempts before calling Twilio and, on a conflict, checks status and skips if already sent.
- Sam judged the extra indexed insert per send as acceptable cost.
- Email pods should ideally scale separately because SendGrid's limit is much higher than Twilio's, but for now only notif-worker is capped at 16.
- Each notif-worker pod runs six concurrent sends, which is the basis for the 16-replica arithmetic.
- Northgate's 240,000-message batch arrived in about four minutes, a legitimate load that should drain in roughly 40 minutes.
- Speaker 1 endorsed oldest-message-age as the right metric because it matches patient experience.
- The 2.14.1 roll-forward on Wednesday removed RETRY_MODE from the config but kept prefetch at 200, with the pod memory limit raised to stop OOMs.
- Sam expects the prefetch drop to 30 to bring p99 back near 2.1 seconds from the current 3.4 seconds.
- Incident scope from Dana's recap: Tuesday September 8th, 4 hours 53 minutes from first alert to resolution, backlog peaking at 1.8 million messages, p99 latency rising from 2.1 seconds to 47 minutes, 420 clinics affected, about 61,000 late
- The triggering event was a 240,000-message reminder batch from Northgate Medical Group at 14:00.
- Three migration options were presented: keep RabbitMQ 3.13 with quorum queues at about $4,300/month and three weeks; Kafka on MSK at about $5,200/month steady state and $9,000 during dual-run with a 10-12 week estimate; SQS/SNS at about $1,
- Dana openly corrected the record, noting she had said they were converging on Kafka before Pam's real cost number and Sam's timeline were known.
- Ravi still considers a log-based system attractive long term for replay and ordering, but conceded it doesn't fit before peak on cost or timeline.
- Grace joined the call about 20 minutes late thinking it started at 3:30, but arrived after the options discussion and had roughly 20 minutes available.
- Grace confirmed her rejection of Kafka rests on five stated reasons: steady-state and dual-run costs over the ceiling, the timeline missing the October 23 freeze, failure to address the root cause, and the team's lack of Kafka operations ex
- Grace argued the reassignment because Ravi should stay on the SQS prototype, which is the thing they need data on.
- Pam and Sam did the last RabbitMQ upgrade from 3.8 to 3.11, and Pam did most of it.
- Pam was previously slated to own alerts, the autoscaling change, the cost estimate and the runbook before the reassignment.
- The runbook's first section covers rollback including the ConfigMap chart, per Grace's request.
- The nightly batch for next-day appointments at 02:00 routinely pushes oldest message age to about 150 seconds.
- The 180-second threshold was chosen because it sits above the nightly batch yet would still have caught Tuesday within minutes.
- The facilitator spoke with Joaquin last week and Joaquin asked for something self-contained to come back to, which is why the outbox task was chosen.
- Ravi noted the Argo Rollouts task is fine because it comes after the SQS spike.
- Grace closed by thanking the team and telling Sam not to carry the incident around, and Ravi joked he would carry it and the Kafka dream.
- The team closed with a running joke about putting the Kafka dream and the incident in the dead letter queue.

#### Action items (structured)
- Sam: Investigate whether the prefetch setting explains why p99 latency is still at 3.4 seconds rather than the 2.1-second baseline. [inferred]
- Pam: Pam to talk through the autoscaler as the fourth amplifier in the outage.
- Cover the architectural remediation of the notification pipeline later in the session. [inferred]
- Ravi: Ravi to write a two-week spike plan for the Kafka consumer — a prototype of notif-worker reading from MSK with the retry topics. (deadline: Monday)
- Code freeze for peak season [inferred]
- Joaquin returns from parental leave [inferred]
- Open enrollment starts [inferred]
- RabbitMQ TLS auditor finding remediation due [inferred]
- Ravi's Kafka consumer spike plan due [inferred]
- Pam: Send the data team's MSK bill to Ravi to back up the $5,200 estimate
- Check whether any insurance card reminder payload (inline email image) exceeds SQS's 256 KB message size limit [inferred]
- Pam: Work out the SQS migration timeline (Pam would not commit before Oct 23 without a prototype) [inferred]
- Sam: Implement consumer fixes needed regardless of broker: exponential backoff retries on the delayed exchange (1s/5s/30s/2min/10min, max five attempts then dead letter) and delete the inline retry mode [inferred]
- Sam: Define the idempotency approach for the consumer (Sam's Redis SETNX idea flagged as having two problems) [inferred]
- October 23rd change freeze [inferred]
- Sam: Delete the inline retry mode entirely and add exponential backoff on the delayed exchange (1s, 5s, 30s, 2 min, 10 min, max five attempts then dead letter), plus the token bucket rate limiter for Twilio at 100/second. (deadline: Friday, September 25th)
- Sam: Fix the DLQ policy pattern in Terraform so notifications.v2 actually dead-letters — marked urgent; Sam said it could be done today but committed to the Monday date. (deadline: Monday, September 14th)
- Sam: Change notif-worker prefetch to 30 in a separate deploy. (deadline: Tuesday, September 15th)
- Sam: Build the idempotency delivery_attempts table with a unique index on notification ID and channel. (deadline: Wednesday, October 7th)
- Ravi: Perform the RabbitMQ 3.11.9 to 3.13.7 upgrade and migrate notifications.v2 to quorum queues with a delivery limit of 5. (deadline: Friday, October 9th)
- Grace: Grace will use 420 (delivery-log figure confirmed by customer success) rather than 312 in the customer note.
- DLQ Terraform policy pattern fix [inferred]
- Backoff + Twilio token bucket rate limiter [inferred]
- Idempotency delivery_attempts table [inferred]
- Pam: RabbitMQ 3.11.9 → 3.13.7 upgrade and quorum queue migration [inferred]
- Change freeze [inferred]
- Open enrollment start [inferred]
- Architecture review / SQS decision [inferred]
- Next fiscal year (budget ceiling could change) [inferred]
- Sam: Implement idempotency via a delivery_attempts table with a unique index on notification ID and channel; backoff and limiter are the same PR. (deadline: Wednesday, October 7th)
- Me: Write the notification backlog runbook covering RETRY_MODE config drift checks, DLQ checks, manual replica capping, and pausing Northgate-style batches; rollback must explicitly include the ConfigMap chart. (deadline: Thursday, September 24th)
- Pam: Set up alerts: page when oldest message age on notifications.v2 is over 180 seconds for 5 minutes, page when Twilio 429 rate is over 2% for 5 minutes, ticket when the DLQ has any message, page when the DLQ is over 500. (deadline: Friday, September 18th)
- Pam: Make the max replicas change from 40 to 16 today (one-line change) and switch to scaling on age by the 18th with the alerts. (deadline: Today for replicas; September 18th for age scaling)
- Pam: Produce a 12-month cost estimate for all three options, including peak months and dual-run for SQS, so Grace has it for budget planning. (deadline: Wednesday, September 30th)
- Ravi: Run a 5-working-day SQS and SNS prototype: notif-worker SMS path only, reading from SQS with the redrive policy, visibility timeout backoff, KMS customer managed key, and checking the largest payloads against the 256 kilobyte limit; start M (deadline: Readout Friday, October 2nd)
- Ravi: Get notif-worker onto the Argo Rollouts canary pipeline, like notify-gateway. (deadline: Friday, October 16th)
- Joaquin: Deliver the outbox pattern in notify-gateway: outbox table in the same Postgres transaction and the relay as its own deployment with its own alert, working with Joaquin who returns on the 21st; facilitator to brief him on his first day. (deadline: Friday, October 16th)
- Me: Write the architecture decision record covering all of these decisions. (deadline: Tuesday, September 15th)
- Grace: Send the incident note to the 420 clinics through customer success. (deadline: Monday, September 14th)
- Me: Send the meeting notes and the ADR draft in the channel. (deadline: absent)

#### Decisions (structured)
- Refined root cause agreed: the RETRY_MODE=inline config shipped with notif-worker 2.14.0 turned every retryable provider error into an immediate requeue with no backoff, creating the Twilio retry storm.
- Agreed that the Northgate Medical Group bulk batch was the trigger, while prefetch 200 and the missing DLQ were amplifiers/symptoms rather than the cause.
- Agreed the session would spend roughly 15 minutes on a mini post-incident review of the Tuesday, September 8 notification outage and the rest on architectural remediation.
- Agreed the fix should not be limited to patching the consumer, with the goal of preventing recurrence rather than waiting for a repeat in November.
- Tentatively agreed that the direction is to migrate the notification pipeline to Kafka on Amazon MSK before the October 23rd code freeze.
- Agreed not to decide today whether to resend the ~2,300 notifications stuck in Postgres, leaving it as an open item.
- Deferred choosing the broker option until Grace joins so she can hear the options
- Agreed to delete the inline retry mode entirely rather than just defaulting it off
- Agreed the outbox relay should be its own separate deployment with its own alert, not a goroutine or worker thread inside notify-gateway
- Adopted the outbox pattern for notify-gateway (write notification row and outbox row in one Postgres transaction) to stop losing messages between the DB and the broker
- Ravi accepted the revised MSK estimate of about $5,200/month based on the data team's actual bill
- Ravi conceded the Tuesday retry storm is a consumer design problem, not a broker problem
- Agreed to use Postgres SELECT FOR UPDATE SKIP LOCKED so two outbox relays can run
- Idempotency will be implemented in Postgres with a delivery_attempts table and a unique index on notification ID plus channel, not Redis.
- The outbound relay will be its own deployment with its own alert, not a goroutine inside notify-gateway or a Node worker thread.
- notif-worker max replicas will be capped at 16 (down from 40), giving 96 messages/second against Twilio's 100/second limit.
- A token bucket rate limiter per provider will be added inside the worker so Twilio cannot exceed 100 messages/second even if replicas are raised again.
- Autoscaling will be driven by oldest message age and consumer utilization rather than queue depth.
- Alerting will be changed to page when the oldest message age on notifications.v2 exceeds 120 seconds for 5 minutes and when the Twilio 429 rate exceeds 2% for 5 minutes, with a ticket (not a page) for any DLQ messages and a page above 500 D
- The team will not migrate to Kafka on MSK — not before peak and not on the post-peak roadmap unless something changes — and will stay on RabbitMQ for peak season with option one (3.13 upgrade, quorum queues, consumer fixes).
- SQS and SNS will be evaluated with a timeboxed prototype now, with the migration decision taken at the January 13th architecture review.
- notif-worker prefetch will be dropped from 200 to 30 and shipped as a separate deploy from anything else.
- Pam takes the RabbitMQ 3.11.9 to 3.13.7 upgrade and the notifications.v2 quorum queue migration instead of Ravi, with the same deadline of Friday, October 9th. (owner: Pam)
- Ownership of the notification backlog runbook was moved off Pam to the facilitator to relieve her overloaded plate. (owner: Me)
- The oldest message age page threshold was revised to 180 seconds for 5 minutes instead of 120 seconds, with the rest of the alert rules unchanged.
- The Kafka spike plan Ravi was going to write for Monday was cancelled outright.
- Autoscaling will reduce max replicas from 40 to 16 and scale on oldest message age instead of message depth.
- The outbox pattern in notify-gateway is kept assigned to Joaquin for his return on the 21st despite Grace questioning the fairness of a first-day-back handoff. (owner: Joaquin)
- A pipeline game day (killing the broker on staging during a big batch) was acknowledged as desirable but explicitly not assigned today.

#### Open questions (structured)
- Why is p99 end-to-end delivery latency still 3.4 seconds after the fix instead of the 2.1-second pre-incident baseline, and is the prefetch setting to blame? [open]
- What architectural changes should be made to the notification pipeline, deferred until after the review portion of the meeting? [open]
- Whether to resend the ~2,300 notifications that were left sitting in Postgres with status queued and were never published. [open]
- Whether Pam's ~$5,200/month MSK estimate (three m5.xlarge brokers, storage, provisioned throughput, cross-AZ replication) is the real cost versus Ravi's $1,900 estimate that excluded data transfer. [open]
- How long the migration would actually take, since notif-worker is not small — Ravi estimated six weeks, which is exactly the window to the October 23rd freeze. [open]
- Which broker option to choose — keep RabbitMQ, MSK Kafka, or managed SQS with SNS — remains undecided pending Grace [open]
- Does any insurance card reminder template with an inline image exceed the 256 KB SQS message size limit? [open]
- What is the SQS migration timeline — Pam does not know yet and would need a prototype [open]
- How to fix the reschedule-cancel race, which the queue alone does not resolve [open]
- What idempotency mechanism to use, given a 24-hour Redis TTL is too short? [open]
- Whether Twilio can raise the short code throughput for peak season — is 100/second a hard limit or just what was requested three years ago? [open]
- Whether notify-gateway should throttle giant per-clinic uploads (e.g. Northgate's 240,000 in four minutes) via a per-clinic rate — placed on the "maybe list" with no owner assigned today. [open]
- The SQS/SNS option has no solid timeline until a prototype is built, so the migration decision defers to the January 13th architecture review. [open]
- What to do with the 2,300 notifications that were never sent: resend some of them, contact those patients another way, or leave it? Pam is worried about stale reminders. [open]
- Is Twilio's 100 per second a hard limit on our short code, or is it per account, and can it be raised for peak? [open]
- Do any of the insurance card email payloads exceed 256 kilobytes? The prototype will look at it, but it is not yet known. [open]
- Does the quorum queue migration need a maintenance window, or can it be done live with a shovel? [open]
- Pam's idea of throttling large per-clinic uploads at notify-gateway has no owner and no decision, and product would need to weigh in. [open]
- Should email and SMS be separate notif-worker deployments? The team agreed it is ideal, but nobody decided. [open]

#### Risks (structured)
- [high] The dead letter queue was never enabled on notifications.v2 because the Terraform policy pattern matched 'notifications-v2' with a hyphen while the queue is 'notifications.v2' with a dot, so failed messages were requeued forever.
- [high] notif-worker deploys straight to all replicas with no canary, unlike notify-gateway and the scheduler which use Argo Rollouts, leaving the service that sends patient messages with less deployment safety.
- [high] The RETRY_MODE ConfigMap is managed in a separate chart, so the 14:45 Helm rollback of the image left the inline retry config in place and the rollback accomplished nothing that mattered.
- [medium] KEDA autoscaled notif-worker on queue depth from 8 pods to the maximum of 40 pods by about 15:05, acting as a fourth amplifier of the incident.
- [medium] Duplicate SMS messages, affecting 9,400 patients, were what generated angry customer calls because recipients thought they had been hacked.
- [medium] End-to-end delivery latency remains above the pre-incident baseline after the fix (3.4s versus 2.1s p99).
- [high] The $6,000/month messaging budget ceiling leaves little headroom if MSK actually costs ~$5,200/month as Pam estimates.
- [high] The migration window is tight — code freeze for peak is October 23rd, about six weeks away, and anything touching the production pipeline must be done and soaked before then.
- [medium] kafka.m5.large brokers are too small for this workload; the data team had to upgrade off m5.large within a month and now run m5.xlarge.
- [medium] Ravi's MSK estimate omitted data transfer, including cross-AZ replication traffic that doubles on every write with replication factor 3.
- [medium] The March auditor finding that RabbitMQ inter-node traffic is not using TLS is still open, with a remediation due date of end of year.
- [medium] Kafka topics would hold PHI, and internal policy is that PHI cannot sit in a message broker longer than 14 days.
- [medium] Team capacity is constrained: four engineers, with Joaquin on parental leave until September 21st and Pam shared across three teams at about half time.
- [high] Publisher confirm timeouts between 16:00 and 16:45 created a dual-write problem where notification rows were committed to Postgres but never made it onto RabbitMQ.
- [high] There is no idempotency check on the send side, so OOM kills between the Twilio accept and the RabbitMQ ack produce duplicate sends.
- [medium] Peak season roughly triples notification volume from November through mid-December (about 9 million messages/day), amplifying any remaining pipeline weakness.
- [high] Running RabbitMQ ($3,800) and MSK ($5,200) during dual-run costs $9,000/month, 50% over the $6,000 ceiling
- [high] MSK steady-state $5,200 plus extra Postgres capacity sits right at the $6,000 ceiling
- [high] A 10-12 week Kafka migration misses the October 23rd freeze and lands mid-November during open enrollment
- [high] Kafka does not by itself fix the retry storm, the missing DLQ, or the autoscaler hitting Twilio's rate limit
- [medium] Replaying 240,000 appointment reminders after a five-hour outage would be undesirable because roughly half would be stale
- [medium] SQS standard queues are at-least-once and unordered, so there is no per-clinic ordering and idempotency is mandatory
- [medium] Moving large payloads to S3 with a pointer puts PHI in more places
- [medium] Adding Redis/ElastiCache to the notification path means another BAA review and another KMS config
- [medium] A 24-hour idempotency TTL is too short because a message can legitimately be retried up to 72 hours after first attempt
- [high] The $6,000/month messaging budget ceiling cannot be raised before the next fiscal year starting in February, so the $9,000 Kafka dual-run month is not approvable.
- [high] The October 23rd freeze is fixed and open enrollment starts November 1st, with sales already promising two large hospital groups that reminders will be "bulletproof".
- [high] The dead letter queue was never actually enabled because of a Terraform policy pattern typo (hyphen vs dot), dating back to March 2024 when the queue was created.
- [high] The autoscaler ran up to 40 pods against Twilio's 100/second limit, which acted as an amplifier during the incident.
- [high] notif-worker is not on the canary pipeline, so regressions in that service can ship without staged exposure.
- [medium] A team of four with a half-time SRE has no Kafka operations experience, cited as a reason against the MSK migration.
- [medium] The proposed Redis idempotency approach would require adding ElastiCache in the notification path, meaning another BAA review and another KMS config.
- [medium] A 24-hour Redis TTL is insufficient because backoff plus quiet hours can legitimately retry a message up to 72 hours after first attempt.
- [medium] The current page-at-50,000-queue-depth alert fires every Monday morning on routine clinic batch uploads, so people have learned to ignore it.
- [low] Product stakeholders are expected to resist per-clinic gateway throttling because clinics like immediate completion.
- [high] Paging on oldest message age at 120s would fire every night because the 02:00 next-day-appointment batch routinely pushes age to ~150s, causing alert fatigue and a repeat of the Monday morning problem.
- [high] The unresolved 2,300 never-sent notifications is a patient safety question that Grace will not guess on.
- [medium] Twilio's 100-per-second limit is unresolved and may not be raisable, and Ravi notes it has been 100 since before any of the team was there.
- [medium] Whether the quorum queue migration can be done live or needs a maintenance window is unknown; the previous 3.11 upgrade used a 20-minute window at 03:00 and quorum queues might behave differently.
- [medium] Whether insurance card email payloads exceed the 256 kilobyte limit is still unknown and only the prototype will reveal it.

#### Follow-up draft
Subject: Follow-up: September 8 notification outage review and remediation path

Hi team,

Thanks for the thorough review of Tuesday's September 8 notification outage and for landing on a clear remediation path. We agreed the root cause was the RETRY_MODE=inline config shipped with notif-worker 2.14.0, which requeued every retryable provider error with no backoff — the Northgate bulk batch was the trigger, while prefetch 200, the never-enabled DLQ on notifications.v2, and the KEDA autoscaler were amplifiers rather than causes. On the architecture side, we're staying on RabbitMQ for peak season with the 3.13 upgrade, quorum queues, and the consumer fixes, with Kafka on MSK off the roadmap on cost and timeline grounds and SQS/SNS moving to a timeboxed prototype that feeds the January 13th architecture review; idempotency will use a Postgres delivery_attempts unique index and notif-worker max replicas drop to 16.

The one item still needing an answer is what we do with the roughly 2,300 notifications left queued in Postgres that were never published — resend them, reach those patients another way, or leave them.

Best,

---

# Summary C

_(run2)_

### Title: RabbitMQ Remediation for Peak Season

#### Overview
The review established the Northgate 240,000-message batch as the trigger and RETRY_MODE=inline with no backoff as the root cause, with prefetch/OOMs, the missing DLQ, and autoscaling identified as amplifiers. The team quantified the incident's trigger and notification losses, tentatively leaned toward an MSK migration before the October 23 freeze, and revised the MSK estimate from $1,900 to about $5,200 per month. The team revised the MSK estimate to $5,200 per month, added SQS/SNS at about $1,100 per month as a third option, corrected the incident scope to 420 clinics, and deferred broker selection while aligning on a transactional outbox and separate relay. The team rejected Kafka for peak, selected RabbitMQ 3.13 and quorum-queue fixes, scheduled an SQS/SNS prototype with a January 13 decision, and assigned dated reliability work to Sam and Ravi. Pam took over the RabbitMQ and quorum-queue migration, the alert age threshold was raised to 180 seconds, the Kafka spike was canceled in favor of an SQS/SNS prototype, and six unresolved questions were logged. Key decisions: The group accepted the causal chain that the Northgate batch was the trigger, RETRY_MODE=inline with no backoff was the root cause, and prefetch 200/OOMs plus the missing DLQ were amplifiers.; The group agreed to treat the prefetch-200 OOM episode as an amplifier or symptom rather than the primary cause.; The decision on whether to resend the approximately 2,300 notifications that never reached the queue was explicitly deferred as an open item..

#### Summary
- The meeting reviewed the notification incident and evaluated broker and reliability options for peak season.
- It concluded that a large batch was the trigger and RETRY_MODE=inline with no backoff was the root cause, while excessive prefetch, the missing DLQ, and queue-depth autoscaling amplified the failure.
- For peak, the team chose RabbitMQ remediation rather than Kafka on MSK, including removal of inline retries, backoff and dead-lettering, prefetch reduced to 30, a cap of sixteen replicas with Twilio rate limiting, a transactional outbox with a separate relay, and PostgreSQL delivery idempotency; the decision on resending approximately two thousand three hundred notifications that never reached the queue remained open.

#### What changed
- The incident timeline was anchored to a 14:02 deployment of notif-worker 2.14.0, followed by the first notifications.v2 depth alert at 14:19 when the queue crossed 50,000 messages.
- The 14:45 rollback to notif-worker 2.13.2 had no effect, and the incident was escalated to SEV-1 at 15:10 once depth passed 400,000 and clinics began calling.
- The backlog peaked at 1.8 million at 16:40, the 16:52 change stopped the bleeding, it drained by 18:35, and the incident was resolved at 19:12.
- End-to-end p99 rose from a 2.1-second baseline to 47 minutes at worst and sat at 3.4 seconds after the fix.
- Twilio 429s rose from a 0.2% baseline to 38% at peak, while the incident-window notification failure rate reached 11%.
- The customer impact was quantified as 312 clinics, about 61,000 late reminders, and 9,400 duplicate SMS messages, with some reminders sent three or four times.
- Sam's 16:52 manual switch of RETRY_MODE back to delayed was followed by a decline in the 429 rate within about four minutes.
- The root-cause assessment shifted from blaming prefetch and OOMs to identifying RETRY_MODE=inline with no backoff as the primary cause and prefetch/OOMs as an amplifier.
- The DLQ review found notifications.v2 never had its dead-letter policy applied, leaving zero messages in the DLQ since March 2024 and failed messages requeued indefinitely.
- The deployment review found notif-worker bypassed Argo Rollouts canary and went directly to all replicas.
- KEDA had scaled notif-worker from 8 to its 40-pod maximum by about 15:05, and the autoscaler was introduced as a fourth amplifier.
- The incident trigger was identified as Northgate Medical Group's 240,000-reminder upload at 14:00 through notify-gateway.
- Inline retry with no backoff was confirmed as the root cause, with prefetch 200 and no DLQ identified as amplifiers.
- KEDA scaled notif-worker from 8 to 40 pods by about 15:05 as queue depth climbed.
- The resulting 240 attempted sends per second were quantified against Twilio's 100-per-second short-code limit.
- The approximately 9,400 duplicates were attributed mainly to OOM kills after Twilio acceptance but before RabbitMQ acknowledgment, combined with no send-side idempotency.
- A separate loss mode was quantified: publisher-confirm timeouts during 16:00-16:45 left about 2,300 Postgres rows queued but never published or sent.
- Peak-readiness volume was quantified at about 3 million messages per day now and 9 million per day at the expected threefold seasonal increase.
- The production code-freeze constraint was set for October 23, with changes required to be completed and soaked beforehand.
- The working architecture direction shifted from only fixing the consumer toward a tentative Kafka-on-MSK migration before the freeze.
- The migration estimate was broken into roughly one week for producer changes, three weeks for the consumer rewrite, and two weeks of dual-running and soak.
- The initial MSK estimate was roughly $1,900 per month for three kafka.m5.large brokers across three availability zones plus some storage.
- The MSK estimate was challenged and revised to about $5,200 per month using three m5.xlarge brokers, storage, provisioned throughput, and cross-AZ replication traffic.
- Ravi's initial $1,900 MSK model assumed 500 GB per broker and excluded data transfer, while the revised model uses the data team's actual bill.
- The cost picture now includes a $9,000 monthly RabbitMQ/MSK dual-run against a $6,000 ceiling, with steady-state MSK plus extra Postgres capacity already at the ceiling.
- The Kafka migration estimate expanded to 10 to 12 weeks for two people, putting it past the October 23 freeze and likely into mid-November open enrollment.
- The incident scope was corrected from 312 to 420 affected clinics, while patient impact remained about 61,000 late notifications and 9,400 duplicates.
- SQS with SNS fan-out was added as a third option, estimated at $1,100 per month conservatively, about $2,500 in peak months, and about $4,900 during dual-run.
- The RabbitMQ remediation path was quantified at about $4,300 per month and three weeks, including consumer fixes, the RabbitMQ 3.13.7 upgrade, and quorum queue migration.
- The team aligned on a transactional outbox and separate relay as a broker-independent fix for the 2,300 lost notifications.
- The initial Redis idempotency approach was challenged because its 24-hour TTL would not cover legitimate retries lasting up to 72 hours and would add BAA and KMS work.
- The relay plan settled on a standalone deployment with its own alert, while PostgreSQL 14 row locking was identified as enabling two relays.
- The idempotency design changed from a Redis SETNX key with a 24-hour TTL to a PostgreSQL delivery_attempts table keyed uniquely by notification ID and channel.
- The proposed notif-worker cap was corrected from 20 replicas to 16 after the 120-per-second calculation exceeded Twilio's limit, leaving 96-per-second nominal capacity.
- The autoscaling signal shifted away from queue depth to oldest message age and consumer utilization.
- A replacement alerting proposal was defined around oldest-message age, Twilio 429 rate, and DLQ thresholds instead of the noisy 50,000-depth page.
- The p99 diagnosis was revised from prefetch and OOM behavior as the primary cause to RETRY_MODE's immediate requeue of Twilio 429s as the actual root cause, with prefetch treated as an amplifier.
- Prefetch was targeted to drop from 200 to 30 in a separate deployment.
- The incident impact count was corrected from 312 caller-reported clinics to 420 clinics from delivery logs, and Grace committed to use 420 in the customer note.
- The architecture direction moved away from earlier Kafka convergence to RabbitMQ for peak, with SQS/SNS deferred to a timeboxed prototype.
- The SQS decision checkpoint was fixed at the January 13 architecture review.
- Sam's idempotency work was specified as a delivery_attempts table with a unique index on notification ID and channel, targeted for October 7th.
- RabbitMQ upgrade ownership moved from Ravi to Pam so Ravi can focus on the SQS prototype, while the October 9th date stayed.
- The notification backlog runbook moved from Pam to Me and now explicitly includes ConfigMap-chart rollback instructions alongside config-drift, DLQ, replica-cap, and batch-pausing procedures.
- The oldest-message-age alert threshold changed from 120 to 180 seconds for 5 minutes after the team noted that the nightly batch reaches about 150 seconds, while the other alert rules stayed unchanged.
- Autoscaling was set to a 16-replica maximum instead of 40 and to use oldest-message age rather than queue depth.
- The cost-estimate deliverable was defined as a 12-month comparison of all three options including peak months and SQS dual-run costs, due September 30th.
- The SQS/SNS SMS-only prototype was scheduled for September 28th through October 2nd, and the Kafka spike plan was explicitly canceled.
- Ravi's notif-worker work also gained an Argo Rollouts canary-pipeline task due October 16th.
- The notify-gateway outbox approach was retained for Joaquin, with a same-transaction outbox table and separate relay deployment with its own alert.
- An ADR due September 15th and an incident note to 420 clinics due September 14th were assigned.
- The team recorded six unresolved questions covering unsent notifications, Twilio rate limits, payload size, quorum migration, per-clinic throttling, and email/SMS deployment separation.

#### Decisions
- The group accepted the causal chain of the Northgate batch as trigger, RETRY_MODE=inline with no backoff as root cause, and prefetch 200/OOMs plus the missing DLQ as amplifiers.
- The team recorded a tentative working direction to migrate the notification pipeline to Kafka on MSK before October 23, rather than treating that architecture as final.
- The resend decision for the approximately 2,300 never-published notifications was deferred rather than decided during the incident review.
- The working MSK estimate is $5,200 per month rather than $1,900.
- Broker selection was deliberately deferred until Grace reviews all three options.
- Inline retry mode will be deleted completely rather than merely disabled.
- notify-gateway will write its notification and outbox rows in the same Postgres transaction.
- The outbox relay will be a separate deployment with its own alerting.
- Consumer-side idempotency is required because the relay publishes at least once.
- The relay will be a standalone deployment with its own alert rather than a notify-gateway goroutine or Node worker thread.
- PostgreSQL, not Redis, is the selected idempotency store, using a unique notification ID and channel index.
- The working provider-protection plan is 16 notif-worker replicas maximum plus a per-provider token bucket for Twilio.
- Scaling will prioritize oldest message age and consumer utilization rather than queue depth.
- Prefetch will be reduced to 30 and deployed separately from other changes.
- Kafka is rejected for peak and is not planned after peak unless circumstances change.
- RabbitMQ option one, including the broker upgrade, quorum queues, consumer fixes, DLQ, and backoff, is the peak-season path.
- A timeboxed SQS/SNS prototype will begin now and inform a migration decision at the January 13 architecture review.
- Idempotency will use a delivery_attempts table with a unique index on notification ID and channel.
- Pam will take the RabbitMQ 3.13.7 upgrade and quorum queue migration from Ravi without changing the October 9th date.
- Me will own the notification backlog runbook, including the ConfigMap chart in rollback instructions.
- The oldest-message-age alert threshold is 180 seconds for 5 minutes rather than 120 seconds, with the remaining alert conditions unchanged.
- Autoscaling will use a 16-replica maximum and oldest message age as its scaling signal.
- The SQS/SNS prototype will focus on the notif-worker SMS path for five working days, starting September 28th with an October 2nd readout.
- The Kafka spike plan was canceled.
- notif-worker will use the Argo Rollouts canary pipeline like notify-gateway by October 16th.
- The outbox design will use the same Postgres transaction for the outbox table and a separate alerted relay deployment, with Joaquin retaining the assignment.
- The proposed game day was not assigned during this meeting.

#### Action items
- Record in the incident notes that notifications.v2 had no active DLQ and failed messages were requeued indefinitely.
- Record that notif-worker was not on the canary pipeline and deployed directly to all replicas.
- Revisit the prefetch setting to explain the residual 3.4-second p99 latency.
- Ravi will write a two-week spike plan for a notif-worker prototype that reads from MSK and uses retry topics, with the plan due Monday.
- The team needs to resolve whether the approximately 2,300 notifications that remained queued and unpublished should be resent.
- The MSK sizing and cost model needs follow-up using peak volume, storage, provisioned throughput, and cross-AZ transfer before the migration direction is finalized.
- Pam will send the data team's MSK bill to support the revised cost estimate.
- A prototype of the SQS/SNS design is needed to establish whether it can be delivered before the October 23 freeze.
- The team needs to check whether any notification payloads exceed SQS's 256 KB limit.
- The consumer retry design needs exponential backoff, a five-attempt limit, dead-lettering, and removal of inline retry mode.
- The team needs to implement the transactional outbox and relay retry behavior for notify-gateway.
- The outbox relay needs to be deployed separately with its own alerting.
- The team needs to design consumer idempotency that remains effective for legitimate retries up to 72 hours.
- Grace will use 420 affected clinics in the customer note.
- Sam will replace inline retries with the specified exponential backoff, five-attempt maximum, and dead-letter behavior by September 25.
- Sam will add the Twilio 100-per-second token-bucket limiter by September 25.
- Sam will correct the Terraform DLQ policy pattern by September 14.
- Sam will deploy the prefetch reduction to 30 separately by September 15.
- Sam will implement the delivery_attempts uniqueness constraint by October 7.
- Ravi will upgrade RabbitMQ and migrate notifications.v2 to quorum queues with delivery limit 5 by October 9.
- A timeboxed SQS/SNS prototype will be produced now, but no owner was named in this chunk.
- Someone should investigate whether Twilio can increase the short-code throughput for peak season, but no owner or deadline was assigned.
- Gateway throttling for very large clinic uploads remains a possible follow-up without an owner.
- Sam will implement idempotency with the delivery_attempts table and unique index by October 7th.
- Pam will take the RabbitMQ upgrade and notifications.v2 quorum queue migration by October 9th.
- Me will deliver the notification backlog runbook with config-drift, DLQ, replica-cap, batch-pausing, and ConfigMap rollback guidance by September 24th.
- Pam will configure the alert set with the corrected 180-second oldest-message-age threshold and the unchanged Twilio and DLQ conditions by September 18th.
- Pam will reduce the autoscaling maximum to 16 replicas today and change the scaling signal to oldest message age by September 18th.
- Pam will deliver the 12-month cost estimate for all three options, including peak months and SQS dual-run costs, by September 30th.
- Ravi will run the five-day SQS/SNS prototype for the notif-worker SMS path and provide the October 2nd readout.
- Ravi will move notif-worker onto the Argo Rollouts canary pipeline by October 16th after the prototype.
- Joaquin will implement the notify-gateway outbox pattern with a same-transaction table and separate relay deployment by October 16th.
- Me will brief Joaquin on the outbox work on Joaquin's first day back.
- Me will write the architecture decision record by September 15th.
- Grace will send the incident note to 420 clinics through customer success by September 14th.
- Pam will read up on whether the quorum queue migration needs a maintenance window or can run live with a shovel.
- Me will send the meeting notes and ADR draft in the channel.

#### Open questions
- What specifically about the prefetch setting is keeping post-fix p99 at 3.4 seconds instead of the 2.1-second baseline?
- Which architectural changes will prevent a repeat of the outage instead of only patching the consumer?
- How did KEDA's scale-out to 40 replicas contribute to the incident as the identified fourth amplifier?
- Should the approximately 2,300 never-published reminders be resent when some appointment dates may already have passed?
- Is the revised approximately $5,200 monthly MSK estimate complete and within the $6,000 messaging ceiling?
- Can the six-week migration and soak be completed before the October 23 code freeze if work starts Monday?
- Is MSK the final architecture or only a provisional direction pending cost and sizing validation?
- How will replayable Kafka topics support PHI deletion and the internal 14-day broker-retention policy?
- Should the proposed 30-second, 2-minute, and 10-minute retry topics plus a DLQ topic be adopted?
- Which broker option will be selected after Grace reviews the alternatives?
- What is the SQS implementation timeline, and can it be committed before the October 23 freeze?
- Do any notification payloads exceed 256 KB, especially the insurance-card reminder with an inline image?
- What idempotency mechanism will cover 72-hour retries without adding Redis-related BAA and KMS work?
- Whether SQS standard unordered delivery is acceptable, or how FIFO throughput limits could be handled if ordering is required.
- Whether an S3-pointer workaround for oversized messages is acceptable given the additional PHI location.
- Whether an appointment version number will be added to resolve the reschedule-cancel race.
- If Kafka remains under consideration, where quiet-hours scheduling will live and how retry-topic partition blocking will be handled.
- Whether Twilio's 100-per-second short-code limit is hard or can be raised for peak season remains unresolved.
- Whether email workers will be split into a separate deployment remains open because the split was described as ideal but deferred for now.
- Whether notify-gateway should enforce a per-clinic rate on giant uploads remains on the maybe list.
- The SQS/SNS migration choice remains open until the January 13 architecture review.
- Kafka's post-peak status remains conditional on something changing rather than being part of the current roadmap.
- The team still needs a disposition for the 2,300 unsent notifications, including whether to resend them or contact patients another way.
- The scope and raisability of Twilio's 100-per-second limit remain unknown.
- The team does not yet know whether insurance card email payloads exceed 256 kilobytes.
- The required migration method for quorum queues remains unresolved between a maintenance window and a live shovel migration.
- The proposal to throttle large per-clinic uploads at notify-gateway has no owner or decision and needs product input.
- Whether email and SMS should be separate notif-worker deployments remains undecided.
- The October 16th outbox due date needs reconciliation with Joaquin's stated October 21st return.

#### Risks / blockers
- RETTRY_MODE=inline immediately requeued retryable provider failures with no backoff, creating a self-reinforcing retry storm.
- Twilio rate limiting reached 38% of sends versus a 0.2% baseline, increasing retry pressure and contributing to an 11% notification failure rate.
- Prefetch 200 put 200 unacked messages in memory per pod and contributed to 212 OOM kills, returning messages to the queue.
- The missing x-dead-letter-exchange policy left repeatedly failing notifications.v2 messages requeued forever with no DLQ containment.
- The image-only rollback left RETRY_MODE=inline active because the ConfigMap was managed in a separate chart, so the first rollback did not remove the causal setting.
- notif-worker bypassed canary and deployed straight to all replicas, exposing the full worker fleet to the faulty release.
- KEDA scaled on queue depth from 8 to its 40-pod maximum by about 15:05, and the autoscaler was identified as a fourth amplifier.
- Post-fix p99 remained 3.4 seconds versus the 2.1-second baseline, leaving residual latency unresolved.
- The incident produced 9,400 duplicate SMS messages, sometimes three or four for the same reminder, and the duplicates generated angry calls.
- Northgate's 240,000-reminder bulk upload was normally manageable with delayed retries but became a major load trigger when inline retries were enabled.
- The combination of inline retries without backoff, prefetch 200, and no DLQ can recreate the retry storm after a large batch.
- The current autoscaling behavior can drive 240 attempted Twilio sends per second against a 100-per-second vendor limit.
- No send-side idempotency allows an OOM kill after Twilio acceptance but before RabbitMQ acknowledgment to create duplicate sends.
- The dual-write sequence can leave notifications permanently queued and unsent when publisher confirms time out, as happened to about 2,300 incident records.
- The October 23 freeze leaves only about six weeks to implement and soak production changes for a projected threefold peak-volume increase.
- Staffing is constrained by four engineers, Joaquin's leave until September 21, and Pam's approximately half-time platform availability.
- Budget headroom is uncertain because the initial MSK estimate excluded data transfer and the revised estimate is about $5,200 against a $6,000 monthly ceiling.
- Three m5.large brokers may be insufficient for 9 million messages per day plus Northgate-like bursts, while replication factor 3 adds cross-AZ traffic.
- HIPAA requirements and the unresolved RabbitMQ inter-node TLS finding create compliance risk for the migration timeline.
- The migration itself requires a consumer rewrite and two weeks of dual-running and soak, leaving limited schedule slack.
- The original MSK estimate omitted cross-AZ replication transfer, creating a material underestimation risk.
- MSK dual-run would cost about $9,000 per month against a $6,000 ceiling, while steady-state MSK plus required Postgres is already at the ceiling.
- Kafka migration is estimated at 10 to 12 weeks and would miss the October 23 freeze.
- Kafka does not inherently prevent retry storms, missing DLQs, or autoscaling into Twilio's rate limit.
- Kafka's lack of per-message delay and retry-topic partition blocking creates additional scheduler and consumer-design complexity.
- SQS standard queues are at-least-once and unordered, making consumer idempotency mandatory and leaving per-clinic ordering unresolved.
- SQS's 256 KB limit may affect inline-image payloads, and the S3 workaround would place PHI in another location.
- A Redis idempotency design would add BAA and KMS review work, while a 24-hour TTL is shorter than the legitimate retry window.
- Quorum queues use more memory and disk, likely increasing RabbitMQ instance requirements.
- Replaying 240,000 reminders after a five-hour outage could resend stale messages and would not have solved Tuesday's incident.
- The reschedule-cancel race would remain even if the team moved to SQS.
- m5.large brokers are considered too small for peak traffic of about 9 million messages per day and Northgate-like bursts.
- The 100-messages-per-second Twilio limit is easy to exceed when replica count and per-pod concurrency rise.
- Inline RETRY_MODE caused immediate requeue of Twilio 429s with no backoff, producing the retry storm.
- The DLQ was disabled by a Terraform pattern typo from at least March 2024, leaving failed notifications without the expected dead-letter path.
- Prefetch 200 allows slow sends to hold many messages in each pod's buffer and is contributing to the p99 gap.
- The 50,000-depth page fires during routine Monday batches, causing people to ignore the alert.
- Northgate's 240,000-message upload can create a large but legitimate backlog, making queue depth alone a misleading operational signal.
- The Redis alternative would create additional BAA and KMS dependencies and its 24-hour TTL would not cover retries lasting up to 72 hours.
- Kafka is blocked by the $6,000 monthly ceiling, the $9,000 dual-run cost, and the immovable October 23 freeze.
- The current team lacks Kafka operations experience because it has four people and a half-time SRE.
- SQS/SNS cannot yet be scheduled confidently because there is no solid timeline without a prototype.
- The absence of notif-worker from the canary pipeline allowed the problematic deployment to lack an early-release safeguard.
- The 2,300 unsent notifications pose a patient-safety risk because stale-reminder handling is unresolved.
- The original 120-second alert threshold would have caused nightly pages during the 02:00 batch and risked alert fatigue.
- The unknown Twilio rate-limit scope could constrain peak SMS throughput.
- Unknown insurance-card payload sizes could create a 256-kilobyte compatibility issue for the SQS path.
- The quorum migration may require downtime, but the team has not established whether the previous 03:00 maintenance window applies.
- Large per-clinic upload throttling is blocked on product input and lacks an owner.
- The lack of a decision on separate email and SMS deployments leaves the intended deployment isolation unresolved.
- The outbox schedule contains a direct timeline conflict because the stated due date precedes Joaquin's return date.
- The proposed broker-failure game day has no owner or date, leaving the staging failure scenario unvalidated.
- Ravi's potential context switching between the broker upgrade and SQS prototype was a delivery risk that the ownership change was intended to remove.

#### Notes
- The meeting was scoped to a mini post-incident review followed by architectural discussion rather than the full incident write-up.
- notif-worker is the RabbitMQ consumer that sends through Twilio and SendGrid, while notify-gateway accepts clinic requests and publishes to the queue.
- The p99 metric was defined from notify-gateway accepting the request to Twilio or SendGrid accepting the send.
- Before 2.14.0, retryable Twilio or SendGrid errors used delayed retry backoff of 5 seconds, 30 seconds, and 2 minutes.
- RETTRY_MODE=inline was added in a ConfigMap for a separate latency experiment on the email path.
- The dead-letter exchange and notifications.v2.dlq were declared and bound in Terraform, but the policy pattern used notifications-v2 with a hyphen instead of notifications.v2 with a dot.
- The team had assumed the DLQ was active because it appeared in the architecture diagram, although it had been empty since March 2024.
- Only notify-gateway and the scheduler use Argo Rollouts canary, while notif-worker deploys directly to all replicas.
- Northgate Medical Group uploaded 240,000 flu-clinic reminders through notify-gateway at 14:00, which was normally manageable with delayed retries.
- The interval from the first alert at 14:19 to resolution at 19:12 was 4 hours and 53 minutes.
- One patient replied STOP to all four duplicate messages, illustrating the downstream response to repeated sends.
- KEDA was configured to scale notif-worker on queue depth with a maximum of 40 replicas.
- The Northgate batch was for a flu clinic campaign, and delayed retries would normally have completed it slowly rather than causing the same amplification.
- The duplicate path was Twilio acceptance followed by a pod OOM kill before acknowledgment, RabbitMQ requeue, and another pod sending the message again.
- Publisher confirms timed out after five seconds during the worst broker-pressure window from approximately 16:00 to 16:45.
- The discussion framed the failure as blameless and as a system-design problem exposed by the RETRY_MODE change, DLQ gap, canary gap, autoscaler, and dual write.
- The Kafka proposal emphasized replay by resetting offsets to 14:00, disk-backed backlog with consumer-lag metrics, and per-clinic ordering.
- The proposed runtime was Kafka 3.6 on MSK, with some existing data-team knowledge but in a different team and account.
- The proposed retry design used a primary notifications topic, 30-second, 2-minute, and 10-minute retry topics, and a DLQ topic.
- MSK was described as HIPAA eligible under the BAA with customer-managed KMS keys and TLS in transit, while Kafka retention could be configured to 14 days or less.
- The initial cost model assumed approximately 500 GB per broker and excluded data transfer, while the revised model included larger brokers, storage, provisioned throughput, and cross-AZ replication.
- notif-worker includes local-time-zone quiet hours from 9 p.m. to 8 a.m., per-clinic template rendering, STOP-list opt-out checks, and SendGrid bounce handling.
- The workload assumption is about 9 million messages per day with Northgate-like bursts, and the data team had to upgrade away from m5.large within a month.
- The comparable data-team MSK cluster costs $5,400 per month, with this cluster modeled slightly smaller.
- The SQS estimate assumed 90 million messages per month and three or four API requests per message.
- SQS was described as providing redrive policies with maxReceiveCount, visibility timeouts, BAA coverage, and customer-managed KMS keys.
- SQS was characterized as having no brokers to patch, no Erlang upgrades, and no inter-node TLS findings.
- RabbitMQ quorum queues would automatically dead-letter messages after the configured delivery limit, even when a buggy consumer keeps requeueing them.
- Classic mirrored queues are removed in RabbitMQ 4, so that migration would eventually be required even without the current incident.
- The RabbitMQ option was estimated at about $4,300 per month and three weeks, which was described as inside the freeze.
- Postgres 14 could support two relay instances using SELECT FOR UPDATE SKIP LOCKED.
- Northgate alone accounts for 38 clinic locations within the corrected incident count.
- The relay publishes at least once, which was cited as the reason consumer-side idempotency is required.
- PostgreSQL 14 SELECT FOR UPDATE SKIP LOCKED was cited as the mechanism for running two relays.
- The initial Redis proposal was one key per notification ID using SETNX and a 24-hour TTL, with duplicate sends skipped when the key already existed.
- Quiet hours, weekends, and the backoff schedule can make a legitimate retry occur as late as 72 hours after the first attempt.
- The PostgreSQL idempotency insert adds one indexed round trip before Twilio but was considered acceptable.
- Email scaling was considered for a separate deployment because SendGrid's limit is much higher, but the immediate cap applies to notif-worker.
- The proposed alert thresholds were oldest-message age above 120 seconds for five minutes, Twilio 429 rate above 2 percent for five minutes, a ticket for any DLQ message, and a page above 500 DLQ messages.
- The proposed 429 alert would have fired around 14:08 on Tuesday, approximately nine minutes earlier and more specifically than the previous alert.
- Version 2.14.1 had removed RETRY_MODE from configuration and raised pod memory limits to stop OOMs, but still retained prefetch 200.
- Tuesday's incident lasted 4 hours and 53 minutes, peaked at 1.8 million queued messages, raised p99 latency from 2.1 seconds to 47 minutes, affected 420 clinics, caused 61,000 late reminders and 9,400 duplicates, and left about 2,300 notifi
- The incident trigger was Northgate Medical Group's 240,000-reminder batch at 14:00, while the autoscaler, disabled DLQ, and missing canary pipeline amplified the failure.
- The RabbitMQ option was estimated at about $4,300 per month and three weeks, while Kafka was estimated at $5,200 steady state, $9,000 during dual-run, and 10 to 12 weeks.
- The SQS/SNS option was estimated at around $1,100 per month but lacked a firm timeline without a prototype.
- The October 23 freeze is fixed ahead of November 1 open enrollment, and sales has promised two major hospital groups that reminders will be bulletproof.
- Pam reported that she performed most of the previous RabbitMQ 3.8-to-3.11 upgrade, supporting her taking the new upgrade.
- Sam indicated that the backoff and limiter work are essentially part of the same pull request.
- The nightly next-day-appointment batch runs at 02:00 and routinely drives oldest-message age to about 150 seconds while it drains.
- Grace's budget review is planned for the first week of October, which is why the cost estimate is needed by September 30th.
- The prototype specifically includes a customer-managed KMS key, visibility-timeout backoff, redrive behavior, and validation of the largest payloads.
- Ravi confirmed that the canary-pipeline work will follow the SQS prototype.
- Me said Joaquin had requested a self-contained task to return to after leave, and the outbox work was considered self-contained.
- The proposed game day would kill the broker on staging during a large batch to observe pipeline behavior.
- The previous RabbitMQ 3.11 migration used a 20-minute maintenance window at 03:00.
- Me closed by committing to send the notes and ADR draft in the team channel.

#### Action items (structured)
- Record in the incident notes that notifications.v2 had no active DLQ and failed messages were requeued indefinitely.
- Record that notif-worker was not on the canary pipeline and deployed directly to all replicas.
- Revisit the prefetch setting to explain why post-fix p99 latency remains at 3.4 seconds instead of the 2.1-second baseline. [inferred]
- Ravi: Prepare a two-week spike plan for a prototype of notif-worker reading from MSK with the proposed retry topics. (deadline: Monday)
- Resolve whether to resend the approximately 2,300 notifications that remained queued and unpublished during the incident. [inferred]
- Revalidate the MSK sizing and monthly cost using peak volume, storage, provisioned throughput, and cross-AZ transfer before finalizing the migration direction. [inferred]
- Ravi's two-week Kafka consumer spike plan is due Monday. [inferred]
- Production-pipeline changes must be completed and soaked before the October 23 code freeze. [inferred]
- The proposed migration was estimated at six weeks, with one week for the producer, three weeks for the consumer, and two weeks for dual-running and soak. [inferred]
- Open enrollment starts November 1. [inferred]
- Joaquin is on parental leave until September 21. [inferred]
- The RabbitMQ inter-node TLS remediation is due by the end of the year. [inferred]
- Pam: Send the data team's MSK bill to support the revised $5,200 estimate.
- Prototype the SQS/SNS design so its implementation timeline can be evaluated before committing to the October 23 freeze. [inferred]
- Check whether any notification payloads, especially the insurance-card reminder with an inline image, exceed SQS's 256 KB limit. [inferred]
- Apply the broker-independent retry design with 1-second, 5-second, 30-second, 2-minute, and 10-minute backoff, a maximum of five attempts, dead-lettering, and removal of inline retry. [inferred]
- Implement notify-gateway's transactional outbox and a relay that retries failed publishes and marks rows published after broker confirmation. [inferred]
- Deploy the outbox relay separately with its own alerting. [inferred]
- Design consumer idempotency that covers legitimate retries lasting up to 72 hours rather than relying on a 24-hour Redis key. [inferred]
- October 23 freeze [inferred]
- Grace: Use 420 clinics as the affected-clinic figure in the customer note.
- Sam: Delete inline retry mode and implement delayed-exchange exponential backoff of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes, with a maximum of five attempts before dead-lettering. (deadline: Friday, September 25th)
- Sam: Add a Twilio token-bucket rate limiter capped at 100 messages per second. (deadline: Friday, September 25th)
- Sam: Fix the Terraform DLQ policy pattern so notifications.v2 actually dead-letters. (deadline: Monday, September 14th)
- Sam: Reduce worker prefetch to 30 in a separate deployment. (deadline: Tuesday, September 15th)
- Sam: Implement idempotency with a delivery_attempts table and a unique index on notification ID and channel. (deadline: Wednesday, October 7th)
- Ravi: Take over the RabbitMQ upgrade from 3.11.9 to 3.13.7 and migrate notifications.v2 to quorum queues with delivery limit 5. (deadline: Friday, October 9th)
- Run a timeboxed SQS/SNS prototype for post-peak evaluation. (deadline: now)
- Investigate whether Twilio can raise the short-code throughput above 100 messages per second for peak season. [inferred]
- Consider whether notify-gateway should apply a per-clinic rate limit to very large uploads such as Northgate's 240,000-message batch. [inferred]
- Me: Write the notification backlog runbook covering RETRY_MODE-style config drift, DLQ checks, manual replica caps, Northgate-style batch pausing, and rollback of the ConfigMap chart. (deadline: Thursday, September 24th)
- Pam: Configure alerts for 180-second oldest-message age for 5 minutes, Twilio 429 rate above 2% for 5 minutes, any DLQ message as a ticket, and more than 500 DLQ messages as a page. (deadline: Friday, September 18th)
- Pam: Reduce the autoscaling maximum from 40 replicas to 16 replicas. (deadline: today)
- Pam: Change autoscaling from queue depth to oldest message age. (deadline: Friday, September 18th)
- Pam: Produce a 12-month cost estimate for all three options, including peak months and SQS dual-run costs, for Grace's budget planning. (deadline: Wednesday, September 30th)
- Ravi: Run the five-working-day SQS/SNS prototype for the notif-worker SMS path, including the redrive policy, visibility-timeout backoff, customer-managed KMS key, and 256-kilobyte payload check. (deadline: Start Monday, September 28th; readout Friday, October 2nd)
- Ravi: Move notif-worker onto the Argo Rollouts canary pipeline like notify-gateway. (deadline: Friday, October 16th)
- Joaquin: Implement the notify-gateway outbox table in the same Postgres transaction and deploy the relay separately with its own alert. (deadline: Friday, October 16th) [inferred]
- Me: Brief Joaquin on the outbox assignment on his first day back. (deadline: Joaquin's first day back on October 21st)
- Me: Write the architecture decision record covering the agreed reliability plan. (deadline: Tuesday, September 15th)

#### Decisions (structured)
- The group accepted the causal chain that the Northgate batch was the trigger, RETRY_MODE=inline with no backoff was the root cause, and prefetch 200/OOMs plus the missing DLQ were amplifiers.
- The group agreed to treat the prefetch-200 OOM episode as an amplifier or symptom rather than the primary cause.
- The team set a tentative working direction to migrate the notification pipeline to Kafka on Amazon MSK before the October 23 code freeze, with the direction remaining provisional after cost and sizing pushback.
- The decision on whether to resend the approximately 2,300 notifications that never reached the queue was explicitly deferred as an open item.
- Use approximately $5,200 per month as the working MSK steady-state estimate instead of $1,900.
- Defer the broker decision until Grace has heard the RabbitMQ, MSK Kafka, and SQS/SNS options.
- Adopt a transactional outbox in notify-gateway, writing the notification and outbox rows in one Postgres transaction.
- Run the outbox relay as a separate deployment with its own alert rather than embedding it in notify-gateway.
- Delete the inline retry mode entirely rather than merely defaulting it off.
- Require consumer-side idempotency because the relay and message delivery are at-least-once.
- The relay will run as a separate deployment from notify-gateway or a worker thread and will have its own alert.
- Notification idempotency will use a PostgreSQL delivery_attempts table with a unique index on notification ID and channel rather than Redis.
- For now, notif-worker will be capped at 16 replicas, with six concurrent sends per pod and a per-provider token-bucket limiter protecting Twilio's 100-messages-per-second limit.
- Autoscaling will use oldest message age and consumer utilization rather than raw queue depth.
- Worker prefetch will be reduced from 200 to 30 and shipped in a separate deployment.
- Kafka on MSK will not be used for peak and will not return to the roadmap after peak unless conditions change.
- For peak season, the team will stay on RabbitMQ and implement the selected broker and consumer reliability fixes.
- SQS/SNS will receive a timeboxed prototype now, with the migration decision scheduled for the January 13 architecture review.
- Sam's idempotency implementation will use a delivery_attempts table with a unique index on notification ID and channel. (owner: Sam)
- Pam, rather than Ravi, will own the RabbitMQ upgrade from 3.11.9 to 3.13.7 and the notifications.v2 migration to quorum queues with delivery limit 5, keeping the Friday, October 9th date. (owner: Pam)
- Me will own the notification backlog runbook instead of Pam, and its rollback instructions must include the ConfigMap chart. (owner: Me)
- The notifications.v2 oldest-message-age page threshold will be 180 seconds for 5 minutes instead of 120 seconds, while the other alert conditions remain unchanged.
- Autoscaling will cap maximum replicas at 16 instead of 40 and scale on oldest message age rather than queue depth. (owner: Pam)
- The SQS/SNS prototype will be limited to the notif-worker SMS path and will cover the specified queue, backoff, KMS, and payload-limit checks over five working days. (owner: Ravi)
- The Kafka spike plan was canceled and Ravi was told not to write it. (owner: Ravi)
- notif-worker will be moved onto the Argo Rollouts canary pipeline like notify-gateway by Friday, October 16th. (owner: Ravi)
- The notify-gateway outbox design will use an outbox table in the same Postgres transaction and a separate relay deployment with its own alert, and the assignment to Joaquin was retained. (owner: Joaquin)
- The proposed staging broker-kill game day was left unassigned for now.

#### Open questions (structured)
- What specifically about the prefetch setting is keeping post-fix p99 at 3.4 seconds instead of the 2.1-second baseline? [open]
- Which architectural changes will prevent a repeat of the outage instead of only patching the consumer? [open]
- How did KEDA's scale-out to 40 replicas contribute to the incident as the identified fourth amplifier? [open]
- Should the approximately 2,300 never-published reminders be resent, given that some appointment dates may already have passed? [open]
- Is the revised approximately $5,200 monthly MSK estimate complete and within the $6,000 messaging ceiling once peak sizing and transfer costs are included? [open]
- Can the proposed six-week migration and soak be completed before the October 23 code freeze? [open]
- Is MSK the final architecture, or only a tentative direction pending the cost and sizing review? [open]
- How will replayable Kafka topics handle PHI deletion and retention under the internal policy that PHI cannot remain in a broker longer than 14 days? [open]
- Should the proposed retry chain of 30-second, 2-minute, and 10-minute topics plus a DLQ topic be adopted? [open]
- Which of the three broker options—RabbitMQ remediation, MSK Kafka, or SQS/SNS—will be selected after Grace reviews them? [open]
- What is the SQS/SNS implementation timeline, and can it be committed before the October 23 freeze? [open]
- Do any notification payloads exceed SQS's 256 KB limit, particularly the insurance-card reminder email with an inline image? [open]
- What idempotency mechanism will cover legitimate retries up to 72 hours without adding Redis's BAA and KMS overhead? [open]
- Whether SQS standard-queue unordered delivery is acceptable, or how FIFO throughput limits could be handled if ordering is required. [open]
- Whether moving oversized payloads to S3 is acceptable given that it would put PHI in another location. [open]
- Whether an appointment version number will be added to resolve the reschedule-cancel race. [open]
- If Kafka remains under consideration, where quiet-hours scheduling will live and how retry-topic partition blocking will be handled. [open]
- Is Twilio's 100-per-second limit hard on the short code or per account, and can it be raised for peak demand? [open]
- Will email workers eventually be split into a separate deployment from notif-worker, given SendGrid's higher limit? [open]
- Should notify-gateway enforce a per-clinic rate on giant uploads, even if the batch completes over about an hour rather than immediately? [open]
- Will SQS/SNS be selected for migration at the January 13 architecture review? [open]
- Under what changed conditions, if any, would Kafka return to the roadmap after peak? [open]
- What should happen to the 2,300 notifications that were never sent: resend them, contact the patients another way, or leave them unsent? [open]
- Do any of the insurance card email payloads exceed 256 kilobytes? [open]
- Does the quorum queue migration require a maintenance window, or can it be performed live with a shovel? [open]
- Should notify-gateway throttle large per-clinic uploads? [open]
- Should email and SMS use separate notif-worker deployments? [open]
- How will the outbox work meet the October 16th due date if Joaquin returns on October 21st? [open]

#### Risks (structured)
- [high] RETTRY_MODE=inline immediately requeued retryable provider failures with no backoff, creating a self-reinforcing retry storm.
- [high] Twilio rate limiting reached 38% of sends versus a 0.2% baseline, increasing retry pressure and contributing to an 11% notification failure rate.
- [high] Prefetch 200 put 200 unacked messages in memory per pod and contributed to 212 OOM kills, returning messages to the queue.
- [high] The missing x-dead-letter-exchange policy left repeatedly failing notifications.v2 messages requeued forever with no DLQ containment.
- [high] The image-only rollback left RETRY_MODE=inline active because the ConfigMap was managed in a separate chart, so the first rollback did not remove the causal setting.
- [high] notif-worker bypassed canary and deployed straight to all replicas, exposing the full worker fleet to the faulty release.
- [medium] KEDA scaled on queue depth from 8 to its 40-pod maximum by about 15:05, and the autoscaler was identified as a fourth amplifier.
- [medium] Post-fix p99 remained 3.4 seconds versus the 2.1-second baseline, leaving residual latency unresolved.
- [high] The incident produced 9,400 duplicate SMS messages, sometimes three or four for the same reminder, and the duplicates generated angry calls.
- [medium] Northgate's 240,000-reminder bulk upload was normally manageable with delayed retries but became a major load trigger when inline retries were enabled.
- [high] Inline retries with no backoff, prefetch 200, and no DLQ created a configuration capable of recreating the retry storm after a large batch.
- [high] Queue-depth autoscaling can expose Twilio to 240 attempted sends per second against a 100-per-second short-code limit when 40 pods run six concurrent sends each.
- [high] The lack of send-side idempotency allows an OOM kill after Twilio acceptance but before RabbitMQ acknowledgment to produce duplicate sends.
- [high] The Postgres-then-RabbitMQ dual write can leave rows permanently marked queued when publisher confirms time out, creating silently unsent notifications.
- [high] The October 23 code freeze leaves only about six weeks to implement and soak production-pipeline changes for peak season.
- [medium] Delivery capacity is constrained by a four-engineer team, Joaquin's parental leave until September 21, and Pam's realistic half-time platform allocation.
- [high] The migration has budget risk because the initial $1,900 estimate excluded data transfer while the revised estimate is about $5,200 against a $6,000 monthly ceiling.
- [high] Three m5.large brokers may not sustain 9 million messages per day plus Northgate-like bursts, and replication factor 3 adds cross-AZ write traffic.
- [medium] The proposed migration includes a consumer rewrite and two weeks of dual-running and soak, leaving little schedule slack before the freeze.
- [high] HIPAA constraints require BAA coverage, customer-managed KMS encryption at rest, no more than 14 days of PHI broker retention, and TLS in transit, while RabbitMQ inter-node TLS remains an open auditor finding.
- [high] The original MSK estimate omitted cross-AZ replication transfer, creating a material underestimation risk; the revised model is about $5,200 per month.
- [high] MSK dual-run would cost about $9,000 per month versus the $6,000 ceiling, while steady-state MSK plus required Postgres is already at the ceiling.
- [high] Kafka migration is estimated at 10 to 12 weeks and would miss the October 23 freeze, likely reaching mid-November open enrollment.
- [high] Kafka does not inherently prevent a retry storm, missing DLQ, or autoscaling into Twilio's rate limit, so the Tuesday failure modes could recur.
- [high] Kafka's lack of per-message delay and retry-topic partition blocking requires a new scheduler and partition pause/resume design.
- [medium] SQS standard queues are at-least-once and unordered, so per-clinic ordering is unavailable and consumer idempotency is mandatory; FIFO introduces throughput limits.
- [medium] SQS's 256 KB message limit may affect inline-image email payloads, and an S3-pointer workaround would place PHI in another location.
- [high] A Redis-based idempotency key would add an ElastiCache BAA and KMS review, while a 24-hour TTL is shorter than the up-to-72-hour legitimate retry window.
- [medium] Quorum queues consume more memory and disk, likely requiring larger RabbitMQ instances.
- [medium] Replaying 240,000 reminders after a five-hour outage could resend stale messages, so replay would not have addressed Tuesday's incident.
- [medium] The SQS queue would not resolve the reschedule-cancel race without an appointment-versioning change.
- [medium] m5.large brokers are considered undersized for peak traffic of about 9 million messages per day and Northgate-like bursts.
- [high] Scaling 40 notif-worker pods at six concurrent sends can exceed Twilio's 100-messages-per-second short-code limit and generate 429s.
- [high] Inline RETRY_MODE immediately requeued every Twilio 429 without backoff, creating a retry storm.
- [high] The DLQ was not actually enabled because of a Terraform hyphen-versus-dot policy-pattern typo and had been off since at least March 2024.
- [medium] Prefetch of 200 per pod lets slow sends hold many messages in the pod buffer and is contributing to elevated p99 latency.
- [medium] The existing 50,000-message queue-depth page fires during routine Monday clinic batches, causing alert fatigue and ignored pages.
- [medium] A legitimate 240,000-message Northgate batch can arrive in four minutes and take about 40 minutes to drain, making raw queue depth a misleading scaling signal.
- [medium] A Redis-based idempotency design would add ElastiCache BAA and KMS work, while a 24-hour TTL would not cover legitimate retries extending to 72 hours.
- [high] Kafka's $9,000 dual-run cost exceeds the $6,000 monthly ceiling, and its 10-to-12-week estimate misses the immovable October 23 freeze.

#### Follow-up draft
Subject: Follow-up: RabbitMQ peak-season remediation

Hi team,

Thanks for the thorough review of the notification incident and peak-season reliability options. We aligned that the Northgate 240,000-message batch was the trigger, RETRY_MODE=inline without backoff was the root cause, and high prefetch, the missing DLQ, and queue-depth autoscaling amplified the failure. For peak season, we chose RabbitMQ remediation over Kafka on MSK, including removal of inline retries, backoff and dead-lettering, prefetch of 30, a 16-replica cap with Twilio rate limiting, and a transactional outbox with a separate relay plus PostgreSQL delivery idempotency. The most important open question is whether to resend the approximately 2,300 notifications that were never published, given that some appointment dates may already have passed.

Best,

---

# Summary D

_(run1)_

### Title: Notification Outage Architecture Review

#### Overview
The team established that the outage was triggered by a 240,000-message Northgate batch and primarily caused by inline retries without backoff, with high prefetch, a missing DLQ policy, and autoscaling amplifying the incident. The team identified the Northgate batch, retry behavior, autoscaling, duplicate delivery, and dual-write losses as incident contributors, tentatively favored migrating to Amazon MSK before the October 23 freeze, and assigned Ravi a Kafka consumer spike plan due Monday. The team revised MSK costs and migration timing upward, identified RabbitMQ remediation as the only option clearly inside the freeze, and explored SQS while agreeing that outbox delivery and consumer idempotency are required regardless of broker. The team selected RabbitMQ for peak-season reliability work, rejected Kafka before peak, assigned concrete consumer and broker fixes, and scheduled an SQS decision for January 13. The team reassigned the RabbitMQ upgrade to Pam, changed the alert threshold to 180 seconds, cancelled the Kafka spike, and assigned follow-up work with several patient-safety and infrastructure questions still open. Key decisions: The incident will be characterized as a Northgate bulk batch trigger, inline retry with no backoff as the root cause, and prefetch 200 plus the missing DLQ as amplifiers.; The team agreed that the prefetch-related OOM kills were an amplifier and symptom rather than the primary cause.; Use approximately $5,200 per month as the MSK steady-state estimate, replacing the earlier $1,900 estimate..

#### Summary
- The meeting reviewed the notification outage and peak-season messaging architecture.
- The incident was classified as a bulk batch trigger with inline retries without backoff as the root cause, while high prefetch, the missing DLQ, and autoscaling were amplifiers; prefetch-related OOM kills were considered symptoms rather than the primary cause.
- RabbitMQ was selected for peak season with quorum queues, deleted inline retries, reduced prefetch, a capped autoscaler, and limited throughput; the impact was corrected to hundreds of affected clinics, tens of thousands of late notifications, and thousands of duplicates, while the outbox relay and Postgres delivery_attempts table were selected for message durability and idempotency.

#### What changed
- notif-worker 2.14.0 changed RabbitMQ prefetch from 10 to 200, leaving up to 200 unacknowledged messages in memory per pod.
- notif-worker 2.14.0 also introduced RETRY_MODE=inline through a ConfigMap change.
- The retry behavior changed from delayed backoff of 5 seconds, 30 seconds, and 2 minutes to immediate requeue with no backoff.
- The manual change at 16:52 switched RETRY_MODE back to delayed, after which the 429 rate began falling within about four minutes.
- The backlog peaked at 1.8 million messages at 16:40 and drained by 18:35, with the incident resolved at 19:12.
- After the fix, p99 end-to-end delivery latency improved to 3.4 seconds but remained above the 2.1-second pre-incident baseline.
- The incident trigger was identified as Northgate Medical Group uploading 240,000 reminders through notify-gateway at 14:00.
- The incident analysis added KEDA autoscaling as a fourth amplifier after it increased notif-worker from 8 to 40 pods.
- The team quantified the Twilio overload at 240 attempted sends per second against a 100-message-per-second short-code limit.
- The duplicate-delivery mechanism was traced primarily to OOM kills occurring after Twilio accepted a message but before RabbitMQ acknowledgment.
- The team identified approximately 2,300 incident-period notifications that remain queued in Postgres but were never published or sent.
- Peak-season planning established a projected increase from roughly 3 million to 9 million messages per day.
- The initial MSK estimate changed from approximately $1,900 to approximately $5,200 per month after accounting for larger brokers, storage, provisioned throughput, and cross-AZ replication traffic.
- The migration timeline estimate for Kafka increased from six weeks to 10–12 weeks for two people, with even an eight-week estimate missing the freeze.
- The reported clinic impact was updated from 312 clinics to 420 clinics based on delivery-log matching rather than customer calls.
- SQS was added as a third architecture option alongside retaining RabbitMQ and migrating to MSK.
- The SQS estimate is approximately $1,100 per month normally and up to about $2,500 in 3x-volume peak months.
- RabbitMQ remediation is estimated at approximately three weeks, including two weeks for consumer fixes and about one week for the upgrade and quorum-queue migration.
- The RabbitMQ option is estimated at approximately $4,300 per month after moving the three-node cluster from m5.large to m5.xlarge.
- The team identified an outbox pattern for notify-gateway to prevent message loss between the database write and broker publish.
- The incident scope was corrected from 312 calling clinics to 420 clinics identified in delivery logs and confirmed by customer success.
- The incident root cause was identified as RETRY_MODE inline causing immediate requeue of every Twilio 429 without backoff, while the prefetch change was only an amplifier.
- The team moved from an initial Kafka convergence toward RabbitMQ for peak season after incorporating actual cost, timeline, root-cause, and operational-capability constraints.
- The intended DLQ state changed from assumed enabled to an explicit Terraform fix because the queue had never actually been enabled.
- The planned prefetch value changed from 200 to 30 to reduce buffering-related latency.
- Ownership of the RabbitMQ upgrade and quorum queue migration moved from Ravi to Pam.
- Ownership of the notification backlog runbook moved from Pam to Me.
- The age-alert threshold changed from 120 seconds to 180 seconds for 5 minutes to avoid paging during the nightly batch.
- The autoscaling plan now includes reducing maximum replicas from 40 to 16 and scaling on oldest message age rather than queue depth.
- The planned Kafka spike was cancelled in favor of the SQS/SNS prototype.
- The SQS/SNS prototype was defined as a five-working-day SMS-path experiment beginning September 28th with an October 2nd readout.
- The team added an outbox-pattern implementation for notify-gateway with a separate relay deployment and alert.

#### Decisions
- The incident was classified as a Northgate bulk batch trigger, inline retry without backoff as the root cause, and prefetch 200 plus the missing DLQ as amplifiers.
- The prefetch-related OOM kills were recorded as an amplifier and symptom rather than the root cause.
- The team tentatively converged on migrating the notification pipeline to Kafka on Amazon MSK before the October 23 code freeze, but the direction was explicitly left open to pushback.
- The team accepted the approximately $5,200 monthly MSK estimate as the revised planning number.
- The inline retry mode will be removed completely instead of being left in the codebase disabled by default.
- RabbitMQ remediation will use quorum queues and RabbitMQ 3.13.7 rather than continuing with classic mirrored queues on 3.11.9.
- The notify-gateway relay will be deployed independently with separate alerting.
- Outbox rows and notification rows will be written in one Postgres transaction, with publishing and publication confirmation handled asynchronously by the relay.
- The relay is treated as an independently deployed service with an independent alert.
- Postgres is the selected idempotency store, using notification ID and channel as the uniqueness key.
- The notif-worker cap is 16 replicas at six concurrent sends each, yielding 96 sends per second.
- RabbitMQ option one is the selected peak-season path, including version upgrade and reliability fixes.
- SQS evaluation is deferred to a data-backed decision at the January 13 architecture review.
- Pam owns the RabbitMQ 3.13.7 upgrade and notifications.v2 quorum queue migration by Friday, October 9th.
- Me owns the notification backlog runbook by Thursday, September 24th.
- The oldest-message-age alert threshold is 180 seconds for 5 minutes, while the other alert rules stay as specified.
- The Kafka spike plan will not be written.
- The outbox task remains assigned to Joaquin for his return from leave.

#### Action items
- The team needs to continue examining the autoscaler as a fourth amplifier in the incident.
- Ravi will prepare a two-week plan for prototyping notif-worker against MSK with retry topics by Monday.
- Send the data team's actual MSK bill to substantiate the revised cost model.
- Implement exponential retry backoff with five maximum attempts followed by dead lettering.
- Delete the inline retry implementation so it cannot be re-enabled accidentally.
- Upgrade RabbitMQ and migrate notifications.v2 to quorum queues with broker-level delivery limits.
- Build the outbox relay as an independent deployment and use Postgres row-locking support to run two relays.
- Prototype SQS before committing to an October 23 delivery target.
- Sam must implement the retry and rate-limiting changes by September 25.
- Sam must repair the DLQ Terraform policy pattern by September 14.
- Sam must deploy prefetch 30 separately by September 15.
- Sam must complete the Postgres idempotency table by October 7.
- Ravi must complete the RabbitMQ 3.13.7 and quorum queue migration by October 9.
- Sam will implement idempotency with a delivery_attempts table and a unique notification-ID/channel index by October 7th.
- Pam will implement the RabbitMQ upgrade and quorum queue migration by October 9th.
- Me will write the backlog runbook with the ConfigMap chart included in rollback instructions by September 24th.
- Pam will implement the alerting and age-based autoscaling changes by September 18th, with the replica maximum reduction done today.
- Pam will produce the 12-month cost estimate by September 30th.
- Ravi will run the SQS/SNS prototype from September 28th through the October 2nd readout.
- Ravi will move notif-worker to the Argo Rollouts canary pipeline by October 16th.
- Joaquin will implement the notify-gateway outbox pattern by October 16th after returning on the 21st.
- Me will write the ADR by September 15th and send the notes and ADR draft in the channel.
- Grace will send the incident note to 420 clinics through customer success by September 14th.

#### Open questions
- The effect of scaling notif-worker from 8 to 40 pods on the retry storm has not yet been explained.
- The reason p99 latency remains at 3.4 seconds, possibly related to prefetch, was deferred for later discussion.
- The team has not decided whether to resend the approximately 2,300 notifications that were never published.
- The full MSK cost, including data transfer and the broker capacity required for peak bursts, remains unresolved.
- The team still needs to validate whether a six-week Kafka migration is feasible before the October 23 freeze.
- Whether SQS can meet the October 23 freeze remains unknown.
- Whether any email payloads exceed SQS's 256 KB limit has not been checked.
- The final broker choice remains pending until Grace reviews the options.
- The consumer idempotency design remains unresolved because Redis is not currently in the notification path and a 24-hour TTL is too short.
- The team still needs to determine how to handle larger payloads without spreading PHI into additional storage locations.
- Whether Twilio can raise the short-code throughput limit above 100 messages per second remains unresolved.
- Whether notify-gateway should apply per-clinic throttling to large uploads remains on the maybe list without an owner.
- The exact SQS and SNS migration choice remains open until the January 13 architecture review.
- The team has not decided whether to resend, replace, or leave the 2,300 unsent notifications.
- The team does not know whether Twilio's 100-per-second limit is per short code or account or whether it can be raised.
- The SQS prototype is expected to investigate whether insurance-card email payloads exceed 256 KB, but the answer is currently unknown.
- The team has not determined whether quorum queue migration requires a maintenance window or can be performed live with a shovel.
- Throttling large per-clinic uploads at notify-gateway has no owner or decision and requires product input.
- Separating email and SMS into different notif-worker deployments remains undecided.

#### Risks / blockers
- The missing DLQ policy allowed repeatedly failing messages to requeue forever, and the configured DLQ had contained zero messages since March 2024.
- The rollback procedure could not restore the retry behavior because the relevant ConfigMap was managed in a separate chart.
- notif-worker lacked canary deployment protection and went directly to all replicas.
- The incident produced a 47-minute peak p99 latency, a 38% Twilio 429 rate, and an 11% overall notification failure rate.
- The current architecture can turn a single retry configuration change into a pipeline outage because it lacks backoff, DLQ protection, safe deployment separation, and idempotency.
- Resending stale appointment reminders could cause patients to appear for appointments that no longer exist.
- A Kafka migration must preserve the 14-day PHI retention limit while providing replay capability.
- The revised MSK estimate is close to the $6,000 monthly messaging budget ceiling and excludes no stated additional costs beyond the modeled components.
- MSK exceeds the budget during dual-run and leaves steady-state costs close to the $6,000 ceiling even before additional Postgres capacity.
- Kafka migration would miss the October 23 freeze and overlap with mid-November open enrollment.
- Kafka does not by itself address the retry storm, missing DLQ, or Twilio rate-limit problems from Tuesday's incident.
- SQS standard queues lack ordering and provide at-least-once delivery, making consumer idempotency mandatory.
- Using S3 for oversized SQS payloads could create an additional PHI storage location and trigger further privacy concerns.
- A Redis idempotency key with a 24-hour TTL would allow duplicates after legitimate retries occurring up to 72 hours later.
- The October 23 freeze is fixed, and the team must complete reliability changes before November 1 open enrollment.
- Kafka cannot fit the current $6,000 monthly ceiling because its dual-run estimate is $9,000 and its timeline is 10 to 12 weeks.
- The prior queue-depth alert generated recurring false alarms during legitimate Monday clinic uploads and had become ignored.
- The incident's retry storm was amplified by 40 pods operating against Twilio's 100-per-second limit.
- The unsent-notification decision carries patient-safety risk, and stale reminders are a specific concern.
- An alert threshold below the nightly batch's normal 150-second age would create alert fatigue and risk ignored pages.
- Unknown Twilio throughput limits could constrain peak notification volume.
- Payloads larger than 256 KB could block or complicate the proposed SQS path.
- Uncertainty about migration downtime creates a scheduling and availability risk for the quorum queue migration.
- Pam's workload was already full enough that taking the RabbitMQ work required removing the runbook assignment.

#### Notes
- The outage began after notif-worker 2.14.0 was deployed at 14:02, the first queue-depth alert fired at 14:19, and the incident was escalated to SEV-1 at 15:10.
- The rollback to notif-worker 2.13.2 at 14:45 did not improve the incident because the inline retry configuration remained active.
- A 240,000-reminder Northgate Medical Group flu-clinic batch was uploaded through notify-gateway at 14:00.
- notif-worker is the RabbitMQ consumer that sends through Twilio and SendGrid, while notify-gateway accepts clinic requests and publishes jobs onto the queue.
- KEDA's queue-depth scaling policy has a maximum of 40 notif-worker replicas.
- The proposed Kafka design uses a main notifications topic, 30-second, 2-minute, and 10-minute retry topics, plus a DLQ topic.
- Kafka was favored because it would support replay from consumer offsets, disk-backed lag, and per-clinic ordering through clinic-ID partitioning.
- The proposed MSK deployment was initially described as Kafka 3.6 on three kafka.m5.large brokers across three availability zones.
- The revised capacity recommendation was three m5.xlarge brokers with storage, provisioned throughput, and cross-AZ replication traffic included.
- The production pipeline must be completed and soaked before the October 23 code freeze, approximately six weeks from the meeting.
- Joaquin is on parental leave until September 21, and Pam is shared across three teams with about half-time platform availability.
- The MSK estimate includes three m5.xlarge brokers, storage, provisioned throughput, and cross-AZ replication traffic caused by replication factor three.
- The three options are retaining RabbitMQ with fixes, moving to MSK, or using SQS with SNS fan-out.
- SQS provides a redrive policy, visibility timeout, BAA coverage, and support for customer-managed KMS keys, but does not provide replay after deletion.
- The reschedule-cancel race is not solved by changing brokers and would require an appointment version number.
- Quorum queues provide a delivery limit that can dead-letter messages after repeated redeliveries even when a buggy consumer keeps nacking with requeue.
- The relay will publish at least once, so duplicate delivery remains possible and consumer idempotency is required.
- The updated incident count is based on delivery logs matched to clinic accounts, whereas the earlier 312 count only included clinics that called in.
- The incident lasted 4 hours and 53 minutes, peaked at 1.8 million queued messages, and raised p99 delivery latency from 2.1 seconds to 47 minutes.
- Northgate Medical Group triggered the incident with a 240,000-reminder batch at 14:00.
- The proposed alert thresholds are oldest notification message age above 120 seconds for five minutes, Twilio 429 rate above 2% for five minutes, a ticket for any DLQ messages, and a page above 500 DLQ messages.
- RabbitMQ option one was estimated at approximately $4,300 per month and about three weeks, while Kafka was estimated at $5,200 steady state and $9,000 during dual-run.
- The current 2.14.1 deployment removed RETRY_MODE and raised pod memory limits but retained prefetch 200.
- The relay can run two instances using PostgreSQL 14 SELECT FOR UPDATE SKIP LOCKED.
- The alert set includes paging for Twilio 429 rates above 2% for 5 minutes, ticketing for any DLQ message, and paging when the DLQ exceeds 500 messages.
- The runbook must explain how to check RETRY_MODE-style configuration drift, inspect the DLQ, cap replicas manually, and pause Northgate-style batches.
- The SQS/SNS prototype includes a redrive policy, visibility-timeout backoff, and a customer-managed KMS key.
- Pam has prior experience with the RabbitMQ upgrade from 3.8 to 3.11 and said she performed most of it.
- The team considered a staging game day involving a broker failure during a large batch, but left it for a future point.

#### Action items (structured)
- Ravi: Write a two-week spike plan for a Kafka consumer prototype in notif-worker reading from MSK with retry topics. (deadline: Monday)
- Speaker 2: Send the data team's MSK bill to support the approximately $5,200 monthly estimate.
- Speaker 3: Implement consumer retry handling with exponential delays of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes, capped at five attempts before dead lettering. [inferred]
- Speaker 3: Complete the RabbitMQ 3.13.7 upgrade and migrate notifications.v2 to quorum queues with a delivery limit of 5. (deadline: Friday, October 9th)
- Speaker 1: Build the notify-gateway outbox and relay, including retrying failed publishes and marking rows published after broker confirmation. [inferred]
- Speaker 2: Evaluate SQS with a prototype before committing to delivery before the October 23 freeze. (deadline: Before October 23) [inferred]
- Check whether the insurance-card reminder payloads exceed SQS's 256 KB message limit. [inferred]
- October 23 freeze [inferred]
- Joaquin returns on the 21st [inferred]
- Potential SQS delivery before October 23 requires a prototype first [inferred]
- Sam: Sam will remove inline retry mode, implement exponential backoff of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes with a maximum of five attempts before dead-lettering, and add a Twilio token-bucket limiter at 100 messages per (deadline: Friday, September 25th)
- Sam: Sam will fix the Terraform dead-letter queue policy pattern so notifications.v2 actually dead-letters. (deadline: Monday, September 14th)
- Sam: Sam will deploy the prefetch reduction to 30 separately from other changes. (deadline: Tuesday, September 15th)
- Sam: Implement idempotency using a delivery_attempts table with a unique index on notification ID and channel. (deadline: Wednesday, October 7th)
- Ravi: Ravi will upgrade RabbitMQ from 3.11.9 to 3.13.7 and migrate notifications.v2 to quorum queues with a delivery limit of 5. (deadline: Friday, October 9th)
- The team will produce a timeboxed SQS and SNS prototype before the January 13 architecture review. (deadline: Before the January 13 architecture review)
- Sam: Fix the DLQ Terraform policy pattern (deadline: Monday, September 14th) [inferred]
- Sam: Deploy prefetch 30 separately (deadline: Tuesday, September 15th) [inferred]
- Sam: Implement retry backoff and Twilio rate limiting (deadline: Friday, September 25th) [inferred]
- Sam: Implement Postgres delivery idempotency (deadline: Wednesday, October 7th) [inferred]
- Ravi: Complete RabbitMQ upgrade and quorum queue migration (deadline: Friday, October 9th) [inferred]
- Make the SQS migration decision (deadline: January 13th architecture review) [inferred]
- Me: Write the notification backlog runbook covering RETRY_MODE-style config drift, DLQ checks, manual replica caps, Northgate-style batch pauses, and rollback of the ConfigMap chart. (deadline: Thursday, September 24th)
- Pam: Implement the agreed alerts for notifications.v2 age, Twilio 429 rate, and DLQ messages or volume using the updated 180-second age threshold. (deadline: Friday, September 18th)
- Pam: Change the autoscaling maximum from 40 replicas to 16 replicas. (deadline: Today)
- Pam: Change autoscaling to use oldest message age instead of queue depth. (deadline: Friday, September 18th)
- Pam: Produce a 12-month cost estimate for all three options, including peak months and SQS dual-run costs, for Grace's budget planning. (deadline: Wednesday, September 30th)
- Ravi: Run the five-working-day SQS/SNS prototype for the notif-worker SMS path, including SQS redrive, visibility-timeout backoff, a customer-managed KMS key, and checks of the largest payloads against 256 KB. (deadline: Start Monday, September 28th; readout Friday, October 2nd)
- Ravi: Move notif-worker onto the Argo Rollouts canary pipeline. (deadline: Friday, October 16th)
- Joaquin: Implement the notify-gateway outbox table in the same Postgres transaction and deploy the relay separately with its own alert. (deadline: Friday, October 16th; work begins when he returns on the 21st)
- Me: Write the architecture decision record for the agreed approach. (deadline: Tuesday, September 15th)
- Grace: Send the incident note to 420 clinics through customer success. (deadline: Monday, September 14th)
- Me: Send the meeting notes and ADR draft in the channel.
- Grace: Incident note to 420 clinics (deadline: Monday, September 14th) [inferred]
- Me: Architecture decision record (deadline: Tuesday, September 15th) [inferred]
- Pam: Alerts and age-based autoscaling (deadline: Friday, September 18th) [inferred]
- Me: Notification backlog runbook (deadline: Thursday, September 24th) [inferred]
- Ravi: SQS/SNS prototype start (deadline: Monday, September 28th) [inferred]
- Pam: 12-month cost estimate (deadline: Wednesday, September 30th) [inferred]
- Ravi: SQS/SNS prototype readout (deadline: Friday, October 2nd) [inferred]

#### Decisions (structured)
- The incident will be characterized as a Northgate bulk batch trigger, inline retry with no backoff as the root cause, and prefetch 200 plus the missing DLQ as amplifiers.
- The team agreed that the prefetch-related OOM kills were an amplifier and symptom rather than the primary cause.
- Use approximately $5,200 per month as the MSK steady-state estimate, replacing the earlier $1,900 estimate. (owner: Ravi)
- The incident impact count was corrected from 312 to 420 affected clinics, while the patient impact remains approximately 61,000 late notifications and 9,400 duplicates.
- The inline retry mode will be deleted rather than merely disabled. (owner: Speaker 3)
- The RabbitMQ remediation will include upgrading from 3.11.9 to 3.13.7 and migrating notifications.v2 from classic mirrored queues to quorum queues. (owner: Speaker 3)
- The notification outbox relay will run as its own deployment with its own alerting rather than as an in-process goroutine or worker thread. (owner: Speaker 2)
- The team will use the outbox pattern so notify-gateway writes the notification and outbox rows in the same Postgres transaction, with a relay publishing and retrying failed publishes.
- The relay will run as its own deployment with its own alert rather than inside notify-gateway or as a worker thread.
- Idempotency will use a Postgres delivery_attempts table with a unique index on notification ID and channel, not Redis.
- The notif-worker autoscaler maximum will be 16 pods, with six concurrent sends per pod, keeping throughput at 96 messages per second below Twilio's 100-per-second limit.
- Autoscaling will use oldest message age and consumer utilization rather than queue depth.
- The prefetch setting will be reduced from 200 to 30 in a separate deployment.
- The team will stay on RabbitMQ for peak season and implement the upgrade, quorum queues, consumer fixes, dead-letter queue, and backoff work.
- Kafka on MSK was rejected for the peak-season solution and is not intended for the post-peak roadmap unless circumstances change.
- SQS and SNS will receive a timeboxed prototype, with the migration decision scheduled for the January 13 architecture review.
- Pam will own the RabbitMQ upgrade from 3.11.9 to 3.13.7 and the notifications.v2 migration to quorum queues with a delivery limit of 5, replacing Ravi as owner. (owner: Pam)
- The notification backlog runbook was reassigned from Pam to Me, with a September 24 deadline. (owner: Me)
- The oldest-message-age alert threshold was changed from 120 seconds to 180 seconds for 5 minutes; all other alert requirements remain unchanged. (owner: Pam)
- The Kafka spike plan was cancelled and will not be written. (owner: Ravi)
- The outbox-pattern work will remain assigned to Joaquin despite his return from leave, because he requested a self-contained task. (owner: Joaquin)
- A game day to kill the broker on staging during a large batch was deferred and was not assigned in this meeting.

#### Open questions (structured)
- The team still needs to determine the full effect of KEDA scaling from 8 to 40 pods during the retry storm. [open]
- The team has not yet established why the post-fix p99 delivery latency remains at 3.4 seconds instead of the 2.1-second baseline. [open]
- Whether and how to resend the approximately 2,300 notifications that were written to Postgres but never published remains unresolved. [open]
- The MSK cost estimate needs validation because the initial estimate excluded data transfer and may use undersized brokers. [open]
- The appropriate MSK broker size and complete monthly cost for peak traffic are not yet finalized. [open]
- The team still needs to determine whether the proposed Kafka migration can be completed and soaked within the six-week window before the October 23 code freeze. [open]
- Whether any insurance-card reminder payloads exceed SQS's 256 KB message-size limit remains unknown. [open]
- Whether SQS can be prototyped and delivered before the October 23 freeze remains unresolved. [open]
- The team has not yet selected among RabbitMQ, MSK, and SQS because Grace has not heard the options. [open]
- The final idempotency mechanism is unresolved after the Redis-per-notification proposal was challenged. [open]
- How quiet-hours behavior will be implemented in SQS or another broker remains to be finalized. [open]
- Can Twilio increase the short-code throughput above 100 messages per second for peak season, or is 100 the hard limit? [open]
- Should notify-gateway throttle very large uploads per clinic, such as Northgate's 240,000 reminders in four minutes? [open]
- What will the SQS and SNS prototype show about the suitability and migration path of that option? [open]
- Should the 2,300 notifications that were never sent be resent, replaced with another form of patient contact, or left unresolved? [open]
- Is Twilio's 100-per-second limit specific to the short code or the account, and can it be raised for peak demand? [open]
- Do any insurance-card email payloads exceed the 256 KB limit? [open]
- Does the quorum queue migration require a maintenance window, or can it be performed live with a shovel? [open]
- Should large per-clinic uploads be throttled at notify-gateway? [open]
- Should email and SMS use separate notif-worker deployments? [open]

#### Risks (structured)
- [high] Inline retries immediately requeued every retryable provider failure, creating a retry storm that drove Twilio 429 responses to 38% and caused further retries.
- [high] The notifications.v2 queue had no functioning dead-letter policy because the Terraform pattern used a hyphen while the queue name used a dot, so failed messages were requeued indefinitely.
- [high] The prefetch increase from 10 to 200 caused pods to hold more unacknowledged messages and contributed to 212 OOM kills between 14:20 and 16:50.
- [high] The rollback was ineffective because it reverted the image but did not revert the separately managed ConfigMap, leaving RETRY_MODE set to inline.
- [high] notif-worker deploys directly to all replicas without the Argo Rollouts canary process used by notify-gateway and the scheduler.
- [medium] KEDA scaled notif-worker from 8 to the maximum of 40 pods as queue depth increased, potentially amplifying the provider pressure during the retry storm.
- [high] The incident affected approximately 312 clinics, caused late reminders for about 61,000 patients, and produced duplicate SMS messages for 9,400 patients.
- [high] The Northgate Medical Group batch sent 240,000 reminders at once and triggered the incident when combined with inline retries.
- [high] Inline retries without backoff, a prefetch of 200, and no DLQ amplified the incident.
- [high] KEDA scaled notif-worker from 8 to 40 pods, producing up to 240 attempted sends per second against a 100-message-per-second Twilio limit.
- [high] OOM kills after Twilio acceptance but before RabbitMQ acknowledgment caused redelivery and approximately 9,400 duplicates because there is no send-side idempotency check.
- [high] Publisher-confirm timeouts during the 16:00–16:45 pressure window left approximately 2,300 Postgres rows permanently queued without corresponding RabbitMQ messages.
- [high] The six-week migration timeline is constrained by the October 23 code freeze, a four-engineer team, Joaquin's parental leave until September 21, and Pam's roughly half-time platform allocation.
- [high] Messaging spend has a $6,000-per-month ceiling, and the revised MSK estimate of approximately $5,200 leaves little room for additional costs.
- [high] Notification payloads contain PHI and must meet AWS BAA coverage, customer-managed KMS encryption, and a maximum 14-day broker residence policy.
- [medium] RabbitMQ inter-node traffic still lacks TLS, and the auditor remediation is not due until the end of the year.
- [high] MSK would cost approximately $9,000 per month during dual-run, exceeding the $6,000 ceiling by 50 percent.
- [high] MSK migration is estimated at 10 to 12 weeks for two people and would extend past the October 23 freeze into mid-November open enrollment.
- [high] Kafka does not inherently prevent retry storms, missing DLQs, or autoscaling into Twilio's rate limit.
- [medium] SQS standard queues are at-least-once and unordered, requiring idempotency and providing no per-clinic ordering.
- [high] Moving oversized SQS payloads to S3 could increase PHI exposure by putting sensitive data in another location.
- [high] A 24-hour Redis idempotency TTL is insufficient because retries can legitimately occur up to 72 hours after the first attempt.
- [medium] Adding Redis to the notification path would require another BAA review and KMS configuration.
- [medium] Replaying 240,000 reminders after a five-hour outage could resend stale notifications because many would no longer be current.
- [high] Twilio's 100-messages-per-second limit can be exceeded if autoscaling or concurrency is increased without an internal rate limiter.
- [medium] The existing 24-hour Redis TTL would not cover retries delayed by backoff and quiet hours, which can extend to 72 hours.
- [high] The dead-letter queue was unintentionally disabled since at least March 2024 because of a hyphen-versus-dot Terraform policy pattern typo.
- [high] The October 23 freeze leaves limited time to complete peak-season reliability work before open enrollment starts November 1.
- [high] The messaging budget ceiling is $6,000 per month, making Kafka's estimated $9,000 dual-run month unaffordable before the next fiscal year.
- [medium] High prefetch of 200 messages per pod allows slow sends to hold many messages in a pod buffer and contributes to elevated p99 latency.
- [high] The Tuesday incident affected 420 clinics, caused late reminders for about 61,000 patients, duplicates for 9,400 patients, and left about 2,300 notifications unsent.
- [high] Resending or otherwise handling the 2,300 unsent notifications is a patient-safety issue, and stale reminders are a concern.
- [medium] A 120-second age alert would have caused nightly paging during the 02:00 next-day appointment batch because message age routinely reaches about 150 seconds.
- [medium] The actual Twilio throughput limit and whether it can be increased for peak demand are unknown.
- [medium] The SQS prototype may find insurance-card email payloads above the 256 KB limit.
- [medium] The quorum queue migration's need for downtime and the viability of a live shovel migration are unresolved.
- [medium] Pam's reassignment to the RabbitMQ upgrade required removing the runbook from her workload because she was already assigned alerts, autoscaling, and the cost estimate.

#### Follow-up draft
Subject: Follow-up: notification outage and peak-season RabbitMQ plan

Hi team,

Thanks for the thorough review of the notification outage and peak-season messaging architecture. We aligned that the 240,000-message Northgate batch exposed inline retries without backoff as the root cause, with high prefetch, the missing DLQ, and autoscaling as amplifiers, and selected RabbitMQ remediation with quorum queues, reduced prefetch, capped throughput, an outbox relay, and Postgres-based idempotency for peak season. The main open question is how we should handle the approximately 2,300 notifications that were written to Postgres but never published, given the risk of sending stale reminders.

Best,

---

# Summary E

_(run1)_

### Title: Notification Outage Post-Incident Review

#### Overview
The team opened a mini post-incident review of the Tuesday September 8 notification outage, walking the timeline from the 14:02 notif-worker 2.14.0 deploy to the 19:12 resolution, and refined the root cause to the RETRY_MODE=inline ConfigMap change (not prefetch/OOM), with the Northgate bulk batch as trigger and prefetch-200 and missing DLQ as amplifiers. Team completed the incident review — trigger was the Northgate batch, root causes were inline retry with no backoff plus the autoscaler, and roughly 2,300 notifications were silently lost — then Ravi pitched migrating the notification pipeline to Kafka on MSK before the October 23rd code freeze, with Pam challenging his $1,900/month cost estimate as more like $5,200/month. Cost model for MSK revised upward from $1,900 to $5,200/month, SOA migration timeline estimated at 10-12 weeks (past the Oct 23 freeze), updated incident volume revised to 420 clinics, and three broker options (RabbitMQ fix, MSK, SQS/SNS) laid out with costs and timelines. The team finalized idempotency via a Postgres unique index, autoscaling caps and alerting thresholds, then Grace decided to stay on RabbitMQ with the fixes, reject Kafka, and timebox an SQS prototype for a January 13th decision. The final chunk of the meeting closed out the task list — reassigning the RabbitMQ upgrade from Ravi to Pam, adjusting the page threshold for message age, confirming all owners and dates, and enumerating six unresolved open questions. Key decisions: Agreed on the refined root cause: the RETRY_MODE=inline config shipped in 2.14.0 turned retryable provider errors into immediate requeues with no backoff, causing the retry storm and 429 spike.; Agreed the OOM kills from prefetch 200 were an amplifier/symptom, not the cause.; Agreed framing: trigger is the Northgate batch, root cause is inline retry with no backoff, amplifiers are prefetch 200 and no DLQ..

#### Summary
- The team opened a mini post-incident review of the Tuesday September 8 notification outage, walking the timeline from the 14:02 notif-worker 2.14.0 deploy to the 19:12 resolution, and refined the root cause to the RETRY_MODE=inline ConfigMa
- Agreed on the refined root cause: the RETRY_MODE=inline config shipped in 2.14.0 turned retryable provider errors into immediate requeues with no backoff, causing the retry storm and 429 spike.
- Agreed the OOM kills from prefetch 200 were an amplifier/symptom, not the cause.
- The dead letter queue was never enabled on notifications.v2 due to a Terraform policy pattern mismatch (notifications-v2 with hyphen vs notifications.v2 with dot), so failed messages requeued forever and there have been zero DLQ messages si

#### What changed
- The team refined the outage root cause from the earlier prefetch/OOM theory to the RETRY_MODE=inline retry-storm
- The 16:52 change that stopped the bleeding was identified as Sam flipping RETRY_MODE back to delayed by hand, after which the 429 rate began falling within ~4 minutes
- The team learned the DLQ was never actually enabled on notifications.v2 despite existing in Terraform and the architecture diagram
- It was established that the 14:45 rollback to 2.13.2 had no effect because the ConfigMap was not rolled back
- The incident review concluded the trigger was Northgate Medical Group's 14:00 bulk upload of 240,000 flu clinic reminders through notify-gateway.
- KEDA scaled notif-worker from 8 to 40 pods by about 15:05 as queue depth climbed, raising concurrency five-fold.
- A new loss mode was added to the review: ~2,300 Postgres notifications left in 'queued' status that were never published to the broker during the 16:00–16:45 confirm-timeout window.
- The main duplicate source was identified as OOM kills between Twilio acceptance and RabbitMQ ack, not the requeue — 9,400 duplicates total.
- The meeting moved from incident review into architecture discussion, framed by peak season: Open enrollment starts November 1st and last year volume tripled from November through mid December.
- Current volume is ~3 million messages/day (≈90 million/month) and peak at 3x would be ~9 million/day.
- Ravi presented a full Kafka/MSK position: replay via consumer offset reset, natural backpressure via lag, and per-clinic ordering by partitioning on clinic ID to fix the reschedule-then-cancel race.
- Ravi proposed the Uber-style retry topic pattern: notifications topic plus retry.30s, retry.2m, retry.10m and a DLQ topic.
- The team tentatively converged on MSK as the direction, driven by the replay argument, the auditor TLS finding, and cost.
- Pam contradicted Ravi's $1,900/month MSK estimate using the data team's actual bill as the model, arriving at ~$5,200/month with m5.xlarge brokers and cross-AZ replication included.
- The direction was explicitly recorded as 'in pencil' rather than pen, pending Pam's pushback.
- Sam acknowledged the RETRY_MODE change was his and that it should have been split into its own deploy.
- MSK cost estimate was revised upward from Ravi's $1,900 to about $5,200/month based on the data team's actual bill.
- Broker sizing moved from kafka.m5.large to three kafka.m5.xlarge brokers, since m5.large was what the data team upgraded off within a month.
- Migration timeline for the consumer rewrite was set at 10-12 weeks for two people, past the freeze and into mid-November open enrollment.
- Affected-clinic count in the incident was corrected from 312 to 420 after customer success matched delivery logs to clinic accounts.
- Three broker options were formally laid out: fix RabbitMQ, Kafka on MSK, or managed SQS with SNS fan-out.
- RabbitMQ option cost moved from $3,800 to ~$4,300/month due to bigger m5.xlarge instances needed for quorum queues.
- RabbitMQ fix was estimated at ~3 weeks end-to-end (2 weeks consumer fixes, 1 week prep for 3.13 upgrade and quorum queue migration).
- Cost ceilings were summarized: option one ~$4,300 steady, option two $5,200 steady / $9,000 dual-run, option three ~$1,100 steady / ~$2,500 peak.
- Idempotency design shifted from a Redis SETNX key per notification ID to a Postgres unique index on notification ID plus channel.
- Proposed max replicas for notif-worker was corrected from 20 to 16 after realizing 20×6=120/sec exceeded Twilio's 100/sec limit.
- Autoscaling metric changed from queue depth to oldest message age plus consumer utilization.
- Alerting moved away from paging on queue depth 50,000 to oldest-message-age and 429-rate paging with DLQ ticket/page thresholds.
- Incident affected-clinic count was revised from 312 to 420 using delivery logs, confirmed by customer success.
- Ravi reversed on Kafka, conceding the retry storm was a consumer design problem Kafka does not fix and the timeline/cost do not work before peak.
- Grace officially decided to stay on RabbitMQ for peak and rejected Kafka, with SQS evaluation moved to after peak.
- The RabbitMQ 3.13.7 upgrade and quorum queue migration moved from Ravi to Pam to keep Ravi focused on the SQS prototype.
- Ownership of the notification backlog runbook shifted from Pam to the meeting lead, freeing Pam's plate for the alerts, autoscaling, and cost work.
- The page threshold for oldest message age was corrected from 120 seconds to 180 seconds to clear the nightly 02:00 batch that routinely hits ~150 seconds.
- The Kafka spike plan Ravi was going to write Monday was cancelled outright.
- The outbox pattern work in notify-gateway was assigned to Joaquin for his return from leave on the 21st.
- A game day (killing the broker on staging during a big batch) was floated and explicitly deferred rather than assigned.

#### Decisions
- Agreed the true root cause is RETRY_MODE=inline with immediate requeue and no backoff, not the prefetch or OOM kills
- Agreed the Northgate 240,000-reminder batch was the trigger that pushed usage over Twilio's limit
- Agreed prefetch 200 and the missing DLQ are amplifiers rather than causes
- Tentative direction set (framed as 'in pencil'): migrate the notification pipeline to Kafka on MSK before the October 23rd code freeze.
- Resending the ~2,300 unsent notifications was deliberately deferred rather than decided.
- The incident was explicitly declared blameless, with the single config flag capable of taking down the pipeline framed as a system problem.
- Ravi agreed to accept the $5,200/month MSK figure.
- The inline retry mode will be deleted entirely so nobody can re-enable it.
- The outbox relay will run as its own separate deployment with its own alert.
- The broker choice was deferred until Grace can hear the options.
- Ravi conceded the retry storm is a consumer design problem, not a broker problem.
- Use Postgres unique index (notification ID + channel) for idempotency; everyone agreed, no Redis.
- Cap notif-worker at 16 max replicas and add a per-provider token bucket rate limiter at 100/sec for Twilio.
- Scale on oldest message age and consumer utilization, not depth.
- Adopt the new alerting thresholds (oldest age >120s/5min, 429 >2%/5min, DLQ ticket any, DLQ page >500).
- Drop prefetch from 200 to 30 in a separate deploy.
- Not migrating to Kafka; reasons are cost over ceiling, timeline missing freeze, root cause not addressed, and lack of Kafka ops experience.
- Stay on RabbitMQ and execute option one for peak season.
- SQS prototype now; SQS migration decision to be made at the January 13th architecture review.
- Sam owns idempotency: a delivery_attempts table with a unique index on notification ID and channel, by Wednesday, October 7th.
- Pam takes the RabbitMQ 3.13.7 upgrade and quorum queue migration (delivery limit 5) instead of Ravi, same date of Friday, October 9th.
- Alert thresholds confirmed: age 180s/5min, Twilio 429 >2% for 5min pages, any DLQ message tickets, DLQ >500 pages, due Friday, September 18th.
- Autoscaling changes confirmed: max replicas 40→16 and scale on oldest message age rather than depth.
- Outbox pattern (transactional outbox table + separate relay deployment with its own alert) assigned to Joaquin, due Friday, October 16th, with the lead to brief him.

#### Action items
- Defer the p99 == 3.4s (prefetch) discussion to later in the meeting
- Record in the notes that notif-worker is the consumer and notify-gateway is the HTTP publisher
- Put the DLQ misconfiguration on the follow-up list
- Put the notif-worker canary / deployment-safety gap on the follow-up list
- Ravi to write a two-week spike plan for the Kafka consumer, prototyping notif-worker reading from MSK with retry topics, planned by Monday.
- Pam to supply real MSK cost numbers based on the data team's actual bill (implicitly feeding into the cost comparison).
- The decision on whether to resend the 2,300 queued notifications remains to be made later.
- Pam will send Ravi the data team's actual MSK bill as the model for the $5,200 estimate.
- The incident clinic count was corrected to 420 in the notes (from 312); patient numbers unchanged at ~61,000 late and 9,400 duplicates.
- Sam will check whether any insurance card reminder payloads exceed SQS's 256 KB limit.
- Idempotency approach needs rework because the Redis SETNX 24h TTL is too short (retries can span up to 72h).
- RabbitMQ 3.11.9 upgrade to 3.13.7 and migration of notifications.v2 from classic mirrored queues to quorum queues is planned as part of option one.
- Sam to remove inline retry mode, add exponential backoff (1s/5s/30s/2min/10min, max 5 attempts) and token bucket limiter at 100/sec by Friday, September 25th.
- Sam to fix the DLQ policy pattern in Terraform for notifications.v2 by Monday, September 14th (said could do it today).
- Sam to change prefetch to 30 in a separate deploy by Tuesday, September 15th.
- Sam to build the delivery_attempts idempotency table by Wednesday, October 7th; noted the load is heavy but backoff and limiter share one PR.
- Pam to do the RabbitMQ 3.11.9→3.13.7 upgrade and migrate notifications.v2 to quorum queues with a delivery limit of 5, by Friday, October 9th.
- Sam to implement the delivery_attempts idempotency table with a unique index on notification ID and channel by Wednesday, October 7th.
- Lead to write the notification backlog runbook (RETRY_MODE drift, DLQ check, manual replica cap, pausing Northgate batches) by Thursday, September 24th.
- Runbook must explicitly state that rollback includes the ConfigMap chart, per Grace.
- Pam to configure alerts by Friday, September 18th, including DLQ >500 page threshold.
- Pam to do the one-line max replicas change (40→16) today and the scale-on-age change by the 18th alongside alerts.
- Pam to produce a 12-month cost estimate for all three options (peak months + SQS dual-run) by Wednesday, September 30th for Grace's budget review.
- Ravi to run the SQS/SNS prototype as a 5-working-day timebox starting Monday, September 28th with readout Friday, October 2nd.
- Ravi to get notif-worker onto the Argo Rollouts canary pipeline by Friday, October 16th.
- Lead to write the architecture decision record by Tuesday, September 15th.
- Grace to send the incident note to the 420 clinics through customer success by Monday, September 14th.
- Lead to send the notes and ADR draft in the channel after the meeting.

#### Open questions
- Why is p99 still at 3.4 seconds versus the 2.1 second baseline (suspected prefetch issue)?
- What was the role of the KEDA autoscaler as a fourth amplifier — Pam to explain?
- Should the ~2,300 notifications left in 'queued' status be resent, given the risk of reminding patients about appointments that already happened?
- What storage did Ravi assume in his $1,900 MSK estimate, and did it include data transfer?
- How long would the migration take, given notif-worker is not small — Ravi estimates six weeks (one week producer, three weeks consumer rewrite, two weeks dual-run/soak).
- What storage assumption and data transfer inclusion should be used for the MSK cost model?
- Can SQS be built before the October 23rd freeze without a prototype?
- Do any email template payloads exceed the 256 KB SQS limit, possibly requiring S3 pointers?
- Will the reschedule-cancel race be fixed, and is a version number on the appointment the right mechanism?
- What idempotency design replaces the rejected Redis 24h TTL approach?
- Whether Twilio can raise short code throughput for peak season, or whether 100/sec is a hard limit.
- Whether notify-gateway should throttle giant per-clinic uploads; product team may resist since clinics like immediate completion.
- Whether Tuesday or the April SSO incident is officially the worst incident this year — differs by employees vs patients.
- How to handle the 2,300 never-sent notifications (resend, alternate patient contact, or leave) remains open given patient safety concerns.
- Whether Twilio's 100/sec is a hard short-code limit or per-account, and whether it can be raised for peak, is unanswered and unowned.
- Whether any insurance card email payloads exceed 256KB is unknown pending the prototype.
- Whether the quorum queue migration needs a maintenance window (last 3.11 upgrade used a 20-minute 03:00 window) is undetermined; Pam needs to read up.
- Whether to throttle large per-clinic uploads at notify-gateway is open with no owner and requires product input.
- Whether email and SMS should become separate notif-worker deployments remains undecided.

#### Risks / blockers
- DLQ was never active on notifications.v2 due to a Terraform policy pattern mismatch (hyphen vs dot), so failed messages have requeued forever with zero DLQ messages since March 2024
- notif-worker has no canary rollout coverage, unlike notify-gateway and the scheduler, so it deploys straight to all replicas
- The Helm rollback did not touch the ConfigMap (separate chart), so rollbacks may not fully revert deploys
- KEDA autoscaling scaled notif-worker to 40 replicas by ~15:05 during the incident
- The autoscaler amplified the outage: 40 pods at six concurrent sends each attempted 240 sends/second against a 100/second Twilio short code limit.
- No idempotency on the send side means at-least-once delivery becomes at-least-twice delivery and generated 9,400 duplicates.
- The notify-gateway dual write is a classic risk: DB write and broker publish are separate steps, so confirm timeouts silently lose messages.
- Timeline risk: Ravi's six-week MSK estimate lands exactly on the October 23rd freeze, described as tight but doable only if work starts Monday.
- Capacity risk: four engineers with Joaquin on leave until September 21st, and SRE Pam only ~half time and shared across three teams.
- Compliance risk: HIPAA payloads contain PHI (patient names, appointment times), require AWS BAA coverage, customer-managed KMS keys, and broker retention under 14 days.
- Budget risk: messaging ceiling is $6,000/month; RabbitMQ is ~$3,800, and Pam's corrected MSK figure of ~$5,200 leaves little margin.
- Open auditor finding: RabbitMQ inter-node traffic is not TLS-encrypted, flagged in March and still on the remediation list due end of year.
- Kafka migration carries operational risk: the team has no production Kafka experience, only adjacent knowledge on the data team's analytics pipeline in a different account.
- Dual-run cost of RabbitMQ + MSK is $9,000/month, 50% over the $6,000 ceiling.
- The October 23rd freeze will be missed by the MSK/Kafka migration path.
- Kafka alone does not fix retry storms, missing DLQs, or autoscaling into Twilio rate limits.
- SQS lacks replay and per-clinic ordering (standard queues), and FIFO has throughput limits.
- SQS max payload of 256 KB may force S3 pointer pattern, increasing PHI exposure locations.
- Idempotency requires 72h window due to backoff plus quiet hours, making Redis TTLs insufficient.
- Adding Redis/ElastiCache would trigger another BAA review and KMS config.
- A 24-hour Redis TTL is insufficient given backoff plus quiet hours can legitimately delay retries up to 72 hours.
- The DLQ was never enabled since March 2024 due to a hyphen-vs-dot Terraform policy pattern typo.
- Kafka dual-run cost of $9,000/month exceeds the $6,000 ceiling that cannot be raised until February.
- October 23rd freeze is immovable with open enrollment November 1st and sales promises to hospital groups.
- Team lacks Kafka operations experience (four people, half-time SRE).
- notif-worker was not on the canary pipeline, an incident amplifier.
- A 120s page threshold would fire nightly during the 02:00 next-day appointment batch (~150s), risking alert fatigue and recreating the 'Monday morning problem'.
- The 2,300 unsent notifications is flagged as a patient safety question Grace does not want to guess on.
- Conduct-of-fairness concern about handing outbox work to Joaquin on his first day back from leave.
- Uncertainty whether the quorum queue migration needs downtime is a scheduling blocker for the Oct 9 upgrade.

#### Notes
- Timeline: notif-worker 2.14.0 deployed at 14:02; first alert (queue depth >50,000 on notifications.v2) at 14:19; SEV-2 at 14:31; rollback to 2.13.2 at 14:45; upgraded to SEV-1 at 15:10; backlog peaked at 1.8M messages at 16:40; bleeding sto
- Delivery latency: p99 was 2.1s before the incident, 47 minutes at worst, and 3.4s now after the fix
- Error rates: Twilio 429 baseline ~0.2% of sends, peaked at 38% during the incident, and overall notification failure rate was 11% for the incident window
- Customer impact: 312 clinics affected, ~61,000 patients got late reminders, 9,400 patients got duplicate SMS (some 3-4 times), and 1.8M messages backlogged
- 212 OOM kills occurred across notif-worker pods between 14:20 and 16:50
- Prior to 2.14.0, retryable provider errors were published to a delayed retry exchange with backoff (5s, then 30s, then 2 min); inline mode replaced this with an immediate basic.nack requeue
- The Northgate Medical Group uploaded a 240,000-reminder bulk flu clinic campaign batch through notify-gateway at 14:00
- Two calendar invites existed for the meeting (one from booking the big room); Grace joined only for the last ~20 minutes; Pam was delayed by on-call handoff
- The incident had four amplifiers identified: inline retries with no backoff, prefetch of 200, no DLQ, and the autoscaler.
- Ravi cited a QCon San Francisco talk about a food delivery company that moved order notifications from RabbitMQ to Kafka in about eight weeks, reporting a ~60% p99 improvement.
- MSK was proposed on Kafka 3.6, matching what the data team runs for the analytics pipeline.
- MSK is described as HIPAA eligible under the BAA with KMS customer-managed keys and TLS in transit, which would resolve the auditor finding.
- The team noted everyone has shipped a ConfigMap change with an image change, including Pam last week, supporting the blameless framing.
- The reschedule-then-cancel race condition was acknowledged as a real bug by Sam, supporting the per-clinic ordering argument for Kafka.
- RabbitMQ current messaging cost is ~$3,800/month (RabbitMQ cluster on EC2).
- Cross-AZ replication traffic is cited as the cost line that people typically omit: with replication factor 3 every write crosses AZs twice.
- notif-worker includes quiet hours logic (no texts 9pm-8am local), per-clinic template rendering, STOP-list opt-out check, and SendGrid bounce handling.
- Quiet hours currently relies on republishing to a delayed exchange with a TTL; Kafka has no per-message delay, requiring a scheduler.
- Retry-topic design risk: a message in a 10-minute retry topic blocks every message behind it in the same partition.
- SQS/SNS cost estimate ranges $600-$1,100/month steady state, $2,500 at 3x peak; SQS dual-run cost is ~$4,900 total.
- SQS benefits called out: zero brokers to patch, no Erlang upgrades, no inter-node TLS, covered under BAA, supports KMS customer managed keys, redrive policy enforces DLQ, visibility timeout is a natural backoff.
- Proposed retry schedule for the consumer: exponential backoff at 1s, 5s, 30s, 2min, 10min, max five attempts then dead letter.
- Quorum queues' delivery-limit setting dead-letters after N redeliveries, making the Tuesday retry loop physically impossible at the broker level.
- Classic mirrored queues are removed in RabbitMQ 4, so the quorum queue migration would be required eventually regardless.
- Outbox pattern: notify-gateway writes the notification row and an outbox row in the same Postgres transaction; a relay reads the outbox and marks published on confirm, so messages can't be lost between DB and broker.
- Current idempotency idea (Sam's) is a Redis SETNX key per notification ID with a 24h TTL, skipping send if the key exists.
- Team members: Ravi, Sam (Sam/Speaker 3 is rewriting the consumer), Pam, plus Joaquin returning on the 21st, and Grace joining shortly.
- Relay is to be its own deployment with its own alert, not a goroutine inside notify-gateway or a Node worker thread.
- Postgres 14 supports SELECT FOR UPDATE SKIP LOCKED, enabling two relays to run.
- The relay publishes at-least-once, another reason for consumer-side idempotency.
- Twilio short code limit is 100 messages/sec and each notif-worker pod runs six concurrent sends.
- The 429 alert would have fired around 14:08 on Tuesday, roughly nine minutes earlier than the existing alert and more specific.
- On Wednesday the team rolled forward to 2.14.1, which removed RETRY_MODE from config but kept prefetch 200 with raised pod memory limits.
- Incident summary: Tuesday September 8th, 4h53m from first alert to resolution, backlog peaked at 1.8M messages, p99 went from 2.1s to 47 minutes.
- Incident impact: 420 clinics affected, ~61,000 patients got late reminders, 9,400 duplicates, ~2,300 notifications never sent.
- Root cause was the RETRY_MODE inline config making every Twilio 429 requeue immediately with no backoff; trigger was a 240,000 reminder batch from Northgate at 14:00.
- Options considered: RabbitMQ 3.13 upgrade ~$4,300/mo ~3 weeks; Kafka on MSK ~$5,200/mo steady state, ~$9,000 dual-run, 10–12 weeks; SQS/SNS ~$1,100/mo with no solid timeline without a prototype.
- Dana noted a mid-meeting statement that the team was converging on Kafka was premature before Pam's real cost number and Sam's timeline were in.
- Grace has about 20 minutes for this meeting.
- Sam's backoff and rate limiter are essentially the same PR as the idempotency work.
- Pam previously led the RabbitMQ 3.8→3.11 upgrade, mostly solo, giving her relevant context for the 3.13.7 work.
- Grace has a budget review in the first week of October, which the Sept 30 cost estimate feeds.
- Joaquin specifically asked for something self-contained to come back to.
- The runbook's first section is the ConfigMap rollback instruction.
- Six open questions were deliberately captured so they would appear in the meeting notes.
- Grace closed the meeting acknowledging Tuesday was rough and telling Sam not to carry it around.
- Light closing banter: Ravi offered to 'carry the Kafka dream' and Pam joked about putting both in the dead letter queue.

#### Action items (structured)
- Sam: Park discussion of why p99 is still at 3.4 seconds (Sam suspects the prefetch) for later in the meeting.
- Sam: Record for the notes that notif-worker is the consumer and notify-gateway is the HTTP publisher, since people mixed them up in the incident channel.
- Ravi: Write up a two-week spike plan for the Kafka consumer — a prototype of notif-worker reading from MSK with the retry topics. (deadline: Monday)
- Peak season code freeze [inferred]
- Joaquin returns from parental leave [inferred]
- Open enrollment starts [inferred]
- RabbitMQ TLS auditor remediation due [inferred]
- Ravi to deliver Kafka spike plan [inferred]
- Pam: Send Ravi the data team's actual MSK bill to substantiate the $5,200 estimate.
- Me: Fix the incident number: affected clinics revised from 312 to 420 (patient numbers unchanged at ~61,000 late, 9,400 duplicates).
- Sam: Check whether any insurance card reminder payloads exceed the SQS 256 KB message size limit.
- Validate/decide on idempotency approach for the consumer given the Redis TTL mismatch and lack of Redis in the notification path. [inferred]
- Sam: Delete inline RETRY_MODE entirely, add exponential backoff on the delayed exchange (1s, 5s, 30s, 2min, 10min, max 5 attempts, then dead letter), plus token bucket rate limiter for Twilio at 100/sec. (deadline: Friday, September 25th)
- Sam: Fix the DLQ policy pattern in Terraform so notifications.v2 actually dead-letters (hyphen vs dot typo). (deadline: Monday, September 14th)
- Sam: Change prefetch to 30 in a separate deploy. (deadline: Tuesday, September 15th)
- Sam: Build the delivery_attempts table with a unique index on notification ID and channel (idempotency). (deadline: Wednesday, October 7th)
- Ravi: Upgrade RabbitMQ from 3.11.9 to 3.13.7 and migrate notifications.v2 to quorum queues with a delivery limit of 5. (deadline: Friday, October 9th)
- DLQ policy pattern fix [inferred]
- Prefetch change to 30 [inferred]
- Backoff, rate limiter, and inline retry removal [inferred]
- Sam: Idempotency (delivery_attempts table) [inferred]
- RabbitMQ upgrade and quorum queue migration [inferred]
- Incident freeze [inferred]
- SQS migration decision at architecture review [inferred]
- Me: Write the notification backlog runbook covering RETRY_MODE config drift, DLQ checks, manual replica capping, and pausing Northgate batches. (deadline: Thursday, September 24th)
- Me: Ensure the runbook explicitly states the rollback must include the ConfigMap chart. (deadline: absent)
- Pam: Set up alerts: page on notification age (180s/5min) and Twilio 429 >2% for 5 min, ticket on any DLQ message, page when DLQ exceeds 500. (deadline: Friday, September 18th)
- Pam: Make the max replicas change (40 to 16) today as a one-line change. (deadline: today)
- Pam: Deliver a 12-month cost estimate for all three options including peak months and dual-run for SQS for Grace's budget planning. (deadline: Wednesday, September 30th)
- Ravi: Build the SQS/SNS prototype (5-day timebox, notif-worker SMS path, SQS redrive, visibility timeout backoff, KMS CMK, payloads vs 256KB limit). (deadline: start Monday Sept 28, readout Friday Oct 2)
- Ravi: Get notif-worker onto the Argo Rollouts canary pipeline like notify-gateway. (deadline: Friday, October 16th)
- Me: Brief Joaquin on the outbox pattern work on his first day back. (deadline: absent)
- Me: Write the architecture decision record for all of this. (deadline: Tuesday, September 15th)
- Grace: Send the incident note to the 420 clinics through customer success. (deadline: Monday, September 14th)
- Me: Architecture decision record [inferred]
- Pam: Alerts + autoscaling-on-age [inferred]
- Me: Notification backlog runbook [inferred]
- Ravi: SQS/SNS prototype start [inferred]
- Pam: 12-month cost estimate [inferred]
- Ravi: SQS/SNS prototype readout [inferred]

#### Decisions (structured)
- Agreed on the refined root cause: the RETRY_MODE=inline config shipped in 2.14.0 turned retryable provider errors into immediate requeues with no backoff, causing the retry storm and 429 spike.
- Agreed the OOM kills from prefetch 200 were an amplifier/symptom, not the cause.
- Agreed framing: trigger is the Northgate batch, root cause is inline retry with no backoff, amplifiers are prefetch 200 and no DLQ.
- Tentatively (explicitly framed as 'in pencil') the direction is to migrate the notification pipeline to Kafka on MSK before the October 23rd code freeze. (owner: Me)
- The fate of the ~2,300 never-published queued notifications is left as an open item rather than decided today. (owner: Me)
- Ravi accepted $5,200/month as the MSK cost estimate, replacing his $1,900 figure. (owner: Ravi)
- Ravi conceded the retry storm is a consumer design problem, not a broker problem. (owner: Ravi)
- The inline retry mode in the consumer will be deleted entirely, not just defaulted off. (owner: Sam)
- The broker decision was explicitly deferred because Grace is joining and should hear the options first.
- The outbox relay for notify-gateway will be its own separate deployment with its own alert, not a goroutine or worker thread inside notify-gateway.
- The relay will use SELECT FOR UPDATE SKIP LOCKED (Postgres 14) so two relay instances can run concurrently.
- Idempotency design is a Postgres unique index on notification ID plus channel, not Redis. (owner: Sam)
- Cap notif-worker max replicas at 16 (down from 40) and add a per-provider token bucket rate limiter inside the worker. (owner: Pam)
- Autoscaler scales on oldest message age and consumer utilization, not queue depth. (owner: Pam)
- Alerting changes: page when oldest message age on notifications.v2 exceeds 120s for 5 min; page when Twilio 429 rate exceeds 2% for 5 min; ticket (not page) on any DLQ messages; page when DLQ exceeds 500 messages. (owner: Pam)
- Stay on RabbitMQ for peak season with the fixes (3.13 upgrade, quorum queues, consumer fixes, DLQ, backoff); Kafka on MSK is rejected. (owner: Grace)
- SQS and SNS gets a timeboxed prototype now, with the migration decision at the January 13th architecture review. (owner: Grace)
- Gateway throttling for giant clinic uploads is put on the maybe list with no forced owner today.
- Prefetch drop to 30 must ship in a separate deploy from anything else. (owner: Sam)
- Sam takes idempotency: delivery_attempts table with a unique index on notification ID and channel, by Wednesday, October 7th. (owner: Sam)
- The RabbitMQ 3.13.7 upgrade and quorum queue migration (delivery limit of 5) moves from Ravi to Pam, still due Friday, October 9th, so Ravi stays on the SQS prototype. (owner: Pam)
- The runbook is reassigned from Pam to the meeting lead, freeing Pam's plate. (owner: Me)
- Oldest message age page threshold is set to 180 seconds for 5 minutes, not 120 seconds, to stay above the nightly 02:00 batch; the other alert thresholds stay as proposed. (owner: Pam)
- Autoscaling change: max replicas 40 down to 16, scaling on oldest message age instead of depth. (owner: Pam)
- The Kafka spike plan is cancelled and will not be written. (owner: Ravi)
- The outbox pattern work (outbox table in same Postgres transaction, relay as its own deployment with its own alert) is assigned to Joaquin, due Friday, October 16th. (owner: Joaquin)
- The game day idea (kill the broker on staging during a big batch) is acknowledged but explicitly not assigned today.

#### Open questions (structured)
- Why is p99 end-to-end latency still at 3.4 seconds instead of the 2.1 second baseline, suspected to be the prefetch setting? [open]
- What remains to be discussed regarding the autoscaler (KEDA) behavior as a fourth amplifier, which Pam was asked to talk about? [open]
- Whether to resend the ~2,300 notifications that were written to Postgres but never published to the broker. [open]
- Pam challenged Ravi's MSK cost estimate, asking what storage he assumed and whether data transfer was included. [open]
- What storage assumption and data transfer inclusion should be used in the MSK cost model? [open]
- What is the SQS dual-run and steady-state total cost, and is it below the $6,000 ceiling at peak? [open]
- Can SQS be implemented before the October 23rd freeze without a prototype? [open]
- Do any insurance card email templates exceed SQS's 256 KB payload limit? [open]
- How will the reschedule-cancel race be fixed if not by the queue? [open]
- What is the final idempotency mechanism given Redis isn't in the notification path and 24h TTL is too short? [open]
- Can Twilio raise the short code throughput for peak season, or is 100/sec a hard limit rather than what was originally requested three years ago? [open]
- Should notify-gateway throttle giant per-clinic uploads (e.g. Northgate's 240,000 in four minutes), possibly via a per-clinic rate? [open]
- What to do with the 2,300 notifications that were never sent — resend, contact patients another way, or leave it? Pam is worried about stale reminders. [open]
- Is Twilio's 100/second a hard limit on the short code, per account, and can it be raised for peak? [open]
- Do any of the insurance card email payloads exceed 256 kilobytes? [open]
- Does the quorum queue migration need a maintenance window or can it be done live with a shovel? [open]
- Pam's idea of throttling large per-clinic uploads at notify-gateway — no owner, no decision, needs product input. [open]
- Should email and SMS be separate notif-worker deployments — marked 'ideally' but undecided. [open]

#### Risks (structured)
- [high] The dead letter queue was never enabled on notifications.v2 due to a Terraform policy pattern mismatch (notifications-v2 with hyphen vs notifications.v2 with dot), so failed messages requeued forever and there have been zero DLQ messages si
- [high] notif-worker is not on the canary pipeline (only notify-gateway and the scheduler use Argo Rollouts canary); it deploys straight to all replicas, so the component sending patient messages has less deployment safety.
- [high] The 14:45 rollback to 2.13.2 did not help because the Helm rollback only rolled back the image, not the ConfigMap (managed in a separate chart), so the inline retry mode persisted.
- [medium] KEDA scales notif-worker on queue depth up to 40 max replicas, which escalated pod count from 8 to 40 by ~15:05 during the incident.
- [high] The KEDA autoscaler scaled notif-worker from 8 to 40 pods, creating up to 240 attempted sends/second against Twilio's 100 messages/second short code limit — effectively DDoSing the vendor.
- [high] No idempotency check on the send side means OOM-killed pods after Twilio accepts a message produce duplicate sends (9,400 duplicates).
- [high] Dual-write problem: notify-gateway commits the Postgres row then publishes to RabbitMQ, so publisher-confirm timeouts (5s) during 16:00–16:45 left ~2,300 notifications stuck as 'queued' and never sent.
- [high] Code freeze for peak is October 23rd, giving roughly six weeks for any production-pipeline change to be done and soaked, which matches Ravi's estimated six-week MSK migration timeline.
- [medium] Team capacity is limited: four engineers (Me, Ravi, Sam, Joaquin), with Joaquin on parental leave until September 21st, and SRE Pam shared across three teams at roughly half time.
- [medium] Messaging budget ceiling is $6,000/month; current RabbitMQ cluster on EC2 costs ~$3,800/month, so Pam's $5,200 MSK estimate would leave little headroom.
- [medium] HIPAA constraint: PHI cannot sit in a message broker longer than 14 days, and Pam questions retention/deletion handling in a Kafka log.
- [medium] Open auditor finding from March: RabbitMQ inter-node traffic is not using TLS, with a remediation due date of end of year.
- [high] Pam's real MSK pricing work from last quarter shows kafka.m5.large was too small and the data team had to upgrade off it within a month; cross-AZ replication traffic is the line missing from Ravi's estimate.
- [high] Dual-run during migration (RabbitMQ $3,800 + MSK $5,200 = $9,000/month) is 50% over the $6,000 ceiling.
- [medium] Steady-state MSK at $5,200 plus required extra Postgres capacity sits right at the $6,000 ceiling.
- [high] A 10-12 week rewrite blows past the October 23rd freeze and lands in mid-November open enrollment.
- [high] Kafka does not inherently fix the Tuesday failure mode: retry storm, missing DLQ, autoscaler into Twilio rate limit, or lack of backoff.
- [medium] Replaying 240,000 appointment reminders after a five hour outage is undesirable because half would be stale.
- [medium] SQS message size cap of 256 KB may force a move to S3 payload pointers, adding another location for PHI.
- [medium] SQS standard queues are at-least-once and unordered (no per-clinic ordering); FIFO ordering has throughput limits requiring design work.
- [medium] Adding Redis/ElastiCache for idempotency would trigger another BAA review and KMS config.
- [high] A 24-hour Redis TTL is insufficient because retries with backoff plus quiet hours can span up to 72 hours.
- [medium] Including Redis/ElastiCache in the notification path would require another BAA review and KMS config.
- [medium] A 24-hour Redis TTL would be too short, since backoff plus quiet hours can legitimately retry a message up to 72 hours after first attempt.
- [high] The current page at queue depth 50,000 fires every Monday morning on legitimate clinic batches, so people have learned to ignore it.
- [high] The DLQ was never actually enabled since the queue was created in March 2024 due to a hyphen-versus-dot typo in the Terraform policy pattern.
- [high] The $9,000 Kafka dual-run month exceeds the $6,000 monthly messaging ceiling, which cannot be raised before the next fiscal year in February.
- [high] The October 23rd freeze is immovable due to open enrollment starting November 1st, and sales has promised two big hospital groups bulletproof reminders.
- [high] The team of four with a half-time SRE does not have Kafka operations experience.
- [medium] Notif-worker was not on the canary pipeline, which was an amplifier in the incident.
- [medium] The p99 latency is at 3.4 seconds versus the previous 2.1 seconds because 200 prefetched messages per pod are held up by a slow send.
- [high] Paging on 120s message age would fire every night during the 02:00 next-day appointment batch (routinely ~150s), causing alert fatigue and recreating the Monday morning problem.
- [low] Concern that handing the outbox work to Joaquin on his first day back from leave is unfair.
- [high] The 2,300 unsent notifications is a patient safety question; Grace does not want to guess on it.
- [medium] Pam does not yet know whether quorum queue migration requires downtime, creating a planning unknown.

#### Follow-up draft
Subject: Follow-up: September 8 notification outage review and broker decision

Hi team,

Thanks for the thorough review of the September 8 notification outage — good to have the timeline and the root cause nailed down. We aligned that the trigger was Northgate's 14:00 batch of 240,000 flu clinic reminders, the root cause was the RETRY_MODE=inline config shipped in 2.14.0 turning retryable errors into immediate requeues with no backoff, and that prefetch 200 and the missing DLQ were amplifiers rather than causes. On direction, we're staying on RabbitMQ for peak with the consumer fixes, the 3.13.7 upgrade and quorum queues, and the autoscaling and alerting changes; Kafka on MSK is out, and Ravi will run a timeboxed SQS prototype with the migration decision at the January 13th architecture review.

The one thing still genuinely open is what to do with the roughly 2,300 notifications that were written to Postgres but never published to the broker — resend, reach patients another way, or leave them. Given the patient safety angle, we should settle that before it falls off the list.

Best,

---

# Summary F

_(run1)_

### Title: Notification Reliability and Broker Strategy

#### Overview
The team reconstructed the notification outage, identifying the Northgate batch as the trigger, inline retries without backoff as the root cause, and prefetch, missing DLQ enforcement, and autoscaling as amplifiers. The team attributed the incident to the Northgate batch and retry/autoscaling design flaws, identified 2,300 unpublished notifications, and tentatively favored migrating to MSK before the October 23 freeze pending cost validation. Kafka was shown to exceed the migration budget and freeze timeline, while RabbitMQ remediation fit both; SQS remained promising but required a prototype, and the incident scope was revised to 420 clinics. The team rejected Kafka for peak, chose RabbitMQ upgrades and consumer fixes before the October 23 freeze, and scheduled an SQS/SNS prototype for a January 13 architecture decision. Ownership and deadlines were finalized for the reliability work, the alert threshold was raised to 180 seconds, the Kafka spike was canceled, and six follow-up questions remained open. Key decisions: The incident was classified as a retry storm caused by RETRY_MODE=inline, which immediately requeued retryable provider errors without backoff.; The Northgate Medical Group bulk upload of 240,000 reminders was identified as the trigger that pushed traffic over Twilio's limit.; The prefetch increase to 200 and the missing dead-letter-queue policy were classified as amplifiers rather than the primary cause..

#### Summary
- The meeting reviewed the notification outage and evaluated reliability fixes and broker options for peak season.
- The outage was classified as a retry storm caused by RETRY_MODE=inline and immediate requeueing without backoff, triggered by a large reminder upload; prefetch 200, the missing DLQ policy, and autoscaling were amplifiers.
- RabbitMQ will remain in production through peak season with delayed exponential backoff, dead lettering, quorum queues, a broker upgrade, database-backed idempotency, and rate-limited autoscaling, while Kafka on MSK was rejected for peak season and SQS/SNS was deferred for evaluation at the January 13 architecture review.

#### What changed
- The outage was refined from an initial prefetch/OOM theory to a root cause centered on RETRY_MODE=inline and immediate requeueing.
- The incident response changed RETRY_MODE back to delayed at 16:52, after which the 429 rate began falling within about four minutes.
- The notification backlog peaked at 1.8 million messages at 16:40 and drained by 18:35 after the effective mitigation.
- Post-fix p99 delivery latency improved to 3.4 seconds but remained above the 2.1-second baseline.
- The outage lasted 4 hours and 53 minutes from the first alert at 14:19 to resolution at 19:12.
- Customer impact was quantified as 312 clinics, approximately 61,000 late reminders, and 9,400 patients receiving duplicate SMS messages.
- The incident trigger was identified as Northgate Medical Group uploading a 240,000-reminder batch through notify-gateway at 14:00.
- The autoscaler increased notif-worker from 8 to 40 pods by approximately 15:05 as queue depth rose.
- The incident produced approximately 9,400 duplicate messages through OOM-triggered redelivery and absent idempotency.
- Approximately 2,300 notifications created during the incident were committed as queued in Postgres but never published to RabbitMQ.
- The team established that the loss came from separate database and broker writes with no recovery after publisher-confirm timeout.
- Peak-season planning now targets approximately 9 million messages per day, based on current volume of 3 million per day and an expected threefold increase.
- The proposed migration estimate changed from roughly $1,900 per month for three m5.large brokers to approximately $5,200 per month using larger brokers and actual cross-AZ and throughput costs.
- The MSK estimate increased from $1,900 to approximately $5,200 per month after accounting for larger brokers, storage, provisioned throughput, and cross-AZ replication traffic.
- The incident scope was revised from 312 to 420 affected clinics based on delivery-log matching rather than inbound clinic calls.
- SQS with SNS fan-out was added as a third broker option alongside RabbitMQ and MSK.
- The estimated RabbitMQ steady-state cost became approximately $4,300 per month after increasing the three cluster nodes from m5.large to m5.xlarge.
- RabbitMQ remediation was estimated at about three weeks, while Kafka migration was estimated at eight to twelve weeks depending on scope and assumptions.
- The team began shifting focus to broker-independent reliability work, starting with an outbox pattern for notify-gateway.
- The incident impact was revised to 420 affected clinics based on delivery logs, rather than the 312 clinics that called in.
- The incident was quantified as 4 hours 53 minutes, a peak backlog of 1.8 million messages, p99 latency rising to 47 minutes, 61,000 late reminders, 9,400 duplicates, and about 2,300 unsent notifications.
- The root cause was identified as RETRY_MODE inline causing immediate requeueing of every Twilio 429 without backoff, with a 240,000-message Northgate batch acting as the trigger.
- The prefetch change was classified as an amplifier rather than the root cause, and the worker was already on version 2.14.1 with its memory limit raised.
- The proposed prefetch reduction is from 200 to 30 to reduce the number of messages held behind slow sends and improve p99 latency toward 2.1 seconds.
- The relay was defined as its own deployment with its own alert, separate from notify-gateway and Node worker threads.
- The relay is expected to publish at least once, requiring consumer-side idempotency.
- The previously used queue-depth alert was considered noisy because it fired during normal Monday clinic uploads and had become ignored.
- The proposed alert thresholds are oldest notification message age above 120 seconds for five minutes, Twilio 429 rate above 2% for five minutes, a ticket for any DLQ messages, and a page above 500 DLQ messages.
- Pam replaced Ravi as owner of the RabbitMQ 3.13.7 upgrade and notifications.v2 quorum-queue migration.
- The notification backlog runbook moved from Pam to Me.
- The message-age alert threshold increased from 120 to 180 seconds for 5 minutes.
- The planned Kafka spike was canceled and replaced by the SQS/SNS prototype.
- The outbox work remained assigned to Joaquin for his return on October 21st.

#### Decisions
- The Northgate bulk reminder upload was accepted as the incident trigger.
- Inline retry without backoff was accepted as the primary root cause.
- Prefetch 200 and the absent DLQ were accepted as amplifiers, while OOM kills were treated as a symptom rather than the cause.
- The team tentatively converged on migrating the notification pipeline to Kafka on Amazon MSK before the October 23 freeze.
- The proposed Kafka design includes a main notifications topic, 30-second, 2-minute, and 10-minute retry topics, and a DLQ topic.
- The working RabbitMQ fix includes exponential backoff at 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes, with five maximum attempts followed by dead lettering.
- Inline retry mode will be deleted rather than merely disabled.
- The RabbitMQ queue migration will use quorum queues and their delivery-limit behavior to prevent unlimited broker-level redelivery loops.
- The final choice among RabbitMQ, MSK, and SQS was intentionally deferred until Grace could participate.
- The team selected Postgres rather than Redis for send idempotency because Redis would add a new notification-path dependency and its 24-hour TTL would not cover delayed retries.
- RabbitMQ will remain the production broker through peak season while reliability fixes are implemented.
- The SQS/SNS alternative will be evaluated using a prototype and a January 13 architecture review rather than selected immediately.
- The alert configuration will use 180 seconds for notifications.v2 oldest-message age while retaining the other specified alert conditions.
- The Kafka spike plan will not be written.
- The outbox assignment to Joaquin will be kept despite his first day back from leave.

#### Action items
- Record that notifications.v2 did not have the dead-letter policy applied because the Terraform pattern used a hyphen instead of a dot.
- Continue evaluating the architecture rather than only patching the consumer.
- Ravi will prepare a two-week spike plan for a notif-worker Kafka consumer prototype with MSK retry topics by Monday.
- Provide the data team's actual MSK bill for comparison with the revised estimate.
- Prototype SQS before making a pre-October-23 delivery commitment.
- Implement a separate outbox relay deployment with alerting and support for two concurrent relays.
- Determine an idempotency mechanism that remains valid for retries occurring up to 72 hours after the first attempt.
- Sam is responsible for the retry/backoff implementation and Twilio rate limiter by September 25th.
- Sam is responsible for correcting the DLQ Terraform policy pattern by September 14th.
- Sam is responsible for deploying the prefetch reduction to 30 separately by September 15th.
- Sam is responsible for implementing delivery_attempts idempotency by October 7th.
- Ravi is responsible for the RabbitMQ 3.13.7 and quorum-queue migration by October 9th.
- Complete the assigned reliability, migration, alerting, autoscaling, prototype, canary, outbox, ADR, incident-note, and documentation tasks according to the listed owners and deadlines.
- Include ConfigMap-chart rollback instructions in the runbook.
- Send the notes and ADR draft in the channel.

#### Open questions
- What architectural safeguards should replace or supplement the current retry, queue, and deployment design remains unresolved.
- Whether prefetch explains the remaining 3.4-second p99 latency still needs follow-up.
- How to add deployment safety to notif-worker, which currently skips canary rollout, remains unresolved.
- The team still needs to decide whether resending the 2,300 never-published reminders would create unacceptable patient confusion.
- The correct MSK broker size and complete monthly cost for peak traffic remain unresolved.
- The team has not yet confirmed that a six-week migration, including two weeks of dual-running and soak, is feasible.
- Can SQS meet the October 23 freeze after a prototype is completed?
- Do any email payloads exceed SQS's 256 KB limit?
- What idempotency store and retention period should replace the rejected 24-hour Redis key design?
- Is putting oversized payloads in S3 acceptable given the additional PHI storage location?
- The team still needs to determine whether Twilio can raise the short-code throughput limit above 100 messages per second.
- The team has not decided whether large clinic uploads should be throttled per clinic.
- The SQS/SNS migration choice is deferred until January 13.
- The disposition of the 2,300 unsent notifications remains unresolved.
- The scope and possible increase of Twilio's 100-per-second limit remain unresolved.
- Whether insurance-card email payloads exceed 256 KB remains unknown pending prototype data.
- The quorum-queue migration approach and maintenance-window requirement remain unresolved.
- Throttling large per-clinic uploads has no owner or decision and requires product input.
- Separating email and SMS into different notif-worker deployments remains undecided.

#### Risks / blockers
- Retryable Twilio and SendGrid failures can create an immediate retry loop when RETRY_MODE=inline is enabled.
- The DLQ configuration could silently remain ineffective because the Terraform queue-matching pattern did not match the actual queue name.
- A rollback can leave critical runtime configuration unchanged because the ConfigMap is managed in a separate chart.
- Scaling to 40 replicas based solely on queue depth may amplify provider rate limiting during a retry storm.
- Inline retries without backoff, prefetch of 200, and no DLQ amplified the Northgate batch into a vendor-throttling event.
- KEDA's queue-depth scaling pushed attempted send rate to 240 per second against Twilio's 100 per second limit.
- The absence of idempotency made OOM-induced redelivery produce duplicates after Twilio had already accepted messages.
- The migration is constrained by peak-season timing, limited engineering capacity, and an uncertain MSK cost that may approach the $6,000 monthly budget ceiling.
- Kafka would exceed the $6,000 ceiling during dual-run because RabbitMQ plus MSK was estimated at $9,000 per month.
- Kafka's lack of per-message delay requires a scheduler redesign for quiet-hours handling.
- Kafka retry topics can block messages behind a delayed message in the same partition unless partition-level pause and resume behavior is implemented.
- SQS standard queues require idempotency because they are at-least-once and unordered, while FIFO queues may impose throughput constraints.
- A Redis-based idempotency approach would add a new notification-path dependency and require another BAA review and KMS configuration.
- The October 23 freeze is fixed and leaves less than two weeks before November 1 open enrollment for final peak-season readiness.
- The current four-person team with a half-time SRE lacks Kafka operations experience, adding operational risk to a Kafka migration.
- The prior DLQ configuration was ineffective because a Terraform policy pattern typo prevented dead-lettering.
- Prefetch of 200 per pod can allow slow sends to hold many messages in a pod buffer and worsen p99 latency.
- The proposed alerting changes are not fully confirmed in this chunk and therefore remain a possible follow-up configuration rather than an explicit implementation commitment.
- Nightly batch traffic makes a 120-second age threshold noisy and could lead to alert fatigue.
- The unsent-notification decision is a patient-safety risk because reminders may be stale.
- Unknown Twilio throughput constraints could affect peak SMS delivery.
- Unknown payload sizes could cause insurance-card emails to exceed the 256 KB limit.
- Uncertainty about live migration versus a maintenance window may complicate the quorum-queue deployment.

#### Notes
- notif-worker consumes RabbitMQ jobs and sends through Twilio and SendGrid, while notify-gateway accepts clinic requests and publishes to the queue.
- The incident began after notif-worker 2.14.0 was deployed at 14:02 on Tuesday, September 8th.
- The first alert was queue depth crossing 50,000 messages at 14:19, and the incident was escalated to SEV-1 at 15:10 after depth exceeded 400,000.
- Twilio 429 responses rose from a 0.2% baseline to 38% at the peak, while the overall notification failure rate reached 11% during the incident window.
- There were 212 OOM kills across notif-worker pods between 14:20 and 16:50.
- Current notification volume is approximately 3 million messages per day, or 90 million per month.
- The team described Kafka benefits as replay through consumer offsets, disk-backed handling of large lag, and partitioning by clinic ID for per-clinic ordering.
- The proposed MSK deployment was described as Kafka 3.6, leveraging some existing organizational knowledge from the analytics pipeline.
- MSK was presented as HIPAA eligible under the BAA, supporting customer-managed KMS keys and TLS in transit.
- The team emphasized that retention must be configured at 14 days or less because Kafka topics may contain PHI.
- The migration was estimated at one week for the producer, three weeks for the consumer rewrite, and two weeks for dual-running and soak.
- SQS was estimated at $600 to $1,100 per month normally and approximately $2,500 during 3x-volume peak months, including SNS fan-out and KMS requests.
- SQS dual-running was estimated at approximately $4,900 total, substantially below the MSK dual-run estimate.
- SQS offers mandatory DLQ configuration in the Terraform module through redrive policy and maxReceiveCount, plus visibility timeout behavior that provides natural backoff.
- Replay would not have solved Tuesday's incident because replaying 240,000 reminders after five hours would leave many messages stale.
- The outbox relay will retry failed publishes and mark rows published only after a broker confirm, preventing message loss between Postgres and the broker.
- The reschedule-cancel race is not solved by the queue choice and would instead require an appointment version number.
- The incident's immediate retry storm was amplified by autoscaling to 40 pods against Twilio's 100-per-second limit.
- A 240,000-message Northgate batch legitimately took approximately four minutes to enqueue and would take roughly 40 minutes to drain at the intended rate.
- The RabbitMQ option was estimated at approximately $4,300 per month and about three weeks, while Kafka was estimated at $5,200 steady state, $9,000 during dual-run, and 10 to 12 weeks.
- The messaging budget ceiling is $6,000 per month and cannot be raised before the next fiscal year beginning in February.
- The team agreed the retry backoff and Twilio limiter can be delivered in essentially the same pull request.
- The separate-deployment requirement applies to the prefetch change so it is not shipped alongside unrelated changes.
- The SQS/SNS prototype is limited to the notif-worker SMS path and includes KMS, redrive, visibility-timeout backoff, and payload-size validation.
- The cost estimate is intended to support Grace's budget review in the first week of October.
- A staging game day involving broker failure during a large batch was suggested but deliberately not assigned.
- The team viewed the current plan as a better position after a difficult Tuesday.

#### Action items (structured)
- The refined root-cause breakdown and the fact that notifications.v2 had no effective DLQ should be recorded in the incident notes.
- The team needs to continue the architectural discussion after the incident timeline and root-cause review. [inferred]
- Ravi: Ravi will write up a two-week spike plan for a Kafka consumer prototype in notif-worker, including MSK and retry topics. (deadline: Monday)
- Open enrollment begins November 1, with notification volume expected to increase roughly threefold from November through mid-December. [inferred]
- Production-pipeline changes must be completed and soaked before the October 23 code freeze. [inferred]
- Joaquin is on parental leave until September 21. [inferred]
- The RabbitMQ TLS remediation is due by the end of the year. [inferred]
- Ravi's spike plan is due Monday. [inferred]
- Send the data team's MSK bill to support the revised cost estimate.
- Prototype SQS before committing to completing it before the October 23 freeze. (deadline: Before October 23, if it is to support a pre-freeze commitment) [inferred]
- Implement the notify-gateway outbox pattern with the notification row and outbox row written in one Postgres transaction. [inferred]
- Deploy the outbox relay as a separate deployment with its own alerting rather than embedding it in notify-gateway. [inferred]
- Use SELECT FOR UPDATE SKIP LOCKED on Postgres 14 so two outbox relays can run concurrently. [inferred]
- Check whether insurance-card reminder payloads exceed SQS's 256 KB message-size limit. [inferred]
- October 23 freeze [inferred]
- Joaquin returning on the 21st [inferred]
- Sam: Sam will remove inline retry mode, implement exponential backoff of 1 second, 5 seconds, 30 seconds, 2 minutes, and 10 minutes with a maximum of five attempts before dead-lettering, and add the Twilio token-bucket limiter. (deadline: Friday, September 25th)
- Sam: Sam will fix the Terraform dead-letter queue policy pattern so notifications.v2 actually dead-letters. (deadline: Monday, September 14th)
- Sam: Sam will reduce worker prefetch to 30 in a separate deployment. (deadline: Tuesday, September 15th)
- Sam: Implement idempotency using a delivery_attempts table with a unique index on notification ID and channel. (deadline: Wednesday, October 7th)
- Ravi: Ravi will upgrade RabbitMQ from 3.11.9 to 3.13.7 and migrate notifications.v2 to quorum queues with a delivery limit of five. (deadline: Friday, October 9th)
- The team will produce a timeboxed SQS/SNS prototype for evaluation at the January 13 architecture review. (deadline: January 13th architecture review)
- Monday, September 14th [inferred]
- Tuesday, September 15th [inferred]
- Friday, September 25th [inferred]
- Wednesday, October 7th [inferred]
- Friday, October 9th [inferred]
- October 23rd freeze [inferred]
- January 13th architecture review [inferred]
- Pam: Complete the RabbitMQ upgrade and quorum-queue migration for notifications.v2. (deadline: Friday, October 9th)
- Me: Write the notification backlog runbook covering RETRY_MODE configuration drift, DLQ checks, manual replica caps, Northgate-style batch pausing, and rollback of the ConfigMap chart. (deadline: Thursday, September 24th)
- Pam: Implement the agreed alerts for message age, Twilio 429 rate, and DLQ conditions. (deadline: Friday, September 18th)
- Pam: Change max replicas from 40 to 16 and scale on oldest message age instead of queue depth. (deadline: Friday, September 18th)
- Pam: Prepare a 12-month cost estimate for all three options, including peak months and SQS dual-run costs, for Grace's budget planning. (deadline: Wednesday, September 30th)
- Ravi: Run the five-working-day SQS/SNS prototype for the notif-worker SMS path, including redrive policy, visibility-timeout backoff, a customer-managed KMS key, and largest-payload checks against 256 KB. (deadline: Readout Friday, October 2nd)
- Ravi: Move notif-worker onto the Argo Rollouts canary pipeline. (deadline: Friday, October 16th)
- Joaquin: Implement the notify-gateway outbox table in the same Postgres transaction and run the relay as a separate deployment with its own alert. (deadline: Friday, October 16th)
- Me: Write the architecture decision record for the reliability changes. (deadline: Tuesday, September 15th)
- Speaker 4: Send the incident note to the 420 clinics through customer success. (deadline: Monday, September 14th)
- Me: Send the meeting notes and ADR draft in the channel.

#### Decisions (structured)
- The incident was classified as a retry storm caused by RETRY_MODE=inline, which immediately requeued retryable provider errors without backoff.
- The Northgate Medical Group bulk upload of 240,000 reminders was identified as the trigger that pushed traffic over Twilio's limit.
- The prefetch increase to 200 and the missing dead-letter-queue policy were classified as amplifiers rather than the primary cause.
- The team agreed that the rollback did not address the effective configuration because the separate ConfigMap was not reverted.
- The tentative direction is to migrate the notification pipeline to Kafka on Amazon MSK before the October 23 production code freeze.
- Use approximately $5,200 per month as the MSK steady-state estimate, based on the data team's actual bill and including previously underestimated transfer costs.
- Treat the retry storm as a consumer design problem rather than something Kafka would inherently fix.
- The updated incident impact count is 420 clinics, while patient totals remain approximately 61,000 late notifications and 9,400 duplicates.
- The Kafka-before-peak plan was not accepted as workable, but the final broker choice was deferred until Grace could hear the options.
- RabbitMQ remediation will remove inline retry mode and use delayed-exchange retries with exponential backoff, a five-attempt maximum, and dead lettering.
- The RabbitMQ broker plan includes upgrading from 3.11.9 to 3.13.7 and moving notifications.v2 from classic mirrored queues to quorum queues.
- Idempotency will use a Postgres delivery_attempts table with a unique index on notification ID and channel rather than Redis.
- The notif-worker autoscaler will have a maximum of 16 replicas, with six concurrent sends per pod, keeping theoretical throughput at 96 messages per second under Twilio's 100-per-second limit.
- The worker will use a per-provider token-bucket rate limiter so Twilio traffic remains below 100 messages per second even if replica limits are later raised.
- Autoscaling should use oldest message age and consumer utilization rather than queue depth.
- For peak season, the team will stay on RabbitMQ and implement the 3.13 upgrade, quorum queues, consumer fixes, dead-letter queue, and backoff changes.
- Kafka on MSK was rejected for peak season and is not intended for the post-peak roadmap unless circumstances change.
- SQS/SNS will receive a timeboxed prototype, with the migration decision scheduled for the January 13 architecture review.
- The RabbitMQ migration will move notifications.v2 from version 3.11.9 to 3.13.7 and use quorum queues with a delivery limit of five.
- Pam will own the RabbitMQ upgrade from 3.11.9 to 3.13.7 and the notifications.v2 migration to quorum queues with a delivery limit of 5, replacing Ravi as owner, with the same Friday, October 9th deadline. (owner: Pam)
- The notification backlog runbook moved from Pam to Me and is due Thursday, September 24th. (owner: Me)
- The oldest-message-age paging threshold for notifications.v2 was changed from 120 seconds to 180 seconds for 5 minutes; the other alert thresholds remain unchanged. (owner: Pam)
- Ravi will proceed with the five-working-day SQS/SNS prototype instead of writing the Kafka spike plan. (owner: Ravi)
- The outbox-pattern work in notify-gateway will remain assigned to Joaquin despite his return from leave on October 21st. (owner: Joaquin)

#### Open questions (structured)
- The team still needs to determine how to address the elevated post-fix p99 latency of 3.4 seconds, which Sam attributed to prefetch. [open]
- The architectural changes needed to prevent a recurrence had not yet been resolved in this chunk. [open]
- The team had not yet determined how to improve deployment safety for notif-worker, which bypasses the canary pipeline. [open]
- Whether to resend the approximately 2,300 notifications that were written to Postgres but never published remains unresolved. [open]
- The actual MSK cost, including storage, data transfer, broker sizing, provisioned throughput, and cross-AZ replication traffic, remains to be validated. [open]
- Whether the migration can be completed and adequately soaked within the six-week window before October 23 remains uncertain. [open]
- The appropriate MSK broker size for peak traffic has not been finalized. [open]
- Whether SQS can be prototyped and delivered before the October 23 freeze remains unresolved. [open]
- Whether any insurance-card reminder payloads exceed SQS's 256 KB limit remains unknown. [open]
- The appropriate idempotency design remains unresolved after the proposed Redis SETNX approach was challenged. [open]
- Whether storing oversized payloads in S3 is acceptable despite creating another location for PHI remains unresolved. [open]
- The final broker option has not yet been selected because Grace had not joined the discussion. [open]
- It remains unresolved whether Twilio's 100-message-per-second short-code limit is hard or could be increased for peak season. [open]
- The team has not assigned an owner for investigating whether notify-gateway should throttle very large clinic uploads. [open]
- The SQS/SNS migration decision remains deferred until the January 13 architecture review. [open]
- Should the 2,300 notifications that were never sent be resent, handled through another patient-contact method, or left unresolved? [open]
- Is Twilio's 100-per-second limit specific to the short code or the account, and can it be raised for peak periods? [open]
- Do any insurance-card email payloads exceed the 256 KB limit? [open]
- Does the quorum-queue migration require a maintenance window, or can it be performed live with a shovel? [open]
- Should large per-clinic uploads be throttled at notify-gateway? [open]
- Should email and SMS use separate notif-worker deployments? [open]

#### Risks (structured)
- [high] Immediate requeueing of retryable provider errors created a retry storm against Twilio, reaching a 38% 429 rate.
- [high] The missing dead-letter policy caused failed messages to be requeued indefinitely, leaving the DLQ empty since March 2024.
- [high] The prefetch increase from 10 to 200 caused pods to hold more unacknowledged messages, contributing to OOM kills and redelivery amplification.
- [high] notif-worker deployments go directly to all replicas because the service is not in the Argo Rollouts canary pipeline.
- [medium] KEDA scaled notif-worker from 8 to the maximum of 40 pods as queue depth rose, creating an additional scaling behavior that needs evaluation.
- [high] The incident caused substantial customer impact, including 312 affected clinics, approximately 61,000 late reminders, and 9,400 patients receiving duplicate SMS messages.
- [high] The Northgate Medical Group batch uploaded 240,000 reminders at once, triggering the incident when combined with inline retries.
- [high] Inline retries had no backoff, while prefetch was 200 and no DLQ was configured, amplifying the failure.
- [high] KEDA scaled notif-worker from 8 to 40 pods, producing up to 240 attempted sends per second against Twilio's 100-message-per-second short-code limit.
- [high] OOM kills after Twilio acceptance but before RabbitMQ acknowledgement caused redelivery and approximately 9,400 duplicates because no send-side idempotency check exists.
- [high] Publisher-confirm timeouts left approximately 2,300 notifications permanently queued in Postgres without corresponding RabbitMQ messages.
- [high] The team has only about six weeks before the October 23 code freeze, and migration work must be completed and soaked before then.
- [medium] Engineering capacity is constrained to four engineers, with Joaquin on parental leave until September 21, while Pam is shared across three teams and realistically available about half-time.
- [high] The initial MSK estimate of $1,900 per month excluded data transfer and assumed brokers that may be undersized for peak bursts; a more realistic estimate was approximately $5,200 per month.
- [high] The messaging budget ceiling is $6,000 per month, leaving limited room if the revised MSK estimate is accurate.
- [high] Notification payloads contain PHI and must meet AWS BAA, customer-managed KMS encryption, and a maximum 14-day broker-retention policy.
- [medium] RabbitMQ inter-node traffic is still not using TLS, and the auditor's remediation item is open until the end of the year.
- [high] MSK would cost about $9,000 per month during dual-run, exceeding the $6,000 ceiling by roughly 50%.
- [high] Kafka migration was estimated at 10 to 12 weeks for two people, likely missing the October 23 freeze and entering mid-November open enrollment.
- [high] SQS standard queues are at-least-once and unordered, requiring idempotency; FIFO queues introduce throughput limits that would need design work.
- [high] Moving large payloads to S3 to work around SQS's size limit could increase PHI exposure across storage locations.
- [high] The outbox relay and Kafka or SQS delivery paths are at-least-once, so missing consumer idempotency could still produce duplicate sends.
- [high] A 24-hour Redis idempotency TTL is insufficient because quiet hours, weekends, and retry backoff can extend legitimate retries to 72 hours.
- [high] Twilio's 100-message-per-second limit can be exceeded if autoscaling is not constrained and rate-limited.
- [high] The existing 24-hour Redis idempotency TTL would not cover retries delayed up to 72 hours by backoff and quiet hours.
- [high] The October 23 freeze and November 1 open-enrollment start leave limited time for peak-season reliability work.
- [high] The $6,000 monthly messaging ceiling rules out Kafka's estimated $9,000 dual-run month and makes its $5,200 steady-state cost difficult relative to the approved ceiling.
- [high] The incident revealed that the dead-letter queue had been effectively disabled since at least March 2024 because of a hyphen-versus-dot Terraform policy pattern typo.
- [medium] Large clinic uploads can create legitimate but lengthy queue-draining periods, as shown by Northgate putting 240,000 messages into the queue in about four minutes.
- [high] Kafka would not address the underlying retry-storm consumer design problem and the team lacks sufficient Kafka operations experience.
- [high] The 2,300 unsent notifications create a patient-safety concern because stale reminders may be inappropriate.
- [medium] Paging at 120 seconds would have generated nightly false alarms during the 02:00 next-day-appointment batch and risked alert fatigue.
- [medium] The quorum-queue migration's maintenance-window requirement is unknown, creating deployment planning uncertainty.
- [medium] The Twilio throughput limit may constrain peak SMS delivery because its scope and upgradeability are unknown.
- [medium] The maximum insurance-card email payload size is unknown relative to the 256 KB limit.

#### Follow-up draft
Subject: Follow-up: Notification outage reliability plan

Hi team,

Thanks for the thorough review of the notification outage and peak-season reliability options. We aligned that the incident was a retry storm triggered by the Northgate upload, with inline retries as the root cause, and that RabbitMQ will remain in production through peak season with delayed backoff, dead lettering, quorum queues, the broker upgrade, Postgres-backed idempotency, and rate-limited autoscaling; Kafka was rejected for peak, with SQS/SNS deferred to the January 13 architecture review. The key open question is how we should handle the approximately 2,300 notifications that were written to Postgres but never published, given the risk of sending stale reminders.

Best,
