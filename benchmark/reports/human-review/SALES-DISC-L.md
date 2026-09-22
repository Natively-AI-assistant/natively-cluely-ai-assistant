# SALES-DISC-L — sales, long (60.5 min, 8411 words)

**Source transcript:** `benchmark/transcripts/src/SALES-DISC-L.txt`  
**Reference fact sheet:** `benchmark/references/SALES-DISC-L.json`  
**Context:** A B2B discovery call in which Routewell, a vendor of an AI-assisted customer-support ticket triage and routing platform, meets Harbourline Logistics, a mid-size e-commerce fulfillment and last-mile logistics company. The Routewell account executive (the user) and sales engineer explore Harbourline's current Zendesk/Salesforce/in-house routing setup, requirements, budget and approval process, with the customer's VP of Customer Operations, IT/security lead and, later, a finance manager.

## What a good summary must include
- Budget of $50,000 for year one (F01)
- Seat count is 140 (corrected from 120) and pricing $39/agent/month = $65,520/yr + $9,500 implementation (F02, F17)
- Purchases over $40,000 need CFO approval; CFO Greg Hale is the economic buyer (F03, F04)
- Approval via Capital and Vendor Review Committee: June 1 meeting, business case due May 24 (F05, F06)
- Queuewise contract actually ends August 31 with notice due June 2 (F07, F09)
- Go-live moved from Q4 to Q3, target August 16 (F08)
- Scoped POC on 10,000 historical English/German tickets instead of a live pilot, 85% accuracy bar (F10, F11, F12)
- Technical requirements: Zendesk Support Professional, EU data residency (Frankfurt), SOC 2 Type II, SAML SSO (F18, F14, F15, F49)
- Objections: price vs budget, 6-8 week security review, integration effort, change management (F16, F46, F47)
- Competitor Deflekt ($31, no EU region) and incumbent Queuewise (F19, F44)
- Action items with owners/dates: Dana proposal Apr 30, Marcus security docs Apr 28, Jon NDA today + questionnaire Apr 29, Tomas export May 7 (F20, F21, F22, F24)
- Next meeting Thursday May 6 at 3 PM Eastern (moved from May 4) (F13)

## Most important disagreements (judge fact checks)

✔ present · ◐ partial · ✘ missing · ⚠ contradicted

| Fact | Imp. | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|
| F18: Harbourline is on Zendesk Support Professional, not Zendesk Suite (Suite was judged too expensive two years ago). | critical | ⚠ | ⚠ | ⚠ | ✔ | ✔ | ✔ |
| F22: Jon will send Harbourline's mutual NDA today (before end of day); the owner changed from Priya because legal routes vendor NDAs through Jon. | important | ⚠ | ⚠ | ⚠ | ✔ | ✔ | ✔ |
| F14: EU consumer and merchant data handled by Rotterdam must stay in the EU (non-negotiable per Harbourline's DPO); Routewell would process and store EU tickets, including the classification model and backups, in its Frankfurt EU region. | critical | ✔ | ✔ | ⚠ | ✔ | ✔ | ◐ |
| F07: The incumbent Queuewise contract ends on August 31 (a two-year renewal signed September 1), not December 31 as Priya believed. | critical | ✔ | ✔ | ⚠ | ✔ | ✔ | ✔ |
| F28: Joan will check with procurement on the Queuewise notice terms (format, signatory, and whether a short extension is possible instead of a full-year renewal). | important | ✘ | ✔ | ✔ | ✔ | ✘ | ◐ |
| F29: Dana committed that Routewell will return the completed security questionnaire within five business days of receiving it. | important | ✘ | ✔ | ✔ | ✔ | ✘ | ✔ |
| F50: SCIM provisioning (wanted by Jon for offboarding seasonal staff) is only included in Routewell's Enterprise tier, which lists at $52 per agent per month. | important | ⚠ | ✔ | ✔ | ✔ | ◐ | ✔ |

## Judge-flagged problems

**A** — overall 5/10, accuracy 5, retention 7, conciseness 2
- critical: Misattributed Jon's preference for a 30-day data deletion window to Marcus.
- critical: Misattributed Jon's uncertainty about the May 24 security review deadline to Marcus.
- critical: Contradicted the Zendesk plan confirmation by listing it as an open question.
- critical: Contradicted the Enterprise pricing by listing it as an open question.
- critical: Included a superseded action item for Priya to send the NDA, contradicting Jon's ownership.
- superseded value: C08 → Speaker 1 will ask legal to send the mutual NDA template. (deadline: Today)

**B** — overall 6/10, accuracy 6, retention 9, conciseness 2
- critical: Contradiction: The notes correctly state Harbourline is on Zendesk Support Professional, but then list 'What exact Zendesk plan is Harbourline on?' as an open question.
- critical: Contradiction/Misattribution: The notes assign the action item to send the mutual NDA to both Priya (Speaker 1) and Jon (Speaker 2).
- critical: Misattribution: The notes list 'Speaker 1 (me): Send a revised pricing proposal...' Speaker 1 is Priya, while 'Me' is Dana.
- critical: Superseded values reported as current: The notes list the October 15 go-live and December 31 Queuewise contract end date as inferred action items, despite them being superseded later in the call.
- hallucination: Security questionnaire by Thursday, May 29 (the transcript says April 29).
- superseded value: C03 → Target go-live around October 15, two weeks before the November 1 freeze [inferred]
- superseded value: C04 → Queuewise contract believed to end December 31 [inferred]

**C** — overall 4/10, accuracy 5, retention 8, conciseness 2
- critical: The follow-up draft states that Routewell lacks an EU region, confusing Routewell with Deflekt and contradicting the transcript.
- critical: The notes list the Zendesk plan and the Queuewise end date as unconfirmed open questions, despite them being explicitly confirmed in the transcript (and correctly noted elsewhere in the text).
- critical: The notes include raw meta-instructions in the follow-up draft section (e.g., 'The follow-up should confirm...').
- critical: Extreme repetition: action items and open questions are duplicated multiple times.
- hallucination: That Routewell lacks an EU region.
- hallucination: That the Zendesk Suite plan in use was not confirmed.
- hallucination: That the exact end date of the Queuewise contract needs confirmation.
- superseded value: C08 → Speaker 1 will have the legal team send the mutual NDA.

**D** — overall 5/10, accuracy 6, retention 10, conciseness 2
- critical: Listing superseded decisions (October 15 go-live) alongside the final decision (August 16 go-live) in the Decisions section.
- critical: Listing resolved questions (Zendesk plan, Queuewise end date) as open questions or inferred action items despite them being definitively answered during the call.
- hallucination: Inferred action item: 'The technical stack review should confirm Harbourline's exact Zendesk plan.' (This was already confirmed as Support Professional)
- hallucination: Open question: 'What is the exact end date of the Queuewise contract?' (This was confirmed as August 31)
- superseded value: C02 → Which exact Zendesk plan is Harbourline using? [open]
- superseded value: C03 → Harbourline's working rollout plan is a Q4 go-live around October 15, leaving two weeks before the November 1 support-tooling freeze. (Listed under Decisions)
- superseded value: C04 → The Queuewise contract is believed to end December 31, with a planned period of overlap. [inferred] (Listed under Action items)

**E** — overall 5/10, accuracy 6, retention 8, conciseness 2
- critical: Reported multiple superseded values as current facts or action items (e.g., 120 agents, October 15 go-live, December 31 Queuewise expiration, 3-week POC).
- hallucination: Jon: Take the integration plan to the manager for review. [inferred] (Jon only mentioned wanting something he could take to his manager, not a formal action item to review it with them.)
- superseded value: C01 → Harbourline has about 120 agents split between Columbus and Rotterdam
- superseded value: C03 → Target go-live is around October 15. [inferred]
- superseded value: C04 → Queuewise is believed to expire December 31. [inferred]
- superseded value: C06 → The vendor will scope the historical-data proof of concept for approximately three weeks after receiving the data. [inferred]
- superseded value: C08 → Speaker 1's legal team: Speaker 1's legal team will send the mutual NDA template.

**F** — overall 4/10, accuracy 9, retention 9, conciseness 2
- none flagged


---

# Summary A

_(run1)_

### Title: Routewell Ticket Routing Proof of Concept

#### Overview
Harbourline described a 120-agent, multi-region support operation with 18% first-assignment misrouting, a $50,000 year-one budget, and a target go-live around October 15 before the November 1 freeze. The team clarified the Zendesk and routing environment, reviewed Routewell's integration and adoption approach, identified works-council and SCIM risks, and agreed that Dana and Marcus would prepare a detailed integration plan. The group aligned on a historical-data proof of concept instead of a live pilot, targeting 10,000 English and German tickets with an 85% routing-accuracy benchmark, while assigning security-document and export follow-ups. The team confirmed a 140-seat full-scope proposal, identified Greg Hale as the economic buyer, and mapped the June 1 approval process and supporting deliverables. The Queuewise end date was corrected to August 31, moving the target go-live to August 16 and making the June 1 approval and May 24 business case critical milestones. The group confirmed the integration plan is due May 4, scheduled the next meeting for May 6 at 3 PM Eastern, and documented unresolved approval, product, works council, and stakeholder questions. Key decisions: The session will focus on listening to Harbourline's support workflow and pain points, followed by a technical demonstration of Routewell's routing capabilities.; The evaluation will consider a Q4 go-live around October 15, ahead of Harbourline's November 1 support-tooling change freeze.; Dana and Marcus will draft an integration plan with named tasks and hours for each side.. Buying signals: Priya confirmed that the routing initiative is a real project on her plan for the year rather than an exploratory exercise.

#### Summary
- The meeting evaluated Routewell as a replacement for the existing Queuewise tagging and custom sorter to improve routing across the support operation.
- The team chose an anonymized proof of concept using English and German tickets, with an 85% first-assignment accuracy benchmark, instead of a live pilot; Dutch may be considered later, and US ticket summaries were deferred until after go-live.
- The proposal will cover the full scope with one-year and two-year options, while approval will proceed through the June 1 Capital and Vendor Review Committee with Greg Hale as financial approver; the target go-live is August 16 before Queuewise ends on August 31.

#### Account context
- Harbourline provides fulfillment and last-mile logistics for online retailers, primarily mid-size direct-to-consumer brands.
- The support organization serves both Harbourline's merchant customers and those merchants' end consumers.
- Harbourline has approximately 120 agents split between Columbus and Rotterdam, with Rotterdam handling most European support.
- Support volume is about 38,000 tickets per month normally and approximately 55,000 during November and December peak season.
- Tickets arrive through email, chat, and a tracking-page web form, representing approximately 62%, 25%, and 13% of volume respectively.
- The current stack includes Zendesk, Salesforce for merchant accounts, Queuewise for auto-tagging and language detection, and a custom Python sorter.
- The operation routes tickets into 14 queues based on region, language, merchant tier, claims, and carrier escalations.
- Harbourline uses Zendesk Support Professional rather than Suite and has bolted Queuewise onto the platform because Suite was considered too expensive for its seat count.
- The current routing workflow combines Salesforce merchant-tier data with a cron-based Python sorter containing approximately 340 rules.
- The sorter has grown organically rather than being deliberately designed as a maintained system.
- Priya runs customer operations, while Jon owns IT and security concerns.
- Harbourline has two engineers, and its Salesforce administrator Renata sits in sales operations rather than Jon's team.
- Harbourline uses Okta for identity and has seasonal turnover among its agent population.
- The customer uses Okta for identity management and requires SAML SSO for all users with local passwords disabled.
- The customer has seasonal turnover in its agent population, making automated provisioning and offboarding operationally important.
- Rotterdam handles EU consumers and merchants, while US tickets would be processed in the vendor's Virginia region.
- The proposed proof of concept is based on resolved Zendesk tickets and compares predicted routing with the final queues after manual moves.
- The customer's current routing baseline is approximately 82% correct on first assignment and an 18% misroute rate.
- The routing editor supports replaying policy changes against the prior seven days of tickets.
- The customer has 140 support agents for the rest of the year after converting seasonal agents to permanent in March.
- The proposed deployment covers Zendesk and Salesforce across two regions.
- The customer's current environment includes Queuewise and an existing sorter that consumes engineering time.
- The customer is evaluating a full-team rollout rather than limiting the initial scope to email-heavy teams.
- Joan Petrakis participates from finance and FP&A, while Jon owns security review and vendor-intake activity.
- Priya recommends the purchase, but Greg Hale controls the financial decision.
- The customer currently uses Queuewise, whose signed renewal term ends August 31 rather than December 31.
- The customer processes tickets across web form, chat, and another channel, with web forms benefiting from a dropdown and chat using the full conversation through handoff.
- Damaged-parcel tickets frequently include photos, and attachment metadata can identify the presence and number of images without analyzing their content.
- The customer is considering Salesforce integration, SCIM, US ticket summaries, Dutch support, and a possible future Lyon hub.
- Joan is involved in the proposal review and will be included in the proof-of-concept readout because the accuracy number feeds the business case.
- The account is coordinating a committee approval process with a planned go-live and a possible pre-committee vendor conversation.
- The discussed implementation context includes US ticket-summary usage, a Salesforce session, and a potential Rotterdam works council consultation.
- The proof of concept may include Dutch, but that scope decision remains open.

#### Pain points
- Routing is the primary operational pain because tickets land in the wrong queue, wait for manual discovery, and are moved only after delays.
- A February sample found that approximately 18% of tickets were misrouted on first assignment.
- A misrouted ticket adds approximately six hours before reaching the correct person and can take a full day when sent to Rotterdam after local working hours.
- The custom sorter is difficult to maintain because its roughly 340 rules can contradict one another and depend on rule order.
- Routing changes typically take a couple of weeks because two engineers must edit, test, and deploy rules alongside their other internal-tooling responsibilities.
- Pro merchant tickets are sometimes routed into consumer queues when the sorter cannot match the merchant or the sender uses a personal Gmail address.
- Harbourline currently achieves the contractual one-hour first-response SLA for Pro merchants only 71% of the time.
- Harbourline achieves the contractual Pro one-hour SLA only 71% of the time and has incurred service credits twice this year.
- More than half of SLA misses are caused by Pro merchant tickets landing in consumer queues because of failed merchant matching or personal Gmail senders.
- The 340-rule sorter is difficult to maintain and requires engineering involvement for routing changes.
- Team leads collectively spend approximately 11 hours per day manually moving tickets.
- Harbourline's engineers have limited capacity to take on a complex implementation.
- Agents distrust automatic routing because they have previously been blamed for slow responses caused by sorter errors.
- Rotterdam's team is particularly sensitive to tools that could be perceived as surveillance.
- The customer considers automated access removal critical because seasonal agent turnover increases offboarding risk.
- EU data cannot leave the EU because the customer's DPO has made residency a non-negotiable requirement.
- The security review is resource-constrained because a roughly 180-question questionnaire is handled alongside stakeholders' normal work.
- Questionnaire back-and-forth is typically the slowest part of the customer's vendor review.
- The customer needs a measurable business case for routing improvement rather than a pilot that adds another implementation phase.
- The existing sorter is difficult to manage and its engineering cost is part of the customer's budget calculation.
- A partial 100-seat rollout would leave half the team on old routing, which Priya described as a management mess.
- The customer needs to quantify the do-nothing cost using service credits, 11 hours per day of team-lead time, and sorter engineering effort.
- Greg is more persuaded by labor hours and service credits than by product features.
- The customer requires security and compliance documentation before progressing through review.
- Renata's workload may make Salesforce coordination difficult.
- The corrected Queuewise expiration creates a compressed migration schedule because the customer does not want to renew for a full year merely to bridge a short gap.
- The customer needs a reliable EU-region deployment with applicable SOC 2 coverage because Deflekt's roadmap is not sufficient for planning.
- Short, messy chat messages such as 'help' or 'where is it' provide limited classification confidence.
- The customer needs damaged-parcel photos to contribute useful claims signals even though the model does not currently interpret image content.
- The business case depends on completing the security review and receiving proof-of-concept accuracy results under an accelerated schedule.
- The team lacks a confirmed contingency plan if the June 1 approval does not arrive.
- The possible Queuewise notice creates a consequence if approval slips.
- The integration plan was still outstanding and specifically requested for May 4.

#### Buying signals
- Priya confirmed that the routing initiative is a real project on her plan for the year rather than an exploratory exercise.
- Harbourline has allocated $50,000 for the first year, including software and implementation.
- Priya said she has some budget flexibility beyond the working $50,000 figure.
- Harbourline is actively evaluating Deflekt and its existing Queuewise-plus-sorter approach.
- The team has a defined implementation target of October 15 to allow approximately two weeks before the November 1 freeze.
- The Queuewise contract is believed to end December 31, creating a potential overlap period for a replacement.
- Priya identified improving Pro SLA attainment to at least 90% by year-end as the key performance outcome.
- Priya said that allowing operations team leads to change routing policies without filing IT tickets would be a major benefit.
- Priya identified tracking-number fallback for personal-email requests as a needed capability because personal emails drive about half of Pro misses.
- Jon responded positively to staged policy testing and replay against the previous seven days of tickets.
- Priya found a high-confidence launch approach more acceptable than switching immediately to full automation.
- Harbourline's stated success criteria are raising Pro SLA attainment to at least 90%, reducing misroutes from 18% to about 5%, and eliminating manual ticket movement by team leads.
- Jon wants to retire the sorter and its VM rather than add another system requiring ongoing babysitting.
- The customer is willing to approve a proof of concept directly if the historical data is properly anonymized.
- The group agreed to proceed with a proof of concept instead of a live pilot.
- The customer accepted an initial 10,000-ticket scope and an 85% accuracy benchmark as a reasonable evaluation bar.
- The customer assigned Tomas to produce the export by May 7, indicating concrete commitment to the evaluation.
- The customer said early delivery of security documents would materially help accelerate the review.
- Priya reacted positively to the agent-facing routing explanation and said Rotterdam would want it.
- Priya requested pricing during the call so she could compare Routewell with Deflekt.
- The team brought Joan from finance into the pricing discussion to address approval questions.
- The customer confirmed a 140-seat headcount plan rather than the earlier 120-seat estimate.
- Priya said an August go-live would still work for the customer's October objective.
- The customer agreed to present the real 140-seat scope to Greg instead of pursuing a smaller rollout.
- Jon explicitly said the integration plan is the deliverable he most needs.
- The customer proposed a specific August 16 go-live date and accepted a two-week overlap before Queuewise ends.
- The customer agreed to an accelerated proof-of-concept ending with a May 21 readout.
- The customer is actively preparing a business case due May 24 and intends to use the proof-of-concept accuracy result in it.
- The customer requested a follow-up session to review the proposal and integration plan together.
- Priya stated that ticket summaries are desired, but agreed to defer them until after go-live so they do not slow the main review.
- Marcus preferred a 30-day data-deletion window after termination and said he would add it to the DPA comments.
- The customer requested a concrete integration plan by May 4.
- The group scheduled a follow-up meeting for May 6 at 3 PM Eastern.
- The team is actively considering proof-of-concept scope, including whether to add Dutch.
- The customer may want Greg to speak with the vendor before the committee.

#### Objections
- EU data residency is a material evaluation concern because Harbourline operates a major support site in Rotterdam.
- Jon is concerned about any solution requiring significant integration work from Harbourline's two-person IT engineering team.
- Harbourline is comparing Routewell with Deflekt, which was quoted at approximately $31 per agent per month.
- Renewing Queuewise and patching the existing sorter remains an alternative, although Jon strongly dislikes repeating that maintenance work.
- Harbourline prefers an exploratory, listening-led sales process and is wary of vendor calls dominated by slide presentations.
- Jon is concerned about the short-term implementation burden even if Routewell reduces work over the long term.
- Jon is wary of giving operations teams routing-policy control, although role-based permissions, audit history, and replay testing reduced that concern.
- The operations team fears that an early visible AI routing error could damage trust in the rollout.
- Rotterdam may resist the product because of its prior negative experience with a workforce-management tool.
- Jon requires the solution to pass Harbourline's security review without surprises.
- SCIM being restricted to the Enterprise tier is a concern because automatic offboarding is important to Harbourline.
- The customer objected that SCIM being limited to Enterprise is problematic given its offboarding requirements.
- The customer raised concern that the default US processing of the summary sub-processor could violate EU residency requirements.
- The customer does not want to decide on US summaries until the feature is reviewed separately.
- The customer rejected the proposed live pilot as unsuitable because it would require the full security review and would not test Rotterdam's language and residency needs.
- The customer may challenge the initial proof-of-concept language scope because Rotterdam may request Dutch coverage.
- The customer objected that Professional pricing was already above $50,000 before implementation.
- SCIM is required by Jon, but it is not included in the initial Professional pricing quote.
- The customer's planned $50,000 approval amount was based on a rough estimate tied to Queuewise and sorter engineering costs.
- Joan indicated that Greg generally prefers one-year terms with new vendors rather than early lock-in.
- The proposed 100-seat rollout did not resolve the approval issue because it would still cost $46,800 annually and remain above the $40,000 threshold.
- The customer requires competing quotes and a do-nothing baseline for Greg's review.
- Deflekt's missing live EU region with SOC 2 coverage is a current hard blocker.
- The customer will not count generally unavailable image understanding in the evaluation.
- The customer is concerned that chat's lower confidence may result in a lower auto-route rate and more human triage.
- The accelerated schedule leaves little room for slippage and cannot tolerate a July 6 committee date.
- A full-year Queuewise renewal is viewed as undesirable if approval slips and only a short bridge is needed.
- SCIM inclusion and pricing remain a potential fit and commercial concern.
- The need for Rotterdam works council consultation could affect implementation readiness.

#### Budget / timeline / authority
- Priya owns the $50,000 year-one budget within customer operations and pitched the project to leadership.
- The working budget includes both software and implementation costs.
- The desired deployment window is Q4, with an October 15 target before the November 1-to-January 10 change freeze.
- The timing is intended to align with the expected December 31 end of the Queuewise contract and provide a couple of months of overlap.
- Priya is measured on improving Pro merchant first-response SLA performance from 71% to at least 90% by year-end.
- The Pro merchant SLA is one hour, while standard merchants and consumers have a four-business-hour first-response target and a 48-hour internal resolution target.
- Harbourline previously rejected Zendesk Suite because it was too expensive for its seat count.
- The Zendesk integration is estimated at one to two hours for an administrator to install, grant API scopes, and test.
- The Salesforce connector typically takes two to three weeks elapsed, with only a few days of actual effort because much of the time is spent waiting for approvals.
- The Salesforce work requires a Salesforce administrator to create a connected app and map the account-tier and tracking-number fields.
- Renata is the relevant Salesforce administrator, but her availability is constrained by a CPQ rollout.
- A works-council consultation could add approximately four to six weeks if required.
- Harbourline requires SAML SSO through Okta with local passwords disabled and ideally requires SCIM provisioning for automatic access removal.
- SCIM provisioning is commercially tied to the Enterprise tier, while SAML SSO with Okta is supported on all plans.
- The customer security review normally requires six to eight weeks and includes security, DPO, and legal review.
- A four-week review may be possible but is not guaranteed and depends on a complete, fast questionnaire response and acceptable DPA language.
- Speaker 2 can personally approve the anonymized historical-data proof of concept under a lighter review.
- The proof of concept is expected to run for approximately three weeks after the data is available.
- Professional pricing was offered at $39 per agent per month for this team, billed annually.
- At 140 seats, the annual subscription is $65,520 and implementation is an additional $9,500.
- Enterprise pricing lists at $52 per agent per month and is expected to cover SCIM, but exact options will be provided later.
- Purchases above $40,000 in first-year total contract value, including implementation, require CFO approval.
- Greg Hale chairs the Capital and Vendor Review Committee and is the financial decision maker.
- The committee meets on the first Tuesday of each month, with submissions due at least five business days before the meeting.
- The June 1 committee requires the business case by May 24, and the following committee meeting is July 6.
- The business case must include three-year total cost, two competing quotes, and security sign-off or Jon's written confirmation of no blocking findings.
- After committee approval, legal contracting typically takes about two weeks, implying a mid-June signature if the June 1 meeting is used.
- Implementation is expected to take six to eight weeks from signature to go-live.
- The customer needs the business case by May 24 for the June 1 committee.
- Greg's approval on June 1 is the critical authorization milestone for the August 16 go-live.
- The Queuewise non-renewal notice must be sent by June 2 to avoid automatic renewal for another full year.
- The target August 16 go-live is achievable if the contract is signed by mid-June, with an estimated six-to-eight-week implementation.
- The security review should be complete or have no blocking findings by May 24, but Marcus described that timing as uncertain.
- The next review is scheduled for May 6 at 3 PM Eastern, and Greg is not expected to attend a vendor pricing call at this stage.
- June 1 is the referenced approval date, but the approval outcome and fallback plan are unresolved.
- A committee is involved in the approval process, and Greg may meet the vendor before that committee review.
- The integration plan is expected by May 4, ahead of the scheduled May 6 follow-up.
- SCIM pricing is not yet settled and will be addressed in the proposal.

#### Follow-up email
- Recap that Harbourline supports both merchants and end consumers across 120 agents in Columbus and Rotterdam.
- Reference the 18% first-assignment misrouting rate and the approximately six-hour delay caused by a misrouted ticket.
- Acknowledge the current 38,000 monthly ticket baseline, 55,000-ticket peak volume, and 14 routing queues across four languages.
- Confirm the $50,000 year-one budget, including implementation, and Priya's ownership of the customer-operations budget.
- Reiterate the desired October 15 go-live ahead of the November 1 change freeze and the expected Queuewise contract overlap.
- State that the next technical discussion will cover EU data residency and the integration burden on Harbourline's two-person IT team.
- Tie the proposed solution to improving Pro merchant SLA attainment from 71% today to at least 90% by year-end.
- Reconfirm that Harbourline is on Zendesk Support Professional, not Suite, and that Routewell would replace both Queuewise tagging and the cron-based sorter.
- Summarize the integration estimates: one to two hours for Zendesk setup and two to three weeks elapsed for Salesforce configuration, subject to approvals.
- Highlight tracking-number fallback for personal-email requests as a key solution to the current Pro misrouting problem.
- Include the proposed cautious rollout approach: high confidence thresholds, human triage for low-confidence tickets, agent overrides, and replay testing before publishing policy changes.
- Capture Harbourline's success targets of at least 90% Pro SLA attainment, approximately 5% misroutes, and eliminating the 11 daily hours spent by team leads on manual triage.
- Explain that SAML SSO with Okta is supported and can disable local passwords, while SCIM is currently limited to the Enterprise tier and requires follow-up options.
- Mention the open action for Harbourline to determine whether Rotterdam's works council must review per-agent override data and who owns that relationship.
- Confirm that EU tickets, classification, routing, and backups remain in the Frankfurt region when EU summaries are disabled.
- Attach or commit to the SOC 2 Type II report, annual penetration-test executive summary, and sub-processor list once the NDA is signed.
- Restate that the review timeline is normally six to eight weeks, with a possible but uncommitted path toward four weeks if materials and questionnaire responses move quickly.
- Summarize the agreed proof-of-concept scope as 10,000 resolved tickets from a normal month, English and German initially, anonymized and evaluated in an EU sandbox.
- State the success criterion as at least 85% first-assignment routing accuracy, compared with the current approximately 82% baseline.
- Include the committed document, questionnaire, and Zendesk-export dates: April 28 for vendor security materials, the 29th for the questionnaire, and May 7 for the export.
- Confirm that the proposal is based on 140 seats rather than the earlier 120-seat estimate.
- State the Professional price of $39 per agent per month, the $65,520 annual subscription, and the $9,500 implementation fee.
- Include a separate SCIM-enabled option and clearly labeled one-year and two-year term options.
- Explain that the business case should compare Routewell with Deflekt and the Queuewise-plus-sorter do-nothing baseline.
- Frame the business case around service credits, 11 hours per day of team-lead time, and engineering time on the sorter because those metrics matter to Greg.
- Include the expected six-to-eight-week implementation window and the customer's stated October objective.
- List the agreed deliverables: security reports, sub-processor list, integration plan, change-management playbook, and agent-facing materials.
- Confirm the approval path through the June 1 committee, with the business case due May 24 and Greg Hale as the financial approver.
- Confirm the May 6 proposal and integration-plan review at 3 PM Eastern and note that Greg may not attend at this stage.
- Restate that the integration plan is due May 4 and the proof-of-concept readout is scheduled for May 21.
- Explain that the Queuewise contract ends August 31, requiring notice by June 2 and driving the August 16 target go-live.
- Call out that June 1 committee approval and the May 24 business case are now critical milestones, with limited schedule slack.
- Confirm that US ticket summaries are deferred until after go-live and that they are not part of the critical path.
- Summarize the current product constraints: image content is not analyzed, chat is expected to have the lowest auto-route rate, and Deflekt's EU-region/SOC 2 gap remains a blocker.
- Confirm that the requested 30-day data-deletion period after termination will be raised with legal through the DPA comments.
- Confirm that the integration plan will be sent by May 4.
- Recap that the next meeting is Thursday, May 6 at 3 PM Eastern.
- State that ticket summaries on the US side are deferred until after go-live.
- List the remaining open items: SCIM inclusion and pricing, Dutch in the proof of concept, Rotterdam works council consultation and ownership, Renata's Salesforce-session bandwidth, and Greg's possible pre-committee call.
- Highlight the June 1 approval dependency and the related Queuewise notice risk if approval slips.

#### Action items (structured)
- Marcus: Marcus, Routewell's sales engineer, will join the discussion and demonstrate how Routewell's routing works against Harbourline's described workflow.
- Routewell: Routewell will cover the integration work required from Harbourline's side, given that IT has only two engineers supporting all internal tooling.
- Dana and Marcus: Prepare an integration plan detailing named tasks and estimated hours for Harbourline and Routewell.
- Priya / Harbourline: Check internally who owns Harbourline's relationship with the Dutch works council and whether consultation is required.
- Dana: Return with options for handling SCIM provisioning in the proposal.
- Jon / Harbourline: Check Renata's availability for a working session on the Salesforce integration. [inferred]
- Vendor team: Provide written confirmation of EU data handling and the sub-processor list.
- Speaker 1: Speaker 1 will ask legal to send the mutual NDA template. (deadline: Today)
- Speaker 2: Speaker 2 will send the security questionnaire to the vendor. (deadline: Thursday the 29th)
- Marcus: Marcus will send the SOC 2 report, penetration-test summary, and sub-processor list to Jon, subject to the NDA being signed. (deadline: Wednesday, April 28)
- Tomas: Tomas will prepare a 10,000-ticket Zendesk export containing ticket content, final queue, tags, and anonymization. (deadline: Friday, May 7)
- Vendor team: The vendor will scope the proof of concept against a normal-month sample of approximately 10,000 resolved tickets and measure routing accuracy by queue, language, channel, and confidence threshold. [inferred]
- Mutual NDA to be sent by the customer's legal team. [inferred]
- Security questionnaire to be sent by Speaker 2. [inferred]
- SOC 2 report, penetration-test summary, and sub-processor list to be sent by Marcus, assuming NDA signature. [inferred]
- 10,000-ticket Zendesk export to be ready from Tomas. [inferred]
- Dana: Send a revised pricing proposal based on 140 seats, including Professional at $39 per agent per month, a SCIM option, the $9,500 implementation fee, and a clearly labeled two-year option. (deadline: Friday, April 30)
- Marcus: Send the SOC 2 Type II report, pen test executive summary, and sub-processor list to Jon after the NDA is signed. (deadline: Wednesday, April 28)
- Dana and Marcus: Prepare and send an integration plan covering tasks and estimated hours for both sides, including Salesforce connected-app work with Renata. (deadline: Tuesday, May 4)
- Dana: Send the change-management playbook and agent-facing materials with the pricing proposal.
- Jon: Send the mutual NDA using the vendor-intake template. (deadline: End of day)
- Jon: Send the security questionnaire. (deadline: Thursday, April 29)
- Tomas: Pull an export of 10,000 anonymized resolved tickets in English and German. (deadline: Friday, May 7)
- Priya: Tell Tomas to begin preparing the ticket export before his days off.
- Joan: Send the committee business-case template and an example of an approved prior business case. (deadline: Monday, May 3)
- Dana and Priya: Co-write the business case and target submission for the May 24 deadline for the June 1 committee. (deadline: May 24)
- Joan: Help with the three-year cost portion of the business case.
- Jon: Jon will ask Renata whether she has bandwidth for a Salesforce working session.
- Priya: Ask HR in Rotterdam whether the works council requires consultation.
- End of day: Jon to send the NDA. [inferred]
- April 28: Marcus to send security materials after NDA signature. [inferred]
- April 29: Jon to send the security questionnaire. [inferred]
- April 30: Dana to send the revised pricing proposal. [inferred]
- May 3: Joan to send the business-case template and approved example. [inferred]
- May 4: Dana and Marcus to send the integration plan. [inferred]
- May 7: Tomas to provide 10,000 anonymized English and German resolved tickets. [inferred]
- May 24: Business case due for the June 1 committee meeting. [inferred]
- June 1: Capital and Vendor Review Committee meeting. [inferred]
- Priya: Priya will ask around to identify who should check with Rotterdam HR about whether a works council consultation is required.
- Me: Me will send the calendar invite for the May 6 proposal and integration-plan review. (deadline: May 6 at 3 PM Eastern)

#### Decisions (structured)
- The session will focus on listening to Harbourline's support workflow and pain points, followed by a technical demonstration of Routewell's routing capabilities.
- The evaluation will consider a Q4 go-live around October 15, ahead of Harbourline's November 1 support-tooling change freeze.
- Dana and Marcus will draft an integration plan with named tasks and hours for each side. (owner: Dana and Marcus)
- The team agreed not to run a live pilot and to use a scoped proof of concept on anonymized historical tickets instead.
- The initial proof of concept will use English and German tickets, with Dutch potentially considered later and Spanish excluded for now.
- The proof of concept success benchmark is at least 85% routing accuracy on first assignment across the historical ticket set.
- Tomas, the operations analyst on Speaker 1's team, will own the Zendesk export rather than Speaker 2's engineering team.
- The proposal will use the full 140-agent scope rather than a 100-seat partial rollout.
- The pricing proposal will include both one-year and two-year term options, with the two-year option clearly labeled and not assumed to be approved.
- The purchase will proceed through the Capital and Vendor Review Committee, with Greg Hale as the economic buyer and final financial approver.
- The team is targeting the June 1 committee meeting, with the business case due May 24.
- The pricing proposal will be sent to Joan with Priya copied, while security documents will be sent to Jon.
- The next proposal and integration-plan review was moved to Thursday, May 6 at 3 PM Eastern for one hour instead of Tuesday, May 4.
- The ticket-summary feature for the US region will be evaluated separately after go-live and will not be on the main review's critical path.
- The Lyon hub and possible French-language support will not be included in the current planning because the hub is uncertain and would not occur until next year.
- The target go-live moved to Monday, August 16, before the Queuewise contract ends on August 31, with approximately two weeks of overlap.
- The proof-of-concept readout was set for Friday, May 21 after data loading on May 10 and processing through May 20.
- Ticket summaries for the US side will be parked until after go-live.
- The integration plan will be provided by May 4.
- The group will meet again Thursday, May 6 at 3 PM Eastern.

#### Open questions (structured)
- The exact Zendesk Suite plan in use has not yet been confirmed. [open]
- It remains unresolved whether Harbourline will open a hub near Lyon and add French-language support next year. [open]
- Harbourline has not yet determined whether to select a new routing vendor, renew Queuewise, or patch the existing sorter again. [open]
- Will the tool's per-agent override data trigger a Dutch works-council consultation? [open]
- Who at Harbourline owns the relationship with the works council? [open]
- Can Routewell provide an acceptable approach to SCIM provisioning despite SCIM being limited to the Enterprise tier? [open]
- Will Renata have bandwidth to participate in a Salesforce integration working session during the CPQ rollout? [open]
- Whether SCIM provisioning can be included or otherwise handled outside the Enterprise tier remains unresolved. [open]
- Whether ticket summaries should be enabled for the US region remains open for separate review. [open]
- Whether Dutch should be added to the proof of concept has not been decided. [open]
- Whether the vendor security review can be completed in closer to four weeks remains uncertain and depends on fast questionnaire completion and acceptable DPA terms. [open]
- Whether the works council in Rotterdam requires consultation remains unresolved. [open]
- Whether Greg will approve a two-year term remains unresolved, with Joan expecting him to prefer one year. [open]
- Whether Renata has capacity for a Salesforce working session is unresolved. [open]
- The exact Enterprise pricing for SCIM has not yet been provided. [open]
- Who owns checking with Rotterdam HR whether a works council consultation is required? [open]
- Whether Renata has bandwidth for a Salesforce working session remains unresolved. [open]
- Whether Greg wants a vendor meeting before the committee is unknown. [open]
- What to do about the Queuewise notice if Greg does not approve on June 1 remains undecided. [open]
- Whether to send Queuewise non-renewal notice before Greg's approval is known remains undecided. [open]
- Whether Dutch should be added to the proof of concept is still open. [open]
- Whether a shorter-than-default data-deletion window will be included in the DPA remains subject to legal review. [open]
- What happens if the June 1 approval does not come through? [open]
- Whether SCIM will be included and at what price remains unresolved. [open]
- Whether Dutch will be added to the proof of concept remains unresolved. [open]
- Whether the Rotterdam works council needs to be consulted and who owns that remains unresolved. [open]
- Whether Greg wants to meet the vendor before the committee remains unresolved. [open]

#### Risks (structured)
- [high] Deflekt's lack of an EU region creates a data-residency concern for Harbourline's Rotterdam operation.
- [high] Harbourline's two IT engineers have limited capacity for substantial integration work.
- [high] The current sorter is a fragile dependency because it contains roughly 340 poorly understood, sometimes contradictory rules written by an engineer who left two years ago.
- [high] Missing the Pro merchant one-hour SLA has already resulted in service credits twice this year.
- [high] Harbourline is currently meeting the contractual Pro one-hour SLA only 71% of the time and has paid service credits twice this year.
- [high] Misrouting is the largest single cause of missed Pro SLA targets, with more than half of misses involving Pro tickets placed in consumer queues.
- [high] Harbourline's two engineers are already overloaded, creating short-term implementation capacity risk.
- [medium] Rotterdam agents are skeptical of automated tools because of a prior workforce-management experience that felt like surveillance.
- [high] A visible AI routing mistake during the first week could undermine Priya's credibility with the operations team.
- [high] A Dutch works-council consultation could delay the project by approximately four to six weeks if the tool is considered relevant to employee evaluation.
- [high] SCIM is available only on Routewell's Enterprise tier, while automatic offboarding is important because of seasonal agent turnover.
- [high] SCIM is available only in the Enterprise tier, creating a potential fit or commercial issue because seasonal agent turnover makes automated offboarding important.
- [high] The EU summary feature uses a US-based sub-processor by default, so it must be disabled for EU tickets or routed through a limited-availability EU endpoint to preserve residency.
- [high] The customer's vendor security review normally takes six to eight weeks and may be tight for an October target.
- [high] A live pilot would require the full security review and signed DPA because it would use real customer data, eliminating its intended time-saving benefit.
- [medium] The initial English-and-German proof of concept may not fully test Rotterdam's Dutch-language needs.
- [high] The quoted 140-seat Professional pricing plus implementation is above the customer's planned $50,000 budget and requires CFO approval.
- [high] The first-year total at 140 seats is $75,020 before any additional Enterprise or SCIM pricing, comprising $65,520 annually plus $9,500 implementation.
- [high] Greg Hale is not a rubber-stamp approver and has pushed back on several tools this year.
- [high] The committee business case must include a three-year total cost, at least two competing quotes, and IT security sign-off or Jon's confirmation of no blocking findings.
- [medium] Contracting after committee approval typically takes about two weeks and can be delayed if vendor terms are contested.
- [medium] Renata's limited availability could affect Salesforce integration planning.
- [high] The Queuewise contract actually ends August 31, not December 31, and missing the June 2 notice deadline could trigger an additional full-year renewal.
- [high] The August 16 go-live has little schedule slack and requires contract signature by mid-June.
- [high] If Greg does not approve on June 1, the customer may either renew Queuewise for a year or have no replacement system on September 1.
- [high] The security review must have no blocking findings by May 24, but its completion is uncertain because documents are needed by April 28 and the questionnaire must return within a week.
- [high] Deflekt's lack of a live EU region covered by SOC 2 is currently a hard blocker.
- [medium] Short chat conversations are expected to have the lowest auto-route rate because they provide less context and will more often go to human triage initially.
- [medium] Image content is not analyzed today, so photo-based ticket evaluation cannot rely on image understanding during the evaluation.
- [high] A June 1 approval delay could create a Queuewise notice risk.
- [medium] The Rotterdam works council may need consultation, but the requirement and owner are not yet established.
- [high] Approval timing is uncertain because the group has not determined what happens if June 1 approval fails.

#### Follow-up draft
Subject: Follow-up: Harbourline routing proof of concept

Hi there,

Thank you for the thoughtful discussion about Harbourline’s routing operation and the path to replacing Queuewise and the custom sorter. We aligned on an anonymized 10,000-ticket English and German proof of concept in an EU sandbox, using an 85% first-assignment accuracy benchmark, alongside a full 140-seat proposal and an August 16 target ahead of Queuewise ending August 31. The goal is to reduce the 18% misrouting rate and roughly six-hour delays, improve Pro SLA attainment from 71% toward at least 90%, and reduce manual triage through a cautious rollout. The key open question for our May 6 review is whether SCIM provisioning and pricing can meet Harbourline’s offboarding and budget requirements.

Best regards,
Routewell Team

---

# Summary B

_(run1)_

### Title: Harbourline Zendesk Routing Scoping Call

#### Overview
Discovery call with Priya and Jon of Harbourline where they detailed their Zendesk/Queuewise/custom-sorter routing stack, a $50k year-one budget, an October 15 go-live target ahead of a November 1 change freeze, and misrouting driving missed Pro SLA. Dana, Marcus, Priya, and Jon worked through Routewell's fit for Harbourline's Zendesk Support Professional stack, covering the 71%-vs-90% Pro SLA goal, misrouting causes, integration effort, agent/works council change concerns, and Jon's security requirements including Okta SSO and SCIM. The team walked through identity, data residency, and compliance requirements, agreed to replace a live pilot with a scoped proof of concept on 10,000 anonymized historical tickets targeting 85% routing accuracy, and reviewed the routing editor demo. Dana shared pricing for 140 seats, learned Greg Hale (CFO) is the economic buyer requiring committee approval, and recapped next steps including a revised proposal to Joan by April 30. Team locked in a revised sequence (go-live August 16, June 1 committee, POC readout May 21) after Joan discovered the Queuewise contract actually ends August 31 with a June 2 notice deadline, and closed with a wrap of open items. The call wrapped up with a review of open items, agreement that the integration plan would be delivered by May 4, and confirmation of a Thursday May 6 3 PM Eastern follow-up meeting. Key decisions: Agreed to keep the works council consultation question as an open item to be resolved early.; Dana will own drafting an integration plan with named tasks and hours, co-drafted with Marcus.; Agreed to no live pilot and instead a scoped proof of concept on historical anonymized tickets.. Buying signals: Priya confirmed the project is real and on her plan for this year, not just an exploration.

#### Summary
- The meeting was a discovery call with Priya and Jon of Harbourline on their Zendesk, Queuewise, and custom-sorter routing stack, where they detailed a $50k year-one budget, an October 15 go-live target ahead of a November 1 change freeze, and misrouting driving missed SLAs.
- Priya confirmed the project is real and on her plan for this year, not just an exploration.
- It was agreed there would be no live pilot, and instead a scoped proof of concept on historical anonymized tickets, with a success bar of 85% routing accuracy on first assignment, scoped to English and German for now.
- Go-live was moved from Q4 to Q3, set to Monday, August 16 to give two weeks of overlap with Queuewise, while the full seat scope will be presented to Greg since it requires his approval regardless.
- The works council consultation question was kept as an open item to be resolved early, and Dana will own drafting an integration plan with named tasks and hours, co-drafted with Marcus.

#### Account context
- Harbourline does fulfillment and last-mile logistics for online retailers, mostly mid-size DTC brands with some larger ones.
- Support serves both B2B merchants (the brands that pay them) and their end consumers asking about parcels.
- The support team is about 120 agents split between Columbus and a Rotterdam site handling most of Europe.
- Tickets arrive via three channels: email about 62% of volume, chat about 25%, and a tracking-page web form at 13%.
- Normal monthly volume is around 38,000 tickets, rising to about 55,000 in peak November and December.
- Current stack is Zendesk for ticketing, Salesforce for merchant accounts, Queuewise for auto-tagging and language detection, plus an in-house 'sorter' script in between.
- Tickets route into 14 queues split by region, language, merchant tier, plus special ones for claims and carrier escalations.
- They support four languages today — English ~70%, German ~12%, Dutch ~9%, Spanish ~9% — with French under discussion for a possible Lyon hub next year.
- Merchants are tiered Pro or Standard in Salesforce; Pro is about 300 accounts with a contractual SLA.
- SLAs: Pro merchants first response within 1 hour; Standard merchants and consumers within 4 business hours; internal resolution target is 48 hours for everything.
- The sorter is a Python cron job running every five minutes on a small VM in their data center, pulling tickets from the Zendesk API, reading Queuewise tags, applying keyword rules, and looking up merchant tier in Salesforce.
- Harbourline runs Zendesk Support Professional (not Suite), having rejected Suite two years ago on seat-cost and bolted on Queuewise instead.
- Harbourline uses Salesforce for merchant tier lookup and stores tracking information there.
- Routing today is a cron-based Python router (called 'the sorter') with about 340 keyword rules, running on a VM.
- Jon describes the sorter as something that grew organically rather than being built on purpose.
- Harbourline has Pro and consumer merchant segments, with Pro merchants covered by contractual one-hour SLAs.
- Harbourline has 11 team leads and two distinct support sites: Columbus (leads mostly bought in) and Rotterdam (more skeptical).
- Jon's IT team consists of only two engineers.
- Jon owns both IT and security at Harbourline and leads the security review.
- Harbourline's Salesforce admin, Renata, sits in the sales ops team, not Jon's IT team, and is currently mid-CPQ rollout.
- Marcus Lindqvist is Routewell's sales engineer based in Stockholm, covering the EU side of things.
- Rotterdam handles EU consumers and EU merchants, with EU data residency being non-negotiable per their DPO.
- Company uses Okta for everything and requires SAML SSO for all users with no local passwords.
- The agent population has seasonal turnover, making offboarding automation a priority.
- There are two ticket sites: an EU region (Rotterdam) and a US region, with tickets routed separately by region.
- They currently use Zendesk, and the PoC export would include ticket content, final queue, and tags.
- Current baseline is about 82% correctly routed on first assignment, with an 18% misroute rate.
- They use an automated sorter that is logged in Git, sometimes.
- They intend to target a go-live around October, with a security review timeline that needs to fit that.
- Team has 140 support agents (corrected from originally stated 120 after seasonal agents converted to permanent in March).
- Uses Zendesk with a Salesforce integration and an internal ticket sorter logged in Git.
- Rotterdam team (a specific office) requested agent-facing routing reasoning.
- Jon owns security review and vendor intake (routes NDAs, security questionnaires).
- Use case spans two regions with Zendesk plus Salesforce and historical ticket data in English and German.
- Customer runs three service channels — chat, web form, and tickets (including damaged parcel claims with photos) — with the web form having a dropdown field.
- US-side ticket summaries and SCIM are in scope of discussion for the evaluation.
- Customer has a Rotterdam offsite in June and a strategy team that would know about the potential Lyon hub.
- Lyon hub is a possible future expansion (not before next year) and would be the driver for adding French.
- Customer currently uses Queuewise as an incumbent vendor-level competitor, whose contract was believed to end December 31.
- Marcus is based in Stockholm (9 PM local for a 3 PM Eastern call) and is the vendor's implementation/product lead.
- Customer's main constraint on go-live timing is a November 1 freeze and the Queuewise contract end.
- The vendor is preparing a proposal for the customer that will address SCIM inclusion and pricing.
- A proof of concept is underway, with an open question about adding Dutch language support.
- An integration plan is expected from the vendor for the customer.
- A Salesforce session is planned, with Renata's bandwidth as an open question.

#### Pain points
- Routing is the first and biggest pain point — tickets land in the wrong queue, sit there, and are only moved once someone notices, by which point the merchant is angry.
- A February sample showed about 18% of tickets were misrouted on first assignment.
- A misrouted ticket adds roughly six hours before reaching the right person, sometimes a full day if it lands in Rotterdam after hours.
- Queuewise only tags tickets and doesn't really route them, leaving the actual assignment to the custom sorter.
- The sorter has around 340 rules, some contradicting each other with order-dependent behavior, and nobody fully understands them.
- The engineer who wrote the sorter left two years ago, so no one owns its logic now.
- Routing changes take a couple of weeks because requesters file a ticket with Jon's two engineers, who test against the previous day's tickets and push when it's not top of the list.
- Harbourline is hitting the Pro one-hour SLA only about 71% of the time.
- Misrouting is the biggest single reason for missed Pro SLA — more than half of misses were Pro merchant tickets sitting in a consumer queue because the sorter didn't match the merchant or the email came from a personal Gmail.
- Consumer tickets are huge volume with little leverage; merchant tickets are the ones where slowness costs them accounts.
- Harbourline hits the Pro one-hour SLA only about 71% of the time, and has paid service credits twice this year as a result.
- Misrouting is the single biggest cause of missed SLAs, with more than half of misses being Pro merchant tickets assigned to consumer queues.
- The sorter fails to match the sender to the merchant account when a ticket comes from a merchant employee using a personal Gmail address.
- Misroute rate currently sits at 18%, and Priya wants it brought down to roughly 5%.
- Each of the 11 team leads spends roughly an hour a day manually moving tickets, totalling about 11 hours of leadership time per day.
- Agents have been burned by the sorter, being blamed for slow responses caused by wrong routes, creating distrust of anything automatic.
- Rotterdam's skepticism stems from a prior workforce management tool rollout that felt like surveillance.
- Jon's team spends time maintaining the sorter and the VM it runs on, which he wants to retire.
- Offboarding is a major concern due to seasonal turnover, and SCIM being Enterprise-only creates a gap in automatic access removal.
- EU data must stay in the EU (including backups) for compliance with their DPO's requirements.
- The vendor security review process takes six to eight weeks, slowed significantly by questionnaire back-and-forth and reviewers doing it alongside their day jobs.
- Slow vendors who take two weeks to fill in the questionnaire are a specific pain point they want to avoid.
- Current sorter audit/logging is weak — changes are only 'sometimes' logged in Git.
- Misrouting is a measurable problem — they have an 18% misroute rate baseline.
- They need agents to trust routing decisions, which is why showing reasoning in the sidebar matters.
- Current manual sorter costs significant engineering time and has inconsistent logging.
- Prioritizes agent trust, achieved by showing predicted intent, confidence, and matched policy in the Zendesk sidebar.
- Partial rollout would leave half the team on the old routing, creating a management mess.
- 11 hours a day of team lead time is a quantified pain point.
- Existing Queuewise solution costs about $22,000 per year.
- Renata (customer side) is overloaded by a CPQ project, limiting bandwidth for a Salesforce working session.
- Customer has no identified HR owner in Rotterdam for the works council question.
- Deflekt's EU region is not live and its SOC 2 doesn't cover it, blocking evaluation of that vendor.
- Customer cannot plan on a vendor roadmap date — Jon's security review is date-driven and he needs a live EU region to consider Deflekt.
- Chat tickets are short and messy with lower confidence, so more would route to human triage — chat is expected to have the lowest auto-route rate of the three channels.
- Damaged parcel tickets typically arrive with photo attachments, and the model currently only reads metadata, not image content. Image analysis is not GA.
- Customer does not want to renew Queuewise for a full year just to bridge two months, forcing an earlier go-live than previously planned.
- Web form tickets include a dropdown field that users largely ignore.
- Uncertainty around the June 1 approval timeline and what happens if it slips.
- A Queuewise notice risk exists if the approval slips.
- Open item on whether the Rotterdam works council needs to be consulted, and who owns it.

#### Buying signals
- Priya confirmed the project is real and on her plan for this year, not just an exploration.
- Priya dislikes slide-heavy vendor calls, indicating appetite for a listening-led, demos-into-substance evaluation approach.
- Jon explicitly asks not to have to patch the sorter again, signalling internal desire to replace the current homegrown routing.
- Priya wants 90% or better Pro SLA by end of year and is measured on that number, indicating a clear success metric for the purchase.
- Priya reacts strongly to the idea ops leads could change routing policies without filing an IT ticket: 'That alone would be huge.'
- Jon approves of the staged policy replay feature: 'Okay, that I like.'
- Priya confirms the Salesforce tracking-number fallback is exactly what Harbourline needs, noting half the Pro misses were personal emails.
- Jon agrees it would help to do a working session directly with the Salesforce admin so the work does not fall on his engineers.
- Jon requests an integration plan he can take to his manager, signalling evaluation is moving forward internally.
- Priya finds the confidence-threshold and human-triage-queue story 'a more comfortable story than flip a switch.'
- Jon's security review detail request (Identity, SSO, SCIM) suggests active evaluation rather than early discovery.
- Priya asks Dana to note the team-level (not per-agent) override reporting option that changed the works council answer for other Dutch customers.
- They agreed to proceed with a scoped proof of concept on historical anonymized tickets instead of a full live pilot.
- They agreed to a clear PoC success bar of 85% routing accuracy on first assignment across 10,000 tickets.
- Speaker 1 noted the PoC would give them a number for the business case, calling it more useful than a pilot.
- Jon (Speaker 2) can approve a light review himself for properly anonymized data, unblocking the PoC without full security review.
- Jon committed to sending the security questionnaire by Thursday the 29th, indicating active evaluation.
- They acknowledged documents early would help accelerate the review, leaving open a possible four-week review timeline.
- They liked Marcu's approach of committing to 85% and aiming to beat it.
- Jon noted the routing editor's proper publish permissions and audit logging is better than their current sorter, a positive product signal.
- Rotterdam team (via Priya) expressed strong interest in the agent-facing reasoning panel.
- Priya can approve up to her former limit, indicating existing budget appetite.
- Jon explicitly wants SCIM, signaling specific feature requirements.
- A two-year term was discussed as a possible option to lower per-agent pricing to ~$35.
- Target go-live is October, which the timeline comfortably supports.
- Priya confirmed she wants ticket summaries on the US side (only timing is parked, not the need).
- Jon said he will actually read the integration plan before the May 6 review.
- Customer accepted a compressed proof-of-concept timeline: load May 10, run to May 20, readout May 21.
- Joan (customer side) will personally join the readout so the accuracy number feeds directly into the business case.
- Customer adopted the vendor's suggested list of short-term milestones and asked the vendor to confirm the critical-path date (June 1 committee).
- Jon is willing to accept a 30-day retention preference framed in DPA comments rather than as a blocker.
- Priya accepted that chat is likely to auto-route at the lowest rate, matching her expectation rather than objecting.
- Attendee said the session was 'actually really useful' and 'much better than forty minutes of slides.'
- A committee approval process is in play, with reference to a June 1 approval date.
- Greg may want to meet the vendor before the committee, indicating ongoing evaluation interest.
- The customer requested an integration plan by May 4, a concrete evaluation deliverable.

#### Objections
- Harbourline is also evaluating Deflekt, which they have already had two calls with.
- Deflekt's price came in lower than Priya expected at $31 per agent per month, making cost a consideration.
- Deflekt lacks an EU data region today, and Jon notes having heard 'coming later' promises from other vendors before.
- Jon flagged upfront that any solution requiring heavy integration work from his two-engineer team is a real concern.
- Renewing Queuewise and patching the sorter again is an explicit fallback option they are weighing.
- Jon's short-term concern: every vendor claims 'long term it's less work' and he wants proof of near-term effort for his two engineers.
- Jon warns a policy editor without IT oversight 'would also make me nervous', indicating a governance concern.
- Rotterdam's prior WFM tool experience has created distrust of employee-level monitoring in any new tool.
- Jon objects that SCIM being Enterprise-tier only is a problem given offboarding concerns tied to seasonal agent turnover.
- The Salesforce integration pulls in an admin from sales ops (Renata), adding a cross-team approval dependency outside Jon's control.
- SCIM provisioning being Enterprise-only was flagged as 'not great' given their offboarding needs.
- EU data residency is non-negotiable per their DPO, and they need the residency guarantee and sub-processor list in writing.
- They objected to the live pilot idea, noting it would require the full security review and signed DPA first — adding a phase rather than saving time.
- They noted a 25-agent Columbus pilot wouldn't test Rotterdam, where the language and residency concerns live.
- They flagged the six-to-eight-week security review as tight for an October timeline.
- A possible accelerated four-week review depends on a fast, complete questionnaire and a DPA without weird clauses.
- Customer-managed keys are not available today, though they said it's not a requirement.
- Total cost already exceeds $50,000 before implementation, which Priya flagged.
- Any software purchase over $40,000 requires CFO approval, and implementation fees count toward year-one TCV.
- Greg prefers one-year terms with new vendors and dislikes being locked in.
- Queuewise renewal plus keeping the sorter is not considered a truly equivalent competing option.
- Even a 100-seat partial rollout still exceeds $40,000 ($46,800) and still requires Greg's approval.
- Jon needs the vendor's data deletion to be within 30 days of contract end, not the 90-day default; he will raise it in the DPA comments.
- Deflekt EU region is a hard blocker as long as the region isn't live and SOC 2 doesn't cover it.
- Jon will not evaluate image understanding functionality because it is not generally available.
- Ticket summaries shouldn't slow down the main review — Jon wants them reviewed only after go-live.
- Greg is not expected to attend a vendor pricing call at this stage, so Joan is the primary customer-side attendee.
- Customer-side proof-of-concept timeline cannot extend past the end of May without missing the business case and notice deadlines.
- Jon is nervous about the four-week security review window and won't promise to complete it in time.
- Open question on whether the Rotterdam works council needs to be consulted — a potential compliance/procurement hurdle.
- Queuewise notice risk if the June 1 approval slips suggests timing/notice concerns.

#### Budget / timeline / authority
- Harbourline has set aside $50,000 for year one for this project, covering software plus any implementation.
- The budget sits in Priya's customer operations budget, and she pitched it to leadership.
- Priya has some flexibility on the $50k number but that is the figure she has been working with.
- Target go-live is around October 15 in Q4, two weeks before the November 1 change freeze.
- The Queuewise contract is believed to end December 31, giving a two-month overlap if they switch.
- Success measure Priya is judged on: reach 90% or better on the Pro SLA by year-end, up from 71% today.
- Priya is personally measured on the Pro SLA number, making her the key business sponsor with a concrete year-end target.
- Jon needs the integration plan specifically so he can present it to his manager, who acts as an internal approver.
- Procurement includes an internal security review led by Jon, which he says typically has milestones (he referenced 'week five of the review').
- Zendesk Suite was rejected two years ago on seat-count cost, indicating prior budget constraints on seat-based pricing.
- Dutch works council consultation, if required, would add an estimated four-to-six weeks to the timeline, based on Harbourline's prior WFM tool experience.
- Salesforce connector effort: two-to-three weeks elapsed, but only a few days of actual effort, mostly spent waiting on internal approvals.
- The EU data residency requirement is dictated by their DPO, who has been clear it is non-negotiable.
- Their vendor security review typically runs six to eight weeks, involving a 180-question questionnaire, SOC 2 review, DPO review of the DPA, and legal.
- Jon (Speaker 2) can approve the light review for the anonymized PoC himself without escalation.
- There is a target go-live around October, which constrains the security review timeline.
- An NDA must be in place before the vendor can share the SOC 2 report, pen test summary, and sub-processor list.
- The PoC decision criteria are routing accuracy of 85% or better on first assignment across 10,000 tickets.
- Professional tier lists at $45/agent/month annual, with a proposed $39/agent/month for this team.
- At 140 seats, $39/agent/month totals $65,520/year plus a $9,500 one-time implementation fee.
- Enterprise tier including SCIM lists at $52/agent/month; Dana will not quote Enterprise on the call but will provide options.
- Greg Hale is the CFO and the economic buyer; Priya recommends but Greg decides on the money.
- Capital and Vendor Review Committee meets first Tuesday monthly; next is June 1, then July 6.
- Business case must be submitted at least 5 business days before the committee, requiring a 3-year total cost, at least two competing quotes, and IT security sign-off.
- After committee approval, legal contracting takes about two weeks; signature would be mid-June if June 1 committee is met.
- Implementation typically takes six to eight weeks from signature to go-live, implying mid-August go-live.
- Economic buyer for approval is Greg, with the committee decision on June 1.
- Vendor-side business case is due May 24 and is the critical date for the vendor team.
- Jon's security review needs to be complete or have no blocking findings by May 24, and cannot be prioritized in parallel with the June 1 slip risk.
- Queuewise notice must go out by June 2 with 90 days written notice, otherwise it auto-renews for another full year.
- Go-live target moved to August 16, giving two weeks of overlap with Queuewise before its actual end date of August 31.
- Vendor team estimated six to eight weeks from mid-June contract signature, so June 1 committee cannot slip to July 6.
- SCIM inclusion and pricing is owned by the vendor's proposal (Me) and remains open.
- POC timeline: export ready Friday May 7, load Monday May 10, run through Thursday May 20, readout Friday May 21, leaving the weekend and Monday to finalize business case numbers.
- Vendor committed to return the security questionnaire within five business days to help Jon's May 24 deadline.
- SCIM pricing is still to be determined in the proposal.
- June 1 is the approval date referenced; approval slipping is a live concern.
- An approval committee exists, and Greg may or may not meet the vendor before it.
- Integration plan deadline is May 4.

#### Follow-up email
- Summarise Harbourline's setup: 120 agents across Columbus and Rotterdam, 38k tickets/month (55k at peak), 14 queues, four languages (EN/DE/NL/ES), Pro and Standard merchant tiers.
- Restate the pain numbers: ~18% misrouted first assignments, ~6 hours added per misroute, 71% Pro SLA attainment vs a 90% target, service credits paid twice this year.
- Confirm the stated budget context: $50,000 year-one budget in Priya's customer operations cost center, with flexibility.
- Confirm timeline: Q4 go-live targeting October 15, before the November 1–January 10 change freeze, aligned with Queuewise contract ending December 31.
- Note competitors in the mix: Deflekt (two calls done, $31/agent/month, no EU region yet) and the option to renew Queuewise / patch the sorter.
- Acknowledge Jon's integration concern about the two-engineer IT team and Routewell's commitment to have Marcus address integration scope.
- Note the open Zendesk plan question Jon said he can answer later.
- Reference the possible French language support next year tied to an unconfirmed Lyon hub.
- Confirm Harbourline's stack: Zendesk Support Professional (not Suite), Salesforce for merchant tier, and the cron-based Python sorter with ~340 rules slated for retirement.
- Restate Harbourline's success metrics: 90%+ Pro SLA, misroutes down from 18% to ~5%, and 11 team leads freed from ~11 hours/day of manual ticket moving.
- Summarize the integration effort story: Zendesk app is 1–2 hours for an admin; Salesforce connector is configuration, roughly 2–3 weeks elapsed, with the connected-app setup and field mapping done by a Salesforce admin.
- Commit to deliver the integration plan with named tasks and hours for Jon's manager, and confirm the Salesforce working session with Renata once bandwidth is checked.
- Document the change management approach that addresses Rotterdam's distrust: one-click agent override with reason captured, overrides feeding model, and confidence threshold (e.g. below 0.7) routing to a human triage queue.
- Note the works council (ondernemingsraad) open item and the team-level override reporting option Routewell can configure for Dutch customers.
- Recap the security requirements discussed: Okta SAML SSO enforced with local passwords disabled, and SCIM provisioning (currently Enterprise-tier only) to be addressed in the proposal.
- Flag the under-0.7-confidence threshold and initial auto-route rate expectation (60–70% at launch for logistics-style ticket mix) as part of rollout expectations.
- Recap that the team agreed to replace the live pilot with a scoped PoC on 10,000 anonymized historical tickets targeting 85% first-assignment accuracy.
- Note the PoC scope: 10,000 resolved tickets from a normal month, English and German, ~3 weeks, in isolated EU sandbox.
- Confirm action items: NDA template today, SOC 2/pen test/sub-processor list by April 28, security questionnaire by Thursday the 29th, 10,000-ticket export by Friday May 7.
- Note EU data residency: EU tickets processed and stored in Frankfurt including backups and classification model, with a US region in Virginia for US tickets.
- Flag the optional LLM ticket-summary sub-processor that defaults to US processing, with EU routing in limited availability — to be reviewed separately.
- Confirm SCIM is Enterprise-only and note we'll return with options for their offboarding/seasonal-turnover needs.
- Summarize the routing editor demo: policy examples, replay showing 212 tickets would route differently, publish permissions (team leads draft, ops admins publish), full audit logging, and a Zendesk sidebar panel showing predicted intent/con
- Recap 140 seats at $39/agent/month = $65,520/year plus $9,500 implementation fee.
- Note the two-year option (approximately $35/agent/month) and SCIM option as labelled alternatives in the proposal.
- Clarify the correct recipient: send the pricing proposal to Joan (copy Priya).
- Include next steps and deadlines: pricing proposal to Joan by Friday, April 30; security docs to Jon by Wednesday, April 28; integration plan by Tuesday, May 4.
- Provide the business case template and an approved example.
- Note the committee deadline of June 1 (business case due May 24).
- Meeting rescheduled to Thursday, May 6 at 3 PM Eastern (1 hour), replacing the original Tuesday May 4 slot.
- Integration plan due May 4 so Joan has a couple of days to review it before the May 6 meeting.
- Queuewise contract actually ends August 31 (signed two-year renewal on Sept 1), not December 31; notice must go out by June 2 to avoid a one-year auto-renewal.
- Go-live moved to Monday, August 16 to overlap two weeks with Queuewise before the contract ends.
- June 1 committee approval is now the critical vendor date, with the business case due May 24.
- Compressed POC: export by May 7, load May 10, readout Friday May 21; Joan to be added to the readout invite.
- Jon's security review needs to be complete or non-blocking by May 24; vendor commits to returning the questionnaire within five business days.
- Open items called out in the wrap: SCIM inclusion and price (vendor), US-side ticket summaries (parked post go-live), Dutch in POC, Rotterdam works council owner, Renata Salesforce bandwidth, and the Queuewise notice risk if approval slips.
- Vendor to follow up on the Queuewise notice terms with Joan by Friday April 30 and on the June 1 approval scenario as an open question.
- Priya confirmed the web form is the easiest channel to auto-route; chat will likely auto-route at the lowest rate; the model currently reads only attachment metadata, not image content.
- Joan is willing to join the POC readout and will feed the accuracy number directly into the business case.
- Jon's stated preference for a DPA retention change is 30 days after termination (customers have asked for shorter windows before, e.g. 30 days).
- Confirm the integration plan will be delivered by May 4.
- Confirm the next meeting is Thursday, May 6 at 3 PM Eastern.
- List open items: SCIM scope/pricing, US ticket summaries (parked post-go-live), Dutch in the POC, Rotterdam works council consultation ownership, Renata's Salesforce session bandwidth, Queuewise notice risk on slipped approval, and the June
- Note that Greg may or may not request a 15-minute vendor call before the committee; Joan will confirm.

#### Action items (structured)
- Marcus: Marcus (sales engineer) to join later and cover the product/technical side and what the integration involves on Harbourline's side.
- Target go-live around October 15, two weeks before the November 1 freeze [inferred]
- Peak season change freeze: November 1 through January 10, no changes to support tooling [inferred]
- Queuewise contract believed to end December 31 [inferred]
- Dana and Marcus: Draft an integration plan with named tasks and hours for each side that Jon can take to his manager.
- Dana: Set up a working session directly with Harbourline's Salesforce admin Renata so the integration work does not fall on Jon's engineers.
- Jon: Check Renata's bandwidth before scheduling the Salesforce working session, given she is mid-CPQ rollout.
- Dana: Look at how SCIM provisioning can be handled in the proposal and come back with options.
- Priya: Identify who at Harbourline owns the works council relationship and check whether AI routing needs an ondernemingsraad consultation. [inferred]
- Dana: Share the change management playbook and agent-facing materials along with the proposal
- Marcus: Send Jon the SOC 2 Type II report, pen test executive summary, and sub-processor list (deadline: Wednesday, April 28)
- Speaker 1: Ask legal team to send over the mutual NDA template today. (deadline: today)
- Jon (Speaker 2): Send the security questionnaire (about 180 questions) to the vendor by Thursday the 29th. (deadline: Thursday the 29th)
- Tomas: Tomas to pull the 10,000-ticket Zendesk export (ticket content, final queue, tags) with anonymization script. (deadline: Friday, May 7)
- Me: Look into how to handle SCIM in the proposal and return with options. [inferred]
- Marcus: Provide data residency and sub-processor details in writing.
- SOC 2 / pen test / sub-processor list by Wednesday, April 28 [inferred]
- Security questionnaire by Thursday, May 29 [inferred]
- 10,000 ticket export by Friday, May 7 [inferred]
- Speaker 2: Send the mutual NDA today
- Speaker 1 (me): Send a revised pricing proposal to Joan, copying Priya, based on 140 seats with Professional at $39, an SCIM option, the implementation fee, and a labelled two-year option (deadline: Friday, April 30)
- Marcus and Dana: Put together the integration plan with tasks and estimated hours for each side, including Salesforce connected app work with Renata (deadline: Tuesday, May 4)
- Speaker 2: Send the security questionnaire (deadline: Thursday, April 29)
- Tomas: Pull an export of 10,000 anonymized resolved tickets (English and German) (deadline: Friday, May 7) [inferred]
- Priya: Tell Tomas today so he can start before his days off
- Joan: Send the business case template and an example of a previously approved one (deadline: Monday, May 3)
- Dana and Priya: Co-write the business case with Joan, targeting the May 24 deadline for the June 1 committee (deadline: May 24)
- Speaker 2: Check with Renata whether she has bandwidth for a Salesforce working session.
- Priya: Check with HR in Rotterdam whether the works council needs a consultation [inferred]
- Business case due Monday, May 24 for June 1 committee [inferred]
- Next Capital and Vendor Review Committee Tuesday, June 1 [inferred]
- Following committee meeting July 6 [inferred]
- Me: Send the invite for Thursday, May 6 at 3 PM Eastern.
- Speaker 1 (Priya): Find out who owns the Rotterdam works council / HR consultation question.
- Speaker 3 (Joan): Check with procurement on Queuewise notice terms (letter format, signer, short extension option) and confirm by Friday, April 30. (deadline: Friday, April 30)
- Me: Set up the POC readout invite and add Joan.
- Vendor team: Deliver the integration plan by May 4. (deadline: May 4)
- Speaker 2 (Jon): Jon to prioritize the security review so it is complete or has no blocking findings by May 24. (deadline: May 24)
- Integration plan due [inferred]
- Proof of concept export ready [inferred]

#### Decisions (structured)
- Agreed to keep the works council consultation question as an open item to be resolved early. (owner: Dana)
- Dana will own drafting an integration plan with named tasks and hours, co-drafted with Marcus. (owner: Dana and Marcus)
- Agreed to no live pilot and instead a scoped proof of concept on historical anonymized tickets.
- PoC scoped to English and German for now, with Dutch possibly added later.
- Success bar for the PoC set at 85% routing accuracy on first assignment across the 10,000 tickets.
- Tomas (Speaker 1's ops analyst) will own pulling the Zendesk export instead of Jon's team, who are underwater with CPQ stuff.
- Summaries feature for EU/US sides left open; to be reviewed separately.
- Decided not to pursue a partial 100-seat rollout; will present the full 140-seat scope to Greg since it requires his approval regardless.
- Dana will send the pricing proposal to Joan (not Jon) and copy Priya.
- Next meeting moved from Tuesday, May 4 to Thursday, May 6 at 3 PM Eastern. (owner: Me)
- Go-live is moved from Q4 to Q3, set to Monday, August 16 to give two weeks of overlap with Queuewise. (owner: Speaker 1)
- Ticket summaries for the US side are parked until after go-live, not in the critical path. (owner: Speaker 1)
- Proof of concept compressed to load May 10, run through May 20, readout Friday May 21. (owner: Speaker 4)
- Vendor commits to turning the security questionnaire around within five business days of receiving it. (owner: Me)
- Jon will request a 30-day data deletion window instead of the 90-day default, noted in DPA comments. (owner: Speaker 2)
- Ticket summaries being used on the US side is parked until after go-live.
- Agreed to hold a follow-up meeting Thursday, May 6 at 3 PM Eastern.

#### Open questions (structured)
- What exact Zendesk plan is Harbourline on? [open]
- Does the AI routing tool's override data fall under Dutch works council (ondernemingsraad) consultation requirements? [open]
- Who at Harbourline owns the relationship with the works council? [open]
- Can SCIM provisioning be included given it is currently Enterprise-tier only? [open]
- How much work is the integration realistically for Jon's two engineers who are already underwater? [open]
- Whether the summaries feature will be on for the US side. [open]
- Whether Dutch and Spanish languages would be added to the PoC scope. [open]
- Whether the works council requires a consultation with HR in Rotterdam [open]
- Who in Rotterdam HR owns the works council consultation question. [open]
- Whether SCIM gets included and at what price in the proposal. [open]
- Whether Dutch gets added to the proof of concept. [open]
- Whether Renata has bandwidth for the Salesforce session. [open]
- What happens if the June 1 approval from Greg does not come through, given the notice deadline. [open]
- Whether Greg wants to meet the vendor before the committee. [open]
- What happens if the June 1 approval doesn't come through? [open]
- Whether the Rotterdam works council needs to be consulted, and who owns that? [open]
- Does Greg want to meet the vendor before the committee? [open]

#### Risks (structured)
- [high] Harbourline's IT team of only two engineers handles all internal tooling, so integration work is a real concern.
- [high] The custom sorter is a Python cron job on a small VM in their own data center running ~340 rules, some contradictory, written by an engineer who left two years ago.
- [high] Missed Pro one-hour SLA has already cost them service credits twice this year.
- [medium] Deflekt lacks an EU data residency region, which is a pause point given Rotterdam operations.
- [medium] November 1 to January 10 peak-season change freeze means any tooling must be live before November 1.
- [high] Pro SLA hit rate is only 71% and the company has already paid service credits twice this year.
- [high] Misrouting is the biggest single reason for SLA misses; more than half of misses are Pro merchant tickets landing in consumer queues due to sender/account mismatch or personal Gmail addresses.
- [high] Agents distrust anything automatic after being blamed for the sorter's misroutes; one visible AI mistake in week one could lose the team.
- [medium] Rotterdam team is skeptical, having had a bad experience with a workforce management tool that felt like surveillance.
- [medium] Dutch works council consultation could add four to six weeks to the timeline if required.
- [medium] Jon's IT team is only two engineers and already underwater, making the integration a capacity concern.
- [medium] SCIM provisioning, which matters for seasonal agent turnover offboarding, is only in the Enterprise tier.
- [medium] SCIM provisioning only included in Enterprise tier, which is a problem given the agent population's seasonal turnover.
- [high] Optional LLM-generated ticket summary sub-processor processes in the US by default, risking EU data residency.
- [high] Vendor security review typically takes six to eight weeks, which is tight for the October timeline.
- [low] Customer managed keys on roadmap but not available today.
- [low] The 10,000-ticket PoC may not have enough Dutch or Spanish examples.
- [medium] Greg is not a rubber stamp and has pushed back on a few tools this year.
- [medium] Greg generally prefers one-year terms with new vendors and doesn't like being locked in before a vendor has proven itself.
- [low] Renata's involvement in the Salesforce working session is uncertain due to CPQ workload.
- [high] Queuewise contract actually ends August 31, not December 31, and auto-renews for a year unless 90-day written notice goes out by June 2.
- [high] June 2 notice date falls the day after the June 1 committee, so it works only if Greg approves on June 1.
- [high] If Greg doesn't approve on June 1, the team has either renewed Queuewise for a year or has nothing on September 1.
- [medium] August 16 go-live is achievable only if the contract is signed by mid June, leaving little slack.
- [medium] Security review timeline is tight: four weeks, doable only if documents arrive on the 28th and the questionnaire returns within a week.
- [medium] Deflekt's EU region is currently a hard blocker for Jon; he won't plan on a vendor roadmap.
- [low] Greg may not attend a vendor pricing call at this stage.
- [medium] Queuewise notice risk if the June 1 approval slips.

#### Follow-up draft
Subject: Follow-up: Harbourline routing discovery call

Hi Priya and Jon,

Thanks for a genuinely useful session yesterday — much better than forty minutes of slides, and I appreciated how candid you both were about the sorter, the SLA misses, and the constraints on Jon's team.

What stuck with me is the picture you painted: 18% of tickets misrouted on first assignment, roughly six hours added each time, and a Pro one-hour SLA you're hitting about 71% of the time against a 90% goal — with more than half the misses being merchant tickets that landed in a consumer queue because the sender came in on a personal Gmail. Retiring the 340-rule sorter, freeing your 11 team leads from the hour a day they each spend moving tickets, and giving ops leads the ability to change routing policy without filing a ticket with Jon's two engineers is exactly the ground we should be standing on, and I'm glad we landed on a proof of concept over 10,000 anonymized historical tickets at an 85% first-assignment bar rather than a live pilot.

Marcus and I will have the integration plan to you by May 4 with named tasks and hours so you can walk your manager through the near-term effort honestly, and I'll come back on the SCIM inclusion and pricing in the proposal we're sending to Joan, copying you both.

The one thing I'd like to close the loop on early: does the Rotterdam works council need to be consulted here, and who on your side would own that conversation?

---

# Summary C

_(run1)_

### Title: Harbourline Ticket Routing Initiative

#### Overview
Harbourline described a 120-agent, two-site support operation where misrouting affects 18% of tickets, causes six-hour delays, and contributes to missing its Pro-merchant SLA; Priya has a $50,000 year-one budget and is targeting an October 15 go-live before the November 1 freeze. Harbourline confirmed its Support Professional/Zendesk, Salesforce, and 340-rule sorter setup, while Routewell addressed routing, integration effort, change management, works-council risk, and the SCIM Enterprise-tier limitation. The team agreed to replace a live pilot with a scoped proof of concept using 10,000 anonymized historical tickets, while defining security-document exchanges and a 10/ German-language success threshold. The team aligned on a full 140-seat proposal, identified Greg Hale as the CFO approver, mapped the June 1 review path, and assigned proposal, security, integration, NDA, data, and business-case follow-ups. The Queuewise contract was found to end August 31 rather than December 31, moving the target go-live to August 16 and making the June 1 approval and May 24 business case critical milestones. The team confirmed several unresolved approval and implementation questions, committed to delivering the integration plan by May 4, and scheduled the next meeting for May 6 at 3 PM Eastern. Key decisions: Dana and Marcus will draft an integration plan with named tasks and hours for each side.; The works-council consultation requirement in the Netherlands will remain an open item to investigate early.; The team agreed not to run a live pilot and instead to conduct a scoped proof of concept using anonymized historical tickets.. Buying signals: Priya confirmed the initiative is real, is on her plan for the year, and has dedicated year-one funding.

#### Summary
- Priya confirmed the initiative is real, is on her plan for the year, and has dedicated year-one funding.
- Harbourline described a 120-agent, two-site support operation where misrouting affects 18% of tickets, causes six-hour delays, and contributes to missing its Pro-merchant SLA; Priya has a $50,000 year-one budget and is targeting an October 
- Dana and Marcus will draft an integration plan with named tasks and hours for each side.
- The works-council consultation requirement in the Netherlands will remain an open item to investigate early.
- Deflekt does not currently offer an EU region, creating a data-residency concern for Harbourline's Rotterdam operation.

#### Account context
- Harbourline provides fulfillment and last-mile logistics for online retailers, serving both merchant brands and their end customers.
- The support operation handles merchant tickets from the brands that pay Harbourline as well as high-volume consumer delivery inquiries.
- Harbourline has approximately 120 agents split between Columbus and Rotterdam, with Rotterdam handling most European work.
- Tickets arrive through email, chat, and a tracking-page web form, representing approximately 62%, 25%, and 13% of volume respectively.
- Monthly ticket volume is about 38,000 in normal months and approximately 55,000 during November and December peak season.
- The current stack includes Zendesk, Salesforce for merchant accounts, Queuewise for tagging and language detection, and a custom script called the sorter for queue assignment.
- Tickets are routed into 14 queues based on region, language, merchant tier, claims, and carrier escalations.
- Harbourline currently supports English, German, Dutch, and Spanish, with English representing approximately 70% of volume.
- Harbourline runs Zendesk Support Professional rather than Suite, with Salesforce holding merchant-tier information and a cron-based Python sorter containing about 340 rules.
- Harbourline previously evaluated Zendesk Suite but stayed on Support Professional because Suite was too expensive for its seat count.
- The customer has two engineers, while the Salesforce administrator Renata sits in sales operations and is occupied with a CPQ rollout.
- The operation includes Columbus and Rotterdam teams, with 11 team leads spending about one hour per day manually moving tickets.
- Harbourline uses Okta for identity and requires SAML SSO with no local passwords.
- The customer uses Okta for all users and wants SAML SSO with local passwords disabled plus SCIM provisioning for automated offboarding.
- Rotterdam handles EU consumers and merchants, while US tickets would be handled in Virginia.
- The proposed proof of concept would use 10,000 resolved tickets from a normal month in an isolated EU sandbox.
- The proof of concept would compare routing accuracy against the customer's current 18% misroute rate and approximately 82% first-assignment accuracy.
- The customer has 140 support agents for the rest of the year, after converting seasonal agents to permanent staff in March.
- The intended implementation covers Zendesk and Salesforce across two regions.
- The customer currently uses Queuewise and an internally maintained sorter as comparison or baseline options.
- Joan Petrakis represents finance and FP&A, while Jon owns the security review and vendor-intake NDA process.
- Greg Hale chairs the Capital and Vendor Review Committee and is the CFO and financial decision maker.
- The Queuewise renewal is a two-year renewal signed September 1 two years ago, ending August 31 with automatic one-year renewal unless 90 days' written notice is provided.
- The customer needs the replacement live before Queuewise ends and is targeting two weeks of overlap before August 31.
- The next meeting will cover the proposal and integration plan, with Joan attending and Greg potentially participating later rather than in the vendor pricing call.
- The customer has US ticket summaries as a desired capability but is treating them as a post-go-live item.
- The customer processes damaged-parcel tickets with photos, and photo presence is useful as a claims signal even though image content is not analyzed.
- The account is coordinating approval, committee review, a proof of concept, Salesforce integration, and potential Rotterdam works council consultation.
- The proposed workflow includes ticket summaries for the US side, but that use is deferred until after go-live.
- A Salesforce session may depend on Renata's available bandwidth.

#### Pain points
- Routing is the primary operational pain because tickets can land in the wrong queue, remain unnoticed, and be moved only after merchant dissatisfaction has already increased.
- A February sample found approximately 18% of tickets were misrouted on their first assignment.
- A misrouted ticket adds approximately six hours before reaching the correct person and can take a full day when sent to Rotterdam after local working hours.
- Queuewise provides tagging and language detection but does not adequately solve routing, leaving the sorter responsible for queue assignment.
- The sorter runs only every five minutes as a cron job on a small data-center VM, introducing delay and infrastructure concerns.
- The sorter relies on approximately 340 keyword and ordering-sensitive rules that can contradict one another and are not fully understood.
- Routing changes typically take a couple of weeks because two engineers must edit, test, and deploy rules alongside their other internal-tooling responsibilities.
- More than half of Pro-SLA misses were traced to Pro-merchant tickets sitting in consumer queues because the merchant was not matched or used a personal Gmail address.
- The Pro one-hour SLA is being met only 71% of the time despite being contractually required.
- The largest source of SLA misses is misrouting Pro merchant tickets into consumer queues.
- Personal Gmail addresses prevent the current sorter from reliably matching tickets to merchant accounts.
- The existing sorter has grown into approximately 340 rules that are difficult to maintain.
- Team leads collectively spend about 11 hours each day manually moving tickets.
- Jon's team lacks capacity for a burdensome implementation, and he is particularly concerned about the short-term workload.
- Agents distrust automation because they have previously been blamed when the sorter routed tickets incorrectly.
- Seasonal turnover makes timely access removal and automated offboarding a significant customer need.
- The customer has a strict EU-residency requirement for Rotterdam data, including backups.
- The customer security review is burdensome because a 180-question questionnaire is handled alongside normal job responsibilities.
- The customer's current sorter has an approximately 18% misroute rate and about 82% first-assignment accuracy.
- Customer teams want visibility into why tickets were routed to build agent trust.
- The existing sorter is inconsistently logged and consumes engineering time.
- The customer needs agents to understand routing decisions so they can trust the system.
- A 100-seat partial rollout would leave half the team on the old routing process, which Priya described as difficult to manage.
- The do-nothing baseline includes service credits, 11 hours per day of team-lead time, and engineering time spent on the sorter.
- The customer needs a three-year cost analysis and a business case focused on hours and credits rather than only product features.
- The corrected Queuewise end date creates a compressed transition schedule and a risk of either a costly one-year bridge renewal or no replacement system.
- The four-week security review window is creating concern because the review must avoid blocking findings by May 24.
- Short chat conversations such as 'help' or 'where is it' are harder to classify and will likely route more often to human triage.
- The customer needs clarity on whether the Rotterdam works council must be consulted and who owns that check.
- The team lacks a confirmed contingency plan for what happens if June 1 approval is not received.
- Approval slippage may create a Queuewise notice risk.
- The team still needs clarity on works council obligations and ownership.

#### Buying signals
- Priya confirmed the initiative is real, is on her plan for the year, and has dedicated year-one funding.
- Priya has flexibility beyond the initial budget amount, although she is working toward a $50,000 year-one figure.
- Priya personally pitched the project to leadership and controls the relevant customer-operations budget.
- Harbourline is actively evaluating Deflekt and comparing that option with renewing Queuewise and patching the sorter.
- Harbourline has a defined target of reaching 90% or better performance on the Pro one-hour SLA by year-end.
- The desired October 15 go-live provides a concrete implementation target before the seasonal freeze.
- Priya said that allowing operations to update routing policies without filing IT tickets would be a major benefit.
- The tracking-number fallback for personal-email tickets directly addresses a major cause of Pro misses.
- Jon responded positively to policy replay and change-history controls.
- Priya found the high-confidence launch approach more acceptable than an immediate full automation switch.
- Harbourline is targeting at least 90% performance on the Pro SLA by year-end.
- Harbourline wants misroutes reduced from 18% to approximately 5%.
- The customer agreed that early delivery of security documents would materially help accelerate the review.
- The customer accepted a proof of concept as more useful than a live pilot because it would produce a business-case number.
- Jon said he could personally approve the lighter review for properly anonymized historical data.
- The customer accepted an 85% first-assignment accuracy target for the proof of concept.
- The customer responded positively to role-based publishing controls and routing explanations in the Zendesk sidebar.
- Priya said the routing explanation capability is particularly important for Rotterdam.
- Priya and Joan engaged directly on pricing, budget, approval authority, and committee timing.
- The customer agreed to present the full 140-seat scope to Greg rather than pursue a partial rollout.
- Priya said an August go-live would be acceptable because it remains ahead of the October target.
- Jon specifically identified the integration plan as the deliverable he needs most.
- Finance offered to help with the three-year cost portion of the business case.
- The customer agreed to a follow-up meeting to review the proposal and integration plan.
- The customer selected a specific August 16 go-live target rather than retaining a general Q3 objective.
- The customer is willing to prioritize the security review despite uncertainty about meeting the deadline.
- The customer accepted the compressed proof-of-concept schedule ending with a May 21 readout.
- The customer prefers a 30-day data deletion period after termination and will raise it in DPA comments.
- The customer requested the integration plan by a specific date, May 4.
- The group scheduled a follow-up meeting for May 6 at 3 PM Eastern.
- The team is considering a vendor meeting with Greg before the committee.

#### Objections
- Data residency is a significant evaluation concern because Deflekt does not yet have an EU region.
- Jon is concerned about any solution that requires substantial integration work from Harbourline's two-person engineering team.
- Harbourline is wary of vendor promises about future EU-region availability because other vendors have made similar promises before.
- Renewing Queuewise and continuing to patch the sorter remains an alternative, but Jon strongly dislikes taking on another patching cycle.
- Harbourline's agents liked Deflekt's interface and its quoted price was lower than expected, so Routewell will need to demonstrate sufficient value within the comparison.
- Jon is worried that implementation will create short-term work for his already overloaded engineering team.
- Priya fears that an early visible AI routing mistake would cause her to lose the team's trust.
- Rotterdam employees may perceive per-agent override reporting as employee surveillance.
- SCIM being limited to Enterprise is a concern because automated offboarding matters with seasonal agent turnover.
- The customer objected that SCIM being limited to Enterprise is unfavorable given the importance of offboarding.
- The customer requires written confirmation of EU processing and the vendor's sub-processor list.
- The customer pushed back on a live pilot because it would require a full security review and signed DPA before real customer data could be used.
- A Columbus-only live pilot would not test Rotterdam's language and residency requirements.
- Customer legal review could extend the timeline if the DPA contains unusual clauses.
- The proposed first-year price exceeds the approximately $50,000 budget Priya had been planning around.
- SCIM is required by Jon but is not included in the initial Professional-tier pricing discussed.
- A 100-seat option does not avoid CFO approval because it would still cost $46,800 annually before implementation.
- Greg may resist a two-year commitment because he prefers one-year terms with new vendors.
- The customer must provide at least two competing quotes, including Deflekt and a Queuewise-plus-sorter baseline.
- Deflekt is currently blocked because it lacks a live EU region covered by SOC 2, and the customer will not plan around a later vendor roadmap date.
- The customer does not want ticket summaries to delay the main review and will consider them only after go-live.
- Image understanding is not generally available and should not be included in the evaluation.
- The May 6 meeting time is late for Marcus at 9 PM Stockholm, although he agreed to attend.
- SCIM inclusion and pricing remain unresolved items in the proposal.
- The scope of the proof of concept remains uncertain because Dutch language support has not been decided.
- The Rotterdam works council consultation requirement and ownership are unresolved.

#### Budget / timeline / authority
- The year-one budget is $50,000 inclusive of software and implementation.
- The budget sits within customer operations and Priya is the person who pitched the initiative to leadership.
- The current target is a Q4 implementation with go-live around October 15.
- Support-tooling changes are prohibited from November 1 through January 10 because of peak-season change freeze.
- The October target is intended to allow approximately two weeks for stabilization before the November 1 freeze.
- The target timing is aligned with the expected December 31 end of the Queuewise contract, allowing a period of overlap.
- Deflekt quoted approximately $31 per agent per month.
- Priya's stated success criterion is increasing Pro-merchant first-response SLA attainment from 71% to at least 90% by year-end.
- Zendesk Suite was rejected two years ago because its cost was too high for Harbourline's seat count.
- The Zendesk native-app installation is estimated at one to two hours including testing.
- Salesforce configuration is estimated at two to three weeks elapsed, with only a few days of actual effort because approvals create waiting time.
- The Salesforce work requires a Salesforce administrator to create a connected app and map the account-tier and tracking-number fields.
- A works-council consultation, if required, previously took approximately four to six weeks for Harbourline's workforce-management tool.
- Jon wants security-review requirements addressed before the review reaches a late stage.
- The customer's desired security configuration includes Okta SAML SSO, disabled local passwords, and ideally SCIM provisioning.
- The normal vendor security review takes six to eight weeks and includes the questionnaire, SOC 2 review, DPA review by the DPO, and legal review.
- The customer said a four-week review might be possible if the questionnaire is returned quickly and completely and the DPA has no unusual clauses, but did not commit to four weeks.
- The review timeline is considered tight for October.
- Jon can approve the lighter review for a properly anonymized historical-data proof of concept.
- Only operations admins can publish routing changes, while team leads can draft them, and all publishes are logged.
- Professional pricing was offered at $39 per agent per month billed annually, resulting in $65,520 per year for 140 seats.
- The one-time implementation fee is $9,500 and covers Zendesk and Salesforce setup, model training on customer data, and change-management support.
- Enterprise pricing lists at $52 per agent per month and includes SCIM; Dana will provide options rather than quote Enterprise on the call.
- Purchases over $40,000 in year-one total contract value require Greg Hale's CFO approval, including implementation fees.
- The committee meets on the first Tuesday of each month, and the business case must be submitted at least five business days before the meeting.
- If the June 1 committee approves the purchase, legal contracting is expected to take approximately two weeks, implying a mid-June signature.
- Implementation is expected to take six to eight weeks from signature to go-live.
- The business case is due May 24 and is now the critical internal date ahead of the June 1 committee.
- Greg's approval is needed at the June 1 committee for the target schedule to remain viable.
- The Queuewise non-renewal notice must be sent by June 2, subject to procurement confirming the exact terms.
- Signing by mid-June supports an estimated six-to-eight-week implementation and makes August 16 achievable with limited slack.
- The team needs the security review completed or free of blocking findings by May 24 to support the business case.
- June 1 is the referenced approval date.
- The committee is part of the approval process, and Greg may or may not request a vendor call before it.
- The customer set May 4 as the deadline for the integration plan.

#### Follow-up email
- Recap that Harbourline supports both merchant brands and their end customers across a 120-agent Columbus and Rotterdam operation.
- Highlight the core routing problem: approximately 18% first-assignment misrouting adds about six hours on average and contributes to merchant dissatisfaction.
- Acknowledge the target of moving Pro-merchant SLA attainment from 71% today to at least 90% by year-end.
- Confirm the evaluation constraints of a $50,000 all-in year-one budget, an October 15 target go-live, and the November 1 through January 10 change freeze.
- State that the next technical conversation will cover routing, integration effort, and EU data residency.
- Summarize the current 71% Pro SLA attainment, the 90% year-end target, and the fact that misrouting accounts for more than half of the misses.
- Confirm that Harbourline is on Zendesk Support Professional, not Suite, and that Routewell would integrate with Salesforce and replace Queuewise tagging plus the cron sorter.
- Include the tracking-number fallback for personal email addresses as a key fit for Harbourline's logistics-ticket workflow.
- Provide the integration plan with estimated hours, responsibilities, the one-to-two-hour Zendesk setup, and the two-to-three-week elapsed Salesforce configuration timeline.
- Explain the cautious rollout approach using confidence thresholds, human triage for low-confidence tickets, agent overrides, and replay testing.
- Include the change-management playbook and the possibility of team-level-only override reporting for the Rotterdam and works-council concerns.
- State the success metrics of 90% or better Pro SLA attainment, reducing misroutes from 18% to about 5%, and eliminating roughly 11 hours per day of manual lead triage.
- Address Okta SAML SSO, disabled local passwords, SCIM's Enterprise-tier limitation, and Routewell's promised options for handling SCIM.
- Confirm that EU classification and routing data, including backups, remain in Frankfurt, while EU summaries must be disabled unless an EU endpoint is used.
- Include the requested SOC 2 Type II report, annual penetration-test executive summary, and sub-processor list once the NDA is in place.
- Recap that the live pilot was replaced by a historical-data proof of concept using 10,000 anonymized tickets in English and German.
- State the agreed proof-of-concept success criterion of at least 85% first-assignment routing accuracy.
- List the committed dates for the NDA, security questionnaire, security documents, and Zendesk export.
- Confirm the full 140-seat scope and the Professional price of $39 per agent per month, totaling $65,520 annually.
- Include the $9,500 implementation fee and describe its coverage of Zendesk, Salesforce, model training, and change management.
- Include an SCIM-enabled option and a clearly labelled two-year pricing option, while noting that a one-year term is more likely to fit Greg's preference.
- Explain that the purchase requires CFO approval and a June 1 committee review, with the business case due May 24.
- Frame the business case around three-year cost, service credits, 11 hours per day of team-lead time, and sorter-related engineering effort.
- List the agreed follow-up materials: security documents, integration plan, change-management playbook, and agent-facing materials.
- Confirm the revised timeline: May 4 integration plan, May 21 proof-of-concept readout, May 24 business case, June 1 committee, August 16 go-live, and August 31 Queuewise end date.
- Include the May 6 meeting at 3 PM Eastern and note that Joan will attend while Greg's participation remains to be confirmed.
- Summarize the compressed proof-of-concept schedule and the planned May 21 readout for inclusion in the business case.
- Record that US ticket summaries are deferred until after go-live and are not on the critical path.
- Record the proposed 30-day post-termination data deletion period for legal review and DPA comments.
- Flag the unresolved Queuewise notice decision if the June 1 approval is delayed, including the risk of a one-year renewal or no replacement on September 1.
- The follow-up should confirm delivery of the integration plan by May 4.
- The follow-up should include the next meeting time: Thursday, May 6 at 3 PM Eastern.
- The follow-up should recap the open items around SCIM pricing, US ticket summaries, Dutch in the proof of concept, works council consultation, Renata's Salesforce-session availability, and Greg's possible pre-committee call.
- The follow-up should note the unresolved contingency if June 1 approval does not come through and the related Queuewise notice risk.

#### Action items (structured)
- Marcus will join the discussion and explain the product's routing and the integration work required from Harbourline's side.
- Target go-live is around October 15, before the support-tooling change freeze beginning November 1. [inferred]
- The change freeze runs from November 1 through January 10. [inferred]
- Priya wants Pro-merchant SLA performance at 90% or better by the end of the year. [inferred]
- Dana and Marcus: Dana and Marcus will prepare an integration plan showing named tasks and hours for Harbourline and Routewell.
- Jon: Jon will check Renata's availability for a working session covering the Salesforce configuration.
- Priya / Harbourline: Harbourline should identify the Rotterdam HR contact responsible for determining whether the works council must be consulted. [inferred]
- Routewell: Routewell should provide its change-management playbook and agent-facing materials.
- Dana: Dana should include the team-level-only override reporting option in the follow-up materials.
- Routewell: Routewell will investigate options for meeting Harbourline's SCIM requirement and return with them in the proposal.
- Speaker 1: Speaker 1 will have the legal team send the mutual NDA. (deadline: today)
- Speaker 2: Speaker 2 will send the security questionnaire. (deadline: Thursday the 29th)
- Marcus: Marcus will provide the SOC 2 report, penetration-test summary, and sub-processor list after the NDA is signed. (deadline: Wednesday, April 28, assuming the NDA is signed by then)
- Tomas: Tomas will prepare a 10,000-ticket Zendesk export containing ticket content, final queue, and tags, using the anonymization script. (deadline: Friday, May 7)
- Dana: Send a revised pricing proposal to Joan, copying Priya, for 140 seats with Professional pricing at $39 per agent per month, an SCIM option, the $9,500 implementation fee, and a two-year option. (deadline: Friday, April 30)
- Marcus: Send the SOC 2 Type II report, pen test executive summary, and sub-processor list to Jon after the NDA is signed. (deadline: Wednesday, April 28)
- Dana and Marcus: Prepare and send an integration plan covering tasks and estimated hours for both sides, including Salesforce connected-app work with Renata. (deadline: Tuesday, May 4)
- Dana: Share the change-management playbook and agent-facing materials with the proposal.
- Jon: Send the mutual NDA using the vendor-intake template. (deadline: End of day)
- Jon: Send the security questionnaire. (deadline: Thursday, April 29)
- Tomas: Provide an export of 10,000 anonymized resolved tickets in English and German. (deadline: Friday, May 7)
- Joan: Send the committee business-case template and an approved example. (deadline: Monday, May 3)
- Dana and Priya: Co-write the business case, including the three-year cost analysis, for the May 24 submission deadline. (deadline: May 24)
- Jon: Ask Renata whether she has bandwidth for a Salesforce working session.
- Priya: Ask HR in Rotterdam whether a works council consultation is required. [inferred]
- Mutual NDA to be sent by end of day. [inferred]
- SOC 2, pen test summary, and sub-processor list due April 28 after NDA signature. [inferred]
- Security questionnaire due April 29. [inferred]
- Pricing proposal due April 30. [inferred]
- Business-case template and example due May 3. [inferred]
- Deliver the integration plan by May 4. (deadline: May 4)
- Anonymized ticket export due May 7. [inferred]
- Business case due May 24 for the June 1 committee meeting. [inferred]
- Me: Send the invite for the May 6 follow-up meeting at 3 PM Eastern. (deadline: May 6)
- Speaker 3: Check with procurement on the Queuewise notice format, signer, and whether a short extension is possible. (deadline: April 30)
- Me: Complete the proposal treatment of SCIM inclusion and pricing.
- Me: Turn around the security questionnaire within five business days after receiving it.
- Me: Set up the May 21 proof-of-concept readout invite and include Joan. (deadline: May 21)
- Speaker 3: Find out whether Greg wants a 15-minute vendor call before the committee.
- Integration plan due [inferred]

#### Decisions (structured)
- The evaluation will focus on Harbourline's routing needs and current workflow, with Marcus expected to cover the technical routing and integration details.
- The proposed solution should replace both Queuewise tagging and the cron-based sorter at cutover.
- Dana and Marcus will draft an integration plan with named tasks and hours for each side.
- The works-council consultation requirement in the Netherlands will remain an open item to investigate early.
- The team agreed not to run a live pilot and instead to conduct a scoped proof of concept using anonymized historical tickets.
- The proof of concept will initially cover English and German tickets, with Dutch potentially added later.
- The proof of concept success threshold is at least 85% first-assignment routing accuracy across 10,000 tickets.
- The proposal will use the full 140-seat scope rather than a partial 100-seat rollout.
- The pricing proposal will include both one-year and two-year term options, with the two-year option clearly labelled and not assumed to be approved.
- The next Capital and Vendor Review Committee target is June 1, with the business case due May 24.
- The follow-up proposal and integration-plan meeting was moved to Thursday, May 6 at 3 PM Eastern for one hour instead of Tuesday, May 4.
- US ticket summaries will be evaluated separately after go-live and will not be part of the critical path.
- The target go-live was moved from Q4 to Monday, August 16, before the Queuewise contract ends on August 31.
- The proof of concept was compressed to load data on May 10, run it through May 20, and hold the readout on May 21.
- The integration plan will be provided by May 4. (owner: Me)
- The group will meet again on Thursday, May 6 at 3 PM Eastern.

#### Open questions (structured)
- The exact Zendesk Suite plan in use was not confirmed. [open]
- Whether Harbourline will add French support next year remains unconfirmed. [open]
- The exact end date of the Queuewise contract needs confirmation because Harbourline believes it ends December 31. [open]
- Does Harbourline's per-agent override data trigger a Netherlands works-council consultation? [open]
- Who at Harbourline owns the relationship with the Rotterdam works council? [open]
- What options can Routewell offer for SCIM if Harbourline does not purchase Enterprise? [open]
- When can Renata, the Salesforce administrator, participate in an integration working session? [open]
- Whether SCIM provisioning can be included or otherwise handled in the proposal remains unresolved. [open]
- Whether ticket summaries should be enabled for the US region remains open for separate review. [open]
- Whether Dutch should be added to the proof of concept remains undecided. [open]
- Whether Greg will approve a two-year term or require a one-year term remains unresolved. [open]
- Whether HR in Rotterdam requires a works council consultation remains unresolved. [open]
- Whether Renata has bandwidth for the Salesforce working session is unresolved. [open]
- Who will check with HR in Rotterdam whether the works council requires consultation? [open]
- What happens if Greg does not approve on June 1, given the choice between renewing Queuewise for a year and having no system on September 1? [open]
- Whether the Queuewise non-renewal notice should be sent before Greg's approval is known remains undecided. [open]
- Whether a Lyon hub will happen and whether it would require French language support remains unknown. [open]
- What happens if the June 1 approval does not come through? [open]
- Will SCIM be included, and at what price? [open]
- Will ticket summaries be used on the US side after go-live? [open]
- Will Dutch be added to the proof of concept? [open]
- Does the Rotterdam works council need to be consulted, and who owns that? [open]
- Does Renata have bandwidth for the Salesforce session? [open]
- Does Greg want to meet the vendor before the committee? [open]

#### Risks (structured)
- [high] Deflekt does not currently offer an EU region, creating a data-residency concern for Harbourline's Rotterdam operation.
- [high] Harbourline's current sorter is a poorly understood Python script with around 340 potentially contradictory rules written by an engineer who left two years ago.
- [high] Only two engineers support all internal tooling, so a solution requiring substantial integration work is a significant concern.
- [high] Harbourline is currently achieving the contractual one-hour Pro-merchant SLA only 71% of the time and has paid service credits twice this year.
- [high] Harbourline's Pro one-hour SLA is contractually required but is currently achieved only 71% of the time, resulting in two service-credit payments this year.
- [high] More than half of SLA misses are caused by Pro merchant tickets being placed in consumer queues, often because of personal Gmail addresses.
- [high] Jon is concerned about short-term implementation effort because his two engineers are already overloaded.
- [high] Rotterdam agents are skeptical of automated tools because of a prior workforce-management experience that felt like surveillance.
- [high] A visible AI routing error during the first week could undermine Priya's credibility with the agent team.
- [high] A Netherlands works-council consultation could add approximately four to six weeks to the timeline.
- [high] SCIM is available only on Routewell's Enterprise tier, while automatic offboarding is important because Harbourline has seasonal agent turnover.
- [high] SCIM is only included in the Enterprise tier, creating a potential fit or commercial issue because seasonal agent turnover makes automated offboarding important.
- [high] The EU summary feature uses a US-based sub-processor by default, so summaries must be disabled for EU data unless limited-availability EU routing is used.
- [high] The customer security review normally takes six to eight weeks and may be tight for October.
- [high] A live pilot would require the full security review and signed DPA because it would involve real customer data.
- [high] The 140-seat first-year cost is $65,520 annually plus a $9,500 implementation fee, exceeding Priya's planned $50,000 budget.
- [high] Any software purchase over $40,000 in year-one total contract value requires CFO approval.
- [high] The business case must include three-year total cost, at least two competing quotes, and IT security sign-off or written confirmation from Jon.
- [high] Greg Hale has challenged several tools this year and is not expected to rubber-stamp the purchase.
- [medium] Greg generally prefers one-year terms with new vendors, which may limit acceptance of the lower-priced two-year option.
- [medium] Legal contracting typically takes about two weeks after committee approval, assuming there is no dispute over terms.
- [high] The June 1 approval is critical; if it slips to July 6, the August 16 go-live and Queuewise notice deadline cannot be met.
- [high] The security review must be complete or have no blocking findings by May 24, but Speaker 2 is nervous about completing it in four weeks.
- [high] Failure to approve by June 1 could force a one-year Queuewise renewal or leave the company without a replacement system on September 1.
- [high] Deflekt's lack of a live EU region with SOC 2 coverage is currently a hard blocker.
- [medium] Chat is expected to have the lowest auto-route rate because short conversations have lower confidence and are more likely to require human triage.
- [medium] A delay in approval could create a Queuewise notice risk.
- [medium] Failure to receive approval by June 1 has an unresolved impact.

#### Follow-up draft
Subject: Follow-up: Harbourline routing evaluation

Hi Priya,

Thank you for the thoughtful discussion about Harbourline’s Columbus and Rotterdam support operation. We aligned that reducing the 18% first-assignment misrouting rate—and the resulting six-hour delays—will be central to improving Pro-merchant SLA attainment from 71% to at least 90%, with a scoped 10,000-ticket English/German proof of concept and an integration plan from Dana and Marcus by May 4. We’ll continue the proposal and technical discussion on Thursday, May 6 at 3 PM Eastern, including the August 16 target and the full 140-seat scope.

The most important open question is whether Routewell’s EU data-residency approach, including Rotterdam data and backups, meets Harbourline’s requirements given the current lack of an EU region.

Best regards,
Routewell

---

# Summary D

_(run1)_

### Title: Support Routing Initiative and Timeline

#### Overview
Priya and Jon mapped Harbourline's 120-agent, two-site support operation and its routing and SLA problems, while confirming a $50,000 year-one initiative targeting an October 15 go-live and surfacing EU-data and integration constraints for the technical discussion. The team quantified a 71% Pro SLA and 18% misroute problem, identified tracking-number fallback and a guarded AI rollout as important, and agreed on an integration plan while Dutch works-council and SCIM requirements remained unresolved. The team replaced a proposed 60-day live pilot with an approximately three-week proof of concept on 10,000 anonymized historical tickets in an EU sandbox, scoped to English and German with an 85% first-assignment target, while scheduling security materials and the Zendesk export. The corrected 140-seat quote was $65,520 annually plus $9,500 implementation, so the purchase requires CFO review, and the team chose the full scope for a June 1 committee target. The team corrected Queuewise's expiry to August 31, set an August 16 go-live target, and compressed the POC to a May 21 readout so the May 24 business case can support the June 1 committee. The team catalogued unresolved approval, scope, governance, capacity, and notice-risk items; Me committed to provide the integration plan by May 4, and the group set a May 6 follow-up at 3 PM Eastern. Key decisions: The conversation will remain discovery-led, with Marcus joining for the product and technical portion to demonstrate routing against Harbourline's described workflow.; Harbourline is treating the routing project as a current-year initiative with $50,000 allocated for year one, including software and implementation.; Harbourline's working rollout plan is a Q4 go-live around October 15, leaving two weeks before the November 1 support-tooling freeze.. Buying signals: Priya said the routing initiative is real and on her plan for this year rather than merely exploratory.

#### Summary
- The meeting focused on the organization’s current-year routing initiative for its Columbus and Rotterdam support operation, aimed at reducing 18% first-assignment misrouting and improving Pro one-hour SLA attainment from 71% toward 90%.
- The organization confirmed the year-one budget and selected the full scope, while agreeing to a proof of concept using anonymized resolved tickets in an isolated sandbox, with English and German initially and an 85% first-assignment accuracy bar.
- The working deployment target is August 16 before Queuewise expires on August 31; EU data residency, the security review, SCIM, the Rotterdam works-council question, and June 1 approval remain material open constraints, while US ticket summaries are deferred until after go-live.

#### Account context
- Harbourline provides fulfillment and last-mile logistics for online retailers, mostly mid-size direct-to-consumer brands with some larger customers.
- Support handles two audiences: the merchant brands that pay Harbourline and those brands' end customers.
- Merchant tickets are retention-sensitive because slow responses can cost accounts, while consumer tickets drive high volume.
- The support organization has about 120 agents across Columbus and Rotterdam, with Rotterdam handling most of Europe.
- Tickets enter through email, chat, and a tracking-page web form, representing approximately 62%, 25%, and 13% of volume respectively.
- Monthly ticket volume is about 38,000 in normal months and 55,000 in November and December peak.
- The current stack combines Zendesk, Salesforce for merchant accounts, Queuewise for auto-tagging and language detection, and a custom script called the sorter.
- The sorter runs every five minutes in the data center, pulls new Zendesk tickets, reads Queuewise tags, applies keyword rules, and checks Salesforce merchant tier.
- Routing ends in 14 queues split by region, language, merchant tier, claims, and carrier escalations.
- The team supports English, German, Dutch, and Spanish, with English at about 70%, German at 12%, and Dutch and Spanish at roughly 9% each.
- French support is being considered next year if Harbourline opens a hub near Lyon, but that expansion is unconfirmed.
- Salesforce classifies merchants as Pro or Standard, with about 300 Pro accounts on a contractual one-hour first-response SLA; standard merchants and consumers have four business hours, and the internal resolution target is 48 hours.
- Harbourline uses Zendesk Support Professional rather than Suite; it reviewed Suite two years ago, found it too expensive for the seat count, and added Queuewise instead.
- The current merchant-tier workflow combines Salesforce with a cron-based Python sorter containing about 340 rules and Queuewise tagging.
- Priya runs customer operations, Jon owns IT and security, and Marcus Lindqvist is Routewell's sales engineer.
- Jon's team has two engineers who are already underwater, while the Salesforce administrator sits in sales ops rather than IT.
- The Salesforce administrator is Renata, whose availability is constrained by a CPQ rollout.
- The customer operates Columbus and Rotterdam teams with different adoption contexts: Columbus leads are mostly bought in, while Rotterdam is more skeptical.
- The security environment is Okta-based, with a requirement for SAML SSO for all users, no local passwords, and ideally SCIM provisioning.
- Routewell proposed a native Zendesk app and API connection plus a Salesforce connector to replace both Queuewise tagging and the cron sorter at cutover.
- The operating model has 11 team leads who each spend about an hour a day moving tickets manually.
- The routing use case is logistics-oriented and must recover merchant identity from an order or tracking number when the requester uses a personal address.
- Routewell described classifying each new ticket within seconds from its subject, body, attachment metadata, channel, and requester, then predicting intent, urgency, language, and sentiment.
- The proposed visual editor would shift routing from roughly 340 rules to about 20 or 30 policies maintained by operations.
- The customer uses Okta as its identity provider and requires SAML SSO for all users with local passwords disabled.
- Automated SCIM deprovisioning is important because the agent population has seasonal turnover.
- Rotterdam handles EU consumers and EU merchants, while US tickets are processed in a separate US region.
- The vendor review includes an approximately 180-question questionnaire, SOC 2 review, DPA review by the DPO, and legal review.
- The customer uses Zendesk and can export ticket content, final queue, and tags for the evaluation.
- Current routing performance is about 82% correct on first assignment, alongside an 18% misroute baseline.
- The proposed evaluation compares predicted routing with the final queue after manual ticket moves.
- A one-team evaluation around 25 agents in Columbus was discussed, but Rotterdam is also material to the use case.
- The desired proof-of-value report is broken down by queue, language, channel, and confidence threshold.
- Routing governance in the demonstrated product separates team-lead drafting from ops-admin publishing and logs each publish.
- Agents can be shown predicted intent, confidence, and the matched policy in the Zendesk sidebar.
- The support headcount is 140 agents for the rest of the year because seasonal agents became permanent in March.
- The proposed setup covers Zendesk and Salesforce in two regions, with model training on the customer's historical data included in implementation.
- The current comparison set is Deflekt plus a Queuewise renewal with the existing sorter, with the latter treated as a do-nothing baseline rather than an equivalent option.
- Priya is the internal recommender, Joan Petrakis represents finance and FP&A, and Greg Hale is the CFO who approves the spend.
- Jon owns the security review and vendor NDA routing under the new vendor-intake process.
- The data input for model training will be a 10,000-ticket anonymized resolved-ticket export in English and German.
- The Salesforce integration is expected to include connected-app work involving Renata.
- Rotterdam is a relevant region for the agent-facing routing explanation.
- The proposed publishing workflow lets team leads draft changes while only ops admins can publish them, with each publish logged.
- The account is building a three-year cost case for the proposed solution, and Priya said she needs substantial help with that calculation.
- A Salesforce working session is part of the integration planning, but Renata's availability is uncertain because her CPQ workload is heavy.
- The account has an unresolved Rotterdam works-council question, including whether consultation is required and who should own the check.
- The current Queuewise agreement is a two-year renewal signed on September 1 two years ago and ends August 31.
- Queuewise auto-renews for another full year unless the customer gives 90 days' written notice, putting the notice date at June 2.
- The use case includes damaged-parcel tickets with attached photos, and the evaluation considers chat and web-form channels.
- Web forms have a dropdown, while chat classification uses the full conversation through handoff and short chats can route to human triage.
- The service defaults to 24 months of retention for processed tickets and deletes customer data 90 days after contract end with a deletion certificate unless a shorter window is requested.
- A possible Lyon hub and French-language requirement are next-year possibilities rather than assumptions in the current scope.
- Greg's June 1 committee approval, procurement's notice review, Rotterdam HR's works-council input, and legal's DPA review are distinct stakeholder dependencies.
- The account has a November 1 freeze, but the corrected Queuewise expiry now drives an earlier Q3 deployment.
- The POC relies on a customer export, and its accuracy result is intended to feed the business case.
- US ticket summaries are a possible regional add-on that can be enabled later without re-implementation.
- A June 1 approval milestone is being tracked.
- A committee checkpoint is part of the approval process.
- Greg may meet the vendor before the committee, but that has not been confirmed.
- The rollout includes a US-side ticket-summary use case that is parked until after go-live.
- Dutch is being considered for the proof of concept.
- The Rotterdam works council is a potential stakeholder, with consultation and ownership unresolved.
- A Salesforce session is under consideration, subject to Renata's bandwidth.
- SCIM is a proposal scope item whose inclusion and price are unresolved.
- Queuewise is named in connection with a notice risk if approval slips.

#### Pain points
- Routing is the primary operational pain: tickets land in the wrong queue, wait, and are moved only after someone notices, leaving merchants angry.
- A February sample found approximately 18% of tickets were misrouted on first assignment.
- A misrouted ticket adds about six hours on average and can take a full day when it reaches Rotterdam after local staff have gone home.
- Queuewise provides tags and language detection but does not actually route, leaving the custom sorter to make assignment decisions.
- The sorter is a five-minute cron job on a small data-center VM that Jon said he does not like.
- The sorter has roughly 340 rules that nobody fully understands, with contradictions and order dependencies.
- The engineer who created the sorter left two years ago, creating a knowledge and maintenance gap.
- Routing changes require one of two shared internal-tooling engineers to edit and test rules, and typically take a couple of weeks to implement.
- The two engineers support all internal tooling, so substantial integration work from Harbourline is a stated concern.
- The Pro one-hour SLA is achieved only about 71% of the time despite being contractual, and Harbourline has paid service credits twice this year.
- More than half of Pro SLA misses come from Pro tickets placed in consumer queues when merchant matching fails or the sender uses a personal Gmail address.
- Priya's stated business need is to raise Pro SLA attainment from 71% to at least 90% by year-end.
- Priya is measured on reaching at least 90% Pro SLA by year-end, versus the current 71% rate.
- Misrouting is the biggest single SLA miss driver, with more than half of misses being Pro merchant tickets in consumer queues.
- The sorter fails to match the merchant when a requester uses a personal Gmail address, which is a recurring source of Pro misses.
- The sorter has grown organically to about 340 rules, adding complexity to routing maintenance.
- Eleven team leads spend about 11 leadership hours per day manually moving tickets.
- Two engineers are already underwater, making the short-term integration workload a material pain.
- Agents distrust automation because sorter errors have led them to be blamed for slow responses.
- Rotterdam is skeptical after a workforce-management tool felt like surveillance, while Priya fears one visible AI error could lose the team.
- Uncertainty over whether per-agent override data triggers a Dutch works-council process creates a potential rollout delay.
- Seasonal agent turnover makes automated offboarding important, but SCIM is only included in Enterprise.
- Jon does not want to add another service he must babysit and wants the security review to pass without surprises.
- SCIM being limited to Enterprise is a gap against the customer's seasonal-turnover offboarding need.
- EU data residency is non-negotiable for Rotterdam under the DPO's direction.
- EU ticket summaries create a residency concern because the default LLM subprocessor processes in the US.
- The customer's six-to-eight-week vendor review is tight against the October timing.
- The 180-question questionnaire and back-and-forth with vendors are the usual review bottleneck.
- A live pilot would add a full security-review and signed-DPA phase instead of saving time.
- A Columbus-only pilot would not test Rotterdam's languages or residency requirements.
- The current sorter leaves about 18% of tickets misrouted, versus about 82% correct on first assignment.
- Customer described the existing sorter as having changes logged in Git only sometimes, creating weaker auditability.
- Agents need visible routing reasoning to trust and understand their assignments.
- The customer needs a quantified business case rather than a pilot that merely exposes agents to the product.
- The existing sorter has an inconsistent audit trail because changes are only logged in Git sometimes.
- Agents need an explainability panel showing predicted intent, confidence, and the matched policy to trust routing assignments.
- The do-nothing path carries service credits, 11 hours a day of team-lead time, and engineering time on the sorter.
- A 100-seat rollout would leave half the team on old routing and be difficult to manage.
- The quoted 140-seat Professional subscription is $65,520 annually before the $9,500 implementation fee, far above the roughly $50,000 planning figure.
- The committee case must translate the proposal into three-year cost, competitor quotes, and security confirmation rather than feature detail alone.
- Renata's CPQ workload threatens availability for the Salesforce working session.
- The team still lacks an owner and answer for whether Rotterdam needs a works-council consultation.
- Priya needs substantial assistance to build the three-year cost portion of the business case.
- Renata's CPQ workload makes the timing of the Salesforce working session uncertain.
- The team does not yet know whether a Rotterdam works-council consultation is required or who should investigate it.
- The mistaken December 31 Queuewise end date was only corrected after the team checked the signed renewal, changing the deployment plan materially.
- The 90-day notice requirement and one-year auto-renewal create a hard commercial timing constraint around June 2.
- The August 16 go-live plan has little slack because the implementation estimate is six to eight weeks after signing.
- The security review is difficult to fit before May 24 because it depends on documents arriving on the 28th and the questionnaire returning within a week.
- Deflekt's missing live EU region with SOC 2 coverage is currently a hard blocker, and its later roadmap cannot be used for planning.
- Priya wants US ticket summaries, but the main review cannot be slowed down to evaluate them now.
- The model does not analyze attached image content, so damaged-parcel evaluation must rely on image metadata and ticket text.
- Short and messy chat tickets have lower confidence and are expected to produce the lowest auto-route rate of the three channels.
- Jon prefers a 30-day data-deletion window after termination instead of the default 90 days, making DPA approval a concern.
- SCIM inclusion and pricing are unresolved items that still need to be reflected in the proposal.
- The fallback if the June 1 approval does not come through is unresolved.
- SCIM inclusion and pricing are not yet settled.
- US-side ticket-summary use is deferred until after go-live.
- Dutch inclusion in the proof of concept is unresolved.
- The team has not established whether the Rotterdam works council must be consulted or who owns that work.
- Renata's available bandwidth for the Salesforce session is unknown.
- The Queuewise notice risk is tied to approval slippage.
- The integration plan was still a required deliverable with a May 4 target.
- Whether Greg will take a pre-committee vendor call is uncertain.

#### Buying signals
- Priya said the routing initiative is real and on her plan for this year rather than merely exploratory.
- Harbourline has set aside $50,000 for year one, covering software and implementation.
- Priya has some flexibility around the $50,000 working budget.
- The budget sits in customer operations, and Priya personally pitched the project to leadership.
- Harbourline is actively evaluating alternatives after two Deflekt calls while also considering Queuewise renewal and another sorter patch.
- Agents who saw the Deflekt demo liked its interface, making usability part of the active evaluation.
- Harbourline is working toward a Q4 deployment around October 15 before the freeze, with expected overlap against Queuewise.
- Priya explicitly values a listening-led vendor process after experiencing recent forty-minute slide presentations.
- Priya has a measurable success target of 90% or better on the Pro SLA by the end of the year.
- Priya identified reaching 90% or better on the Pro SLA by year-end as the primary success measure.
- Priya wants misroutes reduced from 18% to approximately 5%.
- The 11 hours per day of team-lead manual triage created a concrete business-case opportunity that Priya acknowledged.
- Priya specifically called the tracking-number fallback the capability Harbourline needs because half of the Pro misses involve personal emails.
- Priya said allowing operations team leads to change routing policies without IT tickets would be a major improvement.
- Jon responded positively to staged policy replay and change history after initially expressing concern about operations-managed policies.
- Jon said a direct working session with Renata would help, subject to checking her bandwidth.
- Jon explicitly requested an integration plan he could take to his manager.
- Priya found a high-confidence rollout with human triage more comfortable than switching all tickets to automation at once.
- Priya said Rotterdam would need the change-management playbook and agent-facing materials.
- Jon raised the security requirements proactively rather than waiting until the fifth week of review.
- Retiring the sorter and its VM is a stated success condition that aligns with Routewell's proposed replacement architecture.
- Speaker 2 proactively brought a standard security checklist to surface major requirements before the formal review progressed.
- SAML SSO with Okta and SSO-only enforcement are supported on all plans, matching a stated identity requirement.
- The customer identified disabling EU summaries as a viable path to keep EU classification and routing in Frankfurt.
- SOC 2 Type II meets the explicit compliance need, while ISO 27001 is only a nice-to-have.
- The customer accepted AWS KMS per region and said customer-managed keys are not required.
- The customer requested written residency details and the subprocessor list as part of its diligence.
- The customer agreed to send its security questionnaire by Thursday the 29th and its legal team will send a mutual NDA template today.
- Jon said he can approve a properly anonymized historical-data proof of concept himself.
- Both customer stakeholders agreed to the historical-ticket proof of concept instead of a live pilot.
- The customer set a clear 85% first-assignment accuracy bar against an approximately 82% current baseline.
- The customer assigned Tomas to produce the export and accepted the Friday, May 7 target.
- Speaker 1 expressed interest in summaries for agents on the US side if they do not complicate the review.
- Stakeholders engaged with the product demo by asking about publishing permissions and agent visibility into routing reasons.
- The replay showed that 212 tickets from the prior seven days would have routed differently, with individual cases available for inspection.
- The customer viewed publish auditability as better than the existing sorter.
- Priya reacted positively to the agent explanation panel and said Rotterdam would want it.
- Jon explicitly requested SCIM for the deployment.
- Priya actively requested pricing comparison with Deflekt and brought Joan from finance into the call.
- The customer chose to evaluate the full 140-seat scope rather than a partial rollout.
- A mid-August go-live resulting from the expected implementation window was considered acceptable for an October target.
- Jon said the integration plan was the item he most needed, indicating active implementation evaluation.
- Priya and Dana agreed to co-write the committee business case, with Joan offering help on the three-year cost.
- The customer requested a follow-up specifically to review the proposal and integration plan together.
- The team rescheduled rather than dropped the review and accepted a May 6 meeting at 3:00 PM Eastern despite the late Stockholm time.
- Jon committed to reading the integration plan, showing active engagement with the evaluation materials.
- Priya proposed an August 16 go-live with a two-week Queuewise overlap rather than renewing the incumbent for a year.
- Priya accepted the compressed POC schedule as tight but workable.
- Joan asked to join the POC readout because the accuracy result will go directly into the business case.
- Jon said he would prioritize the security review despite not being able to promise completion.
- Priya confirmed that simply knowing a damaged-parcel ticket has a photo is already useful for identifying likely claims.
- Jon left the door open to reconsider Deflekt if it delivers a live EU region with SOC 2 coverage.
- Joan is actively checking whether Greg wants a short vendor call before the committee, creating a possible path to involve the approver.
- The final request for the integration plan by May 4 shows that the customer is treating the material as necessary for the approval process.
- Me committed to address SCIM inclusion and pricing in the proposal.
- The group set a concrete integration-plan target of May 4, and Me committed to meet it.
- The possibility of a fifteen-minute vendor call with Greg before the committee is being actively checked.
- The group set a follow-up meeting for Thursday, May 6 at 3 PM Eastern.
- Dutch remains under consideration for the proof of concept.
- A Salesforce session remains under consideration, subject to Renata's availability.
- Speaker 1 gave explicit positive feedback, calling the session much better than forty minutes of slides.

#### Objections
- EU data residency is a direct evaluation concern because Deflekt has no EU region and its later-year availability promise is not trusted.
- Any solution requiring substantial integration work is a concern because only two engineers support all internal tooling.
- Renewing Queuewise and patching the sorter remains a status-quo alternative to replacing the current routing workflow.
- Deflekt's quoted $31 per agent per month creates a price benchmark because Priya viewed it as lower than expected.
- The November 1 through January 10 freeze constrains the implementation window and makes the October target operationally important.
- The complex handoff across Zendesk, Queuewise, Salesforce, 14 queues, and roughly 340 rules creates a significant fit and migration hurdle.
- A slide-heavy sales process would be poorly received because Priya specifically asked for listening after recent vendor calls focused on slides.
- Harbourline previously rejected Zendesk Suite because its price was too high for the seat count.
- Jon is nervous about allowing operations to change routing policies without IT involvement.
- The proposed long-term reduction in workload does not address Jon's concern about short-term implementation effort.
- Implementation requires pulling in a Salesforce administrator from sales ops while Jon's two engineers are already overloaded.
- Agents distrust automated routing because they have previously been blamed when the sorter made an incorrect routing decision.
- Rotterdam may resist the rollout because a prior workforce-management tool felt like surveillance.
- The possible ondernemingsraad consultation is an unresolved fit and timing concern because Harbourline does not yet know whether override data qualifies.
- SCIM provisioning being limited to Enterprise is not acceptable at face value because automated offboarding is important to Jon.
- Jon requires Routewell to retire the existing sorter and pass security review without adding a system that needs constant babysitting.
- A high-confidence launch would typically auto-route only 60% to 70% of logistics tickets, so it would not eliminate manual triage immediately.
- Customer objected that SCIM being Enterprise-only may not fit its offboarding needs.
- The customer requires EU data to remain in the EU because of a non-negotiable DPO requirement.
- The summary feature's default US subprocessor creates a residency objection unless the feature is disabled for EU data or routed to an EU endpoint.
- Customer requires written residency commitments and the subprocessor list before completing its review.
- The six-to-eight-week review is a timing objection because October is already tight.
- A four-week review cannot be promised because it depends on questionnaire completeness and DPA terms.
- Customer rejected the live pilot as a time-saving approach because real customer data would require the full security review and a signed DPA.
- The proposed Columbus pilot would not cover Rotterdam's language and residency requirements.
- Rotterdam may ask for Dutch and Spanish coverage, but the proposed 10,000-ticket sample may contain too few examples.
- The vendor's security-material delivery is conditional on the mutual NDA being signed.
- The customer deferred the summaries decision because enabling the feature could complicate the review.
- The 140-seat subscription is $65,520 annually plus $9,500 implementation, exceeding the roughly $50,000 budget Priya had been planning around.
- SCIM is wanted but sits in the Enterprise tier, which lists at $52, and Dana did not provide a final Enterprise quote during the call.
- The purchase exceeds the customer's current VP approval limit and must go to CFO Greg because the threshold is $40,000 including implementation.
- Greg generally prefers one-year terms with new vendors and may reject the two-year commitment needed for the potential lower price.
- A 100-seat option would still cost $46,800 annually, remain above the approval threshold, and leave part of the team on old routing.
- The committee requires at least two competing quotes, including a baseline that the customer does not view as equivalent.
- Legal contracting is expected to take about two weeks only if the vendor does not challenge the terms.
- Security materials cannot be sent until the NDA is signed, and the committee requires security approval or a written no-blocker confirmation.
- Deflekt's EU-region gap is a hard blocker unless the region is live and covered by SOC 2.
- Jon will not base the plan on Deflekt's later-in-the-year roadmap date.
- Image understanding is not generally available and therefore cannot be counted as part of the evaluation.
- Chat classification is a weaker fit for automatic routing because short conversations have lower confidence and the lowest expected auto-route rate.
- The preferred 30-day deletion period differs from the default 90-day post-termination deletion policy and still requires legal review.
- The security review may not finish with no blocking findings by May 24 because Jon described the timing as possible but would not promise it.
- The corrected Queuewise expiry creates a timing objection to the original Q4 go-live plan.
- The unresolved works-council requirement could affect the scope or schedule.
- Renata's CPQ workload creates uncertainty about when the Salesforce session can occur.
- SCIM may affect fit and price because its inclusion has not yet been determined.
- Greg will not attend a vendor pricing call at this stage, limiting direct access to the approver for now.
- The Queuewise notice format, signer, and availability of a short extension remain unresolved procurement concerns.
- The three-year cost component is a material business-case concern because Priya requested substantial help with it.
- SCIM's inclusion and price remain unresolved commercial terms.
- The June 1 approval contingency is a timing concern because the fallback is unspecified.
- The US ticket-summary decision is pushed past go-live.
- Potential Rotterdam works council consultation and unclear ownership remain a governance concern.
- Renata's availability creates uncertainty for the Salesforce session.
- Approval slippage carries a Queuewise notice risk.
- Greg's pre-committee vendor call is uncertain because he does not always request one.

#### Budget / timeline / authority
- The working year-one budget is $50,000 all-in for software and implementation.
- Priya said she has some flexibility around the $50,000 working number.
- The budget is held in customer operations, with Priya as the person who proposed the initiative to leadership.
- Jon is the technical and security stakeholder because he runs IT and security at Harbourline.
- The working timeline is Q4, targeting an October 15 go-live.
- Support tooling is frozen from November 1 through January 10, so the deployment is intended to settle before November 1.
- The team believes Queuewise ends on December 31 and expects a couple of months of overlap, but the date has not been confirmed.
- The primary business success criterion is improving the contractual Pro one-hour SLA from 71% today to at least 90% by year-end.
- Zendesk Suite was rejected two years ago because it was too expensive for the seat count.
- Priya's performance target is 90% or better on the Pro SLA by the end of the year.
- The Zendesk native app installation is estimated at one to two hours including testing, with an administrator granting API scopes.
- The Salesforce connector is configuration rather than code and is estimated at two to three weeks elapsed with only a few days of actual effort.
- Most of the Salesforce elapsed time is expected to come from approvals rather than hands-on configuration.
- Jon's two engineers are already overloaded, so the implementation plan must clearly separate work for IT, sales ops, and Routewell.
- Renata is the relevant Salesforce administrator but is currently engaged in a CPQ rollout, creating a scheduling dependency.
- Jon needs the integration plan to be suitable for taking to his manager, indicating a manager-level step in the internal evaluation path.
- A Dutch works-council consultation could add roughly four to six weeks based on Harbourline's prior workforce-management experience.
- The 11 hours per day of team-lead triage time provide a quantified basis for the business case.
- SAML SSO with Okta is supported on all plans, while SCIM provisioning is only included in Enterprise.
- Jon wants the major security requirements addressed before the fifth week of review rather than discovered late in procurement.
- SCIM is currently packaged only in the Enterprise tier, creating a packaging constraint even though no price was discussed.
- The customer normally allows six to eight weeks for its vendor security review.
- That six-to-eight-week duration is considered tight for October.
- A review closer to four weeks is possible but not committed and depends on a fast, complete questionnaire and acceptable DPA terms.
- The SOC 2 report, pen-test summary, and subprocessor list are due Wednesday, April 28 if the NDA is signed by then.
- The customer security questionnaire is expected by Thursday the 29th.
- Tomas's Zendesk export is expected by Friday, May 7, after his Monday and Tuesday vacation.
- The vendor estimated that the historical-ticket proof of concept typically runs for about three weeks.
- Jon can personally approve the lighter-review proof of concept if the historical data is properly anonymized.
- The DPO has authority over the customer's EU-residency requirement and has made it non-negotiable.
- The demonstrated routing workflow gives team leads drafting authority and limits publishing authority to ops admins.
- The Professional tier lists at $45 per agent per month billed annually, while Dana offered $39 per agent per month for this team.
- The corrected pricing basis is 140 seats, not the earlier 120-seat estimate.
- At $39 per agent per month, 140 seats produce $65,520 in annual subscription cost.
- The one-time $9,500 implementation fee covers Zendesk and Salesforce setup, model training on customer data, and change-management support.
- The Enterprise tier includes SCIM and lists at $52, but Dana planned to provide options rather than quote Enterprise during the call.
- Priya's roughly $50,000 planning figure was based on the approximately $22,000 Queuewise renewal, estimated sorter engineering time, and headroom.
- Any software purchase above $40,000 in first-year total contract value, including implementation, requires CFO approval because the VP limit changed in January.
- Greg Hale is the CFO, chairs the Capital and Vendor Review Committee, and is the economic buyer for the spend.
- The committee meets on the first Tuesday of each month; the next meeting is June 1, with the business case due May 24, and the following meeting is July 6.
- The committee business case must include three-year total cost, at least two competing quotes, and IT-security sign-off or Jon's written confirmation of no blocking findings.
- After committee approval, legal contracting is expected to take about two weeks, which would put signature around mid-June if the June 1 meeting is used.
- Implementation is expected to take six to eight weeks from signature to go-live for Zendesk, Salesforce, two regions, and historical-data model training, making mid-August go-live feasible for October.
- Greg generally prefers a one-year term, while a two-year term could potentially lower the per-agent price to around $35.
- The business case must include a three-year cost analysis, with Joan helping on that portion.
- SCIM inclusion and price remain proposal-level commercial decisions.
- The integration plan is due May 4 and will be reviewed in the follow-up meeting.
- The follow-up meeting is scheduled for Thursday, May 6 at 3:00 PM Eastern for one hour.
- The POC timeline is export May 7, load May 10, run through May 20, and readout May 21.
- The May 21 accuracy readout must feed the business case due May 24.
- Jon's security review must be complete or have no blocking findings by May 24 for the business case timeline to hold.
- The June 1 committee is the critical approval date, with Greg's approval explicitly identified as necessary.
- Queuewise non-renewal notice must be issued by June 2 or the agreement auto-renews for another full year.
- The contract needs to be signed by mid-June to allow the estimated six-to-eight-week implementation window.
- The target go-live is August 16, two weeks before the corrected Queuewise end date of August 31.
- A July 6 committee date would be too late for the August 16 go-live and too late for the Queuewise notice deadline.
- The November 1 freeze was the original business driver, but the corrected Queuewise expiry now requires the deployment to happen in Q3.
- Procurement is still determining the notice form, signer, and any short-extension option, while legal will review the preferred DPA retention term.
- June 1 is the approval milestone being tested for a fallback scenario.
- The approval process includes a committee checkpoint.
- Greg's participation in a vendor call before the committee is still uncertain.
- SCIM pricing is unresolved and will be handled in the proposal.
- The integration plan has a May 4 delivery commitment.
- The next meeting is set for Thursday, May 6 at 3 PM Eastern.
- US ticket-summary use is intentionally timed for after go-live.
- Whether Rotterdam works council consultation is required, and who owns it, remains unresolved.
- The Salesforce session's timing depends on whether Renata has bandwidth.

#### Follow-up email
- Thank Priya and Jon for the listening-first discovery conversation and acknowledge that the discussion avoided a slide-heavy vendor presentation.
- Recap that Harbourline supports both paying merchant brands and their end customers through about 120 agents in Columbus and Rotterdam.
- Include the quantified routing and SLA pain: approximately 18% first-assignment misrouting, about six hours of added delay, 71% Pro SLA attainment, and a 90% year-end target.
- Mention the current Zendesk, Salesforce, Queuewise, and custom-sorter architecture, including the roughly 340 rules and the limited two-engineer capacity.
- State the commercial and timing context: $50,000 allocated for year one, a target around October 15, the November 1 through January 10 freeze, and a believed December 31 Queuewise end date.
- Call out EU data residency and regional hosting as a required technical discussion because Rotterdam is central to the operation and Deflekt lacks an EU region.
- Close with the agreed next steps: Marcus will demonstrate routing, explain integration requirements, and address EU data considerations.
- The email should recap the baseline and goals: 71% Pro one-hour SLA today, at least 90% by year-end, and reducing misroutes from 18% to approximately 5%.
- The email should explain that more than half of SLA misses are Pro tickets in consumer queues because of merchant-matching failures or personal Gmail addresses.
- The email should call out that tracking-number fallback was the key requested capability for resolving personal-email cases.
- The email should summarize the current stack as Zendesk Support Professional, Salesforce merchant-tier data, Queuewise, and a roughly 340-rule cron-based Python sorter.
- The email should describe the proposed native Zendesk/API and Salesforce integration, including the reduction from 340 rules to roughly 20 or 30 visual routing policies.
- The email should include the estimated integration effort of one to two hours for Zendesk and two to three weeks elapsed for Salesforce configuration, mostly waiting on approvals.
- The email should confirm that Dana and Marcus will provide a named-task integration plan with hours for each side so Jon can take it to his manager.
- The email should explain the rollout safeguards: role-based permissions, change history and replay, one-click agent overrides, and human triage below the confidence threshold.
- The email should offer the change-management playbook and agent-facing materials, noting that Rotterdam would need specific support because of its prior surveillance concern.
- The email should flag the unresolved Dutch works-council question, the possible four-to-six-week consultation, and the team-level-only override-reporting option for HR review.
- The email should clarify that Okta SAML SSO is supported on all plans while SCIM is Enterprise-only, and that Dana will return with proposal options.
- The email should note that Jon will check Renata's availability for a Salesforce working session and Priya will identify the Rotterdam HR contact.
- Thank the customer for surfacing the identity, residency, compliance, and review requirements before the formal security process.
- Confirm that Okta SAML SSO with enforced SSO-only access is supported on all plans, while SCIM is currently included only in Enterprise and options are being investigated.
- Confirm that EU tickets, backups, classification, and routing remain in Frankfurt, and explain that disabling EU summaries keeps EU data in region.
- Include the summary-feature subprocessor caveat and the requested subprocessor list in writing.
- Summarize the compliance package: SOC 2 Type II covering the twelve months ending January 31, the February penetration test, and the executive summary available under NDA.
- Recap the encryption controls as AES-256 at rest, TLS 1.2 or higher in transit, and AWS KMS per region, noting that customer-managed keys are not required.
- Recap the document exchange: customer legal sends the NDA today, Jon sends the questionnaire Thursday the 29th, and Marcus sends the security materials Wednesday, April 28 after NDA signature.
- Set expectations that a four-week security review is possible but not guaranteed and depends on a fast, complete questionnaire and acceptable DPA terms.
- Recap the agreement to replace the live pilot with an anonymized historical-ticket proof of concept in an isolated EU sandbox without production integration.
- State the proof-of-concept scope and success criteria: 10,000 resolved tickets from a normal month, English and German for now, approximately three weeks, and at least 85% first-assignment accuracy.
- Record Tomas as the export owner with a Friday, May 7 due date and note that the open follow-ups are US summary enablement and possible Dutch or Spanish coverage.
- Confirm the corrected scope and math: 140 seats at $39 per agent per month equals $65,520 annually, plus the $9,500 implementation fee.
- Explain that the proposal will include a SCIM-capable option and both one-year and two-year terms, with the two-year term clearly marked as optional.
- State that the team chose the full 140-seat scope rather than a 100-seat partial rollout.
- Summarize the approval path: June 1 committee, May 24 business-case deadline, three-year cost, two competing quotes, and security sign-off or a no-blocker confirmation.
- Note that Greg Hale is the CFO and economic buyer and generally prefers one-year terms with new vendors.
- List the security deliverables and dates, noting that the NDA must be signed before the SOC 2, pen-test, and sub-processor materials are sent.
- Include the integration-plan delivery date of May 4 and the 10,000-ticket English/German export date of May 7.
- Reinforce the product value with the replay result of 212 differently routed tickets, explainability for agents, and publish audit logging.
- Call out the remaining open items: Renata's Salesforce-session availability, the Rotterdam works-council question, and the conditional legal timeline.
- State that the proposal and integration-plan review is now Thursday, May 6 at 3:00 PM Eastern for one hour, with Joan attending and Greg not expected on the vendor pricing call at this stage.
- Correct the Queuewise contract date to August 31 and explain that 90-day non-renewal notice is due by June 2 to avoid a full-year auto-renewal.
- Summarize the critical timeline: May 24 business case, June 1 committee, June 2 Queuewise notice deadline, mid-June signature, August 16 go-live, and August 31 Queuewise expiry.
- Include the compressed POC plan of May 7 export, May 10 load, May 20 completion, and May 21 readout, with Joan included because accuracy feeds the business case.
- Confirm that the security review must have no blocking findings by May 24 and that the questionnaire will be returned within five business days of receipt.
- Note that Joan will confirm Queuewise notice format, signer, and short-extension options with procurement by Friday, April 30.
- Record the preferred 30-day post-termination deletion period as a DPA comment pending legal review, compared with the default 90-day deletion policy.
- List the remaining scope items: SCIM inclusion and price, Dutch in the POC, the Rotterdam works-council question, and Renata's Salesforce-session availability.
- Clarify that US ticket summaries are intentionally deferred until after go-live and are not on the critical path.
- Set expectations that current image processing uses attachment metadata rather than image content and that chat is expected to have the lowest auto-route rate.
- Mention that Joan will find out whether Greg wants a short vendor call before the June 1 committee.
- The email should say that SCIM inclusion and pricing remain open and will be addressed in the proposal.
- The email should record the open question about what happens if the June 1 approval does not come through.
- The email should note the Queuewise notice risk if approval slips.
- The email should state that US-side ticket summaries are parked until after go-live.
- The email should list Dutch inclusion in the proof of concept as unresolved.
- The email should list the Rotterdam works council consultation and ownership question.
- The email should note that Renata's Salesforce-session bandwidth is still unconfirmed.
- The email should note that Joan will check whether Greg wants a fifteen-minute vendor call before the committee.
- The email should confirm the integration plan commitment for May 4.
- The email should confirm the Thursday, May 6 at 3 PM Eastern follow-up.
- The email may acknowledge the positive feedback that the session was much better than forty minutes of slides.

#### Action items (structured)
- Marcus: Marcus will join later in the session for the product and technical discussion and show how Routewell's routing works against Harbourline's described workflow. (deadline: later in this meeting)
- Marcus: Marcus will cover what the integration actually involves on Harbourline's side.
- Dana Whitfield: Dana will address EU data considerations, given Rotterdam's role in the operation.
- Dana Whitfield: Dana will keep the discussion focused on listening rather than a slide-heavy presentation.
- The technical stack review should confirm Harbourline's exact Zendesk plan. [inferred]
- Target go-live is around October 15, with two weeks to settle before the freeze. [inferred]
- No support-tooling changes are allowed from November 1 through January 10. [inferred]
- The Queuewise contract is believed to end December 31, with a planned period of overlap. [inferred]
- Priya wants Pro one-hour SLA attainment to reach 90% or better by the end of the year. [inferred]
- Dana and Marcus: Dana and Marcus will draft the integration plan with named tasks and hours for each side.
- Jon: Jon will check Renata's bandwidth for a direct Salesforce working session while she is handling the CPQ rollout.
- Priya: Priya will identify the appropriate Rotterdam HR contact and determine whether an ondernemingsraad consultation is required.
- Dana: Dana will investigate how to handle SCIM in the proposal and return with options.
- Routewell offered to share its change-management playbook and agent-facing materials for the Rotterdam rollout. [inferred]
- Harbourline HR and the works council should assess whether team-level-only override reporting changes the consultation determination. [inferred]
- Me: Investigate how SCIM can be handled and return options in the proposal.
- Marcus: Provide written confirmation of the EU data-residency and summary-processing behavior together with the subprocessor list.
- Speaker 1: Send the mutual NDA template through the customer legal team. (deadline: today)
- Jon: Send the customer security questionnaire. (deadline: Thursday the 29th)
- Marcus: Send the SOC 2 report, pen-test summary, and subprocessor list. (deadline: Wednesday, April 28, assuming the NDA is signed by then)
- Tomas: Produce the anonymized 10,000-ticket Zendesk export containing ticket content, final queue, and tags. (deadline: Friday, May 7)
- Review the ticket-summary configuration separately rather than deciding it in this meeting.
- Run the agreed historical-ticket proof of concept and deliver routing results by queue, language, channel, and confidence threshold. [inferred]
- Jon: Jon will send the security questionnaire. (deadline: Thursday the 29th)
- Marcus: Marcus to send the SOC 2 report, pen-test summary, and subprocessor list if the NDA is signed (deadline: Wednesday, April 28) [inferred]
- Tomas: Tomas to complete the anonymized 10,000-ticket Zendesk export (deadline: Friday, May 7) [inferred]
- Dana: Dana will send Joan, copying Priya, a revised 140-seat pricing proposal with Professional at $39 per agent per month, a SCIM option, the $9,500 implementation fee, and a clearly labeled two-year option. (deadline: Friday, April 30)
- Dana: Dana will send the change-management playbook and agent-facing materials with the pricing proposal.
- Marcus: Marcus will send Jon the SOC 2 Type II report, pen-test executive summary, and sub-processor list after the NDA is signed. (deadline: Wednesday, April 28, once the NDA is signed)
- Dana and Marcus: Dana and Marcus will prepare an integration plan with tasks and estimated hours for both sides, including Salesforce connected-app work with Renata. (deadline: Tuesday, May 4)
- Jon: Jon will send the mutual NDA using the current vendor-intake template. (deadline: Today, before end of day)
- Tomas: Tomas will provide an export of 10,000 anonymized resolved tickets in English and German. (deadline: Friday, May 7)
- Priya: Priya will tell Tomas about the ticket export so he can start before his days off. (deadline: Today)
- Joan: Joan will send the committee's business-case template and an example of an approved case. (deadline: Monday, May 3)
- Dana and Priya: Dana and Priya will co-write the business case for the June 1 committee. (deadline: May 24 for the June 1 committee)
- Joan: Joan will help with the three-year cost portion of the business case.
- Jon: Jon will ask Renata whether she has bandwidth for a Salesforce working session.
- Priya: Priya will ask around to identify who should check with Rotterdam HR about a possible works-council consultation.
- Obtain IT-security sign-off or Jon's written confirmation that there are no blocking findings for the committee submission. [inferred]
- Joan: Help Priya with the three-year cost analysis.

#### Decisions (structured)
- The conversation will remain discovery-led, with Marcus joining for the product and technical portion to demonstrate routing against Harbourline's described workflow.
- Harbourline is treating the routing project as a current-year initiative with $50,000 allocated for year one, including software and implementation.
- Harbourline's working rollout plan is a Q4 go-live around October 15, leaving two weeks before the November 1 support-tooling freeze.
- A named integration plan with tasks and hours for each side will be drafted by Dana and Marcus so Jon can take it to his manager. (owner: Dana and Marcus)
- The Dutch works-council applicability question will remain an open item and be checked early.
- The decision on enabling ticket summaries was deferred to a separate review rather than made in this call.
- The customer confirmed that customer-managed encryption keys are not required.
- The team agreed to use a scoped proof of concept on anonymized historical tickets instead of a live pilot.
- The selected proof of concept will use anonymized historical data in an isolated EU-region sandbox with no live agents or production integration.
- The proof-of-concept dataset will be 10,000 resolved tickets from a normal month rather than a peak month.
- The initial proof-of-concept language scope will remain English and German, with Dutch potentially considered later.
- The agreed proof-of-concept success bar is at least 85% first-assignment routing accuracy across the 10,000-ticket set.
- Tomas will own the Zendesk export instead of Jon's overloaded team.
- The pricing and committee case will use the corrected 140-seat scope rather than 120 seats.
- The team agreed not to pursue a 100-seat partial rollout and to take the full scope to Greg.
- The team is targeting the June 1 Capital and Vendor Review Committee with a May 24 business-case submission.
- The proposal will include both one-year and two-year terms, with the two-year term clearly labeled as an option.
- Pricing will be sent to Joan with Priya copied, while Jon will receive the security documents.
- Jon, rather than Priya, will route the mutual NDA under the new vendor-intake process.
- The proposal and integration-plan follow-up was moved to Thursday, May 6 at 3:00 PM Eastern for one hour, replacing the May 4 slot.
- US ticket summaries will be handled separately after go-live and kept out of the critical path.
- The target go-live was moved into Q3 to Monday, August 16, before Queuewise expires on August 31, with two weeks of overlap.
- The proof of concept was compressed to load on May 10, run through May 20, and read out on May 21, assuming the export arrives on May 7.
- Joan will attend the May 21 readout because the accuracy result feeds directly into the business case.
- Image understanding will not be counted in the evaluation because it is not generally available; current processing will use attachment metadata.
- The June 1 approval-failure scenario was explicitly captured as an open question.
- Use of ticket summaries on the US side was parked until after go-live.
- The next group meeting was set for Thursday, May 6 at 3 PM Eastern.

#### Open questions (structured)
- Which exact Zendesk plan is Harbourline using? [open]
- What integration work would be required from Harbourline's two internal engineers? [open]
- Can the evaluated solution meet Harbourline's EU data-residency needs for the Rotterdam operation? [open]
- What is the exact end date of the Queuewise contract? [open]
- Will Harbourline open a hub near Lyon and add French support next year? [open]
- Will per-agent override data make the Routewell rollout subject to Dutch ondernemingsraad consultation? [open]
- Who is the specific Rotterdam HR contact responsible for checking the works-council requirement? [open]
- Could team-level-only override reporting change the answer about whether consultation is required? [open]
- What SCIM and automated-offboarding option can Routewell offer if Harbourline does not use the Enterprise tier? [open]
- Will Renata be available to join the proposed Salesforce integration working session during the CPQ rollout? [open]
- What percentage of Harbourline's tickets would auto-route at a high confidence threshold at launch? [open]
- What exact short-term integration effort and hours will Harbourline need to provide beyond the estimated connector work? [open]
- What SCIM option can satisfy automated offboarding if the customer does not select the Enterprise tier? [open]
- Will summaries be enabled for US tickets, and will EU summaries be disabled or routed through the limited-availability EU endpoint? [open]
- Can the security review approach four weeks, given the 180-question questionnaire, DPA review, and legal review? [open]
- Will Dutch and/or Spanish be added to the proof of concept after the initial English and German scope? [open]
- What DPA clauses, if any, could extend the review timeline? [open]
- Whether HR in Rotterdam must be consulted by the works council, and who owns that check, remains unresolved. [open]
- Whether Renata has bandwidth and when the Salesforce working session can happen is unresolved. [open]
- Whether Greg will accept a two-year term or require a one-year term remains unresolved. [open]
- Whether the customer will select the SCIM-capable Enterprise option and what final price will be quoted remains unresolved. [open]
- Whether Jon's security review will produce blocking findings or a written no-blocker confirmation remains unresolved. [open]
- Whether legal can complete contracting in roughly two weeks after committee approval without term pushback remains conditional. [open]
- Who in Rotterdam HR owns determining whether a works-council consultation is required? [open]
- Will Renata have bandwidth for the Salesforce working session, and when could it happen? [open]
- Will SCIM be included, and at what price? [open]
- Whether Dutch will be added to the proof of concept remains undecided. [open]
- Must the Queuewise non-renewal notice be a letter, who must sign it, and is a short extension available instead of a full-year renewal? [open]
- If Greg does not approve on June 1, should the team send the notice anyway, renew Queuewise for a year, or accept having no replacement on September 1? [open]
- Will Greg want a vendor call before the committee? [open]
- Will the Lyon hub happen and create a French-language requirement next year? [open]
- Will the US ticket-summary feature actually be enabled after go-live? [open]
- Will legal accept the preferred 30-day post-termination deletion window? [open]
- What happens if the June 1 approval does not come through? [open]
- Whether SCIM will be included and at what price in the proposal remains open. [open]
- Whether ticket summaries will ultimately be used on the US side remains parked until after go-live. [open]
- Whether Renata has bandwidth for the Salesforce session remains unknown. [open]
- Whether Greg wants to meet the vendor before the committee remains open. [open]

#### Risks (structured)
- [high] Approximately 18% of tickets are misrouted on first assignment, adding about six hours on average and sometimes a full day before reaching the right person.
- [high] Pro first-response SLA attainment is 71% against a contractual one-hour target, and Harbourline has paid service credits twice this year.
- [high] More than half of Pro SLA misses involve Pro tickets sitting in consumer queues because merchant matching fails or the sender uses a personal Gmail address.
- [high] The custom sorter has roughly 340 partially understood, sometimes contradictory rules, and the engineer who created it left two years ago.
- [medium] Routing changes depend on two engineers who support all internal tooling and typically take a couple of weeks to implement.
- [medium] EU data residency is a material evaluation risk because Deflekt has no EU region and Jon is skeptical of its later-year availability promise.
- [high] The November 1 through January 10 support-tooling freeze creates a hard constraint on any deployment after the planned October window.
- [medium] The Queuewise contract end date is uncertain because Priya said the team only believes it ends on December 31.
- [high] The contractual Pro one-hour SLA is currently achieved only about 71% of the time, and the customer has already paid service credits twice this year.
- [high] Misrouting sends Pro merchant tickets to consumer queues, especially when personal Gmail addresses prevent reliable account matching, driving more than half of the SLA misses.
- [high] Short-term implementation could overburden the two already-underwater engineers and depends on a separate Salesforce administrator and approval process.
- [high] A visible AI routing error could deepen agent distrust and cause the rollout to lose Priya's team, particularly in skeptical Rotterdam.
- [high] A Dutch works-council consultation could delay the rollout by roughly four to six weeks if override data is considered usable for individual employee evaluation.
- [high] SCIM is only included in Enterprise while seasonal agent turnover makes automatic offboarding important, creating a security and plan-fit risk.
- [high] Jon will reject the fit if Routewell adds another system that requires ongoing babysitting or creates surprises during security review.
- [medium] Allowing operations to change routing policies without IT is valuable to Priya but initially makes Jon nervous, so governance controls must be credible.
- [medium] A cautious high-confidence launch would typically auto-route only 60% to 70% of logistics tickets, leaving a substantial human-triage workload initially.
- [medium] The prior decision to avoid Zendesk Suite because of seat-count cost indicates that commercial affordability remains a potential constraint.
- [high] SCIM being limited to Enterprise may leave a gap against the customer's seasonal-turnover offboarding requirement.
- [high] The default US processing of the summary feature's LLM subprocessor could violate the customer's EU-residency requirement unless EU summaries are disabled or routed to an EU endpoint.
- [high] The six-to-eight-week vendor review creates a material risk to the October timing.
- [medium] A four-week review is not guaranteed and depends on a fast, complete questionnaire and a DPA without problematic clauses.
- [high] A live pilot would require the full security review and a signed DPA, so it would add a phase rather than shorten the path.
- [high] The lighter review for the proof of concept depends on removing names, emails, addresses, and phone numbers from the historical data.
- [medium] A 10,000-ticket sample may contain too few Dutch or Spanish examples to satisfy Rotterdam's language-validation needs.
- [medium] The vendor's security materials are gated on the mutual NDA being signed.
- [high] The 140-seat subscription plus implementation is above Priya's roughly $50,000 planning budget and triggers the greater-than-$40,000 CFO approval rule.
- [high] Greg is not a rubber stamp and has pushed back on several tools this year, creating approval risk.
- [medium] The SCIM requirement may increase price because the Enterprise tier lists at $52, while no final Enterprise quote was given on the call.
- [medium] Security paperwork is gated on the signed NDA, and committee approval requires security sign-off or written confirmation of no blocking findings.
- [medium] Legal could take longer than roughly two weeks if the vendor contests contract terms.
- [medium] Greg's one-year preference may prevent the potential two-year price reduction to around $35 per agent.
- [medium] Renata's CPQ workload may delay the Salesforce working session.
- [medium] The unknown Rotterdam works-council requirement could add a process dependency before rollout.
- [medium] The committee requires a three-year total cost and at least two competing quotes, so the business case cannot rely only on feature differentiation.
- [medium] A partial rollout would leave half the team on old routing and create a management mess, making it a weak lower-cost fallback.
- [high] If Greg does not approve on June 1, the team has no decided contingency between a full-year Queuewise renewal and having no replacement system on September 1.
- [high] The August 16 go-live has little schedule slack because signing by mid-June allows only six to eight weeks of implementation, and a July 6 decision would be too late.
- [high] The security review may miss the May 24 business-case deadline because Jon requires documents on the 28th and a completed questionnaire within a week, and he would not promise completion.
- [high] Deflekt is a hard blocker because its EU region is not yet live with SOC 2 coverage, and its later roadmap date cannot support the plan.

#### Follow-up draft
Subject: Harbourline support routing

Hi Priya and Jon,

Thank you for the thoughtful, listening-first conversation about Harbourline’s Columbus and Rotterdam support operation. We aligned on addressing the brittle 340-rule sorter and personal-email merchant-matching failures with tracking-number fallback and explainable, governed routing, with the goal of reducing first-assignment misrouting from 18% and moving Pro one-hour SLA attainment from 71% toward 90% by year-end. The team selected the full 140-seat scope and agreed on a roughly three-week proof of concept rather than a live pilot, using 10,000 anonymized English and German resolved tickets in an isolated EU sandbox with an 85% first-assignment accuracy bar; the working August 16 go-live remains ahead of Queuewise’s August 31 expiry. We’ll keep the evaluation practical and evidence-led, with the integration plan due May 4 and the proposal review set for Thursday, May 6 at 3:00 PM Eastern. Can the remaining EU-residency, SCIM, and Rotterdam works-council requirements be cleared in time for the June 1 committee?

Best regards,
Dana

---

# Summary E

_(run1)_

### Title: Queuewise Zendesk Routing Proposal

#### Overview
Harbourline described a 120-agent, multi-region support operation where misrouting causes SLA failures, and confirmed a $50,000 year-one budget with an October 15 target ahead of a November 1 freeze. Harbourline described its SLA and routing gaps, evaluated Routewell’s Zendesk/Salesforce integration and rollout controls, and raised works-council timing and SCIM availability as key implementation risks. The customer clarified security and residency requirements, agreed to a historical-ticket proof of concept instead of a live pilot, and set initial owners and dates for security documents and a 10,000-ticket export. The team corrected scope to 140 seats, identified Greg Hale as the CFO approver, agreed to pursue the full deployment, and assigned detailed pricing, security, integration, and business-case follow-ups. The Queuewise contract was found to end August 31 rather than December 31, moving the target go-live to August 16 and making the June 1 approval committee and May 24 business case critical milestones. The group confirmed several open approval and implementation questions, committed to an integration plan by May 4, and scheduled the next meeting for May 6 at 3 PM Eastern. Key decisions: The team will treat Harbourline's environment as Zendesk Support Professional rather than Zendesk Suite, with Queuewise and the existing cron-based sorter in scope for replacement.; The proposed cutover plan is for Routewell to replace Queuewise tagging and the cron-based sorter, with the cron job turned off at cutover.; The parties agreed to keep the Dutch works-council consultation requirement as an open item to investigate early.. Buying signals: Priya confirmed the initiative is real and included on her plan for the year rather than being a casual exploration.

#### Summary
- The meeting focused on replacing the existing tagging and cron-based sorter in Zendesk Support Professional, with an August 16 go-live targeted before the current tool ends on August 31.
- The team agreed on a staged, high-confidence rollout with human triage for uncertain tickets and a proof of concept using anonymized English and German tickets, targeting at least 85% first-assignment accuracy.
- The proposal will address EU data residency, SCIM options, integration effort, the Dutch works-council consultation question, approval timing, budget, security review duration, EU processing requirements, and renewal notice risks.

#### Account context
- Harbourline provides fulfillment and last-mile logistics for online retailers, primarily mid-size direct-to-consumer brands and some larger customers.
- The support organization handles both paying merchant inquiries and end-consumer delivery issues on behalf of merchants.
- Harbourline has about 120 agents split between Columbus and Rotterdam, with Rotterdam handling most of Europe.
- Monthly ticket volume is approximately 38,000 in normal months and 55,000 during November and December peak.
- Tickets arrive through email, chat, and a tracking-page web form, representing approximately 62%, 25%, and 13% of volume respectively.
- The current stack includes Zendesk, Salesforce for merchant accounts, Queuewise for tagging and language detection, and a custom script called the sorter for queue assignment.
- The sorter runs every five minutes as a Python cron job on a small VM in Harbourline's data center.
- Tickets are routed into 14 queues based on region, language, merchant tier, claims, and carrier escalations.
- Harbourline currently supports English, German, Dutch, and Spanish, with English representing about 70% of volume.
- Pro merchants comprise approximately 300 accounts and have contractual service-level commitments.
- Harbourline uses Zendesk Support Professional rather than Suite, Salesforce for merchant tier data, Queuewise, and a cron-based Python sorter with approximately 340 rules.
- The customer has two engineers who are already overloaded, while Salesforce administration sits with a separate sales-operations administrator named Renata.
- The workflow routes logistics and merchant tickets using account tier, requester information, and tracking-number data.
- Harbourline has 11 team leads, each spending approximately one hour per day manually moving tickets.
- The customer operates teams in Columbus and Rotterdam, with different levels of change-readiness.
- The customer uses Okta for identity and requires SAML SSO for all users with local passwords disabled.
- The customer's agent population has seasonal turnover, making automated access removal important.
- Rotterdam handles EU consumers and merchants, while US tickets are handled through the US region.
- The proposed EU processing location is Frankfurt, including regional storage, backups, and classification-model processing.
- The customer's current sorter has an approximately 18% misroute rate and about 82% first-assignment accuracy.
- The proposed proof of concept will use 10,000 resolved tickets from a normal, non-peak month.
- The ticket export must include ticket content, final queue, and tags and will come from Zendesk.
- The routing editor supports draft-versus-publish permissions, publish audit logs, replay analysis, and agent-facing explanations in the Zendesk sidebar.
- The corrected deployment scope is 140 support-agent seats for the rest of the year, after seasonal agents became permanent in March.
- Joan Petrakis participates from finance and FP&A, while Jon owns the security review and Priya is the internal recommender.
- The proposed setup covers Zendesk and Salesforce across two regions.
- The implementation includes model training on the customer's historical data.
- The customer's competing baseline is Deflekt plus either a Queuewise renewal or retaining the sorter.
- The internal routing environment includes Queuewise and an existing sorter, with the sorter sometimes logged in Git.
- The customer's historical ticket data for evaluation will include 10,000 anonymized resolved tickets in English and German.
- The customer currently relies on Queuewise, whose renewed contract ends August 31 and auto-renews for another full year unless notice is given 90 days in advance.
- The target replacement go-live is August 16, leaving approximately two weeks of overlap before Queuewise ends.
- The buying process includes a June 1 committee and requires Greg's approval.
- The business case is due May 24 and will incorporate the proof-of-concept accuracy result.
- The proof of concept is planned around an export arriving May 7, loading May 10, processing through May 20, and a May 21 readout.
- The customer has separate regional requirements, including US ticket summaries and a possible future Lyon hub with French-language needs.
- The evaluation involves a proof of concept, a Salesforce session, an integration plan, and a committee approval process.
- The account has Rotterdam-specific governance considerations involving a possible works council consultation.
- The customer is considering SCIM, ticket summaries, Dutch-language support, and Salesforce integration as part of the implementation scope.

#### Pain points
- Routing is the primary operational pain because tickets often land in the wrong queue, wait for manual discovery, and reach the correct team only after merchant dissatisfaction has begun.
- Approximately 18% of tickets were misrouted on first assignment in a February sample.
- A misrouted ticket adds roughly six hours before reaching the right person and can take a full day when it lands in Rotterdam after hours.
- Queuewise provides tags and language detection but does not adequately perform routing, leaving the custom sorter responsible for assignment.
- The sorter has around 340 rules that nobody fully understands, with contradictions and order dependencies.
- Routing changes typically take a couple of weeks because two shared internal-tooling engineers must edit, test, and deploy the rules.
- The person who originally wrote the sorter left Harbourline two years ago, increasing maintenance difficulty.
- Harbourline misses the Pro-merchant one-hour first-response SLA frequently, achieving it only 71% of the time.
- Harbourline has paid service credits twice this year because of SLA performance.
- More than half of the Pro-SLA misses are associated with Pro tickets being placed in consumer queues due to merchant matching failures or personal Gmail senders.
- The Pro one-hour SLA is achieved only 71% of the time despite being contractually required, resulting in service credits twice this year.
- Misrouting is the largest single cause of SLA misses, with more than half involving Pro merchant tickets placed in consumer queues.
- Personal Gmail addresses prevent reliable merchant matching and account-tier identification.
- The existing sorter has grown to approximately 340 rules and is difficult to maintain through the current workflow.
- Manual ticket movement consumes approximately 11 hours of leadership time every day.
- Agents distrust automatic routing because they have previously been blamed when the sorter routed tickets incorrectly.
- Rotterdam's prior experience with a workforce-management tool created concern that employee-related data could feel like surveillance.
- Jon wants to retire the sorter and its VM rather than add another system requiring ongoing babysitting.
- The customer needs automated SCIM offboarding because seasonal agent turnover makes manual access removal risky.
- The customer's DPO requires EU consumer and merchant data to remain in the EU without exceptions.
- The default US processing of the summary sub-processor creates a data-residency gap for EU tickets.
- The customer needs written confirmation of regional processing and the vendor's sub-processor list for review.
- The customer's current routing performance is approximately 82% on first assignment, leaving a measurable accuracy gap.
- The customer needs a business-case metric that is more useful than a general live-pilot experience.
- The customer wants agents to understand why tickets were routed to them to build trust in the system.
- The existing sorter consumes engineering time and contributes to the cost of the do-nothing option.
- The current process consumes 11 hours per day of team-lead time.
- A 100-seat rollout would leave half the team on old routing, which Priya described as difficult to manage.
- The customer needs agents to understand routing decisions through predicted intent, confidence, and matched policy details.
- Rotterdam stakeholders specifically want agent-visible routing reasoning.
- The customer wants to compare the proposal against Deflekt's pricing and a rough $50,000 internal budget.
- Greg responds more strongly to quantified hours and service credits than to feature descriptions.
- The corrected Queuewise end date creates a compressed transition schedule and eliminates the option of waiting until Q4 for go-live.
- The customer needs to avoid renewing Queuewise for a full year merely to bridge a short implementation gap.
- The business case and security review have to be completed on an accelerated schedule before the June committee.
- Short chat messages such as 'help' or 'where is it' are harder to classify and are expected to route to human triage more often.
- The customer has damaged-parcel tickets with photos, but image content is not currently analyzed by the model.
- The customer needs a defined post-termination data-deletion period and prefers 30 days rather than the default 90 days.
- Uncertainty around the June 1 approval creates concern about downstream impact if approval slips.
- The team still lacks clarity on whether the Rotterdam works council must be consulted and who will handle it.
- Potentially limited internal bandwidth may affect scheduling the Salesforce session with Renata.

#### Buying signals
- Priya confirmed the initiative is real and included on her plan for the year rather than being a casual exploration.
- Harbourline has allocated $50,000 for year one including software and implementation.
- Priya said she has some flexibility above the working budget figure.
- Priya personally pitched the initiative to leadership and owns the budget in customer operations.
- Harbourline has a defined target to go live around October 15 before the November 1 change freeze.
- The target timing aligns with the anticipated December 31 Queuewise contract end, allowing a potential overlap period.
- Harbourline is actively evaluating Deflekt after two calls and is also considering renewing Queuewise with another sorter patch.
- The agents who saw Deflekt's demo liked its interface, indicating user-level appeal for a competing solution.
- Priya defined success as improving Pro-SLA attainment from 71% to at least 90% by year-end.
- Priya identified tracking-number fallback for personal-email tickets as exactly the capability Harbourline needs.
- Priya said that allowing operations to change routing policies without IT tickets would be a major benefit.
- Jon responded positively to staged policy replay and the ability to preview the effect of changes before publishing.
- Priya found a high-threshold rollout with human triage for uncertain tickets more comfortable than an immediate full switch.
- Jon requested a concrete integration plan that he could take to his manager.
- Harbourline's desired outcomes include improving Pro SLA attainment to at least 90%, reducing misroutes from 18% to approximately 5%, and eliminating manual triage work.
- The customer is proactively reviewing major security requirements early to avoid discovering blockers late in the evaluation.
- The customer accepted the vendor's Frankfurt regional-processing explanation for classification and routing, subject to documentation.
- The customer said SOC 2 Type II satisfies the primary compliance requirement, while ISO 27001 would be a desirable extra.
- The customer agreed that early delivery of review documents would materially help shorten the security process.
- The customer approved the historical-data proof of concept as a lighter-review alternative and said Jon could approve it himself if the data is properly anonymized.
- The customer and vendor jointly agreed on a measurable 85% routing-accuracy target.
- The customer accepted a 10,000-ticket initial scope and assigned an internal resource to produce the export.
- The customer responded positively to the routing editor's governance and audit capabilities.
- Priya said the agent-facing routing explanation was particularly valuable for Rotterdam.
- The customer brought Joan from finance into the pricing discussion to address approval questions.
- The customer agreed to present the full 140-seat scope to Greg rather than pursue a partial rollout.
- Priya accepted that the proposed mid-August go-live would still be acceptable for an October target.
- Joan offered to help with the three-year cost portion of the business case.
- Jon said the integration plan was the deliverable he most needed.
- The customer agreed to supply a large bilingual historical-ticket dataset for evaluation and model training.
- The customer proposed a specific August 16 go-live date and accepted the need to move the project into Q3.
- The customer accepted the compressed proof-of-concept schedule ending with a May 21 readout.
- Joan requested inclusion in the readout because the accuracy result feeds directly into the business case.
- The customer is willing to prioritize a security review despite concern about the four-week timeline.
- The customer agreed to put the preferred 30-day data-retention term into DPA comments.
- The customer confirmed that ticket summaries are desired, even though deployment will be deferred until after go-live.
- The customer requested an integration plan by May 4.
- The parties scheduled a follow-up meeting for May 6 at 3 PM Eastern.
- The group is actively preparing for committee review and considering whether Greg should meet the vendor beforehand.
- The customer described the session as more useful than a standard slide presentation.

#### Objections
- EU data residency is a stated concern, especially because Rotterdam supports most of Europe.
- Deflekt's lack of an EU region is a concern despite its claim that one is coming later in the year.
- Harbourline is skeptical of vendor promises about future EU regions because it has heard similar promises before.
- Integration workload is a major fit concern because Jon's two engineers support all internal tooling rather than only routing.
- The fallback option of renewing Queuewise and patching the sorter remains under consideration.
- The evaluation budget is capped around a working $50,000 year-one figure, although Priya indicated limited flexibility.
- Jon is concerned about the short-term implementation burden despite the claimed long-term reduction in maintenance.
- Jon is concerned that allowing operations to maintain routing policies could create governance risk, even though role-based permissions and change history were offered.
- Priya is concerned that one visible AI routing error during the first week would undermine team trust.
- Rotterdam's skepticism may slow adoption because of a previous workforce-management experience perceived as surveillance.
- Harbourline is concerned that per-agent override reporting could trigger a Dutch works-council consultation.
- SCIM being limited to Enterprise is a security and procurement concern because Harbourline needs automated offboarding.
- The customer objected that SCIM being limited to Enterprise may not fit its offboarding requirements.
- The customer raised a strict objection to any EU data leaving the EU, especially through the summary feature's default US sub-processor.
- The customer deferred a decision on enabling summaries for US tickets because the feature could complicate the review.
- The customer does not require customer-managed encryption keys, so their absence today is not an objection.
- The customer pushed back on a live pilot because it would require the full review and signed DPA before using real customer data.
- The customer questioned whether English and German alone would satisfy Rotterdam's needs for Dutch and Spanish coverage.
- The customer objected that the proposal was already above $50,000 before implementation.
- SCIM is required by Jon but is not included in the Professional-tier price discussed.
- A two-year term may conflict with Greg's preference for a one-year commitment with new vendors.
- The 100-seat alternative was rejected as operationally unattractive because it would leave half the team on old routing.
- The do-nothing or Queuewise-plus-sorter option is not viewed by Priya as equivalent, although finance will accept it as a baseline.
- Security materials cannot be delivered until the NDA is signed.
- Deflekt is a hard blocker because its EU region is not currently live with SOC 2 coverage, and the customer will not rely on a later vendor roadmap date.
- The customer is concerned that the security review may not finish with no blocking findings by May 24.
- Greg will not attend a vendor pricing call at this stage, although a later interaction may be possible.
- Image understanding is not generally available and should not be counted in the evaluation.
- The customer questioned how much value the model can provide on short, messy chat tickets, which are expected to have lower auto-routing performance.
- SCIM inclusion and pricing remain unresolved and must be addressed in the proposal.
- The team has not yet decided whether Dutch should be included in the proof of concept.
- The possible Rotterdam works council consultation could affect implementation readiness.
- A delayed approval could trigger a Queuewise notice risk.

#### Budget / timeline / authority
- The year-one budget is $50,000 inclusive of software and implementation.
- The budget sits within customer operations under Priya's ownership.
- Priya pitched the project to leadership, establishing her as the internal sponsor.
- The planned implementation window is Q4, with an intended go-live around October 15.
- Harbourline's support-tooling change freeze runs from November 1 through January 10.
- The expected Queuewise contract end is December 31, but the date needs confirmation.
- Priya's decision success criterion is at least 90% attainment of the Pro merchant one-hour SLA by year-end.
- Jon Okafor is the IT and security stakeholder responsible for assessing the technical stack, data residency, and integration burden.
- Harbourline previously rejected Zendesk Suite because it was too expensive for its seat count and therefore remains on Support Professional.
- The Zendesk native-app installation is estimated at one to two hours including testing.
- The Salesforce connector is configuration rather than code and typically takes two to three weeks elapsed, with only a few days of actual effort.
- Most of the Salesforce timeline is expected to be waiting for approvals.
- Renata's availability is uncertain because she is currently supporting a CPQ rollout.
- A Dutch works-council consultation previously took approximately four to six weeks for Harbourline's workforce-management tool.
- Jon is a key technical and security stakeholder whose decision criteria include retiring the sorter and VM and passing security review without surprises.
- Routewell confirmed SAML SSO with Okta and enforced SSO-only access are supported on all plans, while SCIM is available only on Enterprise.
- The customer estimates its vendor security review at six to eight weeks.
- The review includes an approximately 180-question questionnaire, SOC 2 review, DPA review by the DPO, and legal review.
- The customer said the October target is tight given the security-review duration.
- A four-week review may be possible but is not guaranteed and depends on complete questionnaire responses and acceptable DPA language.
- Jon can approve the anonymized historical-data proof of concept himself if the anonymization is sufficient.
- The customer set the initial proof-of-concept scope at 10,000 resolved tickets from a normal month, with a typical execution time of three weeks.
- The agreed performance criterion is at least 85% first-assignment routing accuracy across the 10,000-ticket set.
- Professional pricing discussed is $39 per agent per month for the customer's team size, with a $9,500 one-time implementation fee.
- At 140 seats, the annual subscription is $65,520 before implementation.
- The customer's working budget was approximately $50,000, based on Queuewise's roughly $22,000 annual cost plus estimated sorter engineering time and headroom.
- Any software purchase above $40,000 in year-one total contract value, including implementation, requires CFO approval.
- Greg Hale is the CFO and effective economic buyer, while Priya recommends the purchase.
- The Capital and Vendor Review Committee is chaired by Greg and meets on the first Tuesday of each month.
- The committee requires a business case at least five business days before the meeting, including three-year total cost, two competing quotes, and security sign-off or Jon's written confirmation.
- The next committee meeting is June 1, with the business case due May 24; the following meeting is July 6.
- After committee approval, legal contracting generally takes about two weeks, implying a mid-June signature if the June 1 meeting is used.
- Implementation is estimated at six to eight weeks from signature to go-live, supporting an approximately mid-August launch after a mid-June signature.
- The business case is due May 24 and is now the critical internal deadline.
- The June 1 committee is the critical approval milestone, with Greg's approval needed by then.
- If the contract is signed by mid-June, implementation is estimated at six to eight weeks, making August 16 achievable but tight.
- Queuewise non-renewal notice must be issued by June 2 to avoid an automatic one-year renewal.
- The security review must be completed or have no blocking findings by May 24, contingent on documents arriving on the 28th and the questionnaire being returned within a week.
- Three-year cost analysis requires substantial assistance.
- The account is working toward a June 1 approval milestone.
- Committee review is part of the approval process, with a possible pre-committee conversation between Greg and the vendor.
- The integration plan is expected by May 4.
- The next customer meeting is set for May 6 at 3 PM Eastern.
- SCIM pricing is still a proposal-level commercial decision.

#### Follow-up email
- Recap Harbourline's current scale: approximately 120 agents across Columbus and Rotterdam handling 38,000 monthly tickets normally and 55,000 at peak.
- Acknowledge the core routing problem: 18% first-assignment misrouting adds about six hours on average and sometimes a full day.
- Confirm the business objective of improving Pro-merchant one-hour SLA attainment from 71% to at least 90% by year-end.
- Reference the $50,000 all-in year-one budget and the planned October 15 go-live before the November 1 change freeze.
- State that the technical follow-up will cover integration effort, EU data residency, and how Routewell would work with Zendesk, Salesforce, and the current routing process.
- Mention the expected Queuewise contract end around December 31 and the potential overlap with a replacement implementation, while noting the date requires confirmation.
- Confirm that the target environment is Zendesk Support Professional, not Suite, with Salesforce, Queuewise, and the 340-rule cron sorter in scope.
- Recap the business targets of at least 90% Pro SLA attainment, reducing misroutes from 18% to approximately 5%, and eliminating roughly 11 daily hours of manual lead triage.
- Explain that tracking-number fallback is designed to address Pro tickets submitted from personal email addresses.
- Include the planned staged rollout using confidence thresholds, human triage for uncertain tickets, and agent override capability.
- Attach or promise the integration plan with named tasks and hours, plus the change-management and agent-facing materials.
- Address the Dutch works-council question, including the possibility of team-level rather than per-agent override reporting.
- Clarify Okta SAML SSO support, enforced SSO-only access, and available SCIM options given that SCIM is Enterprise-only.
- Confirm that EU classification and routing data, including backups, remain in Frankfurt, and state that disabling summaries for EU prevents data from leaving the EU.
- Include the pending mutual NDA exchange and the condition that security materials can be shared once the NDA is in place.
- List the agreed security-document deliverables: SOC 2 Type II report, penetration-test executive summary, and sub-processor list.
- Reiterate that the team chose a scoped historical-data proof of concept rather than a live pilot because anonymized data enables a lighter review.
- Summarize the proof-of-concept scope as 10,000 resolved tickets from a normal month, initially English and German, with Dutch possibly considered later.
- State the agreed success threshold of at least 85% first-assignment routing accuracy and compare it with the current approximately 82% baseline.
- Confirm owners and dates for the security questionnaire, security documents, and Zendesk export.
- Confirm that the proposal is based on 140 seats, not 120, because the seasonal agents became permanent in March.
- State the Professional subscription as $65,520 annually at $39 per agent per month, plus a $9,500 implementation fee.
- Explain that the proposal will include a SCIM option and a clearly labeled two-year pricing option, while Greg is expected to prefer one year.
- Address the approval path by noting that Greg Hale is the CFO and economic buyer because purchases above $40,000 require CFO approval.
- Frame the business case around three-year cost, competing quotes, service credits, 11 hours per day of team-lead time, and sorter engineering effort.
- Mention the target of submitting the business case by May 24 for the June 1 committee meeting.
- List the agreed deliverables: pricing proposal by April 30, security materials after NDA signature, integration plan by May 4, and change-management and agent-facing materials.
- Confirm that Jon will send the NDA before end of day and the security questionnaire by April 29, while Tomas will provide 10,000 bilingual anonymized tickets by May 7.
- Note that the works council consultation requirement in Rotterdam and Renata's Salesforce-session availability remain open.
- Confirm the revised follow-up meeting time of Thursday, May 6 at 3 PM Eastern.
- State that Queuewise ends August 31, requires notice by June 2, and therefore drives the August 16 target go-live.
- List the critical milestones: May 4 integration plan, May 21 proof-of-concept readout, May 24 business case, June 1 committee, and August 16 go-live.
- Explain that ticket summaries for the US region are deferred until after go-live and are not on the critical path.
- Document that the model currently uses attachment metadata rather than image content, while chat classification uses the full conversation and may have lower auto-route rates.
- Note the requested 30-day data deletion period after termination for inclusion in DPA and legal review.
- Call out the unresolved risk that failure to obtain June 1 approval could result in either a one-year Queuewise renewal or no replacement system on September 1.
- Confirm that the integration plan will be sent by May 4.
- Recap that SCIM inclusion and pricing remain to be covered in the proposal.
- Mention that US-side ticket summaries are deferred until after go-live.
- List the remaining open items: Dutch in the proof of concept, Rotterdam works council consultation and ownership, Renata's Salesforce-session bandwidth, Greg's possible pre-committee call, and the Queuewise notice risk if approval slips.
- Include the scheduled follow-up on May 6 at 3 PM Eastern.

#### Action items (structured)
- Marcus: Marcus will cover Routewell's routing approach and the integration work required on Harbourline's side.
- Target go-live is around October 15. [inferred]
- Support-tooling changes are frozen from November 1 through January 10. [inferred]
- Queuewise is believed to expire December 31. [inferred]
- Harbourline wants to reach at least 90% compliance with the Pro one-hour SLA by year-end. [inferred]
- Me and Marcus: Prepare an integration plan listing named tasks and hours for Harbourline and Routewell.
- Jon: Take the integration plan to the manager for review. [inferred]
- Jon: Check Renata's bandwidth and involve her in a working session for the Salesforce configuration.
- Routewell team: Share the change-management playbook and agent-facing materials with the proposal.
- Priya: Identify the appropriate Harbourline HR contact in Rotterdam to determine whether the works council must be consulted. [inferred]
- Me: Return with options for handling SCIM provisioning given that it is limited to the Enterprise tier.
- Speaker 1's legal team: Speaker 1's legal team will send the mutual NDA template.
- Jon: Jon will send the security questionnaire. (deadline: Thursday the 29th)
- Marcus: Marcus will provide the SOC 2 report, penetration-test summary, and sub-processor list, contingent on the NDA being signed. (deadline: Wednesday, April 28)
- Tomas: Tomas will prepare a 10,000-resolved-ticket Zendesk export containing ticket content, final queue, and tags, using the anonymization script. (deadline: Friday, May 7)
- The vendor will scope the historical-data proof of concept for approximately three weeks after receiving the data. [inferred]
- Mutual NDA to be sent by the customer's legal team today. [inferred]
- Security questionnaire due Thursday the 29th. [inferred]
- SOC 2 report, penetration-test summary, and sub-processor list due Wednesday, April 28, assuming the NDA is signed. [inferred]
- 10,000-ticket Zendesk export due Friday, May 7. [inferred]
- Dana: Send a revised pricing proposal based on 140 seats, including Professional at $39 per agent per month, a SCIM option, the implementation fee, and a clearly labeled two-year option. (deadline: Friday, April 30)
- Marcus: Send the SOC 2 Type II report, pen test executive summary, and sub-processor list to Jon after the NDA is signed. (deadline: Wednesday, April 28)
- Dana and Marcus: Prepare and send an integration plan covering tasks and estimated hours for both sides, including Salesforce connected-app work with Renata. (deadline: Tuesday, May 4)
- Jon: Send the vendor NDA using the new intake process. (deadline: Today, before end of day)
- Jon: Send the security questionnaire. (deadline: Thursday, April 29)
- Tomas: Provide an export of 10,000 anonymized resolved tickets in English and German. (deadline: Friday, May 7)
- Priya: Notify Tomas about the ticket export request so he can start before his days off. (deadline: Today)
- Joan: Send the business-case template and an example of an approved prior case. (deadline: Monday, May 3)
- Dana and Priya: Co-write the business case, including the three-year cost analysis, for the May 24 submission deadline. (deadline: May 24)
- Joan: Support the three-year cost portion of the business case.
- Jon: Ask Renata whether she has bandwidth for a Salesforce working session.
- Priya: Ask HR in Rotterdam whether a works council consultation is required.
- NDA to be sent before end of day [inferred]
- Security materials targeted for Wednesday, April 28, contingent on NDA signature [inferred]
- Security questionnaire due Thursday, April 29 [inferred]
- Revised pricing proposal due Friday, April 30 [inferred]
- Business-case template due Monday, May 3 [inferred]
- Integration plan due Tuesday, May 4 [inferred]
- Anonymized ticket export due Friday, May 7 [inferred]
- Business case due Monday, May 24 for the June 1 committee meeting [inferred]

#### Decisions (structured)
- The team will treat Harbourline's environment as Zendesk Support Professional rather than Zendesk Suite, with Queuewise and the existing cron-based sorter in scope for replacement.
- The proposed cutover plan is for Routewell to replace Queuewise tagging and the cron-based sorter, with the cron job turned off at cutover.
- The initial rollout should use a high confidence threshold so only high-confidence tickets are auto-routed while lower-confidence tickets go to human triage.
- The parties agreed to keep the Dutch works-council consultation requirement as an open item to investigate early.
- The team agreed to use a scoped proof of concept on anonymized historical tickets instead of a live pilot.
- The initial proof of concept will use English and German tickets, with Dutch potentially added later.
- The proof of concept success threshold is 85% or better routing accuracy on first assignment across the historical ticket set.
- Tomas, rather than Jon's engineer, will own the Zendesk export and anonymization work.
- The proposal will use the full scope of 140 seats rather than a 100-seat partial rollout.
- The pricing proposal will be sent to Joan, with Priya copied; Jon will receive the security documents instead.
- The team will target the June 1 Capital and Vendor Review Committee meeting, with the business case due May 24.
- The follow-up meeting was moved from Tuesday, May 4 to Thursday, May 6 at 3 PM Eastern for one hour.
- The ticket-summary feature for the US side will be reviewed separately after go-live and will not be in the critical path.
- The potential Lyon hub and later French-language support will not be included in the current planning because the hub is uncertain and would not occur until next year.
- The target go-live moved to Monday, August 16, before the Queuewise contract ends on August 31, with two weeks of overlap.
- The proof-of-concept schedule was compressed to load data on May 10, run through May 20, and hold the readout on May 21.
- The team will treat the outcome of the June 1 approval as an open question, including what happens if approval does not come through.
- US-side use of ticket summaries is deferred until after go-live.
- The next meeting is scheduled for Thursday, May 6 at 3 PM Eastern.

#### Open questions (structured)
- The exact Zendesk Suite plan was not confirmed. [open]
- The exact end date of the Queuewise contract still needs confirmation because Harbourline believes it ends December 31. [open]
- Whether Harbourline will add French support next year remains undecided. [open]
- Does Routewell's use of per-agent override data require consultation with the Dutch works council? [open]
- Who at Harbourline HR owns the relationship with the Rotterdam works council? [open]
- What options are available for SCIM provisioning if Harbourline does not purchase Enterprise? [open]
- When can Renata participate in a Salesforce integration working session? [open]
- Whether SCIM provisioning can be included or otherwise handled for the customer is unresolved. [open]
- Whether ticket summaries should be enabled for the US region remains undecided. [open]
- Whether Dutch should be added to the proof of concept remains unresolved. [open]
- Whether the security review can be shortened from six to eight weeks to approximately four weeks depends on fast questionnaire completion and acceptable DPA terms. [open]
- Whether HR in Rotterdam requires a works council consultation remains unresolved. [open]
- Whether Greg will approve a two-year term remains unresolved; Joan expects he will likely prefer one year. [open]
- Whether Renata has bandwidth for a Salesforce working session is unresolved. [open]
- Whether the NDA can be signed in time for the security materials to be sent by April 28 is not yet confirmed. [open]
- Who owns checking with Rotterdam HR whether works council consultation is required? [open]
- Whether Renata has bandwidth for a Salesforce working session remains unknown. [open]
- Whether ticket summaries will be enabled for the US side after go-live remains unresolved. [open]
- Whether the Queuewise notice can be shortened or extended instead of requiring a full-year renewal is unresolved. [open]
- What happens if Greg does not approve on June 1 remains unresolved. [open]
- Whether Greg wants to meet the vendor before the committee remains unknown. [open]
- What happens if the June 1 approval does not come through? [open]
- Whether SCIM will be included and at what price. [open]
- Whether Dutch will be added to the proof of concept. [open]
- Whether the Rotterdam works council must be consulted and who owns that responsibility. [open]

#### Risks (structured)
- [high] Routewell must address EU data residency because Rotterdam handles most of Europe and Deflekt does not yet have an EU region.
- [high] Integration effort is a material concern because Harbourline has only two engineers responsible for all internal tooling.
- [high] The current routing system contains around 340 poorly understood and sometimes contradictory rules maintained by a team without the original author's knowledge.
- [high] Harbourline is achieving the contractual Pro-merchant one-hour SLA only 71% of the time and has already paid service credits twice this year.
- [high] More than half of Pro-SLA misses involve Pro tickets sitting in consumer queues because merchant matching fails or messages come from personal Gmail accounts.
- [medium] The October 15 target leaves only about two weeks to stabilize the implementation before the November 1 support-tooling change freeze.
- [high] More than half of SLA misses are attributed to Pro tickets being misrouted into consumer queues.
- [high] The two-person engineering team is already overloaded, making short-term integration effort a major concern.
- [high] Rotterdam agents may distrust an AI routing rollout because of a prior workforce-management tool experience that felt like surveillance.
- [high] A Dutch works-council consultation could add approximately four to six weeks if the tool can be used to assess individual employees.
- [high] SCIM provisioning is not included below the Enterprise tier, creating an offboarding concern for an organization with seasonal agent turnover.
- [high] SCIM is available only in the Enterprise tier, while automated offboarding is important because the agent population has seasonal turnover.
- [high] The customer's vendor security review normally takes six to eight weeks and may be tight for the October target.
- [high] The review timeline can be extended by a slow or incomplete 180-question questionnaire and unfavorable DPA clauses.
- [high] The EU residency requirement is at risk if the ticket-summary feature uses its default US-based large-language-model sub-processor.
- [medium] A live pilot would require the full security review and signed DPA before real customer data could be used.
- [high] The 140-seat first-year subscription is $65,520 plus a $9,500 implementation fee, exceeding the stated $50,000 planning budget.
- [high] The purchase requires CFO approval because year-one total contract value over $40,000, including implementation, goes to Greg Hale.
- [high] The committee business case must include three-year total cost, at least two competing quotes, and IT security sign-off or written confirmation from Jon.
- [high] Greg is not a rubber-stamp approver and has rejected several tools this year.
- [medium] Greg generally prefers a one-year term with new vendors, creating risk for the proposed two-year price option.
- [medium] Legal contracting typically takes about two weeks after committee approval, assuming the vendor does not challenge the terms.
- [medium] Renata's availability for Salesforce work may be constrained because the CPQ project is consuming her capacity.
- [high] The Queuewise contract ends August 31 and requires 90 days' notice by June 2, creating a risk of either a one-year renewal or no replacement system if approval slips.
- [high] The August 16 go-live is achievable only with a mid-June contract signature and has little schedule slack.
- [high] The June 1 committee must occur because slipping to July 6 would make the August 16 go-live and notice deadline too late.
- [high] The security review must have no blocking findings by May 24, but Speaker 2 is nervous about completing it within four weeks.
- [high] Deflekt is currently blocked because its EU region is not live with applicable SOC 2 coverage.
- [medium] Chat is expected to have the lowest auto-route rate because short chats have lower confidence and are more likely to enter human triage.
- [high] A delay or failure of the June 1 approval could create a Queuewise notice risk.
- [medium] The Rotterdam works council consultation requirement and ownership remain unresolved.

#### Follow-up draft
Subject: Follow-up: Zendesk routing replacement

Hi there,

Thank you for the thoughtful discussion on Harbourline’s routing challenges and the path to replacing Queuewise and the 340-rule sorter in Zendesk Support Professional. We aligned on a staged rollout with high-confidence auto-routing and human triage for uncertain tickets, supported by a 10,000-ticket English and German proof of concept targeting at least 85% first-assignment accuracy to help improve Pro-SLA attainment from 71% toward 90%.

We’ll continue focusing the proposal on integration effort, EU data residency, SCIM options, and the Rotterdam works-council question, with the August 16 target shaped by Queuewise’s August 31 end date. The key open question is whether SCIM can be included in a way that meets Harbourline’s automated offboarding requirements without requiring an Enterprise upgrade.

Best regards,
Routewell

---

# Summary F

_(run1)_

### Title: Harbourline Routewell Discovery Call Integration Plan

#### Overview
Opening discovery call in which Priya and Jon described Harbourline's 120-agent, two-site (Columbus/Rotterdam) support operation, its misrouting problem (18% misrouted, ~6-hour delay, Pro SLA met only 71%), the incumbent Zendesk-Queuewise-Salesforce 'sorter' stack, a $50,000 year-one budget, and a Q4 go-live target of around October 15 ahead of a November 1 change freeze. Harbourline detailed its 71% Pro SLA miss rate and misrouting problem, Marcus demonstrated how Routewell's classification and routing would replace the 340-rule sorter and Queuewise, and the group surfaced two open blockers: SCIM provisioning only being in Enterprise tier and a possible Dutch works council consultation. Security-review scoping call: the group agreed to drop the proposed live pilot in favor of a scoped proof of concept on 10,000 anonymized historical Zendesk tickets (English and German) targeting 85% routing accuracy, with Marcus to send the SOC 2 report, pen test summary and sub-processor list and Priya's legal team to send a mutual NDA. Dana demoed the routing replay and permissions, then walked Priya, Jon, and finance's Joan Petrakis through Professional pricing ($39/agent; 140 seats = $65,520/yr plus $9,500 implementation), learned that any purchase over $40,000 needs CFO Greg Hale's approval via the June 1 committee, and recapped owners and dates for the proposal, security docs, integration plan, ticket export, and business case. Joan discovered the Queuewise contract actually ends August 31 (not December 31) with a 90-day notice clause due June 2, forcing the go-live to move from Q4 to Monday August 16 and making the June 1 committee and May 24 business case the critical dates; the next meeting was rescheduled to Thursday, May 6 at 3 PM Eastern. The call wrapped with a recap of open items (SCIM scope, Dutch POC, works council, Renata's bandwidth, Queuewise notice risk), a commitment to deliver the integration plan by May 4, and confirmation of the next meeting on Thursday, May 6 at 3 PM Eastern. Key decisions: Agreed the call would be listen-first rather than a slide deck, with Marcus later showing how Routewell's routing works against Harbourline's described setup.; Routewell (Dana and Marcus) will draft a concrete integration plan with named tasks and estimated hours for each side, so Harbourline is not taking the effort estimate on faith.; The Dutch works council (ondernemingsraad) consultation question is kept as an open item to be resolved early rather than assumed away.. Buying signals: The project is a real initiative on Priya's plan for this year, not exploratory.

#### Summary
- The project is a real initiative on Priya's plan for this year, not exploratory.
- Opening discovery call in which Priya and Jon described Harbourline's 120-agent, two-site (Columbus/Rotterdam) support operation, its misrouting problem (18% misrouted, ~6-hour delay, Pro SLA met only 71%), the incumbent Zendesk-Queuewise-S
- Agreed the call would be listen-first rather than a slide deck, with Marcus later showing how Routewell's routing works against Harbourline's described setup.
- Routewell (Dana and Marcus) will draft a concrete integration plan with named tasks and estimated hours for each side, so Harbourline is not taking the effort estimate on faith.
- Deflekt lacks an EU data residency region, which is a blocker-type concern because Rotterdam is a major part of the support operation.

#### Account context
- Harbourline does fulfillment and last-mile logistics for online retailers, mostly mid-size direct-to-consumer brands plus some larger ones.
- Support covers two distinct worlds: the B2B merchants/brands who pay Harbourline, and those merchants' end consumers asking about parcels.
- Merchant tickets are high-stakes (slow response loses accounts) while consumer tickets are pure volume.
- There are about 120 agents split between the Columbus site and the Rotterdam site, which handles most of Europe.
- Current stack is Zendesk, Salesforce for merchant accounts, a custom 'sorter' script in between, and Queuewise for auto-tagging and language detection.
- Queuewise is described as the incumbent vendor in this space, but it only tags and doesn't really route.
- Tickets arrive through three channels: email about 62% of volume, chat about 25%, and a web form on the tracking page at 13%.
- Volume runs around 38,000 tickets a month normally, rising to about 55,000 in the November-December peak.
- Tickets are routed into 14 queues split by region, language, and merchant tier, plus special queues like claims and carrier escalations.
- They support four languages today — English ~70%, German ~12%, Dutch ~9% and Spanish ~9% — with a possible French addition next year.
- Merchants are tiered Pro or Standard; there are about 300 Pro accounts that hold contractual SLAs.
- SLA structure: Pro merchants get first response within 1 hour, everyone else within 4 business hours, with an internal 48-hour resolution target.
- Harbourline runs Zendesk Support Professional, not Suite; they evaluated Suite two years ago, found it too expensive for their seat count, and stayed on Support Professional with Queuewise bolted on.
- Because they are not on Suite, Zendesk native intelligent triage is not in the picture, which the rep noted simplifies the integration.
- Routing today is handled by a cron-based Python router with about 340 rules, referred to internally as 'the sorter', which grew organically rather than being designed.
- Salesforce is the system of record for merchant tier, which the routing logic depends on.
- Priya leads customer operations and is measured on the Pro SLA number.
- Jon owns IT and security, and his team has two engineers who are already fully loaded.
- Support operations are split across sites, with team leads in Columbus and Rotterdam.
- There are 11 team leads in the org.
- Harbourline uses Okta as its identity provider across everything.
- Marcus is Routewell's sales engineer based in Stockholm and covers the EU side of things.
- The customer uses Okta for all identity and requires SAML SSO for every user with local passwords disabled.
- The company operates a Rotterdam site handling EU consumers and EU merchants, plus a Columbus agent team referenced in the pilot proposal.
- The customer requires EU data residency for its Rotterdam data, driven by its DPO.
- Their vendor security review process runs through a ~180-question questionnaire, SOC 2 report review, a DPO data processing agreement review, then legal.
- The customer currently uses a 'sorter' for routing whose changes are logged in Git only sometimes.
- The company is a logistics business, evidenced by demo policies referencing damaged parcel, merchant tier Pro and delayed parcel.
- The customer's agent population has seasonal turnover.
- Tickets are managed in Zendesk, with an agent-facing sidebar and export capability.
- Priya's support org has 140 agents after converting seasonal agents to permanent in March (previously 120), and the headcount plan holds 140 support agents for the rest of the year.
- Current routing stack is a self-built 'sorter' plus Queuewise, which costs about $22,000 a year.
- Deployment scope is Zendesk plus Salesforce across two regions, with English and German tickets.
- The account spans multiple functions: Priya (business lead), Jon (security), Joan Petrakis (finance FP&A), plus engineering (Tomas) and Salesforce (Renata).
- Rotterdam is a specific site that matters for adoption and possibly works council consultation.
- They work in Zendesk, where agents would see routing reasoning via a sidebar panel.
- Ten thousand anonymized resolved tickets in English and German will be exported for model training.
- Priya is the customer lead who says she needs a lot of help on the three-year cost part, and Joan (who does this work) offers to help.
- The customer's current ticketing system is Queuewise, under a two-year renewal signed on September 1 two years ago with a term ending August 31.
- The customer plans to cancel Queuewise after the new solution goes live.
- The new solution must cover three ticket channels, with the web form being the easiest because it has a dropdown.
- A large share of the customer's tickets are damaged parcel tickets that arrive with photos attached.
- The customer uses Salesforce and has a CPQ project underway, with Renata as the relevant person and Jon able to ask about a Salesforce working session.
- There is a potential Lyon hub / French-language consideration, though Priya says it wouldn't be until next year and she doesn't know if it's happening.
- The customer has HR in Rotterdam and an offsite in Rotterdam in June, relevant to the works council question.
- Approval runs through a committee that meets June 1, with Greg as the approver.
- Marcus (the vendor speaker) is based in Stockholm, where 3 PM Eastern is 9 PM.
- A proof of concept is underway and the question of adding Dutch to it was raised as still open.
- The account spans a US side (ticket summaries use case) and a Rotterdam/Netherlands side with a works council.
- A Salesforce session is part of the engagement, dependent on Renata's availability.
- Queuewise is an incumbent/related vendor whose notice period could affect the deal.
- SCIM is an in-scope integration topic that will be addressed in the proposal.

#### Pain points
- Routing is the primary pain: tickets land in the wrong queue, sit, eventually get moved, and by then the merchant is already angry.
- A February sample found roughly 18% of tickets were misrouted on first assignment.
- A misrouted ticket adds about six hours on average before reaching the right person, sometimes a full day if it lands in the Rotterdam queue after hours.
- Harbourline hits its contractual Pro one-hour SLA only about 71% of the time and has paid service credits twice this year as a result.
- More than half of the missed Pro SLAs were Pro merchant tickets sitting in a consumer queue because the sorter failed to match the merchant or the email came from a personal Gmail.
- The sorter is a ~340-rule Python cron job that nobody fully understands, with contradicting rules where order matters.
- The sorter runs as a cron job every five minutes on a small VM in Harbourline's own data center, which Jon dislikes.
- Routing changes take about two weeks because they require one of Jon's two engineers to edit, test on yesterday's tickets, and push the rules, and it's never top of the list.
- Misrouting is the single biggest reason for SLA misses: more than half of misses were Pro merchant tickets sitting in a consumer queue.
- The root causes of misrouting are the sorter failing to match the merchant and emails arriving from someone at the merchant using a personal Gmail address.
- Current misroute rate is 18%, and Priya wants it down to roughly 5%.
- Each of the 11 team leads spends roughly an hour a day manually moving tickets, which the rep quantified as about 11 hours a day of leadership time.
- Agents have been burned by the sorter, getting blamed for slow responses when it routes something wrong, creating deep distrust of anything automatic.
- Rotterdam team leads resist automation because a prior workforce management tool felt like surveillance.
- The tracking number fallback directly addresses the biggest driver of Pro misses, which were personal-email tickets.
- Jon wants to retire the sorter and the VM it runs on rather than add another system to babysit.
- Offboarding is a major need because the customer has seasonal turnover in the agent population and wants automatic access removal.
- EU data residency is non-negotiable for the customer's regulatory position.
- Security review is slow because the questionnaire goes back and forth and everyone works on it on top of their day job.
- The current routing misses - about 18% misroute and roughly 82% correct on first assignment - is the baseline the customer wants beaten.
- The existing sorter's change logging is inconsistent, creating a governance gap the customer wants closed.
- Agents want visibility into why a ticket was routed to them.
- Jon's team is resource-constrained by CPQ work, limiting their capacity to help with the proof of concept.
- The existing sorter's change logging is unreliable, described as being logged in Git only sometimes, versus Routewell's log of who, when, and the diff on every publish.
- Agents need to see why a ticket was routed to them, which the intent/confidence/policy panel addresses and which builds agent trust.
- The do-nothing path carries hard costs including service credits and 11 hours a day of team lead time.
- A partial 100-seat rollout would leave half the team on the old routing, which Priya called a mess to manage.
- Jon wants SCIM, which is not in the Professional tier and requires Enterprise.
- A Rotterdam works council consultation may be required, and Priya does not know who owns checking with HR.
- Renata's bandwidth is consumed by the CPQ project, so a Salesforce working session cannot be promised on timing.
- The planning had been built on a wrong Queuewise end date (December 31), so the true August 31 end was not known until Joan checked the contracts system.
- Photo attachments on damaged parcel tickets are not analyzed for image content today; the model only uses attachment metadata.
- Chat tickets are short and messy (people just type 'help' or 'where is it'), so short chats have lower confidence and more go to human triage.
- Chat is expected to have the lowest auto-route rate of the customer's three channels.
- The web form has a dropdown that, per Jon, nobody reads.
- Jon is concerned about what happens to the customer's ticket data if they leave the vendor.
- Priya wants ticket summaries, but agrees they are not in the critical path.
- Dutch language coverage for the proof of concept is still unresolved, indicating a localization gap for the Netherlands user base.
- Legal/HR clearance is a concern: it is still undetermined whether the Rotterdam works council must be consulted and who owns that step.
- Internal resource bandwidth is constrained — Renata's availability for the Salesforce session is in question.
- A Queuewise notice period creates a contractual exposure if the approval timeline slips.

#### Buying signals
- The project is a real initiative on Priya's plan for this year, not exploratory.
- A $50,000 year-one budget has been set aside, covering software plus implementation, with some flexibility.
- Priya owns the budget and personally pitched the initiative to leadership, indicating internal sponsorship.
- Priya explicitly wants to be at 90% or better on the Pro SLA by year end, and says that is the number she is measured on.
- Priya prefers a listen-first, no-slides format after a month of forty-minute slide vendor calls.
- Harbourline is still evaluating options including two calls with Deflekt and the fallback of renewing Queuewise and patching the sorter.
- Jon's exasperation with patching the sorter ('Please don't make me patch the sorter again') signals appetite to move off the status quo.
- Priya reacted strongly to ops team leads being able to change routing policies themselves without filing an IT ticket.
- Jon responded positively to the ability to stage a policy change and replay it against the last seven days of tickets before publishing.
- Jon explicitly asked for a written integration plan he can take to his manager.
- Jon opened his security checklist proactively, preferring to cover the big items now rather than discover them in week five of the review.
- Priya found the phased, confidence-threshold rollout a more acceptable story than a full switch-on.
- Marcus framed the change as the agents training the model through their overrides rather than automation being done to them.
- The rep offered a change management playbook with agent-facing materials and agent champion groups per site, which Priya said Rotterdam would need.
- Jon can self-approve a light security review if the proof of concept data is properly anonymized.
- Priya agreed to run the proof of concept instead of the pilot.
- Priya sees the proof of concept report as a number for the business case, which she finds more useful than a pilot.
- Jon indicated early documents would materially help the review timeline.
- Marcus agreed to a 85% accuracy bar while signalling the vendor usually beats it on logistics data.
- Jon expressed interest in the agent-facing summaries feature, saying agents would probably love it.
- Jon reacted positively to the routing editor's publish logging: 'Okay. That's better than the sorter.'
- Priya affirmed the agent reasoning panel is exactly what Rotterdam will want.
- Priya is actively benchmarking against Deflekt's number so she can compare the two.
- Priya committed to running the business case with Dana and flagged she'll need help on the three-year cost.
- The team chose to take the full 140-seat real scope to Greg rather than a small pilot, signaling intent to move forward at full scale.
- Priya offered to pull in finance (Joan) for the last part, indicating organizational momentum toward getting budget approval.
- Joan will send the committee's business case template plus a previously approved example, and will help build the three-year cost.
- Priya committed to a concrete go-live of Monday, August 16, with two weeks of overlap before Queuewise ends.
- The customer agreed to a follow-up meeting on Thursday, May 6 at 3 PM Eastern to go through the proposal and integration plan.
- Priya agreed to a compressed proof of concept ending with a May 21 readout.
- Joan asked to be added to the readout because the accuracy number goes straight into the business case.
- Jon offered to prioritize the security review to hit the May 24 date.
- Priya said enough metadata to know a photo exists is useful because those tickets are almost always claims.
- The customer is willing to plan around an aggressive schedule that hinges on the June 1 committee approving.
- A participant called the session 'actually really useful' and explicitly preferred it to 'forty minutes of slides'.
- The customer requested the integration plan by May 4, signaling movement toward implementation planning.
- A June 1 approval milestone exists and the group is actively planning around the committee decision.
- The next working session was accepted and scheduled for May 6 at 3 PM Eastern, keeping evaluation momentum going.

#### Objections
- Jon flagged integration burden as a concern up front: his team is only two engineers covering all internal tooling, so heavy integration work is a real problem.
- Deflekt lacks an EU data region today, which is a data-residency concern given Rotterdam's role, and their promise to add one later was met with skepticism.
- Jon pushed back that every vendor claims long-term effort reduction while the short-term burden is what worries him.
- Jon said giving ops the ability to change routing policies would also make him nervous, prompting Marcus to cite role-based permissions, change history, and replay.
- Jon flagged that SCIM provisioning only being available in Enterprise tier is 'not great' because offboarding matters given seasonal agent turnover.
- Jon warned that a works council consultation, if triggered, could take a while based on the prior WFM rollout.
- Jon wants to pass Routewell's security review without surprises and front-loaded the big security items now.
- SCIM provisioning being Enterprise-tier only drew pushback because offboarding is critical for the customer's seasonal turnover.
- Jon rejected the live pilot because it would require the full security review plus a signed DPA, adding a phase rather than saving time.
- A 25-agent Columbus pilot would not test Rotterdam's language and residency requirements.
- Jon cannot promise a four-week security review and flagged the six-to-eight week process as tight for October.
- Jon noted the DPA review could add delay if it contains unusual clauses.
- Adding Dutch and Spanish to the proof of concept is impractical at 10,000 tickets because there would be too few examples.
- Priya flagged that the numbers already exceed $50,000 before implementation.
- Priya noted the quoted price excludes SCIM, which Jon requires.
- Greg is expected to favor a one-year term over a two-year commitment, making the two-year discount unlikely to land.
- The partial 100-seat option was rejected by both Priya and Joan because it splits routing across old and new systems.
- Dana declined to quote the Enterprise tier price on the call, saying she'd instead put together options.
- Dana acknowledged the price point openly, recognizing the size of the number.
- Jon treats the Deflekt EU region as a hard blocker until a live EU region with a SOC 2 covering it exists.
- Jon does not want the ticket summaries work slowing down the main review and wants it handled separately after go-live.
- Greg will not attend a vendor pricing call at this stage; Joan is the planned attendee instead.
- Image understanding cannot be counted in the evaluation because it is not generally available.
- Jon is not willing to promise completion of the security review on the tight May 24 timeline.
- Jon will only make the 3 PM Thursday call if it starts on time because he has a vendor call until 3.
- Whether SCIM is included and at what price remains contested enough that the seller must resolve it in the proposal.
- The Queuewise notice period is a procurement/timing issue that could affect the deal if approval slips.
- Works council consultation requirements could add a legal/HR approval step on the Rotterdam side.

#### Budget / timeline / authority
- $50,000 is the year-one budget covering software and implementation, with some flexibility beyond that number.
- The budget sits in customer operations and is controlled by Priya, who pitched it to leadership.
- The plan targets a Q4 go-live around October 15 to allow two weeks to settle before the freeze.
- A peak-season change freeze blocks any support-tooling changes from November 1 through January 10.
- The Queuewise contract is believed to end December 31, giving a couple of months of overlap with a new solution.
- Competitor Deflekt's pricing came in low, around $31 per agent per month.
- Jon needs the integration plan as something he can take to his manager, implying his manager is a decision influencer.
- The Salesforce admin Renata sits in the sales ops team, not Jon's team, and is in the middle of a CPQ rollout, so her bandwidth must be checked before a working session.
- SCIM provisioning is only included in Routewell's Enterprise tier, which has pricing/tier implications for the proposal.
- A prior WFM tool works council consultation took roughly four to six weeks, given as a reference for the potential timeline impact.
- The works council relationship is believed to be owned by HR in Rotterdam, but Priya does not yet know the exact owner.
- Priya is measured on hitting 90% or better on the Pro SLA by the end of the year, making that the primary success metric for the engagement.
- October is the target timeline that the six-to-eight week security review is being measured against.
- The security review is normally six to eight weeks, with a possible path closer to four weeks if the questionnaire returns fast and the DPA is clean.
- Jon has approval authority for the lighter security review on anonymized historical data.
- The proof of concept was sized at 10,000 tickets and expected to run about three weeks.
- Priya holds the decision on language scope, deferring the Dutch decision rather than deciding on the call.
- SCIM provisioning availability is tied to the Enterprise tier, which is the pricing-tier implication surfaced in this chunk.
- The vendor's EU endpoint routing for the summaries sub-processor is only in limited availability, constraining that option.
- Priya's planning budget is $50,000, derived roughly from the ~$22,000 Queuewise spend plus estimated sorter engineering time plus headroom.
- Any software purchase over $40,000 requires CFO approval, measured on year-one total contract value and including implementation fees.
- VP approval limits were cut to $40,000 across the board in a January policy change, so Priya's old $50,000 limit no longer applies.
- CFO Greg Hale is the economic buyer; Priya recommends, but Greg decides on the money and has pushed back on tools this year.
- Pricing: Professional lists at $45/agent/month billed annually, discounted to $39; at 140 seats that is $65,520 a year plus a $9,500 one-time implementation fee.
- Enterprise tier, which includes SCIM, lists at $52 per agent but was not quoted on the call.
- The implementation fee covers Zendesk and Salesforce setup, model training on their data, and change management support.
- A two-year term could bring the per-agent price down to about $35, but Joan would only include it as an option and won't decide today.
- The Capital and Vendor Review Committee is chaired by Greg and meets the first Tuesday of each month; next meeting is Tuesday, June 1, with the business case due Monday, May 24, then July 6 after that.
- The business case must be submitted at least five business days before the meeting and include a three-year total cost, at least two competing quotes, and IT security sign-off or Jon's written confirmation of no blocking findings.
- Competing quotes will be Deflekt and Queuewise renewal plus keeping the sorter, which Greg will accept as a do-nothing baseline.
- Decision criteria lean toward quantified hours and credits rather than features.
- After committee approval, legal contracting runs about two weeks, so making the June 1 committee implies roughly mid-June signature.
- The three-year cost is part of the business case and is owned by Joan, who offered to help with it.
- Greg is the economic buyer who must approve on June 1 for the timeline to work.
- The business case is due May 24, which is now the critical date on the vendor side.
- Jon's security review needs to be done, or at least have no blocking findings, by May 24.
- The Queuewise 90-day written notice must go out by June 2 or the contract auto-renews for another full year.
- Marcus estimates six to eight weeks from contract signature, requiring signature by mid June to achieve August 16.
- The vendor committed to turn the security questionnaire around within five business days of receiving it.
- Data retention defaults: 90 days deletion after contract end with a deletion certificate, a shorter window (as low as 30 days) can be requested, and processed-ticket retention defaults to 24 months.
- A June 1 approval is the key date whose failure would trigger the Queuewise notice risk.
- Approval runs through a committee, and Greg may or may not request a fifteen-minute vendor call before it meets.
- Speaker 3 is the person who can determine Greg's pre-committee meeting preference.

#### Follow-up email
- Confirm the key pain metrics discussed: 18% of tickets misrouted on first assignment and ~6 hours added before reaching the right person.
- Summarize the SLA picture: Pro one-hour SLA met ~71% today against a 90% year-end target, with service credits already paid twice this year.
- Reflect the agreed $50,000 year-one budget (software plus implementation) and the Q4 timeline with an October 15 go-live target.
- Note the November 1 to January 10 change freeze and the December 31 Queuewise contract end as the scheduling constraints.
- Flag that EU data residency will be addressed, since Deflekt's lack of an EU region was a specific concern.
- Include an introduction to Marcus and the technical/integration deep-dive as the follow-up step.
- Confirm the plan to deliver an integration plan with named tasks and hours for both Harbourline and Routewell, as requested by Jon for his manager.
- Document that the Zendesk deployment is a native app install plus admin-granted API scopes, estimated at one to two hours including testing.
- Document the Salesforce connector effort: configuration rather than code, requiring Salesforce admin rights to create a connected app and map the account tier and tracking number fields, about two to three weeks elapsed but only a few days
- State the security position clearly: SAML SSO with Okta is supported on all plans and SSO-only enforcement disables local passwords, but SCIM provisioning is Enterprise-tier only and options are pending.
- Note the phased rollout approach: a confidence threshold (for example below 0.7) routes nothing automatically to a human triage queue, expected to auto-route roughly 60-70% at launch for logistics customers.
- Include the open works council (ondernemingsraad) question and the note that some Dutch customers configure override reporting at team level only, which in some cases changed the consultation answer.
- Confirm the agreed change from live pilot to a scoped proof of concept on anonymized historical tickets.
- State the proof of concept specs: 10,000 resolved tickets from a normal month, English and German, ~3 weeks runtime.
- Recap the agreed success metric of 85% routing accuracy on first assignment across the 10,000 tickets.
- List the documents to be exchanged: mutual NDA from Priya's legal, security questionnaire from Jon, and SOC 2 report, pen test summary and sub-processor list from Marcus.
- Note that the LLM summary feature is left open and that the customer needs written confirmation that disabling EU summaries keeps all data in the EU.
- Flag that SCIM options will follow separately in the proposal.
- Include the dates agreed: questionnaire by Thursday the 29th, vendor docs by Wednesday April 28, and ticket export by Friday May 7.
- Confirm the corrected seat count of 140 agents and resulting pricing: $39/agent/month = $65,520/year plus $9,500 one-time implementation.
- Note that the proposal will include the SCIM/Enterprise option and a labelled two-year term option (potentially ~$35/agent).
- Restate the send dates: proposal to Joan (copy Priya) by April 30; security docs to Jon by April 28; integration plan by May 4; ticket export by May 7; business case template from Joan by May 3.
- Confirm the business case due date of May 24 for the June 1 Capital and Vendor Review Committee, and that it needs three-year cost, two competing quotes, and security sign-off.
- Confirm receipt direction: pricing proposal to Joan (J O A N) copying Priya; security documents to Jon.
- Confirm Jon sends the mutual NDA today and the security questionnaire by April 29.
- Note the target dates derived in the call: if the June 1 committee approves and legal takes ~2 weeks, signature is mid-June and go-live mid-August (6-8 week implementation), which is fine for October.
- Keep the Rotterdam works council consultation flagged as an open item pending HR confirmation.
- Confirm the meeting moved to Thursday, May 6 at 3 PM Eastern (9 PM Stockholm) and that the invite is coming.
- State the corrected go-live target of Monday, August 16, driven by the Queuewise end date of August 31.
- Note the Queuewise 90-day notice deadline of June 2 and that Joan is checking the notice terms with procurement by April 30.
- Confirm the POC schedule: export ready May 7, load May 10, run through May 20, readout May 21.
- Reiterate the vendor's commitment to turn the security questionnaire around within five business days.
- Confirm the data retention position: 90-day default deletion with certificate, a 30-day window can be requested, and 24 months default processed-ticket retention.
- List the still-open items: SCIM inclusion and price, ticket summaries (parked until after go-live), Dutch in the POC, Rotterdam works council ownership, Renata's Salesforce session bandwidth, and the Queuewise notice risk if approval slips.
- Note the image understanding limitation: the model reads attachment metadata but not image content, so photos cannot be counted in the POC.
- Confirm the action to deliver the integration plan by May 4.
- Confirm the next meeting: Thursday, May 6 at 3 PM Eastern.
- Note that the seller will resolve SCIM inclusion and pricing in the proposal.
- Flag the open question of what happens if the June 1 approval doesn't come through.

#### Action items (structured)
- Marcus: Marcus (Routewell sales engineer) to join the call later to cover the product and technical side, including how routing works.
- Dana Whitfield: Dana to make sure Marcus covers what the integration actually involves on Harbourline's side, given Jon's two-engineer team. [inferred]
- Jon Okafor: Jon to provide the exact Zendesk plan Harbourline is on later in the conversation. [inferred]
- Target go-live around October 15, two weeks before the peak-season change freeze [inferred]
- Peak season change freeze runs November 1 through January 10 (no support tooling changes) [inferred]
- Queuewise contract believed to end December 31, giving a couple of months of overlap [inferred]
- Dana and Marcus: Draft and deliver an integration plan with named tasks and hours for the Harbourline and Routewell sides.
- Jon: Check the bandwidth of Renata, the sales ops Salesforce admin, for a Salesforce connector working session.
- Priya: Identify who at Harbourline owns the relationship with the Dutch works council (thought to be HR in Rotterdam) and check whether a consultation is required.
- Dana: Look at how SCIM provisioning can be handled in the proposal and come back with options rather than promising on the call.
- Dana: Write down Marcus's note that some Dutch customers configure override reporting at team level only, not per agent.
- Priya wants to reach 90% or better on the Pro one-hour SLA by the end of the year. [inferred]
- Speaker 1 (Priya): Ask legal team to send the mutual NDA template over to the vendor. (deadline: today)
- Speaker 2 (Jon): Send the customer's security questionnaire to the vendor. (deadline: Thursday the 29th)
- Speaker 4 (Marcus): Send the SOC 2 report, penetration test summary and sub-processor list to Jon. (deadline: Wednesday, April 28, assuming the NDA is signed by then)
- Tomas (Priya's ops analyst): Produce the 10,000-ticket Zendesk export (content, final queue and tags) for the proof of concept. (deadline: Friday, May 7)
- Me (vendor): Come back with options for handling SCIM provisioning in the proposal.
- Speaker 4 (Marcus): Provide documentation in writing confirming that disabling summaries for the EU means nothing leaves the EU, plus the sub-processor list.
- Security questionnaire to vendor [inferred]
- SOC 2 report, pen test summary and sub-processor list to Jon (Wednesday, April 28) [inferred]
- 10,000-ticket Zendesk export (Friday, May 7) [inferred]
- Dana: Send a revised pricing proposal to Joan, copying Priya, based on 140 seats: Professional tier at $39/agent, an SCIM-inclusive option, the implementation fee, and a labelled two-year option. (deadline: Friday, April 30)
- Marcus: Send Jon the SOC 2 Type II report, pen test executive summary, and sub-processor list once the NDA is signed. (deadline: Wednesday, April 28)
- Dana and Marcus: Put together the integration plan with tasks and estimated hours for each side, including the Salesforce connected app work with Renata. (deadline: Tuesday, May 4)
- Dana: Send the change management playbook and agent-facing materials along with the proposal.
- Jon: Send the mutual NDA before end of day. (deadline: today)
- Jon: Send the security questionnaire. (deadline: Thursday, April 29)
- Tomas: Pull the export of 10,000 anonymized resolved tickets in English and German. (deadline: Friday, May 7)
- Priya: Priya will tell Tomas today so he can start the ticket export before his days off. (deadline: today)
- Joan: Send the business case template and an example of one approved last year. (deadline: Monday, May 3)
- Priya and Dana: Priya and Dana co-write the business case targeting the May 24 deadline for the June 1 committee; Joan will help with the three-year cost portion. (deadline: Monday, May 24)
- Jon: Jon will check with Renata whether she has bandwidth for a Salesforce working session.
- Priya: Priya will ask around to find who owns checking with HR in Rotterdam whether a works council consultation is needed.
- Security questionnaire to Jon [inferred]
- Revised pricing proposal to Joan (copy Priya) [inferred]
- Business case template and example from Joan [inferred]
- Integration plan from Dana and Marcus [inferred]
- Anonymized ticket export from Tomas [inferred]
- Business case due for June 1 committee [inferred]
- Capital and Vendor Review Committee meeting [inferred]

#### Decisions (structured)
- Agreed the call would be listen-first rather than a slide deck, with Marcus later showing how Routewell's routing works against Harbourline's described setup.
- Routewell (Dana and Marcus) will draft a concrete integration plan with named tasks and estimated hours for each side, so Harbourline is not taking the effort estimate on faith. (owner: Dana and Marcus)
- The Dutch works council (ondernemingsraad) consultation question is kept as an open item to be resolved early rather than assumed away. (owner: Dana)
- The team agreed to replace the proposed 60-day live pilot with a scoped proof of concept on anonymized historical tickets. (owner: Priya, Jon, Marcus)
- The proof of concept was scoped to 10,000 resolved tickets from a normal (non-peak) month, limited to English and German for now. (owner: Marcus, Priya)
- Success bar for the proof of concept was agreed at 85% routing accuracy on first assignment across the 10,000 tickets. (owner: Priya, Marcus)
- The decision on whether to enable the LLM ticket-summary feature (especially for the US side) was explicitly left open for separate review. (owner: Priya)
- Ownership of the Zendesk export was moved from Jon's team to Priya's ops analyst Tomas. (owner: Priya)
- Agreed to present the full 140-seat scope to Greg rather than a partial 100-seat year-one deployment, since it goes to Greg either way. (owner: Joan / Priya / Dana)
- Agreed the pricing proposal will include a clearly labelled two-year term option, though Joan expects Greg to insist on one year. (owner: Dana)
- Agreed the pricing proposal goes to Joan (with an A) directly, copying Priya, while Jon receives the security documents. (owner: Dana)
- Agreed Jon, not Priya's legal, will send the mutual NDA today because vendor NDAs now route through him under the new vendor intake process. (owner: Jon)
- Agreed to leave the Rotterdam works council consultation question open for now rather than resolve it on the call. (owner: Priya)
- Next meeting moved to Thursday, May 6 at 3 PM Eastern instead of Tuesday, May 4, and the invite will be sent for it. (owner: Me)
- Go-live moved from Q4 to Q3, targeting Monday, August 16 to give two weeks of overlap with Queuewise before it ends. (owner: Speaker 1)
- Ticket summaries for the US side are parked until after go-live and kept out of the main review. (owner: Speaker 2)
- Proof of concept compressed: load export Monday May 10, run through Thursday May 20, readout Friday May 21. (owner: Speaker 4)
- June 1 committee confirmed as the critical date, which makes the May 24 business case the critical date on the vendor side. (owner: Me)
- Next meeting set for Thursday, May 6 at 3 PM Eastern.
- Use of ticket summaries on the US side is parked until after go-live.

#### Open questions (structured)
- Which exact Zendesk plan Harbourline is on (Jon would know the plan specifics). [open]
- Whether Harbourline will add French language support next year, contingent on a possible hub near Lyon. [open]
- Whether Deflekt will actually deliver an EU region, given Harbourline has 'heard that before' from other vendors. [open]
- Do Harbourline's per-agent override data and any performance-evaluation capability trigger a Dutch works council (ondernemingsraad) consultation? [open]
- How can Harbourline get SCIM provisioning for automated offboarding when it is only included in Routewell's Enterprise tier? [open]
- Whether Dutch and/or Spanish should be added to the proof of concept language scope, or kept to English and German for now. [open]
- Whether the LLM ticket-summary feature should be enabled on the US side. [open]
- Whether the Rotterdam works council requires a consultation, and who on Priya's side is responsible for checking with HR. [open]
- Whether Renata will have bandwidth for the Salesforce connected app working session. [open]
- Whether SCIM gets included and at what price (to be resolved in the proposal). [open]
- Whether Dutch gets added to the proof of concept. [open]
- Whether the Rotterdam works council needs to be consulted, and who owns that check. [open]
- Whether Renata has bandwidth for the Salesforce working session. [open]
- What happens if the June 1 approval doesn't come through (the Queuewise notice risk). [open]
- Whether Greg wants to meet the vendor before the committee. [open]
- Whether there is an option for a short Queuewise extension instead of a full year. [open]
- Whether ticket summaries get used on the US side. [open]

#### Risks (structured)
- [high] Deflekt lacks an EU data residency region, which is a blocker-type concern because Rotterdam is a major part of the support operation.
- [high] Jon's team is only two engineers handling all internal tooling, so any solution requiring heavy integration work is a stated concern.
- [high] The sorter has ~340 keyword rules, nobody fully understands them, some contradict, and the engineer who wrote it left two years ago — an institutional-knowledge risk.
- [high] Harbourline is only hitting the Pro one-hour SLA about 71% of the time and has already paid service credits twice this year.
- [high] A Dutch works council consultation, if required, could delay the project by roughly the four to six weeks it took during the prior WFM tool rollout.
- [high] Agents already burned by the sorter distrust automation, and a single visible AI routing mistake in week one could lose the team.
- [medium] SCIM provisioning being Enterprise-tier-only leaves a gap in automated offboarding, which matters given seasonal agent turnover.
- [medium] Jon's two engineers are already underwater, so any short-term integration load is a concern.
- [medium] Rotterdam team leads are skeptical of automation after a prior workforce management tool felt like surveillance.
- [high] SCIM provisioning is only included in the vendor's Enterprise tier, which is a gap for the customer's offboarding needs.
- [high] The default LLM sub-processor for ticket summaries processes in the US, and the EU endpoint routing option is only in limited availability.
- [high] The customer's vendor security review typically takes six to eight weeks, which is tight for their October timeline.
- [medium] Jon's team is already underwater with CPQ work, so they could not resource the Zendesk export.
- [low] Customer-managed encryption keys are on the vendor roadmap but not available today.
- [medium] A live pilot would require real customer data, forcing the full security review plus a signed DPA first, so it adds a phase rather than saving time.
- [high] Year-one total contract value at 140 seats ($65,520 plus $9,500 implementation) is well over the $40,000 threshold, so CFO Greg Hale must approve and is not a rubber stamp.
- [medium] Greg generally prefers one-year terms with new vendors and dislikes being locked in before a vendor proves itself, making the two-year discount uncertain.
- [medium] Even a reduced 100-seat year-one scope ($46,800) stays above the $40,000 CFO threshold, so the partial option does not avoid Greg's approval and was dropped.
- [medium] Renata is consumed by a CPQ initiative, so her availability for the Salesforce connected app work is uncertain.
- [low] Queuewise renewal plus keeping the sorter is not considered by Priya a truly equivalent competing option, though Greg will accept it as a do-nothing baseline.
- [high] The Queuewise contract ends August 31, not December 31 as previously assumed, invalidating the Q4 go-live plan.
- [high] The 90-day notice clause means notice must go out by June 2, only one day after the June 1 committee approves, leaving a very tight window.
- [high] If Greg doesn't approve on June 1, the customer either renews Queuewise for a full year or has nothing on September 1.
- [high] Jon is nervous the security review cannot be completed in the roughly four weeks to May 24 and won't promise it.
- [medium] The Deflekt EU region is currently a hard blocker for Jon; he would only look again at a live EU region with a SOC 2 that covers it.
- [medium] August 16 go-live is achievable but has little slack, and the schedule cannot slip to July 6.
- [low] Image understanding for photo attachments is not generally available, so it cannot be counted in the evaluation.
- [high] Queuewise notice risk if the approval slips.
- [high] The June 1 approval may not come through, which the team flagged as an open issue.
- [medium] Whether the Rotterdam works council must be consulted is unresolved and no owner has been assigned.

#### Follow-up draft
Subject: Follow-up: Harbourline routing discovery and proof-of-concept scoping

Hi Priya and Jon,

Thank you for the time yesterday — keeping it listen-first rather than a slide deck made it a far more useful conversation. What stayed with me is the picture you both painted: roughly 18% of tickets misrouted on first assignment and adding about six hours before the right person sees them, with the Pro one-hour SLA landing around 71% against the 90% you're measured on and service credits already paid twice this year. We also aligned on trading the live pilot for a scoped proof of concept — 10,000 anonymized English and German tickets from a normal month, run against an 85% first-assignment routing bar with a May 21 readout — plus an integration plan with named tasks and estimated hours for both sides to Jon by May 4, and the go-live shift to Monday, August 16 given that the Queuewise term actually ends August 31. The one point I don't want to leave loose is SCIM provisioning, since it sits in the Enterprise tier and automated offboarding matters a great deal with your seasonal turnover — we'll set out the options and pricing for that alongside the proposal going to Joan. Looking forward to picking this up on Thursday, May 6 at 3 PM Eastern.

Best regards,
Dana
Routewell
