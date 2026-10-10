# Skeinrouter: deep-dive notes

Advik Thorambath · Dispatch Core, Quillhaven Freight Systems
Last updated 18 September 2026

My working notes on Skeinrouter, kept for design reviews and onboarding. Figures come from our Grafana boards and the post-incident review of November 2024.

## 1. What it replaced

Tracking updates used to come from a cron job inside the monolith that polled carrier integrations every 60 seconds. It topped out at about 9,000 events per second and fell behind most weekday afternoons. Skeinrouter took over that job between June 2024 and February 2025.

## 2. Services and boundaries

Five services, all Go 1.22, each with one job.

| Service | What it does |
|---|---|
| carrier-gateway | Terminates carrier integrations: push APIs for 61% of carriers, polling adapters for the rest. Validates, stamps an event ID and produces to tracking.raw. |
| normalizer | Maps 14 carrier status vocabularies onto our 9 canonical shipment states. |
| shipment-projector | Applies each event to shipment state in PostgreSQL and writes the outbox row in the same transaction. |
| outbox-relay | Reads the outbox every 200 ms with SKIP LOCKED and publishes to webhook.outbound. |
| webhook-dispatcher | Delivers status webhooks to carriers and shippers: 5 attempts with exponential backoff, then the dead-letter topic. |

The rule we do not bend: shipment-projector is the only writer of shipment state. The monolith reads it through a gRPC read API and no longer writes it.

## 3. Traffic

| Measure | Value |
|---|---|
| Typical weekday volume | about 480 million events |
| Average over a full day | about 5,600 events per second |
| Daytime plateau, 10:00 to 18:00 IST | 13,000 to 15,000 events per second |
| Peak sustained | 41,000 events per second |
| Average event size on tracking.raw | 1.1 kB |
| Shipments in transit at any moment | about 310,000 |

The 41,000 figure was first reached in the capacity run of 14 January 2025.

## 4. Kafka topology

Amazon MSK on Kafka 3.6: 6 brokers across 3 availability zones, replication factor 3, min.insync.replicas 2, producers with acks=all and idempotence on.

| Topic | Partitions | Key | Retention | Consumers |
|---|---|---|---|---|
| tracking.raw | 48 | shipment ID | 7 days | normalizer-cg, 12 pods |
| tracking.normalized | 48 | shipment ID | 3 days | projector-cg, 16 pods; analytics-sink-cg |
| webhook.outbound | 16 | carrier ID | 48 hours | dispatcher-cg, 8 pods |
| tracking.dlq | 6 | shipment ID | 14 days | replay tool, run by hand |

Why 48 partitions: one projector consumer sustains about 1,400 events per second on a single partition, because it is bound by the database commit. At the peak we planned for, that means at least 30 partitions. We went to 48 for headroom and because 48 divides evenly across both 12 and 16 pods.

## 5. Database choices

- Shipment state lives in PostgreSQL 15 on Amazon RDS, in the cluster we had moved to during Marrowgate. The shipment_state table is hash-partitioned into 32 partitions.
- The outbox table is partitioned by day; a partition is dropped once it is 3 days old.
- The deduplication table, processed_events, is keyed on event ID and carrier ID. Rows expire after 10 days, deliberately longer than the 7-day retention of tracking.raw, so that a full replay of the topic is still deduplicated.

Considered and rejected: a managed key-value store for shipment state. The outbox needs one transaction covering the state change and the outgoing message, and the shipments in transit fit in memory on one PostgreSQL primary.

## 6. Why Kafka, and what we turned down

- Per-shipment ordering comes from the partition key, with no coordination between consumers.
- Replay: events stay on the topic, so a fixed consumer can reprocess history. We have replayed twice, once after a normalizer mapping error and once to backfill the analytics sink.
- Consumer groups scale by adding pods, and the team already ran MSK for the Marrowgate backfill.

Turned down:

- Amazon SQS FIFO queues: a throughput ceiling per message group and no replay.
- RabbitMQ: no replay, and strict ordering needs a single consumer per queue.
- Partitioning the main topic by carrier: the largest carrier alone is 9% of traffic, which would have made one partition permanently hot.
- Kafka's own exactly-once transactions: our sinks are PostgreSQL and external webhooks, which those transactions do not cover. We run at-least-once delivery with idempotent consumers instead.

## 7. When a consumer fails

Offsets are committed only after the database transaction commits. If a pod dies mid-batch, its partitions move to another member of the group, which re-reads from the last committed offset. At most one batch (up to 500 records) is processed again, and the deduplication table turns those repeats into no-ops, so nothing is lost and nothing is applied twice. A record that fails 3 times goes to tracking.dlq with its error. Under pressure we pause partitions once more than 2,000 records are in flight rather than drop anything.

## 8. The November 2024 incident

Tuesday 19 November 2024, in the fourth week of the per-carrier rollout, with 720 carriers already live on the new pipeline.

| Time (IST) | What happened |
|---|---|
| 14:05 | Rolling restart of the 16 projector pods begins for a routine deploy. Lag on tracking.normalized starts to climb. |
| 14:20 | Sev-2 declared; I take incident command. |
| 15:30 | Raised to Sev-1. Lag peaks at 96 million events; the worst-hit shipments are 47 minutes behind. |
| 16:10 | Deploy paused, group scaled down to 8 pods, max.poll.interval.ms raised from 30 seconds to 5 minutes. The group stabilises. |
| 17:45 | Backlog drained, tracking current again. Incident closed after 3 hours 40 minutes. |

Root cause: the group still used eager rebalancing, so every pod restart stopped the whole group. While the database was absorbing the backlog, a batch could take longer than the 30-second max.poll.interval.ms, members were evicted for being slow, and each eviction triggered another rebalance: a rebalance storm. No events were lost and nothing was rolled back; the deduplication table kept duplicates out.

Follow-up, finished on 6 December 2024: every consumer group moved to cooperative rebalancing with static membership, rolling restarts go one pod at a time behind a lag gate of 200,000 events, and consumer lag has a burn-rate alert.

## 9. Latency

End to end, from the carrier event arriving to shipment state committed: p50 38 ms, p99 140 ms (the old module: 870 ms). The p99 budget is 15 ms in carrier-gateway, 25 ms in normalizer and 100 ms in shipment-projector, where the PostgreSQL commit dominates.

## 10. Deployment and rollout

- Amazon EKS on Kubernetes 1.29 in ap-south-1; Terraform for infrastructure, Argo CD for releases, with a canary of 5% of pods for 20 minutes.
- Shadow traffic for 6 weeks, 16 September to 27 October 2024. Output was compared with the old module; mismatches fell from 0.3% in the first week to under 0.002% in the last.
- Per-carrier flags over 9 weeks, 28 October to 29 December 2024. No carrier was moved back.
- The cron module was switched off on 3 February 2025.
- Running cost is about USD 9,300 a month, against USD 6,100 for the old polling workers.

## 11. Measured outcome

- Peak throughput from 9,000 to 41,000 events per second; p99 from 870 ms to 140 ms.
- Updates already more than 2 minutes old on arrival: from 7.5% to 0.4%.
- Duplicate status webhooks: from 0.6% of deliveries to under 0.01%.
- Support tickets about late tracking: from 430 a month to 95.
