# Skeinrouter: design document

| | |
|---|---|
| Version | 0.3 |
| Date | 9 May 2024 |
| Status | In review |
| Author | Advik Thorambath, Dispatch Core |
| Reviewers | Platform Architecture group, Data Infrastructure |

## 1. Summary

We propose to replace the cron-polled tracking module of the monolith with an event pipeline on Kafka, called Skeinrouter. The module today tops out at about 9,000 events per second and falls behind at peak, and every update reaches the customer up to a minute late. This document sets out the proposed design, the sizing and the delivery plan for the architecture forum on 16 May 2024.

## 2. Goals and non-goals

Goals

- Carry 25,000 events per second at peak, a little under three times today's ceiling.
- p99 end-to-end latency of 250 ms from carrier event to updated shipment.
- No lost tracking updates during deploys or broker failures.

Non-goals

- Replaying history. Events only need to survive long enough to be processed.
- Changing the carrier-facing webhook contract.

## 3. Proposed design

Three services written in Go 1.21:

| Service | Role |
|---|---|
| ingest | Receives carrier events and produces them to the main topic |
| processor | Consumes the main topic, updates shipment state and calls carrier webhooks |
| notifier | Sends shipper notifications by email and in the app |

### 3.1 Kafka

A new MSK cluster with 3 brokers, one per availability zone. The main topic has 24 partitions keyed by carrier ID, so that all events of one carrier are handled by one consumer and its rate limits are easy to respect. Retention on the main topic is 24 hours, in line with the non-goal above.

### 3.2 Delivery semantics

Exactly-once processing, using transactional producers and read-committed consumers, so that the processor never applies an event twice. Webhooks are called directly from the processor after the state update; this design has no separate relay for outgoing messages.

### 3.3 Shipment state

Shipment state moves to Amazon DynamoDB with on-demand capacity, one item per shipment. The dispatch datastore is in the middle of its own migration and we would rather not add a write-heavy workload to it this year. A relational store was considered and set aside for that reason.

## 4. Sizing

| Item | Estimate |
|---|---|
| Peak target | 25,000 events per second |
| Partitions on the main topic | 24 |
| Brokers | 3 |
| Processor instances | 8 |
| Monthly running cost | USD 5,400 |

The partition count follows from the processor: a spike measured about 1,100 events per second per partition, so 24 partitions cover the peak target with a small margin.

## 5. Delivery plan

- Team: 3 engineers from Dispatch Core.
- Build: June to August 2024.
- Shadow run: 2 weeks of shadow traffic in early September 2024.
- Cutover: a single cutover for all carriers on Sunday 22 September 2024, with the cron module kept on standby for one week.
- Estimated completion: end of September 2024.

## 6. Risks

- A large carrier could dominate one partition. Mitigation: monitor partition skew and split that carrier's traffic if it passes 15% of the total.
- Hot keys in the state store for shipments with very frequent updates.
- Transaction overhead on the producer path, to be measured in a spike before the build starts.

## 7. Open points for the review

- Whether 24 partitions leave enough room to grow without a repartition.
- Whether the processor should own webhook delivery or hand it to a separate service.
- Who carries the pager for the MSK cluster.

## 8. Revision history

| Version | Date | Change |
|---|---|---|
| 0.1 | 22 April 2024 | First outline |
| 0.2 | 2 May 2024 | Sizing and delivery plan added |
| 0.3 | 9 May 2024 | Delivery semantics and risks added |
