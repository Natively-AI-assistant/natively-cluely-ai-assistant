import { classifyTurn } from '../../electron/context-intelligence/question/turn-classifier';
import { resolveModePolicy } from '../../electron/context-intelligence/policies/mode-policy-registry';
const p = resolveModePolicy('general');
// Product/feature/service names an engineer might genuinely have in a reference file.
const names = ['Sync','Standup','Pipeline','Bridge','Gateway','Connect','Hub','Stream','Relay','Mesh','Ledger','Vault','Queue','Router','Digest','Insights','Console','Portal','Notify','Dispatch','Scheduler','Session','Meeting','Call','Board','Channel','Thread','Room','Huddle','Brief','Agenda','Minutes','Notes','Recap','Summary','Action'];
const bad: string[] = [];
for (const n of names) {
  const c = classifyTurn({ resolvedQuestion: `What is the retry backoff on the ${n} project?`, policy: p, isFollowUp: false, hasAttachedDocuments: true });
  const ok = c.requiredSourceTypes.includes('REFERENCE_FILE') || (c.shouldRetrieve && c.requiredSourceTypes.length === 0);
  if (!ok) { bad.push(n); console.log(`  COLLIDES: "${n}" -> claims=${c.claimTypes.join(',')} req=${c.requiredSourceTypes.join(',')||'none'} retrieve=${c.shouldRetrieve}`); }
}
console.log(`\n${bad.length} of ${names.length} candidate product names misroute away from reference files: ${bad.join(', ') || '(none)'}`);
