# TEAM-S — team_meeting, short (7.4 min, 1020 words)

**Source transcript:** `benchmark/transcripts/src/TEAM-S.txt`  
**Reference fact sheet:** `benchmark/references/TEAM-S.json`  
**Context:** A short daily standup for Stridewell's mobile app team, run by team lead Dana Whitfield. The iOS, Android, backend and QA engineers give yesterday/today/blocker updates ahead of the 4.12.0 release, and the team moves the release branch cut and reassigns a ticket.

## What a good summary must include
- Release 4.12.0 branch cut moved to Thursday 2pm, store submission still Monday (F01, F02, F03)
- Joan: full regression on build 321, results by Wednesday 5pm (F04, F21)
- Theo blocked on platform team adding Apple sign-in client secret to the production vault; Dana escalating to Jon by noon today (F05, F06, F07)
- Android 4.11.2 crash rate 0.8% (not 8%), mostly MOB-1440 on Samsung Android 14; fix goes into 4.12 if it lands, no hotfix decided (F08, F09, F11)
- MOB-1431 reassigned from Ravi to Katya; Ravi on App Store screenshots and release notes (F12, F13)
- Workout history endpoint on staging, p95 4s to 1.9s (F17)
- Regression on build 318: 142 cases, 9 failures, 2 real bugs (F20)
- Android 9 support question taken offline and unresolved (F23)

## Most important disagreements (judge fact checks)

✔ present · ◐ partial · ✘ missing · ⚠ contradicted

| Fact | Imp. | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|
| (no disagreements on critical/important facts) | | |

## Judge-flagged problems

**A** — overall 5/10, accuracy 8, retention 9, conciseness 3
- critical: Reported load-testing the workout history endpoint as an action item for Theo, when it was only a preference and not assigned.
- suggestion reported as decision: Load testing the workout history endpoint before prod (Theo's wish, not assigned)

**B** — overall 6/10, accuracy 9, retention 10, conciseness 3
- none flagged

**C** — overall 6/10, accuracy 10, retention 10, conciseness 2
- none flagged

**D** — overall 5/10, accuracy 7, retention 9, conciseness 2
- critical: Reported Theo's wish to load test the workout history endpoint as an assigned action item, when it was explicitly not assigned.
- hallucination: Inferred an action item for Theo to load test the workout history endpoint, which was not committed to.
- suggestion reported as decision: Load testing the workout history endpoint before prod (Theo's wish, not assigned)

**E:** (not judged)
**F** — overall 7/10, accuracy 8, retention 10, conciseness 5
- hallucination: Theo assigned an action item to load test the workout history endpoint
- hallucination: Katya listed as the owner of the decision to reject cherry-picking
- suggestion reported as decision: Load testing the workout history endpoint before prod (reported as an action item)


---

# Summary A

_(run1)_

### Title: 4.12 Release Planning and Crash Review

#### Overview
The team reviewed 4.12 progress, moved the release branch cut to Thursday at 2pm, assigned regression and feature work, and escalated a production-vault dependency blocking Apple sign-in. Key decisions: The 4.12 release branch cut was moved from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.; MOB-1440 will go into 4.12 if it lands in time, and the team will reassess crash numbers on Thursday before deciding whether a 4.11.3 hotfix is needed.; The team will not decide on an Android 9 support change during this standup and will discuss it offline.. Progress since last sync: Ravi finished MOB-1423, merged the iOS workout-timer background-drift fix, and included it in TestFlight build 318 released last night.

#### Summary
- Ravi finished MOB-1423, merged the iOS workout-timer background-drift fix, and included it in TestFlight build 318 released last night.
- The team reviewed 4.12 progress, moved the release branch cut to Thursday at 2pm, assigned regression and feature work, and escalated a production-vault dependency blocking Apple sign-in.
- The 4.12 release branch cut was moved from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.
- MOB-1440 will go into 4.12 if it lands in time, and the team will reassess crash numbers on Thursday before deciding whether a 4.11.3 hotfix is needed.
- Android 4.11.2 crash rate is 0.8 percent, approximately double the usual 0.4 percent baseline, concentrated in a Samsung Android 14 heart-rate sync null pointer.

#### Progress since last sync
- Ravi finished MOB-1423, merged the iOS workout-timer background-drift fix, and included it in TestFlight build 318 released last night.
- The MOB-1423 root cause was reliance on the display-link timer rather than wall-clock time, causing 20–30 seconds of timer loss after roughly ten minutes in the background.
- Ravi began MOB-1431, which fixes push-notification deep links opening the wrong screen, and reproduced it on an iPhone 13.
- Katya investigated the Android 4.11.2 crash spike and identified MOB-1440 as a Samsung Android 14 heart-rate-sync null pointer affecting an elevated 0.8 percent crash rate.
- Theo deployed the new workout-history endpoint to staging and reduced p95 latency from about 4 seconds to 1.9 seconds through pagination at 50 workouts per page.
- The workout-history pagination is backwards compatible because 4.11 clients receive the first page by default.
- Joan ran regression against build 318 with 142 cases and 9 failures, of which onboarding flakiness accounted for most and two were real bugs.
- CI produced newer build 321 with Katya's offline-sync fix, so Joan switched the planned rerun from stale build 318 to build 321.

#### Decisions
- The release branch cut is Thursday at 2pm rather than Wednesday, with store submission still planned for Monday.
- MOB-1440 will be included in 4.12 if it lands in time, and crash numbers will be reviewed again Thursday before any hotfix decision.
- The Android 9 support question, including its backend authentication implications, will be handled in an offline discussion rather than this standup.
- The team will use the build 321 rerun to inform any decision about disabling flaky onboarding with a feature flag.

#### Blockers
- Theo cannot complete the Apple sign-in token-refresh work because he lacks write access to the production vault and the required client secret has not been added.
- The missing production-vault secret prevents the Apple sign-in fix from entering 4.12.
- The Android 4.11.2 crash rate remains elevated at 0.8 percent versus a 0.4 percent baseline.
- Joan cannot complete a full regression pass by tomorrow and estimated only 60 percent completion, contributing to the branch-cut risk.
- The Pixel 8 device-lab unit does not hold a charge, so Joan needs borrowed devices for testing.
- Onboarding remains flaky, with most of the build 318 regression failures attributed to that known issue.

#### Dependencies
- Theo's Apple sign-in work depends on the platform team, specifically Jon, adding a new client secret to the production vault.
- The Apple sign-in fix is sequenced behind the production-vault secret and therefore affects whether the fix can be included in 4.12.
- Katya's MOB-1431 work is sequenced after her MOB-1440 crash fix, with the handoff coming from Ravi.
- The branch-cut timing depends on the regression results from build 321 and the availability of the crash and Apple sign-in fixes.
- The Android 9 support discussion has backend implications because an old authentication path is maintained specifically for those clients.
- Joan's regression work depends on using current build 321 rather than stale build 318, which contains the offline-sync fix.

#### Follow-up needed
- Reassess Android crash numbers on Thursday and decide whether a 4.11.3 hotfix is necessary.
- Schedule the offline discussion about Android 9 support, including the backend authentication-path impact.
- Review the build 321 regression results to determine whether onboarding should be disabled with a feature flag.
- Confirm the platform-team response on the production-vault secret to Theo by noon.
- Load-test the workout-history endpoint before production promotion.

#### Action items (structured)
- Joan: Complete a full regression pass on build 321 and post the results in the release channel. (deadline: Wednesday 5pm)
- Dana: Escalate the request for the Apple sign-in client secret to Jon and his manager and provide Theo an answer. (deadline: Today at noon)
- Katya: Write the MOB-1440 Android crash fix and aim to open a pull request. (deadline: This afternoon, intended)
- Katya: Take over MOB-1431 after MOB-1440. (deadline: Tomorrow, intended)
- Ravi: Hand off MOB-1431 to Katya with the existing reproduction notes.
- Ravi: Prepare the App Store screenshots and 4.12 release notes.
- Joan: Rerun the regression suite on build 321 instead of filing tickets against stale build 318.
- Theo: Load-test the workout history endpoint before production release. [inferred]
- Dana: Escalation response for Theo's production-vault dependency (deadline: Today at noon) [inferred]
- Joan: Joan to post full regression results for build 321 (deadline: Wednesday 5pm) [inferred]
- Release branch cut (deadline: Thursday at 2pm) [inferred]
- App Store and Play Store submission (deadline: Monday) [inferred]

#### Decisions (structured)
- The 4.12 release branch cut was moved from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.
- MOB-1440 will go into 4.12 if it lands in time, and the team will reassess crash numbers on Thursday before deciding whether a 4.11.3 hotfix is needed.
- The team will not decide on an Android 9 support change during this standup and will discuss it offline.
- The team will wait for the build 321 regression rerun before considering feature-flagging the flaky onboarding flow.

#### Open questions (structured)
- Will MOB-1440 land in time for 4.12, or will a 4.11.3 hotfix be required? [open]
- Should the team continue supporting Android 9, given its 3 percent user share and associated crashes? [open]
- Will the onboarding flow need to be feature-flagged off after the build 321 rerun? [open]
- When will the platform team add the Apple sign-in client secret to the production vault? [open]

#### Risks (structured)
- [high] Android 4.11.2 crash rate is 0.8 percent, approximately double the usual 0.4 percent baseline, concentrated in a Samsung Android 14 heart-rate sync null pointer.
- [high] Apple sign-in cannot enter 4.12 without the production-vault client secret from the platform team.
- [high] The release schedule is at risk because Joan can complete only about 60 percent of the regression pass by tomorrow, while Theo's blocker and Katya's crash fix remain unresolved.
- [medium] Build 318 produced 9 regression failures across 142 test cases, including two real bugs, although build 321 is now the relevant build.
- [medium] The Pixel 8 in the device lab cannot hold a charge, reducing available device coverage.
- [medium] The workout history endpoint still needs load testing before production despite its p95 latency improvement from about 4 seconds to 1.9 seconds.

#### Follow-up draft
Hi team,

Decisions
4.12 branch cut moves to Thursday at 2pm; store submission remains Monday. MOB-1440 is targeted for 4.12 if it lands in time, with Thursday crash review deciding whether 4.11.3 is needed. Build 321 will determine whether onboarding should be feature-flagged. Android 9 support will be discussed offline.

Blockers
Apple sign-in remains blocked on Jon adding the client secret to the production vault, preventing inclusion in 4.12. Android 4.11.2 crashes remain elevated at 0.8% vs. 0.4%, concentrated in MOB-1440. Regression coverage is limited to about 60%, and the Pixel 8 lab device is unavailable. Workout-history still needs load testing before production.

Ravi’s MOB-1423 fix shipped in TestFlight build 318; Theo’s paginated endpoint reduced p95 latency to 1.9s. Joan’s rerun is on build 321.

Thanks,

---

# Summary B

_(run1)_

### Title: Standup and Release Prep Notes

#### Overview
Dana's team standup covered 4.12.0 release progress, moved the release branch cut from Wednesday to Thursday 2pm, and escalated an unresolved production vault blocker for Theo's Apple sign-in fix. Key decisions: Postedpone deciding on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and crash numbers are reviewed again Thursday.; The 4.12.0 release branch cut is moved from Wednesday to Thursday at 2pm.; App Store and Play Store submission stays on Monday.. Progress since last sync: Ravi finished MOB-1423, the iOS workout timer drifting when the app backgrounds; root cause was trusting the display link timer instead of wall clock time (10 min in background = 20-30s lost); it's merged.

#### Summary
- Ravi finished MOB-1423, the iOS workout timer drifting when the app backgrounds; root cause was trusting the display link timer instead of wall clock time (10 min in background = 20-30s lost); it's merged.
- Dana's team standup covered 4.12.0 release progress, moved the release branch cut from Wednesday to Thursday 2pm, and escalated an unresolved production vault blocker for Theo's Apple sign-in fix.
- Postedpone deciding on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and crash numbers are reviewed again Thursday.
- The 4.12.0 release branch cut is moved from Wednesday to Thursday at 2pm.
- MOB-1440 null pointer crash in the heart rate sync service on Samsung Android 14 devices drives Android 4.11.2 crash rate to 0.8 percent, roughly double the ~0.4 percent baseline.

#### Progress since last sync
- Ravi finished MOB-1423, the iOS workout timer drifting when the app backgrounds; root cause was trusting the display link timer instead of wall clock time (10 min in background = 20-30s lost); it's merged.
- MOB-1423 shipped in TestFlight build 318 last night.
- Katya found the Android 4.11.2 crash rate at 0.8 percent (initially misspoke as 8 percent), about double the ~0.4 percent baseline, almost entirely MOB-1440 (null pointer in heart rate sync on Samsung Android 14).
- Theo deployed the new workout history endpoint to staging, cutting p95 latency from ~4 seconds to 1.9 seconds by paginating to 50 workouts per page.
- The pagination change is backwards compatible: old 4.11 clients just get the first page by default with nothing breaking.
- Joan ran the regression suite against build 318: 142 test cases, 9 failures, most known onboarding flakiness but 2 real bugs (the deep link issue and Android offline mode not syncing saved routes).
- Ravi flagged that build 318 is stale; CI produced build 321 about an hour ago containing the offline sync fix Katya merged last night.
- Joan is borrowing two Pixel devices from the design team because the device lab's Pixel 8 no longer holds a charge.

#### Decisions
- No decision yet on a 4.11.3 hotfix: if MOB-1440 lands in time it goes into 4.12, with crash numbers revisited Thursday.
- Release branch cut moved from Wednesday to Thursday at 2pm.
- App Store and Play Store submission stays on Monday.
- MOB-1431 ownership transferred from Ravi to Katya.
- Android 9 support discussion taken offline, including its backend auth path implications.
- The team agreed not to decide on feature-flagging the new onboarding until the rerun on build 321 results come in.

#### Blockers
- Theo is blocked on the Apple sign-in token refresh work: platform team needs to add the new client secret to the production vault and he lacks write access; Jon said he'd look at it Friday but nothing has moved.
- Without the vault secret the Apple sign-in fix cannot make it into 4.12 at all.
- Joan cannot complete a full regression pass by tomorrow — she estimates only ~60 percent, hampered by Theo's unresolved blocker and Katya's crash fix not yet in.
- The device lab's Pixel 8 won't hold a charge, blocking QA on that device until borrowed Pixels arrive.
- The Android 4.11.2 crash rate at 0.8 percent is about double the ~0.4 percent baseline and driven by MOB-1440, which isn't fixed yet.

#### Dependencies
- Theo's Apple sign-in fix depends entirely on the platform team (Jon) adding the new client secret to the production vault.
- MOB-1431 handoff from Ravi to Katya depends on Ravi's notes and reproduction steps (reproduced on iPhone 13).
- The regression pass is sequenced on build 321 (not 318) since 321 includes the offline sync fix Katya merged last night.
- The Android 9 support question has a backend dependency: an old auth path is kept alive just for those older clients.

#### Follow-up needed
- Dana needs to confirm the vault secret escalation outcome to Theo by noon today.
- Revisit Android 4.11.2 crash numbers on Thursday to inform the hotfix-vs-4.12 decision.
- Schedule an offline conversation on Android 9 support that also covers backend auth implications.
- Use the rerun on build 321 to decide whether the new onboarding should be feature-flagged off.
- Theo is to hear from Dana by noon regarding his blocker, as stated at the close of standup.
- Jon on platform still needs to be chased for the production vault client secret, since it was promised Friday and hasn't happened.

#### Action items (structured)
- Dana: Escalate the production vault client-secret blocker by pinging Jon and his manager directly and get Theo an answer by noon today. (deadline: noon today)
- Joan: Run a full regression pass on build 321 and post results in the release channel by Wednesday 5pm. (deadline: Wednesday 5pm)
- Katya: Write the fix for MOB-1440 (Android heart rate sync null pointer crash) and aim to have a PR up by this afternoon. (deadline: this afternoon)
- Katya: Take over MOB-1431 (push notification deep link opening wrong screen) after MOB-1440, expected tomorrow. (deadline: tomorrow)
- Ravi: Hand over MOB-1431 to Katya with his notes, having reproduced it on an iPhone 13.
- Ravi: Take on App Store screenshots and release notes for 4.12 instead of MOB-1431.
- Joan: Triage the remaining regression failures and write up tickets.
- Theo: Load test the new workout history endpoint before it goes to prod.
- Joan: Rerun the regression suite on build 321 instead of 318.
- Dana: Schedule a separate offline conversation on Android 9 support (including backend auth path).
- Release branch cut moved to Thursday 2pm [inferred]
- Full regression pass results due Wednesday 5pm [inferred]
- Dana to answer on vault escalation by noon today [inferred]

#### Decisions (structured)
- Postedpone deciding on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and crash numbers are reviewed again Thursday. (owner: Dana)
- The 4.12.0 release branch cut is moved from Wednesday to Thursday at 2pm. (owner: Dana)
- App Store and Play Store submission stays on Monday. (owner: Dana)
- MOB-1431 is reassigned from Ravi to Katya (she takes it after MOB-1440, tomorrow). (owner: Katya)
- Discussion of whether to keep supporting Android 9 is deferred to an offline conversation that also covers backend implications. (owner: Dana)

#### Open questions (structured)
- Should the team keep supporting Android 9 given it's ~3 percent of users and causes many weird crashes? [open]
- Should the new onboarding be feature-flagged off if it's still flaky? [open]
- Can a full regression pass realistically be completed by tomorrow? [open]

#### Risks (structured)
- [high] MOB-1440 null pointer crash in the heart rate sync service on Samsung Android 14 devices drives Android 4.11.2 crash rate to 0.8 percent, roughly double the ~0.4 percent baseline.
- [high] Theo is blocked on the Apple sign-in fix because platform hasn't added the new client secret to the production vault and he lacks write access; without it the fix cannot go into 4.12 at all.
- [medium] Joan estimates only about 60 percent of a full regression pass is achievable by tomorrow, given Theo's blocker and Katya's crash fix still outstanding.
- [medium] Cherry-picking late fixes onto the branch is risky; Katya notes it caused the loss of the analytics fix in 4.10.
- [low] The device lab's Pixel 8 won't hold a charge, forcing Joan to borrow two Pixel devices from the design team.

#### Follow-up draft
Hi team,

Quick update from standup.

Shipped since last sync
Ravi's MOB-1423 fix (iOS workout timer drifting in background) is merged and went out in TestFlight build 318. Theo's workout history endpoint is on staging, p95 down from ~4s to 1.9s via pagination to 50 per page, backwards compatible.

Decisions
Release branch cut for 4.12.0 moves from Wednesday to Thursday 2pm; App Store and Play Store submission stays Monday. No call yet on a 4.11.3 hotfix: if MOB-1440 lands in time it rides in 4.12, and we revisit crash numbers Thursday. MOB-1431 moves from Ravi to Katya. Android 9 support and its backend auth implications go to an offline conversation. No decision on feature-flagging the new onboarding until the rerun on build 321 comes back.

Blockers
Theo is still blocked on the Apple sign-in fix: platform needs to add the new client secret to the production vault and he has no write access. Jon said he'd look Friday and nothing has moved, so without the vault secret the fix can't make 4.12 at all. Dana is confirming the escalation outcome to Theo by noon. MOB-1440 (null pointer in heart rate sync on Samsung Android 14) is driving the Android 4.11.2 crash rate to 0.8 percent, about double our ~0.4 percent baseline, and isn't fixed yet. Joan can only get through roughly 60 percent of a full regression pass by tomorrow, with the rerun now on build 321. The device lab Pixel 8 won't hold a charge, so Joan is borrowing two from design.

Thanks,

---

# Summary C

_(run2)_

### Title: 4.12.0 Release Readiness Review

#### Overview
The team moved the 4.12 release-branch cut to Thursday at 2 p.m., kept store submission on Monday, and assigned the remaining crash, regression, secret, and release-material work. Key decisions: The 4.12 release branch will be cut Thursday at 2 p.m. instead of Wednesday, while App Store and Play Store submission remains on Monday.; The team deferred a separate 4.11.3 hotfix decision; MOB-1440 goes into 4.12 if it lands in time, and crash numbers will be reviewed Thursday.; QA will rerun the suite on build 321 instead of filing tickets against stale build 318.. Progress since last sync: Ravi completed and merged MOB-1423, fixing the iOS workout timer drift when the app backgrounds.

#### Summary
- The meeting focused on release readiness, including branch timing, QA status, and crash risks.
- The team moved the release-branch cut to Thursday at 2 p.m. while keeping App Store and Play Store submission on Monday, and deferred a separate hotfix decision.
- Build 321 supersedes stale build 318 for QA, with the onboarding feature-flag decision contingent on rerun results; Android crashes remain above baseline, and the Apple sign-in fix cannot enter the release without the production vault secret.

#### Progress since last sync
- Ravi completed and merged MOB-1423, fixing the iOS workout timer drift when the app backgrounds.
- The timer bug came from trusting display-link time instead of wall-clock time, causing 20–30 seconds to be lost after roughly ten minutes in the background.
- The MOB-1423 fix shipped in TestFlight build 318 last night.
- Katya corrected the Android 4.11.2 crash-rate report to 0.8%, roughly twice the usual 0.4% baseline.
- The crash spike is concentrated in MOB-1440, a null pointer in heart-rate sync on Samsung devices running Android 14.
- Theo deployed the workout history endpoint to staging and improved p95 latency from about 4 seconds to 1.9 seconds.
- The latency improvement came mainly from paginating the query at 50 workouts per page instead of loading the full history.
- The workout-history pagination remains backward compatible because 4.11 clients receive the first page by default.
- Joan ran build 318's regression suite across 142 test cases and found 9 failures, most of them known onboarding flakiness and 2 real bugs.
- The 2 real build-318 bugs were the wrong-screen push deep link and Android offline mode failing to sync saved routes.
- CI produced build 321 about an hour before the sync, and it contains Katya's offline-sync fix, making build 318 stale.
- Ravi reproduced MOB-1431 on an iPhone 13 and prepared to hand his notes to Katya.

#### Decisions
- The release branch cut moved from Wednesday to Thursday at 2 p.m., with Monday store submission unchanged.
- The team deferred deciding on a 4.11.3 hotfix and will put MOB-1440 in 4.12 if it lands in time, then review crash numbers Thursday.
- QA will rerun on build 321 rather than file tickets against build 318.
- The team chose the later branch cut instead of a Wednesday cut followed by late cherry-picks because a previous cherry-pick lost the analytics fix in 4.10.
- MOB-1431 ownership moved to Katya after MOB-1440, with Ravi providing the handoff notes.
- The team will wait for the build 321 rerun before deciding whether to disable the new onboarding with a feature flag.
- The Android 9 support question was deferred to an offline discussion that also covers its backend implications.

#### Blockers
- Theo cannot complete the production portion of the Apple sign-in work because he lacks write access to the vault and the new secret is not present.
- The missing production secret prevents the Apple sign-in fix from entering 4.12 at all.
- Joan estimated only about 60% of a full regression by tomorrow because Theo's blocker was unresolved and Katya's crash fix had not landed.
- MOB-1440's crash fix had not landed at the time of the branch-readiness discussion.
- The initial QA results are stale because they were run on build 318 and must be repeated on build 321.
- The device lab's Pixel 8 no longer holds a charge, so Joan needs borrowed Pixel devices to continue coverage.
- Known onboarding flakiness and two real bugs remain in the regression signal while the team evaluates whether to disable onboarding.
- A separate 4.11.3 hotfix would add a second full regression pass, creating additional QA work.

#### Dependencies
- Theo's Apple sign-in work depends on the platform team or Jon adding the client secret to the production vault.
- The Apple sign-in fix's inclusion in 4.12 is sequenced behind the vault-secret handoff.
- Whether MOB-1440 rides in 4.12 depends on the fix landing before the new Thursday branch cut and the subsequent crash review.
- QA's release-readiness signal depends on rerunning the suite against build 321, which contains the offline-sync fix and supersedes build 318.
- Android QA coverage depends on the design team lending Joan two Pixel devices while the lab Pixel 8 is unusable.
- MOB-1431 work is sequenced after Katya finishes MOB-1440 and depends on Ravi's reproduction-note handoff.
- The workout history endpoint's production promotion depends on a load test after the staging performance improvement.
- The Thursday 2 p.m. branch cut must precede the planned Monday App Store and Play Store submission.
- The Android 9 support decision depends on an offline conversation that includes the backend's legacy auth path.
- The onboarding feature-flag decision depends on the results of the build 321 rerun.

#### Follow-up needed
- Dana should report the result of the Jon and manager escalation by noon so the Apple sign-in release dependency can be resolved.
- Check Katya's MOB-1440 PR when it arrives and confirm whether the fix can enter 4.12.
- Review the Android crash numbers Thursday and revisit the deferred hotfix question.
- Run and publish the full build 321 regression results by Wednesday at 5 p.m.
- Use the build 321 regression results to decide whether the new onboarding needs a feature flag.
- Complete the workout-history load test before promoting the endpoint to production.
- Schedule the offline Android 9 discussion with the backend/auth-path implications included.
- Confirm Ravi's MOB-1431 handoff and Katya's takeover after MOB-1440 tomorrow.
- Track the Thursday branch cut against the unchanged Monday store-submission plan.

#### Action items (structured)
- Katya: Write the MOB-1440 fix for the Samsung Android 14 heart-rate sync crash and target a PR this afternoon. (deadline: this afternoon)
- Theo: Continue the Apple sign-in token-refresh changes.
- Platform team / Jon: Add the new Apple sign-in client secret to the production vault. [inferred]
- Dana: Escalate the production-vault secret request to Jon and his manager and provide an answer. (deadline: noon today)
- Theo: Load-test the workout history endpoint before it goes to production. [inferred]
- Joan: Rerun the full regression pass on build 321 and post the results in the release channel. (deadline: Wednesday 5 p.m.)
- Joan: Borrow two Pixel devices from the design team for QA coverage.
- Ravi: Prepare the App Store screenshots and 4.12 release notes.
- Ravi: Hand MOB-1431's reproduction notes to Katya.
- Katya: Take over MOB-1431 after MOB-1440. (deadline: tomorrow)
- Team: Review the crash numbers again Thursday. (deadline: Thursday)
- Dana: Find a time for an offline discussion of Android 9 support and its backend implications.
- Katya: Target PR for the MOB-1440 fix (deadline: this afternoon) [inferred]
- Dana: Return an answer on the production-vault secret escalation (deadline: noon today) [inferred]
- Cut the 4.12 release branch (deadline: Thursday at 2 p.m.) [inferred]
- Review the Android crash numbers (deadline: Thursday) [inferred]
- Submit the release to the App Store and Play Store (deadline: Monday) [inferred]

#### Decisions (structured)
- The 4.12 release branch will be cut Thursday at 2 p.m. instead of Wednesday, while App Store and Play Store submission remains on Monday.
- The team deferred a separate 4.11.3 hotfix decision; MOB-1440 goes into 4.12 if it lands in time, and crash numbers will be reviewed Thursday.
- QA will rerun the suite on build 321 instead of filing tickets against stale build 318.
- The team chose not to cut Wednesday and cherry-pick late fixes because a prior cherry-pick lost the analytics fix in 4.10.
- MOB-1431 is now Katya's work after MOB-1440, with Ravi handing over his reproduction notes. (owner: Katya)
- The team will wait for build 321's rerun before considering a feature flag to disable the new onboarding.
- The Android 9 support question, including its backend impact, was moved to an offline discussion rather than handled in this standup.

#### Open questions (structured)
- Will MOB-1440 land in time for 4.12, or will the team need the previously suggested 4.11.3 hotfix? [open]
- Will Thursday's crash review show improvement from the current 0.8% rate toward the 0.4% baseline? [open]
- Will Jon or the platform team add the Apple sign-in client secret to the production vault, and when? [open]
- Can QA complete and post the full build 321 regression by Wednesday at 5 p.m. after estimating only 60% by tomorrow? [open]
- Should the new onboarding be feature-flagged off after the build 321 rerun? [open]
- Will the staged workout history endpoint pass the requested load test before production? [open]
- Should Android 9 support be retained given that it represents about 3% of users and requires an old backend auth path? [open]

#### Risks (structured)
- [high] The Android 4.11.2 crash rate is 0.8%, roughly double the 0.4% baseline.
- [high] MOB-1440 is a null-pointer crash in heart-rate sync affecting Samsung devices running Android 14.
- [high] The Apple sign-in fix cannot be included in 4.12 until the production vault secret is added.
- [high] The build-318 regression exposed 9 failures, including 2 real bugs, while known onboarding flakiness remains.
- [high] QA readiness is at risk because Joan estimated only about 60% of the full regression by tomorrow while Theo's blocker and Katya's crash fix remained unresolved.
- [medium] The device lab's Pixel 8 will not hold a charge, reducing Android test coverage until replacement devices are borrowed.
- [medium] The workout history endpoint still needs a load test before production despite the staging latency improvement.
- [medium] A separate 4.11.3 hotfix would require a second full regression pass and add release-test load.
- [medium] Dropping Android 9 could affect the backend because an old authentication path is maintained specifically for those clients.
- [medium] The new onboarding may remain flaky enough to require disabling it through a feature flag after the rerun.

#### Follow-up draft
Hi team,

Decisions:
The 4.12 branch cut moves to Thursday at 2 p.m.; App Store and Play Store submission remains Monday. The 4.11.3 hotfix decision is deferred; MOB-1440 goes into 4.12 if it lands in time, with crash numbers reviewed Thursday. QA will rerun on build 321, which supersedes stale build 318, before deciding whether to disable the new onboarding with a feature flag. MOB-1431 moves to Katya after MOB-1440, with Ravi providing reproduction notes. Since last sync, Ravi merged MOB-1423, fixing iOS timer drift, and Theo improved staged workout-history p95 from about 4 seconds to 1.9 seconds.

Blockers:
Android crashes remain at 0.8% versus the 0.4% baseline, and MOB-1440's Samsung Android 14 heart-rate sync fix has not landed. The Apple sign-in fix cannot enter 4.12 because Theo lacks vault write access and the production secret is missing. The build 321 regression is pending; build 318 showed 9 failures, including 2 real bugs, onboarding remains flaky, and Joan needs borrowed Pixel devices while the lab Pixel 8 is unusable. The workout-history endpoint still needs a load test before production.

Thanks,

---

# Summary D

_(run1)_

### Title: 4.12 Release Planning and Crashes

#### Overview
The team moved the 4.12 release branch cut to Thursday at 2pm, assigned regression and release-content work, and identified the production vault secret as a blocker for Apple Sign-In. Key decisions: The 4.12 release branch cut will move from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.; MOB-1440 will be targeted for 4.12 if it lands in time, and the team will reassess crash numbers Thursday before deciding whether a 4.11.3 hotfix is needed.; MOB-1431 ownership moved to Katya after she completes MOB-1440.. Progress since last sync: Ravi finished and merged MOB-1423, fixing workout timer drift when the iOS app backgrounds, and shipped it in TestFlight build 318.

#### Summary
- Ravi finished and merged MOB-1423, fixing workout timer drift when the iOS app backgrounds, and shipped it in TestFlight build 318.
- The team moved the 4.12 release branch cut to Thursday at 2pm, assigned regression and release-content work, and identified the production vault secret as a blocker for Apple Sign-In.
- The 4.12 release branch cut will move from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.
- MOB-1440 will be targeted for 4.12 if it lands in time, and the team will reassess crash numbers Thursday before deciding whether a 4.11.3 hotfix is needed.
- The Android 4.11.2 crash rate is 0.8%, approximately double the usual 0.4% baseline, primarily affecting Samsung devices on Android 14.

#### Progress since last sync
- Ravi finished and merged MOB-1423, fixing workout timer drift when the iOS app backgrounds, and shipped it in TestFlight build 318.
- The MOB-1423 fix addresses timer loss of roughly 20–30 seconds after about ten minutes in the background by using wall-clock time instead of the display-link timer.
- Katya investigated the Android 4.11.2 crash spike and identified MOB-1440 as a null-pointer crash in heart-rate sync on Samsung Android 14 devices.
- Theo deployed the new workout history endpoint to staging and reduced p95 latency from about 4 seconds to 1.9 seconds through pagination.
- The workout history pagination is backward compatible with 4.11 clients because older clients receive the first page by default.
- Joan ran regression against build 318 with 142 test cases and 9 failures, including the MOB-1431 deep-link bug and Android offline route-sync failure.
- CI produced build 321 with Katya's offline-sync fix, making build 318 stale for regression testing.

#### Decisions
- The release branch cut was moved to Thursday at 2pm instead of Wednesday, with store submission still planned for Monday.
- MOB-1440 will go into 4.12 if it lands in time, while the hotfix decision waits for Thursday crash data.
- Regression will be rerun on build 321 rather than filing tickets against stale build 318.
- Katya will take over MOB-1431 after MOB-1440, with Ravi handing over his reproduction notes.

#### Blockers
- Theo's Apple Sign-In token refresh work is blocked because he lacks write access to the production vault and the required client secret has not been added.
- The Apple Sign-In fix cannot enter 4.12 unless the vault secret blocker is resolved.
- The elevated Android crash rate is a release concern because it is about twice the normal baseline.
- Regression readiness was insufficient for a Wednesday branch cut because Joan estimated only 60% completion and key fixes were not yet included.
- The device lab's Pixel 8 cannot hold a charge, requiring Joan to borrow two Pixel devices from the design team.

#### Dependencies
- Theo's 4.12 Apple Sign-In delivery depends on the platform team adding the client secret to the production vault.
- The release schedule depends on Katya completing MOB-1440 and Theo resolving the vault dependency before the Thursday branch cut.
- Joan's regression coverage depends on using build 321 rather than stale build 318 and on access to working Pixel devices.
- The Android 9 support discussion has backend sequencing implications because an old authentication path is maintained for those clients.

#### Follow-up needed
- Review the Android crash numbers Thursday and decide whether a 4.11.3 hotfix is necessary.
- Schedule an offline discussion about whether to continue Android 9 support and account for the backend authentication path.
- Use the build 321 regression results to determine whether the onboarding flow needs to be feature-flagged off.
- Load test the workout history endpoint before promoting it to production.

#### Action items (structured)
- Joan: Complete a full regression pass on build 321 and post the results in the release channel. (deadline: Wednesday 5pm)
- Dana: Escalate the request for the Apple Sign-In client secret to Jon and his manager and provide Theo an answer. (deadline: Today by noon)
- Katya: Write the MOB-1440 fix and aim to open a pull request. (deadline: This afternoon)
- Ravi: Hand off MOB-1431 to Katya with the existing reproduction notes.
- Ravi: Prepare the App Store screenshots and 4.12 release notes.
- Theo: Load test the new workout history endpoint before production release. [inferred]
- Apple Sign-In vault-access escalation response (deadline: Today by noon) [inferred]
- Regression results posted (deadline: Wednesday 5pm) [inferred]
- Release branch cut (deadline: Thursday at 2pm) [inferred]
- App Store and Play Store submission (deadline: Monday) [inferred]

#### Decisions (structured)
- The 4.12 release branch cut will move from Wednesday to Thursday at 2pm, while App Store and Play Store submission remains Monday.
- MOB-1440 will be targeted for 4.12 if it lands in time, and the team will reassess crash numbers Thursday before deciding whether a 4.11.3 hotfix is needed.
- MOB-1431 ownership moved to Katya after she completes MOB-1440.
- The team will wait for the build 321 regression rerun before considering a feature flag to disable the flaky onboarding flow.

#### Open questions (structured)
- Whether a 4.11.3 hotfix is needed for the Android 14 Samsung heart-rate sync crash remains unresolved pending Thursday crash numbers. [open]
- Whether Android 9 support should be discontinued remains open and will be discussed offline, including its backend authentication implications. [open]
- Whether the new onboarding flow should be feature-flagged off depends on the build 321 regression rerun. [open]

#### Risks (structured)
- [high] The Android 4.11.2 crash rate is 0.8%, approximately double the usual 0.4% baseline, primarily affecting Samsung devices on Android 14.
- [high] Theo cannot complete the Apple Sign-In token refresh work for 4.12 until the platform team adds the client secret to the production vault.
- [medium] The regression suite on build 318 had 9 failures across 142 cases, including onboarding flakiness and two real bugs.
- [high] Joan cannot complete a full regression pass by the original Wednesday branch-cut timing, estimating only 60% completion while other fixes remain outstanding.
- [medium] The Pixel 8 in the device lab cannot hold a charge, so Joan needs borrowed Pixel devices for testing.

#### Follow-up draft
Hi team,

Decisions
4.12 branch cut moves to Thursday at 2pm; App Store and Play Store submission remains Monday. MOB-1440 is targeted for 4.12 if it lands in time, and Katya will take MOB-1431 afterward. Regression will rerun on build 321, with the onboarding feature-flag decision pending those results. Ravi’s MOB-1423 timer fix shipped in TestFlight build 318, and workout history staging p95 improved to 1.9s.

Blockers
Apple Sign-In is blocked until the platform team adds the client secret to the production vault. Android 4.11.2 crashes are at 0.8% versus a 0.4% baseline, mainly on Samsung Android 14; Thursday’s data will determine whether a 4.11.3 hotfix is needed. Regression also depends on working Pixel devices; the lab Pixel 8 cannot hold a charge.

Thanks,

---

# Summary E

_(run1)_

### Title: 4.12 Release and Crash Spike

#### Overview
The meeting focused on upcoming release planning, mobile fixes, Android crashes, regression readiness, Apple sign-in, and Android 9 support. The iOS workout timer fix was merged and shipped in a TestFlight build, while the elevated Android crash rate was traced mainly to a Samsung Android heart-rate sync null pointer. Because regression testing showed multiple failures and only partial readiness, the branch cut moved from Wednesday to Thursday at 2pm; Joan will rerun regression and post results by Wednesday at 5pm. Store submission remains Monday, and the Android crash fix will target the upcoming release if ready, with crash numbers reviewed Thursday rather than pursuing an interim hotfix. Apple sign-in remains blocked by the missing production vault secret. The next Android issue moves to Katya after the crash fix, Android 9 is deferred to an offline discussion, and the workout history endpoint still needs load testing before production.

#### Summary
- Ravi completed and merged MOB-1423, fixing workout timer drift when iOS apps return from the background.
- The team moved the 4.12 release branch cut to Thursday at 2pm, assigned Joan a build 321 regression pass by Wednesday 5pm, and identified the production vault secret as blocking the Apple sign-in fix.
- The 4.12 release branch will be cut Thursday at 2pm instead of Wednesday.
- App Store and Play Store submission remains scheduled for Monday.
- The Android 4.11.2 crash rate is 0.8 percent, approximately double the usual 0.4 percent baseline, driven mostly by a Samsung Android 14 heart-rate sync null pointer.

#### Progress since last sync
- Ravi completed and merged MOB-1423, fixing workout timer drift when iOS apps return from the background.
- MOB-1423 shipped in TestFlight build 318 last night.
- Katya investigated the Android 4.11.2 crash spike and isolated most crashes to a Samsung Android 14 heart-rate sync null pointer in MOB-1440.
- Theo deployed the new workout history endpoint to staging and reduced p95 latency from about four seconds to 1.9 seconds through query pagination.
- The workout history pagination change is backward compatible because 4.11 clients receive the first page by default.
- Joan ran regression testing against build 318 with 142 test cases and nine failures, including two real bugs.
- CI produced build 321, which includes Katya's offline sync fix merged the previous night.

#### Decisions
- The release branch cut moved from Wednesday to Thursday at 2pm to avoid relying on late cherry-picks while regression and fixes remain incomplete.
- Store submission remains on Monday despite the branch-cut change.
- The team will not decide on a 4.11.3 hotfix yet and will target 4.12 for MOB-1440 if the fix is ready in time.
- Regression testing will be rerun on build 321 rather than build 318.
- MOB-1431 ownership moved to Katya after MOB-1440.
- The Android 9 support discussion will happen offline rather than during this standup.

#### Blockers
- Theo is blocked from completing the Apple sign-in token refresh work because he lacks write access to the production vault.
- The Apple sign-in fix cannot ship in 4.12 until the platform team adds the new client secret.
- MOB-1440 remains pending while the Android crash fix is being written and reviewed.
- Regression readiness was insufficient for the original Wednesday branch cut because Joan expected only about 60 percent completion and multiple fixes were not yet in.
- The Pixel 8 in the device lab cannot hold a charge, so Joan must borrow two Pixel devices from the design team.
- The Android 4.11.2 rollout has an elevated crash rate of 0.8 percent, twice the usual baseline.

#### Dependencies
- Theo's Apple sign-in work depends on Jon or another platform owner adding the client secret to the production vault.
- Katya's MOB-1431 work is sequenced after MOB-1440.
- The release branch timing depends on completing regression testing and landing the pending crash and Apple sign-in fixes.
- Joan's regression work must use build 321 because build 318 is stale and build 321 contains the offline sync fix.
- The workout history endpoint requires load testing before it can proceed to production.
- The Android 9 support decision has backend sequencing implications because an old authentication path is maintained for those clients.

#### Follow-up needed
- Review Android crash numbers Thursday to determine whether the current 4.12 approach remains sufficient.
- Confirm by noon whether the production vault secret has been added and whether Theo can resume the Apple sign-in fix.
- Review Joan's build 321 regression results before the Thursday 2pm branch cut.
- Decide whether to feature-flag the new onboarding flow after the build 321 rerun clarifies whether its flakiness persists.
- Schedule the offline Android 9 support discussion, including the backend authentication implications.
- Load test the workout history endpoint before approving its production rollout.

#### Action items (structured)
- Katya: Finish the MOB-1440 fix and aim to open a pull request this afternoon. (deadline: This afternoon)
- Me: Escalate the missing production vault secret with Jon and his manager and provide Theo an answer. (deadline: Today by noon)
- Joan: Rerun the full regression pass on build 321 and post the results in the release channel. (deadline: Wednesday at 5pm)
- Ravi: Prepare the App Store screenshots and 4.12 release notes.
- Ravi: Hand off MOB-1431 reproduction notes to Katya, including the iPhone 13 reproduction details.
- Katya: Take over MOB-1431 after MOB-1440, starting tomorrow. (deadline: Tomorrow, after MOB-1440)
- Me: Schedule an offline discussion about Android 9 support and its backend authentication path.
- The release branch cut is Thursday at 2pm. [inferred]
- Joan must post build 321 regression results by Wednesday at 5pm. [inferred]
- App Store and Play Store submission remains Monday. [inferred]
- Me will provide Theo an answer on the vault secret by noon today. [inferred]

#### Decisions (structured)
- The 4.12 release branch will be cut Thursday at 2pm instead of Wednesday.
- App Store and Play Store submission remains scheduled for Monday.
- MOB-1440 will go into 4.12 if it lands in time, and the team will review crash numbers again Thursday rather than deciding on a separate 4.11.3 hotfix now.
- MOB-1431 was reassigned to Katya after she completes MOB-1440.
- The team will rerun regression testing on build 321 rather than file tickets against stale build 318.
- The team will defer the Android 9 support discussion to an offline conversation that also covers its backend authentication impact.

#### Open questions (structured)
- Should MOB-1440 ship through a 4.11.3 hotfix or only through 4.12 if it is ready in time? [open]
- Should the team continue supporting Android 9 despite its roughly 3 percent user share and association with unusual crashes? [open]
- Should the new onboarding flow be feature-flagged off if it remains flaky after the build 321 rerun? [open]
- Will the workout history endpoint pass load testing before production release? [open]

#### Risks (structured)
- [high] The Android 4.11.2 crash rate is 0.8 percent, approximately double the usual 0.4 percent baseline, driven mostly by a Samsung Android 14 heart-rate sync null pointer.
- [high] The Apple sign-in token refresh fix cannot enter 4.12 until the platform team adds the client secret to the production vault.
- [high] A full regression pass was not expected to be complete by the originally considered Wednesday branch cut because only about 60 percent could be completed and key fixes were still pending.
- [medium] The onboarding flow remains flaky, with most of the nine failures in the build 318 regression run attributed to known onboarding flakiness.
- [medium] The device lab's Pixel 8 cannot hold a charge, reducing available Android test hardware until replacement devices are borrowed.
- [medium] The workout history endpoint still requires load testing before production despite improving p95 latency from about four seconds to 1.9 seconds.

#### Follow-up draft
Hi team,

Decisions
MOB-1423 is merged and shipped in TestFlight build 318, fixing iOS workout timer drift. The 4.12 branch cut moves to Thursday at 2pm; store submission remains Monday. Regression will rerun on build 321. MOB-1440 targets 4.12 if ready, with crash numbers reviewed Thursday; MOB-1431 follows with Katya. Android 9 support moves to an offline discussion.

Blockers
Android 4.11.2 crashes remain elevated at 0.8% versus a 0.4% baseline, mainly from Samsung Android 14 heart-rate sync (MOB-1440). Apple sign-in is blocked until the production vault client secret is added. Joan’s build 321 regression results are needed before the branch cut, with Pixel 8 hardware unavailable. The workout history endpoint still needs load testing before production.

Thanks,

---

# Summary F

_(run1)_

### Title: iOS Timer Fix and Crash Spike

#### Overview
Standup covering Ravi's merged iOS timer fix (MOB-1423, in build 318), Katya's Android 0.8% crash spike (MOB-1440), Theo's staging latency win plus a vault-access blocker on Apple sign-in, and Joan's regression results — ending with the release branch cut moved from Wednesday to Thursday 2pm. Key decisions: Release branch cut moved from Wednesday to Thursday at 2pm, with App Store and Play Store submission staying on Monday.; No decision yet on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and the crash numbers will be looked at again Thursday.; Team rejected cherry-picking late fixes onto the release branch after Katya's objection that cherry-picking is how the analytics fix was lost in 4.10.. Progress since last sync: Ravi finished MOB-1423, the iOS workout timer that drifted when the app went to the background, and it is merged.

#### Summary
- Ravi finished MOB-1423, the iOS workout timer that drifted when the app went to the background, and it is merged.
- Standup covering Ravi's merged iOS timer fix (MOB-1423, in build 318), Katya's Android 0.8% crash spike (MOB-1440), Theo's staging latency win plus a vault-access blocker on Apple sign-in, and Joan's regression results — ending with the rel
- Release branch cut moved from Wednesday to Thursday at 2pm, with App Store and Play Store submission staying on Monday.
- No decision yet on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and the crash numbers will be looked at again Thursday.
- Crash rate on Android 4.11.2 is 0.8%, roughly double the ~0.4% usual baseline, almost entirely from MOB-1440.

#### Progress since last sync
- Ravi finished MOB-1423, the iOS workout timer that drifted when the app went to the background, and it is merged.
- The MOB-1423 root cause was trusting the display link timer instead of wall clock time, causing 20-30 seconds of drift after about ten minutes in the background.
- MOB-1423 shipped in TestFlight build 318 last night.
- Ravi picked up MOB-1431 today, the push notification deep link that opens the wrong screen, and reports no blockers on his side yet.
- Katya spent yesterday on the crash spike from the Android 4.11.2 rollout, which sits at a 0.8 percent crash rate versus the ~0.4 percent usual baseline.
- The crash spike is almost all one issue: a null pointer in the heart rate sync service on Samsung devices running Android 14, tracked as MOB-1440.
- Katya is writing the MOB-1440 fix today and hopes to have a PR up by this afternoon.
- Theo deployed the new workout history endpoint to staging, dropping p95 latency from about 4 seconds to 1.9 seconds.
- The latency improvement came mostly from paginating the query to 50 workouts per page instead of loading the whole history.
- Theo confirmed the pagination change is backwards compatible with 4.11 clients because old clients just get the first page by default.
- Joan ran the regression suite against build 318: 142 test cases with 9 failures, most being known onboarding flakiness but 2 being real bugs.
- The two real bugs are the deep link issue Ravi just picked up and Android offline mode not syncing saved routes.
- Ravi flagged that build 318 is already stale because CI produced build 321 about an hour ago containing Katya's offline sync fix merged last night.
- Joan will rerun everything on build 321 rather than filing tickets against the stale 318.

#### Decisions
- The team decided to cut the release branch Thursday at 2pm instead of Wednesday, keeping App Store and Play Store submission on Monday.
- The team explicitly declined to decide on a 4.11.3 hotfix now; MOB-1440 goes into 4.12 if it lands in time and crash numbers get reviewed again Thursday.
- The team agreed against cherry-picking late fixes onto the release branch after the 4.10 analytics fix was lost that way.
- MOB-1431 now belongs to Katya, with Ravi handing it over along with his notes.
- Ravi takes over the 4.12 App Store screenshots and release notes as he did them last time.
- The Android 9 support question was pushed to a separate offline conversation rather than decided in standup.
- Any decision on feature-flagging the new onboarding off was deferred until the build 321 rerun results are available.

#### Blockers
- Theo is blocked on the platform team adding the new client secret to the production vault, which he cannot do himself because he lacks write access.
- Jon on platform said he would look at the vault request but had not done so since Friday.
- Without the vault secret, the Apple sign-in fix cannot ship in 4.12 at all.
- Joan cannot deliver a full regression pass by tomorrow, estimating only about 60 percent, partly because Theo's blocker is unresolved and Katya's crash fix isn't in yet.
- Joan has no vault access either, so the platform dependency cannot be resolved within the team.
- The device lab's Pixel 8 won't hold a charge, forcing Joan to borrow two Pixel devices from the design team.

#### Dependencies
- Theo's Apple sign-in token refresh work depends on the platform team (Jon) adding the client secret to the production vault.
- The release readiness assessment depends on Joan's full regression pass on build 321.
- Whether MOB-1440 lands in time determines whether it can be included in 4.12 rather than needing a hotfix.
- MOB-1431's handoff from Ravi to Katya is sequenced after Katya finishes MOB-1440.
- The Android 9 support question also touches the backend, which keeps an old auth path alive purely for those clients.
- Joan's regression rerun depends on build 321 produced by CI, since build 318 is stale.

#### Follow-up needed
- Schedule an offline conversation about dropping or keeping Android 9 support, which Katya raised and which also affects the backend auth path.
- Re-examine the 4.11.2 crash numbers on Thursday to reassess the hotfix vs 4.12 decision.
- Revisit feature-flagging the new onboarding once the build 321 rerun results are in.
- Get Theo an answer on the production vault client secret by noon today.
- Load test the new workout history endpoint before it is promoted to production.
- Verify whether the 2 real regression failures (deep link and offline saved-route sync) are resolved on build 321.

#### Action items (structured)
- Joan: Run a full regression pass on build 321 and post the results in the release channel by Wednesday 5pm. (deadline: Wednesday 5pm)
- Dana: Escalate the production vault client secret request by pinging Jon and his manager directly and getting Theo an answer by noon today. (deadline: noon today)
- Katya: Write the fix for MOB-1440 (null pointer in heart rate sync service) with a PR hoped for by this afternoon. (deadline: this afternoon)
- Katya: Take over MOB-1431 after MOB-1440, expected tomorrow. (deadline: tomorrow)
- Ravi: Hand MOB-1431 over to Katya with his notes, having reproduced it only on an iPhone 13.
- Ravi: Produce the App Store screenshots and release notes for 4.12.
- Joan: Triage the remaining regression failures today and write up tickets. (deadline: today)
- Theo: Load test the new workout history endpoint before it goes to production.
- Dana: Find a time for the offline conversation about Android 9 support, but not today.
- Joan: Rerun the regression suite on build 321 instead of filing tickets against the stale build 318.
- Answer from Dana on production vault access for Theo [inferred]
- Full regression results on build 321 posted in the release channel [inferred]
- Release branch cut, Thursday at 2pm [inferred]
- App Store and Play Store submission [inferred]

#### Decisions (structured)
- Release branch cut moved from Wednesday to Thursday at 2pm, with App Store and Play Store submission staying on Monday. (owner: Dana)
- No decision yet on a 4.11.3 hotfix; if MOB-1440 lands in time it goes into 4.12, and the crash numbers will be looked at again Thursday. (owner: Dana)
- Team rejected cherry-picking late fixes onto the release branch after Katya's objection that cherry-picking is how the analytics fix was lost in 4.10. (owner: Katya)
- MOB-1431 (push notification deep link opening the wrong screen) is reassigned from Ravi to Katya. (owner: Katya)
- Ravi is assigned the App Store screenshots and release notes for 4.12 because he did them last time. (owner: Ravi)
- The Android 9 support question is taken offline rather than decided in standup. (owner: Dana)
- Decision on feature-flagging the new onboarding off is deferred until the rerun on build 321 reports results. (owner: Dana)

#### Open questions (structured)
- Should the team keep supporting Android 9, given it is only about 3 percent of users but produces many of the weird crashes? [open]
- Should the team ship a 4.11.3 hotfix just for the heart rate sync crash, or let it ride along with 4.12? [open]
- Should the new onboarding be feature flagged off if it is still flaky after the 321 rerun? [open]

#### Risks (structured)
- [high] Crash rate on Android 4.11.2 is 0.8%, roughly double the ~0.4% usual baseline, almost entirely from MOB-1440.
- [high] Without the platform team adding the new client secret to the production vault, the Apple sign-in fix cannot go into 4.12 at all.
- [high] Joan cannot complete a full regression pass by tomorrow, estimating only about 60 percent.
- [medium] Cherry-picking late fixes onto the release branch previously caused the analytics fix to be lost in 4.10, so it is treated as risky.
- [low] The Pixel 8 in the device lab won't hold a charge, so Joan is borrowing two Pixel devices from the design team.

#### Follow-up draft
Hi team,

Standup recap.

Since last sync
Ravi's iOS timer fix (MOB-1423) is merged and shipped in build 318.
Theo's workout history endpoint is on staging, p95 down from ~4s to 1.9s.
Katya is on the Android 4.11.2 crash spike (0.8% vs ~0.4% baseline), almost all MOB-1440, PR targeted for this afternoon.

Decisions
Release branch cut moves from Wednesday to Thursday 2pm; App Store and Play Store submission stays Monday.
No 4.11.3 hotfix decision yet — MOB-1440 goes into 4.12 if it lands in time, crash numbers reviewed again Thursday.
No cherry-picking late fixes onto the release branch; that's how the 4.10 analytics fix was lost.
MOB-1431 hands from Ravi to Katya; Ravi picks up the 4.12 App Store screenshots and release notes.
Android 9 support discussion moves offline.

Blockers
Theo is blocked on platform (Jon) adding the client secret to the production vault — without it the Apple sign-in fix can't ship in 4.12 at all. Need an answer by noon today.
Joan won't get a full regression pass done by tomorrow, more like 60%, and it runs on build 321 since 318 is stale. The two real 318 failures were the deep link (now MOB-1431) and Android offline saved-route sync.

Thanks,
