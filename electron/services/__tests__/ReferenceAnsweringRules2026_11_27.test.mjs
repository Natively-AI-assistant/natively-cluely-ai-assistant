// The user's own answering rules come out of a reference file by heading, and nothing else does (autopilot 2026-11-27).
//
// A prep-notes file with "Interview tips I wrote for myself" and "Phrases to avoid" sections: retrieval reached those
// only when a question matched them, so judged answers used a phrase the user listed to avoid. The rule sections now
// ride every turn of the mode (prompt-composer answeringRulesSection). Package docs' "Code style" / "Tips & Tricks"
// headings must not count. String work only: no platform branches, same on macOS and Windows.
//
// Run: npm run build:electron && node --test electron/services/__tests__/ReferenceAnsweringRules2026_11_27.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnsweringRules, isAnsweringRulesHeading, ANSWERING_RULES_MAX_CHARS } from '../../../dist-electron/electron/services/modes/referenceAnsweringRules.js';
import { answeringRulesSection } from '../../../dist-electron/electron/context-intelligence/generation/prompt-composer.js';

const FILE = [
  '# My prep notes', '', 'Intro line.', '',
  '# Part 1: Saved answers', '## Salary', 'My range is 150 to 160.', '',
  '# Part 3: Interview tips I wrote for myself', 'Rules for how I want to sound.', '',
  '## Length', '- Keep every answer under 40 seconds.', '',
  '## Phrases to avoid', '- "To be honest".', '- "Basically" at the start.', '', '---', '',
  '# Part 4: Answered questions', '## Kafka lag', 'I alert on time lag.', '',
  '### Code style', 'Use gofmt.', '',
  '## Tips & Tricks', 'Use the --watch flag.',
].join('\n');

test('rule-headed sections and their subsections are kept, in file order', () => {
  const r = extractAnsweringRules(FILE);
  assert.match(r, /Interview tips I wrote for myself:\nRules for how I want to sound\./);
  assert.match(r, /Length:\n- Keep every answer under 40 seconds\./);
  assert.match(r, /Phrases to avoid:\n- "To be honest"\./);
  assert.ok(r.indexOf('Length:') < r.indexOf('Phrases to avoid:'));
});
test('saved answers, answered questions and package-doc headings are not rules', () => {
  const r = extractAnsweringRules(FILE);
  for (const s of ['150 to 160', 'time lag', 'gofmt', '--watch']) assert.ok(!r.includes(s), s);
  for (const h of ['Code style', 'Tips & Tricks', 'Rules', 'Style guide', 'Contributing guidelines', 'API style']) assert.equal(isAnsweringRulesHeading(h), false, h);
  for (const h of ['Interview tips', 'Answer style', 'Phrases to avoid', 'How I answer', 'Tips for my recruiter calls', 'Pacing and delivery']) assert.equal(isAnsweringRulesHeading(h), true, h);
});
test('no rule headings, no rules; the cap cuts at whole lines', () => {
  assert.equal(extractAnsweringRules('# Notes\nJust facts.\n## Projects\nA thing.'), '');
  const long = '# Interview tips\n' + Array.from({ length: 400 }, (_, i) => `- rule number ${i} keeps answers short`).join('\n');
  const r = extractAnsweringRules(long);
  assert.ok(r.length <= ANSWERING_RULES_MAX_CHARS, String(r.length));
  assert.match(r.split('\n').at(-1), /^- rule number \d+ keeps answers short$/);
});
test('code inside a rules section is dropped; Windows line endings work', () => {
  const r = extractAnsweringRules('# Interview tips\r\n- Lead with the number.\r\n```go\r\nfunc x() {}\r\n```\r\n- Name the trade-off.\r\n');
  assert.equal(r, 'Interview tips:\n- Lead with the number.\n- Name the trade-off.');
});
test('the prompt section fences the rules as wording guidance from an uploaded file', () => {
  const s = answeringRulesSection('Length:\n- Under 40 seconds.');
  assert.match(s, /from a file they uploaded/);
  assert.match(s, /where they do not conflict with the rules above/);
  assert.match(s, /not evidence for any fact/);
  assert.match(s, /<answering_rules>\nLength:\n- Under 40 seconds\.\n<\/answering_rules>/);
});
test('team, delivery and title headings do not turn a whole file into rules', () => {
  for (const h of ['Rules for my team', 'Delivery guidelines', 'My style guide']) assert.equal(isAnsweringRulesHeading(h), false, h);
  const r = extractAnsweringRules('# My interview tips and notes\nKeep it short.\n## Salary\nMy range is 150 to 160.\n## Projects\nTurnstile.');
  assert.equal(r, 'My interview tips and notes:\nKeep it short.');
});
test('long pasted docs under a rules heading are not rules, and end the rules run', () => {
  const doc = Array.from({ length: 60 }, (_, i) => `The package option ${i} configures the parser.`).join('\n');
  const r = extractAnsweringRules(`# Interview tips\n- Lead with the number.\n## Saved docs: some-package\n${doc}\n## Length\n- Under 40 seconds.`);
  // Rules are written as one block: a sibling after the pasted README is not taken on the parent's word.
  assert.equal(r, 'Interview tips:\n- Lead with the number.');
});
test('a horizontal rule ends the rules block', () => {
  const r = extractAnsweringRules('# Interview tips\n## Length\n- Under 40 seconds.\n\n---\n\n## Saved docs: electron\nThe Electron framework.\n## Install\nnpm i electron');
  assert.equal(r, 'Length:\n- Under 40 seconds.');
});
