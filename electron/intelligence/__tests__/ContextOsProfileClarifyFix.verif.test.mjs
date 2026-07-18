// Final verification — explicit possessive profile asks must NOT false-clarify.
//
// Bug (found via real-app profile E2E 2026-07-11): a technical-interview mode
// with a résumé loaded produces sourceAuthority=general_mixed; "my best project"
// then hit the >=2-universe clarify branch and asked "do you mean profile or
// meeting?" instead of answering from the profile. The possessive "my"
// disambiguates → must resolve to profile.
//
// Run: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsProfileClarifyFix.verif.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
const kernel = new co.SourceAuthorityKernel();

// general_mixed authority + profile facts + live transcript (2 universes) —
// exactly the interview-mode-with-résumé situation that false-clarified.
function build(q) {
  return kernel.build({
    surface: 'what_to_answer', question: q, activeModeId: 'm1',
    sourceAuthority: 'general_mixed', answerShape: 'general',
    voicePerspective: 'first_person_candidate', enforcement: 'enforce',
    hasReferenceFiles: false, hasProfileFacts: true, hasLiveTranscript: true,
  });
}

test('explicit possessive profile asks resolve to profile, NOT clarify', () => {
  for (const q of [
    'What is my best project?',
    'What are my strongest skills?',
    'Do I have Kubernetes experience?',
    'Why am I a good fit for this role?',
    'Tell me about my experience.',
    'What is my background?',
  ]) {
    assert.equal(build(q).sourceOwner, 'profile', `"${q}" must route to profile, not ${build(q).sourceOwner}`);
  }
});

test('isExplicitSelfProfileAsk detects possessive/self shapes, not generic nouns', () => {
  assert.equal(co.isExplicitSelfProfileAsk('What is my best project?'), true);
  assert.equal(co.isExplicitSelfProfileAsk('Do I have Kubernetes experience?'), true);
  assert.equal(co.isExplicitSelfProfileAsk('What are the project phases?'), false);
  assert.equal(co.isExplicitSelfProfileAsk('What is the latest React version?'), false);
});

test('REGRESSION: genuinely ambiguous non-possessive question still clarifies (2 universes)', () => {
  // "What are the project phases?" — no possessive → still clarifies with 2 universes.
  assert.equal(build('What are the project phases?').sourceOwner, 'clarify');
});

test('REGRESSION: general-knowledge question still answers (not clarify)', () => {
  assert.equal(build('What is the latest React version?').sourceOwner, 'unknown');
});

test('possessive profile ask with NO profile facts → not forced to profile', () => {
  const c = kernel.build({
    surface: 'what_to_answer', question: 'What is my best project?', activeModeId: 'm1',
    sourceAuthority: 'general_mixed', answerShape: 'general', voicePerspective: 'first_person_candidate',
    enforcement: 'observe', hasReferenceFiles: false, hasProfileFacts: false, hasLiveTranscript: true,
  });
  // No profile facts → cannot resolve to profile; falls through (unknown, single universe).
  assert.notEqual(c.sourceOwner, 'profile');
});
