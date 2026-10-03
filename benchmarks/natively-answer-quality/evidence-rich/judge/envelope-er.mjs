// The judge's view of one evidence-rich case: the exact evidence state that was loaded, the benchmark's oracle
// and the answer. Built only from the frozen datasets, the frozen manifest and the run row. Nothing identifies the
// run, the commit or the system that produced the answer.
//
// `evidence: 'full'`    every file loaded in the case's mode, whole.
// `evidence: 'focused'` whole text of every file the oracle names (sources, conflicts, forbidden facts); for the other
//                       loaded files their fact sheet (the manifest's statements), so the judge can still tell a
//                       supported claim from an invented one at a fraction of the length.
import { bench, factOf, splitGist, answerOf, PI_MODES } from '../objective.mjs';
import { ROLES, MODE_NAMES, RELATIVE_DAY_RE } from '../../astra/envelope.mjs';

const OTHER_LABEL = { general: 'OTHER PERSON', sales: 'PROSPECT', recruiting: 'CANDIDATE', 'team-meet': 'COLLEAGUE', 'looking-for-work': 'INTERVIEWER', lecture: 'LECTURER', 'technical-interview': 'INTERVIEWER', seminar: 'EXAMINER', 'call-center': 'CUSTOMER' };

function conversation(item, ds, rowsById) {
  const other = OTHER_LABEL[item.mode];
  const group = item.conversation_id ? ds.items.filter((x) => x.conversation_id === item.conversation_id).sort((a, b) => a.turn_index - b.turn_index) : [item];
  const head = group[0];
  const lines = [];
  for (const l of head.prior_transcript ?? []) lines.push(`${l.speaker === 'other' ? other : 'USER (spoken)'}: ${l.text}`);
  for (const p of group.filter((x) => x.turn_index < item.turn_index)) {
    lines.push(`${p.speaker === 'other' ? other + ' (heard)' : 'USER (typed to Natively)'}: ${p.question}`);
    const prev = rowsById?.[p.id];
    lines.push(`NATIVELY (earlier answer): ${prev ? splitGist(answerOf(prev)).body || '(empty)' : '(not available)'}`);
  }
  return lines;
}
const fileHeader = (f) => `[FILE: ${f.filename}${f.title ? ' | ' + f.title : ''} | STATUS: ${f.status}${f.effective_date ? ' | dated ' + f.effective_date : ''} | AUTHORITY ${f.authority}${(f.supersedes ?? []).length ? ' | supersedes: ' + f.supersedes.map((s) => bench().files.get(s)?.filename ?? s).join(', ') : ''}]`;
const factSheet = (f) => (f.facts ?? []).map((x) => `- ${x.statement}`).join('\n') || '(no facts recorded)';
function oracleForJudge(o) {
  const st = (ref) => (ref && ref !== 'CONVERSATION' ? factOf(ref).fact?.statement ?? null : null);
  const name = (id) => bench().files.get(id)?.filename ?? id;
  return {
    expected_behavior_note: o.expected_behavior_note ?? null,
    required_facts: (o.required_facts ?? []).map((r) => ({ text: r.text, source: r.fact === 'CONVERSATION' ? 'the conversation' : name(String(r.fact).split('#')[0]), statement_in_source: st(r.fact) })),
    optional_facts: (o.optional_facts ?? []).map((r) => ({ text: r.text })),
    forbidden_claims: (o.forbidden_claims ?? []).map((c) => ({ text: c.text, kind: c.kind, ...(c.fact ? { the_fact_it_would_misuse: st(c.fact), from: name(String(c.fact).split('#')[0]) } : {}) })),
    expected_role: o.expected_role ?? null, expected_action: o.expected_action ?? null, expected_response_type: o.expected_response_type ?? null,
    sources_the_answer_rests_on: (o.source_ids ?? []).map(name), source_priority: (o.source_priority ?? []).map(name),
    known_conflicts: (o.known_conflicts ?? []).map((k) => ({ ...k, sources: (k.sources ?? []).map(name) })),
    acceptable_inference: o.acceptable_inference ?? [],
    ...(o.requires_calculation ? { calculation: { expression: o.calculation_oracle?.expression ?? null, result: o.calculation_oracle?.result ?? null, unit: o.calculation_oracle?.unit ?? null } } : {}),
    ...(o.requires_code_validation ? { code_tests: o.code_oracle?.tests ?? null } : {}),
  };
}

export function buildEnvelope({ item, ds, row, rowsById = null, objective = null, evidence = 'focused' }) {
  const B = bench();
  const o = item.oracle ?? {};
  const heard = item.speaker === 'other';
  const r = ROLES[item.mode];
  const cfg = (ds.configsById ?? new Map(ds.configs.map((c) => [c.id, c]))).get(row?.evidence_config ?? item.evidence_config);
  const files = (cfg?.files ?? []).map((id) => B.files.get(id)).filter(Boolean).sort((a, b) => b.authority - a.authority || a.id.localeCompare(b.id));
  const named = new Set([...(o.source_ids ?? []), ...(o.source_priority ?? []), ...(o.known_conflicts ?? []).flatMap((k) => k.sources ?? []),
    ...(o.required_facts ?? []).map((x) => String(x.fact).split('#')[0]), ...(o.forbidden_claims ?? []).map((x) => String(x.fact ?? '').split('#')[0]), ...(o.optional_facts ?? []).map((x) => String(x.fact ?? '').split('#')[0])]);
  const whole = (f) => evidence === 'full' || named.has(f.id) || files.length <= 2;
  const sec = [];
  sec.push(`MODE:\n${MODE_NAMES[item.mode]}`);
  sec.push(`SURFACE:\n${heard ? 'hotkey / other party spoke (the QUESTION was said aloud by the other party; the user pressed the hotkey)' : 'typed / private request (the USER typed the QUESTION privately to Natively)'}`);
  sec.push(`USER ROLE:\n${r.user}`);
  sec.push(`OTHER PARTY ROLE:\n${r.other}`);
  sec.push(`QUESTION:\n${item.question}`);
  const conv = conversation(item, ds, rowsById);
  sec.push(`CONVERSATION SO FAR:\n${conv.length ? conv.join('\n') : '(none)'}`);
  sec.push(`EVIDENCE LOADED IN THIS MODE (${files.length} file${files.length === 1 ? '' : 's'}):\n${files.length ? files.map((f) => `${fileHeader(f)}\n${whole(f) ? B.texts[f.id] : `(fact sheet of this file — its full text is not reproduced here because the case does not rest on it)\n${factSheet(f)}`}`).join('\n\n---\n\n') : '(no reference file is loaded in this mode)'}`);
  const piIds = B.manifest.pi_states[row?.pi_state ?? item.pi_state ?? 'none'] ?? [];
  const piText = piIds.map((id) => { const f = B.files.get(id); return `[${/-JD$/.test(id) ? 'The job description the user is targeting' : "The user's résumé"}: ${f.filename}]\n${B.texts[id]}`; }).join('\n\n');
  if (PI_MODES.has(item.mode)) sec.push(`PROFILE INTELLIGENCE (permitted in this mode):\n${piIds.length ? piText : '(none loaded)'}`);
  else if (piIds.length) sec.push(`PROFILE INTELLIGENCE — LOADED BUT NOT PERMITTED IN THIS MODE (must not influence the answer):\n${piText}`);
  else sec.push('PROFILE INTELLIGENCE:\n(not available in this mode; none loaded)');
  const foreign = (o.forbidden_claims ?? []).filter((c) => ['other_mode', 'other_profile'].includes(c.kind) && c.fact).map((c) => { const { file, fact } = factOf(c.fact); return file && fact ? `- ${fact.statement}  [${file.filename}, ${c.kind === 'other_mode' ? `a file of the ${MODE_NAMES[file.mode] ?? file.mode} mode` : 'another candidate profile'}]` : null; }).filter(Boolean);
  if (foreign.length || item.iso_note) sec.push(`MATERIAL OF OTHER MODES / OTHER PROFILE (exists in the product; must NOT influence this answer):\n${[item.iso_note, ...foreign].filter(Boolean).join('\n')}`);
  sec.push(`ORACLE (benchmark truth for this case, written before any answer existed; not a golden answer):\n${JSON.stringify(oracleForJudge(o), null, 1)}`);
  sec.push(`OBJECTIVE CHECKS (deterministic code):\n${objective && (objective.verdict !== 'n/a' || objective.notes?.length) ? JSON.stringify({ verdict: objective.verdict, checks: objective.checks, notes: objective.notes }, null, 1) : '(no deterministic check applies)'}`);
  const { body, gist } = splitGist(answerOf(row));
  sec.push(`ANSWER TO EVALUATE:\n${body || '(empty response)'}`);
  if (gist) sec.push(`GIST CHIP (separate UI summary chip shown with the answer; not spoken):\n${gist}`);
  const when = row?.started_at && !Number.isNaN(Date.parse(row.started_at)) && RELATIVE_DAY_RE.test(`${body}\n${gist ?? ''}`)
    ? new Date(row.started_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  if (when) sec.push(`WHEN THE REPLY WAS GENERATED: ${when} (the user's local date). Read "today", "tomorrow" and "yesterday" in the reply against this date.`);
  return { text: sec.join('\n\n'), body, gist };
}

/** A/B envelope for calibration: one scenario, two answers with neutral labels. */
export function buildPairEnvelope({ item, ds, answerA, answerB, evidence = 'focused' }) {
  const a = buildEnvelope({ item, ds, row: { raw_answer: answerA, evidence_config: item.evidence_config, pi_state: item.pi_state }, evidence });
  const head = a.text.split('\n\nOBJECTIVE CHECKS (deterministic code):')[0];
  const A = splitGist(answerA), Bz = splitGist(answerB);
  return { text: [head, `ANSWER A:\n${A.body || '(empty response)'}${A.gist ? `\n[GIST CHIP A: ${A.gist}]` : ''}`, `ANSWER B:\n${Bz.body || '(empty response)'}${Bz.gist ? `\n[GIST CHIP B: ${Bz.gist}]` : ''}`].join('\n\n') };
}
