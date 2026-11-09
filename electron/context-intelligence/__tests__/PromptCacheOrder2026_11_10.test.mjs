// Prompt-cache order (2026-11-10).
//
// DeepSeek and Gemini bill the start of a prompt they saw on a recent call at a
// small fraction of the normal rate. With "# Question" at the top of the user
// message, every token of it changed on every turn and only the system prompt
// was ever reused (~33% of prompt tokens in production). Fixed material now
// comes first and the question near the end; the user's own instructions keep
// the last word.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { adaptLegacyChunks } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-adapter.js')).href);

const ADAPT = {
  scope: { userId: 'u1' },
  sourceTypes: new Map([['resume-1', 'RESUME']]),
  activeVersions: new Map([['resume-1', 'v2']]),
  chunkVersions: new Map([['resume-1', 'v2']]),
  assumeInScopeWhenUnknown: true,
};
const RESUME = 'Led the payments ledger migration at Fintrail; cut p99 latency from 820 ms to 490 ms. Mentored 6 engineers.';

function turn(q, transcript) {
  const d = decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'technical-interview', scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q });
  return composePrompt({
    decision: d,
    policy: MODE_POLICIES['technical-interview'],
    evidence: adaptLegacyChunks([{ sourceId: 'resume-1', text: RESUME, chunkIndex: 0, score: 0.9 }], ADAPT).evidence,
    heardQuestion: true,
    conversationSummary: transcript,
    conversationHasContent: true,
    userBio: 'I am Priya, a backend engineer.',
    realtimeInstruction: 'Keep answers under 60 words.',
    now: new Date('2026-11-10T10:00:00Z'),
    attachedSourceCount: 1,
    profileSourceCount: 1,
  });
}

test('user message: fixed material first, then the conversation, then the question; user instructions last', () => {
  const c = turn('Tell me about a time you improved latency.', '[INTERVIEWER]: Tell me about a time you improved latency.');
  const at = (h) => c.user.indexOf(h);
  for (const h of ['# Question', '# Conversation so far', '# Evidence']) assert.ok(at(h) >= 0, `${h} present`);
  assert.ok(at('# Evidence') < at('# Conversation so far'), 'evidence (fixed per meeting when read whole) before the conversation');
  assert.ok(at('# Conversation so far') < at('# Question'), 'the question after the conversation');
  assert.ok(!c.user.startsWith('# Question'), 'the question no longer opens the message');
  const order = c.sections.filter((s) => ['about_user', 'evidence', 'conversation', 'question', 'user_instructions'].includes(s));
  assert.deepEqual(order.slice(0, 4), ['about_user', 'evidence', 'conversation', 'question']);
  if (order.includes('user_instructions')) assert.equal(order.at(-1), 'user_instructions', 'the user keeps the last word');
});

test('two turns of one meeting share everything up to the new speech: system identical, user prefix identical', () => {
  const t1 = '[INTERVIEWER]: Walk me through your current role.\n[ME]: I lead the ledger team.';
  const a = turn('Walk me through your current role.', t1);
  const b = turn('How did you handle Kafka consumer lag?', `${t1}\n[INTERVIEWER]: How did you handle Kafka consumer lag?`);
  assert.equal(a.system, b.system, 'same system prompt for two ordinary questions');
  let i = 0;
  while (i < a.user.length && a.user[i] === b.user[i]) i++;
  const convAt = a.user.indexOf('# Conversation so far');
  assert.ok(i > convAt, `shared user prefix (${i} chars) reaches past the start of the conversation (${convAt})`);
});
