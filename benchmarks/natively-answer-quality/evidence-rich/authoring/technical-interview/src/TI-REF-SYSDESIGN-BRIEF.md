# System design exercise: candidate brief

Version 2.1 · issued 29 September 2026 · replaces version 2.0

You will be asked to design one of the two systems below; the interviewer chooses on the day. The requirements are fixed. Anything not stated here is yours to decide, and you should say your assumptions out loud.

Conventions for all sizing in this brief: a month is 30 days, a day is 86,400 seconds, and storage uses decimal units (1 kB is 1,000 bytes, 1 TB is 1,000 GB).

## System A: short-link service

A service that turns a long URL into a short one and redirects visitors who open the short link.

### Scale

| Requirement | Value |
|---|---|
| New links created | 120 million per month |
| Read to write ratio | 200 redirects for every link created |
| Peak load | 4 times the average, for reads and for writes |
| Stored size of one link record | 500 bytes, indexes included |
| Click event size | 120 bytes per redirect |

### Service levels

| Requirement | Value |
|---|---|
| Redirect latency | p99 of 80 ms, measured at our edge |
| Link creation latency | p99 of 300 ms |
| Availability of redirects | 99.95% per month |
| Availability of the creation API | 99.9% per month |

### Retention

- Links are kept for 5 years from creation, then deleted.
- Click events are kept for 90 days.

### Constraints

- Short codes are 7 characters from a 62-character alphabet (a to z, A to Z, 0 to 9).
- Custom aliases are allowed, up to 32 characters.
- A link's destination cannot be edited after creation. A link can be deactivated, and a deactivated link must stop redirecting everywhere within 60 seconds.
- Every new destination is checked against a malware blocklist before the link becomes active.
- Two regions, both serving traffic.
- No more than three storage technologies in the design.

## System B: notification system

A platform service that other product teams call to send push notifications, emails and text messages to end users.

### Scale

| Requirement | Value |
|---|---|
| Registered users | 40 million |
| Daily active users | 9 million |
| Notifications sent | 180 million per day |
| Channel mix | 70% push, 25% email, 5% SMS |
| Peak load | 6 times the average, during campaign bursts |
| Delivery log entry size | 400 bytes |

### Service levels

| Requirement | Value |
|---|---|
| Transactional notifications | handed to the provider within 2 seconds at p99 |
| Promotional notifications | handed to the provider within 15 minutes |
| Availability of the send API | 99.9% per month |

### Retention

- Delivery logs: 30 days in hot storage, then 13 months in an archive.
- User preferences: kept for the life of the account.

### Constraints

- At most 3 promotional notifications per user per day, across all channels.
- Quiet hours from 22:00 to 08:00 in the user's local time apply to promotional notifications only.
- Transactional notifications are one-time codes and security alerts; they bypass the daily cap and the quiet hours.
- Delivery is at-least-once; callers pass a deduplication key that must be honoured for 24 hours.
- The SMS vendor accepts at most 500 messages per second and charges USD 0.004 per message.
- The push provider accepts at most 20,000 requests per second.

## How the session is assessed

| Area | Weight |
|---|---|
| Clarifying requirements and stating assumptions | 15% |
| Capacity estimates | 20% |
| High-level design | 30% |
| Deep dive on one component | 25% |
| Trade-offs and failure handling | 10% |

Bring your estimates as numbers, not as adjectives. Round sensibly and show the arithmetic.

## Changes in version 2.1

- System B added.
- Sizing conventions stated at the top.
