// Read-only audit harness: executes the REAL policy functions to determine, per
// mode, whether an uploaded reference file can actually evidence a turn.
// No production code is modified; nothing here is imported by the app.
import { MODE_POLICIES, MODE_IDS, resolveModePolicy } from '../../electron/context-intelligence/policies/mode-policy-registry';
import { CLAIM_AUTHORITY, authorityOf } from '../../electron/context-intelligence/policies/source-authority-policy';
import { sourceTypeForFile, classifyDocShape, attachmentSourceTypeExtensions } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { defaultSourceContractForNewMode, documentGroundedFromContract, strictDocumentGroundedFromContract } from '../../electron/services/modeSourceContract';
import { decide } from '../../electron/context-intelligence/orchestration/orchestrator';

// A realistic project-history reference file of the kind the tester uploaded.
const REF_FILE_NAME = 'integration-projects.md';
const REF_FILE_CONTENT = `# Integration Project History

## Project: FieldServe-Orbit Bridge

### Architecture
The integration connects FieldServe with OrbitCRM, synchronizing work orders.

### Idempotency
The idempotency key format is IDK-FSC-{workOrderId}-{revision}.

### Retries and Exception Handling
The policy is 6 attempts with a backoff multiplier of 2.5, then a dead-letter queue named fsc-sync-dlq-workorders.

### Post-launch Monitoring
The primary health signal is the fsc_sync_lag_seconds metric.
`;

const QUESTIONS: Array<{ label: string; q: string }> = [
  { label: 'doc-fact (neutral name)', q: 'What is the idempotency key format on the FieldServe-Orbit Bridge project?' },
  { label: 'personal project', q: 'What did I build on the FieldServe-Orbit Bridge integration?' },
  { label: 'personal skill', q: 'What experience do I have with idempotency and retries?' },
  { label: 'walk me through', q: 'Can you walk me through the FieldServe-Orbit Bridge integration you worked on?' },
];

const scope = { userId: 'u1' };

function auditMode(modeId: string) {
  const policy = resolveModePolicy(modeId);
  const contract = defaultSourceContractForNewMode(modeId);
  const hasFiles = true;
  const docGrounded = documentGroundedFromContract(contract, hasFiles);
  const strict = strictDocumentGroundedFromContract(contract, hasFiles);
  // WTA gate (WhatToAnswerLLM.ts:445-446)
  const forceDocumentGrounding = strict || (docGrounded && hasFiles);

  const stamped = sourceTypeForFile(REF_FILE_NAME, REF_FILE_CONTENT, policy.allowedSourceTypes);
  const shape = classifyDocShape(REF_FILE_NAME, REF_FILE_CONTENT);
  const extras = attachmentSourceTypeExtensions(modeId, [{ fileName: REF_FILE_NAME, content: REF_FILE_CONTENT }]);
  const acceptedFor = authorityOf(stamped);

  const rows: any[] = [];
  for (const { label, q } of QUESTIONS) {
    const decision = decide({
      requestId: 'r1', requestSequence: 1, surface: 'manual_chat' as any,
      modeId, scope, sessionId: 's1',
      manualQuestion: q,
      hasAttachedDocuments: true,
      attachedFileNames: [REF_FILE_NAME],
      extraAllowedSourceTypes: extras,
    });
    const planned = new Set(decision.retrievalPlan.sourceTypes);
    // legacy-retrieval-port.ts:143-146
    const inScope = planned.has(stamped);
    const neededClaims = new Set(
      decision.claimRequirements.filter(c => c.authority === 'PRIVATE_SOURCE_REQUIRED').map(c => c.claimType),
    );
    const kept = neededClaims.size
      ? inScope && acceptedFor.some(c => neededClaims.has(c as any))
      : inScope;
    const reason = !decision.retrievalPlan.shouldRetrieve ? 'NO_RETRIEVAL'
      : !inScope ? 'PLANNED_TYPE_FILTER'
      : !kept ? 'CLAIM_AUTHORITY'
      : 'kept';
    rows.push({
      label,
      claims: [...neededClaims].join(',') || '(none)',
      planned: [...planned].join(',') || '(empty)',
      verdict: kept ? 'OK' : 'DROPPED',
      reason,
    });
  }
  return { modeId, authority: contract.sourceAuthority, forceDocumentGrounding, stamped, shape, extras, allowed: policy.allowedSourceTypes, rows };
}

const results = MODE_IDS.map(auditMode);

console.log('\n=== PER-MODE: does an uploaded project-history .md survive? ===\n');
for (const r of results) {
  console.log(`--- ${r.modeId} ---`);
  console.log(`  contract seed authority : ${r.authority}`);
  console.log(`  forceDocumentGrounding  : ${r.forceDocumentGrounding}${r.forceDocumentGrounding ? '' : '   <<< doc-grounded retrieval path OFF'}`);
  console.log(`  file stamped as         : ${r.stamped}  (shape=${r.shape}${r.extras.length ? `, extras=${r.extras.join(',')}` : ''})`);
  for (const row of r.rows) {
    const flag = row.verdict === 'OK' ? ' ' : '!';
    console.log(`  ${flag} ${row.label.padEnd(26)} claims=${row.claims.padEnd(30)} -> ${row.verdict} (${row.reason})`);
  }
  console.log('');
}

console.log('\n=== SUMMARY: modes where the reference file is unusable for some question shape ===\n');
for (const r of results) {
  const bad = r.rows.filter((x: any) => x.verdict !== 'OK');
  if (bad.length || !r.forceDocumentGrounding) {
    console.log(`${r.modeId}: docGrounding=${r.forceDocumentGrounding}, dropped=${bad.length}/${r.rows.length} [${bad.map((b: any) => b.label + ':' + b.reason).join('; ') || 'none'}]`);
  }
}

console.log('\n=== CLAIM_AUTHORITY: which source types can evidence each USER_*/DOCUMENT claim ===\n');
for (const [claim, a] of Object.entries(CLAIM_AUTHORITY)) {
  if (!a.authoritative.length) continue;
  console.log(`  ${claim.padEnd(20)} <- ${a.authoritative.join(', ')}`);
}
