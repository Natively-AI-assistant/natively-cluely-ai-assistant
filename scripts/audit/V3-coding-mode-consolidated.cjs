/**
 * Does the app's MODE change the coding meta-reply picture? Deterministic.
 *
 * Two dimensions, both measured:
 *   A. Does mode change the CODING VERDICT (codingTask, ipcHandlers.ts:1251,
 *      computed via planAnswer({..., activeMode}))?
 *   B. Does mode change GROUNDING (could a coding question be refused rather
 *      than answered in some modes)?
 *
 * Then cross-references against the classification, because a coding-GATED
 * recovery can only ever fire on turns the router calls coding.
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { planAnswer, isCodingAnswerType } = require(path.join(REPO, 'dist-electron/electron/llm/index.js'));
const reg = require(path.join(REPO, 'dist-electron/electron/context-intelligence/policies/mode-policy-registry.js'));

const MODE_IDS = ['general','sales','recruiting','team-meet','looking-for-work','technical-interview','seminar','interview'];
const QUESTIONS = [
  ['truncated request',    'Implement the function described above for the case where n is'],
  ['code never pasted',    'Fix the bug in the code I pasted earlier.'],
  ['ambiguous referent',   'Write the function for the thing we discussed.'],
  ['missing spec',         'Optimise it.'],
  ['dangling constraint',  'Rewrite the sort so that it handles the case where'],
  ['LRU cache (control)',  'Implement an LRU cache with O(1) get and put.'],
];

console.log('A. CODING VERDICT vs MODE');
console.log('   (all 5 degenerate turns + 1 control, across every built-in mode)\n');
const rows = [];
for (const [name, q] of QUESTIONS) {
  const verdicts = MODE_IDS.map((id) => {
    try {
      const t = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user',
        activeMode: { id, name: id, templateType: id } }).answerType;
      return isCodingAnswerType(t);
    } catch { return null; }
  });
  const base = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' }).answerType;
  const invariant = new Set(verdicts.map(String)).size === 1;
  rows.push({ name, base, coding: isCodingAnswerType(base), invariant });
  console.log(`  ${name.padEnd(22)} answerType=${base.padEnd(28)} coding=${String(isCodingAnswerType(base)).padEnd(5)} mode-invariant=${invariant}`);
}
const allInvariant = rows.every((r) => r.invariant);
console.log(`\n  => mode changes the coding verdict for ANY of these: ${!allInvariant}`);

console.log('\nB. GROUNDING POLICY vs MODE');
let anyBlocks = false;
for (const id of MODE_IDS) {
  try {
    const p = reg.resolveModePolicy(id);
    const gk = reg.generalKnowledgeAllowed(p);
    if (!gk) anyBlocks = true;
    console.log(`  ${id.padEnd(20)} grounding=${String(p.groundingPolicy).padEnd(18)} generalKnowledgeAllowed=${gk}`);
  } catch (e) { console.log(`  ${id.padEnd(20)} (not a registry mode)`); }
}
console.log(`\n  => any mode blocks general knowledge (would refuse a coding answer): ${anyBlocks}`);

console.log('\nC. WHAT A CODING-GATED RECOVERY WOULD COVER');
const degenerate = rows.filter((r) => !r.name.includes('control'));
const covered = degenerate.filter((r) => r.coding);
const missed  = degenerate.filter((r) => !r.coding);
console.log(`  degenerate turns that produced a code-free reply on BOTH models : ${degenerate.length}`);
console.log(`  ...classified CODING, so a coding-gated guard fires             : ${covered.length}  (${covered.map(r=>r.name).join(', ')})`);
console.log(`  ...NOT coding, so a coding-gated guard NEVER fires              : ${missed.length}  (${missed.map(r=>`${r.name} [${r.base}]`).join(', ')})`);
