const { isCompleteShortAnswer } = require(''+require('path').resolve(__dirname,'../..')+'/dist-electron/electron/llm/index.js');
const CASES = [
  ['Yes — lead with the AWS migration.', true,  'complete short answer (the regression)'],
  ['We used PostgreSQL with Redis for caching.', true, 'complete short answer'],
  ['Sure,', false, 'the fragment the fallback must catch'],
  ['Sure.', false, 'terminal mark but too short'],
  ['', false, 'empty'],
  ['I think the answer is probably going to be', false, 'truncated mid-sentence'],
  ['It depends on the workload profile!', true, 'exclamation'],
  ['Did you mean the staging cluster?', true, 'question mark'],
  ['Yes, we migrated the entire stack to AWS."', true, 'trailing quote after terminal mark'],
];
let bad = 0;
for (const [t, want, why] of CASES) {
  const got = isCompleteShortAnswer(t);
  if (got !== want) bad++;
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'} ${String(got).padEnd(5)} (want ${String(want).padEnd(5)}) ${JSON.stringify(t).slice(0,44).padEnd(46)} ${why}`);
}
process.exit(bad ? 1 : 0);
