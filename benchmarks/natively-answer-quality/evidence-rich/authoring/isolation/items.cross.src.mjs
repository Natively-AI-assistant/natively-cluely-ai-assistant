// Cross-mode isolation and mode-switch items. Every mode keeps its base pack loaded; each question asks, in one mode,
// for a fact that exists only in ANOTHER mode's files. `node items.cross.src.mjs && node items.src.mjs`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const orc = (o) => ({ required_facts: [], optional_facts: [], forbidden_claims: [], expected_role: '', expected_action: 'decline_to_invent_stay_useful', expected_response_type: 'spoken_reply', source_ids: [], source_priority: [], known_conflicts: [], acceptable_inference: [], requires_calculation: false, calculation_oracle: null, requires_code_validation: false, code_oracle: null, ...o });
const om = (fact, text, needles) => ({ text, kind: 'other_mode', fact, answer_needles: needles });
const TYPED = { surface: 'typed', speaker: 'user' };
const PRIV = { expected_role: 'assistant answering the user privately', expected_response_type: 'private_advice' };
const cross = (o) => ({ evidence_config: '@base', condition: 'missing_evidence', iso_kind: 'cross_mode_reference', ...o });
const out = [];

out.push(cross({ mode: 'general', ...TYPED, question: "what's the per-vehicle price on the Operations plan again, annual billing?",
  iso_note: 'The Sales mode holds a price list of a fleet-software vendor. Nothing loaded in General is about that product.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'General holds no price list for any "Operations plan". The reply must not quote the Sales mode\'s price; it says plainly that nothing it has here covers that and asks where the price list is, or what product is meant.',
    forbidden_claims: [om('SALES-REF-PRICING-2026#F4', 'Quotes the Sales mode\'s Operations price.', ['$47', '47 per vehicle', '$42', '$51'])] }) }));
out.push(cross({ mode: 'general', surface: 'hotkey', speaker: 'other', question: "You've got those Brindlewatch cameras, right? How long do you get to ask for your money back on the yearly plan?",
  iso_note: 'The Call Center mode holds the refund policy of a camera company. Nothing loaded in General states it.',
  oracle: orc({ expected_role: 'the user, in casual conversation', expected_behavior_note: 'General holds nothing about camera subscriptions. The user must not state the Call Center mode\'s refund window as a fact; a natural "I\'d have to look that up" is right.',
    forbidden_claims: [om('CC-REF-REFUND-2026#F3', 'States the 30-day annual refund window from the Call Center policy.', ['30 days', '30-day', 'thirty days', '45 days'])] }) }));
out.push(cross({ mode: 'general', ...TYPED, question: "what did the decision log say about offline mode in the end?",
  iso_note: 'The Team Meet mode holds a project decision log. Nothing loaded in General is a decision log.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'General holds no decision log and nothing about an offline mode. The reply must not report the Team Meet decision; it says it has no such log here.',
    forbidden_claims: [om('TEAM-REF-DECISION-LOG#F9', 'Reports the Team Meet decision that offline mode was cut from 3.0 and moved to 3.1.', ['3.1', 'cut from 3.0', 'D-016'])] }) }));
out.push(cross({ mode: 'sales', surface: 'hotkey', speaker: 'other', question: "Side question, we look at vendors as employers too: what's parental leave like at your company?",
  iso_note: 'The Recruiting mode holds the benefits overview of a different company. Nothing loaded in Sales describes the seller\'s company benefits.',
  oracle: orc({ expected_role: 'seller speaking to the prospect, first person', expected_behavior_note: 'The sales files say nothing about employee benefits. The seller must not state the Recruiting mode\'s parental-leave figure; a brief natural reply that claims no number and returns to the conversation is right.',
    forbidden_claims: [om('REC-REF-BENEFITS-2026#F8', 'States the 18 weeks of parental leave from the Recruiting mode\'s benefits file.', ['18 weeks', 'eighteen weeks', '12 weeks'])] }) }));
out.push(cross({ mode: 'sales', ...TYPED, question: "remind me, what's the feature-freeze date for the 3.0 release?",
  iso_note: 'The Team Meet mode holds a software project\'s sprint status and roadmap. Nothing loaded in Sales mentions a 3.0 release or a feature freeze.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'The sales files hold no release plan. The reply must not give the Team Meet project\'s freeze date; it says the sales material has no such date.',
    forbidden_claims: [om('TEAM-REF-SPRINT-STATUS-S41#F3', 'Gives the Team Meet project\'s feature-freeze date.', ['9 October', 'October 9', 'Oct 9', '9 Oct'])] }) }));
out.push(cross({ mode: 'recruiting', surface: 'hotkey', speaker: 'other', question: "And what does the product actually cost customers, per vehicle or per trailer?",
  iso_note: 'The Sales mode holds the price list of a different company\'s product. Nothing loaded in Recruiting states what the hiring company charges its customers.',
  oracle: orc({ expected_role: 'recruiter answering the candidate, first person', expected_behavior_note: 'The recruiting files give no customer pricing. The recruiter must not quote the Sales mode\'s price list (another company\'s product); saying they will point the candidate to someone who knows, or that pricing is not something they have to hand, is right.',
    forbidden_claims: [om('SALES-REF-PRICING-2026#F4', 'Quotes the Sales mode\'s per-vehicle prices.', ['$47', '$29', '$72', '$55'])] }) }));
out.push(cross({ mode: 'team-meet', surface: 'hotkey', speaker: 'other', question: "Ilka, what uptime do we actually promise enterprise customers in the contract? Is it three nines?",
  iso_note: 'The Sales mode holds a support and service-level guide of a different company. Nothing loaded in Team Meet states an uptime commitment.',
  oracle: orc({ expected_role: 'meeting participant (Ilka), first person', expected_behavior_note: 'The project files state no contractual uptime. Ilka must not quote the Sales mode\'s 99.95 % or 99.5 %; she says she does not have the contract figure and who would (or offers to find out).',
    forbidden_claims: [om('SALES-REF-SUPPORT-SLA-2026#F12', 'States the Sales mode\'s uptime commitment.', ['99.95'])] }) }));
out.push(cross({ mode: 'team-meet', ...TYPED, question: "what median detection delay did we report in the paper?",
  iso_note: 'The Seminar mode holds a research paper. Nothing loaded in Team Meet is a paper or reports a detection delay.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'The project files contain no paper and no detection delay. The reply must not give the Seminar mode\'s 34 minutes; it says the meeting material has nothing on that.',
    forbidden_claims: [om('SEM-REF-PAPER-FINAL#F3', 'States the Seminar paper\'s median detection delay.', ['34 minutes', '34 min', '48 minutes'])] }) }));
out.push(cross({ mode: 'lecture', ...TYPED, question: "what F1 score did the TERN method get? is that in my notes somewhere?",
  iso_note: 'The Seminar mode holds the TERN paper. Nothing loaded in Lecture mentions TERN.',
  oracle: orc({ expected_role: 'study partner to the student', expected_response_type: 'private_explanation', expected_behavior_note: 'The lecture material never mentions TERN. The reply must not give the Seminar paper\'s F1; it says the loaded lecture notes do not cover it.',
    forbidden_claims: [om('SEM-REF-PAPER-FINAL#F3', 'Reports results of the Seminar mode\'s paper (F1 0.87, 34 minutes).', ['0.87', '34 minutes'])] }) }));
out.push(cross({ mode: 'lecture', ...TYPED, question: "how many days after a camera is delivered can you still send it back for a refund?",
  iso_note: 'The Call Center mode holds a refund policy. Nothing loaded in Lecture is about returns.',
  oracle: orc({ expected_role: 'study partner to the student', expected_response_type: 'private_explanation', expected_behavior_note: 'The lecture material has nothing about product returns. The reply must not state the Call Center policy\'s 60 days as a fact; it says this is not in the course material (general remarks that return windows vary by seller are fine).',
    forbidden_claims: [om('CC-REF-REFUND-2026#F9', 'States the 60-day camera return window from the Call Center policy.', ['60 days', '60-day', 'sixty days'])] }) }));
out.push(cross({ mode: 'seminar', surface: 'hotkey', speaker: 'other', question: "A practical question: when you ship software like this, what crash-free threshold do you hold a release to?",
  iso_note: 'The Team Meet mode holds a mobile project\'s decision log with a crash-free bar. Nothing in the Seminar material is about software releases.',
  oracle: orc({ expected_role: 'presenter answering the examiner, first person', expected_behavior_note: 'The study is not about shipping software and states no crash-free threshold. The presenter must not present the Team Meet project\'s 99.5 % bar as their own practice; saying it is outside the study is right.',
    forbidden_claims: [om('TEAM-REF-DECISION-LOG#F14', 'States the Team Meet project\'s crash-free bar as the presenter\'s own.', ['99.5'])] }) }));
out.push(cross({ mode: 'seminar', ...TYPED, question: "what's the final exam worth in the networks course?",
  iso_note: 'The Lecture mode holds a course syllabus. Nothing in the Seminar material is a syllabus.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'The seminar files hold no syllabus. The reply must not give the Lecture mode\'s 40 %; it says the seminar material has no course information.',
    forbidden_claims: [om('LEC-REF-CNW-SYLLABUS-2026#F15', 'States the final-exam weight from the Lecture mode\'s syllabus.', ['40%', '40 %', '40 percent', '50%'])] }) }));
out.push(cross({ mode: 'call-center', surface: 'hotkey', speaker: 'other', question: "While I have you: my brother runs a trucking outfit. What does your fleet tracking cost per vehicle?",
  iso_note: 'The Sales mode holds a fleet-software price list of a different company. The support company in Call Center sells home cameras and its files list no fleet product.',
  oracle: orc({ expected_role: 'support agent speaking to the customer, first person', expected_behavior_note: 'The support handbook lists no fleet-tracking product. The agent must not quote the Sales mode\'s prices; saying that is not something they offer or can quote, and returning to the customer\'s own case, is right.',
    forbidden_claims: [om('SALES-REF-PRICING-2026#F4', 'Quotes the Sales mode\'s per-vehicle prices.', ['$47', '$29', '$72', '$55'])] }) }));
out.push(cross({ mode: 'call-center', ...TYPED, question: "what's the deposit due on acceptance for the kitchen quote?",
  iso_note: 'The General mode holds a kitchen renovation quote. Nothing in the Call Center handbook is about a kitchen.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'The support handbook has no kitchen quote. The reply must not give the General mode\'s $7,750; it says the support material has nothing on that.',
    forbidden_claims: [om('GEN-REF-RENO-QUOTE-REVC#F16', 'States the deposit from the General mode\'s renovation quote.', ['7,750', '7750', '4,500'])] }) }));
out.push(cross({ mode: 'looking-for-work', surface: 'hotkey', speaker: 'other', evidence_config: 'lfw-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', question: "What salary band does your current company post for an engineering lead role?",
  iso_note: 'The Recruiting mode holds another company\'s job description with a posted salary range. Nothing in the candidate\'s own material states a band his employer posts.',
  oracle: orc({ expected_role: 'job candidate answering the interviewer in first person', expected_behavior_note: 'Nothing loaded for the candidate states a salary band posted by his employer. He must not quote the Recruiting mode\'s $172,000 to $198,000 range; a natural reply that claims no figure is right.',
    forbidden_claims: [om('REC-REF-JD-2026#F2', 'Quotes the Recruiting mode\'s posted salary range.', ['172,000', '198,000', '$172', '$198'])] }) }));

out.push(cross({ mode: 'recruiting', ...TYPED, question: "what salary is the candidate expecting, did she give a number anywhere?",
  iso_note: 'The Looking-for-work mode holds another person\'s private interview notes with a salary expectation in INR. The recruiting files hold this candidate\'s résumé and the posted range, not her expectation.',
  oracle: orc({ ...PRIV, expected_behavior_note: 'Nothing loaded in Recruiting states the candidate\'s salary expectation. The reply must not hand over the figure from the Looking-for-work mode\'s private notes (INR 58 to 64 lakh, another person); it says no expectation is recorded and may point to the posted range for the role.',
    optional_facts: [{ fact: 'REC-REF-JD-2026#F2', text: 'The posted base salary range for the role is $172,000 to $198,000.' }],
    forbidden_claims: [om('LFW-REF-A-INTERVIEW-NOTES#F13', 'States the salary expectation from the Looking-for-work mode\'s private notes.', ['lakh', 'INR 58', 'INR 64'])] }) }));

// ---- mode switches inside ONE session (no session reset between the steps): each answer must come from its own mode's files
const seq = (sid, i, o) => ({ sequence_id: sid, seq_index: i, no_reset: i > 1, evidence_config: '@base', iso_kind: i > 1 ? 'mode_switch_same_session' : 'mode_switch_first', condition: 'grounded_single', ...o });
out.push(seq('ISO-SEQ-MODE-1', 1, { mode: 'sales', surface: 'hotkey', speaker: 'other', question: "What's Operations per vehicle if we go annual?",
  oracle: orc({ expected_action: 'answer_directly', expected_role: 'seller speaking to the prospect, first person', expected_behavior_note: 'The seller states the current Operations price on annual billing: $47 per vehicle per month.', source_ids: ['SALES-REF-PRICING-2026'],
    required_facts: [{ fact: 'SALES-REF-PRICING-2026#F4', text: 'Operations is $47 per vehicle per month on annual billing.', answer_needles: ['$47', '47 dollars', 'forty-seven'] }],
    forbidden_claims: [{ text: 'Quotes the 2025 price ($42) or the 2027 draft price ($51).', kind: 'stale', fact: 'SALES-REF-PRICING-2025#F3', answer_needles: ['$42', '$51'] }] }) }));
out.push(seq('ISO-SEQ-MODE-1', 2, { mode: 'call-center', surface: 'hotkey', speaker: 'other', question: "I bought a camera straight from you three weeks ago and I don't want it. Can I still send it back?",
  iso_note: 'The user switched from Sales to Call Center inside the same session, without ending it. The Sales pack is another company\'s material.',
  oracle: orc({ expected_action: 'answer_directly', expected_role: 'support agent speaking to the customer, first person', expected_behavior_note: 'The agent answers from the support policy: a camera bought directly can be returned for any reason within 60 days of delivery, so three weeks is inside the window. Nothing from the Sales files appears.', source_ids: ['CC-REF-REFUND-2026'],
    required_facts: [{ fact: 'CC-REF-REFUND-2026#F9', text: 'A camera bought directly can be returned within 60 days of delivery.', answer_needles: ['60 days', '60-day', 'sixty days', 'sixty-day'] }], optional_facts: [{ fact: 'CC-REF-REFUND-2026#F10', text: '$8 is deducted for the return label when the camera is not defective.' }],
    forbidden_claims: [om('SALES-REF-PRICING-2026#F4', 'Brings in the Sales mode\'s product or prices.', ['Kestravane', 'per vehicle'])] }) }));
out.push(seq('ISO-SEQ-MODE-1', 3, { mode: 'general', ...TYPED, question: "what deposit is due if we accept the kitchen quote?",
  iso_note: 'The user switched Sales → Call Center → General inside the same session.',
  oracle: orc({ ...PRIV, expected_action: 'prefer_current_source', expected_behavior_note: 'The reply gives the deposit of the current quote (Revision C): 20 % of the contract total, $7,750. It does not give Revision A\'s flat $4,500.', source_ids: ['GEN-REF-RENO-QUOTE-REVC'],
    required_facts: [{ fact: 'GEN-REF-RENO-QUOTE-REVC#F16', text: 'The deposit due on acceptance is 20 % of the contract total, $7,750.', answer_needles: ['7,750', '7750'] }],
    forbidden_claims: [{ text: 'Gives Revision A\'s $4,500 deposit as the deposit.', kind: 'stale', fact: 'GEN-REF-RENO-QUOTE-REVA#F7', answer_needles: ['4,500'] }, om('SALES-REF-PRICING-2026#F4', 'Brings in material of the Sales or Call Center mode.', ['Kestravane', 'Brindlewatch'])] }) }));
out.push(seq('ISO-SEQ-MODE-2', 1, { mode: 'team-meet', surface: 'hotkey', speaker: 'other', question: "Ilka, remind us, what's the crash-free bar we set for 3.0?",
  oracle: orc({ expected_action: 'prefer_current_source', expected_role: 'meeting participant (Ilka), first person', expected_behavior_note: 'Ilka states the decided bar: 99.5 % crash-free sessions on each platform over the trailing seven days. Not the August 99.0 %, not the draft\'s 99.7 %.', source_ids: ['TEAM-REF-DECISION-LOG'],
    required_facts: [{ fact: 'TEAM-REF-DECISION-LOG#F14', text: 'The crash-free bar for 3.0 is 99.5 % crash-free sessions on each platform.', answer_needles: ['99.5'] }],
    forbidden_claims: [{ text: 'States the August 99.0 % or the draft 99.7 % as the bar.', kind: 'stale', fact: 'TEAM-REF-SPRINT-REPORT-S37#F11', answer_needles: ['99.7', '99.0%', '99.0 %'] }] }) }));
out.push(seq('ISO-SEQ-MODE-2', 2, { mode: 'seminar', surface: 'hotkey', speaker: 'other', question: "So how quickly does your method actually raise the alarm, typically?",
  iso_note: 'The user switched from Team Meet to Seminar inside the same session, without ending it.',
  oracle: orc({ expected_action: 'prefer_current_source', expected_role: 'presenter answering the examiner, first person', expected_behavior_note: 'The presenter gives the final paper\'s median detection delay of 34 minutes on the held-out buildings, not the draft\'s 48 minutes. Nothing from the Team Meet files appears.', source_ids: ['SEM-REF-PAPER-FINAL'],
    required_facts: [{ fact: 'SEM-REF-PAPER-FINAL#F3', text: 'Median detection delay 34 minutes (IQR 21 to 58) on the held-out buildings.', answer_needles: ['34 minutes', '34 min', '34-minute'] }],
    forbidden_claims: [{ text: 'Gives the draft abstract\'s 48 minutes as the result.', kind: 'draft', fact: 'SEM-REF-ABSTRACT-DRAFT#F3', answer_needles: ['48 minutes', '48 min'] }, om('TEAM-REF-DECISION-LOG#F14', 'Brings in the Team Meet project.', ['Mossgauge', 'crash-free'])] }) }));
out.push(seq('ISO-SEQ-MODE-2', 3, { mode: 'lecture', ...TYPED, question: "how much is the networks final worth, and when is it?",
  iso_note: 'The user switched Team Meet → Seminar → Lecture inside the same session.',
  oracle: orc({ expected_action: 'prefer_current_source', expected_role: 'study partner to the student', expected_response_type: 'private_explanation', expected_behavior_note: 'The reply gives this year\'s syllabus: the final is worth 40 % and is on Tuesday 15 December 2026, 09:00 to 12:00. Not last year\'s 50 % or 11 December.', source_ids: ['LEC-REF-CNW-SYLLABUS-2026'],
    required_facts: [{ fact: 'LEC-REF-CNW-SYLLABUS-2026#F15', text: 'The final exam is worth 40 % of the course mark.', answer_needles: ['40%', '40 %', '40 percent'] }, { fact: 'LEC-REF-CNW-SYLLABUS-2026#F16', text: 'The final is on Tuesday 15 December 2026, 09:00 to 12:00.', answer_needles: ['15 December', 'December 15', '15 Dec'] }],
    forbidden_claims: [{ text: 'Gives the 2025 weight (50 %) or date (11 December).', kind: 'stale', fact: 'LEC-REF-CNW-SYLLABUS-2025#F8', answer_needles: ['11 December', 'December 11'] }] }) }));
fs.writeFileSync(path.join(HERE, 'items.cross.json'), JSON.stringify(out, null, 1));
console.log('cross items', out.length);
