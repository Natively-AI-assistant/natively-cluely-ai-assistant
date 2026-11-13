// F-ACC-14 (live-pipeline forensics, 2026-11-13): the source-available build
// (premium absent) has no Profile Intelligence, yet its no-evidence wording
// told the model to suggest "adding a résumé under Profile Intelligence in
// Settings" or "switching to a profile-enabled mode", features that build
// does not have. The pipeline now knows the build has no profile feature: the
// prompt drops that advice (the no-story guard stays) and the [V3] line logs
// profileFeature: 'not_in_build'.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-oss-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;
const require = createRequire(import.meta.url);
const dist = path.resolve(process.cwd(), 'dist-electron/electron');
// main.ts marks the source-available build on globalThis (see featureGate.ts).
const ABSENT = '__nativelyPremiumAbsentV1__';
const setPremium = (v) => { if (v) delete globalThis[ABSENT]; else globalThis[ABSENT] = true; };
const { buildV3Prompt } = require(path.join(dist, 'context-intelligence/orchestration/engine-bridge.js'));
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = require(path.join(dist, 'context-intelligence/contracts/flag.js'));
const { setStoredAnswerPolicy } = require(path.join(dist, 'context-intelligence/policies/answer-policy-store.js'));

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; delete globalThis[ABSENT]; });

async function compose(question, modeId, premium) {
  setPremium(premium);
  const r = await buildV3Prompt({
    surface: 'manual-chat', question, modeTemplateType: modeId, modeUniqueId: modeId,
    attachedSourceCount: 0, attachedFileNames: [], profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `oss-${modeId}-${premium}-${question.length}` },
  });
  assert.ok(r);
  return `${r.system}\n${r.user}`;
}

describe('no-profile wording follows the build (F-ACC-14)', () => {
  // "Only answer from references" with nothing loaded: the branch that names
  // the remedy (AnswerPolicyLiveDenials 'the exact strict wording').
  before(() => { setStoredAnswerPolicy('looking-for-work', 'only_answer_from_references', USERDATA); });
  const Q = 'What is my CGPA?';
  test('premium build: the Profile Intelligence remedy stays (unchanged)', async () => {
    assert.match(await compose(Q, 'looking-for-work', true), /Profile Intelligence/);
  });
  test('source-available build: no Profile Intelligence advice; the gap is still named', async () => {
    const p = await compose(Q, 'looking-for-work', false);
    assert.doesNotMatch(p, /Profile Intelligence|profile-enabled mode/, 'sent the user to a feature this build does not have');
    assert.match(p, /has NO reference material attached, so there was nothing to search/);
  });
  test('source-available build, General mode personal question: no profile remedy', async () => {
    const p = await compose('What was the name of my last employer?', 'general', false);
    assert.doesNotMatch(p, /Profile Intelligence|profile-enabled mode/);
  });
});

test('main.ts marks the build when the premium modules fail to load (source pin)', () => {
  const main = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf8');
  assert.match(main, /Knowledge modules not available[^\n]*\n\s*\/\/[^\n]*\n\s*try \{ require\('\.\/premium\/featureGate'\)\.markPremiumAbsent\(\); \}/);
});

test('the [V3] trace line carries the profile feature state (source pin)', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
  assert.match(src, /profileFeature: profileFeatureAvailable\(\) \? 'available' : 'not_in_build'/);
});
