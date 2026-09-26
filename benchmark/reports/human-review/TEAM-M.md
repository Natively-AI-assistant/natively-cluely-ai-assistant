# TEAM-M — team_meeting, long (49.3 min, 6738 words)

**Source transcript:** `benchmark/transcripts/src/TEAM-M.txt`  
**Reference fact sheet:** `benchmark/references/TEAM-M.json`  
**Context:** Weekly launch-readiness meeting at Tallyport, a fictional B2B SaaS company, for the usage-based billing v2 launch, run by engineering manager Dana Okafor on Thursday, September 17. The product, design, backend and QA leads go through workstream status, argue about the launch date and plan the staged rollout. A customer success lead joins partway through to escalate an overbilled customer.

## What a good summary must include
- Launch moved from October 6 to Wednesday October 14, with an automatic slip to October 20 if ledger 3.4 isn't in production by October 2 (F36, F37)
- Blocker: Payments Platform ledger API 3.4 idempotency, contact Sunil Varghese, targeting September 29; Dana escalating with Grace Obi (F16, F17, F69)
- Bug status: 2 Sev-1 (dedup double count, proration), 7 P1, 23 P2, 41 P3 (F18, F19)
- Dedup fix with idempotency keys merged by September 25 (Viktor) (F12, F13)
- Kestrel Logistics escalation: $410,000 ARR, overbilled $18,240; credit memo by Sept 21 (Joel), root cause to Joel by Sept 22, call Sept 23; excluded from automatic rollout (F42, F44, F47, F48, F50)
- Rollout starts at 5% for the first 48 hours with shadow reconciliation (reversed from 10%), then 25% Oct 19, 50% Oct 21, 100% Oct 26 (F52, F53)
- Rollback drill October 8 (Maya); go/no-go meeting October 12 (F57, F58)
- Legal review of the order form addendum NOT done (only the privacy review is); Rohan chasing Joelle Park for September 30 (F61, F62)
- Migration runbook now owned by Maya, due September 28; dry run done on 3 of 12 shards (F24, F25)
- Invoice preview p95 launch bar is 1.2 seconds (currently 1.4 seconds) (F08, F09)
- Empty state (sample data vs checklist) undecided; usability results on September 24 (F29, F31)
- Help center update and Salesforce fractional-quantity check have no owner; next checkpoint Thursday September 24 at 10:30 (F67, F68, F70)

## Most important disagreements (judge fact checks)

✔ present · ◐ partial · ✘ missing · ⚠ contradicted

| Fact | Imp. | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|
| F52: The first rollout stage on October 14 is 5% of eligible accounts (about 39) for the first 48 hours, and every account in that cohort is reconciled against v1 shadow rating before expanding. | critical | ? | ✔ | ? | ⚠ | ✔ | ✔ |
| F25: Maya owns writing the migration runbook, due Monday, September 28, with a brain-dump session from Viktor tomorrow at 2. | critical | ? | ⚠ | ? | ⚠ | ⚠ | ✔ |
| F17: The Payments Platform contact is Sunil Varghese, who said they are targeting (not committing to) September 29 for ledger 3.4. | critical | ? | ⚠ | ? | ✔ | ✔ | ✔ |
| F31: Ines will show both empty-state variants in usability sessions with 5 customers on Tuesday and Wednesday next week and share results on Thursday, September 24. | important | ? | ⚠ | ? | ◐ | ✔ | ◐ |
| F34: Viktor wanted to launch October 20 to get two full weeks of end-to-end ledger integration testing after Sunil's release. | important | ? | ⚠ | ? | ✘ | ✘ | ✔ |
| F66: Rohan will email the 14 beta customers, who were told October 6, about the new date by Tuesday, September 22. Kestrel Logistics is excluded because Joel's call covers it. | important | ? | ✔ | ? | ⚠ | ✔ | ✔ |
| F01: The meeting is the weekly launch-readiness check for usage-based billing v2, held on Thursday, September 17. | important | ? | ✘ | ? | ✔ | ◐ | ◐ |

## Judge-flagged problems

**A:** (not judged)
**B** — overall 5/10, accuracy 6, retention 8, conciseness 3
- critical: Incorrectly states the migration runbook is due October 28 instead of September 28.
- critical: Incorrectly states Ines's usability session results are due October 24 instead of September 24.
- critical: Incorrectly states Payments Platform is shipping its ledger change on October 29 instead of September 29.
- critical: Contradicts itself on the owner of the migration runbook, assigning it to Viktor in some places and Maya in others.
- hallucination: October 28 as the deadline for the migration runbook.
- hallucination: October 24 as the deadline for the usability session results.
- hallucination: October 29 as the delivery date for the Payments Platform ledger change.
- superseded value: C04 → The team assigned Viktor a migration runbook due October 28

**C:** (not judged)
**D** — overall 4/10, accuracy 4, retention 8, conciseness 3
- critical: Contradicted the launch date by stating the 48-hour rollout window and launch-week on-call start on October 13th instead of October 14th.
- critical: Reported October 22nd as the deadline for Rohan's beta customer email, but it should be September 22nd.
- critical: Listed Maya building the rollout plan around 10% as an action item, even though this was explicitly reversed to 5%.
- critical: Listed Viktor as the owner of the migration runbook in Decisions and Action Items, contradicting the decision to reassign it to Maya.
- critical: Hallucinated an action item for Ines to mock up a middle empty-state option, which was not agreed upon.
- critical: Included numerous non-actionable facts and dates as '[inferred]' action items.
- critical: The Summary section contains a truncated bullet point ('while invoice preview p9').
- hallucination: Ines: Mock up a middle empty-state option combining a setup checklist with a small preview thumbnail of a populated dashboard.
- hallucination: October 13th as the start of the 48-hour rollout window.
- hallucination: October 22nd as the deadline for the beta customer email.
- superseded value: C04 → Build a real runbook for the migration before touching the other nine shards, due Monday the 28th. (owner: Viktor)
- superseded value: C05 → Maya: Build the rollout plan around 10% of eligible accounts on day one.
- suggestion reported as decision: Ines mocking up a middle empty-state option.

**E** — overall 5/10, accuracy 4, retention 8, conciseness 4
- critical: The notes contradict themselves on the owner of the migration runbook, assigning it to both Viktor and Maya.
- critical: The notes list the launch date, rollout percentage, and preview latency as final decisions, but simultaneously list them as unresolved in the Open Questions section.
- critical: The notes state the first rollout stage is set at 10%, then immediately state it will start with 5%.
- superseded value: C04 → Viktor will own a real migration runbook and deliver it by the 28th
- superseded value: C05 → The first rollout stage is set at 10% of eligible accounts on October 14
- superseded value: C02 → What launch date will be selected among October 6, October 13, and October 20? [open]
- superseded value: C03 → Whether invoice preview should be supported for the approximately 60 large accounts at launch, and whether its 1.4-second p95 latency is acceptable. [open]

**F** — overall 4/10, accuracy 8, retention 7, conciseness 1
- critical: Failed to map speaker labels ('Me', 'Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4') to their actual names in many places throughout the notes.


---

# Summary A

_(no valid run)_

(no summary was produced)

---

# Summary B

_(run1)_

### Title: Usage-Based Billing v2 Readiness Review

#### Overview
Backend throughput exceeds target, but invoice preview latency, deduplication and ledger idempotency, QA defects, staging capacity, and an undocumented migration process remain launch-readiness concerns. The team assigned Viktor a migration runbook due October 28, kept the dashboard empty-state decision open for customer testing, agreed to a 1.2-second p95 launch bar, and deferred full hourly pre-aggregation. The team set October 14 as the billing launch date with an October 2 Payments tripwire, reassigned the migration runbook, addressed Kestrel Logistics' $18,240 overbilling, and challenged the initial 10% rollout size. The team agreed on a staged rollout beginning at 5% with reconciliation and defined rollout, rollback, legal, enablement, and escalation actions, while leaving several ownership and dependency questions open. The team left renewal and replay-coverage questions open, assigned follow-up materials for the next checkpoint, and moved that checkpoint to September 24 at 10:30. Key decisions: Usage charts will use the account's billing time zone rather than the viewer's browser time zone.; The team will not decide the no-idempotency-key fallback until beta traffic shows how many requests arrive without a key.; A real migration runbook must be created before the remaining nine shards are migrated.. Progress since last sync: The metering pipeline sustained 42,000 events per second for two hours in Tuesday's staging load test, exceeding the 30,000-events-per-second target.

#### Summary
- The metering pipeline sustained 42,000 events per second for two hours in Tuesday's staging load test, exceeding the 30,000-events-per-second target.
- Backend throughput exceeds target, but invoice preview latency, deduplication and ledger idempotency, QA defects, staging capacity, and an undocumented migration process remain launch-readiness concerns.
- Usage charts will use the account's billing time zone rather than the viewer's browser time zone.
- The team will not decide the no-idempotency-key fallback until beta traffic shows how many requests arrive without a key.
- Invoice preview p95 latency is 1.4 seconds for large accounts against an 800 ms target, affecting roughly 60 accounts.

#### Progress since last sync
- The metering pipeline sustained 42,000 events per second for two hours in Tuesday's staging load test, exceeding the 30,000-events-per-second target.
- Consumer lag stayed below approximately nine seconds during the load test using 48 partitions, increased from 24 last sprint.
- Rating-engine unit-test coverage reached 81%, while metering-service coverage is 67% because replay tooling has almost no tests.
- Finance approved invoice-line-item half-even rounding on Monday, replacing v1's per-event rounding behavior.
- The idempotency-key deduplication pull request is approximately 70% complete, and Node and Python SDKs already send keys.
- The Go SDK is scheduled to receive idempotency-key support next week, while the Java SDK has not started the work.
- The regression suite has 1,312 tests after approximately 140 additions this sprint, with a 96.4% pass rate on the latest run.
- Migration dry runs completed successfully on three of twelve shards, averaging 38 minutes per shard with zero reconciliation mismatches.
- The usage dashboard is about 90% built, with only the export button and meter drill-down remaining on the front end.
- The dashboard accessibility audit found two chart-legend color-contrast issues, and both have been fixed.
- The existing migration materials consist of a Slack thread and Google document rather than a usable runbook.
- Replay currently has 12 tests, described by Viktor as good tests.
- The dashboard preview currently reaches 1.4 seconds p95 on big accounts before the proposed caching fix.
- Internal Tallyport has been dogfooding the new flag at 100% for three weeks, while 14 beta accounts are also enabled.
- The current enabled population is approximately 1.8% of 780 eligible accounts.
- Viktor's idempotency-key fix is in progress and is expected to be merged by September 25.
- The idempotency-key fix is intended to cover retries at any delay up to 24 hours.
- Kestrel Logistics' August usage invoice was found to be overbilled by $18,240, and Finance confirmed the amount the previous day.
- The overbilling affected only the shipment-tracking API meter, while the warehouse and fleet subsidiary meters were unaffected.
- The planned rollout sequence was 10%, then 25%, 50%, and 100% by the end of October.
- The privacy review for storing raw usage events is approved, while the legal review of the order-form addendum remains open.
- The sales deck has been updated, and pricing-page copy is with marketing for launch day.
- All 14 beta customers were previously told about October 6, so the team needs to communicate the revised October 14 timing directly.
- The preview remains in the pricing-page messaging with a 1.2-second target.
- The legal review covers usage terms, overage billing, metered-usage disputes, and a 30-day usage-charge contest window.
- The team identified that replay tooling coverage was never defined and remains an open item.
- The current test suite has 12 tests whose uncovered areas still need to be documented.
- The no-key deduplication fallback approach has not yet been selected because beta traffic without idempotency keys is still unknown.

#### Decisions
- Invoice line items will use half-even rounding at the invoice-line level rather than rounding each event.
- Usage charts will use the account billing time zone so chart boundaries align with invoices.
- The no-key deduplication fallback will remain undecided until beta traffic is examined.
- The invoice-preview scope for large accounts will be handled as part of the launch-date discussion rather than decided in the backend status update.
- The remaining nine migration shards will not be touched until a proper runbook exists.
- CSV rather than XLSX will be the dashboard export format at launch.
- The empty-state choice is deferred pending customer research on variants A and B.
- The launch performance threshold is set at 1.2 seconds p95 for big-account previews.
- Full hourly pre-aggregation is explicitly deferred from launch and has no committed date.
- The launch date is October 14, with October 20 as the automatic fallback if ledger 3.4 misses the October 2 production tripwire.
- The team will not conduct an October 7 early-access launch.
- Sev-1 closure requires staging verification plus a failing-first regression test, not merely a merged change.
- Kestrel Logistics will receive an $18,240 invoice credit and will be migrated outside the automatic rollout after its data verifies the fix.
- The staged rollout will start at 5% rather than 10%, run for 48 hours, and require shadow-rating reconciliation before expansion.
- The first cohort will contain small and mid-size monthly-billed accounts and exclude accounts over 2 million events.
- The rollout will pause for unexplained per-account total differences above 0.5%, but it will not automatically roll back.
- Kestrel Logistics will be excluded from rollout cohorts.
- The go/no-go meeting will occur on October 12 with the existing group plus Joel.
- The status page will not be used for the invoice-format product announcement.
- The next checkpoint was rescheduled from 10:00 to 10:30 on September 24.
- The October 2 tripwire will be checked based on whether Sunil's release is in production, rather than requiring someone to be at a desk.

#### Blockers
- Invoice preview is currently 1.4 seconds at p95 for large accounts versus an 800 ms target.
- The deduplication fix is incomplete and the no-key behavior is unresolved for raw API customers.
- Payments Platform has not yet shipped idempotency support for the invoice-line ledger endpoint, creating a double-posting risk.
- Two Sev-1 defects remain open, covering deduplication double counting and incorrect proration after plan changes.
- The latest regression run passed at 96.4%, with failures concentrated in proration and three potentially flaky JPY currency-rounding tests.
- Staging-eu was down for two days last week, and its retention job remains broken despite an 80% disk alert.
- Migration testing is blocked from scaling beyond three shards because the procedure is manual and lacks a usable runbook.
- The launch date is at risk because two Sev-1 issues remain, including customer overbilling.
- Nine of the twelve shards have not yet had a migration dry run.
- QA requires all Sev-1s closed, regression green apart from known flakes, all 12 shards dry run, and one rollback drill before launch.
- QA estimates ten working days after the ledger change lands to complete the required validation.
- The current preview latency is above the agreed launch target.
- Two Sev-1s remain open and a required dependency has not shipped, preventing the October 6 launch.
- Kestrel Logistics has withheld payment on its August invoice because the metering error undermined confidence in usage billing.
- Kestrel Logistics will not move its full account to usage billing until the meter is trusted.
- The existing 10% rollout is considered risky because it would expose 78 accounts to potential metering errors.
- Metering defects may not appear in invoice output until the first bill run after accounts are enabled.
- The legal review of the usage-tier order-form addendum is still open with Joelle Park and blocks launch.
- Ledger 3.4 delivery timing is unresolved and has an October 2 tripwire.
- The Salesforce sync may mishandle fractional quantities, threatening sales reporting and commission calculations.
- Help center ownership is unresolved while the two-person documentation team is occupied with the v2 API reference.
- Replay-tooling coverage is incomplete because the team has not determined what the existing 12 tests omit.
- Replay tooling coverage lacks an answer and requires discussion before it can be finalized.
- The no-key deduplication fallback is blocked on observing beta traffic without idempotency keys.
- The October 2 office move creates an operational risk because staff may not be at desks when the tripwire occurs.

#### Dependencies
- The billing service depends on Payments Platform version 3.4 for idempotency on the invoice-line ledger write API.
- The Payments Platform target for the ledger idempotency capability is September 29, but it was described as a target rather than a commitment.
- Deduplication coverage depends on SDK adoption because Node and Python send keys, Go support is due next week, Java is not started, and raw HTTP clients may send none.
- QA's currency suites depend on staging-eu remaining available and the event-store retention job functioning.
- The remaining nine subscription-migration shards depend on documenting the procedure used successfully on the first three shards.
- Migration work on the remaining nine shards depends on completion of the runbook.
- End-to-end ledger testing depends on Payments Platform shipping its change on October 29.
- The launch sequence depends on completing all shard dry runs and a rollback drill in addition to regression testing.
- The October 6 roadmap date is coupled to an October 7 marketing webinar and sales proposals promising early-October availability.
- New October contracts using usage tiers depend on v2 being live to avoid recurring manual invoice adjustments.
- The October 14 launch depends on Payments Platform shipping ledger 3.4 to production by October 2.
- Maya's migration runbook depends on Viktor's brain dump and the referenced Google document, Slack thread, and Tuesday materials.
- Kestrel Logistics' migration depends on verifying the idempotency fix against its own data before manual activation.
- The rollout decision depends on whether preview totals or v1 shadow rating can identify metering discrepancies before invoice generation.
- Expansion beyond the 5% cohort depends on clean reconciliation against v1 shadow ratings.
- The rollback plan depends on v1 retaining account data in shadow mode for 30 days after migration.
- The tax team's Canadian GST-on-credits change must move to October 19 or receive an exception because of the October 12–16 billing freeze.
- The second 24 hours of launch on-call coverage depends on confirming Lukas Brandt's availability.
- Launch communications depend on sending the 14 beta customers an update before sales representatives communicate the new date.
- The Kestrel customer communication depends on Joel's call on September 23.
- The ledger integration work is Viktor's responsibility, while schedule escalation is owned by the meeting lead.
- Choosing the no-key deduplication fallback depends on measuring beta traffic without an idempotency key.
- The tripwire check depends on Sunil's release being in production on October 2.
- The next checkpoint agenda depends on Ines, Viktor, and Maya bringing their respective materials.

#### Follow-up needed
- The launch-date discussion needs to resolve whether invoice preview will be optimized, limited for large accounts, or otherwise scoped for launch.
- The team should confirm whether Payments Platform's September 29 delivery is committed and establish an owner for escalation.
- The team should verify the cause of the three JPY-only currency-rounding failures.
- The team should re-run the skipped EU currency suites after staging-eu retention is repaired.
- The team should document and review the migration runbook before proceeding with the remaining nine shards.
- Review Ines's October 24 customer-session results before choosing the empty-state design.
- Document the 1.2-second p95 performance bar in the relevant launch and test documentation.
- Revisit whether XLSX export is warranted after launch if customer demand increases.
- Clarify ownership and scope for an accessibility audit of the invoice PDF.
- Resolve the final launch date after accounting for the October 29 dependency and the required ten working days of QA.
- Document the failing-first Sev-1 verification rule in the go/no-go checklist.
- Confirm whether the initial rollout should be 5% with a 48-hour hold rather than 10%.
- Define the reconciliation process for every account in the initial rollout cohort against v1 shadow rating.
- Provide Kestrel Logistics with a customer-readable explanation of the retry-window defect rather than an internal stack-trace postmortem.
- Confirm Kestrel Logistics' preferred manual migration date after the fix has been verified.
- Decide whether to offer Kestrel Logistics a free month after assessing the customer call and Finance response.
- Confirm the owner and technical behavior of the Salesforce sync for fractional usage quantities.
- Assign an owner for the six help center articles covering the new invoice PDF grouping before October 14.
- Confirm whether the webinar remains on October 7 after Rohan's discussion with Carla.
- Resolve which empty-state variant to use after the September 24 usability-session results.
- Determine the customer renewal and any additional remediation beyond the credit for Kestrel Logistics.
- Review Viktor's list of replay-tooling test gaps and decide the required coverage.
- Decide the no-key dedup fallback after measuring beta traffic without idempotency keys.
- Resolve whether Kestrel Logistics renews and whether the team offers anything beyond the credit.
- Define the expected replay tooling coverage after the Monday discussion.
- Review the list of uncovered areas in the 12 tests.
- Use beta traffic without idempotency keys to choose the no-key deduplication fallback approach.
- Confirm the October 2 tripwire outcome despite the office move.

#### Action items (structured)
- Viktor: Merge the idempotency-key deduplication fix. (deadline: September 25)
- Viktor: Review beta traffic to determine how many requests arrive without client-supplied idempotency keys. [inferred]
- Maya: Continue chasing Infra on the staging-eu retention job issue.
- Viktor: Create a real migration runbook before work begins on the remaining nine shards. (deadline: October 28)
- Chase the Payments Platform team for idempotency support on the ledger write API. [inferred]
- Viktor said the deduplication fix can be merged by September 25. [inferred]
- Payments Platform is targeting September 29 for ledger-write idempotency support. [inferred]
- Ines: Show customers both empty-state variants during the five usability sessions and share the results. (deadline: October 24)
- Speaker 4: Update the performance-test threshold to 1.2 seconds p95.
- Viktor: Implement the smaller caching fix for per-meter subtotals to target approximately 1.1–1.2 seconds p95. [inferred]
- Viktor: Migration runbook due [inferred]
- Ines: Empty-state usability-session results to be shared [inferred]
- Payments Platform ledger change expected [inferred]
- Speaker 1: Discuss with Carla whether the October 7 webinar moves to October 15 or remains as a preview, and report back by the next day. (deadline: tomorrow)
- Speaker 1: Give Finance Ops advance notice about the approximately two weeks of October contracts requiring manual adjustments.
- Maya: Evaluate cohort placement for the October contracts when writing the rollout plan.
- Speaker 4: Build the rollout plan around the agreed initial 10% cohort, subject to the later discussion about reducing it.
- Speaker 3: Hold the migration-runbook brain dump with Maya tomorrow at 2 and bring the Google document, Slack thread, and Tuesday materials. (deadline: tomorrow at 2)
- Viktor: Draft the technical root-cause explanation for Kestrel Logistics' retry overbilling.
- Me: Convert Viktor's technical explanation into a customer-readable version and provide it to Joel by the morning of September 22. (deadline: morning of September 22)
- Me: Join Joel's customer call with Kestrel Logistics on September 23. (deadline: September 23)
- Joel: Draft and route the $18,240 credit memo through Finance, targeting approval by September 21. (deadline: September 21)
- Joel: Consider whether to raise a free-month goodwill concession with the director based on how the customer call goes.
- Viktor: Determine whether the initial rollout should be reduced from 10% to 5% and whether each account in the initial cohort can be reconciled against v1 shadow rating for 48 hours. [inferred]
- Payments ledger 3.4 production tripwire [inferred]
- Kestrel Logistics credit approval target [inferred]
- Kestrel Logistics customer explanation due [inferred]
- Kestrel Logistics customer call [inferred]
- Viktor: Create the shadow reconciliation script for the rollout. (deadline: October 7)
- Maya: Own the rollback drill in staging across all 12 shards. (deadline: October 8)
- Rohan: Send the go/no-go meeting invite for October 12 to the same group plus Joel. (deadline: October 12)
- Maya: Notify the tax team about the billing change freeze. (deadline: Not stated)
- Viktor: Provide backend coverage for the first 24 hours of the launch-week 48-hour on-call window. (deadline: First 24 hours of launch window)
- Me: Find a backend engineer for the second 24 hours of the launch-week on-call window, starting with Lukas Brandt. (deadline: Not stated)
- Rohan: Follow up with Joelle Park to complete the legal review by September 30 and report any miss on October 1. (deadline: September 30; escalate on October 1)
- Rohan: Send beta customers an update about the October 14 date, with a separate handling path for Kestrel Logistics. (deadline: September 22; Kestrel call September 23)
- Update the help center invoice-reading articles before October 14 and assign an owner by the following week. (deadline: Before October 14; owner by next week) [inferred]
- Me: Escalate the ledger 3.4 dependency with Sunil and Grace Obi and obtain a committed date. (deadline: Monday)
- Viktor: Bring a list of coverage gaps in the 12 replay-tooling tests. (deadline: Not stated)
- Dedup fix and proration Sev-1 merged [inferred]

#### Decisions (structured)
- Usage charts will use the account's billing time zone rather than the viewer's browser time zone.
- The team will not decide the no-idempotency-key fallback until beta traffic shows how many requests arrive without a key.
- A real migration runbook must be created before the remaining nine shards are migrated.
- A real migration runbook is required before anyone touches the remaining nine shards. (owner: Viktor)
- The usage dashboard will support CSV only at launch, with XLSX deferred for later consideration.
- The empty-state design remains undecided until customer usability-session results are reviewed on October 24.
- The launch performance bar is 1.2 seconds p95 for previews on big accounts.
- Full hourly pre-aggregation is not a launch requirement and will be placed in the backlog without a committed delivery date.
- Billing will launch on Wednesday, October 14, provided Payments Platform ships ledger 3.4 to production by Friday, October 2; otherwise the launch automatically moves to October 20 without another meeting.
- The October 7 webinar will not include an early-access or soft launch; its date and positioning will be resolved with marketing.
- Contracts created between October 1 and October 14 will run on v1 with manual adjustments and migrate during the rollout.
- The migration runbook was reassigned to Maya, remains due on the 28th, and will be informed by a Viktor brain-dump session.
- A Sev-1 counts as closed for launch only when it is verified in staging with a regression test that fails on the old code; merely merging does not count.
- Kestrel Logistics will be excluded from automatic rollout cohorts and migrated manually on a customer-selected date after the fix is verified on its data.
- The team agreed to credit Kestrel Logistics $18,240 against its open invoice rather than issue a refund.
- The rollout will begin with 5% of eligible accounts for 48 hours, with reconciliation against v1 shadow ratings before expansion.
- The 5% cohort will exclude accounts over 2 million events, and large accounts will enter at the 25% stage.
- If reconciliation is clean, rollout will proceed to 25% on October 19, 50% on October 21, and 100% on October 26.
- A difference greater than 0.5% between v2 and shadow v1 totals, excluding known rounding differences, will pause the rollout without an automatic rollback.
- A rollback drill will be held in staging on October 8 across all 12 shards before launch.
- Billing services will be under change freeze from October 12 through October 16, except for v2 fixes.
- The legal review of the usage-tier order-form addendum is launch-blocking and must be included in the go/no-go checklist separately from the approved privacy review.
- The preview will remain on the pricing page with a 1.2-second target.
- The next checkpoint will take place on September 24 at 10:30 instead of 10:00.

#### Open questions (structured)
- Whether invoice preview can meet the 800 ms target for large accounts or needs pre-aggregation remains unresolved. [open]
- Whether preview should be limited or removed for large accounts at launch remains unresolved. [open]
- What fallback should be used when usage requests do not include an idempotency key remains unresolved. [open]
- Whether Payments Platform's September 29 ledger idempotency target is committed or merely tentative remains unclear. [open]
- Whether the three currency-rounding failures are caused by a shared fixture or represent a real bug remains unconfirmed. [open]
- Which empty-state variant—sample data or setup checklist—will customers understand and prefer? [open]
- Who owns the accessibility audit for the invoice PDF? [open]
- Will Payments Platform ship the ledger change on October 29? [open]
- What is the final launch date given the testing and migration requirements? [open]
- Can the team reconcile rollout accounts against v1 shadow rating during a 48-hour hold? [open]
- Will the October 7 webinar move to October 15 or remain on October 7 as a preview? [open]
- Which rollout cohort should contain the October contracts, if any? [open]
- Should Kestrel Logistics receive a free month in addition to the $18,240 credit? [open]
- Whether Payments Platform will ship ledger 3.4 by September 29, with October 2 as the tripwire. [open]
- Which empty-state variant, A or B, will be selected. [open]
- Whether the webinar will move off October 7. [open]
- Who owns the help center update. [open]
- Who owns the Salesforce sync and whether it correctly handles fractional quantities. [open]
- Whether Kestrel Logistics renews and whether the team offers anything beyond the credit. [open]
- What replay-tooling coverage is required beyond the current tests. [open]
- Which approach to the no-key dedup fallback is appropriate after measuring beta traffic without idempotency keys. [open]
- Whether Kestrel Logistics will renew remains unresolved. [open]
- Whether the team will give Kestrel Logistics anything beyond the credit remains unresolved. [open]
- What happens with replay tooling coverage is still unanswered. [open]
- The approach for no-key deduplication fallback depends on the amount of beta traffic without an idempotency key. [open]

#### Risks (structured)
- [high] Invoice preview p95 latency is 1.4 seconds for large accounts against an 800 ms target, affecting roughly 60 accounts.
- [high] The current five-minute deduplication window can double-count events when clients retry after the window.
- [high] Without Payments Platform idempotency support for invoice-line ledger writes, posting-worker retries can double-post invoice line items.
- [high] Two Sev-1 defects remain open: deduplication double counting and incorrect proration after mid-cycle plan changes.
- [high] Four of the seven open P1s are customer-visible, including CSV formatting and billing-time-zone chart issues.
- [high] The staging-eu retention job is still not running, so the event-store disk is expected to fill again in about three weeks.
- [high] Migration execution is not yet repeatable because the process lacks a proper runbook and is documented through an informal Slack thread and vague Google Doc.
- [high] The migration dry run is undocumented and depends on knowledge spread across Viktor's memory, a Slack thread, and a Google document.
- [high] Replay tooling has only 12 tests despite being the recovery mechanism for incorrectly rated production batches.
- [high] Shipping sample data in the empty state could cause finance teams to mistake fake numbers for real customer data.
- [high] Launching on October 6 would leave only five working days to test the ledger integration even though QA needs ten working days.
- [high] The launch depends on Payments Platform delivering on October 29, leaving limited schedule buffer before the October 6 roadmap date.
- [medium] Preview latency is currently 1.4 seconds p95 on big accounts, which UX considers borderline.
- [high] The October 6 launch is not realistic because two Sev-1s remain open and a required dependency has not shipped.
- [high] The launch depends on Payments Platform shipping ledger 3.4 by October 2; a slip automatically moves launch to October 20.
- [high] Kestrel Logistics was overbilled $18,240 because eight-minute API retries fell outside the five-minute deduplication window and were counted twice.
- [high] The Kestrel Logistics overbilling represented almost one-third of its approximately $61,000 August usage invoice and has put its migration and renewal confidence at risk.
- [high] Starting rollout at 10% would expose 78 accounts to potentially incorrect invoices before the first bill run reveals the issue.
- [medium] The initial launch scope is at risk because Speaker 3 cannot complete the runbook by the 28th while also handling four other technical responsibilities.
- [high] A per-account v2 versus shadow-v1 difference above 0.5% could pause the rollout.
- [medium] Preview latency risk is concentrated in the large accounts, which are excluded from the first 5% cohort.
- [high] The legal review of the order-form addendum remains open and is launch-blocking.
- [high] The Salesforce sync may cast fractional usage quantities to integers, potentially corrupting sales reporting and commissions.
- [medium] Help center documentation may not be updated before the invoice PDF format changes because the documentation team is occupied with the v2 API reference.
- [high] The ledger 3.4 delivery date is uncertain, with an October 2 tripwire.
- [medium] The 12 existing tests leave a long list of replay-tooling coverage gaps.
- [medium] The October 2 tripwire coincides with the office move, so people may not be at desks that day.
- [medium] The deduplication fallback approach cannot be selected until beta traffic without idempotency keys is understood.

#### Follow-up draft
Hi team,

Throughput is on track: Tuesday’s staging test sustained 42,000 events/sec for two hours against a 30,000 target, with lag below ~9 seconds.

Decisions
Usage charts will use the account billing time zone; launch export is CSV-only; hourly pre-aggregation is deferred.
Billing targets October 14, moving automatically to October 20 if ledger 3.4 misses the October 2 production tripwire.
Rollout starts at 5% for 48 hours with v1 shadow-rating reconciliation; Kestrel Logistics is excluded and will receive an $18,240 credit.
The remaining nine migration shards wait for Maya’s runbook, informed by Viktor’s brain dump and due October 28.

Blockers
Large-account invoice preview is 1.4s p95 against the 1.2s launch bar; launch scope remains unresolved for roughly 60 accounts.
Deduplication and proration Sev-1s remain open; Payments Platform ledger idempotency is still unshipped, and the no-key fallback awaits beta-traffic data.
QA is blocked by 96.4% regression pass rate, broken staging-eu retention, and nine untested shards; the runbook and rollback drill are required before launch.
The legal order-form addendum review remains launch-blocking.

Thanks,

---

# Summary C

_(run1)_

### Title: Usage-Based Billing Launch Risks

#### Overview
Backend load performance is ahead of target, but invoice preview latency, deduplication, Payments Platform support, QA defects, staging retention, and migration documentation remain launch risks. The team assigned Viktor a migration runbook due September 28, kept the empty-state design open for customer testing, agreed on a 1.2-second preview latency launch bar, and debated launch timing against QA and billing risks. The team moved the billing launch to October 14 with an October 2 Payments tripwire, reassigned the migration runbook, addressed Kestrel Logistics’ $18,240 overbilling, and reconsidered the initial 10% rollout size. The team agreed on a staged 5% rollout with reconciliation and defined rollout, legal, enablement, support, and dependency follow-ups. The team identified open replay-coverage and dedup-fallback questions, noted the October 2 tripwire coincides with the office move, and moved the next checkpoint to September 24 at 10:30. Key decisions: Rating will round at the invoice line-item level using half-even rounding rather than rounding per event.; The usage chart will use the account's billing time zone instead of the viewer's browser time zone.; The no-idempotency-key fallback will not be decided until beta traffic is reviewed.. Progress since last sync: The metering pipeline sustained 42,000 events per second for two hours against a 30,000 events-per-second target, with consumer lag below about nine seconds.

#### Summary
- The metering pipeline sustained 42,000 events per second for two hours against a 30,000 events-per-second target, with consumer lag below about nine seconds.
- Backend load performance is ahead of target, but invoice preview latency, deduplication, Payments Platform support, QA defects, staging retention, and migration documentation remain launch risks.
- Rating will round at the invoice line-item level using half-even rounding rather than rounding per event.
- The usage chart will use the account's billing time zone instead of the viewer's browser time zone.
- Invoice preview p95 latency is 1.4 seconds for accounts with more than about 2 million metered events, versus an 800 ms target.

#### Progress since last sync
- The metering pipeline sustained 42,000 events per second for two hours against a 30,000 events-per-second target, with consumer lag below about nine seconds.
- The staging metering test used 48 partitions, increased from 24 last sprint, with only an estimated couple hundred dollars per month in added broker cost.
- Rating-engine unit-test coverage is 81%, while metering-service coverage is 67% because replay tooling has almost no tests.
- The regression suite grew to 1,312 tests after approximately 140 additions this sprint, with a 96.4% pass rate on the latest run.
- The client-idempotency-key fix is approximately 70% complete, and Node and Python SDKs already send keys while Go is planned for next week and Java has not started.
- Migration dry runs completed successfully on three of twelve shards, averaging 38 minutes per shard with zero reconciliation mismatches.
- The usage dashboard is approximately 90% built, with only the export button and drill-down by meter remaining on the front end.
- The dashboard accessibility audit found two color-contrast issues in the chart legend, and both have been fixed.
- The dashboard drill-down is intended to break metrics such as API calls down by endpoint or sub-account.
- The current preview latency is 1.4 seconds p95 on large accounts before the smaller caching fix.
- The migration currently has one completed dry run and nine shards still awaiting dry runs.
- The internal Tallyport account has been dogfooding the new flag at 100% for three weeks, while 14 beta accounts are also enabled.
- The current beta and internal exposure is approximately 1.8% of the 780 eligible accounts.
- Viktor has the idempotency-key fix in progress, with a target to merge it by September 25.
- The planned idempotency-key fix is intended to handle retries at any delay up to 24 hours.
- Kestrel Logistics’ August invoice remains unpaid and is on hold, so the proposed remediation is a credit rather than a refund.
- The overbilling affected only the shipment-tracking API-call meter; the warehouse and fleet meters were unaffected.
- The privacy review and DPIA for storing raw usage events were approved, while the separate legal review remains open.
- The sales deck has been updated and the pricing page copy is with marketing for launch-day publication.
- All 14 beta customers were previously told October 6 through the August beta newsletter.
- The preview remains in the pricing page copy with a stated performance target of 1.2 seconds.
- The legal review concerns new usage terms covering overage billing, metered-usage disputes, and a 30-day contest window.
- The team clarified that the October 2 tripwire can be checked without being at a desk because it only verifies whether Sunil's release is in production.
- The next checkpoint agenda now includes usability results, dedup fix status, and a runbook draft.

#### Decisions
- The rating engine will use half-even rounding at the invoice line-item level, a finance-approved approach that may make a handful of customer totals a few cents lower than v1.
- Usage charts will use account billing time zones so chart boundaries agree with invoices.
- The no-key deduplication fallback will remain undecided until beta traffic shows how frequently requests arrive without keys.
- The remaining nine migration shards are gated on creation of a real runbook.
- CSV will be the only export format at launch, while Excel support is deferred.
- The empty-state choice will not be resolved in this meeting and will be informed by customer sessions.
- The 1.2-second p95 preview latency threshold is accepted as the launch bar for large accounts.
- The full hourly pre-aggregation is backlog work and is not required for launch.
- The launch will not occur on October 6 or October 13, and October 14 is the selected date unless the October 2 tripwire moves it to October 20.
- The first rollout stage was defined as 10% of eligible accounts on October 14, although Maya subsequently challenged that size.
- Kestrel Logistics will receive a manual, customer-selected migration after its data validates the fix.
- The team will provide Kestrel Logistics a credit for the $18,240 overbilling rather than immediately issuing a refund.
- The launch will use a 5% staged cohort rather than the previously considered 10% start.
- The first cohort will contain small and midsize monthly-billed accounts and exclude accounts over 2 million events.
- The rollout will pause for a per-account variance above 0.5%, excluding known rounding differences.
- The invoice-format announcement will not use the incident status page.
- The next checkpoint was moved from 10:00 to 10:30 on September 24.
- The checkpoint deliverables were assigned to Ines, Viktor, and Maya as usability results, dedup fix status, and a runbook draft respectively.

#### Blockers
- Invoice preview currently misses its latency target for roughly 60 large accounts, with 1.4-second p95 latency versus an 800 ms goal.
- Payments Platform idempotency support is required to prevent retry-driven double posting of invoice line items, but its September 29 delivery is only a target.
- Two Sev-1 issues remain open: deduplication double counting and incorrect proration after mid-cycle plan changes.
- Staging-eu's retention job remains broken after the disk was cleaned up, putting the environment at risk of another outage near launch.
- Migration work is blocked from proceeding beyond three shards because the current procedure is undocumented and manual.
- The absence of a clear migration runbook is a process blocker before the other nine shards can be addressed safely.
- Replay tooling is considered risky because it has only 12 tests despite being needed for production re-rating recovery.
- The launch is at risk from two unresolved Sev-1 issues, including customer overbilling.
- Launching before the required ten working days of QA after the ledger change could force the team to skip migration dry runs or the rollback drill.
- The empty-state design is blocked on evidence because sample data may mislead finance users while a checklist may reduce feature discoverability.
- Two Sev-1 issues and an unshipped dependency prevent the team from treating October 6 as a realistic launch date.
- The Payments Platform ledger 3.4 shipment is a hard dependency for retaining the October 14 launch.
- Kestrel Logistics’ trust in usage billing is at risk because its first v2 invoice contained $18,240 of overbilling.
- The existing five-minute deduplication window fails for the customer’s approximately eight-minute carrier-timeout retries.
- The 10% rollout is considered risky because an undetected metering bug could affect 78 accounts before the first bill run.
- The unfinished legal review of the order form addendum is a launch blocker.
- Documentation ownership is unresolved while the two-person docs team is occupied with the v2 API reference.
- The Salesforce sync may mishandle fractional quantities and affect commissions.
- Replay tooling coverage and the no-key deduplication fallback remain unresolved technical concerns.
- Replay tooling coverage is unresolved, with Speaker 3 indicating that the 12 tests leave a long list of uncovered areas.
- The no-key deduplication approach is blocked on data about beta traffic without idempotency keys.
- The October 2 office move creates a logistical risk because nobody may be at a desk.

#### Dependencies
- Invoice-line-item posting depends on Payments Platform version 3.4 adding idempotency support to the ledger write API.
- The deduplication approach depends on beta traffic data to determine the prevalence of requests without client-supplied keys.
- The migration of the remaining nine shards depends on a documented runbook being completed.
- QA coverage for EU currency suites depends on staging-eu remaining available and its retention job functioning.
- The remaining nine migration shards depend on the runbook being completed before work proceeds toward go/no-go.
- End-to-end ledger testing depends on Payments Platform delivering its change on the 29th.
- The launch schedule depends on completing ten working days of QA after the ledger change lands.
- The launch date is constrained by a fixed October 7 marketing webinar and sales commitments for early-October availability.
- If launch is delayed, October contracts using new usage tiers may require manual v1 invoicing adjustments.
- The October 14 launch depends on Payments Platform shipping ledger 3.4 to production by October 2.
- The migration runbook depends on Viktor transferring operational knowledge to Maya before the runbook deadline.
- Kestrel Logistics’ manual migration depends on verifying the idempotency fix against its data.
- The proposed wider rollout depends on reconciling cohort accounts against v1 shadow rating during the hold period.
- The October contracts require Finance Ops capacity because roughly two weeks of contracts may need manual adjustments.
- Expansion beyond 5% depends on clean reconciliation of every initial-cohort account against v1 shadow rating.
- The rollout schedule depends on the rollback drill completing in staging before launch.
- The launch depends on Payments Platform providing the ledger 3.4 dependency by the relevant tripwire.
- Customer communications depend on Joel handling the Kestrel Logistics call and related customer messaging.
- Billing changes from October 12 through 16 depend on either postponing the tax team's October 13 change or obtaining an exception.
- Selecting the no-key deduplication fallback depends on measuring beta traffic without idempotency keys.
- The October 2 tripwire depends on whether Sunil's release is in production that day rather than on desk availability.

#### Follow-up needed
- Resolve whether invoice preview will be optimized for large accounts or restricted at launch, since removing it was rejected and pre-aggregation would take Viktor about a week and a half.
- Verify the Go SDK idempotency-key release next week and determine a plan for the unstarted Java SDK and raw HTTP customers.
- Confirm whether the JPY-only currency failures are a shared-test-fixture problem or a genuine rounding defect.
- Track closure of the four customer-visible P1s, including CSV formatting and billing-time-zone chart issues.
- Confirm the Payments Platform delivery date with Sunil rather than treating the September 29 target as a commitment.
- Review Ines's customer-session findings on the empty-state variants on Thursday the 24th and select a direction.
- Document the agreed 1.2-second p95 performance bar so it is visible to the team and reflected in testing.
- Reassess the launch date after confirming Payments Platform timing and completing the required migration and QA work.
- Determine ownership and scope for an accessibility audit of the invoice PDF.
- Ask Facilities to confirm whether monitors will move to the Harlow building or be replaced.
- Record the 1.2-second performance threshold in the agreed documentation.
- Add the failing-first staging regression-test requirement to the go/no-go checklist.
- Confirm whether the rollout should start at 5% for 48 hours instead of 10%.
- Ensure Kestrel Logistics receives both a customer-readable root cause and a clear explanation of the corrective fix before its September 23 call.
- Keep Kestrel Logistics out of usability sessions while the overbilling issue is unresolved.
- Assign an owner for the six help center articles before the October 14 launch.
- Determine whether the Salesforce sync supports fractional quantities and identify its current owner.
- Confirm the webinar date with Carla and decide whether it moves from October 7.
- Add explicit legal review completion to the go/no-go checklist.
- Review replay-tooling test gaps and decide the no-key deduplication fallback after beta traffic is measured.
- Resolve what replay tooling coverage should be after the Monday discussion between Me and Viktor.
- Review Speaker 3's list of uncovered areas in the 12 tests.
- Revisit the deduplication fallback choice once the beta traffic without idempotency keys is quantified.
- Clarify the Kestrel Logistics renewal outcome and whether any support beyond the credit will be offered.

#### Action items (structured)
- Viktor: Complete and merge the client-supplied idempotency-key deduplication fix. (deadline: September 25)
- Viktor: Review beta traffic to determine how many requests arrive without an idempotency key before choosing the fallback behavior.
- Maya: Continue chasing Infra on the staging-eu retention job and disk-fill issue.
- Viktor: Create a proper migration runbook before the other nine shards are migrated.
- Me: Clarify and chase the Payments Platform delivery of idempotency support for the ledger invoice-line-item API. [inferred]
- Viktor expects the deduplication fix to be merged by September 25. [inferred]
- Payments Platform is targeting September 29 for ledger idempotency support. [inferred]
- Viktor: Create the migration runbook before the remaining nine shards are touched. (deadline: Monday the 28th)
- Ines: Show customers both empty-state variants A and B during the five usability sessions and share the results. (deadline: Thursday the 24th)
- Speaker 4: Update the performance-test threshold to 1.2 seconds p95.
- Viktor: Implement the smaller preview-performance fix by caching per-meter subtotals, targeting approximately 1.1–1.2 seconds p95. [inferred]
- Ask Facilities whether monitors will move to the Harlow building or be replaced. [inferred]
- Migration runbook due Monday the 28th. [inferred]
- Customer-session results for the empty-state variants expected Thursday the 24th. [inferred]
- Payments Platform ledger change expected on the 29th. [inferred]
- Potential launch dates discussed were October 6, October 13, and October 20. [inferred]
- Move the full hourly pre-aggregation work into the backlog rather than treating it as a launch requirement.
- Speaker 1: Talk with Carla and report whether the webinar stays on October 7 as a preview or moves to October 15. (deadline: tomorrow)
- Speaker 1: Give Finance Ops advance notice about the approximately two weeks of October contracts requiring manual adjustments.
- Speaker 4: Write the rollout plan, including the cohort decision for the October contracts.
- Speaker 3: Hold the migration runbook brain-dump session with Maya. (deadline: tomorrow at 2)
- Speaker 4: Bring the Google document, Slack thread, and Tuesday materials to the brain-dump session.
- Speaker 3: Draft the technical root-cause explanation for Kestrel Logistics’ overbilling.
- Me: Convert the technical explanation into a customer-readable version and provide it to Joel by the morning of September 22. (deadline: morning of September 22)
- Me: Join the Kestrel Logistics customer call. (deadline: September 23)
- Speaker 5: Draft the $18,240 credit memo and route it through Finance for approval. (deadline: approval targeted by Monday the 21st)
- Speaker 5: Consider whether to propose an additional free month and raise it with the director if needed.
- Speaker 3: Determine whether the rollout can reconcile each cohort account against v1 shadow rating before expanding. [inferred]
- Payments Platform ledger 3.4 production shipment is the October 2 launch tripwire. [inferred]
- Kestrel Logistics customer-ready explanation is needed by the morning of September 22. [inferred]
- Kestrel Logistics customer call is on September 23. [inferred]
- Credit approval is targeted for Monday the 21st. [inferred]
- Viktor: Viktor will provide the shadow reconciliation script before the rollback drill. (deadline: October 7)
- Maya: Maya will own the rollback drill, migration runbook, rollout plan, performance threshold change, and exclusion of Kestrel Logistics from rollout cohorts. (deadline: October 8 for the drill; September 28 for the runbook)
- Rohan: Rohan will follow up with Joelle Park about completing the legal review by September 30 and will notify the team on October 1 if it is not complete. (deadline: September 30; escalation October 1)
- Rohan: Rohan will send the go/no-go invite, run sales training, decide the webinar timing with Carla, and email the beta customer group. (deadline: Webinar decision tomorrow; beta email by September 22; training October 9; invit)
- Maya: Maya will notify the tax team about the billing change freeze. (deadline: Same day)
- Speaker 3 and Me: Speaker 3 will cover the first 24 hours of launch-week on-call, and the meeting lead will ask Lukas Brandt to cover the second 24 hours. (deadline: Launch 48-hour window)
- Me: The meeting lead will escalate the ledger 3.4 dependency with Sunil and Grace Obi and obtain a committed date by Monday. (deadline: Monday)
- Viktor and Me: Viktor will provide the technical root cause for Kestrel Logistics by September 21, while the meeting lead will provide the customer version to Joel by September 22 and hold the customer call on September 23. (deadline: September 21-23)

#### Decisions (structured)
- Rating will round at the invoice line-item level using half-even rounding rather than rounding per event.
- The usage chart will use the account's billing time zone instead of the viewer's browser time zone.
- The no-idempotency-key fallback will not be decided until beta traffic is reviewed.
- The remaining nine migration shards should not be run until a proper migration runbook exists.
- Viktor will own a real migration runbook, due Monday the 28th, before the remaining nine shards are handled and before go/no-go. (owner: Viktor)
- The launch export format will be CSV only, with XLSX deferred to a later list.
- The empty-state decision remains open, and the team will review customer-session results on Thursday the 24th.
- The launch bar for preview performance is 1.2 seconds p95 on big accounts.
- The full hourly pre-aggregation work is deferred to the backlog and is not a launch requirement.
- The billing launch date is Wednesday, October 14, with an automatic move to October 20 if Payments Platform has not shipped ledger 3.4 to production by Friday, October 2.
- The team rejected an October 7 early-access or soft launch and will instead decide whether the webinar remains on October 7 as a preview or moves to October 15.
- Contracts created between October 1 and October 14 will use v1 with manual adjustments and be migrated during the rollout.
- The team did not decide cohort placement for the October contracts and assigned Maya to evaluate it in the rollout plan.
- The migration runbook was reassigned to Maya, remains due on the 28th, and will be supported by a Viktor brain-dump session.
- A Sev-1 counts as closed for launch only after staging verification with a regression test that fails on the old code; merging alone does not count.
- Kestrel Logistics will be excluded from automatic rollout cohorts and manually migrated on a customer-selected date after the fix is verified on its data.
- The rollout will begin at 5% of eligible accounts for 48 hours, with per-account reconciliation against the v1 shadow rating before expansion.
- If reconciliation is clean, the rollout will expand to 25% on October 19, 50% on October 21, and 100% on October 26.
- The first 5% cohort will exclude accounts with more than 2 million events, with large accounts entering at the 25% stage.
- A difference greater than 0.5% between v2 and shadow v1 totals, excluding known rounding differences, will pause the rollout without an automatic rollback.
- The team will conduct a full 12-shard rollback drill in staging on October 8.
- Billing services will have a change freeze from October 12 through October 16, except for fixes for v2.
- The go/no-go meeting will be held on October 12 with the existing group plus Joel.
- Legal sign-off for the order form addendum will be included explicitly in the go/no-go checklist, separately from the completed privacy review.
- The next checkpoint will be held on September 24 at 10:30 instead of 10:00.
- The next checkpoint will cover usability results from Ines, dedup fix status from Viktor, and a runbook draft from Maya.

#### Open questions (structured)
- Whether invoice preview can meet the 800 ms p95 target for large accounts or whether scope must be limited at launch remains unresolved. [open]
- What fallback should be used for raw HTTP requests that do not include an idempotency key remains unresolved. [open]
- Whether Payments Platform will deliver ledger idempotency support by September 29 remains uncertain because the date is only a target. [open]
- Whether the three JPY currency test failures are caused by a shared fixture or represent a real bug remains unconfirmed. [open]
- Which empty-state design should launch: sample data with a banner, a setup checklist, or a hybrid preview? [open]
- Who owns the accessibility audit for the invoice PDF generated by the billing service? [open]
- Can the October 6 launch date be met while completing the required QA and migration work? [open]
- Will Payments Platform ship the required ledger change on October 29 as planned? [open]
- What is the final launch date: October 6, October 13, or October 20? [open]
- Can the team reconcile every rollout cohort account against v1 shadow rating before expanding the rollout? [open]
- Will the webinar remain on October 7 as a preview or move to October 15? [open]
- Should the initial rollout be 10% or 5% of the 780 eligible accounts? [open]
- Should Kestrel Logistics receive an additional free month as a goodwill gesture? [open]
- Whether Payments Platform will ship ledger 3.4 by September 29, with October 2 as the tripwire. [open]
- Who owns the help center update for the invoice PDF format changes. [open]
- Who owns the Salesforce sync and whether it correctly handles fractional quantities. [open]
- Whether the webinar will move off October 7. [open]
- Which empty-state variant, A or B, will be selected after usability testing. [open]
- What replay tooling coverage is required beyond the current tests. [open]
- Whether Kestrel Logistics renews and whether it should receive anything beyond the credit. [open]
- Whether Kestrel Logistics renews and whether the team will offer anything beyond the credit remain unresolved. [open]
- The team has not decided what the replay tooling coverage will be. [open]
- The approach for deduplication traffic without an idempotency key is still undecided pending beta-traffic data. [open]

#### Risks (structured)
- [high] Invoice preview p95 latency is 1.4 seconds for accounts with more than about 2 million metered events, versus an 800 ms target.
- [high] The current five-minute deduplication window can double-count events when customers retry after the window.
- [high] The launch depends on Payments Platform version 3.4 adding idempotency support to the ledger invoice-line-item API, with only a September 29 target.
- [high] Two Sev-1 defects remain open: deduplication double counting and incorrect proration after a mid-cycle plan change.
- [high] Staging-eu's retention job is still not running, so the event-store disk is expected to fill again in about three weeks, near launch.
- [high] Migration execution is currently manual and lacks a reliable runbook, with instructions split between a Slack thread and a Google doc.
- [high] The migration dry run is highly manual and lacks a usable runbook, with instructions spread across Viktor's memory, a Slack thread, and a vague Google Doc.
- [high] Replay tooling has only 12 tests despite being the recovery mechanism for correcting incorrectly rated production batches.
- [high] Using sample data in the empty state could cause finance teams to mistake fake numbers for real customer usage after screenshots are shared.
- [high] Launching on October 6 could leave insufficient time for ledger integration testing, migration dry runs, and the rollback drill.
- [high] The minimum QA readiness bar requires both Sev-1 issues closed, regression green except known flakes, all 12 shards dry-run, and one rollback drill.
- [high] The team currently has two Sev-1 issues, including customer overbilling, and nine migration shards have not yet been dry-run.
- [medium] Preview latency is currently 1.4 seconds p95 on large accounts, which UX considers borderline.
- [high] The October 6 launch was considered unrealistic because two Sev-1 issues remain open and a required dependency has not shipped.
- [high] Kestrel Logistics was overbilled by $18,240 because API retries after approximately eight minutes were counted as new events outside the five-minute deduplication window.
- [high] Kestrel Logistics’ $18,240 overbilling represents almost one-third of its approximately $61,000 August usage invoice.
- [high] Kestrel Logistics has put the unpaid invoice on hold and does not trust the meter enough to move its full account to usage billing.
- [high] A metering bug affecting a 10% first cohort would expose 78 customers to potentially incorrect invoices before the first bill run reveals the problem.
- [medium] The invoice issue may not be visible on launch day because invoices are generated only during the first bill run after accounts are flipped.
- [high] The legal review of the usage-terms order form addendum remains open and is launch-blocking.
- [high] The Salesforce sync may cast fractional usage quantities to integers, which could corrupt sales reporting and commissions.
- [high] The ledger 3.4 delivery date is uncertain and has an October 2 tripwire.
- [medium] Invoice PDF grouping is changing from date-based to meter-based, which may generate customer support tickets unless documentation is updated.
- [medium] The no-key deduplication fallback cannot be selected until the volume of beta traffic without idempotency keys is understood.
- [medium] The 12 existing tests have a substantial coverage gap for replay tooling.
- [medium] The October 2 tripwire coincides with the office move, so team members may not be at desks that day.

#### Follow-up draft
Hi team,

Progress: Metering sustained 42,000 events/sec for two hours against a 30,000 target, with lag below nine seconds.

Decisions
Rating will use half-even rounding at the invoice line-item level; usage charts will use account billing time zones. Launch is set for October 14, moving to October 20 if Payments ledger 3.4 misses the October 2 tripwire. Rollout starts at 5% for 48 hours, excluding accounts over 2 million events, with reconciliation before expansion. CSV is the only launch export format. The migration runbook is due September 28, with Maya owning it and Viktor providing the knowledge transfer.

Blockers
Preview is at 1.4s p95 for large accounts against the 1.2s launch bar. Deduplication and proration Sev-1s remain open; Payments idempotency support is still a dependency. Staging-eu retention remains broken, replay tooling has only 12 tests, and nine migration shards await the runbook. Legal sign-off, the Salesforce fractional-quantity risk, and the no-key deduplication fallback remain unresolved. Kestrel Logistics’ $18,240 overbilling also requires fix validation, a credit, and customer communication.

Thanks,

---

# Summary D

_(run1)_

### Title: Usage-Based Billing v2 Launch Readiness

#### Overview
Weekly launch readiness meeting for usage-based billing v2 kicked off with the agenda set and Viktor's backend status: metering load test hit 42k events/sec (target 30k), rating engine rounding settled with finance, while invoice preview p95 latency (1.4s vs 800ms target) and a ledger idempotency dependency on Payments Platform remain key concerns before the October 6th date. Team agreed to create a migration runbook by the 28th, decided CSV-only export for launch with a 1.2s p95 latency bar, and left the dashboard empty-state decision open pending usability sessions on the 24th. Team locked a new October 14th launch date with an October 2nd Payments Platform tripwire, moved the migration runbook from Viktor to Maya, and addressed the Kestrel Logistics overbilling of $18,240 driven by an 8-minute retry window bug. The team finalized a staged rollout starting at 5% for 48 hours on October 13th (excluding accounts over 2 million events), agreed a pause trigger of >0.5% variance vs v1 shadow rating, scheduled a rollback drill October 8th and go/no-go October 12th, and closed out action items while flagging the legal review of the order form addendum as launch-blocking. The team closed the meeting by acknowledging several open items (Kestrel Logistics renewal/extra credit, replay tooling coverage, no-key dedup fallback), noting the October 2nd tripwire clashes with the office move, and rescheduling the next checkpoint to 10:30 on September 24th. Key decisions: Rounding will be done at the invoice line item using half-even rounding, not per event, with Priyanka in finance signing off on Monday.; The usage chart should use the account's billing time zone rather than the viewer's browser time zone.; Build a real runbook for the migration before touching the other nine shards, due Monday the 28th.. Progress since last sync: Metering pipeline load test on Tuesday sustained 42,000 events/sec for two hours against a 30,000 events/sec design-doc target.

#### Summary
- Metering pipeline load test on Tuesday sustained 42,000 events/sec for two hours against a 30,000 events/sec design-doc target.
- Weekly launch readiness meeting for usage-based billing v2 kicked off with the agenda set and Viktor's backend status: metering load test hit 42k events/sec (target 30k), rating engine rounding settled with finance, while invoice preview p9
- Rounding will be done at the invoice line item using half-even rounding, not per event, with Priyanka in finance signing off on Monday.
- The usage chart should use the account's billing time zone rather than the viewer's browser time zone.
- Payments Platform ledger write API idempotency (v3.4) not committed — only targeted for Sept 29th — risking double-posting of invoice line items.

#### Progress since last sync
- Metering pipeline load test on Tuesday sustained 42,000 events/sec for two hours against a 30,000 events/sec design-doc target.
- Kafka consumer lag stayed under ~9 seconds during the load test with the new 48-partition count (bumped from 24 last sprint).
- Partition bump to 48 has minimal cost impact — Infra estimated a couple hundred dollars a month since brokers were already over-provisioned.
- Rating engine unit test coverage is at 81%, while the metering service is at 67%, mostly due to replay tooling having almost no tests.
- Invoice preview p95 latency on large accounts is 1.4 seconds, against an 800ms target; large means over ~2M metered events with ~60 such accounts today.
- Viktor has a PR for the dedup fix (client idempotency keys kept 24 hours) at roughly 70% done.
- Bug counts as of this morning: 2 Sev-1s, 7 P1s (corrected down from 9 as two closed this morning), 23 P2s, and 41 P3s.
- Regression suite is at 1,312 tests after adding about 140 this sprint, with a 96.4% pass rate on last night's run.
- Migration dry run completed on 3 of 12 shards, averaging 38 minutes per shard with zero reconciliation mismatches.
- Staging-eu was down for two days last week after the event-store disk filled, so the EU currency suites did not run Wednesday or Thursday.
- The usage dashboard is complete in Figma and about 90% built; remaining front-end work is the export button and drill-down by meter (breakdown by endpoint or sub-account).
- The accessibility audit ran last week and found 2 issues, both color contrast on the chart legend, both already fixed.
- The accessibility audit covered only the dashboard, not the invoice PDF generated by the billing service.
- Two beta customers requested Excel export instead of CSV; one loudly and one politely.
- Replay tooling currently has 12 tests, described as good but minimal for incident-time use.
- The dry run for migration is currently fully manual with no runbook, living in Viktor's head, a Slack thread, and a Google doc.
- Rohan reports October 6th has been the roadmap date since June, with the marketing launch webinar set for October 7th and Sales telling prospects usage billing goes live in early October.
- The office move requires self-packing with crates arriving Monday, sealed by October 1st, and the move on the 2nd.
- Production is at 0% on the new flag except the internal Tallyport dogfood account at 100% for three weeks and the 14 beta accounts (~1.8% of 780 eligible accounts).
- Viktor's idempotency-keys fix for the retry bug is in progress and fixes retries at any delay up to 24 hours.
- Finance confirmed the Kestrel Logistics overbilling amount of $18,240 yesterday.
- Perf test threshold was updated to 1.2 seconds.
- Maya has a draft rollout plan in place covering the 14th at 10%, then 25%, 50%, and 100% by end of October.
- Viktor confirmed v1 keeps rating in shadow mode for 30 days after an account moves over, enabling per-account total diffs via a script taking about half a day.
- The privacy review from the security team (the DPIA for storing raw usage events) is approved as of last Thursday.
- The legal review of the order form addendum is not done; it is still open with Joelle Park and sitting in her queue.
- The sales deck is updated and the pricing page copy is with marketing, scheduled to go live on launch day.
- All 14 beta customers were told October 6th via the August beta newsletter.
- Rohan is running a one-hour recorded sales training session on October 9th for reps with usage-tier deals in flight.
- Maya has taken over the migration runbook from Viktor.
- Speaker 3 plans to provide a list of what the 12 tests don't cover.
- Speaker 3 still needs to see how much beta traffic comes in without an idempotency key before picking an approach for the no-key dedup fallback.

#### Decisions
- Rounding settled with finance: half-even at the invoice line item, not per event, with Priyanka signing off Monday — changing numbers only by cents on a handful of accounts.
- The usage chart will use the account's billing time zone so the chart and invoice agree at the month boundary.
- The team agreed to park the invoice preview question for the date discussion, since it is fundamentally a date question.
- A real migration runbook is required before touching the other nine shards, with Viktor owning it and delivering by Monday the 28th.
- CSV only for launch export; Excel moves to the later list.
- The empty-state decision stays open, not solved in the meeting; both variants go in front of customers with results reviewed on the 24th.
- Launch latency bar agreed at 1.2 seconds p95 on big accounts, achievable via a smaller per-meter subtotal caching fix taking two or three days rather than a week and a half.
- Full hourly pre-aggregation moves to the backlog with no committed date and is not a launch requirement.
- The replay tooling gap was noted as a risk to be tracked rather than solved in this meeting.
- New launch date is Wednesday, October 14th, explicitly not the 13th to avoid launching the same day Maya finishes testing.
- Tripwire rule: if Payments Platform hasn't shipped ledger 3.4 to production by Friday, October 2nd, launch auto-moves to October 20th with no second meeting.
- Early access soft launch on the 7th was rejected as equivalent risk.
- October contracts landing between the 1st and 14th stay on v1 with manual adjustments and migrate during rollout.
- Migration runbook reassigned to Maya, still due the 28th, with Viktor doing a brain dump.
- Sev-1 'closed' for launch criteria means verified in staging with a failing-first regression test; merged does not count.
- Kestrel Logistics is removed from automatic flag cohorts and migrated manually on a date they pick, after the fix is verified on their data.
- The free-month goodwill gesture for Kestrel Logistics was deliberately not decided in this meeting.
- Rollout start reversed from 10% to 5% of eligible accounts for the first 48 hours with v1 shadow reconciliation before expanding.
- Expansion cadence set at 25% on October 19th, 50% on the 21st, and 100% on October 26th, with no expansion on a Friday.
- First 5% excludes accounts over 2 million events; big accounts enter at the 25% stage.
- Pause trigger set at >0.5% variance between v2 and shadow v1 totals, excluding known rounding differences, with pause-and-look rather than automatic rollback.
- Rollback drill scheduled for Thursday, October 8th in staging with the full migration across all 12 shards, owned by Maya.
- Go/no-go meeting set for Monday, October 12th with the same group plus Joel.
- Change freeze on billing services October 12th–16th; the tax team's Canadian GST on credits change must move to the 19th or be justified as unable to wait.
- Launch-week on-call pairs a backend engineer with a billing support person for the 48-hour window rather than relying on the normal rotation.
- Legal sign-off (explicitly the legal review, not the privacy one) added to the go/no-go checklist.
- The order form addendum legal review is treated as launch-blocking.
- Preview stays at 1.2 seconds and is not being dropped, despite Rohan's concern.
- Status page will not carry product announcements; an in-app banner idea for the invoice format change was rejected as unread.
- Kestrel Logistics excluded from rollout cohorts.
- The next checkpoint meeting is moved from 10:00 to 10:30 on Thursday, September 24th.

#### Blockers
- Viktor flagged that Payments Platform must ship idempotency support on the ledger write API (their v3.4) or retries from the posting worker can double-post invoice line items.
- Payments Platform's Sept 29th date is only 'targeting' per Sunil, which the team reads pessimistically (Speaker 1: 'Means October').
- The dedup no-key fallback is unresolved and blocks finalizing dedup behavior; hashing payloads breaks for legitimately identical events.
- The staging-eu disk issue was only cleaned up, not fixed — the retention job still isn't running and it will refill in ~3 weeks, right around launch.
- The migration dry run is manual with no runbook, which blocks proceeding to the remaining nine shards safely.
- The invoice preview read-path aggregation (walks every event) is a real chunk of work, estimated at a week and a half for Viktor to pre-aggregate hourly.
- Replay tooling has only 12 tests despite being the primary recovery mechanism for re-rating batches during incidents.
- The migration dry run is manual with no runbook; the only existing doc says 'do the thing from Tuesday' at step 4.
- Two Sev-1s are open, one of which is customers being overbilled.
- Nine migration shards have not been dry run and must wait on the runbook.
- Launching on the 6th would leave only five working days to test ledger integration versus the ten Maya needs, forcing cuts to the rollback drill and dry runs.
- Current preview latency on big accounts is 1.4s p95, at the time of the pre-aggregation work not being done.
- Two open Sev-1s and an unshipped dependency blocked the original October 6th date.
- Viktor cannot complete the runbook by the 28th alongside dedup, proration, latency caching, and the Sunil ledger integration.
- The 5-minute retry-counting window bug caused Kestrel Logistics' 8-minute retries to be counted twice, overbilling $18,240 of a ~$61,000 August usage invoice.
- Kestrel Logistics' invoice is on hold, and their renewal (Nov 1) is at risk until they trust the meter.
- At 10% rollout, 78 accounts could receive bad invoices before the first bill run surfaces the problem on day one.
- The legal review of the order form addendum is still open with Joelle Park and is launch-blocking; her team's SLA is ten business days from submission on the 16th, making September 30th the latest.
- The help center invoice articles (about six) are unowned and docs is down to two people, both currently on the v2 API reference.
- Salesforce sync may truncate fractional usage quantities (e.g., 12.5 units) because it likely casts to integers, threatening sales reporting and commissions.
- Ownership of the Salesforce sync may have been orphaned in the re-org, so no one is clearly responsible.
- The October 2nd tripwire falls on the same day as the office move, making it difficult to verify.

#### Dependencies
- The dedup fix depends on Payments Platform's ledger write API idempotency (v3.4), a separate endpoint from the payments idempotency in 3.3.
- Dedup correctness depends on customer-side idempotency keys: Node and Python SDKs send one, Go next week, Java not started, and many customers call raw HTTP with no SDK.
- The time-zone chart fix is owned by the front end team and is on Ines's list too.
- Stage-eu availability gates the EU currency regression suites, which could not run for two days due to the disk fill.
- Migration of the remaining nine shards is sequenced behind producing a real runbook.
- The launch timeline depends on Payments Platform shipping on the 29th, leaving roughly one week of buffer before October 6th.
- QA needs about ten working days after the 29th ledger change to close Sev-1s, run full regression, dry run all 12 shards, and do one rollback drill — landing Tuesday, October 13th.
- The October 7th marketing webinar is built around an October 6th launch and is the only fixed external commitment.
- Q4 pricing changes mean new contracts from October 1st are written with usage tiers, so v2 not being live forces v1 invoicing with manual adjustments.
- The invoice PDF is generated by the billing service and the template is Viktor's team's but untouched for two years, leaving PDF audit ownership unclear.
- Sample data in the empty state would need to be kept in sync with every chart change, an ongoing coupling noted by QA.
- Excel export would require another library and another set of formatting bugs, treated as dependency cost for not adding XLSX at launch.
- Launch is gated on Payments Platform shipping ledger 3.4 to production by Friday, October 2nd.
- Viktor works with Sunil on the ledger integration.
- Migration runbook depends on Viktor's brain dump session with Maya tomorrow at 2.
- Kestrel Logistics' own migration date is contingent on the fix being verified on their data first.
- Custom migration date for Kestrel requires Maya's team to manually flip the account outside flag cohorts.
- The rollout depends on v1 keeping rating in shadow mode for 30 days post-migration to enable reconciliation and rollback.
- The rollback drill depends on the migration running across all 12 shards in staging.
- The change freeze requires coordination with the tax team, which has a Canadian GST on credits change queued for the 13th.
- Any contract signed on usage tiers requires the legal order form addendum attached, since it covers overage billing, usage dispute terms, and the 30-day contest window.
- Launch availability depends on Payments Platform shipping ledger 3.4 by the 29th, with an October 2nd tripwire in place.
- Kestrel Logistics renewal is being handled by Joel, whose call on the 23rd covers them instead of the beta email.
- The October 2nd tripwire depends on whether Sunil's release is in production that day.

#### Follow-up needed
- Assign a clear owner for chasing Sunil Varghese at Payments Platform on the ledger idempotency date at the end of the meeting.
- Check whether the three flaky JPY currency-rounding tests are a real bug or a shared fixture issue.
- Follow up with infra on the retention job that is supposed to trim the staging-eu event store disk and still isn't running.
- Resolve the key question of how to handle requests arriving with no idempotency key, pending beta traffic analysis.
- Revisit the invoice preview decision (keep, limit for ~60 large accounts, or pre-aggregate hourly) as part of the launch-date discussion.
- Bring Joel in on the customer escalation when he arrives around the half hour, given his hard stop.
- Ines to show both empty-state variants A and B and capture which one customers understand, delivering results Thursday the 24th.
- The 1.2s p95 latency bar needs to be written down; QA will update the perf test threshold accordingly.
- Owner for a potential invoice PDF accessibility audit needs to be identified; flagged as likely a separate conversation.
- Someone should ask facilities about monitors for the Harlow building move.
- Rohan's stairs/stakeholders joke was flagged to go into the retro doc.
- Decision on whether 800ms was ever the right target versus the possibly-copied invoice list page spec still needs resolving; UX comfortable under ~1.25s for the side panel.
- Finalize whether the October 7th webinar moves to the 15th or remains as a preview, pending Carla's input.
- Raise the potential Kestrel Logistics free-month goodwill gesture with Joel's director before the renewal.
- Write the failing-first regression test requirement into the go/no-go checklist.
- Maya to assess whether to reconcile shadow rating during the proposed 48-hour hold (pending Dana's question to Viktor).
- Resume the remainder of the staged rollout plan discussion after the Kestrel item.
- Keep Kestrel Logistics out of usability sessions next week; Kestrel Health is fine to include.
- Rohan to ping Joelle Park today and again on the 28th so the legal review completes by September 30th, escalating if not done by October 1st.
- The meeting lead to escalate the ledger 3.4 schedule with Sunil and his manager Grace Obi, prioritizing Viktor's coding time over status emails.
- Viktor and the meeting lead to discuss replay tooling coverage on Monday, as no answer exists today.
- Someone needs to verify whether the Salesforce sync handles fractional quantities and find its current owner.
- A name must be assigned to the help center invoice-article update by next week.
- The beta customer group needs an update email before they hear about the 14th from a sales rep; Kestrel Logistics handled separately via Joel's call.
- Me and Viktor will talk about the replay tooling coverage on Monday.
- Speaker 3 will bring a list of what the 12 tests don't cover.

#### Action items (structured)
- Viktor: Merge the dedup fix (idempotency keys with 24-hour retention) by next Friday. (deadline: next Friday (the 25th))
- Dana (me): Chase the Payments Platform team (Sunil Varghese) on shipping idempotency support on the ledger write API (v3.4).
- Maya: Chase the open infra ticket about the staging-eu disk fill / retention job not running.
- Viktor: Own writing a real migration runbook before anyone touches the remaining nine shards.
- Viktor: Look at beta traffic to see how many requests arrive without a client-supplied idempotency key before deciding the no-key fallback.
- October 6th launch date — 19 days out from Thursday the 17th [inferred]
- Dedup fix merged by next Friday, the 25th [inferred]
- Payments Platform ledger idempotency (v3.4) targeted for September 29th [inferred]
- Viktor: Own and deliver the migration runbook. (deadline: Monday the 28th)
- Ines: Show both empty-state variants (A and B) to real customers and share results. (deadline: Thursday the 24th)
- Speaker 4: Update the perf test threshold to 1.2 seconds.
- Ask facilities whether monitors move with the team or new ones are provisioned in the Harlow building. [inferred]
- Ines: Mock up a middle empty-state option combining a setup checklist with a small preview thumbnail of a populated dashboard. [inferred]
- Migration runbook due Monday the 28th. [inferred]
- Empty-state usability session results shared Thursday the 24th. [inferred]
- Crates for the office move arrive Monday; sealed by October 1st; move on the 2nd. [inferred]
- Payments Platform release on the 29th; ten working days after is Tuesday, October 13th. [inferred]
- Speaker 1: Talk to Carla about whether the webinar moves or stays on the 7th as a preview. (deadline: by tomorrow)
- Speaker 1: Give finance ops a heads-up to plan hours for roughly a dozen October contracts on v1 manual adjustments.
- Maya: Build the rollout plan around 10% of eligible accounts on day one.
- Maya: Look at cohort membership for the October contracts when writing the plan.
- Viktor: Viktor does a brain dump session with Maya for the migration runbook.
- Viktor and Maya: Brain dump session scheduled for tomorrow at 2, with the Google doc, Slack thread, and Tuesday content brought by Viktor. (deadline: tomorrow at 2)
- Viktor and Dana: Viktor drafts the technical explanation of the retry bug; Dana turns it into the customer version.
- Dana: Deliver the customer-facing root cause write-up to Joel by the 22nd, and Dana joins the customer call on the 23rd. (deadline: 22nd)
- Joel: Joel drafts the credit memo for $18,240 and gets it through finance, targeting approval by Monday the 21st. (deadline: Monday the 21st)
- Viktor: Viktor's idempotency keys fix for the retry bug is in progress, targeted for merge by September 25th. (deadline: September 25th)
- Viktor's brain dump for migration runbook [inferred]
- Credit memo approval target [inferred]
- Customer root cause write-up delivered to Joel [inferred]
- Idempotency fix merge target [inferred]
- Payments Platform ledger 3.4 to production tripwire [inferred]
- Viktor: Reconcile every account in the 5% cohort against v1 shadow rating during the first 48 hours. (deadline: 48 hours after launch (October 15th))
- Viktor: Write the shadow reconciliation script (a script, half a day of work); needed by October 7th before the drill. (deadline: October 7th)
- Rohan: Send the go/no-go meeting invite for October 12th. (deadline: before October 12th)
- Maya: Tell the tax team about the change freeze on billing services (October 12th–16th). (deadline: today)
- Viktor: Take the first 24 hours of launch-week on-call. (deadline: first 24 hours of the 48-hour window (October 13th–14th))
- Me: Ask Lukas for the second 24 hours of on-call coverage. (deadline: second 24 hours of the window)
- Rohan: Follow up with Joelle Park to ensure the legal review of the order form addendum is done by September 30th. (deadline: September 30th (ping today and again on the 28th))
- Rohan: Send the beta group an update by Tuesday, October 22nd. (deadline: October 22nd)

#### Decisions (structured)
- Rounding will be done at the invoice line item using half-even rounding, not per event, with Priyanka in finance signing off on Monday.
- The usage chart should use the account's billing time zone rather than the viewer's browser time zone.
- Build a real runbook for the migration before touching the other nine shards, due Monday the 28th. (owner: Viktor)
- Launch with CSV only for export; Excel/XLSX goes on the later list.
- Launch latency bar set at 1.2 seconds p95 on big accounts via a smaller caching fix, and the full hourly pre-aggregation goes to the backlog, not a launch requirement.
- Empty state decision remains open; results from customer usability sessions to be reviewed on the 24th.
- New launch date set to Wednesday, October 14th (not the 13th, to avoid same-day as Maya finishing testing). (owner: Dana)
- If Payments Platform hasn't shipped ledger 3.4 to production by Friday, October 2nd, launch automatically moves to October 20th with no second meeting. (owner: Dana)
- No early access launch on October 7th — rejected as the same risk with a different name. (owner: Dana)
- October contracts between the 1st and 14th stay on v1 with manual adjustments and get migrated during the rollout like everyone else. (owner: Dana)
- Migration runbook ownership moves to Maya, still due the 28th; Viktor provides a brain dump session. (owner: Dana)
- 'Sev-1s closed' for launch criteria means verified in staging with a regression test that fails on the old code; merged does not count. To be written into the go/no-go checklist. (owner: Dana)
- Kestrel Logistics is excluded from the automatic rollout and will be migrated on a date they choose, after the fix is verified on their data. (owner: Dana)
- Raising the goodwill free-month gesture for Kestrel Logistics was deferred — not decided in this meeting; Joel to raise with his director if needed. (owner: Joel)
- Update the perf test threshold to 1.2 seconds. (owner: Speaker 4)
- Full hourly pre-aggregation goes into the backlog, not a launch requirement (no committed date). (owner: Dana)
- The first rollout stage is 5% of eligible accounts for 48 hours with reconciliation against v1 shadow rating before expanding, reversing the earlier 10% decision. (owner: Me)
- If reconciliation is clean, rollout expands to 25% on Monday, October 19th, then 50% on the 21st, and 100% on Monday, October 26th. (owner: Maya)
- The first 5% rollout cohort excludes accounts over 2 million events; the big accounts come in at the 25% stage. (owner: Me)
- The pause trigger is any account where the v2 total differs from the shadow v1 total by more than 0.5%, excluding known rounding differences; the rollout pauses rather than auto-rolls back. (owner: Maya)
- A rollback drill will be held Thursday, October 8th in staging with the full migration on all 12 shards; Maya owns it. (owner: Maya)
- The go/no-go meeting is set for Monday, October 12th with the same group plus Joel. (owner: Me)
- A change freeze on billing services runs October 12th through 16th; nothing else ships to billing that week unless it is a fix for v2. (owner: Maya)
- The tax team's Canadian GST on credits change queued for the 13th must move to the 19th unless they convince Maya it can't wait. (owner: Maya)
- Launch-week on-call will pair a backend engineer and a billing support person together for the 48-hour window, not just the normal rotation. (owner: Maya)
- Legal sign-off (the legal review, not the privacy review) is added to the go/no-go checklist. (owner: Me)
- The legal review of the order form addendum is launch-blocking; the addendum covers new usage terms, overage billing, metered usage disputes, and the 30-day window to contest a usage charge. (owner: Rohan)
- The preview stays at 1.2 seconds and is not being dropped. (owner: Viktor)
- Kestrel Logistics is excluded from the rollout cohorts. (owner: Maya)
- The next checkpoint meeting is moved from 10:00 to 10:30 on Thursday, September 24th. (owner: Me)
- The replay tooling coverage question remains open and will be discussed by Me and Viktor on Monday. (owner: Me, Viktor)

#### Open questions (structured)
- How should requests with no client-supplied idempotency key be handled, given payload hashing breaks for legitimately identical events? [open]
- Should the invoice preview be dropped or limited for the ~60 large accounts at launch to hit the date? [open]
- Is Payments Platform's September 29th date for ledger idempotency a target or a commitment? [open]
- Which empty-state variant (A sample data or B setup checklist) should ship for new customers with zero events? [open]
- Does the accessibility audit cover the invoice PDF, and who would own a PDF audit? [open]
- Whether 800 milliseconds was ever the right preview latency target given it may have been copied from the invoice list page spec. [open]
- Should the October contracts (arriving 1st–14th) be part of the first rollout cohort? [open]
- Should Kestrel Logistics receive a free month as a goodwill gesture before renewal? [open]
- Can the team reconcile against shadow rating as part of the 48-hour hold? [open]
- Whether Payments Platform actually ships ledger 3.4 by the 29th (with the October 2nd tripwire). [open]
- Whether the empty state should be A or B. [open]
- Whether the webinar moves off the 7th. [open]
- Who owns the help center update for the invoice PDF format change. [open]
- Who owns the Salesforce sync question (possibly orphaned in the re-org). [open]
- Whether Kestrel Logistics renews, and whether they receive anything beyond the credit. [open]
- What happens with the replay tooling coverage (unanswered; Viktor and the meeting lead to discuss Monday). [open]
- Will Kestrel Logistics renew? [open]
- Will we give Kestrel Logistics anything beyond the credit? [open]
- What happens with the replay tooling coverage? [open]

#### Risks (structured)
- [high] Payments Platform ledger write API idempotency (v3.4) not committed — only targeted for Sept 29th — risking double-posting of invoice line items.
- [high] Invoice preview p95 latency is 1.4s versus an 800ms target for large accounts (>2M metered events, ~60 accounts).
- [high] staging-eu disk retention job still not running; expected to fill again in ~3 weeks, right around launch.
- [high] The migration dry run has no runbook — manual steps only in a Slack thread and a Google doc with vague instructions like 'do the thing from Tuesday'.
- [medium] Dedup window is only 5 minutes, so client retries after that window double-count events; two SDKs (Node, Python) send keys, Go next week, Java not started.
- [high] Proration bug (Sev-1): mid-cycle plan switches rate prior usage at the new plan's price instead of the old one.
- [high] Replay tooling, the recovery story for re-rating batches, has only 12 tests despite being run during incidents.
- [high] Two Sev-1s open, one involving customers being overbilled.
- [high] Nine shards of migration have not been dry run and depend on the runbook.
- [high] Launch depends on Payments Platform shipping on the 29th, leaving only one week of buffer before the 6th if on time.
- [high] If launched on the 6th with Payments on time, only five working days remain to test ledger integration versus Maya's stated ten, cutting the rollback drill and dry runs.
- [medium] Delaying launch forces ~25-30 new October contracts to be invoiced on v1 with manual adjustments (~4 hours per contract per month, ~100 hours/month).
- [medium] Sample data in the empty state risks customers screenshotting fake numbers to finance; 3 of 14 beta customers already screenshotted the dashboard.
- [medium] Competitor Meterbase launched usage analytics in August and was cited in two lost deals last quarter, creating market pressure to launch earlier.
- [high] Two open Sev-1s and an unshipped dependency make the original October 6th launch date unrealistic.
- [high] A metering bug like the retry issue at a 10% rollout would send bad invoices to 78 customers, and invoices only generate at the first bill run after flip.
- [high] Viktor is overloaded — dedup fix, proration fix, latency caching, ledger integration with Sunil — and cannot also write the runbook by the 28th.
- [high] Kestrel Logistics renewal (Nov 1) is threatened: VP of finance Oksana Reyes stated they cannot move their full account to usage billing until they trust the meter.
- [high] Payments Platform shipping ledger 3.4 to production by October 2nd is the gating dependency for the October 14th launch.
- [medium] Preview latency risk is concentrated in the 60 big accounts, which is why the first cohort excludes accounts over 2 million events.
- [high] The legal review of the order form addendum is still open with Joelle Park and is launch-blocking; SLA is ten business days with a September 30th outer bound.
- [medium] Information hygiene risk: the team initially conflated the privacy review (approved) with the legal review (still open), risking a false assumption that legal was done.
- [high] The Salesforce sync may cast to integers and mishandle fractional usage quantities (e.g., 12.5 units), potentially breaking sales reporting and commissions.
- [medium] Help center articles on reading your invoice (about six of them) need updating before the 14th but are unowned, and docs has only two people currently on the v2 API reference.
- [medium] Invoice PDF format changes (line items grouped by meter instead of by date) are expected to generate customer tickets.
- [medium] The October 2nd tripwire is the same day as the office move, so nobody will be at a desk that day.

#### Follow-up draft
Hi team,

Quick update on usage-based billing v2.

Progress:
Metering load test held 42k events/sec for two hours against a 30k target, with Kafka lag under ~9s at 48 partitions. Migration dry run clean on 3 of 12 shards. Privacy review (DPIA) approved.

Decisions:
- New launch date: Wednesday, October 14th. If Payments Platform hasn't shipped ledger 3.4 to production by Friday, October 2nd, launch auto-moves to October 20th — no second meeting.
- Rollout starts at 5% of eligible accounts for 48 hours (accounts over 2M events excluded), then 25% on the 19th, 50% on the 21st, 100% on the 26th. No expansion on a Friday.
- Pause trigger: any account where v2 differs from shadow v1 by more than 0.5%, excluding known rounding differences. Pause and look, not auto-rollback.
- Rounding is half-even at the invoice line item, not per event; Priyanka signs off Monday.
- Usage chart uses the account's billing time zone, not the viewer's browser.
- CSV-only export for launch; Excel goes on the later list.
- Latency bar is 1.2s p95 on big accounts via a smaller caching fix; full hourly pre-aggregation moves to the backlog.
- Migration runbook now with Maya, due the 28th. Needed before the remaining nine shards.
- Rollback drill October 8th, go/no-go October 12th, change freeze on billing services October 12th–16th.
- Kestrel Logistics comes out of the automatic cohorts and migrates manually on a date they pick, after the fix is verified on their data.
- October contracts landing before the 14th stay on v1 with manual adjustments and migrate during rollout.

Blockers:
- Payments Platform ledger write API idempotency (v3.4) is only targeted for Sept 29th, not committed. Without it, retries can double-post invoice line items.
- Dedup no-key fallback unresolved — needs the beta traffic breakdown before we pick an approach.
- staging-eu disk retention job still isn't running; it refills in about three weeks, right around launch.
- Invoice preview p95 is 1.4s against the 1.2s bar on the ~60 large accounts.
- Legal review of the order form addendum is still open with Joelle Park and is launch-blocking. Her SLA puts September 30th as the outer bound.
- Two Sev-1s open, one is customers being overbilled.
- Replay tooling has 12 tests; Viktor and I are picking that up Monday.
- Help center invoice articles (~6) still unowned.
- Salesforce sync may truncate fractional usage quantities, and ownership may be orphaned in the re-org.

Next checkpoint is 10:30 on Thursday, September 24th.

Thanks,

---

# Summary E

_(run1)_

### Title: Billing V2 Launch Readiness and Rollout Plan

#### Overview
Backend metering exceeded its load target, but invoice-preview latency, deduplication and ledger idempotency, QA defects, staging retention, and the migration runbook remain launch risks. The team assigned Viktor a migration runbook due September 28, kept the empty-state design open for customer testing, agreed on a 1.2-second preview latency bar, and debated launch timing against migration and billing risks. The team moved the billing launch to October 14 with an October 2 Payments tripwire, reassigned the migration runbook, established Kestrel Logistics remediation, and challenged the planned 10% rollout in favor of a possible 5% reconciliation cohort. The team agreed on a staged 5% rollout with reconciliation and pause criteria, assigned launch-readiness actions, and surfaced unresolved legal, ledger, documentation, Salesforce, and replay-tooling dependencies. The team left replay coverage and dedup fallback unresolved, assigned preparation for the next checkpoint, and moved that checkpoint to September 24 at 10:30. Key decisions: Rating will round at the invoice line-item level using half-even rounding rather than rounding each event.; The usage chart will use the account's billing time zone rather than the viewer's browser time zone so it aligns with the invoice.; A real migration runbook is required before the remaining nine shards are migrated.. Progress since last sync: The metering load test sustained 42,000 events per second for two hours against a 30,000-events-per-second target, with consumer lag staying below approximately nine seconds.

#### Summary
- The meeting focused on billing launch readiness, rollout planning, and metering and invoice behavior.
- The team set the billing launch for October 14, with an automatic move to October 20 if Payments Platform has not shipped the required ledger update by October 2; rollout will begin with 5% of eligible accounts for 48 hours, excluding accounts over 2 million events, and expand only after reconciliation.
- Rating will use half-even rounding at the invoice line-item level, usage charts will use the account billing time zone, exports will be CSV only, and the remaining nine migration shards require a real runbook before migration.

#### Progress since last sync
- The metering load test sustained 42,000 events per second for two hours against a 30,000-events-per-second target, with consumer lag staying below approximately nine seconds.
- The staging cluster is now running with 48 partitions, increased from 24 last sprint, with only a couple hundred dollars per month of estimated infrastructure cost.
- Rating-engine unit-test coverage is 81%, while metering-service coverage is 67% because replay tooling has almost no tests.
- The client-supplied idempotency-key PR is approximately 70% complete, and Node and Python SDKs already send keys while Go is planned for next week and Java has not started.
- The regression suite has grown to 1,312 tests, including roughly 140 added this sprint, with a 96.4% pass rate on the latest run.
- The migration dry run completed successfully on three of twelve shards, averaging 38 minutes per shard with zero reconciliation mismatches.
- The open-defect count was corrected to two Sev-1s, seven P1s, 23 P2s, and 41 P3s after two P1s were closed that morning.
- The usage dashboard is approximately 90% built, with only the export button and meter-level drill-down remaining on the frontend.
- The dashboard accessibility audit found two chart-legend color-contrast issues, and both have already been fixed.
- The migration dry run is currently documented only informally in a Slack thread and Google Doc rather than a proper runbook.
- Replay tooling currently has 12 tests, which Viktor characterized as good tests.
- The current preview latency is 1.4 seconds p95 on large accounts before the proposed caching optimization.
- The internal Tallyport account has been dogfooding the new flag at 100% for three weeks, while 14 beta accounts are also enabled.
- The current enabled population represents approximately 1.8% of the 780 eligible accounts.
- Viktor's idempotency-key fix is in progress and targeted for merge by September 25.
- The Kestrel Logistics overbilling was isolated to API calls in the shipment-tracking subsidiary meter, while the warehouse and fleet meters were unaffected.
- The full hourly pre-aggregation work was moved to the backlog and is not a launch requirement.
- The team confirmed that v1 remains in shadow rating for 30 days after migration, enabling per-account total diffs through a script estimated at roughly half a day.
- The privacy review for storing raw usage events has been approved.
- The sales deck has been updated, while pricing-page copy is with marketing for launch-day publication.
- The pricing page will retain the preview claim at 1.2 seconds.
- All 14 beta customers were previously told about October 6 in the August beta newsletter.
- The legal status was corrected from believed-complete to still open for the order form addendum.
- The team identified that the current 12 tests do not cover a substantial set of scenarios, which Speaker 3 will document.
- The deduplication fallback approach has not advanced to a selection because beta traffic without an idempotency key still needs to be measured.

#### Decisions
- Finance approved half-even rounding at the invoice line-item level instead of per-event rounding.
- The account billing time zone, rather than the viewer's browser time zone, is the source for usage-chart dates.
- The invoice-preview decision was deferred to the launch-date discussion rather than resolved in the backend status review.
- The remaining nine migration shards will not be touched until a real runbook exists.
- Launch exports will use CSV only, with Excel deferred until there is stronger customer demand.
- The empty-state choice will not be settled in this meeting and will be revisited using customer research results on the 24th.
- The launch preview performance threshold is set at 1.2 seconds p95 for large accounts.
- Full hourly pre-aggregation is explicitly excluded from launch scope and will remain backlog work.
- The team selected October 14 as the billing launch date, with an automatic October 20 fallback tied to the October 2 ledger 3.4 tripwire.
- The team rejected an October 7 early-access launch because it carries the same risk as a full launch.
- Launch readiness requires Sev-1 fixes to be verified in staging with failing-first regression tests rather than merely merged.
- Kestrel Logistics will receive a credit for the $18,240 overbilling instead of a refund because its invoice remains unpaid.
- Kestrel Logistics will be manually migrated on a customer-selected date after its data validates the fix.
- The rollout will begin at 5% for 48 hours and require shadow-v1 reconciliation before widening.
- Accounts over 2 million events will be excluded from the first cohort and introduced at 25%.
- A difference above 0.5% versus shadow v1 will pause rollout investigation without an automatic rollback.
- Billing services will be frozen from October 12 through 16 except for v2 fixes.
- Legal review, rather than the already approved privacy review, will be a go/no-go checklist item.
- The next checkpoint will take place at 10:30 on September 24 instead of 10:00.
- The October 2 tripwire can be checked remotely and does not depend on desk availability.

#### Blockers
- Invoice preview for accounts above roughly two million metered events has 1.4-second p95 latency against an 800-millisecond target.
- The deduplication defect remains a Sev-1 because retries after the five-minute window can count the same event twice.
- The proration defect remains a Sev-1 because usage before a mid-cycle plan change is rated at the new plan's price.
- Four customer-visible P1s remain, including CSV formatting issues and a time-zone chart defect.
- Proration failures and three JPY currency-rounding tests are reducing the regression-suite pass rate, with the rounding failures suspected to be caused by a shared fixture.
- Staging-eu was unavailable for two days because the event-store disk filled, and the underlying retention job remains broken.
- Nine migration shards have not yet been dry-run, and the current procedure lacks a reliable runbook.
- Two Sev-1 issues remain, including a customer-overbilling problem.
- Replay recovery coverage is limited to 12 tests despite replay being needed to correct incorrectly rated production batches.
- The launch schedule depends on Payments Platform delivering on the 29th.
- QA requires both Sev-1s closed, regression green except known flakes, all 12 shards dry-run, and one rollback drill before launch.
- The empty-state decision is blocked pending customer evidence because sample data could create misleading screenshots and support tickets.
- Two open Sev-1 issues and an unshipped dependency prevent an October 6 launch.
- Payments Platform ledger 3.4 is the critical dependency that can force the launch to October 20.
- Kestrel Logistics has paused payment on an invoice containing approximately $18,240 of overbilling.
- Kestrel Logistics will not move its full account to usage billing until it trusts the meter.
- The initial 10% rollout could expose 78 accounts to incorrect billing before the first bill run reveals the problem.
- Speaker 3 cannot absorb the migration runbook while also handling four other engineering responsibilities without risking the Sev-1 work.
- The legal review of the order form addendum remains launch-blocking and is still in Joelle Park's queue.
- The Salesforce sync owner is unclear, and possible integer casting could corrupt fractional usage reporting and commissions.
- The ledger 3.4 dependency lacks a committed delivery date and has an October 2 tripwire.
- The replay tooling coverage is unresolved because the team has not determined what the existing 12 tests omit.
- The no-key dedup fallback cannot be selected until beta traffic without idempotency keys is measured.
- Replay tooling coverage has no answer yet and remains open pending the Monday discussion.
- The dedup fallback is blocked on understanding beta traffic without an idempotency key.
- The October 2 office move creates a logistical risk for the tripwire, although the team expects remote checking to be sufficient.

#### Dependencies
- The backend fix depends on Payments Platform shipping idempotency support for the invoice-line-item ledger endpoint in version 3.4.
- The Payments Platform dependency is being coordinated with Sunil Varghese, whose current status is a September 29 target rather than a firm commitment.
- The chart time-zone fix involves the front-end team and must remain consistent with invoice billing-time-zone behavior.
- Migration of the remaining nine shards depends on documenting the currently manual process that is spread across a Slack thread and a Google doc.
- The no-key deduplication behavior depends on beta-traffic data because raw HTTP customers and SDKs without support may continue using the five-minute fallback.
- The remaining nine migration shards cannot be touched until the migration runbook is completed.
- End-to-end ledger testing depends on the Payments Platform release landing on the 29th.
- The schedule must account for approximately ten working days after the ledger change for QA to complete its required testing.
- The empty-state decision depends on the usability sessions scheduled for Tuesday and Wednesday and their results on the 24th.
- The invoice-PDF accessibility audit is dependent on identifying an owner because the PDF is generated by the billing service while its template belongs technically to the current team.
- The launch date depends on Payments Platform shipping ledger 3.4 to production by October 2.
- The migration runbook depends on Viktor transferring operational knowledge to Maya in a brain-dump session.
- Kestrel Logistics' migration depends on the idempotency-key fix being verified against its data.
- The proposed 5% rollout depends on reconciling every account in the cohort against v1 shadow rating for 48 hours before expanding.
- The customer remediation depends on Viktor's technical explanation being converted into a customer-readable document before Joel's October 23 call.
- Rollout expansion depends on clean reconciliation against v1 shadow rating during the initial 48-hour cohort.
- The rollback plan depends on v1 retaining account data for 30 days and rollback being available by flipping the feature flag.
- The billing change freeze constrains the tax team's planned Canadian GST-on-credits change, which may need to move to October 19.
- The launch requires the legal addendum before contracts using usage tiers can be signed.
- The customer communication sequence depends on Rohan notifying the beta group before sales representatives do so, with Joel handling Kestrel Logistics.
- Kestrel Logistics communication depends on Viktor's technical root cause being turned into a customer version for Joel.
- The ledger schedule chase is owned by Me while Viktor remains responsible for the technical integration with Sunil.
- Selecting the no-key dedup fallback depends on observed beta traffic volume without an idempotency key.
- The October 2 tripwire depends on Sunil's release being in production, not on physical office access.
- The next checkpoint depends on Ines, Viktor, and Maya preparing their respective materials.

#### Follow-up needed
- Revisit the launch-date decision after assessing invoice-preview performance and the option of excluding the approximately 60 large accounts.
- Confirm whether the September 29 Payments Platform target is sufficiently reliable for launch planning.
- Review beta traffic to quantify requests arriving without client-supplied idempotency keys.
- Verify and resolve the three JPY currency-rounding test failures, including whether the shared fixture is the cause.
- Ensure the staging-eu retention job is restored before the event-store disk fills again in approximately three weeks.
- Document the migration procedure clearly enough to replace instructions such as the current step that says 'do the thing from Tuesday.'
- Review Ines's customer-session findings on the 24th and select the empty-state approach.
- Confirm the final launch date after reconciling marketing's October 6 webinar commitment with QA's readiness requirements.
- Document the 1.2-second preview threshold so it is visible to the team and reflected in performance testing.
- Determine ownership and scope for an accessibility audit of the invoice PDF.
- Ask Facilities to clarify monitor arrangements for the move to the Harlow building.
- Record the 1.2-second performance threshold in the agreed documentation.
- Add the failing-first staging verification requirement to the go/no-go checklist.
- Confirm the webinar disposition after Speaker 1 consults Carla.
- Produce and review a customer-readable root-cause explanation before the Kestrel Logistics call.
- Resolve whether the initial rollout should remain at 10% or change to 5% after confirming shadow-rating reconciliation is feasible.
- Decide whether to offer Kestrel Logistics an additional free month after assessing the customer-call context and Finance impact.
- Confirm whether the legal addendum is complete by September 30 and escalate immediately on October 1 if it is not.
- Confirm second-24-hour backend on-call coverage after asking Lukas Brandt.
- Determine ownership and update the six help-center invoice articles before launch.
- Identify the Salesforce sync owner and verify handling of fractional quantities.
- Obtain a committed ledger 3.4 date from Sunil and Grace Obi before the October 2 tripwire.
- Review the replay tooling test gaps with Viktor on Monday and decide what additional coverage is required.
- Assess beta traffic without idempotency keys before selecting a no-key dedup fallback.
- Decide whether to move the webinar off October 7 after Rohan consults Carla.
- Resolve what replay tooling coverage should include after the Monday discussion.
- Review the list of uncovered scenarios in the 12 tests.
- Determine the no-key dedup fallback approach after beta traffic without an idempotency key is observed.
- Clarify whether Kestrel Logistics will renew and whether any concession beyond the credit will be offered.

#### Action items (structured)
- Viktor: Merge the client-supplied idempotency-key fix for incoming usage events. (deadline: September 25)
- Viktor: Determine the no-key fallback behavior after reviewing beta traffic for requests that arrive without an idempotency key.
- Maya: Continue chasing Infra on the staging-eu retention-job issue.
- Viktor: Create the migration runbook before work begins on the other nine shards. [inferred]
- Merge the main idempotency fix by September 25. [inferred]
- Payments Platform is targeting invoice-line-item idempotency support for September 29. [inferred]
- The roadmap launch date is October 6, nineteen days away at the time of the meeting. [inferred]
- Viktor: Create a complete migration runbook covering the manual dry-run process. (deadline: the 28th)
- Ines: Show customers both empty-state variants during the five usability sessions and share the results. (deadline: the 24th)
- Speaker 4: Update the performance-test threshold to 1.2 seconds p95.
- Viktor: Implement the smaller caching fix for per-meter subtotals if pursued, targeting approximately 1.1–1.2 seconds p95 in two or three days. [inferred]
- Ask Facilities whether monitors are moving to the Harlow building or will be replaced. [inferred]
- Speaker 1: Discuss with Carla whether the October 7 webinar should move to October 15 or remain as a preview, and report back by the next day. (deadline: Tomorrow)
- Speaker 1: Give Finance Ops advance notice about the approximately two weeks of October contracts requiring manual-adjustment planning.
- Maya: Write the migration runbook and assess cohort membership for the October contracts. (deadline: September 28)
- Viktor: Hold a migration-runbook brain-dump session with Maya. (deadline: Tomorrow at 2)
- Viktor: Draft the technical explanation of the Kestrel Logistics overbilling root cause.
- Me: Convert the technical explanation into a customer-readable version and provide it to Joel before the October 23 customer call. (deadline: October 22, ideally in the morning)
- Me: Join the Kestrel Logistics customer call on October 23. (deadline: October 23)
- Joel: Draft and route a $18,240 credit memo for Kestrel Logistics through Finance. (deadline: Approval targeted for Monday the 21st)
- Joel: Determine whether to request an additional goodwill month for Kestrel Logistics by discussing it with the director if needed.
- Payments Platform ledger 3.4 production shipment tripwire [inferred]
- Billing launch [inferred]
- Fallback billing launch if the tripwire is missed [inferred]
- Migration runbook due [inferred]
- Idempotency-key fix targeted for merge [inferred]
- Kestrel customer-ready explanation due [inferred]
- Kestrel customer call [inferred]
- Kestrel credit approval target [inferred]
- Viktor: Run the shadow reconciliation script for the rollout. (deadline: October 7)
- Maya: Complete the rollback drill in staging across all 12 shards. (deadline: October 8)
- Rohan: Send the go/no-go meeting invite to the same group plus Joel. (deadline: October 12 meeting)
- Maya: Notify the tax team about the billing change freeze. (deadline: Today)
- Viktor: Cover the first 24 hours of launch-week on-call. (deadline: First 24 hours of the rollout)
- Me: Find coverage for the second 24 hours of launch-week on-call, starting by asking Lukas Brandt. (deadline: Not stated)
- Rohan: Follow up with Joelle Park about completing the legal review of the order form addendum by September 30 and report on October 1 if it is not complete. (deadline: September 30; escalation October 1)
- Rohan: Run the sales training session for representatives with usage-tier deals in flight. (deadline: October 9)
- Rohan: Email the beta customer group about the October 14 change, excluding Kestrel Logistics. (deadline: Tuesday the 22nd)
- Joel: Handle the Kestrel Logistics customer communication through the call covering them. (deadline: October 23)
- Assign an owner for updating the approximately six help-center articles about reading invoices before the October 14 launch. (deadline: Owner needed by next week; update before October 14)

#### Decisions (structured)
- Rating will round at the invoice line-item level using half-even rounding rather than rounding each event.
- The usage chart will use the account's billing time zone rather than the viewer's browser time zone so it aligns with the invoice.
- A real migration runbook is required before the remaining nine shards are migrated.
- Viktor will own a real migration runbook and deliver it by the 28th before the remaining nine shards are touched. (owner: Viktor)
- The launch export format will be CSV only; XLSX is deferred for later consideration.
- The empty-state design remains undecided between sample data and a setup checklist until customer-session results are reviewed on the 24th.
- The launch performance bar for preview latency is 1.2 seconds p95 on large accounts.
- Full hourly pre-aggregation is not a launch requirement and will be placed in the backlog without a committed delivery date.
- The billing launch date is Wednesday, October 14, with an automatic move to October 20 if Payments Platform has not shipped ledger 3.4 to production by Friday, October 2.
- An early-access or soft launch for beta customers on October 7 was rejected.
- October contracts will run on v1 with manual adjustments between October 1 and October 14 and will be migrated during the general rollout.
- The first rollout stage is set at 10% of eligible accounts on October 14, although the team had not yet resolved whether to reduce it to 5%.
- A Sev-1 counts as closed for launch only when it is verified in staging with a regression test that fails on the old code; merging alone does not count.
- Kestrel Logistics will be excluded from automatic rollout cohorts and migrated manually on a customer-selected date after the fix is verified on its data.
- The rollout will start with 5% of eligible accounts for 48 hours rather than 10%, with reconciliation against the v1 shadow rating before expansion.
- If reconciliation is clean, the rollout will expand to 25% on October 19, 50% on October 21, and 100% on October 26.
- The initial 5% cohort will exclude accounts over 2 million events, with larger accounts entering at the 25% stage.
- The rollout will pause when any account differs from the shadow v1 total by more than 0.5%, excluding known rounding differences, and will not automatically roll back.
- A rollback drill will run in staging on October 8 across all 12 shards, and the go/no-go meeting will be held on October 12 with the same group plus Joel.
- Billing services will have a change freeze from October 12 through October 16, except for fixes for v2.
- The launch-week support plan requires a backend engineer and billing support person together for the 48-hour window.
- Legal sign-off for the order form addendum, distinct from the already approved privacy review, will be added to the go/no-go checklist.
- The next checkpoint was rescheduled from 10:00 to 10:30 on September 24.
- The October 2 tripwire will be evaluated based on whether Sunil's release is in production, rather than requiring someone to be at a desk.

#### Open questions (structured)
- Whether invoice preview should be supported for the approximately 60 large accounts at launch, and whether its 1.4-second p95 latency is acceptable. [open]
- What fallback should be used for raw HTTP requests or SDK requests that do not supply an idempotency key. [open]
- Whether Payments Platform will actually deliver invoice-line-item idempotency support by its stated September 29 target. [open]
- When the proration fix and its associated tests will be complete. [open]
- Which empty-state experience should launch: sample data with a banner, a setup checklist, or another variant? [open]
- Who owns the accessibility audit for the invoice PDF generated by the billing service? [open]
- What launch date will be selected among October 6, October 13, and October 20? [open]
- Whether the preview should retain the existing 1.4-second p95 until the caching fix is completed was discussed but not separately scheduled. [open]
- Should the October 7 webinar move to October 15 or remain on October 7 as a preview? [open]
- Which rollout cohort should contain the October contracts, if any? [open]
- Can the team reconcile rollout accounts against v1 shadow rating before expanding the cohort? [open]
- Should the initial rollout be reduced from 10% to 5% and held for 48 hours? [open]
- Should Kestrel Logistics receive a free month in addition to the $18,240 credit? [open]
- Whether Payments Platform will ship ledger 3.4 by September 29, with an October 2 tripwire. [open]
- Which empty-state variant, A or B, should be selected. [open]
- Whether the webinar should move off the 7th. [open]
- Who owns the help-center update for the invoice format change. [open]
- Who owns the Salesforce sync and whether it correctly handles fractional quantities. [open]
- Whether Kestrel Logistics renews and whether the team will offer anything beyond the credit. [open]
- What replay tooling coverage is required beyond the current 12 tests. [open]
- What approach to use for no-key dedup fallback depends on the amount of beta traffic without an idempotency key. [open]
- What happens with replay tooling coverage? [open]
- Whether Kestrel Logistics renews and whether the team gives them anything beyond the credit remain unresolved. [open]

#### Risks (structured)
- [high] Invoice preview p95 latency is 1.4 seconds for large accounts against an 800-millisecond target.
- [high] The current five-minute deduplication window can double-count events when customers retry after the window expires.
- [high] The backend remains dependent on Payments Platform version 3.4 because retries can otherwise double-post invoice line items to the ledger.
- [high] Two Sev-1 defects remain open: deduplication double counting and incorrect proration after a mid-cycle plan change.
- [high] Staging-eu's retention job is still not running, so the event-store disk is expected to fill again in roughly three weeks around launch.
- [high] The migration process is not yet repeatable because the dry run is manual and lacks a proper runbook.
- [high] The migration dry run is largely manual, with procedures spread across Viktor's knowledge, a Slack thread, and an inadequate Google Doc.
- [high] Replay tooling, which is the recovery path for incorrectly rated production batches, has only 12 tests.
- [medium] Sample data in the empty state could be mistaken for real financial data when customers screenshot the dashboard.
- [high] The launch has two Sev-1 issues, including customer overbilling, and nine migration shards have not been dry-run.
- [high] Payments Platform must ship on the 29th, leaving only one week before an October 6 launch if it is on time.
- [high] Launching on October 6 would provide only five working days for ledger integration testing even though Maya needs ten, forcing cuts to rollback drills or migration dry runs.
- [medium] A delayed launch would create approximately 100 hours of manual spreadsheet adjustments per month for an estimated 25–30 October contracts.
- [medium] Preview latency is currently 1.4 seconds p95 on large accounts, which UX characterized as borderline.
- [high] The October 6 launch is not realistic because two Sev-1 issues remain open and a dependency has not shipped.
- [high] The launch depends on Payments Platform shipping ledger 3.4 to production by October 2.
- [high] Kestrel Logistics was overbilled by $18,240 because API retries after approximately eight minutes were counted as new events outside the five-minute deduplication window.
- [high] Kestrel Logistics has withheld its open invoice and does not trust usage billing before the metering fix is demonstrated.
- [high] Starting with 10% would expose 78 accounts to potentially incorrect invoices, which might not be visible until the first bill run.
- [medium] Speaker 3's workload across the dedup fix, proration fix, latency caching, ledger integration, and runbook made the original runbook deadline unrealistic.
- [medium] Preview latency risk is concentrated in the 60 large accounts, which will not enter the rollout until the 25% stage.
- [high] A per-account v2 versus shadow-v1 difference above 0.5%, excluding known rounding differences, will pause the rollout.
- [high] The legal review of the order form addendum is still open and is launch-blocking.
- [medium] The tax team's planned October 13 billing change conflicts with the October 12-16 change freeze unless it is deferred or approved as urgent.
- [medium] The invoice PDF format change may increase customer support tickets because line items will be grouped by meter instead of date.
- [high] The Salesforce sync may cast new fractional usage quantities such as 12.5 units to integers, threatening sales reporting and commissions.
- [high] The ledger 3.4 delivery date remains uncertain, with an October 2 tripwire.
- [medium] The current replay tooling tests do not cover all required scenarios, and the uncovered scope is not yet known.
- [medium] The 12 existing tests have a broad, currently unlisted coverage gap.
- [medium] The no-key dedup fallback approach cannot yet be selected because beta traffic volume without an idempotency key is unknown.
- [low] The October 2 tripwire coincides with the office move, so desk availability may be limited.

#### Follow-up draft
Hi team,

Decisions
Metering sustained 42,000 events/sec for two hours against a 30,000 target. Billing launches October 14, moving to October 20 if ledger 3.4 is not in production by October 2. Rollout starts at 5% for 48 hours, excluding accounts over 2M events, with shadow-v1 reconciliation and a pause above 0.5% variance. Rating uses half-even line-item rounding; charts use account billing time; exports are CSV-only. Viktor owns the migration runbook by September 28; the remaining nine shards stay blocked until it exists. Kestrel will receive an $18,240 credit and be migrated manually after validation.

Blockers
Two Sev-1s remain open: deduplication double-counting and mid-cycle proration. Payments ledger 3.4 has no firm delivery commitment and is launch-critical. Preview latency is 1.4s p95 for large accounts against the 1.2s bar. The staging-eu retention job is still broken, replay coverage gaps and no-key dedup fallback remain unresolved, and legal approval for the order-form addendum is still open. Salesforce ownership and fractional-usage handling also need resolution.

Thanks,

---

# Summary F

_(run1)_

### Title: Usage-Based Billing v2 Launch Readiness

#### Overview
Weekly launch-readiness check for usage-based billing v2, 19 days from the October 6 date: Viktor reported metering and rating progress with invoice preview and dedup still open, Maya reported 2 Sev-1s and 7 P1s plus a stalled migration dry run, and the Payments Platform ledger idempotency dependency (Sunil Varghese, target September 29) was flagged as the key external blocker. Viktor was assigned the migration runbook by Monday the 28th, CSV-only was agreed for the launch export, and the empty-state decision was deferred to Ines's customer sessions on the 24th, while the October 6th vs 20th launch date stayed unresolved after a full cost/risk debate. The team set a new billing v2 launch date of Wednesday October 14 with an October 2 Payments-ledger tripwire, reassigned the migration runbook to Maya, and heard Joel's Kestrel Logistics $18,240 overbilling case, agreeing on a credit, a customer-readable root cause, and an opt-out from the automatic rollout. The team reversed the earlier 10% plan and agreed to a staged billing-v2 rollout starting at 5% (39 accounts) with a 48-hour shadow-rating reconciliation, set a rollback drill for Oct 8 and a go/no-go for Oct 12, added a billing change freeze Oct 12–16, and confirmed the legal review of the usage-terms addendum is still open and launch-blocking. Wrap-up chunk where the team moved the next checkpoint to 10:30 on September 24th, listed the deliverables Ines, Viktor, and Maya owe, and left replay tooling coverage, Kestrel Logistics renewal, and the dedup no-key fallback as still open, while flagging that the October 2nd tripwire lands on the office move day. Key decisions: Rounding is settled with finance: round at the invoice line item, half-even, not per event; The usage chart will use the account's billing time zone rather than the viewer's browser, so the chart and invoice don't disagree at the month boundary; The invoice preview launch-scope question (hiding preview for the ~60 large accounts or dropping preview from GA) was parked to the launch-date discussion. Progress since last sync: Viktor reported the metering pipeline as in good shape and the rating engine as mostly good, with invoice preview described as the problem child of the backend workstream.

#### Summary
- Viktor reported the metering pipeline as in good shape and the rating engine as mostly good, with invoice preview described as the problem child of the backend workstream.
- Weekly launch-readiness check for usage-based billing v2, 19 days from the October 6 date: Viktor reported metering and rating progress with invoice preview and dedup still open, Maya reported 2 Sev-1s and 7 P1s plus a stalled migration dry
- Rounding is settled with finance: round at the invoice line item, half-even, not per event
- The usage chart will use the account's billing time zone rather than the viewer's browser, so the chart and invoice don't disagree at the month boundary
- Without Payments Platform v3.4 idempotency on the ledger write API, a retry from the posting worker can double-post an invoice line item even after client-side dedup is fixed

#### Progress since last sync
- Viktor reported the metering pipeline as in good shape and the rating engine as mostly good, with invoice preview described as the problem child of the backend workstream.
- The metering load test ran Tuesday against the staging cluster at a sustained 42,000 events per second for two hours, against a committed design-doc target of 30,000 events per second.
- Consumer lag never exceeded about 9 seconds during the load test, running on 48 partitions after bumping up from 24 last sprint.
- The partition increase has negligible cost impact — roughly a couple hundred dollars a month because the brokers were already over-provisioned.
- Rating engine unit test coverage is at 81%, while the metering service is at 67% largely because the replay tooling has almost no tests.
- The rounding question was closed with finance: half-even rounding at the invoice line item rather than per event, signed off by Priyanka on Monday, which means customers pay a few cents less than under v1.
- Invoice preview p95 latency is 1.4 seconds for large accounts against an 800 ms target; 'large' means over about 2 million metered events in the billing period, around 60 accounts today.
- The dedup fix PR is roughly 70% done and switches from a 5-minute dedup window to client-supplied idempotency keys kept for 24 hours.
- Node and Python SDKs already send idempotency keys as of the release two weeks ago, the Go SDK gets it next week, and the Java SDK has not been started.
- Maya reported 2 Sev-1s, 7 P1s (corrected down from 9 because two closed this morning and she was reading yesterday's export), 23 P2s and 41 P3s.
- Four of the P1s are customer-visible, mostly CSV export formatting plus one where the usage chart shows UTC dates for customers in other time zones.
- The regression suite is at 1,312 tests with about 140 added this sprint and a 96.4% pass rate on last night's run, with failures mostly proration cases plus three flaky currency-rounding tests.
- The migration dry run has completed on 3 of 12 shards, averaging 38 minutes per shard with zero mismatches on the reconciliation check.
- staging-eu was down for two days last week because the event store disk filled up, so the EU currency suites did not run Wednesday or Thursday.
- The usage dashboard is done in Figma and about 90% built, with the export button and drill-down by meter still outstanding on the front-end team's side.
- The drill-down is the interaction where clicking a metric such as API calls breaks it down by endpoint or by sub-account.
- The accessibility audit ran last week and found 2 issues, both color contrast on the chart legend, and both are already fixed.
- The accessibility audit covered only the dashboard, not the invoice PDF, which is generated by the billing service.
- The migration dry run is entirely manual with no runbook — knowledge sits in Viktor's head, a Slack thread, and a Google doc whose step 4 says "do the thing from Tuesday".
- Replay tooling currently has only 12 tests, described as good tests, despite being the recovery path for re-rating a wrongly rated batch in production.
- In the beta, 3 of the 14 customers screenshotted the dashboard and sent it to their finance team, which Ines used as evidence against sample data.
- Sales estimates about 25 new contracts in October, maybe 30, and finance ops puts a manual adjustment at roughly 4 hours per contract per month, i.e. about 100 hours of spreadsheet work monthly.
- Launching before the pre-aggregation work leaves preview latency at 1.4 seconds p95 on the big accounts, the same as today.
- Move logistics: facilities' crates arrive Monday, the team packs its own desks, crates must be sealed by October 1st and the move itself is the 2nd.
- Harlow parking requires a permit and the waitlist is around 40 people; Ines is number 31 and expects a spot sometime in 2028.
- The espresso machine exists but is on the 6th floor while the team sits on the 4th.
- The perf test threshold was raised to 1.2 seconds and accepted as long as it is documented somewhere.
- The full hourly pre-aggregation was moved to the backlog with no commitment on timing and is explicitly not a launch requirement.
- October 6th was ruled out as unrealistic because of two open Sev-1s and an unshipped dependency.
- October 20th was judged unnecessary if the dependency lands on time, leading to October 14th as the new date.
- Production is at 0% on the new flag except the internal Tallyport account, which has been dogfooding at 100% for three weeks, plus the 14 beta accounts.
- The 14 beta accounts plus internal account represent about 1.8% of the 780 eligible accounts.
- The draft rollout sequence was October 14th at 10%, then 25%, 50%, and 100% by the end of October.
- Kestrel Logistics was overbilled on their first v2 usage invoice for the August period, caught by their own controller.
- Viktor has the idempotency-key fix in progress with a September 25th merge target, fixing retries at any delay up to 24 hours.
- Maya proposed instead starting at 5%, holding for 48 hours, and reconciling every account in that cohort against v1 shadow rating before widening.
- Viktor confirmed v1 keeps rating in shadow mode for 30 days after an account moves over, so totals can be diffed per account, and estimated the reconciliation script at about half a day.
- Rohan reported the sales deck is updated and the pricing page copy is with marketing, to go live on launch day.
- Rohan corrected the record: last week's sign-off was the privacy review (DPIA for storing raw usage events), not the legal review, and it is approved.
- The legal review of the order form addendum is still open with Joelle Park and in her queue.
- The addendum is for the new usage terms: how overage billing works, how disputes on metered usage work, and the 30-day window to contest a usage charge.
- Joelle's team has a ten business day SLA and the review went in on the 16th, so September 30th is the latest.
- The 5% first stage equals 39 accounts, which Rohan flagged as a small launch before the plan was confirmed.
- All 14 beta customers were told October 6th via the August beta newsletter.
- Viktor volunteered to take the first 24 hours of launch-week on-call, saying he'd rather be on call for his own bugs.
- Maya flagged that the invoice PDF line items are now grouped by meter instead of by date, which she expects to generate customer tickets.
- Speaker 3 committed to bringing a list of everything the 12 tests do not cover, describing it as a long list.
- Speaker 3 is still gathering how much beta traffic arrives without an idempotency key before settling the dedup no-key fallback approach.
- Me confirmed there is still no answer on replay tooling coverage and that it will be handled with Viktor on Monday.
- The next checkpoint will have Ines bringing usability results, Viktor bringing dedup fix status, and Maya bringing the runbook draft.
- Speaker 1 restated that for the record they are still team A.

#### Decisions
- Rounding was decided as half-even at the invoice line item, not per event, with Priyanka from finance signing off on Monday.
- The usage chart will follow the account's billing time zone rather than the viewer's browser, so the chart and invoice agree at the month boundary.
- The invoice preview scope question was explicitly parked into the launch-date discussion rather than settled during the backend status update.
- Viktor will not decide the no-key dedup fallback yet; he wants beta traffic data on how many requests arrive without a key first.
- The dedup fix was committed to be merged by next Friday the 25th, with Dana explicitly requiring merged rather than 'works on my machine'.
- Status updates were agreed to come before the launch-date debate because status informs the date.
- Viktor was given ownership of the migration runbook with a Monday the 28th deadline, so the remaining shards can be done before any go/no-go.
- Export ships as CSV only at launch; Excel goes on the later list and will be revisited if more customers ask.
- The empty state was deliberately left open rather than decided, with Ines putting both variants in front of real customers and results reviewed on the 24th.
- The launch performance bar was agreed at 1.2 seconds p95 on the big accounts, replacing the 800ms figure that Rohan suspected came from the invoice list spec.
- Full hourly pre-aggregation was moved to the backlog with no committed date and is explicitly not a launch requirement.
- The replay tooling testing gap was noted as a risk without being solved in this meeting.
- The team agreed to pack its own desks rather than use movers, with crates sealed by October 1st ahead of the October 2nd move.
- Rohan's joke about taking stakeholders instead of stairs was earmarked for the retro doc.
- The new launch date is Wednesday, October 14th, chosen specifically not to coincide with the day Maya finishes testing.
- An October 2nd tripwire was agreed: if Payments Platform hasn't shipped ledger 3.4 to production by that Friday, the launch moves automatically to October 20th with no second meeting.
- The full hourly pre-aggregation is accepted as backlog rather than a launch requirement.
- The perf test threshold is set to 1.2 seconds.
- The team definitively rejected an early access launch on the 7th for beta customers.
- Contracts between October 1st and 14th stay on v1 with manual adjustments and are migrated during the rollout like everyone else.
- Cohort membership for those October contracts is explicitly deferred, with Maya to evaluate it in the plan.
- The rollout keeps the usual staged approach with a 10% first stage on the 14th.
- The migration runbook ownership moves to Maya with the 28th deadline unchanged, and Viktor does a paired brain dump.
- "Sev-1s closed" was defined as verified in staging with a failing-first regression test, and merged does not count; this will be written into the go/no-go checklist.
- Kestrel Logistics is excluded from the automatic flag cohorts and will be migrated on a date they choose once the fix is verified on their data.
- The decision on adding a goodwill free month for Kestrel Logistics was explicitly not made in this meeting.
- The team reversed the earlier 10% start and set the first stage at 5% of eligible accounts for 48 hours with v1 shadow-rating reconciliation before expanding.
- Expansion to 25% is planned for Monday October 19th, 50% on the 21st, and 100% on Monday October 26th, explicitly avoiding a Friday expansion.
- The first 5% excludes accounts over 2 million events, with the big accounts entering at the 25% stage.
- The pause trigger is a >0.5% divergence between v2 and shadow v1 totals (excluding known rounding differences); the rollout is paused for review rather than auto-rolled back.
- A rollback drill is scheduled for October 8th in staging across all 12 shards, owned by Maya.
- The go/no-go meeting is set for Monday October 12th with the same group plus Joel.
- A billing change freeze runs October 12th–16th; only v2 fixes may ship to billing that week.
- Launch-week on-call pairs a backend engineer with billing support across the 48-hour window as a separate arrangement from the normal rotation.
- The legal review (not the privacy review) sign-off is added explicitly to the go/no-go checklist.
- The preview stays in the pricing page copy at 1.2 seconds and is not being dropped.
- The next checkpoint was confirmed and then moved to 10:30 on Thursday, September 24th rather than the originally proposed 10:00.
- The replay tooling coverage question was formally left open and pushed to a Monday discussion between Me and Viktor.

#### Blockers
- The dedup work is blocked end-to-end until Payments Platform ships idempotency on the ledger write API in their v3.4, otherwise posting-worker retries can double-post invoice line items.
- The v3.3 release only covered payments, not invoice line items, which is a separate endpoint and the one this team actually uses.
- Sunil Varghese said Payments Platform is targeting September 29th, which the team treats as likely slipping into October.
- Invoice preview cannot meet its 800 ms target as built because it aggregates on read by walking every event; pre-aggregating hourly is about a week and a half of work.
- The migration of the remaining nine shards is blocked by the absence of a runbook — the dry run lives in Viktor's head, a Slack thread and a Google doc with vague steps.
- staging-eu is only cleaned up, not fixed: the retention job still isn't running and the disk is expected to fill again in about three weeks, right around launch.
- The Java SDK has no idempotency key support started, leaving raw-HTTP customers without keys until a fallback is agreed.
- The proration Sev-1 has a one-line fix but the surrounding test work is described as the annoying part, keeping it open.
- The other nine shards cannot be touched until the migration runbook exists, and that runbook is currently only in Viktor's head and a Slack thread.
- Replay tooling, the incident-time recovery path, has only 12 tests, which QA flagged as their biggest worry.
- Two Sev-1s are open, one of which involves customers being overbilled.
- Nine shards of migration have not been dry run.
- The team depends on Payments Platform shipping on the 29th, which leaves only one week of buffer before October 6th — and only if they are on time.
- An October 6th launch leaves five working days for ledger integration testing while Maya needs ten, so the rollback drill or the migration dry runs would be cut — probably both.
- October 13th is QA-ready only in the best case and leaves zero slack, so any slip means launching untested.
- Ines does not want to ship the sample-data empty state because she already expects it to generate support tickets.
- The empty state stays unresolved at least until Ines's usability sessions finish and results are shared on the 24th.
- Two Sev-1s remain open and are part of why October 6th was rejected.
- The Payments Platform ledger 3.4 dependency has not shipped, which is the trigger for the October 2nd tripwire.
- Viktor is blocked from writing the runbook by the 28th because he is handling the dedup fix, proration fix, latency caching, and the ledger integration with Sunil.
- Kestrel Logistics has put their invoice on hold and their VP of finance won't commit the full account to usage billing until the meter is trusted, with renewal on November 1st.
- The overbilling is material, at $18,240 out of a roughly $61,000 August usage invoice, almost a third of the bill.
- Maya flagged that a 10% first stage risks sending bad invoices to 78 customers if another retry-style metering bug appears.
- The team would not see invoice problems on day one because invoices only generate at the first bill run after accounts are flipped.
- The goodwill free month idea is financially risky, since a month on a $410,000 account exceeds thirty thousand dollars and finance would push back.
- The legal review of the usage-terms addendum is launch-blocking because any contract signed on usage tiers needs it attached.
- The Salesforce sync may cast fractional usage quantities (e.g., 12.5 units) to integers, which could break sales reporting and commissions.
- The docs team has only two people and both are on the v2 API reference, blocking resourcing for the help center invoice updates.
- The Salesforce sync appears to have been orphaned in the re-org, leaving no clear owner to fix the fractional-quantity issue.
- Big-account rollout carries preview-latency risk, which is why the 60 big accounts were kept out of the initial 5% cohort.
- The invoice PDF format change (line items grouped by meter) is expected to drive customer support tickets.
- The October 2nd tripwire collides with the office move, so nobody will be at a desk that day.
- There is no answer on replay tooling coverage, leaving it blocked until the Monday conversation.
- The dedup no-key fallback cannot be decided until beta traffic without an idempotency key is quantified.

#### Dependencies
- Payments Platform must ship idempotency support on the ledger write API (their v3.4); Sunil Varghese is the contact and has been responsive.
- SDK coverage is a sequencing dependency for dedup: Node and Python already send keys, Go lands next week, Java not started.
- The time zone chart fix is owned by the front end team and feeds directly into Maya's P1 count for release.
- Infra owns both the disk alert and the still-unrunning retention job on staging-eu, tracked via Maya's ticket.
- Finance sign-off (Priyanka) was a dependency for the rounding approach and is now resolved.
- Customer success input via Joel is expected on the dedup double-count escalation and will shape how that issue is handled.
- The remaining nine migration shards are sequenced behind the runbook: Dana ruled that nobody touches them before the runbook exists.
- Ledger integration testing depends on Payments Platform shipping its release on the 29th.
- Viktor wants two full weeks after Sunil's release specifically to test the ledger integration end to end.
- The Q4 pricing change means new contracts from October 1st are written with usage tiers, so if v2 isn't live those customers get invoiced on v1 with manual adjustments.
- Marketing built the launch webinar around October 6th, and the webinar itself is October 7th, making it the only fixed date in the schedule.
- Sales has been telling prospects that usage billing is live in early October, some of it in writing in proposals.
- The sample-data empty state option carries a maintenance cost because the sample data has to be kept in sync with every chart change.
- The remaining dashboard work — the export button and drill-down — sits with the front end team.
- Roughly 25-30 October contracts hinge on v2 being live, otherwise each month of delay costs about 100 hours of manual adjustment work.
- The monitor question for the office move is dependent on facilities answering whether equipment moves or is replaced in Harlow.
- The launch is explicitly gated on Payments Platform shipping ledger 3.4 to production by Friday, October 2nd.
- The launch was pushed off the 13th specifically to avoid landing on the same day Maya finishes testing.
- Kestrel Logistics' migration date depends on the metering fix being verified on their data first.
- Viktor is working with Sunil on the ledger integration, which competes for the same time as the runbook.
- The runbook handoff depends on Viktor delivering a brain dump session to Maya.
- The customer root cause depends on Viktor's technical draft before Dana can produce the customer version.
- Maya noted the account can be excluded from flag cohorts and turned on manually, which is easy on their side.
- The rollout depends on Payments Platform shipping ledger 3.4 by the 29th, with an October 2nd tripwire and escalation to Sunil and Grace Obi.
- The 5% rollout stage depends on the v1 shadow-rating reconciliation being clean before any wider expansion.
- The tax team's Canadian GST change depends on being moved from the 13th to the 19th because of the billing change freeze.
- Any contract signed on usage tiers depends on the order form addendum legal review from Joelle Park's team.
- Kestrel Logistics is a cross-handoff to Joel (customer success), who runs their call on the 23rd, and Kestrel is excluded from rollout cohorts.
- Viktor is doing the technical integration with Sunil while Me owns the schedule chase for ledger 3.4, to keep Viktor writing code rather than sending status emails.
- Passing the October 2nd tripwire depends on whether Sunil's release is in production that day.
- The dedup no-key fallback decision is sequenced behind the beta traffic measurement.
- Resolution of replay tooling coverage depends on the Monday conversation between Me and Viktor.

#### Follow-up needed
- A specific owner still needs to be named for chasing Payments Platform's ledger idempotency date, deferred to the end of the meeting.
- The migration runbook needs to be written before shards 4 through 12 can be dry-run or cut over.
- The beta traffic needs to be analysed for requests arriving without idempotency keys so the fallback behavior can be decided.
- The invoice preview scope decision (hide for ~60 large accounts vs drop from GA) still needs to be resolved in the date conversation.
- Maya's corrected P1 number (7, not 9) came from a stale export, so a fresh bug count should be used for the release picture.
- The staging-eu retention job fix needs to be confirmed, not just the new 80% disk alert, since the refill is forecast around launch.
- The shared-fixture hypothesis for the three JPY currency-rounding flaky tests still needs to be proven or disproven (with a lunch on the line).
- The launch date itself was never decided — October 6th, October 13th and October 20th were all argued and the discussion ended on the performance bar instead.
- Ines's usability session results on the 24th need to be circulated so the empty state can actually be chosen.
- Somebody needs to get an answer out of facilities about the monitors before the October 2nd move.
- The invoice PDF accessibility audit ownership was explicitly parked as a separate conversation.
- Whether the 800ms preview target was ever correct — Rohan suspects he copied it from the invoice list page spec — was raised but not resolved.
- The full hourly pre-aggregation backlog item still needs a date at some point, since the team only committed that it is not a launch requirement.
- The replay tooling test gap is on record as a risk and still needs an owner or a plan.
- The webinar question (move to the 15th or stay on the 7th as a preview) needs Carla's input and a decision from Rohan by tomorrow.
- A customer-readable root cause for Kestrel Logistics needs to be written by Viktor and converted by Dana, then delivered to Joel by the 22nd for the 23rd call.
- The $18,240 credit against the open invoice needs to be drafted and approved through finance by Monday the 21st.
- The goodwill free month question should be raised with Joel's director outside this meeting if he decides it's needed.
- Dana's question about whether Viktor can reconcile the rollout cohort against shadow rating still needs an answer before the rollout plan is finalized.
- The 10% versus 5% first-stage rollout size, and Maya's 48-hour reconciliation proposal, still need to be resolved.
- Kestrel Health is cleared to be in next week's usability sessions, but Kestrel Logistics must not be included right now.
- Viktor must deliver the idempotency-key fix merged by September 25th to support the customer commitment.
- Rohan must follow up with Joelle Park by September 30th and report on October 1st if it is not done, rather than waiting until October 13th.
- The help center invoice article update needs a named owner by next week, and Me explicitly deferred assignment out of this meeting.
- Someone still needs to check whether the Salesforce sync handles fractional quantities; ownership is still an open question.
- Viktor and Me will discuss the replay tooling coverage on Monday, and Viktor will bring a list of what the 12 tests do not cover.
- Viktor needs to see how much beta traffic arrives without an idempotency key before choosing the no-key fallback approach for the dedup.
- The beta customers need to hear about the 14th from the team before a sales rep tells them, via Rohan's email by the 22nd (Kestrel handled by Joel).
- Maya is sending the change freeze note to the tax team and will tell them today.
- The team still needs to decide whether Kestrel Logistics gets anything beyond the credit, and this is not owned by anyone in the meeting.
- Replay tooling coverage needs a follow-up answer after the Monday Viktor and Me discussion.
- Speaker 3 asked someone to save them a spot near the espresso machine on the 6th floor.

#### Action items (structured)
- Viktor: Get the dedup fix (client-supplied idempotency keys kept for 24 hours) merged — currently a PR about 70% done (deadline: next Friday, the 25th)
- Viktor: Review beta traffic to determine how many usage requests arrive without an idempotency key before choosing the no-key fallback
- Viktor: Own writing a real migration runbook before anyone touches the remaining nine shards [inferred]
- Maya: Keep chasing the open infra ticket so the staging-eu event-store retention job actually runs, not just the 80% disk alert
- Me: Come back at the end of the meeting and assign a clear owner for chasing the Payments Platform ledger idempotency date
- Viktor: Viktor would need roughly a week and a half to pre-aggregate the invoice preview hourly if that option is chosen [inferred]
- Launch date on the roadmap: October 6th, nineteen days out [inferred]
- Dedup fix to be merged by next Friday, the 25th [inferred]
- Payments Platform targeting September 29th for ledger write API idempotency (v3.4) [inferred]
- Go SDK to send idempotency keys next week [inferred]
- Viktor: Write the migration runbook so the dry run is repeatable before the remaining shards are touched. (deadline: Monday the 28th)
- Ines: Show both empty-state variants (A and B) to 5 customers in usability sessions and report back. (deadline: Thursday the 24th)
- Maya: Update the performance test threshold to 1.2 seconds.
- Viktor: Do the smaller caching fix for per-meter subtotals to bring preview latency down to roughly 1.1-1.2 seconds. (deadline: two or three days)
- Ines: Mock up the middle empty-state option combining the checklist with a small preview thumbnail of a populated dashboard. [inferred]
- Someone needs to ask facilities whether the monitors move with the team or whether new ones are provided in the Harlow building. [inferred]
- Migration runbook due the 28th [inferred]
- Usability session results shared [inferred]
- Office move crates must be sealed [inferred]
- Office move date [inferred]
- Marketing launch webinar [inferred]
- Payments Platform ledger change ships [inferred]
- QA-ready date if ledger lands on the 29th [inferred]
- Speaker 1: Talk to Carla about whether the webinar moves to the 15th or stays on the 7th as a preview, and report back. (deadline: tomorrow)
- Speaker 1: Give finance ops a heads-up on the roughly dozen October contracts so they can plan the hours.
- Maya: Look at cohort membership for the new October accounts when writing the migration plan.
- Maya: Build the rollout plan around the 10% day-one stage.
- Maya: Take over the migration runbook, still due the 28th. (deadline: the 28th)
- Viktor: Do the runbook brain dump session with Maya tomorrow at 2, bringing the Google doc, the Slack thread, and whatever Tuesday was. (deadline: tomorrow at 2)
- Viktor: Draft the technical explanation of the Kestrel metering issue for Dana to turn into the customer version.
- Dana: Deliver the customer-readable root cause write-up to Joel by Tuesday the 22nd, ideally in the morning, and join the customer call on the 23rd. (deadline: Tuesday the 22nd)
- Joel: Draft the credit memo for the $18,240 and get it through finance, targeting approval by Monday the 21st. (deadline: Monday the 21st)
- Joel: Raise the idea of a goodwill free month on Kestrel Logistics with his director if he thinks it's needed.
- Viktor: Confirm whether reconciliation against v1 shadow rating is actually feasible for the rollout cohort.
- Webinar scheduling decision reported back by tomorrow [inferred]
- Payments ledger 3.4 to production by Friday, October 2nd (tripwire) [inferred]
- Launch date Wednesday, October 14th (fallback October 20th) [inferred]
- Credit memo approval targeted for Monday the 21st [inferred]
- Customer root-cause write-up delivered by Tuesday the 22nd [inferred]
- Customer call on Wednesday the 23rd [inferred]

#### Decisions (structured)
- Rounding is settled with finance: round at the invoice line item, half-even, not per event (owner: Priyanka (finance sign-off) / Viktor)
- The usage chart will use the account's billing time zone rather than the viewer's browser, so the chart and invoice don't disagree at the month boundary (owner: Ines / front end team)
- The invoice preview launch-scope question (hiding preview for the ~60 large accounts or dropping preview from GA) was parked to the launch-date discussion (owner: Me)
- The no-key dedup fallback will not be decided today; Viktor will review beta traffic first to see how many requests arrive without an idempotency key (owner: Viktor)
- The dedup fix is committed to be merged (not just working locally) by next Friday, the 25th (owner: Viktor)
- Agenda order agreed: workstream status comes before the launch-date discussion, since status informs the date (owner: Me)
- Viktor owns writing the migration runbook, due Monday the 28th, before anyone touches the other nine shards. (owner: Viktor)
- Dashboard export will be CSV only at launch, with Excel added to the later list. (owner: Ines)
- The empty state will not be decided in the meeting; Ines will show variants A and B to real customers and results will be reviewed on the 24th. (owner: Ines)
- Launch performance bar for the preview is set at 1.2 seconds p95 on the big accounts.
- The full hourly pre-aggregation is moved to the backlog and is explicitly not a launch requirement.
- Replay tooling's thin test coverage was recorded as a risk to be handled later rather than solved in the meeting.
- QA's minimum bar for launch was agreed: both Sev-1s closed, full regression green except known flakes, all 12 shards dry run, and one rollback drill. (owner: Maya)
- For the office move the team packs its own desks, and crates must be sealed by October 1st because the move is the 2nd. (owner: Speaker 4)
- Rohan's line about taking stakeholders instead of stairs will be added to the retro doc.
- New billing v2 launch date is Wednesday, October 14th, deliberately not the 13th so it doesn't land on the day Maya finishes testing. (owner: Dana)
- If Payments Platform has not shipped ledger 3.4 to production by Friday, October 2nd, the launch automatically moves to October 20th with no second meeting. (owner: Dana)
- The perf test threshold is updated to 1.2 seconds. (owner: Speaker 4)
- The team will not do an early access launch on the 7th; Dana rejected it as the same risk with a different name. (owner: Dana)
- Contracts falling between October 1st and 14th go on v1 with manual adjustments and get migrated during the rollout like everyone else. (owner: Speaker 1)
- Cohort membership for the new October contracts is deliberately left undecided, with Maya to assess it when she writes the migration plan. (owner: Maya)
- The rollout starts with a first stage of 10% of eligible accounts on the 14th, though Maya later pushed back on that percentage. (owner: Dana)
- The migration runbook moves from Viktor to Maya, still due the 28th, with Viktor doing a brain dump session. (owner: Maya)
- "Sev-1s closed" for launch criteria means verified in staging with a regression test that fails on the old code — merged does not count — and this goes into the go/no-go checklist. (owner: Dana)
- Kestrel Logistics is excluded from the automatic rollout and will be migrated on a date they choose, after the fix is verified on their data. (owner: Dana)
- Reversed the earlier decision: the rollout will not start at 10%; the first stage is 5% of eligible accounts for the first 48 hours with a reconciliation against v1 shadow rating before expanding.
- If reconciliation is clean, expansion is 25% on Monday October 19th, then 50% on the 21st, and 100% on Monday October 26th.
- The first 5% cohort excludes accounts over 2 million events; the big accounts only come in at the 25% stage.
- Pause trigger agreed: any account where the v2 total differs from the shadow v1 total by more than 0.5%, excluding known rounding differences, pauses the rollout, with no automatic rollback.
- A rollback drill will run Thursday October 8th in staging with the full migration on all 12 shards, owned by Maya.
- The go/no-go meeting is set for Monday October 12th with the same group plus Joel.
- A change freeze on billing services runs October 12th through the 16th; nothing else ships to billing that week unless it is a v2 fix.
- The tax team's Canadian GST change queued for the 13th moves to the 19th, or they convince Maya it can't wait.
- Launch-week on-call will pair a backend engineer with a billing support person for the 48-hour window, not just the normal rotation.
- Legal sign-off — explicitly the legal review, not the privacy one — will be added to the go/no-go checklist.
- The preview feature is staying in the pricing page copy at 1.2 seconds; it is not being dropped.
- Beta customers must hear about the 14th from the team before hearing it from a sales rep; Rohan emails the beta group by Tuesday the 22nd, with Kestrel Logistics handled by Joel.
- Next team checkpoint moved from 10:00 to 10:30 on Thursday, September 24th after Speaker 2 asked for the later slot.
- Replay tooling coverage was acknowledged as still open and deferred to a Monday conversation between Me and Viktor rather than settled in this meeting.

#### Open questions (structured)
- Should the invoice preview be hidden for the ~60 large accounts at launch, or dropped from GA entirely? [open]
- What is the fallback for dedup when a request arrives with no idempotency key, given that server-side payload hashing breaks for legitimately identical events? [open]
- Is Payments Platform's September 29 date a target or a commitment for the ledger write API idempotency work? [open]
- Will staging-eu's event store fill up again about three weeks from now, i.e. right around launch, if the retention job is never fixed? [open]
- Which empty-state approach ships: sample data with a banner or a setup checklist? [open]
- What is the actual launch date — October 6th as on the roadmap, October 20th as Viktor argues, or October 13th as raised by Rohan? [open]
- Did the accessibility audit cover the invoice PDF, and who would own an audit of it? [open]
- Are the monitors moving with the team or are new ones being provided in the Harlow building? [open]
- Is 800 milliseconds even the right preview latency target, given Rohan suspects it was copied from the invoice list page spec? [open]
- Whether the November webinar stays on the 7th as a preview or moves to the 15th, pending Carla's input. [open]
- Whether to add a goodwill free month for Kestrel Logistics on top of the credit, which Joel says may depend on how the customer call goes. [open]
- Whether the team can actually reconcile the rollout cohort against v1 shadow rating, which Dana asked Viktor directly as the chunk ended. [open]
- Whether the 10% first-stage rollout size holds or drops to Maya's proposed 5% start, left unresolved at the end of the chunk. [open]
- Whether Payments Platform actually ships ledger 3.4 by the 29th, with the October 2nd tripwire in mind. [open]
- Which empty state wins, A or B. [open]
- Whether the webinar moves off the 7th. [open]
- Who owns the help center invoice article update. [open]
- Who owns the Salesforce sync question. [open]
- Whether Kestrel Logistics renews. [open]
- Whether the team gives Kestrel Logistics anything beyond the credit. [open]
- What happens with the replay tooling coverage. [open]
- Whether the Salesforce sync handles fractional quantities, since usage can now be 12.5 units. [open]
- What the no-key fallback for the dedup should be, pending how much beta traffic comes in without an idempotency key. [open]
- Whether Kestrel Logistics will renew. [open]
- Which approach to pick for the dedup no-key fallback. [open]

#### Risks (structured)
- [high] Without Payments Platform v3.4 idempotency on the ledger write API, a retry from the posting worker can double-post an invoice line item even after client-side dedup is fixed
- [high] Payments Platform is only 'targeting' September 29 for that API, which the team reads as likely slipping into October
- [high] Invoice preview p95 latency is 1.4 seconds for large accounts against an 800 ms target, and fixing it via hourly pre-aggregation is about a week and a half of work
- [high] The migration dry run has no runbook and exists only in a Slack thread and a vague Google doc, so the other nine shards can't be safely run yet
- [high] staging-eu was down two days last week from a full event-store disk; only cleaned up, not fixed, and it is expected to refill in about three weeks, around launch
- [medium] The Java SDK does not send idempotency keys at all, and many customers call the raw HTTP API with no SDK, so client-side dedup won't cover everyone
- [high] Two open Sev-1s remain: the dedup double count and proration rating usage before a mid-cycle plan switch at the new plan's price
- [low] Three flaky currency-rounding tests fail only on JPY right after the EUR suite, suspected to be a shared fixture; unresolved until proven
- [high] Replay tooling — the recovery path for re-rating a mis-rated batch in production — has only 12 tests.
- [high] Two Sev-1s are open, and one of them is literally customers getting overbilled.
- [high] Nine shards of migration have not been dry run and the dry run is currently manual with no runbook.
- [high] Launching on the 6th with Payments on time leaves five working days for ledger integration testing versus the ten Maya needs, forcing cuts to the rollback drill or the migration dry runs — probably both.
- [high] A QA-ready date of October 13th gives zero days of slack, so anything going sideways means launching untested.
- [medium] Ines objects to shipping the sample-data empty state because she already suspects it will generate support tickets.
- [medium] Sample data carries a real risk of being mistaken for real numbers — 3 of 14 beta customers screenshotted the dashboard and sent it to their finance team.
- [medium] Delaying means approximately 100 hours of manual spreadsheet adjustment per month across roughly 25-30 October contracts.
- [medium] Market pressure: Meterbase launched its usage analytics product in August and was mentioned in two deals Sales lost last quarter.
- [medium] An October 20th date means the marketing webinar would announce something that isn't live yet, in front of 400 registered people.
- [low] The invoice PDF template is technically owned by the team but nobody has touched it in two years, and its accessibility audit ownership is unclear.
- [high] Two open Sev-1s remain unresolved heading into launch.
- [high] The Payments Platform ledger 3.4 dependency has not shipped to production, which would force the launch to October 20th.
- [high] Viktor is overloaded across the dedup fix, proration fix, latency caching, and ledger integration, so he cannot also write the runbook by the 28th.
- [high] Kestrel Logistics' November 1st renewal is at risk; their VP of finance says they cannot move their full account to usage billing until they trust the meter.
- [high] Maya warns that a 10% first stage sends bad invoices to 78 customers if another metering bug like the retry one occurs.
- [medium] Invoice problems would not surface on day one because the invoice only generates at the first bill run after accounts are flipped.
- [medium] The goodwill free month idea carries financial risk, as a month on a $410,000 account is over thirty thousand dollars and finance would push back.
- [high] The legal review of the order form addendum is still open with Joelle Park and is launch-blocking, since any contract signed on usage tiers needs it attached.
- [high] The Salesforce sync may cast fractional usage quantities to integers, which could break sales reporting since commissions run off that sync.
- [medium] The docs team is only two people and both are on the v2 API reference, so the help center invoice updates may not get resources.
- [medium] Preview latency risk is concentrated in the 60 big accounts, which is why the team debated whether to include them in the first 5% cohort.
- [medium] The invoice PDF format change groups line items by meter instead of by date, and customers are expected to open tickets over it.
- [medium] The Salesforce sync ownership appears orphaned after the re-org, leaving no clear owner.
- [medium] The October 2nd tripwire falls on the same day as the office move, so nobody will be at a desk that day.
- [medium] Replay tooling coverage was never defined and remains unanswered after the meeting.
- [medium] The dedup no-key fallback approach is still undecided until beta traffic without an idempotency key is measured.

#### Follow-up draft
Hi team,

Recap from the billing v2 launch-readiness sync.

Decisions:

New launch date is Wednesday, October 14. If Payments Platform hasn't shipped ledger 3.4 to production by Friday, October 2, we move to October 20 automatically — no second meeting.

Rollout starts at 5% of eligible accounts (39) held for 48 hours with a v1 shadow-rating reconciliation before widening. That reverses the earlier 10% plan. Big accounts (2M+ events) stay out until the 25% stage. Expansion after that: 25% Monday October 19, 50% October 21, 100% Monday October 26.

Rollback drill October 8 in staging across all 12 shards, owned by Maya. Go/no-go October 12 with Joel added. Billing change freeze October 12–16.

"Sev-1 closed" means verified in staging with a failing-first regression test — merged doesn't count. It's going into the go/no-go checklist.

Rounding settled with finance: half-even at the invoice line item, not per event.

Usage chart follows the account's billing time zone, not the viewer's browser, so it agrees with the invoice at the month boundary.

Export ships CSV-only at launch; Excel is a later item.

Preview bar is 1.2s p95 on big accounts, and preview stays in the pricing page copy.

Migration runbook moves to Maya, still due Monday the 28th, with a brain dump from Viktor.

Kestrel Logistics: credit on the $18,240 overbilling, a customer-readable root cause, and exclusion from the automatic rollout cohorts.

Next checkpoint: 10:30 Thursday, September 24.

Blockers:

Payments Platform ledger 3.4 idempotency (Sunil, targeting September 29). Until it ships, posting-worker retries can double-post invoice line items even with client-side dedup fixed. This is the October 2 tripwire.

Two Sev-1s still open: dedup double count and proration.

Nine of twelve shards not dry run — nobody touches them until the runbook exists.

staging-eu was cleaned up, not fixed; the retention job still isn't running and the disk is expected to refill in about three weeks, around launch.

Java SDK has no idempotency key support started.

Replay tooling has only 12 tests.

Legal review of the usage-terms addendum is still open with Joelle Park and launch-blocking.

Salesforce sync may cast fractional usage quantities to integers, and ownership looks orphaned after the re-org.

Thanks,
