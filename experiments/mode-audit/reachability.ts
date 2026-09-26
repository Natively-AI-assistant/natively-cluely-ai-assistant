import { decide } from '../../electron/context-intelligence/orchestration/orchestrator';
import { resolveModePolicy, MODE_IDS } from '../../electron/context-intelligence/policies/mode-policy-registry';
import { sourceTypeForFile } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { authorityOf } from '../../electron/context-intelligence/policies/source-authority-policy';

const NAME = 'projects.md';
const BODY = '# Integration Project History\n\n## Project: Orbit Bridge\n\n### Idempotency\nThe idempotency key format is IDK-OB-1.\n\n### Retries\nThe policy is 6 attempts, multiplier 2.5.\n';
const QS = [
  'What did you personally build on the Orbit Bridge integration?',
  'Tell me about your role in the Orbit Bridge project.',
  'What was your contribution to Orbit Bridge?',
  'Have you worked with idempotency before?',
  'What experience do you have with retry logic?',
  'How did you handle exception handling on Orbit Bridge?',
  'What is the retry backoff on the Orbit Bridge project?',
  'What did you monitor after launch?',
];
function reach(modeId: string, q: string) {
  const policy = resolveModePolicy(modeId);
  const stamped = sourceTypeForFile(NAME, BODY, policy.allowedSourceTypes);
  const acceptedFor = authorityOf(stamped);
  const d = decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat' as any, modeId,
    scope: { userId: 'u' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: [NAME] });
  if (!d.retrievalPlan.shouldRetrieve) return { ok: false, why: 'NO_RETRIEVAL', stamped };
  if (!new Set(d.retrievalPlan.sourceTypes).has(stamped)) return { ok: false, why: 'PLANNED_TYPE_FILTER', stamped };
  const needed = new Set(d.claimRequirements.filter(c => c.authority === 'PRIVATE_SOURCE_REQUIRED').map(c => c.claimType));
  if (needed.size && !acceptedFor.some(c => needed.has(c as any))) return { ok: false, why: 'CLAIM_AUTHORITY', stamped };
  return { ok: true, why: 'reaches the file', stamped };
}
const tally: Record<string, number> = {};
for (const m of MODE_IDS) {
  const rows = QS.map(q => ({ q, ...reach(m, q) }));
  const ok = rows.filter(r => r.ok).length;
  tally[m] = ok;
  console.log(`\n### ${m}  (file stamped ${rows[0].stamped}) — ${ok}/${QS.length} questions reach the reference file`);
  for (const r of rows) console.log(`   ${r.ok ? 'OK  ' : 'FAIL'} ${r.why.padEnd(20)} | ${r.q}`);
}
console.log('\n=== reference-file reachability, realistic interview questions ===');
for (const [m, n] of Object.entries(tally)) console.log(`  ${m.padEnd(20)} ${n}/${QS.length}`);
