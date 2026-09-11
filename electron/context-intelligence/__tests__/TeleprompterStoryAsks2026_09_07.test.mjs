// A teleprompter-style mode prompt, driven live (2026-09-07): three of eight
// turns went wrong, and two of the three were classifier misses.
//
//   "Okay, different example. Tell me about something you did with AI agents."
//   "Tell me about a real production failure you debugged."
//
// Both are the interviewer asking what the CANDIDATE did — with a résumé
// attached that names exactly those projects — and both went
// GENERAL_TECHNICAL → FAST → no retrieval, so the model said "I haven't worked
// with AI agents" and invented a failure story. "you did" was not a
// second-person verb, and the generic personal fallback vetoed any clause
// containing a tech word ("debug…"), including the verb that made it personal.
//
// The third turn was generation: asked for "the exact backoff base and
// multiplier", the model produced a plausible constant the résumé never states.
// The composer now adds an exact-value section on that question shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { classifyTurn } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { decide } = await load('orchestration/orchestrator.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { adaptLegacyChunks } = await load('retrieval/legacy-adapter.js');

const classify = (q) => classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES['technical-interview'], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: ['priya_resume.md'] });

describe('story asks about what the candidate did reach the résumé', () => {
  for (const q of [
    'Okay, different example. Tell me about something you did with AI agents.',
    'Tell me about something you did with AI agents.',
    'Tell me about a real production failure you debugged.',
    'Describe a bug you investigated in production.',
    'Tell me about an incident you dealt with.',
  ]) {
    test(q, () => {
      const r = classify(q);
      assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE') || r.questionTypes.includes('PERSONAL_PROJECT'), JSON.stringify(r.questionTypes));
      assert.ok(r.claimTypes.some((c) => c.startsWith('USER_')), JSON.stringify(r.claimTypes));
      assert.ok(r.requiredSourceTypes.includes('RESUME'), JSON.stringify(r.requiredSourceTypes));
      assert.equal(r.shouldRetrieve, true, r.reason);
    });
  }
  test('first-person self-talk about the user\'s own code is still not a résumé question', () => {
    for (const q of ['Why do I get a segfault when I debug this code?', 'How do I fix this exception in my function?']) {
      const r = classify(q);
      assert.ok(!r.claimTypes.some((c) => c.startsWith('USER_')), `${q}: ${JSON.stringify(r.claimTypes)}`);
    }
  });
});

describe('an exact-value ask gets the no-invented-constant section', () => {
  const ADAPT = {
    scope: { userId: 'u1' },
    sourceTypes: new Map([['resume-1', 'RESUME']]),
    activeVersions: new Map([['resume-1', 'v1']]),
    chunkVersions: new Map([['resume-1', 'v1']]),
    assumeInScopeWhenUnknown: true,
  };
  const evidence = adaptLegacyChunks([{ sourceId: 'resume-1', chunkIndex: 0, score: 0.9, text: 'Retries: exponential backoff with jitter, maximum 5 attempts, then a dead-letter queue.' }], ADAPT).evidence;
  const dec = (q) => decide({ requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId: 'technical-interview', scope: { userId: 'u1' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: ['priya_resume.md'] });
  test('"the exact backoff base and multiplier" → exact_value section', () => {
    const c = composePrompt({ decision: dec('What was the exact backoff base and multiplier you used for the retries?'), policy: MODE_POLICIES['technical-interview'], evidence });
    assert.ok(c.sections.includes('exact_value'), c.sections.join(','));
    assert.match(c.system, /Never supply a plausible-sounding constant/);
  });
  test('"which specific timeout" and "what exactly was the threshold" also qualify', () => {
    for (const q of ['Which specific timeout did you set on the carrier calls?', 'What exactly was the alert threshold?']) {
      const c = composePrompt({ decision: dec(q), policy: MODE_POLICIES['technical-interview'], evidence });
      assert.ok(c.sections.includes('exact_value'), `${q}: ${c.sections.join(',')}`);
    }
  });
  test('an ordinary story ask, or no evidence, has no such section', () => {
    const c1 = composePrompt({ decision: dec('How did you test it?'), policy: MODE_POLICIES['technical-interview'], evidence });
    assert.ok(!c1.sections.includes('exact_value'));
    const c2 = composePrompt({ decision: dec('What was the exact backoff base?'), policy: MODE_POLICIES['technical-interview'], evidence: [] });
    assert.ok(!c2.sections.includes('exact_value'));
  });
});
