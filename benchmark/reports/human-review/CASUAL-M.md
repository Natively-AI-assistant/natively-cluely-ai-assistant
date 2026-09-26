# CASUAL-M — casual_mixed, medium (28.3 min, 3726 words)

**Source transcript:** `benchmark/transcripts/src/CASUAL-M.txt`  
**Reference fact sheet:** `benchmark/references/CASUAL-M.json`  
**Context:** A casual video call among three old friends, Dan (the Natively user), Priya and Tom. About half the call is catch-up and banter (a TV finale, five-a-side football, Priya's new puppy, work complaints); interleaved throughout is the planning of a 3-night cabin trip for their friend Maya's 30th birthday, plus a secret surprise visit from Maya's brother.

## What a good summary must include
- 3-night cabin trip for Maya's 30th at Heron Point Cabin, Birchwater Lake (F01, F03)
- Dates moved to Fri Oct 23 - Mon Oct 26 because Priya is on nights the Oct 16 weekend (F06, F07)
- Total $1,140 (corrected from $1,040); $380 each for Dan, Priya, Tom, or $285 if Mia confirms (F09, F12, F13)
- Mia can't make the 23rd (cousin's wedding) and is unconfirmed; Priya gets a yes/no by Sunday (F14, F15)
- Dan books the cabin (took over from Priya) and pays the $570 deposit due Fri Sept 25; Priya and Tom send $190 each (F16, F18, F19, F20, F51)
- Tom rents a 7-seat Ridgeway SUV by Oct 1; everyone meets at Priya's on Calloway Street at 9:30 Fri Oct 23 (F22, F24)
- Maya is celiac/strictly gluten-free, and the cabin allows no pets (F26, F28)
- Private chef rejected; Tom cooks gluten-free lasagna Saturday (F30, F31)
- Secret surprise: brother Jonah flies in from Denver Sat Oct 24; discuss only in the Operation Heron chat, not the group chat with Maya (F32, F33)
- Gift: $179 green Polaroid at $60 each; Priya orders it by Oct 16 (F35, F36)
- Tom starts at Halvorsen Logistics on Nov 2 (last day at Pellmark Oct 9) (F37, F38)
- Open: Mia, Jonah's airport-to-cabin transport, kayaks, gluten-free grocery store (F45, F46, F47, F48)

## Most important disagreements (judge fact checks)

✔ present · ◐ partial · ✘ missing · ⚠ contradicted

| Fact | Imp. | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|
| F35: The group gift is the green Polaroid camera ($179), with a gift budget of $60 each ($180 total). | critical | ? | ✔ | ✔ | ⚠ | ? | ⚠ |
| F30: The group decided against hiring a private chef (about $600) for the Saturday birthday dinner; they will cook themselves. | critical | ? | ⚠ | ✔ | ✔ | ? | ⚠ |
| F24: Departure is 9:30 on Friday, October 23rd: Tom picks up the SUV and everyone meets at Priya's place on Calloway Street. | critical | ? | ⚠ | ✔ | ✔ | ? | ⚠ |
| F28: Heron Point Cabin allows no pets of any kind (with a $250 fee if pet hair is found), so Priya's puppy Waffles cannot come. | critical | ? | ⚠ | ✔ | ⚠ | ? | ⚠ |
| F12: With Mia unconfirmed, the $1,140 cabin cost is split among Dan, Priya and Tom at $380 each. | critical | ? | ⚠ | ✔ | ⚠ | ? | ⚠ |
| F06: The trip dates are Friday, October 23rd to Monday, October 26th. | critical | ? | ⚠ | ✔ | ⚠ | ? | ⚠ |
| F04: Birchwater Lake is about a 3-hour drive, versus about 4.5 hours to Hollins Ridge. | important | ? | ✔ | ✘ | ✔ | ? | ✘ |
| F20: Priya will send Dan her $190 share of the deposit tonight. | important | ? | ⚠ | ✔ | ✔ | ? | ✔ |

## Judge-flagged problems

**A:** (not judged)
**B** — overall 3/10, accuracy 3, retention 8, conciseness 2
- critical: Reporting superseded dates (Oct 16-19) as planned decisions.
- critical: Reporting superseded booking owner (Priya) as an action item.
- critical: Reporting superseded cost split ($285 each) as a decision.
- critical: Reporting resolved questions (Waffles allowed, private chef, departure time) as open questions.
- critical: Misattributing the $190 payment at the end of the call (stating Dan pays Priya instead of Priya paying Dan).
- hallucination: A 'separate $190 amount' that Dan must pay Priya (this was a misinterpretation of Priya confirming she will pay Dan).
- superseded value: C02 → The planned trip dates are Friday, October 16th through Monday, October 19th, for three nights.
- superseded value: C03 → leaving four paying people to split the corrected total of $1,140 at $285 each.
- superseded value: C04 → Priya: Book Heron Point Cabin using the available Hearthstay credit
- superseded value: C06 → The Friday departure time remains unresolved after Tom suggested 8 a.m.

**C** — overall 4/10, accuracy 4, retention 8, conciseness 2
- critical: Reports superseded trip dates (Oct 16-19) as a decision.
- critical: Reports a superseded action item (Priya booking the cabin with her Hearthstay credit) as a current action item, contradicting the correct decision that Dan will book it.
- critical: Reports resolved questions (whether Waffles can come, Friday departure time, Priya's rota for Oct 16) as open questions.
- critical: Reports the superseded cost split ($285) as a definitive decision without the context that it only applies if Mia attends.
- superseded value: C02 → The group will use October 16th–19th as the proposed trip dates.
- superseded value: C04 → Priya will book the selected cabin. / Priya will book Heron Point Cabin using her Hearthstay credit.
- superseded value: C06 → What time will the group leave on Friday? (Listed as an open question)
- superseded value: C03 → The four paying attendees will each contribute $285. (Listed as a definitive decision)

**D** — overall 3/10, accuracy 4, retention 9, conciseness 1
- critical: Presenting superseded dates (Oct 16-19) as a final decision and action item.
- critical: Presenting the superseded cost split ($285 each) as a final decision.
- critical: Presenting the superseded booker (Priya) as a final decision and action item.
- critical: Presenting the superseded gift budget ($50 each) as a final decision.
- critical: Presenting a superseded action item (Dan checking the pet policy) alongside the final decision that pets are not allowed.
- critical: Presenting a not_decision (Mia doing the card and flowers) as a firm decision.
- superseded value: C02 → Trip dates were set as Friday, October 16th to Monday the 19th
- superseded value: C03 → The cost is split four ways among Dan, Priya, Tom and (likely) Mia Chen at $285 each
- superseded value: C04 → Priya was assigned to make the booking
- superseded value: C07 → Group gift budget is $50 each toward the green Polaroid camera.
- suggestion reported as decision: If Mia comes, she is assigned the card and flowers rather than a cash contribution.

**E:** (not judged)
**F** — overall 2/10, accuracy 3, retention 8, conciseness 1
- critical: The notes present superseded decisions as final (e.g., planning for October 16-19, Priya booking the cabin).
- critical: The notes list several resolved items as 'Open questions' (e.g., whether to hire a chef, whether Waffles can come, departure time, gift price).
- critical: The follow-up draft incorrectly states the cost split is $285 among four people, ignoring that Mia is unconfirmed and the current split is $380 among three.
- hallucination: The trip length was reduced to three nights after the proposed Tuesday extension was rejected (it was never more than three nights; the extension was merely floated and dropped).
- superseded value: C02 → The planned trip dates are Friday, October 16th through Monday, October 19th, subject to Priya checking her rota.
- superseded value: C04 → Priya will book the cabin using her Hearthstay credit, pending the remaining listing checks.
- superseded value: C03 → the $1,140 cabin cost split at $285 among the four paying participants (in the follow-up draft)
- suggestion reported as decision: The planned trip dates are Friday, October 16th through Monday, October 19th
- suggestion reported as decision: Priya will book the cabin using her Hearthstay credit


---

# Summary A

_(run2)_

### Title: Maya's Birchwater Birthday Trip

#### Overview
The group chose Heron Point Cabin at Birchwater Lake for Maya's three-night birthday weekend, tentatively October 16–19, and corrected the current four-payer estimate to $1,140 ($285 each), while pet access and Priya's rota remained unresolved. The cabin trip moved to October 23–26 at Heron Point, the chef was dropped, Dan took over booking the $570 deposit due September 25, Mia's attendance remained pending, and a secret Jonah surprise was organized. The group finalized a three-night Birchwater trip for Friday the 23rd through Monday the 26th with one Ridgeway SUV, set the gift contribution at $60 each, and left Jonah's airport transfer, Mia's attendance, kayaks, groceries, and the playlist unresolved. Key decisions: The group chose Birchwater Lake's Heron Point Cabin instead of Hollins Ridge for the three-night birthday trip.; The cabin stay will be three nights.; Maya will not pay for the birthday cabin, and the current four-payer split is $285 each from the corrected $1,140 total..

#### Summary
- The meeting finalized plans for a three-night birthday trip and selected Heron Point Cabin at Birchwater Lake over Hollins Ridge.
- The October trip will exclude the birthday guest from the cabin cost, with provisional shares for Dan, Priya, and Tom that would be lower if Mia joins.
- The group will cook rather than hire the chef, bring no dogs, use one Ridgeway SUV, keep the surprise in the separate Operation Heron chat, and accommodate celiac disease with separate food-preparation equipment while still needing a nearby gluten-free grocery option and a cabin-specific cross-contamination plan.

#### What changed
- Tom announced that he quit Pellmark, with a last day of October 9, and will start as a senior financial analyst at Halvorsen Logistics on November 2.
- Tom expects roughly three weeks between jobs in October.
- The birthday-trip search narrowed from Hollins Ridge and Birchwater Lake to Heron Point Cabin at Birchwater Lake.
- The stay is tentatively planned for Friday October 16 through Monday October 19, the weekend before Maya's October 21 birthday, pending Priya's rota check.
- The listed cabin total was corrected from $1,040 to $1,140 after the cleaning fee was noticed, making the current four-way estimate $285 each.
- Priya offered to book through Hearthstay and noted about $150 of credit from a cancelled Lisbon trip.
- The group clarified that Maya is strictly gluten-free because of celiac disease while Mia Chen is vegetarian.
- Waffles is now eleven weeks old and is due to start puppy class next Saturday.
- Priya reported that she is moving to day shifts in November after a 12.5-hour shift during a three-nurse shortage.
- The private-chef proposal for Saturday was deferred after an estimate of about $600, or $150 each for four people, was raised.
- The trip moved from the weekend of the 16th to October 23–26 because Priya is scheduled for nights on the original weekend and cannot swap again.
- Heron Point was confirmed open for the new dates at the same $1,140 total.
- The property was found to ban pets despite the pet-friendly filter, so Waffles was removed from the trip plan.
- The $600 chef option was dropped in favor of cooking at the cabin.
- Booking responsibility moved to Dan after Priya found her Hearthstay credit expired and her card flagged.
- The deposit was clarified as 50% or $570 due September 25 rather than at the end of the month, with the hold dropping afterward.
- Mia cannot attend Friday the 23rd because of a Portland wedding on the 24th, though Sunday remains possible and the cost split is therefore provisional.
- Jonah's planned surprise visit from Denver was added, and the group created Operation Heron to coordinate it secretly.
- A seven-seater became Tom's rental plan to accommodate up to five people if Mia joins.
- A separate chat named Operation Heron had already been created, with Speaker 1 planning to add the other two participants after the call.
- The group set a secrecy rule excluding Jonah references, jokes, and likes on his posts outside Operation Heron.
- The trip itinerary was confirmed as Birchwater Lake and Heron Point from Friday the 23rd through Monday the 26th.
- The group settled on one Ridgeway SUV instead of separate cars because Me did not trust the noisy car for a three-hour drive.
- The departure plan is 9:30 on Friday the 23rd from Priya's Calloway Street home, with Tom picking up Maya en route.
- The gift contribution increased to $60 per person and $180 total so the group can cover the $179 green Polaroid.
- Priya took responsibility for buying the Polaroid and ordering it by October 16th.
- The proposed four-night stay was rejected, leaving a three-night trip because Tuesday work and the extra $325-plus cost were not workable.
- Me committed to book the lodging and pay the $570 deposit before Friday.
- The plan now excludes dogs and records Maya as gluten-free and Mia as vegetarian.

#### Decisions
- The group confirmed a three-night stay for the birthday weekend.
- Birchwater Lake's Heron Point Cabin was selected over Hollins Ridge, with its hot tub helping settle the choice.
- Maya will be excluded from the cabin cost, with the current four-person calculation set at $285 each.
- Priya will make the Hearthstay reservation.
- The private-chef idea was explicitly deferred instead of being booked.
- The group confirmed October 23–26 at Heron Point for a total of $1,140.
- The group confirmed that no chef will be hired and that the attendees will cook.
- The group confirmed that Waffles will not go to Heron Point because of the no-pet rule.
- Dan took responsibility for making the booking.
- Dan will pay the $570 deposit and Priya and Tom will each reimburse him $190.
- The current working cost split is $380 each for Dan, Priya, and Tom, with a reduction to $285 each if Mia confirms.
- Tom will use a seven-seater rental for the drive.
- Jonah's surprise will be managed through Operation Heron and kept out of Maya's birthday chat.
- Operation Heron is the designated private channel for the surprise, and Jonah-related comments will not appear in the birthday group chat.
- The group will use one Ridgeway SUV rather than drive separately.
- Everyone will meet at Priya's Calloway Street home at 9:30 on Friday the 23rd, with Tom collecting Maya on the way.
- The trip will be at Birchwater Lake and Heron Point from Friday the 23rd through Monday the 26th.
- The stay will remain three nights rather than extend through Tuesday.
- The gift budget is $60 from each contributor, $180 total, for the $179 green Polaroid.
- Priya will buy the Polaroid and order it by October 16th.
- No dogs will come on the trip.

#### Action items
- Priya should book Heron Point Cabin on Hearthstay and consider the available credit.
- Priya should check her rota before the October 16–19 dates are treated as final.
- Dan should verify the listing's pet policy before bringing Waffles.
- Someone needs to check nearby grocery availability for gluten-free supplies.
- Someone needs to confirm that the cabin kitchen can accommodate the separate equipment required for Maya's food.
- An unassigned check is needed to find a nearby grocery store stocking gluten-free products.
- Priya will ask Anjali to take Waffles that weekend.
- Tom will make Saturday dinner using his gluten-free lasagna.
- Dan will book Heron Point for October 23–26 before Friday, September 25.
- Dan will pay the full $570 deposit on his card.
- Priya will Venmo Dan $190 tonight.
- Tom will send his $190 share by Wednesday the 23rd.
- Tom will rent a seven-seater, with Ridgeway SUVs quoted at about $64 per day.
- Priya will obtain a definite yes-or-no answer from Mia by Sunday.
- Priya will check the price of the green Polaroid camera.
- Priya will add Dan and Tom to the Operation Heron chat after the call.
- Everyone will keep Jonah out of Maya's birthday chat and avoid mentioning him outside Operation Heron.
- Priya will add the other two participants to Operation Heron after the call.
- The participants must keep Jonah out of the birthday group chat and avoid related jokes or likes on his posts outside Operation Heron.
- Tom will book the Ridgeway SUV by October 1st.
- Tom will pick up the SUV and collect Maya en route to the Friday meetup.
- The group will meet at Priya's Calloway Street home at 9:30 on Friday the 23rd.
- Me will book the stay and pay the $570 deposit before Friday.
- Priya will order the $179 green Polaroid by October 16th.
- The contributors will each send Priya $60 for the gift.
- Priya will send the $190 mentioned at the end of the call tonight.
- Jonah needs to determine how he will travel from the airport to the cabin.
- The group should use Operation Heron to resolve Mia's attendance and the kayak decision.
- Someone needs to check for a gluten-free grocery option near Birchwater.
- Someone needs to make a playlist for the drive.

#### Open questions
- Priya has not confirmed whether her rota allows the proposed October 16–19 stay.
- The group still does not know whether Waffles is allowed at Heron Point Cabin.
- Mia Chen's attendance and contribution to the four-payer split are not definite because she was only described as probably attending.
- The group has not decided whether to hire the proposed private chef for Saturday night.
- No nearby grocery store has yet been identified for gluten-free supplies.
- The cabin's ability to support separate food-preparation equipment for Maya has not been established.
- Will Mia attend any part of the October 23–26 trip, possibly Sunday, given her cousin's wedding in Portland on Saturday the 24th?
- Will Anjali be able to take Waffles that weekend?
- Which nearby grocery store can reliably stock gluten-free supplies?
- Will the group order Crumb and Kettle's gluten-free cake or bake one at the cabin?
- Will the group rent kayaks on Birchwater, and if so, when?
- What time will the group leave on Friday?
- Will the green Polaroid camera be the group gift, and will its price fit the proposed $50-per-person contribution?
- Jonah's airport-to-cabin transportation remains unresolved.
- Mia's attendance remains unresolved, and her card-and-flowers role is conditional on her coming.
- Whether kayaks will be included is still undecided.
- The group has not determined which gluten-free grocery option near Birchwater to use.
- The person responsible for creating the drive playlist is still unknown.

#### Risks / blockers
- The October 16–19 booking could conflict with Priya's rota.
- The reservation could fail to accommodate Waffles if the pet policy is not actually applicable.
- Maya's celiac disease makes gluten cross-contamination a serious food-safety concern.
- The cabin cost was initially misread by $100 because the cleaning fee was omitted.
- The private-chef option could add about $600 to the trip and was viewed as potentially excessive.
- The four-payer calculation depends on Mia Chen joining, but her attendance is not confirmed.
- Food logistics remain a risk because neither gluten-free grocery access nor the required separate equipment has been verified.
- Maya's gluten-free requirement creates a cross-contamination risk and requires separate equipment such as a toaster and chopping board.
- Bringing Waffles would violate Heron Point's no-pet rule and could trigger the $250 pet-hair fee.
- The booking hold drops after Friday, September 25 if the 50% $570 deposit is not paid.
- Priya cannot book directly because her Hearthstay credit expired and her card was previously flagged, making Dan's booking a dependency.
- Mia's uncertain attendance changes the provisional cost from $380 each for three payers to $285 each if four people pay.
- The original weekend of the 16th is unavailable because Priya is scheduled for nights Friday through Sunday and cannot swap again.
- Late-October kayaking may be uncomfortable or risky because the water is expected to be freezing and Priya expects she may fall in.
- The Jonah surprise could be spoiled if anyone mentions him in Maya's birthday group chat or jokes about him elsewhere.
- The cake plan remains constrained by a previously dry gluten-free cake and doubts that anyone can bake successfully.
- The surprise could be spoiled if Maya sees birthday-chat messages, jokes, or social-media activity about Jonah.
- Jonah's airport-to-cabin transfer is a major logistics risk because Birchwater is about three hours from the airport and the available car will be at the lake.
- The one-car plan depends on securing the Ridgeway SUV because Me's car is making a noise and is not trusted for the three-hour route.
- Late-October weather cannot yet be forecast, and nights may be near freezing.
- Food planning is incomplete because no gluten-free store near Birchwater has been checked, while Maya is gluten-free and Mia is vegetarian.
- The $179 gift exceeded the earlier $150 total and $50-each contribution plan.
- A fourth night was blocked by Speaker 1's Tuesday shift and the additional $325-plus cost.

#### Notes
- Maya turns 30 on Wednesday, October 21, making the proposed October 16–19 stay the weekend before her birthday.
- Heron Point Cabin is listed as three bedrooms, sleeping six, on the water, with a hot tub and a $325 nightly rate plus fees.
- Birchwater is about three hours away versus roughly four and a half hours to Hollins Ridge, whose previous trip included a broken heater and sleeping in coats.
- Waffles is eleven weeks old, has chewed two phone chargers and a work clog, and bit the vet's stethoscope; his trainer Brenda previously trained police dogs.
- Mia Chen is the book-club Mia, while the other Mia from Maya's work has moved to London.
- Priya described a 12.5-hour shift while three nurses were short-staffed and said she is moving to day shifts in November.
- Dan's work reorganization currently has a pre-meeting and a 22-slide deck built mostly from boxes and arrows, including an Alignment slide.
- The proposed private chef would cook five courses and handle the dishes for an estimated $600.
- Maya is gluten-free and Mia is vegetarian.
- Maya also has a major work presentation on Friday the 16th, which supported holding the celebration later.
- The remaining $570 is scheduled to be charged automatically two weeks before check-in.
- The proposed gift is a green Polaroid camera, with a tentative $50 contribution from each person while the price is checked.
- Birchwater kayak rental was quoted at about $45 per person for a half day.
- Ridgeway's seven-seater SUVs were quoted at about $64 per day.
- Dan's rent will rise by $200 per month when his lease renews in January, and he is viewing roughly six listings per night.
- Dan is considering a riverside fourth-floor walk-up as part of his apartment search.
- Tom's Halvorsen interview took five rounds, and his laptop and case-study marker died during the final exercise before he was hired.
- Tom starts Halvorsen on November 2 in a hybrid role with two work-from-home days, and the company will pay for CFA level two certification if he wants it.
- Jonah wants to fly from Denver, arrive Saturday afternoon on the 24th, and walk in before dinner while Maya believes the weekend is otherwise just four people.
- Jonah has not seen Maya for about fourteen months since moving to Denver, and Maya says she misses him.
- Maya is not a morning person, which was the reason given for avoiding an 8:00 departure.
- The late-October conditions were estimated at around fifty during the day and near freezing at night, so layers were recommended.
- The group described the expected cold weather as suitable for using the hot tub.
- The selected gift is the green Polaroid priced at $179.
- Speaker 1 cannot stay through Tuesday because of a Tuesday morning shift.
- The one-car choice was described as more fun together in addition to avoiding Me's unreliable car.
- Mia might handle the card and flowers only if she attends, while Maya is gluten-free and Mia is vegetarian.

#### Action items (structured)
- Priya: Book the Heron Point Cabin reservation on Hearthstay; Priya identified about $150 of credit from a cancelled Lisbon booking.
- Priya: Check Priya's rota to confirm whether she can attend the proposed October 16–19 stay.
- Dan: Double-check whether Heron Point Cabin allows pets and whether Waffles can stay there.
- Check whether a decent grocery store near the cabin stocks gluten-free products. [inferred]
- Confirm whether the cabin kitchen can support the separate toaster and chopping board Maya requires to avoid cross-contamination. [inferred]
- Priya: Ask Anjali whether she can take Waffles that weekend.
- Tom: Make Saturday dinner, using Tom's gluten-free lasagna.
- Dan: Book Heron Point for October 23–26 before Friday, September 25. (deadline: before Friday, September 25)
- Dan: Pay the full $570 deposit on the booking card. (deadline: by Friday, September 25)
- Priya: Send Dan the $190 reimbursement by Venmo. (deadline: tonight)
- Tom: Rent a seven-seater SUV from Ridgeway for the trip; the quoted rate was about $64 per day.
- Priya: Obtain a definite yes-or-no answer from Mia about attending. (deadline: Sunday)
- Priya: Look up the price of the green Polaroid camera.
- Priya: Add Dan and Tom to the Operation Heron chat.
- All participants: Keep Jonah's visit out of Maya's birthday group chat and do not mention him outside Operation Heron.
- Tom must send Dan the $190 reimbursement by Wednesday, September 23. [inferred]
- Priya will send Dan the $190 reimbursement tonight. [inferred]
- Priya will obtain Mia's yes-or-no answer by Sunday. [inferred]
- Dan must complete the booking and pay the $570 deposit before Friday, September 25, when the hold drops. [inferred]
- Priya: Priya will add the other two participants to Operation Heron after the call. (deadline: after this call)
- The participants must keep Jonah out of the birthday group chat and avoid related jokes or likes on his posts outside Operation Heron.
- Tom: Tom will book the Ridgeway SUV by October 1st. (deadline: October 1st)
- Tom: Tom will pick up the SUV and collect Maya en route to the Friday meetup. (deadline: Friday the 23rd)
- The group will meet at Priya's Calloway Street home at 9:30 on Friday the 23rd. (deadline: 9:30 on Friday the 23rd)
- Me: Me will book the stay and pay the $570 deposit before Friday. (deadline: before Friday)
- Priya: Priya will order the $179 green Polaroid by October 16th. (deadline: October 16th)
- The contributors will each send Priya $60 for the gift.
- Priya: Priya will send the $190 mentioned at the end of the call. (deadline: tonight)
- Jonah: Jonah needs to determine how he will travel from the airport to the cabin.
- The group should use Operation Heron to resolve Mia's attendance and the kayak decision. [inferred]
- Someone needs to check for a gluten-free grocery option near Birchwater. [inferred]
- Someone needs to make a playlist for the drive. [inferred]
- Priya: Add the other participants to Operation Heron (deadline: after this call) [inferred]
- Tom: Book the Ridgeway SUV (deadline: October 1st) [inferred]
- Meet and depart from Priya's Calloway Street home (deadline: 9:30 on Friday the 23rd) [inferred]
- Me: Book the stay and pay the $570 deposit (deadline: before Friday) [inferred]
- Priya: Order the green Polaroid (deadline: October 16th) [inferred]
- Priya: Send the $190 (deadline: tonight) [inferred]

#### Decisions (structured)
- The group chose Birchwater Lake's Heron Point Cabin instead of Hollins Ridge for the three-night birthday trip.
- The cabin stay will be three nights.
- Maya will not pay for the birthday cabin, and the current four-payer split is $285 each from the corrected $1,140 total.
- Priya will handle the Hearthstay booking, and she has about $150 of Hearthstay credit available. (owner: Priya)
- The private-chef option was parked for later rather than approved for the trip.
- The cabin trip is rescheduled to October 23–26 at Heron Point for $1,140 total.
- The group will not hire the $600 chef and will cook at the cabin instead.
- Waffles will not attend because Heron Point prohibits pets and may charge $250 if pet hair is found.
- Dan will make the Heron Point booking because Priya's Hearthstay credit expired and her card was previously flagged. (owner: Dan)
- The initial cabin deposit will be $570, with Dan paying it on his card and Priya and Tom reimbursing him $190 each.
- Until Mia confirms, the $1,140 cabin cost will provisionally be split among Dan, Priya, and Tom at $380 each; if Mia joins, the share becomes $285 each.
- Tom will use a seven-seater rental so the vehicle can accommodate five people if Mia comes. (owner: Tom)
- The group will coordinate Jonah's surprise through the separate Operation Heron chat and keep it out of Maya's birthday group chat.
- The surprise will be managed in the separate Operation Heron chat, with Jonah-related comments kept out of the birthday group chat.
- The group will use one Ridgeway SUV rather than drive separately.
- Everyone will meet at Priya's Calloway Street home at 9:30 on Friday the 23rd, with Tom picking up Maya on the way.
- The trip itinerary is Birchwater Lake, Heron Point, from Friday the 23rd through Monday the 26th.
- The stay will remain three nights rather than extend to four nights through Tuesday.
- The gift contribution is $60 per person, for $180 total, to cover the $179 green Polaroid.
- Priya is the gift buyer and will order the Polaroid by October 16th. (owner: Priya)
- No dogs will be brought on the trip.

#### Open questions (structured)
- Will Priya's rota permit the proposed October 16–19 stay? [open]
- Is Heron Point Cabin pet-friendly, and can Waffles stay there? [open]
- Will Mia Chen definitely attend and be one of the four payers? [open]
- Will the group hire a private chef for Saturday's birthday dinner? [open]
- Which nearby grocery store can supply Maya's gluten-free food? [open]
- Can the cabin kitchen support the separate toaster and chopping board needed to avoid cross-contamination? [open]
- Will Mia attend any part of the October 23–26 trip, possibly Sunday, given her cousin's wedding in Portland on Saturday the 24th? [open]
- Will Anjali be able to take Waffles that weekend? [open]
- Which nearby grocery store can reliably stock gluten-free supplies? [open]
- Will the group order Crumb and Kettle's gluten-free cake or bake one at the cabin? [open]
- Will the group rent kayaks on Birchwater, and if so, when? [open]
- What time will the group leave on Friday? [open]
- Will the green Polaroid camera be the group gift, and will its price fit the proposed $50-per-person contribution? [open]
- How will Jonah get from the airport to the cabin? [open]
- Will Mia attend, and will she handle the card and flowers if she comes? [open]
- Will kayaks be included in the trip? [open]
- Which gluten-free grocery option near Birchwater will be used? [open]
- Who will create the drive playlist? [open]

#### Risks (structured)
- [medium] The October 16–19 reservation could conflict with Priya's rota because she has not confirmed availability.
- [medium] Waffles may not be permitted because the listing's pet-friendly status was not verified.
- [high] Maya's celiac disease creates a high food-safety risk if gluten cross-contamination occurs, requiring separate preparation equipment.
- [medium] The accommodation budget was initially understated by $100 because the cleaning fee was missed.
- [medium] A private chef would add about $600 total, or $150 per payer, on top of the cabin and was described as sounding excessive.
- [medium] The four-payer cost assumption depends on Mia Chen, whose attendance was described only as probable.
- [medium] No nearby gluten-free food source or cabin-specific cross-contamination plan has been confirmed.
- [medium] Maya's gluten-free requirement creates a cross-contamination risk and requires separate equipment such as a toaster and chopping board.
- [high] Bringing Waffles would violate Heron Point's no-pet rule and could trigger the $250 pet-hair fee.
- [high] The booking hold drops after Friday, September 25 if the 50% $570 deposit is not paid.
- [medium] Priya cannot book directly because her Hearthstay credit expired and her card was previously flagged, making Dan's booking a dependency.
- [medium] Mia's uncertain attendance changes the provisional cost from $380 each for three payers to $285 each if four people pay.
- [medium] The original weekend of the 16th is unavailable because Priya is scheduled for nights Friday through Sunday and cannot swap again.
- [medium] Late-October kayaking may be uncomfortable or risky because the water is expected to be freezing and Priya expects she may fall in.
- [high] The Jonah surprise could be spoiled if anyone mentions him in Maya's birthday group chat or jokes about him elsewhere.
- [low] The cake plan remains constrained by a previously dry gluten-free cake and doubts that anyone can bake successfully.
- [high] The surprise could be spoiled if Maya sees birthday-chat messages, jokes, or social-media activity about Jonah.
- [high] Jonah's airport-to-cabin transfer is unresolved even though Birchwater is about three hours from the airport and the available car will be at the lake.
- [medium] The one-car plan depends on booking the Ridgeway SUV because Me's car is making a noise and is not trusted for the three-hour route.
- [medium] The Ridgeway SUV must be secured by October 1st for the agreed transportation plan.
- [medium] Late-October weather cannot yet be forecast, and the group expects nights near freezing.
- [medium] Food planning is incomplete because no gluten-free store near Birchwater has been checked, while Maya is gluten-free and Mia is vegetarian.
- [medium] The $179 gift exceeded the earlier $150 total and $50-each contribution plan.
- [medium] A fourth night was blocked by Speaker 1's Tuesday shift and the additional $325-plus cost.

#### Follow-up draft
Subject: Follow-up: Birchwater birthday trip

Hi team,

Thanks, everyone, for working through the birthday-trip details. We aligned on a three-night stay at Heron Point Cabin at Birchwater Lake from October 23–26, with Dan booking the $1,140 lodging and paying the $570 deposit; Maya is excluded from the cabin cost, so the working shares are $380 each for Dan, Priya, and Tom, dropping to $285 if Mia joins. We’ll cook rather than hire a chef, bring no dogs, use one Ridgeway SUV, and keep Jonah’s surprise in Operation Heron. Can we confirm a safe gluten-free setup for Maya, including separate kitchen equipment and a reliable nearby grocery option?

Best,

---

# Summary B

_(run1)_

### Title: Maya’s Heron Point Birthday Trip

#### Overview
The group chose Heron Point Cabin at Birchwater Lake for Maya's birthday weekend, corrected the shared cost to $285 each, and assigned Priya to book pending rota and pet-policy checks. The group moved the cabin trip to October 23–26, assigned booking and transport tasks, set the September 25 deposit plan, and began coordinating a secret visit from Jonah. The group finalized the Birchwater Lake birthday trip for October 23–26, confirmed one shared SUV and the $179 gift split, and left Mia, Jonah’s transport, kayaks, and groceries unresolved. Key decisions: The group selected Heron Point Cabin at Birchwater Lake instead of the Hollins Ridge option.; Maya will not contribute to the cabin cost, leaving four paying people to split the corrected total of $1,140 at $285 each.; The private-chef proposal was parked rather than approved..

#### Summary
- The meeting focused on planning a birthday weekend at Heron Point Cabin on Birchwater Lake.
- The group chose the cabin over Hollins Ridge, agreed on the stated shared-cost arrangement, and decided to cook rather than hire a private chef.
- The trip will use one shared SUV with no dogs, accommodate the guest’s celiac-related gluten-free requirements through strict cross-contamination controls, and coordinate the surprise only through Operation Heron.

#### What changed
- The destination changed from two considered options to Heron Point Cabin at Birchwater Lake.
- The estimated cabin total was corrected upward from $1,040 to $1,140 after including the cleaning fee.
- The individual contribution changed from the preliminary $260 estimate to $285 for each of four paying people.
- Priya offered to handle the cabin booking and has approximately $150 in Hearthstay credit available.
- Tom reported that he left Pellmark, with his last day on October 9th, and will start as a senior financial analyst at Halvorsen Logistics on November 2nd.
- Priya said she will move to day shifts in November.
- The trip dates changed to October 23–26, when Heron Point was confirmed available at the same $1,140 total price.
- Mia became uncertain for the revised dates because she has a cousin's wedding in Portland on Saturday, October 24.
- Jonah offered to fly from Denver and surprise Maya by arriving Saturday afternoon before dinner.
- The booking responsibility shifted to Dan because Priya's credit had expired and her card had previously been flagged.
- The deposit requirement was clarified as 50%, or $570, due by Friday, September 25 rather than at the end of the month.
- Waffles was ruled out for the cabin because the listing's house rules prohibit pets despite the pet-friendly search filter.
- The trip itinerary was consolidated as Birchwater Lake at Heron Point from Friday the 23rd through Monday the 26th.
- The group settled on a 9:30 Friday departure from Priya’s place on Calloway Street.
- Transportation changed from a possible separate-car plan to one shared SUV.
- The gift contribution increased from the proposed $50 each to $60 each to cover the $179 Polaroid.
- The possible four-night stay was rejected in favor of three nights because of schedule and cost concerns.
- The group explicitly added no dogs and recorded Maya’s gluten-free and Mia’s vegetarian requirements.

#### Decisions
- The group agreed on Birchwater Lake and specifically Heron Point Cabin for the birthday weekend.
- The planned weekend is October 16th–19th, though Priya still needs to verify her rota.
- Maya will be excluded from the four-way cabin cost split because the trip is her birthday celebration.
- The private-chef idea was deferred for later consideration.
- The group confirmed October 23–26 as the new trip dates.
- The chef option was rejected because the $600 cost was considered too high relative to the cabin price.
- The group will cook its own meals, with Tom volunteering to make gluten-free lasagna for Saturday dinner.
- Dan will pay the deposit and Priya and Tom will reimburse him $190 each.
- The Jonah surprise will be managed through Operation Heron rather than the group chat that includes Maya.
- Operation Heron is the exclusive channel for Jonah-related planning to protect the surprise.
- The group will use one SUV for the trip.
- The group will keep the stay to three nights rather than extend it through Tuesday.
- The group approved $60 per person for the gift.
- No dogs will be brought on the trip.

#### Action items
- Priya will book the selected cabin.
- Dan will verify whether the cabin permits pets before booking is finalized.
- Priya will check her rota against the proposed October dates.
- Someone needs to investigate nearby grocery access for gluten-free supplies.
- Priya will contact Anjali about looking after Waffles.
- Dan will complete the Heron Point booking before the September 25 deposit deadline.
- Tom will rent a seven-seat vehicle, likely an SUV from Ridgeway.
- Priya will obtain Mia's final attendance answer by Sunday.
- Priya will add the other participants to the Operation Heron chat.
- Add the two other participants to Operation Heron after the call.
- Book the SUV by October 1.
- Book the accommodation and pay the $570 deposit before Friday.
- Order the green Polaroid by October 16.
- Send Priya $60 each toward the gift.

#### Open questions
- Whether Waffles can attend the trip remains unresolved.
- Whether Priya is available for the proposed dates remains unresolved pending her rota check.
- The group has not decided whether to hire a private chef for Saturday night.
- The group has not identified a nearby store that can support Maya's gluten-free requirements.
- Mia has not confirmed whether she can attend the revised trip dates.
- The group has not decided whether to order or bake Maya's gluten-free cake.
- Kayaking remains undecided because Priya is concerned about falling into cold late-October water.
- The Friday departure time remains unresolved after Tom suggested 8 a.m.
- The group still needs to identify a nearby grocery store that stocks gluten-free food.
- Mia’s attendance is still unresolved.
- Jonah’s route from the airport to the cabin has not been arranged.
- Kayak plans remain undecided.
- The group still needs to identify a gluten-free grocery option near Birchwater.

#### Risks / blockers
- The booking could be blocked by Priya's rota if she cannot take the proposed dates.
- The cabin's pet policy is uncertain, creating a potential issue for bringing Waffles.
- Maya's celiac disease makes cross-contamination during food preparation a significant safety concern.
- The unplanned cleaning fee raised the shared cabin cost by $100 overall.
- A private chef would add a substantial extra cost and has therefore not been approved.
- The cabin's no-pet rule creates a care requirement for Waffles and exposes the group to a $250 pet-hair fee if violated.
- Maya's gluten-free diet requires strict cross-contamination controls, including separate preparation equipment.
- The reservation is at risk if the $570 deposit is not paid by September 25 because the date hold will expire.
- Mia's uncertain participation creates a temporary increase from $285 to $380 per person for the other three attendees.
- Jonah's surprise is vulnerable to accidental disclosure because Maya is in the existing birthday group chat.
- The surprise could be exposed if anyone mentions Jonah in the birthday group chat or interacts with Jonah’s posts.
- Jonah’s airport transfer is a significant logistical gap because the cabin is approximately three hours from the airport.
- The trip depends on securing the one shared SUV because the other car is unreliable for the long drive.
- Lack of confirmed gluten-free shopping near Birchwater could create a food-planning problem for Maya.

#### Notes
- The cabin has three bedrooms, sleeps six, is on the water, and includes a hot tub.
- Birchwater is approximately three hours away, compared with roughly four and a half hours for Hollins Ridge.
- Maya is strictly gluten-free because she has celiac disease, while Mia Chen is vegetarian.
- The group expects four paying participants: Dan, Priya, Tom, and Mia Chen.
- Maya turns 30 on Wednesday, October 21st, making the planned trip the weekend before her birthday.
- Tom is between jobs for much of October and said this is relevant to the trip.
- The remaining $570 cabin balance will be charged automatically two weeks before check-in.
- Tom volunteered to rent a vehicle large enough for five people in case Mia attends, and selected a seven-seater as the working plan.
- Jonah is Maya's brother and plans to fly in from Denver, arriving Saturday afternoon, October 24.
- Tom's Saturday dinner plan is gluten-free lasagna.
- The cake from Crumb and Kettle was considered because it offers a gluten-free option, but its previous cake was described as dry.
- Maya has not seen Jonah since he moved to Denver roughly fourteen months earlier, which is part of why the surprise is considered especially meaningful.
- The $179 green Polaroid was selected as the gift, with Mia potentially handling a card and flowers if she attends.
- Late-October conditions were described as roughly 50 degrees during the day and near freezing at night, so layers were recommended.
- Maya is expected to be picked up by Speaker 2 on the way to the 9:30 meeting.
- The group joked about a drive playlist but did not assign a creator.

#### Action items (structured)
- Priya: Book Heron Point Cabin using the available Hearthstay credit, subject to confirming the remaining details.
- Dan: Check whether Heron Point Cabin permits Waffles.
- Priya: Confirm whether the October 16–19 dates fit Priya's work rota.
- Check for a nearby grocery store that stocks suitable gluten-free food. [inferred]
- Priya: Priya will ask her sister Anjali whether she can take care of Waffles during the trip.
- Dan: Dan will book Heron Point before the September 25 deposit deadline, probably tomorrow. (deadline: Before Friday, September 25; probably tomorrow)
- Dan: Dan will pay the $570 deposit and collect $190 each from Priya and Tom. (deadline: By Friday, September 25)
- Priya: Priya will send Dan her $190 share via Venmo tonight. (deadline: Tonight)
- Tom: Tom will send Dan his $190 share by Wednesday, September 23. (deadline: Wednesday, September 23)
- Tom: Tom will rent a seven-seater SUV for the trip.
- Priya: Priya will get a definite yes or no from Mia about attending by Sunday. (deadline: Sunday)
- Priya: Priya will add Dan and Tom to the Operation Heron chat.
- Tom's $190 contribution is due Wednesday, September 23. [inferred]
- The $570 cabin deposit is due Friday, September 25. [inferred]
- Priya will confirm Mia's attendance by Sunday. [inferred]
- Speaker 1: Add the other two participants to the Operation Heron chat.
- Speaker 2: Book the Ridgeway SUV. (deadline: October 1)
- Me: Book the Birchwater Lake accommodation and pay the $570 deposit. (deadline: Before Friday)
- Speaker 1: Purchase the $179 green Polaroid gift. (deadline: October 16)
- Each contributor: Send Priya $60 each toward the gift.
- Me: Pay Priya the separate $190 amount mentioned at the end of the call. (deadline: Tonight)
- Group: Coordinate the remaining open trip details in Operation Heron.
- Order the green Polaroid gift (deadline: October 16) [inferred]
- Pay the separate $190 amount (deadline: Tonight) [inferred]

#### Decisions (structured)
- The group selected Heron Point Cabin at Birchwater Lake instead of the Hollins Ridge option.
- The planned trip dates are Friday, October 16th through Monday, October 19th, for three nights.
- Maya will not contribute to the cabin cost, leaving four paying people to split the corrected total of $1,140 at $285 each.
- The private-chef proposal was parked rather than approved.
- The cabin trip was moved from the weekend of October 16 to October 23–26 because Priya is working nights on the original weekend.
- The group decided not to hire the chef and will cook at the cabin instead.
- Dan will make the cabin booking and pay the $570 deposit on his card.
- The group will use a $50-per-person budget for Maya's group gift, with the green Polaroid camera as the leading idea.
- The group will initially split the $1,140 cabin cost among Dan, Priya, and Tom, making it $380 each unless Mia joins.
- The surprise visit from Jonah will be kept out of the birthday group chat and coordinated only through the separate Operation Heron chat.
- The group will use the separate chat named Operation Heron for all Jonah-related planning and avoid mentioning him elsewhere.
- The group will travel in one shared Ridgeway SUV rather than using separate cars.
- The group will meet at Priya’s place on Calloway Street at 9:30 on Friday the 23rd.
- The stay is set for Birchwater Lake, Heron Point, from Friday the 23rd through Monday the 26th, for three nights.
- The birthday gift budget is $180 total, with each of the three people contributing $60.
- The group agreed that there will be no dogs on the trip.
- The group recorded Maya as gluten-free and Mia as vegetarian for planning purposes.

#### Open questions (structured)
- Is Waffles allowed at Heron Point Cabin? [open]
- Will Priya's rota permit the October 16–19 trip? [open]
- Will the group hire a private chef for Saturday's birthday dinner? [open]
- Is there a nearby grocery store with reliable gluten-free supplies? [open]
- Will Mia attend the trip, and if so, will she join only on Sunday? [open]
- Will the group order a gluten-free cake from Crumb and Kettle or bake one at the cabin? [open]
- Will the group go kayaking at Birchwater during the trip? [open]
- What time will the group leave on Friday? [open]
- Where will the group buy gluten-free groceries near Birchwater? [open]
- How will the group coordinate Jonah's arrival and walk-in before dinner on Saturday? [open]
- Will Mia attend the trip? [open]
- How will Jonah travel from the airport to the cabin, which is about three hours away? [open]
- Will the group bring or rent kayaks? [open]
- Who will create the playlist for the drive? [open]

#### Risks (structured)
- [medium] The booking date is not fully confirmed until Priya checks her work rota.
- [medium] The trip may not accommodate Waffles if the cabin's pet-friendly status is incorrect or has restrictions.
- [high] Maya has celiac disease and requires strict gluten-free preparation with controls against cross-contamination.
- [medium] The cabin cost increased from the initially quoted $1,040 to $1,140 after the cleaning fee was noticed.
- [medium] Adding a private chef would increase the cost by approximately $150 per paying person.
- [high] Heron Point prohibits pets and charges a $250 fee if pet hair is found, so Waffles cannot stay at the cabin.
- [high] Maya's gluten-free requirement includes avoiding cross-contamination and requires separate preparation equipment such as a toaster and chopping board.
- [high] The cabin dates will be lost if the 50% deposit of $570 is not paid by Friday, September 25.
- [medium] Mia's uncertain attendance leaves the group temporarily paying $380 each, with the amount changing to $285 each if she confirms.
- [high] The Jonah surprise could be spoiled if it is mentioned in the birthday group chat or in jokes around Maya.
- [medium] The original October 16 weekend was unavailable for Priya because she is scheduled for night shifts on Friday, Saturday, and Sunday and cannot swap again.
- [high] Jonah’s airport-to-cabin transportation is unresolved, despite the cabin being about three hours from the airport.
- [medium] The group has only one car available at the lake, creating a transportation dependency on booking the SUV.
- [medium] The group’s existing car is making a noise and is not trusted for the three-hour drive each way.
- [high] Maya could discover the surprise if anyone mentions Jonah or interacts with his posts outside Operation Heron.
- [medium] Gluten-free grocery availability near Birchwater has not been checked.
- [medium] The late-October nighttime temperature near Birchwater may be close to freezing, so participants need appropriate layers.

#### Follow-up draft
Subject: Heron Point Cabin birthday weekend

Hi team,

Thanks for the thoughtful discussion on Maya’s birthday weekend. We aligned on Heron Point Cabin at Birchwater Lake for October 23–26, with Dan paying the $570 deposit by September 25; we’ll cook rather than hire a chef, use one shared SUV with no dogs, split the $1,140 cabin cost at $285 each among four paying participants, and coordinate Jonah’s surprise only through Operation Heron. We’ll also plan strict cross-contamination controls for Maya’s gluten-free requirements. The main open question is whether Mia can attend the revised dates, since that determines the final cost split and transport planning.

Best,

---

# Summary C

_(run1)_

### Title: Maya’s Heron Point Birthday Weekend

#### Overview
The group selected Heron Point Cabin at Birchwater Lake for Maya's October birthday weekend, estimated the cost at $285 per paying person, and assigned Priya to book while leaving pet access and food logistics to be checked. The group moved the cabin trip to October 23–26, assigned booking and transport tasks, set the deposit plan, and began coordinating a secret surprise visit from Jonah. The group finalized the three-night Birchwater trip logistics, gift budget, and secrecy rules while leaving Jonah’s airport transfer, kayaks, groceries, and Mia’s participation unresolved. Key decisions: The group chose Heron Point Cabin at Birchwater Lake over Hollins Ridge for Maya's birthday weekend.; Maya will not pay for the trip, and the $1,140 total will be split among four people at $285 each.; The group agreed to park the private-chef proposal for now rather than add its estimated $600 cost..

#### Summary
- The group selected Heron Point Cabin at Birchwater Lake for a three-night birthday weekend in late October.
- The birthday guest will not pay, and the total cost will be split among four people; the group will cook instead of hiring a chef and travel together in one Ridgeway SUV.
- Jonah’s surprise will remain secret and be discussed only in the separate Operation Heron chat.
- Waffles cannot attend because the cabin prohibits pets, and food preparation must follow strict gluten-free cross-contamination precautions while accommodating a vegetarian diet.

#### What changed
- The destination changed from two candidate cabins to Heron Point Cabin at Birchwater Lake.
- The estimated accommodation total was corrected from $1,040 to $1,140 after adding the cleaning fee.
- The per-person contribution was corrected from $260 to $285 for the four paying attendees.
- Priya offered to handle the booking and has approximately $150 in Hearthstay credit.
- The private-chef idea was deferred rather than added to the plan.
- The trip shifted from the weekend of October 16 to October 23–26, when Speaker 1 is off work and Heron Point is available for $1,140.
- Waffles was ruled out because Heron Point's house rules prohibit all pets.
- The chef option was dropped because its $600 cost was considered excessive.
- Mia became uncertain because she cannot attend the full weekend due to a cousin's wedding in Portland.
- The group identified that three attendees would pay $380 each, while four attendees would pay $285 each.
- A secret plan was added for Jonah to fly from Denver and surprise Maya before dinner on Saturday, October 24.
- The group established Operation Heron as the separate chat for the surprise planning.
- The travel plan was set as one SUV departing from Priya’s place at 9:30 on Friday the 23rd.
- The trip length was reduced or maintained at three nights rather than four.
- The gift budget changed from $150 total to $180 total through $60 contributions.
- The green Polaroid was selected as the gift at a listed price of $179.
- Food constraints were recorded as Maya gluten-free and Mia vegetarian.

#### Decisions
- Heron Point Cabin at Birchwater Lake was selected for the three-night birthday weekend.
- The group will use October 16th–19th as the proposed trip dates.
- Maya is excluded from the cost split because the trip is her birthday celebration.
- The four paying attendees will each contribute $285.
- The group confirmed October 23–26 as the cabin dates.
- The group confirmed that they will cook rather than hire a chef.
- The booking will be made by Dan rather than Speaker 1 because Speaker 1's credit expired and her card was flagged.
- Jonah's surprise will be coordinated through Operation Heron and kept out of the birthday group chat.
- The group will not use separate cars and will travel together in one SUV.
- The trip dates and location are Friday the 23rd through Monday the 26th at Birchwater Lake, Heron Point.
- The group will contribute $60 each toward the gift.

#### Action items
- Priya will book the selected cabin.
- Dan will check the listing to confirm whether pets are permitted.
- The group needs to identify a nearby source of gluten-free groceries.
- Speaker 1 will ask Anjali to care for Waffles during the trip.
- Dan will pay the $570 deposit and book the cabin before the September 25 deadline.
- Priya will send Dan $190 tonight and Tom will send Dan $190 by Wednesday, September 23.
- Priya will obtain Mia's final attendance decision by Sunday.
- Tom will rent a seven-seater vehicle suitable for up to five or more travelers.
- Speaker 1 will add the participants to Operation Heron after the call.
- Speaker 2 will book the Ridgeway SUV by October 1st.
- Me will book the accommodation and pay the $570 deposit before Friday.
- Speaker 1 will purchase the Polaroid by October 16th.

#### Open questions
- Can Waffles accompany the group to Heron Point Cabin?
- Will Priya's rota allow her to attend on October 16th–19th?
- Will the group revisit and approve the private-chef option?
- Who will take responsibility for checking nearby grocery stores?
- Will Mia join the trip for Sunday only or not attend at all?
- Will the group order a gluten-free cake or bake one at the cabin?
- Will the group rent kayaks during the trip?
- What time will the group leave on Friday?
- How Jonah will get from the airport to the cabin remains unresolved.
- Mia’s attendance remains unresolved.
- Whether to bring kayaks remains undecided.
- The group still needs to identify a gluten-free grocery option near Birchwater.

#### Risks / blockers
- Maya's celiac disease makes cross-contamination prevention essential when preparing and purchasing food.
- The cabin may not accept Waffles, which could affect the accommodation choice.
- The trip dates are not fully confirmed because Priya still needs to check her rota.
- The private-chef proposal may exceed the group's preferred budget.
- The no-pets rule creates a care requirement for Waffles and carries a $250 pet-hair fee if violated.
- The cabin reservation is at risk if the $570 deposit is not paid by September 25.
- Mia's uncertain participation leaves the group temporarily responsible for a higher per-person cost.
- Maya's gluten-free diet requires avoiding cross-contamination and using separate kitchen equipment.
- The surprise plan depends on strict secrecy because Maya is in the existing birthday group chat.
- Accidental disclosure of Jonah’s involvement could compromise the surprise.
- Jonah’s airport transfer is an unresolved logistics dependency.
- The group’s vehicle plan depends on booking the SUV because Me’s car is unreliable for the trip.
- Meal planning may be difficult until a gluten-free grocery source is found.

#### Notes
- The selected cabin has three bedrooms, sleeps six, is on the water, and includes a hot tub.
- Mia Chen is the likely fourth paying attendee, while Maya's work colleague Mia is not involved.
- Mia is vegetarian, whereas Maya requires a strictly gluten-free diet because of celiac disease.
- The proposed private chef would cook a five-course meal and handle the dishes, based on Tom's cousin's experience.
- Tom announced that he left Pellmark on October 9th and will start as a senior financial analyst at Halvorsen Logistics on November 2nd.
- Maya is gluten-free, Mia is vegetarian, and the group needs to find a nearby grocery store with gluten-free supplies.
- Tom offered to make gluten-free lasagna for Saturday dinner.
- The suggested group gift is a green Polaroid camera funded at $50 per person.
- The second half of the cabin payment, $570, will be charged automatically two weeks before check-in.
- Jonah plans to fly from Denver and enter shortly before dinner on Saturday, October 24.
- The expected late-October conditions were described as around 50 degrees during the day and near freezing at night, so layers were recommended.
- The group agreed that there would be no dogs on the trip.
- Maya lives two streets from Speaker 2, who plans to pick her up en route.
- Priya was reminded about an additional $190 payment.
- The group had not assigned the drive playlist to a specific person.

#### Action items (structured)
- Priya: Priya will book Heron Point Cabin using her Hearthstay credit.
- Dan: Dan will verify whether the cabin allows Waffles, since the pet-friendly status was not confirmed.
- Someone needs to check whether a nearby grocery store stocks suitable gluten-free food. [inferred]
- Speaker 1: Ask Anjali whether she can take care of Waffles during the trip.
- Me: Book Heron Point before the Friday, September 25 deposit deadline. (deadline: before Friday, September 25)
- Speaker 1: Send Dan $190 for the cabin deposit. (deadline: tonight)
- Speaker 1: Get a definite yes or no from Mia about attending the trip. (deadline: Sunday)
- Speaker 2: Rent a seven-seater vehicle for the trip.
- Speaker 1: Add the other participants to the separate Operation Heron chat.
- Cabin deposit due [inferred]
- Mia attendance confirmation due [inferred]
- Speaker 2's deposit reimbursement due [inferred]
- Speaker 1: Add both other participants to the Operation Heron chat after the call.
- Speaker 2: Book the Ridgeway SUV by October 1st. (deadline: October 1st)
- Me: Book Birchwater and pay the $570 deposit before Friday. (deadline: Before Friday)
- Speaker 1: Buy the green Polaroid by October 16th. (deadline: October 16th)
- Each participant: Each participant should send Priya $60 for the gift. [inferred]
- Speaker 2: Tom will pick up the SUV and Maya will be collected on the way to the meeting point. [inferred]
- Group: Continue sorting out unresolved trip details in Operation Heron. [inferred]
- Book the Ridgeway SUV (deadline: October 1st) [inferred]
- Order the green Polaroid (deadline: October 16th) [inferred]
- Book Birchwater and pay the deposit (deadline: Before Friday) [inferred]
- Meet at Priya’s place (deadline: 9:30 on Friday the 23rd) [inferred]

#### Decisions (structured)
- The group chose Heron Point Cabin at Birchwater Lake over Hollins Ridge for Maya's birthday weekend.
- The proposed trip dates are Friday, October 16th through Monday, October 19th, three nights before Maya's October 21st birthday.
- Maya will not pay for the trip, and the $1,140 total will be split among four people at $285 each.
- The group agreed to park the private-chef proposal for now rather than add its estimated $600 cost.
- The cabin trip was moved to October 23–26 because Speaker 1 is working nights on the original weekend.
- The group decided not to hire a chef and will cook at the cabin instead.
- Dan will book Heron Point and pay the $570 deposit on his card, with Priya and Tom reimbursing him $190 each.
- The group will keep Jonah's surprise visit secret from Maya and discuss it only in the separate Operation Heron chat.
- The group will use the separate Operation Heron chat for all discussion of Jonah and will not mention him in the birthday group chat or elsewhere.
- The trip will run for three nights from Friday the 23rd through Monday the 26th at Birchwater Lake, Heron Point.
- The group will travel together in one Ridgeway SUV rather than use separate cars.
- The group will meet at Priya’s place on Calloway Street at 9:30 on Friday the 23rd.
- The gift contribution was increased to $60 per person to cover the $179 green Polaroid.
- The group decided to keep the trip at three nights instead of extending it through Tuesday.

#### Open questions (structured)
- Whether Priya's work rota permits the October 16th–19th dates remains to be confirmed. [open]
- Whether Waffles can stay at the cabin is unresolved. [open]
- Whether the group will ultimately hire a private chef for Saturday dinner remains undecided. [open]
- Who will check nearby grocery options for gluten-free supplies has not been assigned. [open]
- Whether Mia can attend on Sunday remains unresolved because she has a cousin's wedding in Portland on Saturday, October 24. [open]
- The cake choice remains undecided between ordering a gluten-free cake from Crumb and Kettle and baking one at the cabin. [open]
- Whether the group will rent kayaks will be decided at the cabin. [open]
- The Friday departure time has not been finalized. [open]
- The final number of people sharing the cabin cost depends on Mia's attendance. [open]
- How will Jonah travel from the airport to the cabin, which is approximately three hours away? [open]
- Will Mia attend the trip? [open]
- Will the group bring kayaks? [open]
- Where is a nearby grocery store with gluten-free options? [open]
- Who will create the playlist for the drive? [open]
- Whether Mia will handle a card and flowers if she attends remains undecided. [open]

#### Risks (structured)
- [high] Maya has celiac disease and requires strict gluten-free preparation, including protection against cross-contamination.
- [medium] The proposed dates could conflict with Priya's rota until she checks it.
- [medium] Waffles' presence could be a booking constraint because the cabin's pet policy has not been verified.
- [medium] The private-chef option would add approximately $600, or $150 per paying person, to the trip cost.
- [high] Heron Point prohibits pets and charges a $250 fee if pet hair is found, so Waffles cannot attend.
- [high] The cabin dates could be lost if the 50% deposit of $570 is not paid by Friday, September 25.
- [medium] Mia's uncertain attendance affects the per-person cost, which is currently $380 for three people and would be $285 each if she joins.
- [high] Maya's gluten-free requirement includes cross-contamination precautions such as separate kitchen equipment.
- [medium] The original October 16–19 weekend was unavailable to Speaker 1 because of three consecutive night shifts and an inability to swap again.
- [high] The surprise could be spoiled if Jonah's visit is mentioned in the birthday group chat or in jokes around Maya.
- [high] The surprise could be exposed if anyone mentions Jonah in the birthday group chat, makes jokes, or interacts with his posts because Maya notices everything.
- [high] Jonah’s transportation from the airport is not arranged, despite the cabin being about three hours from the airport.
- [medium] The group has only one reliable vehicle because Me’s car is making a noise and is not trusted for the three-hour drive.
- [medium] Food planning may be constrained because Maya is gluten-free and no nearby gluten-free grocery store has been identified.
- [low] The gift purchase depends on collecting $60 from each participant, and the total is only slightly above the $179 purchase price.

#### Follow-up draft
Subject: Follow-up: Heron Point birthday weekend

Hi team,

Thanks for the productive discussion. We aligned on Heron Point Cabin at Birchwater Lake for October 23–26, with Maya excluded from the $1,140 accommodation split, cooking instead of hiring a chef, travel in one Ridgeway SUV, and Jonah’s surprise managed only through Operation Heron. We also agreed to contribute $60 each toward the green Polaroid and to follow strict gluten-free cross-contamination precautions while accommodating Mia’s vegetarian diet. The key open question is whether Mia will attend, since that determines the final cost split and food planning.

Best,

---

# Summary D

_(run1)_

### Title: Heron Point Cabin Birthday Weekend

#### Overview
The group caught up on Tom's new job and Priya's puppy, chose Birchwater Lake's Heron Point Cabin for Maya's 30th birthday weekend (Oct 16-19), corrected the cost to $1,140 ($285 each) with Priya to book using Hearthstay credit, and parked the private chef idea. The group moved Maya's birthday cabin trip to October 23rd-26th after Priya's night shifts blocked the 16th, dropped the $600 chef, made Dan the new booker paying the $570 deposit, and revealed Jonah's secret surprise visit. The group locked in the surprise-birthday logistics for Maya's Birchwater Lake trip — 9:30 a.m. departure from Priya's on Calloway on Friday the 23rd for three nights, one rented SUV, $60 each toward a $179 Polaroid Priya buys by October 16th — while leaving Jonah's airport transport, Mia's attendance, kayaks and the gluten-free grocery question open for the Operation Heron chat. Key decisions: Birchwater Lake's Heron Point Cabin was chosen over Hollins Ridge for the birthday trip, partly because it has a hot tub and is a shorter drive.; Trip dates were set as Friday, October 16th to Monday the 19th, the weekend before Maya's birthday.; The $1,140 total is split four ways at $285 each, with Maya not paying since it's her birthday..

#### Summary
- The group met to plan a cabin weekend for the 30th birthday of Maya, settling on Heron Point Cabin at Birchwater Lake for Friday, October 23rd to Monday the 26th, chosen over Hollins Ridge partly for its hot tub and shorter drive.
- The cabin totals just over eleven hundred dollars with a deposit of half that due Friday, September 25th, and Dan took over the booking after the expired Hearthstay credit of Priya and her previously flagged card ruled her out; the split is $380 each unless Mia confirms, which would bring it to $285 each.
- The roughly $600 private chef was dropped in favor of the group cooking for themselves, with Tom making a gluten-free lasagna on Saturday, and the stay was kept at three nights with no dogs attending; gift contributions were set at $60 each toward the $179 green Polaroid that Priya will buy, the group will ride together in one rented SUV leaving at half past nine in the morning from Calloway Street where Priya lives, planning for the surprise arrival of Jonah moved into a separate chat named Operation Heron, and Maya is celiac and strictly gluten-free while Mia is vegetarian, with cross-contamination a real concern requiring a separate toaster and chopping board.

#### What changed
- Tom revealed he quit Pellmark, with his last day on October 9th, and starts at Halvorsen Logistics on Monday, November 2nd as a senior financial analyst.
- The trip destination shifted from considering Hollins Ridge to settling on Birchwater Lake's Heron Point Cabin.
- The stated cabin cost was corrected mid-discussion from $1,040 to $1,140 after Dan noticed the missed cleaning fee at $325 a night plus fees.
- Dan flagged that his work reorg has escalated to Graham scheduling a meeting to plan the meeting, with a 22-slide deck.
- Priya reported she did a twelve and a half hour shift a day earlier because the unit was three nurses short.
- Priya said she is moving to day shifts in November, which she called light at the end of the tunnel.
- It was clarified that Maya is celiac and strictly gluten-free while Mia is the vegetarian, correcting Tom's mix-up.
- The trip was moved from the weekend of the 16th to October 23rd-26th because Priya is on Friday-Sunday night shifts the 16th weekend.
- Heron Point was confirmed open for the 23rd-26th at the same price, $1,140 total.
- The pet-friendly assumption was wrong — the listing filter was picking up nearby pet-friendly trails, not the house itself.
- Priya's credit expired on September 1st, so she handed the booking to Dan.
- Mia can't make the 23rd because of her cousin's wedding on Saturday the 24th in Portland.
- With Mia unconfirmed, the cost split rose to $380 each across three people, dropping to $285 each if she confirms.
- The deposit was found to be due Friday September 25th (not the end of the month), totaling $570 as 50%.
- Jonah, Maya's brother, plans to fly in from Denver and surprise her before dinner on Saturday the 24th.
- A separate planning chat, "Operation Heron," was created so the birthday group chat containing Maya stays clean.
- Departure time shifted from 8 a.m. to 9:30 a.m., because showing up at 8 would risk Maya cancelling her own birthday.
- The meet-up point is now fixed as Priya's place on Calloway Street, chosen because it is in the middle for everyone.
- The gift per-person contribution was raised from $50 to $60 after the Polaroid turned out to cost $179.
- Trip length was settled at three nights, Friday the 23rd to Monday the 26th, after Tom floated extending to four nights through Tuesday.
- Transport changed from Tom's separate-car idea to a single rented SUV for the whole group.
- Tom's booking commitment got a date: the Ridgeway SUV is to be booked by October 1st.
- Priya was given a concrete gift deadline of ordering the Polaroid by October 16th so it arrives in time.
- Dan confirmed he is booking the cabin and covering the $570 deposit before Friday.
- The remaining unknowns were explicitly deferred out of the call into the Operation Heron chat.

#### Decisions
- Birchwater Lake's Heron Point Cabin was chosen, with the hot tub cited as the deciding factor.
- The trip was set for Friday, October 16th to Monday the 19th, three nights, the weekend before Maya's birthday.
- The cost is split four ways among Dan, Priya, Tom and (likely) Mia Chen at $285 each, with Maya not paying.
- Priya was assigned to make the booking, applying her roughly $150 Hearthstay credit from the cancelled Lisbon trip.
- The private chef idea was deferred rather than approved.
- Trip dates confirmed as October 23rd to 26th.
- No private chef; the group will cook for themselves.
- Waffles will not come; Priya will ask her sister to take him.
- Dan is the booker and will pay the deposit; Priya and Tom reimburse $190 each.
- Tom cooks Saturday dinner (gluten-free lasagna).
- Group gift budget is $50 each toward the green Polaroid camera.
- Tom rents a seven-seater car ('something big enough for five, in case Mia comes').
- Jonah's surprise stays off the birthday group chat; a separate 'Operation Heron' chat handles it.
- Only three people are in the loop for the Jonah surprise, and the planning chat is named Operation Heron.
- No one is to like or react to Jonah's posts, because Maya notices everything.
- Tom will book the Ridgeway SUV by October 1st, with no 8 a.m. pickup.
- Departure is 9:30 a.m. on Friday the 23rd, from Priya's place on Calloway Street, with Tom picking up the SUV first and collecting Maya en route.
- The group rides together in one car rather than splitting into separate vehicles.
- Gift cost is $60 per person ($180 total) to cover the $179 Polaroid, and Priya will purchase it.
- If Mia joins, she handles the card and flowers instead of chipping in cash.
- The stay stays at three nights, Friday the 23rd to Monday the 26th, rather than four nights to Tuesday.
- No dogs on the trip.
- Maya is gluten-free and Mia is vegetarian — dietary constraints recorded for the trip.

#### Action items
- Priya to book the Heron Point Cabin on Hearthstay for the Oct 16-19 weekend.
- Priya to check her work rota later to confirm the dates work.
- Dan to double-check the listing's pet policy so Priya can bring Waffles.
- Dan to pull up the listing properly to verify the pet thing at the end of the call.
- Someone (unassigned) to check for a nearby grocery store stocking gluten-free items for Maya.
- Priya to ask sister Anjali to take Waffles that weekend.
- Dan to book the cabin before Friday, probably tomorrow.
- Priya to Venmo her $190 tonight.
- Tom to send his $190 by Wednesday.
- Priya to get a proper yes or no from Mia by Sunday.
- Priya to look up the Polaroid camera price.
- Priya to add the others to Operation Heron after the call.
- Priya adds the other two participants to the Operation Heron chat right after the call.
- Tom books the Ridgeway SUV by October 1st and is asked to avoid an 8 a.m. pickup.
- Tom picks up the SUV and then meets everyone at Priya's on Calloway at 9:30 on Friday the 23rd.
- Tom collects Maya on the way, since she lives two streets over from him.
- Dan books the cabin and pays the $570 deposit before Friday.
- Priya orders the green Polaroid by October 16th so it definitely arrives in time.
- Everyone sends Priya $60 for the gift.
- Priya pays Dan the $190 she owes, promising to do it tonight.
- A playlist for the drive still needs an owner — Tom is explicitly excluded and Dan only committed to "we'll see."
- The open items — Mia, Jonah's transport, kayaks and the gluten-free grocery run — are to be sorted in the Operation Heron chat.

#### Open questions
- Whether Waffles can attend depends on confirming the listing is pet friendly.
- Priya's availability for the Oct 16-19 weekend is unconfirmed pending her rota.
- The private chef for Saturday night remains undecided given the ~$600 cost and $150-per-person implication.
- The overall food plan for the weekend (cooking the whole time vs. chef) was raised but not resolved.
- Cake remains a maybe — order Crumb and Kettle's gluten-free (dry last time) or bake one at the cabin.
- Kayak rental on Birchwater (~$45/person for a half day) left undecided for in-person choice.
- Whether Mia can join, possibly just the Sunday, is unresolved pending her reply.
- Friday departure time not settled; Tom proposed an 8 a.m. pickup.
- Whether a nearby grocery store stocks gluten-free food for Maya was raised but not assigned.
- How Jonah gets from the airport to the Birchwater cabin, roughly three hours away, is still unresolved — Jonah said he would figure it out.
- Whether Mia is coming at all remains open.
- Kayaks are still only a maybe for the trip.
- Nobody has verified whether there is a gluten-free store near Birchwater for the groceries.
- Late-October weather for the cabin cannot be forecast yet; the group is working off typical conditions of about fifty degrees by day and near freezing at night.

#### Risks / blockers
- Maya's celiac condition makes cross-contamination a genuine risk, requiring a separate toaster and chopping board.
- Priya's shift pattern could block her from the chosen dates until her rota is checked.
- The private chef would add about $150 per person, which Tom himself called insane once said aloud.
- Pet-friendliness of the cabin is unverified, risking that Waffles cannot come.
- The Wanderers' goalkeeper's return is unreliable, having promised to come back the week before too.
- Priya's expired credit and previously flagged card block her from booking, shifting the task to Dan.
- The $570 deposit deadline is Friday September 25th; missing it drops the hold on the dates.
- Cost per person is $380 unless Mia confirms, which Priya acknowledged with a resigned 'Oof.'
- A $250 pet-hair fee applies if any evidence is found at Heron Point.
- Jonah's surprise risks leaking since the birthday group chat includes Maya.
- The group has only one car and it will be parked at the lake, leaving Jonah's transfer from the airport unsolved.
- Dan's car has a recurring noise problem and he does not trust it for three hours each way, which is part of why the group consolidated onto one rental.
- The $179 Polaroid breaks the $150 assumption — the original $50-each plan would have fallen short.
- Surprise integrity is fragile: Maya notices everything, so nobody may interact with Jonah's posts and his name must not appear outside Operation Heron.
- Tom has a prior record of spoiling surprises — he told Priya about her own surprise party while standing next to her — prompting extra secrecy rules.
- Extending to four nights is blocked because Priya is back on shift Tuesday morning.
- An extra night would cost another $325 or more.
- Dietary logistics are unsecured — Maya is gluten-free and Mia vegetarian, but no one has checked for a gluten-free store near Birchwater.
- Cold weather risk: late October at Birchwater is typically around fifty degrees by day and near freezing at night, so real layers are required.

#### Notes
- Priya's beagle Waffles is eleven weeks old and has already eaten two phone chargers and one of her work clogs, leaving her with a single clog.
- Waffles starts puppy class next Saturday with a trainer named Brenda who formerly trained police dogs.
- The Hollins Ridge option was rejected largely because it is about four and a half hours away versus roughly three for Birchwater, and a prior trip there had a broken heater.
- Four paying attendees were identified: Dan, Priya, Tom, and Mia Chen, who said she is probably in.
- The relevant Mia is Mia Chen from Priya's book club; Maya's work colleague Mia moved to London.
- Tom's private-chef reference was his cousin, who paid around $600 for a five-course dinner where the chef also did all the dishes.
- Maya was described as the most organized of the group, having kept a color-coded calendar since freshman year.
- The Wanderers lost six-two on Tuesday with Tom in goal for the second half, conceding four goals.
- Dan's reorg deck reportedly has 22 slides, including one that just says "Alignment" in huge letters.
- Priya spoiled the Harbor Lights finale for Tom, who was two episodes behind, and would not accept Dan's defense that the sudden death was intentional.
- Priya is on nights Friday-Sunday the 16th weekend and has already swapped twice this month, so she can't swap again.
- Maya has a big work presentation on Friday the 16th, which Priya thinks means she'd prefer the later date.
- The remaining $570 balance auto-charges two weeks before check-in.
- Tom's new Halvorsen role starts November 2nd, is hybrid (two days from home), and pays for a CFA level-two certification, with no signing bonus.
- Tom's Halvorsen interview was five rounds; the final case study had a warehouse budget and forty minutes, and his laptop died halfway so he finished on a whiteboard.
- Dan's rent goes up $200/month at his January lease renewal, and he's looking at a fourth-floor walk-up near the river, scanning about six listings a night.
- Dan, Priya and Tom discussed a TV show whose ratings dropped after season two when it moved to Thursdays, with talk it might not get a fourth season.
- Priya shared a hospital anecdote about a man who glued his hand to a ladder he was fixing while standing on it; the ladder stayed in the ambulance bay for about three hours.
- Jonah has not seen Maya since the summer before last — about fourteen months — when he moved to Denver, and Maya keeps saying she misses him.
- The trip location is Birchwater Lake, Heron Point, Friday the 23rd to Monday the 26th.
- The Polaroid being bought is the green one at $179.
- Late October conditions at the lake are typically around fifty degrees during the day and near freezing at night, which Tom called perfect hot tub weather.
- Priya lives on Calloway Street, chosen as the meeting point because it is in the middle for everyone.
- Tom explicitly stated he is unemployed, which is why he floated a longer trip.
- Priya owes Dan $190 and he reminded her of it at the end of the call.
- Tom's fleece came up as a packing joke — Priya said it has a hole and Dan noted it is from a charity 5K in 2019.
- Maya and Jonah have not been in contact in person since he moved, which Priya framed as the reason the surprise is "so perfect."
- Tom recited back the full plan — Birchwater Lake, Heron Point, Friday the 23rd to Monday the 26th — plus the SUV booking and the 9:30 meet-up, to confirm he had it right.
- The call ended with Tom leaving early because of a barking dog next door.

#### Action items (structured)
- Priya: Priya to book the Heron Point Cabin on Hearthstay for Oct 16-19.
- Priya: Priya to check her rota later to confirm she can make the Oct 16-19 dates.
- Dan: Dan to double-check whether the cabin listing is actually pet friendly so Waffles can come.
- Dan: Dan to pull up the listing properly to verify the pet policy.
- unassigned: Someone to check whether there is a decent grocery store near the cabin that stocks gluten-free food. (deadline: absent) [inferred]
- Tom: Tom noted he should write down the dietary rules (Maya gluten-free, Mia vegetarian). [inferred]
- Tom's last day at Pellmark is October 9th. [inferred]
- Tom starts at Halvorsen Logistics on Monday, November 2nd. [inferred]
- Maya turns 30 on Wednesday, October 21st. [inferred]
- Cabin trip proposed for Friday, October 16th to Monday the 19th. [inferred]
- Puppy class starts next Saturday. [inferred]
- Priya moves to day shifts in November. [inferred]
- Priya: Priya to ask her sister Anjali to take Waffles that weekend.
- Dan: Dan to book the cabin before Friday, likely tomorrow. (deadline: before Friday)
- Priya: Priya to Venmo Dan her $190 share tonight. (deadline: tonight)
- Tom: Tom to send his $190 share by Wednesday. (deadline: Wednesday)
- Priya: Priya to get a firm yes or no from Mia by Sunday. (deadline: Sunday)
- Tom: Tom to rent a seven-seater (Ridgeway SUVs around $64/day).
- Priya: Priya to look up the price of the Polaroid camera.
- Priya: Priya to add Dan and Tom to the Operation Heron chat after the call.
- Someone (unassigned) to check whether a nearby grocery store stocks gluten-free food. [inferred]
- Deposit of $570 due [inferred]
- Priya's Venmo payment of $190 [inferred]
- Tom's payment of $190 [inferred]
- Priya's firm answer from Mia [inferred]
- Tom's new job start [inferred]
- Priya: Add the other two participants to the Operation Heron chat after the call
- Tom: Book the Ridgeway SUV (deadline: October 1st)
- Tom: Pick up the rented SUV, then meet the group at Priya's on Calloway at 9:30 a.m. Friday the 23rd (deadline: Friday the 23rd, 9:30 a.m.)
- Tom: Grab Maya on the way to the meet-up point — she lives two streets over from Tom
- Priya: Order the green Polaroid gift so it arrives in time (deadline: October 16th)
- Each person sends Priya $60 for the gift (deadline: unspecified)
- Priya: Pay Dan the $190 owed (deadline: tonight)
- unassigned: Someone (unassigned) should make a playlist for the drive; Tom and Priya are ruled out [inferred]
- Priya: Sort the remaining open items (Mia, Jonah's transport, kayaks, gluten-free grocery) in the Operation Heron chat
- Priya to order the Polaroid gift by October 16th [inferred]
- Tom to book the Ridgeway SUV by October 1st [inferred]
- Dan to pay the $570 cabin deposit before Friday [inferred]
- Trip: Friday the 23rd to Monday the 26th at Birchwater Lake, Heron Point [inferred]
- Priya to pay the $190 owed tonight [inferred]

#### Decisions (structured)
- Birchwater Lake's Heron Point Cabin was chosen over Hollins Ridge for the birthday trip, partly because it has a hot tub and is a shorter drive.
- Trip dates were set as Friday, October 16th to Monday the 19th, the weekend before Maya's birthday.
- The $1,140 total is split four ways at $285 each, with Maya not paying since it's her birthday.
- Priya will book the cabin, using her roughly $150 of Hearthstay credit from a cancelled Lisbon trip.
- The private chef idea for Saturday night was parked rather than agreed.
- The cabin trip for Maya's birthday is moved to October 23rd-26th.
- The $600 private chef is dropped; the group will cook their own meals.
- Heron Point does not allow pets, so Priya's dog Waffles will not attend.
- Dan will book the cabin on his card instead of Priya.
- Tom will cook Saturday dinner, a gluten-free lasagna.
- The group gift is set at $50 each toward the green Polaroid camera.
- Tom will rent a seven-seater car for the trip.
- A separate chat called 'Operation Heron' will be created to keep Jonah's surprise secret.
- Dan pays the full $570 deposit; Priya and Tom each send him $190.
- Cake and kayaking were left as open 'maybes' to decide later rather than resolved.
- All planning for Jonah's surprise arrival is moved into a separate chat named "Operation Heron," and nothing about Jonah is to be mentioned anywhere else, including jokes. (owner: Priya)
- The group will leave at 9:30 a.m. rather than 8 a.m. because Maya is not a morning person.
- Everyone meets at Priya's place on Calloway Street at 9:30 a.m. on Friday the 23rd, with Tom picking up the SUV first.
- The group takes one car (the rented SUV) rather than driving separately.
- Gift contributions are set at $60 each ($180 total) instead of $50 each, so the $179 Polaroid is covered.
- Priya will buy the Polaroid gift and order it by October 16th so it arrives in time. (owner: Priya)
- The trip stays at three nights, Friday the 23rd to Monday the 26th; Tom's idea of four nights through Tuesday is rejected.
- No dogs on the trip.
- If Mia comes, she is assigned the card and flowers rather than a cash contribution.
- Dan is booking the cabin and paying the $570 deposit before Friday. (owner: Dan)

#### Open questions (structured)
- Can Waffles come to the cabin — is the rental actually pet friendly? [open]
- Will Priya's rota allow her to take the Oct 16-19 dates off? [open]
- Is the private chef for the Saturday birthday dinner worth the roughly $600 cost ($150 each)? [open]
- Is the Wanderers goalkeeper actually back next week? [open]
- What is the food plan for the trip — are they cooking the whole time? [open]
- Whether to order the cake from Crumb and Kettle or bake one up at the cabin. [open]
- Whether to rent kayaks on Birchwater in late October. [open]
- Whether Mia can attend part of the weekend, possibly just the Sunday. [open]
- What time the group departs on the Friday. [open]
- How many people will ultimately split the cost, given Mia's uncertainty. [open]
- How is Jonah actually getting from the airport to the cabin, since Birchwater is about three hours from the airport? [open]
- Is Mia coming on the trip at all? [open]
- Are kayaks happening — still listed as only a maybe? [open]
- Has anyone checked whether there's a gluten-free store near Birchwater? [open]
- What will the weather be in late October — the forecast does not extend that far yet? [open]

#### Risks (structured)
- [high] Maya is celiac and strictly gluten-free, so cross-contamination is a real concern requiring separate toaster and chopping board.
- [medium] Priya's attendance depends on her rota, which has not yet been confirmed.
- [medium] A private chef at roughly $600 would add about $150 per person on top of the cabin cost.
- [low] Confusion over Maya vs Mia's dietary needs risked wrong food planning; Tom regularly mixes up Maya and Mia.
- [low] The previous Hollins Ridge trip had a broken heater and a four-and-a-half-hour drive that Priya refuses to repeat.
- [high] Priya's credit expired on September 1st and her card was flagged last time she booked, so she cannot make the reservation herself.
- [high] The $570 deposit (50%) is due by Friday, September 25th, after which the hold on the dates drops.
- [medium] Cost per person rises to $380 each if Mia does not confirm.
- [medium] A $250 fee applies if pet hair is found at Heron Point.
- [medium] Jonah's surprise must stay secret, since the birthday group chat includes Maya.
- [low] The trip is now two days after Maya's actual birthday, accepted as still within her birthday week.
- [high] There is only one car in the group and it will be sitting at the lake, making the airport-to-cabin leg for Jonah unresolved.
- [medium] Dan's own car is making 'that noise again' and he doesn't trust it for a three-hour drive each way.
- [medium] The $179 Polaroid exceeds the $150 assumption, so the original $50-each split did not cover it.
- [high] Surprise secrecy risk: Maya notices everything, so no one may like or react to Jonah's posts and nothing about him may leak outside Operation Heron.
- [medium] Past spoiler behaviour risk: Tom previously told Priya about her own surprise party while standing next to her, which is why the group is reinforcing secrecy.
- [medium] Priya cannot extend the trip to Tuesday because she is back on shift Tuesday morning.
- [low] A fourth night would add another $325 or more in cost.
- [medium] Dietary constraints are not yet secured: Maya is gluten-free and Mia is vegetarian, and no gluten-free store near Birchwater has been checked.
- [low] Late-October conditions at the cabin are likely around 50°F in the day and near freezing at night, so layered clothing is required.

#### Follow-up draft
Subject: Follow-up: Maya's 30th birthday cabin weekend at Heron Point

Hi all,

Thanks for the time today — good to have the cabin weekend pinned down. We've settled on Heron Point at Birchwater Lake for Friday, October 23rd through Monday the 26th, three nights, with Dan booking and covering the $570 deposit before Friday. We're skipping the private chef and cooking ourselves, with Tom doing a gluten-free lasagna on Saturday, everyone chipping in $60 toward the Polaroid Priya is ordering, and a 9:30 a.m. meet-up at Priya's on Calloway to head up together in one rented SUV. Anything to do with the surprise arrival stays in the Operation Heron chat so the birthday thread stays clean.

The one thing still open is whether Mia can make it, since that decides whether we're at $380 each across three or $285 each across four.

Best,

---

# Summary E

_(run1)_

### Title: Maya's 30th Birthday Cabin Weekend

#### Overview
Friends caught up on personal news (Tom's new job, Priya's puppy), then planned Maya's 30th birthday cabin weekend — settling on Birchwater Lake/Heron Point for Oct 16–19 at $1,140 total, with Priya to book using Hearthstay credit. The group reworked the cabin weekend to October 23-26 after Priya's night rota conflicted, dropped the $600 chef, and planned a secret surprise arrival by Maya's brother Jonah. The group finalized logistics for Maya's surprise birthday weekend at Birchwater Lake (Heron Point, Fri Oct 23–Mon Oct 26), settling on $60 each for the gift, one rented SUV, a 9:30 pickup at Priya's, and leaving unresolved issues to a new 'Operation Heron' chat. Key decisions: Maya's birthday cabin weekend will be at Birchwater Lake, specifically Heron Point Cabin, over Hollins Ridge.; Priya will book Heron Point Cabin since she has about $150 of Hearthstay credit.; Maya does not pay for the trip since it is her birthday; the cost is split among the four paying attendees..

#### Summary
- Friends caught up on personal news (Tom's new job, Priya's puppy), then planned Maya's 30th birthday cabin weekend — settling on Birchwater Lake/Heron Point for Oct 16–19 at $1,140 total, with Priya to book using Hearthstay credit.
- Maya's birthday cabin weekend will be at Birchwater Lake, specifically Heron Point Cabin, over Hollins Ridge.
- Priya will book Heron Point Cabin since she has about $150 of Hearthstay credit.
- Maya is celiac (strictly gluten-free, not a preference) and cross-contamination is a real concern, requiring a separate toaster and chopping board.

#### What changed
- Tom quit Pellmark; his last day is October 9th.
- Tom starts at Halvorsen Logistics on Monday, November 2nd as a senior financial analyst.
- Tom has about three weeks off in October before his new job.
- Priya's beagle puppy Waffles is eleven weeks old and has eaten two phone chargers and one work clog.
- Priya is moving to day shifts in November.
- The trip dates proposed are Friday October 16th to Monday the 19th, the weekend before Maya's birthday.
- The correct cabin total is $1,140 (was initially said as $1,040) at $325/night plus fees.
- The cabin weekend moved from the 16th to October 23rd-26th because Priya is on nights Friday-Sunday of the 16th and cannot swap.
- The $600 chef was cut, saving the group roughly half the cabin cost; they will cook themselves.
- The pet-friendly assumption was wrong; Heron Point bans all pets with a $250 fee for pet hair, so Waffles is not coming.
- Mia cannot make the 23rd due to her cousin's wedding on Saturday the 24th in Portland; she may come Sunday but isn't sure.
- With three people confirmed, the trip cost is now $380 each instead of $285 each, dropping back to $285 if Mia confirms.
- Tom's new job at Halvorsen starts November 2nd, is hybrid (two days from home), and includes paid CFA level two certification but no signing bonus.
- A separate chat called 'Operation Heron' was created to plan the surprise away from Maya.
- Gift budget moved from $50 each to $60 each after finding the green Polaroid at $179.
- Departure time was pushed from 8 a.m. to 9:30 a.m. so Maya wouldn't cancel her own birthday.
- Travel plan switched from potentially two cars to a single shared car.
- Trip length was kept at three nights rather than Speaker 2's proposed four nights.

#### Decisions
- Birchwater Lake / Heron Point Cabin chosen over Hollins Ridge for the birthday weekend.
- Priya will book the cabin using her ~$150 Hearthstay credit.
- Maya doesn't pay; cost split among Dan, Priya, Tom and Mia.
- Private chef for Saturday night parked for now.
- Confirmed the cabin weekend as October 23rd to 26th at Heron Point at the same price of $1,140 total.
- Agreed no chef and the group will cook; Tom will make gluten-free lasagna for Saturday dinner.
- Deferred the cake decision to a maybe (order from Crumb and Kettle vs. bake).
- Left kayak rentals as a maybe to decide once at the cabin.
- Confirmed a $50-each group gift as the target, with the green Polaroid camera as the leading idea.
- Agreed Tom will rent a seven-seater car and pick everyone up, with timing to be figured out later.
- Agreed to keep Jonah's surprise completely secret in a separate 'Operation Heron' chat, not even jokes in the main group.
- Nothing about Jonah goes anywhere except Operation Heron — not even jokes.
- Priya will buy the gift and order it by October 16th.
- Everyone sends Priya $60 for the gift.
- Meet at Priya's place on Calloway Street at 9:30 on Friday the 23rd, with Tom picking up the SUV first.
- No dogs on the trip; Maya is gluten-free and Mia is vegetarian.
- Open items will be sorted out in the Operation Heron chat.

#### Action items
- Priya to book Heron Point Cabin on Hearthstay after checking her rota.
- Dan to double-check the pet-friendly status of the listing.
- Someone to check for a nearby grocery store with gluten-free options.
- Priya will ask her sister Anjali to take Waffles for the cabin weekend.
- Dan will book the cabin before Friday, probably tomorrow, on his card.
- Dan will check the deposit due date on the listing (found: Friday September 25th).
- Priya will get a proper yes or no from Mia by Sunday.
- Priya will Venmo her $190 tonight; Tom will send his $190 by Wednesday.
- Tom will make a gluten-free lasagna for Saturday dinner at the cabin.
- Tom will rent a seven-seater car (Ridgeway SUVs around $64/day).
- Priya will look up the price of the green Polaroid camera for the gift.
- Priya will add Dan and Tom to the 'Operation Heron' chat after the call.
- Speaker 2 books the Ridgeway SUV by October 1st.
- Speaker 2 picks up Maya on the way, two streets over from him.
- Me books the rental and pays the $570 deposit before Friday.
- If Mia comes, she can handle the card and flowers.
- Speaker 1 promised to pay the $190 owed tonight.

#### Open questions
- Is the cabin pet-friendly so Waffles can attend?
- Whether to book a private chef (~$600) for Saturday night.
- Does Priya's rota allow the Oct 16–19 dates?
- Whether to order a gluten-free cake from Crumb and Kettle (Priya found their GF version dry) or bake at the cabin — noted as a maybe.
- Whether the group will actually rent kayaks given late-October cold water.
- Whether Mia will confirm any part of the trip, with Tom pushing for a real answer rather than waiting.
- What departure time the group will actually use on Friday.
- How Jonah gets from the airport to the cabin remains unresolved, and he said he'd figure it out himself.
- Whether Mia is coming is still open.
- Kayaks remain a maybe.
- Nobody has checked for a gluten-free store near Birchwater.
- No one has volunteered to make the drive playlist.

#### Risks / blockers
- Maya's celiac condition means strict gluten-free and anti-cross-contamination measures are required for any meals.
- Priya's rota may conflict with the proposed cabin dates.
- Different dietary needs across the group: Mia is vegetarian, Maya is gluten-free.
- Pets are banned at Heron Point with a $250 pet hair fee, so the pet-friendly listing filter was misleading.
- Priya's card situation (expired credit September 1st, flagged card) forces Dan to be the booker.
- The $570 deposit is due by Friday September 25th or the hold on the dates is released.
- Cross-contamination risk for Maya's gluten-free needs requires separate toaster and chopping board.
- Priya cannot swap her night shifts because she has already swapped twice this month.
- Mia possibly not attending raises the per-person cost to $380 each.
- Only one car is available and it will be sitting at the lake, complicating Jonah's airport-to-cabin transport.
- Dan's car has recurring noise and isn't trusted for a three-hour drive each way.
- Maya notices everything, so any leak or likes on Jonah's posts could spoil the surprise.
- Late October nights at Birchwater are near freezing, requiring real layers.
- A four-night stay would cost another $325 plus and Speaker 1 can't do Tuesday due to a shift.

#### Notes
- Hollins Ridge was rejected as too far at ~4.5 hours drive vs Birchwater's ~3 hours; last trip there had an album on repeat and a broken heater.
- Heron Point Cabin has three bedrooms, sleeps six, is right on the water, and has a hot tub.
- Cost after correction is $285 each across four paying attendees.
- Maya turns 30 on Wednesday, October 21st; plan remains a three-night cabin weekend.
- Priya starts puppy class with Waffles next Saturday under trainer Brenda.
- Dan's work reorg includes a pre-meeting with a 22-slide deck led by Graham.
- There are two Mias (book club Mia Chen and Maya's work Mia who moved to London), causing confusion.
- Dietary restrictions noted: Maya is gluten-free, Mia is vegetarian.
- Priya's dog Waffles will 'eat a charger in your honor' rather than come to the cabin.
- Priya thinks Maya would prefer the weekend after her birthday because she has a big work presentation Friday the 16th.
- Dan's rent is rising $200 a month at lease renewal in January, prompting an apartment hunt of about six listings a night; a river place is a fourth-floor walk-up.
- Tom's Halvorsen interview was five rounds, including a 40-minute warehouse-budget case study where his laptop and whiteboard marker both died mid-task.
- Priya recounted a patient who glued his hand to a ladder and calmly asked if they could save the ladder; the ladder stayed in the ambulance bay about three hours.
- The remaining $570 balance will be charged automatically two weeks before check-in.
- Jonah lands Saturday the 24th in the afternoon and wants to walk in right before dinner to surprise Maya.
- Maya believes the weekend is just the four of them having a quiet birthday trip.
- Jonah hasn't seen Maya in about fourteen months, since he moved to Denver, and she keeps saying she misses him.
- Priya's place on Calloway Street was chosen as the meeting point because it's in the middle for everyone.
- Late October weather at Birchwater is usually around fifty during the day and near freezing at night.
- Speaker 2 praised the timing as the perfect hot tub weather.
- A running joke referenced Tom having previously told Priya about her own surprise party while standing next to him.
- The green Polaroid costs $179, which is more than the $150 the original $50-each plan covered.

#### Action items (structured)
- Priya: Priya to book Heron Point Cabin on Hearthstay, checking her work rota for the dates.
- Dan: Dan to double-check whether the cabin listing is pet-friendly.
- Someone to check if there is a decent grocery store near the cabin that stocks gluten-free products.
- Tom's last day at Pellmark [inferred]
- Tom starts at Halvorsen Logistics [inferred]
- Maya's 30th birthday [inferred]
- Proposed cabin dates [inferred]
- Speaker 1: Ask her sister Anjali to take Waffles the cabin weekend.
- Dan: Book the Heron Point cabin on his card, before Friday September 25th, probably tomorrow. (deadline: before Friday September 25th)
- Speaker 1: Get a proper yes or no from Mia by Sunday. (deadline: Sunday)
- Speaker 1: Venmo her $190 share tonight. (deadline: tonight)
- Tom: Send his $190 share by Wednesday. (deadline: Wednesday)
- Tom: Make a gluten-free lasagna for Saturday dinner at the cabin.
- Tom: Rent a car (seven-seater) for the trip.
- Speaker 1: Look up the price of the green Polaroid camera as a possible gift.
- Dan: Check the deposit due date on the listing.
- Speaker 1: Add Priya and Tom to the 'Operation Heron' chat after the call.
- Cabin deposit due [inferred]
- Second half of payment charged automatically [inferred]
- Speaker 1: Add both others to the Operation Heron chat (deadline: after the call)
- Speaker 2: Book the Ridgeway SUV (deadline: by October 1st)
- Speaker 2: Pick up Maya on the way to Priya's
- Speaker 1: Buy the green Polaroid gift and order it by October 16th (deadline: by October 16th)
- all: Each person sends Priya $60 for the gift
- Me: Book the Birchwater Lake rental and pay the $570 deposit before Friday (deadline: before Friday)
- Speaker 1: Pay back the $190 owed to Me (deadline: tonight)
- Speaker 2 to book the Ridgeway SUV [inferred]
- Speaker 1 to order the Polaroid gift [inferred]
- Trip dates [inferred]
- Me to pay the $570 deposit [inferred]

#### Decisions (structured)
- Maya's birthday cabin weekend will be at Birchwater Lake, specifically Heron Point Cabin, over Hollins Ridge.
- Priya will book Heron Point Cabin since she has about $150 of Hearthstay credit.
- Maya does not pay for the trip since it is her birthday; the cost is split among the four paying attendees.
- The private chef idea for Saturday night was parked for now, not decided.
- Moved the cabin weekend to October 23rd to 26th because Priya is on nights the weekend of the 16th.
- Dropped the chef because $600 is basically half the cabin cost; the group will cook instead.
- No pets at Heron Point; Waffles will not come and Priya will ask her sister Anjali to take him.
- Dan will book the cabin on his card since Priya's credit expired September 1st and her card was flagged.
- Dan pays the full $570 deposit and Priya and Tom each send him $190 (Priya by tonight, Tom by Wednesday).
- Tom will rent a seven-seater car.
- Jonah's surprise visit must stay completely secret; no mention in the birthday group chat, only in the separate 'Operation Heron' chat Priya created.
- A separate chat named 'Operation Heron' was created, and no mention of Jonah is to appear in the birthday group chat. (owner: Speaker 1)
- Gift contribution is set at $60 each ($180 total) to cover the $179 green Polaroid. (owner: Speaker 2)
- Priya will buy and order the Polaroid gift by October 16th. (owner: Speaker 1)
- Trip length stays at three nights, not four. (owner: Me)
- Departure is set at 9:30 a.m. on Friday the 23rd, meeting at Priya's place on Calloway Street. (owner: Speaker 1)
- The group will travel together in one car rather than driving separately. (owner: Speaker 1)
- The weekend is confirmed as Birchwater Lake, Heron Point, Friday the 23rd to Monday the 26th. (owner: Speaker 2)
- No dogs will come on the trip. (owner: Speaker 1)
- Maya is gluten-free and Mia is vegetarian. (owner: Speaker 1)

#### Open questions (structured)
- Is the Heron Point Cabin listing actually pet-friendly so Waffles can come? [open]
- Should they hire a private chef (~$600, ~$150 each) for the Saturday birthday dinner? [open]
- Whether Priya's work rota allows the Oct 16–19 dates. [open]
- Is Mia definitely joining the trip (said 'probably in')? [open]
- Whether to order a gluten-free cake from Crumb and Kettle or bake one at the cabin. [open]
- Whether to do kayak rentals and who will fall in. [open]
- Whether Mia can join for part of the weekend, and whether she'll confirm a real answer. [open]
- What time the group is leaving on the Friday. [open]
- Whether to adopt a separate chat for the surprise vs. discuss in the existing birthday group. [open]
- How is Jonah getting from the airport to the cabin, given Birchwater is three hours from the airport? [open]
- Is Mia actually coming on the trip? [open]
- Are kayaks going to be part of the trip? [open]
- Has anyone checked whether there is a gluten-free store near Birchwater? [open]
- Who will make the drive playlist? [open]

#### Risks (structured)
- [high] Maya is celiac (strictly gluten-free, not a preference) and cross-contamination is a real concern, requiring a separate toaster and chopping board.
- [medium] Cabin cost was initially misstated at $1,040; the real total is $1,140 after a missed $325/night cleaning fee.
- [high] Heron Point house rules prohibit pets and impose a $250 fee for pet hair, invalidating the pet-friendly filter.
- [medium] Priya's credit expired September 1st and her card was flagged, blocking her from booking.
- [high] The $570 deposit is due by Friday September 25th, after which the hold on the dates drops.
- [medium] If Mia cannot join, the cost rises to $380 each from $285 each.
- [low] The new dates fall after Maya's actual birthday (October 16).
- [medium] Jonah getting from the airport to the cabin is unresolved, and the group only has one car, which will be sitting at the lake.
- [medium] Dan's car is making a noise again and he doesn't trust it for three hours each way.
- [medium] No one has confirmed a gluten-free store near Birchwater for Maya.
- [low] Late October weather at Birchwater is near freezing at night, requiring proper layers.
- [high] Maya notices everything, so any leaks about Jonah or likes on his posts risk ruining the surprise.

#### Follow-up draft
Subject: Follow-up: Maya's birthday cabin weekend at Heron Point

Hi all,

Thanks for a fun call catching up and getting the cabin weekend sorted. We landed on Birchwater Lake, specifically Heron Point Cabin, for Friday October 23rd to Monday the 26th, at $1,140 total; the chef is dropped and we'll cook ourselves, Tom's on gluten-free lasagna for Saturday, we're each putting in $60 for the green Polaroid, and we'll meet at Priya's place on Calloway Street at 9:30 on the Friday for one shared seven-seater.

The main thing still open is Mia — Priya, if you can get a real yes or no from her by Sunday, then we'll know whether we're at $285 or $380 each before the cabin gets booked. Everything else can wait for the Operation Heron chat.

Best,

---

# Summary F

_(run1)_

### Title: Maya’s Birthday Weekend at Heron Point

#### Overview
The group selected Heron Point Cabin at Birchwater Lake for Maya's October 16–19 birthday weekend, estimated the cost at $285 per paying person, and parked the private-chef idea while identifying pet and gluten-free logistics to verify. The group moved the cabin trip to October 23–26, assigned booking and transport tasks, set the deposit plan, and created a secret channel for Jonah’s surprise visit. The group finalized the three-night Birchwater trip schedule, shared costs, transportation, gift purchase, and secrecy plan while leaving Jonah’s airport transfer, kayaks, groceries, and Mia’s participation unresolved. Key decisions: The group chose Heron Point Cabin at Birchwater Lake rather than Hollins Ridge for the three-night birthday weekend.; Maya will not contribute to the cabin cost because the trip is her birthday celebration.; The corrected cabin total is $1,140, to be split among four paying people at $285 each..

#### Summary
- The group selected Heron Point Cabin at Birchwater Lake for Maya's October 16–19 birthday weekend, estimated the cost at $285 per paying person, and parked the private-chef idea while identifying pet and gluten-free logistics to verify.
- The group chose Heron Point Cabin at Birchwater Lake rather than Hollins Ridge for the three-night birthday weekend.
- Maya will not contribute to the cabin cost because the trip is her birthday celebration.
- Maya has celiac disease and requires strict gluten-free preparation with protection against cross-contamination.

#### What changed
- The destination shifted from two possible cabins to Heron Point Cabin at Birchwater Lake.
- The estimated total changed from $1,040 to $1,140 after the cleaning fee was noticed.
- The per-person contribution changed from the initially stated $260 to $285 for the four paying participants.
- Priya offered to handle the booking using her Hearthstay credit.
- The group clarified that Maya is strictly gluten-free due to celiac disease and Mia is the vegetarian.
- Tom reported leaving Pellmark on October 9th and starting as a senior financial analyst at Halvorsen Logistics on November 2nd.
- Priya said she will move to day shifts in November after working a twelve-and-a-half-hour shift while three nurses were short.
- The trip date changed from the weekend of October 16th to October 23rd–26th.
- The group dropped the proposed $600 chef service and chose to cook themselves.
- Waffles will not attend because Heron Point's house rules prohibit pets.
- The cabin remains available for October 23rd–26th at a total price of $1,140.
- Mia became uncertain as an attendee because she has a wedding in Portland on October 24th.
- Jonah's planned surprise visit was introduced, with arrival scheduled for the afternoon of Saturday the 24th.
- The booking responsibility shifted to Dan because Priya's credit expired and her card was flagged.
- The group established Operation Heron as the separate planning channel for the surprise.
- The trip dates and location were finalized as Birchwater Lake, Heron Point, from Friday the 23rd to Monday the 26th.
- The departure plan was set for 9:30 on Friday from Priya's place on Calloway Street.
- The group resolved to use one SUV rather than separate cars.
- The gift contribution increased from $50 each to $60 each to cover the $179 Polaroid.
- The trip length was reduced to three nights after the proposed Tuesday extension was rejected.

#### Decisions
- Birchwater Lake and Heron Point Cabin were selected for the trip.
- The group will plan around October 16–19, the weekend before Maya's October 21 birthday.
- The cabin cost will be divided among Dan, Priya, Tom, and Mia Chen, with Maya excluded.
- The private-chef proposal is deferred rather than included in the current plan.
- The group confirmed October 23rd–26th as the new cabin dates.
- The group confirmed that no chef will be hired.
- Dan will put the cabin deposit on his card, with Priya and Tom reimbursing him $190 each.
- The surprise planning will be conducted in the separate Operation Heron chat.
- All Jonah-related planning will stay in Operation Heron, with no references in the birthday group chat or elsewhere.
- The group will travel together in one vehicle and meet at Priya's at 9:30 on Friday the 23rd.
- The lodging plan remains three nights, Friday through Monday, rather than four nights through Tuesday.
- No dogs will be brought on the trip.

#### Action items
- Priya will verify her rota and confirm availability for the trip.
- Priya will book the selected cabin.
- Dan will check the cabin listing's pet policy.
- The group needs to identify a nearby source of safe gluten-free groceries.
- Dan will book the cabin before the deposit deadline.
- Priya will obtain Mia's final attendance answer by Sunday.
- Tom will rent a seven-seater SUV for the group.
- Priya will ask Anjali to take Waffles for the weekend.
- Priya will add the others to the Operation Heron chat.
- Add the other participants to Operation Heron after the call.
- Book the Ridgeway SUV by October 1st.
- Buy and order the green Polaroid by October 16th.
- Book the lodging and pay the $570 deposit before Friday.
- Send Priya $60 each toward the gift.
- Resolve the remaining trip logistics in Operation Heron.

#### Open questions
- Whether Priya's rota confirms her attendance remains unresolved.
- Whether Waffles can attend the cabin weekend remains unresolved.
- Whether to hire a private chef for the birthday dinner remains unresolved.
- Where to buy suitable gluten-free food near the cabin remains unresolved.
- Whether Mia can join on Sunday remains unresolved.
- The group has not decided whether to order or bake the birthday cake.
- The group has not decided whether to kayak during the trip.
- Friday departure time remains undecided despite an informal suggestion of 8 a.m.
- How Jonah will get from the airport to the cabin remains unresolved.
- Mia's participation remains unresolved.
- Whether to bring kayaks remains undecided.
- The group still needs to identify a gluten-free grocery option near Birchwater.
- A drive playlist still needs an owner.

#### Risks / blockers
- The initial budget was inaccurate because the cleaning fee had been omitted.
- Maya's celiac disease creates a significant food-safety constraint requiring separate equipment and avoidance of cross-contamination.
- Pet restrictions could prevent Waffles from joining the trip.
- The proposed private chef would materially increase the cost by about $600 overall, or $150 per paying person.
- The original weekend was blocked by Priya's night-shift rota and inability to swap again.
- The cabin booking could be lost if the $570 deposit is not paid by September 25th.
- Mia's attendance is uncertain, affecting both planning and the cost split.
- The pet restriction creates a potential $250 charge if pet hair is found at the property.
- Maya's gluten-free requirement has a cross-contamination risk requiring separate kitchen equipment.
- The surprise is vulnerable to accidental disclosure in the birthday chat or through social-media interactions.
- Jonah's transportation from the airport is a significant unresolved logistics risk.
- The group lacks a reliable backup vehicle because the existing car is making a noise.
- Food planning may be constrained because Maya is gluten-free and a nearby gluten-free store has not been identified.
- Late-October nighttime temperatures may approach freezing, so insufficient clothing could be a comfort risk.

#### Notes
- The selected cabin has three bedrooms, sleeps six, is on the water, and includes a hot tub.
- Maya's birthday is Wednesday, October 21st, making the planned trip the preceding weekend.
- Mia Chen from the book club is the fourth expected paying participant.
- Tom has approximately three weeks free in October between jobs.
- Priya's puppy Waffles is eleven weeks old and has already chewed two phone chargers and a work clog.
- Dan described an ongoing work reorganization process that already includes a 22-slide pre-meeting deck.
- Maya is gluten-free and Mia is vegetarian, so the group needs to account for both dietary requirements.
- Tom volunteered to make gluten-free lasagna for Saturday dinner.
- The cabin's second $570 installment will be charged automatically two weeks before check-in.
- The current three-person cabin split is $380 each, dropping to $285 each if Mia joins.
- The proposed group gift is a green Polaroid camera funded at $50 per person.
- Jonah plans to enter shortly before dinner after arriving from Denver on Saturday afternoon.
- Maya has not seen Jonah since he moved to Denver about fourteen months ago, which is part of why the surprise is considered meaningful.
- Maya is gluten-free and Mia is vegetarian.
- The planned departure time is 9:30 because Maya is not a morning person.
- Typical late-October conditions were described as about 50 degrees during the day and near freezing at night, although no forecast is available yet.
- The lodging deposit is $570, while a separate $190 payment was also reminded at the end of the call.

#### Action items (structured)
- Priya: Priya will check her work rota to confirm that October 16–19 works.
- Priya: Priya will book Heron Point Cabin on Hearthstay using approximately $150 of credit.
- Dan: Dan will verify whether the cabin permits Waffles.
- Someone needs to check whether a nearby grocery store stocks suitable gluten-free food. [inferred]
- Maya's birthday is Wednesday, October 21st. [inferred]
- The planned cabin stay is October 16th through October 19th. [inferred]
- Speaker 1: Ask Anjali whether she can look after Waffles during the trip.
- Me: Book the Heron Point cabin and pay the $570 deposit before the September 25th deadline. (deadline: before Friday, September 25th)
- Speaker 1: Send Dan $190 for the cabin deposit. (deadline: tonight)
- Speaker 2: Rent a seven-seater vehicle for the trip.
- Speaker 1: Ask Mia for a definite answer about whether she can attend and report back. (deadline: Sunday)
- Speaker 1: Add the group members to the separate Operation Heron chat.
- Check for a grocery store near the cabin that stocks gluten-free products. [inferred]
- Speaker 1: Look up the price of the green Polaroid camera as a possible group gift.
- Cabin deposit of $570 is due by Friday, September 25th. [inferred]
- Speaker 1 will get Mia's attendance confirmation by Sunday. [inferred]
- Speaker 2 will send Dan $190 by Wednesday, September 23rd. [inferred]
- Speaker 1: Speaker 1 will add the other participants to the Operation Heron chat after the call.
- Speaker 2: Speaker 2 will book the Ridgeway SUV by October 1st. (deadline: October 1st)
- Speaker 2: Speaker 2 will pick up Maya on the way to the meeting point.
- Speaker 1: Speaker 1 will purchase the $179 green Polaroid by October 16th. (deadline: October 16th)
- Each participant: Each participant will send Priya $60 toward the gift.
- Me: Me will book the Birchwater lodging and pay the $570 deposit before Friday. (deadline: Before Friday)
- Priya: Priya will send the $190 mentioned at the end of the call tonight. (deadline: Tonight)
- Book the Ridgeway SUV (deadline: October 1st) [inferred]
- Order the green Polaroid (deadline: October 16th) [inferred]
- Book lodging and pay the deposit (deadline: Before Friday) [inferred]
- Send the $190 (deadline: Tonight) [inferred]

#### Decisions (structured)
- The group chose Heron Point Cabin at Birchwater Lake rather than Hollins Ridge for the three-night birthday weekend.
- The planned trip dates are Friday, October 16th through Monday, October 19th, subject to Priya checking her rota.
- Maya will not contribute to the cabin cost because the trip is her birthday celebration.
- The corrected cabin total is $1,140, to be split among four paying people at $285 each.
- Priya will book the cabin using her Hearthstay credit, pending the remaining listing checks. (owner: Priya)
- The private-chef proposal for Saturday night was parked for now rather than approved.
- The cabin trip was moved to October 23rd through October 26th because Priya is working nights on the original weekend.
- The group decided not to hire a chef and will cook for themselves.
- The group will leave the kayak activity undecided until they are at the cabin.
- Dan will pay the full $570 deposit and Priya and Tom will each reimburse him $190.
- Jonah's visit will remain secret from Maya and all discussion about it will stay in the separate Operation Heron chat.
- The group will use the separate chat named Operation Heron for all Jonah-related planning and avoid mentioning him elsewhere.
- The trip will run from Friday the 23rd through Monday the 26th at Birchwater Lake, Heron Point.
- The group will keep the trip to three nights rather than extending it through Tuesday.
- The group will use one SUV rather than drive separately.
- Everyone will meet at Priya's place on Calloway Street at 9:30 on Friday the 23rd.
- The Polaroid gift budget is $60 per person, for $180 total.
- The group agreed that no dogs will come on the trip.

#### Open questions (structured)
- Will Priya's rota allow her to attend the October 16–19 trip? [open]
- Is Heron Point Cabin actually pet friendly, allowing Waffles to come? [open]
- Is there a nearby grocery store with food suitable for Maya's strict gluten-free requirements? [open]
- Will the group hire a private chef for Saturday's birthday dinner? [open]
- Will Mia attend the trip, either for the full weekend or on Sunday only? [open]
- Will the group order a gluten-free cake from Crumb and Kettle or bake one at the cabin? [open]
- Will the group go kayaking during the trip? [open]
- What time will the group actually leave on Friday? [open]
- What is the final price of the proposed Polaroid camera gift? [open]
- How will Jonah travel from the airport to the cabin, which is about three hours away? [open]
- Will Mia attend the trip? [open]
- Will the group bring kayaks? [open]
- Where is a gluten-free grocery store near Birchwater? [open]
- Who will create the playlist for the drive? [open]

#### Risks (structured)
- [medium] The cabin price was initially underestimated at $1,040 and then corrected to $1,140 after accounting for the cleaning fee.
- [high] Maya has celiac disease and requires strict gluten-free preparation with protection against cross-contamination.
- [medium] The group has not yet confirmed that the cabin allows Waffles, creating a potential accommodation issue.
- [medium] Priya's attendance is not fully confirmed until she checks her work rota.
- [medium] The private-chef idea could add about $150 per paying person on top of the cabin cost and was considered potentially excessive.
- [high] Heron Point prohibits pets and imposes a $250 fee if pet hair is found, so Waffles cannot stay at the cabin.
- [high] The cabin dates may be held only until the $570 deposit is paid by September 25th.
- [medium] Mia's uncertain attendance changes the per-person cost from $285 each with her to $380 each for the current three-person split.
- [medium] Cross-contamination is a dietary concern for Maya, requiring separate preparation equipment for gluten-free food.
- [high] Priya is unavailable for the original October 16th weekend because she is scheduled for night shifts Friday through Sunday and cannot swap again.
- [medium] Mia's cousin's wedding in Portland conflicts with the October 23rd weekend.
- [high] Jonah's airport-to-cabin transportation is unresolved despite the cabin being about three hours from the airport.
- [medium] The group has only one vehicle available at the lake, creating a transportation dependency.
- [high] The surprise could be spoiled if anyone mentions Jonah in the birthday group chat or interacts with his posts.
- [medium] The current car is making a noise and is not trusted for the three-hour drive each way.
- [medium] The group has not verified access to gluten-free groceries near Birchwater, despite Maya being gluten-free.
- [low] The late-October weather may be near freezing at night, requiring appropriate layers.

#### Follow-up draft
Subject: Follow-up: Heron Point birthday weekend

Hi team,

Thanks for the thoughtful discussion on Maya’s birthday weekend. We aligned on Heron Point Cabin at Birchwater Lake for October 23–26, with three nights, one SUV departing from Priya’s at 9:30 on Friday, no dogs or private chef, and the $1,140 cabin cost split at $285 among the four paying participants; Jonah’s surprise planning will remain in Operation Heron. The most important open question is how Jonah will get from the airport to the cabin, alongside confirming a safe gluten-free grocery option for Maya.

Best,
