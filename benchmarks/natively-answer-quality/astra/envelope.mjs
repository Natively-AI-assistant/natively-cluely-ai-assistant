// Evidence envelope + oracle for the external judge (spec §22-§23).
//
// Everything here is built from the FROZEN dataset (the scenario, its attached material, its authored
// fields) and the run row (the answer, the chain's earlier answers). Nothing identifies the run, the
// commit, the iteration, or which system produced the answer. The oracle is derived from the scenario
// only — never from the answer being judged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MODE_NAMES = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical Interview', seminar: 'Seminar', 'call-center': 'Call Center' };
export const ROLES = {
  general: { user: 'anyone (no specialised role)', other: 'whoever the user is talking to' },
  sales: { user: 'seller / sales representative', other: 'prospect / customer' },
  recruiting: { user: 'recruiter / interviewer', other: 'candidate' },
  'team-meet': { user: 'meeting participant / lead', other: 'colleague in the meeting' },
  'looking-for-work': { user: 'job candidate', other: 'interviewer / recruiter' },
  lecture: { user: 'learner / student', other: 'lecturer (lecture audio)' },
  'technical-interview': { user: 'candidate', other: 'technical interviewer' },
  seminar: { user: 'presenter / researcher', other: 'examiner / audience member' },
  'call-center': { user: 'support agent', other: 'customer' },
};
const OTHER_LABEL = { general: 'OTHER PERSON', sales: 'PROSPECT', recruiting: 'CANDIDATE', 'team-meet': 'COLLEAGUE', 'looking-for-work': 'INTERVIEWER', lecture: 'LECTURER', 'technical-interview': 'INTERVIEWER', seminar: 'EXAMINER', 'call-center': 'CUSTOMER' };

export const GIST_RE = /\[\[GIST\]\]([\s\S]*)$/;
export function splitGist(text) {
  const t = String(text ?? '');
  const m = t.match(GIST_RE);
  return { body: (m ? t.slice(0, m.index) : t).trim(), gist: m ? m[1].trim() : null };
}
export const answerOf = (row) => row?.rendered_answer ?? row?.raw_answer ?? '';

// ---- oracle (§23): mechanical, from authored scenario fields; objective sidecar where it exists ----
const TRAP_FORBIDDEN = {
  personal_history: 'Any personal history, employer, project, metric, incident or story about the user that the evidence does not state.',
  personal_preference: 'Any preference, willingness, reason or plan of the user (relocation, remote, salary, availability, why leaving) that the evidence does not state.',
  company_fact: 'Any company or product fact (price, capability, integration, SLA, policy, term, contact) that the evidence does not state.',
  support_policy: 'Any support policy, procedure, credit, refund authority, verification step or timeline that the evidence does not state.',
  meeting_history: 'Any prior meeting decision, owner, date, number or commitment that the conversation/notes do not state.',
  research_claim: 'Any result, number or method of the presented work that the material does not state (unless clearly marked as general knowledge).',
  role_confusion: 'Answering as the wrong party or misreading who spoke.',
  code_correctness: 'Code or complexity claims that are wrong for the stated problem.',
  none: null,
};
function responseShape(item) {
  const heard = item.speaker === 'other';
  if (item.mode === 'lecture') return heard ? 'private explanation for the student (not necessarily speakable)' : 'private explanation / study help';
  if (item.coding_intent) return `technical answer shaped to the ask (${item.coding_intent})`;
  if (item.mode === 'recruiting' && heard) return 'words the recruiter can say next (an answer to the candidate or the next probe), not commentary about the candidate';
  return heard ? 'spoken reply the user can say immediately' : 'private reply to the user (advice, explanation or exact words, as asked)';
}
const DEPTH = { very_short: 'one or two spoken sentences', short: 'a few sentences', normal: 'a short paragraph', long_multipart: 'covers every part asked, still realtime-sized', long: 'as deep as asked' };

let OBJECTIVE = null;
export function objectiveOracles() {
  if (OBJECTIVE) return OBJECTIVE;
  const f = path.join(HERE, '..', 'dataset', 'oracles-objective-v1.json');
  OBJECTIVE = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).oracles ?? {} : {};
  return OBJECTIVE;
}

const WHO = {
  general: ['the user', 'the person they are talking to'], sales: ['the seller', 'the prospect'], recruiting: ['the recruiter', 'the candidate'],
  'team-meet': ['the user (a meeting participant)', 'a colleague'], 'looking-for-work': ['the candidate', 'the interviewer'], lecture: ['the student', 'the lecturer'],
  'technical-interview': ['the candidate', 'the interviewer'], seminar: ['the presenter', 'the examiner or audience'], 'call-center': ['the support agent', 'the customer'],
};
export function buildOracle(item, ds) {
  const heard = item.speaker === 'other';
  const [u, o] = WHO[item.mode] ?? ['the user', 'the other party'];
  const expectedRole = item.mode === 'lecture'
    ? `Natively privately helps ${u} understand what ${o} said${heard ? '' : ' (typed request)'}.`
    : heard ? `Natively gives ${u} the words to say next to ${o}${item.mode === 'recruiting' ? ' (the recruiter\'s own words or next probe)' : ', in first person as ' + u}.`
      : `${u[0].toUpperCase() + u.slice(1)} typed privately to Natively; Natively answers ${u} directly.`;
  const acceptable = [];
  if (item.context_condition === 'none' || item.context_condition === 'irrelevant') acceptable.push('No relevant material was attached: anything that depends on the user\'s own facts, the company\'s facts or prior meetings is genuinely unknown to Natively.');
  const pi = item.pi_ref ? (ds.pi_profiles ?? []).find((p) => item.pi_ref === p.id || item.pi_ref.startsWith(p.id + '-')) : null;
  if (pi && item.pi_eligible) for (const a of pi.absent_facts ?? []) acceptable.push(`Not in the profile: ${a}`);
  if (!item.pi_ref && (item.mode === 'looking-for-work' || item.mode === 'technical-interview')) acceptable.push('No résumé or job description is loaded: every personal fact about the candidate is unknown to Natively.');
  const forbidden = [TRAP_FORBIDDEN[item.claim_trap ?? 'none']].filter(Boolean);
  const oracle = {
    expected_role: expectedRole,
    expected_action: item.expected_answer_type,
    required_facts: item.needles?.length ? item.needles.map((n) => `Uses "${n}" from the evidence where it answers the question`) : [],
    forbidden_claims: forbidden,
    acceptable_uncertainty: acceptable,
    response_shape: responseShape(item),
    max_useful_depth: DEPTH[item.length_class] ?? 'realtime-sized',
  };
  const obj = objectiveOracles()[item.id];
  if (obj) {
    if (obj.expected_action) oracle.expected_action = obj.expected_action;
    if (obj.required_facts) oracle.required_facts = [...obj.required_facts, ...oracle.required_facts];
    if (obj.forbidden_claims) oracle.forbidden_claims = [...obj.forbidden_claims, ...oracle.forbidden_claims];
  }
  return oracle;
}

// ---- conversation ----
function conversation(item, ds, rowsById) {
  const head = item.conversation_id ? ds.items.find((x) => x.conversation_id === item.conversation_id && x.turn_index === 1) : item;
  const other = OTHER_LABEL[item.mode];
  const lines = [];
  for (const l of head.prior_transcript ?? []) lines.push(`${l.speaker === 'other' ? other : 'USER (spoken)'}: ${l.text}`);
  if (item.conversation_id) {
    for (const p of ds.items.filter((x) => x.conversation_id === item.conversation_id && x.turn_index < item.turn_index).sort((a, b) => a.turn_index - b.turn_index)) {
      lines.push(`${p.speaker === 'other' ? other + ' (heard)' : 'USER (typed to Natively)'}: ${p.question}`);
      const prev = rowsById?.[p.id];
      lines.push(`NATIVELY (earlier answer): ${prev ? splitGist(answerOf(prev)).body || '(empty)' : '(not available)'}`);
    }
  }
  return { lines, head };
}

/**
 * Build the judge's user message for ONE answer. `validator` is the deterministic validator
 * result for this answer (or null). Returns { text, parts } — parts are hashed for the cache.
 */
/** A reply that places something on a day relative to now ("so that's tomorrow", "due today"). */
export const RELATIVE_DAY_RE = /\b(?:tomorrow|yesterday|(?:due|is|was|that'?s|until|by|as of|ends?|expires?|expired|signed) today|today is|earlier today|later today)\b/i;
export function buildEnvelope({ item, ds, answer, rowsById = null, validator = null, generatedAt = null }) {
  const { lines, head } = conversation(item, ds, rowsById);
  const heard = item.speaker === 'other';
  const r = ROLES[item.mode];
  const ctx = head.context_ref ? ds.contexts[head.context_ref] : null;
  const piRef = item.pi_ref ?? head.pi_ref ?? null;
  const pi = piRef ? (ds.pi_profiles ?? []).find((p) => piRef === p.id || piRef.startsWith(p.id + '-')) : null;
  const piDocs = pi ? (piRef.endsWith('-RESUME') ? ['RESUME'] : piRef.endsWith('-JD') ? ['JD'] : ['RESUME', 'JD']) : [];
  const piText = piDocs.map((d) => d === 'RESUME' ? `[The user's résumé: ${pi.candidate_name}]\n${pi.resume.text}` : `[The job description the user is targeting]\n${pi.jd.text}`).join('\n\n');
  const { body, gist } = splitGist(answer);
  const oracle = buildOracle(item, ds);
  const sec = [];
  sec.push(`MODE:\n${MODE_NAMES[item.mode]}`);
  sec.push(`SURFACE:\n${heard ? 'hotkey / other party spoke (the QUESTION was said aloud by the other party; the user pressed the hotkey)' : 'typed / private request (the USER typed the QUESTION privately to Natively)'}`);
  sec.push(`USER ROLE:\n${r.user}`);
  sec.push(`OTHER PARTY ROLE:\n${r.other}`);
  sec.push(`QUESTION:\n${item.question}`);
  sec.push(`CONVERSATION SO FAR:\n${lines.length ? lines.join('\n') : '(none)'}`);
  if (item.pi_eligible) sec.push(`PROFILE INTELLIGENCE:\n${pi ? piText : '(none loaded)'}`);
  else if (pi) sec.push(`MATERIAL LOADED BUT NOT PERMITTED IN THIS MODE (must not influence the answer):\n${piText}`);
  sec.push(`REFERENCE MATERIAL:\n${ctx ? `[Attached file: ${ctx.file_name} — ${ctx.title}]\n${ctx.text}` : '(none attached)'}`);
  sec.push('SCREEN CONTEXT:\n(none)');
  sec.push(`ORACLE (authored from the scenario; not a golden answer):\n${JSON.stringify(oracle, null, 1)}`);
  sec.push(`OBJECTIVE VALIDATOR RESULTS:\n${validator ? JSON.stringify(validator, null, 1) : '(no deterministic validator applies)'}`);
  sec.push(`ANSWER TO EVALUATE:\n${body || '(empty response)'}`);
  if (gist) sec.push(`GIST CHIP (separate UI summary chip shown with the answer; not spoken):\n${gist}`);
  // The judge reads "today" as the day it is judging on (2026-10-01: a reply generated on 30 September saying "1 October,
  // so that's tomorrow" was scored a factual error a day later). Stated only when the reply uses a relative day, so every
  // other item keeps its cached judgment.
  const when = generatedAt && !Number.isNaN(Date.parse(generatedAt)) && RELATIVE_DAY_RE.test(`${body}\n${gist ?? ''}`)
    ? new Date(generatedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  if (when) sec.push(`WHEN THE REPLY WAS GENERATED: ${when} (the user's local date). Read "today", "tomorrow" and "yesterday" in the reply against this date, not the date you are judging on.`);
  return { text: sec.join('\n\n'), oracle, body, gist };
}

/** A/B envelope: same scenario, two answers with random labels (mapping kept by the caller). */
export function buildPairEnvelope({ item, ds, answerA, answerB, rowsByIdA = null, validatorA = null, validatorB = null }) {
  const a = buildEnvelope({ item, ds, answer: answerA, rowsById: rowsByIdA, validator: validatorA });
  const b = splitGist(answerB);
  const head = a.text.split('\n\nOBJECTIVE VALIDATOR RESULTS:')[0];
  const parts = [head,
    `OBJECTIVE VALIDATOR RESULTS — ANSWER A:\n${validatorA ? JSON.stringify(validatorA, null, 1) : '(none)'}`,
    `OBJECTIVE VALIDATOR RESULTS — ANSWER B:\n${validatorB ? JSON.stringify(validatorB, null, 1) : '(none)'}`,
    `ANSWER A:\n${a.body || '(empty response)'}${a.gist ? `\n[GIST CHIP A: ${a.gist}]` : ''}`,
    `ANSWER B:\n${b.body || '(empty response)'}${b.gist ? `\n[GIST CHIP B: ${b.gist}]` : ''}`];
  return { text: parts.join('\n\n') };
}
