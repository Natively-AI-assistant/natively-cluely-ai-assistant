// Black-box sweep: does a DOCUMENT-shaped question about <term> still route to
// the reference file? Any term that flips the routing is a misrouting collision
// of the same class as the `sync` bug. Behavioural, so it does not depend on
// reading every regex in the classifier correctly.
import { decide } from '../../electron/context-intelligence/orchestration/orchestrator';
import { resolveModePolicy, MODE_IDS } from '../../electron/context-intelligence/policies/mode-policy-registry';
import { sourceTypeForFile } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { authorityOf } from '../../electron/context-intelligence/policies/source-authority-policy';

const NAME = 'projects.md';
const BODY = '# Projects\n\n## Project: Acme\n\n### Retries\nThe policy is 6 attempts.\n';

const TERMS = [
  // integration / platform vocabulary
  'Sync','Standup','Pipeline','Bridge','Gateway','Connect','Hub','Stream','Relay','Mesh','Ledger','Vault',
  'Queue','Router','Digest','Console','Portal','Notify','Dispatch','Scheduler','Session','Channel','Thread',
  'Room','Huddle','Brief','Agenda','Minutes','Notes','Recap','Summary','Action','Board','Call','Meeting',
  'Webhook','Cron','Batch','Worker','Broker','Cache','Index','Search','Auth','Billing','Invoice','Ledger',
  'Sandbox','Staging','Canary','Rollout','Migration','Backfill','Replay','Snapshot','Audit','Report',
  'Review','Retro','Onboarding','Alignment','Check-in','Sprint','Kanban','Backlog','Roadmap','Epic','Story',
  'Ticket','Incident','Postmortem','Runbook','Playbook','Handoff','Escalation','Rotation','Oncall','Alert',
  'Dashboard','Metric','Trace','Log','Telemetry','Feed','Sink','Source','Topic','Partition','Shard',
  'Contract','Policy','Profile','Resume','Candidate','Interview','Screening','Offer','Hiring','Reference',
  'Document','File','Transcript','Recording','Summary','Decision','Discussion','Agreement','Conclusion',
];

const TEMPLATES = [
  (x: string) => `What is the retry backoff on the ${x} project?`,
  (x: string) => `How does ${x} handle failures?`,
];

function reaches(modeId: string, q: string): boolean {
  const policy = resolveModePolicy(modeId);
  const stamped = sourceTypeForFile(NAME, BODY, policy.allowedSourceTypes);
  const acceptedFor = authorityOf(stamped);
  const d = decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat' as any, modeId,
    scope: { userId: 'u' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: [NAME] });
  if (!d.retrievalPlan.shouldRetrieve) return false;
  if (!new Set(d.retrievalPlan.sourceTypes).has(stamped)) return false;
  const needed = new Set(d.claimRequirements.filter(c => c.authority === 'PRIVATE_SOURCE_REQUIRED').map(c => c.claimType));
  return needed.size ? acceptedFor.some(c => needed.has(c as any)) : true;
}

const uniq = [...new Set(TERMS)];
console.log(`Sweeping ${uniq.length} terms x ${TEMPLATES.length} templates x ${MODE_IDS.length} modes\n`);
const collisions: Record<string, string[]> = {};
for (const modeId of MODE_IDS) {
  // Baseline: a term that is definitely inert.
  const base = TEMPLATES.map(t => reaches(modeId, t('Acme')));
  for (const term of uniq) {
    for (let i = 0; i < TEMPLATES.length; i++) {
      if (!base[i]) continue;                     // template itself fails here; not a term effect
      if (!reaches(modeId, TEMPLATES[i](term))) {
        (collisions[term] ??= []).push(`${modeId}[t${i}]`);
      }
    }
  }
}
const entries = Object.entries(collisions).sort((a, b) => b[1].length - a[1].length);
if (!entries.length) console.log('No collisions found.');
for (const [term, where] of entries) {
  console.log(`  ${term.padEnd(14)} misroutes in ${String(where.length).padStart(2)} (mode,template) combos: ${where.slice(0, 6).join(', ')}${where.length > 6 ? ' …' : ''}`);
}
console.log(`\n${entries.length} of ${uniq.length} terms cause a misroute in at least one mode.`);
