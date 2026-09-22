// How many REALISTIC technical-interview questions can reach an uploaded
// reference file, per mode? Uses the real decide() + admission filters.
import { decide } from '../../electron/context-intelligence/orchestration/orchestrator';
import { resolveModePolicy, MODE_IDS } from '../../electron/context-intelligence/policies/mode-policy-registry';
import { sourceTypeForFile } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { authorityOf } from '../../electron/context-intelligence/policies/source-authority-policy';

const NAME = 'projects.md';
const BODY = '# Projects\n\n## Project: Orbit Bridge\n\n### Retries\nThe policy is 6 attempts, multiplier 2.5.\n\n### Idempotency\nKey format IDK-OB-1.\n';

// Phrased the way an interviewer actually speaks (second person), plus neutral
// document-shaped controls.
const QS: Array<[string, string]> = [
  ['2nd-person', 'What is your retry policy on the ingest path?'],
  ['2nd-person', 'How did you handle idempotency on Orbit Bridge?'],
  ['2nd-person', 'Do you have a dead letter queue configured?'],
  ['2nd-person', 'Have you worked with exactly-once delivery?'],
  ['2nd-person', 'Tell me about your role on Orbit Bridge.'],
  ['2nd-person', 'What did you monitor after launch?'],
  ['1st-person', 'What does my service do when the queue fills up?'],
  ['jargon:candidate', 'How does candidate generation work in the recommender?'],
  ['jargon:sync', 'What happens during the nightly sync?'],
  ['neutral-doc', 'What is the retry backoff on the Orbit Bridge project?'],
  ['neutral-doc', 'What is the idempotency key format for Orbit Bridge?'],
  ['neutral-doc', 'How does Orbit Bridge handle failures?'],
];

function reaches(modeId: string, q: string) {
  const policy = resolveModePolicy(modeId);
  const stamped = sourceTypeForFile(NAME, BODY, policy.allowedSourceTypes);
  const acceptedFor = authorityOf(stamped);
  const d = decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat' as any, modeId,
    scope: { userId: 'u' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: [NAME] });
  if (!d.retrievalPlan.shouldRetrieve) return { ok: false, why: 'NO_RETRIEVAL' };
  if (!new Set(d.retrievalPlan.sourceTypes).has(stamped)) return { ok: false, why: 'PLANNED_TYPE_FILTER' };
  const needed = new Set(d.claimRequirements.filter(c => c.authority === 'PRIVATE_SOURCE_REQUIRED').map(c => c.claimType));
  if (needed.size && !acceptedFor.some(c => needed.has(c as any))) return { ok: false, why: 'CLAIM_AUTHORITY' };
  return { ok: true, why: 'ok' };
}

const hdr = ['question'.padEnd(58), ...MODE_IDS.map(m => m.slice(0, 6).padEnd(7))].join('');
console.log(hdr); console.log('-'.repeat(hdr.length));
const totals: Record<string, number> = Object.fromEntries(MODE_IDS.map(m => [m, 0]));
for (const [kind, q] of QS) {
  const cells = MODE_IDS.map(m => { const r = reaches(m, q); if (r.ok) totals[m]++; return (r.ok ? 'OK' : 'x').padEnd(7); });
  console.log(`${(kind + ': ' + q).slice(0, 57).padEnd(58)}${cells.join('')}`);
}
console.log('-'.repeat(hdr.length));
console.log(`${'REACHES REFERENCE FILE'.padEnd(58)}${MODE_IDS.map(m => `${totals[m]}/${QS.length}`.padEnd(7)).join('')}`);
const secondPerson = QS.filter(([k]) => k === '2nd-person');
console.log(`\nSecond-person (how an interviewer actually speaks): ${secondPerson.length} questions`);
for (const m of MODE_IDS) {
  const n = secondPerson.filter(([, q]) => reaches(m, q).ok).length;
  console.log(`  ${m.padEnd(20)} ${n}/${secondPerson.length}`);
}
