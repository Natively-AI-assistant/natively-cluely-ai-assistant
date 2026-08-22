/**
 * Does the app's MODE change the coding verdict? Deterministic, no LLM.
 *
 * The V3 block computes codingTask via planAnswer({..., activeMode}) at
 * ipcHandlers.ts:1251, so mode is an INPUT to the coding classification. If a
 * mode flips the verdict, it flips (a) whether the six-section coding contract
 * attaches at all, and (b) whether any coding-gated recovery could ever fire.
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { planAnswer, isCodingAnswerType } = require(path.join(REPO, 'dist-electron/electron/llm/index.js'));

const MODES = [
  ['(no mode)',            null],
  ['general',              { id: 'general', name: 'General', templateType: 'general' }],
  ['technical-interview',  { id: 'technical-interview', name: 'Technical Interview', templateType: 'technical-interview' }],
  ['sales',                { id: 'sales', name: 'Sales', templateType: 'sales' }],
  ['recruiting',           { id: 'recruiting', name: 'Recruiting', templateType: 'recruiting' }],
  ['team-meet',            { id: 'team-meet', name: 'Team Meeting', templateType: 'team-meet' }],
  ['looking-for-work',     { id: 'looking-for-work', name: 'Looking for Work', templateType: 'looking-for-work' }],
  ['seminar',              { id: 'seminar', name: 'Seminar', templateType: 'seminar' }],
];

const QUESTIONS = [
  ['LRU cache',            'Implement an LRU cache with O(1) get and put.'],
  ['BFS shortest path',    'Write a BFS shortest-path function for an unweighted graph.'],
  ['level order',          'Given a binary tree, return its level order traversal.'],
  ['debounce',             'Implement a debounce function in JavaScript.'],
  ['truncated request',    'Implement the function described above for the case where n is'],
  ['code never pasted',    'Fix the bug in the code I pasted earlier.'],
];

const verdict = (q, mode) => {
  try {
    const t = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user', activeMode: mode ?? undefined }).answerType;
    return { type: t, coding: isCodingAnswerType(t) };
  } catch (e) { return { type: 'ERROR:' + e.message.slice(0, 40), coding: false }; }
};

const head = 'question'.padEnd(20) + MODES.map(([m]) => m.slice(0, 11).padEnd(12)).join('');
console.log(head);
console.log('-'.repeat(head.length));
const flips = [];
for (const [qname, q] of QUESTIONS) {
  const row = MODES.map(([mname, m]) => {
    const v = verdict(q, m);
    return { mname, ...v };
  });
  console.log(qname.padEnd(20) + row.map((r) => (r.coding ? 'CODING' : r.type.slice(0, 11)).padEnd(12)).join(''));
  const codingSet = new Set(row.map((r) => r.coding));
  if (codingSet.size > 1) flips.push({ qname, row });
}

console.log('\n=== questions whose CODING verdict changes with mode ===');
if (!flips.length) console.log('none — the coding verdict is mode-invariant for these questions');
for (const f of flips) {
  const yes = f.row.filter((r) => r.coding).map((r) => r.mname);
  const no = f.row.filter((r) => !r.coding).map((r) => `${r.mname}(${r.type})`);
  console.log(`\n${f.qname}`);
  console.log(`  CODING in : ${yes.join(', ') || '(none)'}`);
  console.log(`  NOT in    : ${no.join(', ') || '(none)'}`);
}
