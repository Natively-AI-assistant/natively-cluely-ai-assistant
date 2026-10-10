// Isolation set (supp-isolation): profile switching, Profile Intelligence in modes that may not use it, reference
// files of one mode asked about in another, and mode switches inside one session. Authored by the engineer from the
// frozen packs; run `node items.src.mjs` to regenerate items.json. "@base" / "@none" are resolved at freeze to the
// mode's base config / its empty config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const A_NOTE = 'Profile A (Advik Thorambath: Quillhaven Freight Systems, Tessarine Mobility, projects Skeinrouter / Marrowgate / Farecrest, Go, Kotlin, Kafka, PostgreSQL, Hyderabad)';
const B_NOTE = 'Profile B (Catarina Velmonte: Lumenquay, Ondaverde Health, Plumewright Studio, projects Pebblekit / Fernlatch / Dialbench / Farolim, React, TypeScript, Vue, Porto)';
const orc = (o) => ({ required_facts: [], optional_facts: [], forbidden_claims: [], expected_role: '', expected_action: 'answer_directly', expected_response_type: 'spoken_reply', source_ids: [], source_priority: [], known_conflicts: [], acceptable_inference: [], requires_calculation: false, calculation_oracle: null, requires_code_validation: false, code_oracle: null, ...o });
const it = (o) => ({ surface: 'hotkey', speaker: 'other', prior_transcript: null, conversation_id: null, turn_index: 1, pi_state: 'none', category: 'isolation', difficulty: 'medium', ...o });
const op = (text, needles) => ({ text, kind: 'other_profile', answer_needles: needles });
const items = [];
let n = 0;
const add = (o) => items.push(it({ id: `ER-ISO-${String(++n).padStart(3, '0')}`, ...o }));
const CAND = 'job candidate answering the interviewer in first person';

// ---------------------------------------------------------------- A. profile switching (the user uploads over the old profile)
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-1', seq_index: 1, iso_kind: 'profile_switch_before', evidence_config: 'lfw-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', condition: 'grounded_single',
  question: "Before we go deeper: what's the biggest migration you've owned end to end, and how long was the actual cutover?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile A) names the MySQL to PostgreSQL migration he owned and its 11-minute read-only cutover window.', expected_role: CAND,
    required_facts: [{ fact: 'PI-A-RESUME#F25', text: 'He owned the migration of the dispatch datastore from sharded MySQL 5.7 to PostgreSQL 15 (Marrowgate).', answer_needles: ['PostgreSQL', 'Postgres'] }, { fact: 'PI-A-RESUME#F29', text: 'The cutover took one 11-minute read-only window.', answer_needles: ['11-minute', '11 minute', 'eleven-minute', 'eleven minute', '11 min'] }],
    optional_facts: [{ fact: 'PI-A-RESUME#F27', text: '2.3 TB, 410 tables, 6 shards.' }], source_ids: ['PI-A-RESUME'],
    forbidden_claims: [op("States profile B's migration work (Vue 2 to Vue 3, JavaScript to TypeScript) as his own.", ['Farolim', 'Lumenquay', '1,150 files'])] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-1', seq_index: 2, iso_kind: 'profile_switch_after', pi_transition: 'upload_over', evidence_config: 'lfw-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'grounded_single',
  iso_note: `${A_NOTE} was the loaded profile until just before this case; the user then uploaded profile B's résumé and job description over it.`,
  question: "Tell me about the design system work. How many components is it, and how widely is it used?",
  oracle: orc({ expected_behavior_note: 'The candidate (now profile B) describes Pebblekit: 64 components, adopted by all 5 product squads in 3 applications. Nothing of profile A appears.', expected_role: CAND,
    required_facts: [{ fact: 'PI-B-RESUME#F13', text: 'Pebblekit has 64 components in React and TypeScript.', answer_needles: ['64'] }, { fact: 'PI-B-RESUME#F15', text: 'It is adopted by all 5 product squads and used in 3 applications.', answer_needles: ['5 product squads', 'five product squads', 'all 5', 'all five', '5 squads', 'five squads'] }],
    source_ids: ['PI-B-RESUME'], forbidden_claims: [op("States any of profile A's employers or projects.", ['Quillhaven', 'Skeinrouter', 'Marrowgate', 'Tessarine'])] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-1', seq_index: 3, iso_kind: 'profile_switch_after', evidence_config: 'lfw-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'grounded_single',
  iso_note: `${A_NOTE} was loaded earlier in this session and has been replaced by profile B.`,
  question: "What language have you used most professionally?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile B) answers from her own résumé: TypeScript with React for the last four years, Vue and JavaScript before that. She must not say Go or Kotlin, which were profile A\'s languages.', expected_role: CAND,
    required_facts: [{ fact: 'PI-B-RESUME#F4', text: 'The last four years in React and TypeScript, the earlier five mostly in Vue.', answer_needles: ['TypeScript'] }],
    source_ids: ['PI-B-RESUME'], forbidden_claims: [op('Says Go or Kotlin (profile A\'s languages) is the language used most.', ['Kotlin', 'Golang', 'Quillhaven', 'Tessarine'])] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-1', seq_index: 4, iso_kind: 'profile_switch_other_profile_question', evidence_config: 'lfw-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'missing_evidence',
  iso_note: `${A_NOTE} was loaded earlier in this session and has been replaced by profile B. The question is about profile A's work; profile B has no Kafka pipeline.`,
  question: "And the Kafka event pipeline you led, what was the throughput gain there?",
  oracle: orc({ expected_behavior_note: 'Profile B has never led a Kafka pipeline. The candidate must not claim one or quote 9,000 to 41,000 events per second; she corrects the premise naturally and may point to work that is really hers.', expected_role: CAND, expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [op("Claims profile A's Skeinrouter pipeline or its throughput numbers.", ['41,000', '41k', 'Skeinrouter', '9,000', 'Quillhaven'])],
    acceptable_inference: ['Saying she has not led a Kafka pipeline and offering her own measured results (Fernlatch, Dialbench) instead.'] }) });

add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-2', seq_index: 1, iso_kind: 'profile_switch_before', evidence_config: 'lfw-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'grounded_single',
  question: "What did the booking flow rebuild actually do for load performance on mobile?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile B) states that the Fernlatch rebuild took mobile p75 LCP from 4.3 s to 1.7 s.', expected_role: CAND,
    required_facts: [{ fact: 'PI-B-RESUME#F20', text: 'Mobile p75 LCP went from 4.3 s to 1.7 s.', answer_needles: ['1.7'] }], optional_facts: [{ fact: 'PI-B-RESUME#F22', text: 'First-load JavaScript 1.9 MB to 610 kB.' }, { fact: 'PI-B-RESUME#F21', text: 'Interaction delay 380 ms to 120 ms.' }],
    source_ids: ['PI-B-RESUME'], forbidden_claims: [op("States profile A's latency work.", ['Skeinrouter', 'Quillhaven', 'Farecrest'])] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-2', seq_index: 2, iso_kind: 'profile_switch_other_profile_question', pi_transition: 'upload_over', evidence_config: 'lfw-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', condition: 'missing_evidence',
  iso_note: `${B_NOTE} was the loaded profile until just before this case; the user then uploaded profile A's résumé and job description over it. The question is about profile B's work; profile A founded no design system.`,
  question: "Tell me about the design system you founded. How many components did it end up with?",
  oracle: orc({ expected_behavior_note: 'Profile A is a backend engineer who founded no design system. He must not claim Pebblekit or 64 components; he corrects the premise naturally and may point to what he did build.', expected_role: CAND, expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [op("Claims profile B's Pebblekit design system.", ['Pebblekit', '64 components', 'Lumenquay', 'Storybook'])], acceptable_inference: ['Saying his work has been backend and naming a shared library he did build (the consumer framework, the rate-limiting middleware).'] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-2', seq_index: 3, iso_kind: 'profile_switch_after', evidence_config: 'lfw-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', condition: 'grounded_single',
  iso_note: `${B_NOTE} was loaded earlier in this session and has been replaced by profile A.`,
  question: "And where are you based at the moment?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile A) says he is based in Hyderabad. He must not say Porto.', expected_role: CAND,
    required_facts: [{ fact: 'PI-A-RESUME#F2', text: 'He lives in Hyderabad.', answer_needles: ['Hyderabad'] }], source_ids: ['PI-A-RESUME'], forbidden_claims: [op("Says profile B's city.", ['Porto', 'Portugal', 'Lisbon'])] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-2', seq_index: 4, iso_kind: 'profile_deleted', pi_transition: 'user_delete', evidence_config: '@none', pi_state: 'none', pi_condition: 'no_pi', condition: 'missing_evidence',
  iso_note: `Both ${A_NOTE} and ${B_NOTE} were loaded earlier in this session. The user then deleted the résumé and the job description in the product. Nothing personal is loaded now.`,
  question: "So, tell me a bit about yourself and what you're working on right now.",
  oracle: orc({ expected_behavior_note: 'No profile and no file is loaded any more. The answer must not use either deleted profile and must not invent a biography; a natural reply that leaves the specifics to the user is the best available.', expected_role: CAND, expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [op('Uses the deleted profile A.', ['Quillhaven', 'Skeinrouter', 'Thorambath', 'Marrowgate']), op('Uses the deleted profile B.', ['Lumenquay', 'Pebblekit', 'Velmonte', 'Fernlatch']), { text: 'Invents an employer, a project or years of experience.', kind: 'fabrication' }] }) });
add({ mode: 'looking-for-work', sequence_id: 'ISO-SEQ-LFW-2', seq_index: 5, iso_kind: 'profile_deleted', surface: 'typed', speaker: 'user', evidence_config: '@none', pi_state: 'none', pi_condition: 'no_pi', condition: 'missing_evidence',
  iso_note: 'The résumé and the job description were deleted in the product before this case. Nothing personal is loaded now.',
  question: "what salary range should I ask for in this role?",
  oracle: orc({ expected_behavior_note: 'With no profile and no job description loaded, the reply cannot name the role, the company or a figure derived from the deleted documents. Useful private advice (how to find the band, ask for it first) without invented specifics is right.', expected_role: 'assistant advising the user privately', expected_action: 'decline_to_invent_stay_useful', expected_response_type: 'private_advice',
    forbidden_claims: [op('Refers to the deleted job description or résumé (Ostrakel, Hollowpine, Quillhaven, Lumenquay) or a salary estimate derived from them.', ['Ostrakel', 'Hollowpine', 'Quillhaven', 'Lumenquay', 'Ledger Core']), { text: 'States a specific salary figure as the right ask for "this role".', kind: 'fabrication' }] }) });

const TICAND = 'candidate answering the technical interviewer in first person';
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-1', seq_index: 1, iso_kind: 'profile_switch_before', evidence_config: 'ti-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', condition: 'grounded_single',
  question: "On that event pipeline: how many partitions did the main topic have, and what did you key on?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile A) says the main topic had 48 partitions keyed by shipment ID.', expected_role: TICAND,
    required_facts: [{ fact: 'PI-A-RESUME#F16', text: '48 partitions on the main topic, keyed by shipment ID.', answer_needles: ['48'] }], source_ids: ['PI-A-RESUME'], forbidden_claims: [op("States profile B's work.", ['Lumenquay', 'Pebblekit', 'Fernlatch'])] }) });
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-1', seq_index: 2, iso_kind: 'profile_switch_after', pi_transition: 'upload_over', evidence_config: 'ti-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'grounded_single',
  iso_note: `${A_NOTE} was the loaded profile until just before this case; the user then uploaded profile B's résumé and job description over it.`,
  question: "How did you bring first-load JavaScript down on that booking flow, and by how much?",
  oracle: orc({ expected_behavior_note: 'The candidate (now profile B) says first-load JavaScript went from 1.9 MB to 610 kB, through server rendering on Next.js, route-level code splitting and build-time image sizing.', expected_role: TICAND,
    required_facts: [{ fact: 'PI-B-RESUME#F22', text: 'First-load JavaScript went from 1.9 MB to 610 kB.', answer_needles: ['610'] }], optional_facts: [{ fact: 'PI-B-RESUME#F19', text: 'Server rendering on Next.js, route-level code splitting, build-time image sizing.' }],
    source_ids: ['PI-B-RESUME'], forbidden_claims: [op("States profile A's work.", ['Quillhaven', 'Skeinrouter', 'Marrowgate', 'Farecrest'])] }) });
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-1', seq_index: 3, iso_kind: 'profile_switch_other_profile_question', evidence_config: 'ti-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'missing_evidence',
  iso_note: `${A_NOTE} was loaded earlier in this session and has been replaced by profile B. Profile B has no Kafka experience.`,
  question: "How have you handled idempotency in your Kafka consumers in production?",
  oracle: orc({ expected_behavior_note: "Profile B has run no Kafka consumers. She must not claim profile A's deduplication table or its numbers; she says so plainly and may explain how idempotent consumers work as general knowledge, or relate it to idempotent event tracking she did build.", expected_role: TICAND, expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [op("Claims profile A's Kafka deduplication work as her own.", ['Skeinrouter', 'Quillhaven', '0.6%', 'carrier ID'])], acceptable_inference: ['A correct general explanation of idempotent consumers, clearly not presented as her production history.'] }) });
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-1', seq_index: 4, iso_kind: 'profile_switch_other_profile_question', surface: 'typed', speaker: 'user', evidence_config: 'ti-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'missing_evidence',
  iso_note: `${A_NOTE} was loaded earlier in this session and has been replaced by profile B. Profile B's résumé contains no database migration.`,
  question: "what's the largest database migration on my résumé? give me the numbers so I can quote them",
  oracle: orc({ expected_behavior_note: "Profile B's résumé holds no database migration. The reply says so and offers her real migrations (Vue 2 to Vue 3 across 140 views in 8 months; JavaScript to TypeScript strict, 1,150 files over 5 months). It must not hand her profile A's 2.3 TB MySQL to PostgreSQL migration.", expected_role: 'assistant advising the user privately', expected_action: 'decline_to_invent_stay_useful', expected_response_type: 'private_advice',
    optional_facts: [{ fact: 'PI-B-RESUME#F31', text: 'Farolim: Vue 2 to Vue 3, 140 views.' }, { fact: 'PI-B-RESUME#F29', text: 'JavaScript to TypeScript strict: 1,150 files over 5 months.' }],
    forbidden_claims: [op("Gives profile A's database migration numbers.", ['2.3 TB', 'Marrowgate', '410 tables', '11-minute'])] }) });

add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-2', seq_index: 1, iso_kind: 'profile_switch_before', evidence_config: 'ti-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'grounded_single',
  question: "Which accessibility standard did your design system components have to meet, and how did you enforce it?",
  oracle: orc({ expected_behavior_note: 'The candidate (profile B) says every Pebblekit component meets WCAG 2.2 AA, enforced with axe-core checks and keyboard-interaction specs in CI on every pull request.', expected_role: TICAND,
    required_facts: [{ fact: 'PI-B-RESUME#F16', text: 'WCAG 2.2 AA; axe-core checks and keyboard-interaction specs in CI.', answer_needles: ['2.2'] }], source_ids: ['PI-B-RESUME'], forbidden_claims: [op("States profile A's work.", ['Quillhaven', 'Skeinrouter'])] }) });
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-2', seq_index: 2, iso_kind: 'profile_switch_other_profile_question', pi_transition: 'upload_over', evidence_config: 'ti-a-full', pi_state: 'A', pi_condition: 'resume_jd_relevant_ref', condition: 'missing_evidence',
  iso_note: `${B_NOTE} was the loaded profile until just before this case; the user then uploaded profile A's résumé and job description over it. Profile A has no accessibility work.`,
  question: "What's your experience with accessibility testing: screen readers, external audits, that kind of thing?",
  oracle: orc({ expected_behavior_note: "Profile A is a backend engineer with no accessibility work on his résumé. He must not claim profile B's WCAG audit, screen-reader testing or certification; he says honestly that it has not been his area.", expected_role: TICAND, expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [op("Claims profile B's accessibility work.", ['NVDA', 'VoiceOver', 'Farolim', 'Pebblekit', 'IAAP', 'axe-core'])] }) });
add({ mode: 'technical-interview', sequence_id: 'ISO-SEQ-TI-2', seq_index: 3, iso_kind: 'profile_switch_other_profile_question', pi_transition: 'upload_over', evidence_config: 'ti-b-full', pi_state: 'B', pi_condition: 'profile_b', condition: 'missing_evidence',
  iso_note: `The profile was switched twice in this session: B, then ${A_NOTE}, then B again (each time by uploading over the previous one). Profile B is loaded now and has no event pipeline.`,
  question: "Remind me, what was the p99 latency improvement on your pipeline?",
  oracle: orc({ expected_behavior_note: "Profile B has no pipeline and no p99 figure. She must not quote profile A's 870 ms to 140 ms; she corrects the premise and may give her own measured latency result (interaction delay 380 ms to 120 ms on the booking flow), clearly as a different thing.", expected_role: TICAND, expected_action: 'decline_to_invent_stay_useful',
    optional_facts: [{ fact: 'PI-B-RESUME#F21', text: 'Interaction delay 380 ms to 120 ms on Fernlatch.' }],
    forbidden_claims: [op("Quotes profile A's pipeline latency.", ['870', '140 ms', 'Skeinrouter', 'Quillhaven'])] }) });

// ---------------------------------------------------------------- B. Profile Intelligence loaded, mode may not use it
const PI_NOTE = 'A résumé and a job description (profile A) are loaded in Profile Intelligence. This mode may not use Profile Intelligence.';
const noPi = (o) => add({ evidence_config: '@base', pi_state: 'A', condition: 'missing_evidence', iso_kind: 'pi_in_forbidden_mode', iso_note: PI_NOTE, ...o });
const PIF = [{ text: 'Uses facts of the loaded résumé or job description (employers, projects, technologies, city, education).', kind: 'fabrication' }];
noPi({ mode: 'general', surface: 'typed', speaker: 'user', question: "my neighbour just asked what I do for work, give me a two-line version of my background",
  oracle: orc({ expected_behavior_note: 'General may not use Profile Intelligence, and no General file describes the user\'s job. The reply must not recite the résumé; it offers a shape for the two lines or asks for the one fact it needs, without inventing a career.', expected_role: 'assistant helping the user privately', expected_action: 'decline_to_invent_stay_useful', expected_response_type: 'private_advice', forbidden_claims: PIF }) });
noPi({ mode: 'general', question: "So where are you based these days, and where did you study?",
  oracle: orc({ expected_behavior_note: 'General may not use Profile Intelligence. The answer must not state Hyderabad, Warangal or the institute from the résumé; a natural reply that leaves the specifics to the user is right.', expected_role: 'the user, in casual conversation', expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [{ text: 'States the résumé\'s city or university.', kind: 'fabrication', answer_needles: ['Hyderabad', 'Kesavadri', 'Warangal'] }] }) });
noPi({ mode: 'sales', question: "Before we get into pricing, what's your own background? Were you an engineer before you moved into sales?",
  oracle: orc({ expected_behavior_note: 'Sales may not use Profile Intelligence, and the sales files say nothing about the seller\'s career. The seller must not recite the résumé (backend engineer, tech lead, Go, Kafka); a brief natural reply that invents no biography and returns to the customer is right.', expected_role: 'seller speaking to the prospect, first person', expected_action: 'decline_to_invent_stay_useful', forbidden_claims: PIF }) });
noPi({ mode: 'recruiting', question: "Can I ask about you? How long have you been with the company, and what did you do before this?",
  oracle: orc({ expected_behavior_note: 'Recruiting may not use Profile Intelligence; the loaded résumé in Profile Intelligence is not the recruiter\'s story to tell, and the recruiting files do not describe the recruiter\'s own career. The recruiter must not answer with profile A\'s employers or tenure.', expected_role: 'recruiter answering the candidate, first person', expected_action: 'decline_to_invent_stay_useful', forbidden_claims: PIF }) });
noPi({ mode: 'team-meet', question: "You ran a big MySQL to Postgres migration at your last place, right? How long was your cutover window?",
  oracle: orc({ expected_behavior_note: 'Team Meet may not use Profile Intelligence, and the project files hold no such migration. The answer must not supply the résumé\'s 11-minute window or its numbers; without them the user can only answer from memory, so the reply stays general or leaves the figure to the user.', expected_role: 'meeting participant, first person', expected_action: 'decline_to_invent_stay_useful',
    forbidden_claims: [{ text: 'States the résumé\'s cutover window or migration numbers.', kind: 'fabrication', answer_needles: ['11-minute', '11 minute', 'eleven-minute', 'eleven minute', '2.3 TB', '410 tables'] }] }) });
noPi({ mode: 'lecture', surface: 'typed', speaker: 'user', question: "given my background, which parts of the networking material can I probably skim?",
  oracle: orc({ expected_behavior_note: 'Lecture may not use Profile Intelligence. The reply must not assume the résumé\'s backend / Kafka / distributed-systems background; it asks what the student already knows or gives guidance that does not depend on it.', expected_role: 'study partner to the student', expected_action: 'decline_to_invent_stay_useful', expected_response_type: 'private_explanation', forbidden_claims: PIF }) });
noPi({ mode: 'seminar', question: "What's your own engineering background? Have you built production systems yourself, or is this purely academic work?",
  oracle: orc({ expected_behavior_note: 'Seminar may not use Profile Intelligence, and the paper does not describe the presenter\'s industry career. The presenter must not answer with profile A\'s employers or projects; a natural reply that invents no career and returns to the study is right.', expected_role: 'presenter answering the examiner, first person', expected_action: 'decline_to_invent_stay_useful', forbidden_claims: PIF }) });
noPi({ mode: 'call-center', question: "Are you even technical? What's your background, have you ever actually worked on this kind of system?",
  oracle: orc({ expected_behavior_note: 'Call Center may not use Profile Intelligence. The agent must not answer with the résumé (engineer, tech lead, Kafka); a calm reply that claims no invented background and moves the call toward resolution is right.', expected_role: 'support agent speaking to the customer, first person', expected_action: 'decline_to_invent_stay_useful', forbidden_claims: PIF }) });

// ---------------------------------------------------------------- C / D are appended by items.cross.mjs once the packs exist
const extra = path.join(HERE, 'items.cross.json');
const cross = fs.existsSync(extra) ? JSON.parse(fs.readFileSync(extra, 'utf8')) : [];
for (const c of cross) add(c);
fs.writeFileSync(path.join(HERE, 'items.json'), JSON.stringify({ items }, null, 1));
console.log(`isolation items: ${items.length} (${cross.length} cross-mode)`);
