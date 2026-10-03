# Ostrakel - Ledger Core prep

Started 30 Aug 2026, last touched 29 Sep 2026. For my eyes only.

## Where my head is

I'm not running away from Quillhaven. I like the team, and Charuhas has been a good manager to me. Two things have changed.

First, the platform work is finished. Skeinrouter shipped in February 2025 and since then Dispatch Core has mostly wired up integrations for individual carriers. I counted the 2026 roadmap: 11 of 14 items are carrier integrations. Useful to the business, but it is the same adapter again and again.

Second, there is nowhere to go as an engineer. Our ladder has no Staff level. After Senior / Tech Lead the next rung is Engineering Manager.

Tessarine, if it comes up: I left in February 2023 because the company had been acquired the autumn before and backend architecture decisions moved to the parent's platform group. After that I was implementing someone else's tickets.

## What I want next

A small group of senior engineers, under ten, who write the design down before building and who run what they build. A domain where being wrong is expensive.

On leading, written 30 Aug: open to the EM track if that turns out to be the only way up. (No longer true. See the updates at the bottom.)

## Practical stuff

### Notice

60 days, per my offer letter from March 2023 (clause 8.1). [30 Aug]

### Money

I don't have a number yet and I don't want to name one first. The posting says the L5 band is shared on the recruiter call, so ask for the band and react to that. Fixed pay matters more to me than options; if pushed, say only that. Do not improvise a figure.

## Where I'm thin

Java. I have never shipped Java to production. I wrote Kotlin on the JVM for my whole time at Tessarine and I read Java comfortably (I spent a fortnight inside the Debezium connector source during Marrowgate). Not the same thing. Since mid-September I've been rewriting one job of my toy ledger in Java 21 with Spring Boot, evenings only.

Payments. No professional experience, none. The closest real work is the seat-inventory fix at Tessarine, where a double booking meant a refund and an angry passenger at a bus stand at 5 am. That is honestly why the domain pulls me: the bugs that stayed with me were the ones where a number was wrong, not the ones where a page was slow. To check that I actually like it I built tallybook over three weekends in August, a small double-entry ledger in Go with idempotency keys on the transfer endpoint. Not on the CV. Call it a weekend project, never experience.

PCI DSS: never worked under it. Don't bluff.

## The thing I'm working on

I hold on to the critical path. On Skeinrouter I reviewed every change to the delivery path myself, and by late 2025 I was the bottleneck: the median wait for a review on those pull requests was 2.5 days. Tanmayi finally said it to me in a retro. Since January 2026 two engineers are designated approvers for the delivery path and I only review design-level changes. The median wait is now about 7 hours.

## Things that actually happened

### The partition key argument (July 2024)

Ilakkiya Senthurvel, staff engineer on Platform, reviewed the Skeinrouter design and wanted the main topic keyed by carrier ID, so that rate limiting fell out for free. I wanted shipment ID. My worry was skew: our top 3 carriers produce 38% of all events, so carrier keys meant a few very hot partitions. We argued in doc comments for a week and got nowhere. What ended it was data: I replayed two days of production traffic through both schemes; with carrier keys the busiest partition ran 14 minutes behind at peak, with shipment keys nothing was more than 2 seconds behind. Her rate-limiting point was right, though, so I built a per-carrier throttle into the webhook delivery layer. She is now the first person I ask to tear a design apart. Lesson: propose the experiment on day one, not day seven.

### The rebalance storm (Tuesday 19 November 2024)

This one is on me. The Friday before, I approved an autoscaling change for the tracking consumers without trying a scale-down first, because I wanted it in before the next batch of carriers switched. We were in week six of the per-carrier rollout, with about 1,100 carriers already on the new pipeline. On Tuesday traffic dipped and spiked, pods came and went, and every change triggered a full rebalance. I was incident commander; we pinned the replica count by hand to stop it. I wrote the postmortem myself and named my own approval as the gap. Besides the rebalancing fix that's on the CV, the lasting change is a rule: any scaling change to a consumer group needs a rebalance drill in staging first. For me: schedule pressure is exactly when to stop and ask how it fails.

### Marrowgate and the hosting contract (early 2024)

The hosting contract for the old MySQL cluster ended on 29 February 2024 and the vendor only renewed in twelve-month terms, so slipping meant a year's rent on a cluster we were leaving. Three weeks before the planned cutover the nightly checksums still failed on 2 tables: a DATETIME column that MySQL stored in local time and PostgreSQL read as UTC. I got product to agree to a schema freeze for three weeks, and I split the checksum job per shard, which took a run from 9 hours to 3 and let us fix and verify every night. Bhargav, our DBA, found the conversion bug on the fourth night. We cut over on Sunday 11 February 2024.

### Tanmayi and the pager

Tanmayi Rekulvara joined Dispatch Core as a new graduate in July 2024. On her first shadow shift she froze during a Sev-2 and told me afterwards that on-call wasn't for her. She shadowed me for two rotations, then we did two with roles reversed: she held the pager and I spoke only when asked. I also gave her the monthly game-day drill to run. She was incident commander for the first time in August 2025, on a Sev-2. She was promoted in April 2026.

## Updates

22 Sep - Management. I covered Charuhas's one-to-ones and the mid-year appraisal write-ups for six weeks while he was on leave in July and August. Fine at it, didn't enjoy it: almost no design, no code. Decided: no line management for at least the next two or three years. I want to stay hands-on, lead designs, guide a few engineers and aim at Staff.

27 Sep - Notice. Checked with Roshni in People Ops. The offer letter is out of date for me: since my promotion I am on the senior grade, and that grade serves 90 days. No buyout, she was clear. So it runs from the day I resign and it is not the figure I wrote above.

29 Sep - Recruiter confirmed the coding round for Thursday 8 October.
