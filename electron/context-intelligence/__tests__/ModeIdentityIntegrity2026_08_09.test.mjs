// Mode identity must fail LOUD, not fall back to the most permissive mode.
//
// Live report 2026-08-09: a mode named "Technical Interview" ran as
// `templateType: general`. Because `general` is the one built-in with
// `profileSources: []`, the user's résumé was never loaded into scope and
// "What is my CGPA?" was declined — correctly, but for an invisible reason.
// Re-saving the mode corrected the template and the same question answered
// from the résumé (`profile=3`, `evidence=2`).
//
// Whatever put a wrong template on that row, two properties were missing and
// are the reason a data problem became a silent capability loss:
//
//   1. NO VALIDATION ON WRITE. `updateMode` persisted any string as
//      template_type. An unrecognised value is only caught at READ time, by
//      `isModeId(raw) ? raw : 'general'`.
//
//   2. THE FALLBACK IS SILENT, AND IT IS THE WRONG DIRECTION. "We do not know
//      what this mode is" resolves to the mode with the widest general-knowledge
//      licence and NO profile access. Failing closed would be defensible;
//      failing open and quiet is not. Nothing was logged, so the only evidence
//      was a `profile=0` the user had to notice themselves.
//
// This suite pins both. It deliberately tests the pure helpers rather than
// driving the DB: the invariant is "an unknown id is rejected and announced",
// which does not need a database to be true.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { isModeId, MODE_IDS, resolveModeIdOrWarn } =
  await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

describe('resolveModeIdOrWarn — the fallback is announced, never silent', () => {
  let warnings;
  const realWarn = console.warn;
  beforeEach(() => { warnings = []; console.warn = (...a) => { warnings.push(a.join(' ')); }; });
  afterEach(() => { console.warn = realWarn; });

  test('a valid id passes through with no warning', () => {
    assert.equal(resolveModeIdOrWarn('technical-interview', 'test'), 'technical-interview');
    assert.equal(warnings.length, 0);
  });

  for (const bad of ['Technical Interview', 'technical_interview', 'lecture-mode', '', null, undefined, 42]) {
    test(`an unusable value falls back AND warns: ${JSON.stringify(bad)}`, () => {
      assert.equal(resolveModeIdOrWarn(bad, 'test-surface'), 'general');
      assert.equal(warnings.length, 1, 'exactly one warning per unusable id');
      assert.match(warnings[0], /mode/i);
      assert.match(warnings[0], /test-surface/, 'the warning names the surface, so it is traceable');
    });
  }

  test('the warning carries the rejected value, so the bad row can be found', () => {
    resolveModeIdOrWarn('technical_interview', 'ipc');
    assert.match(warnings[0], /technical_interview/);
  });

  test('a missing mode is NOT treated the same as an invalid one', () => {
    // No mode selected at all is an ordinary state (fresh app, no active mode)
    // and must stay quiet. Only a value that was SET and is unusable is a defect.
    assert.equal(resolveModeIdOrWarn(null, 'ipc', { quietWhenAbsent: true }), 'general');
    assert.equal(warnings.length, 0);
  });
});

describe('MODE_IDS is the single source of truth', () => {
  test('every id resolves and isModeId agrees', () => {
    assert.ok(MODE_IDS.length >= 8, `expected the 8 built-ins, got ${MODE_IDS.length}`);
    for (const id of MODE_IDS) {
      assert.equal(isModeId(id), true, id);
      assert.equal(resolveModeIdOrWarn(id, 'test'), id);
    }
  });

  test('general is the fallback, and it is the LEAST profile-capable — documented, not accidental', async () => {
    // Pinned so the asymmetry stays visible: falling back to `general` costs
    // profile access entirely. If the fallback target ever changes, this test
    // should be read again rather than updated reflexively.
    const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
    assert.deepEqual(MODE_POLICIES.general.profileSources, [],
      'general has no profile sources — that is why a silent fallback to it hides a résumé');
    const profileCapable = MODE_IDS.filter((id) => (MODE_POLICIES[id].profileSources ?? []).length > 0);
    assert.deepEqual(profileCapable.sort(), ['looking-for-work', 'technical-interview'],
      'only these two modes can see Profile Intelligence');
  });
});
