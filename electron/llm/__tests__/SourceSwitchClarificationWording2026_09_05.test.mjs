// electron/llm/__tests__/SourceSwitchClarificationWording2026_09_05.test.mjs
//
// The source-switch clarification must name the source the user asked for and
// must not claim "uploaded material" when none is attached. Before this, WTA
// and manual chat called buildSourceSwitchClarification(owner) with no source,
// so "how do I stack up against the JD?" in General was answered with "I'm not
// pulling from your RÉSUMÉ here" and "this mode only answers from your uploaded
// material" — wrong source, and no material. The phone-mirror path already
// passed the requested source; the other two now do, and the WTA never-retrieve
// gate treats an empty allowed-evidence list as granting nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { buildSourceSwitchClarification, resolveSourceOwnership } = await import(
  pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/sourceOwnership.js')).href,
);
const engine = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

describe('the clarification names the source that was asked for', () => {
  test('a job-description ask says job description, not résumé', () => {
    const t = buildSourceSwitchClarification('unknown', 'job_description');
    assert.match(t, /job description/);
    assert.doesNotMatch(t, /résumé/);
  });
  test('with no files attached it does not claim the mode only answers from uploaded material', () => {
    const t = buildSourceSwitchClarification('reference_files', 'job_description', { hasReferenceFiles: false });
    assert.doesNotMatch(t, /only answers from your uploaded material/);
    assert.match(t, /doesn't have your job description enabled/);
  });
  test('asking for the uploaded material when nothing is uploaded says so, and the remedy is to attach, not switch', () => {
    const t = buildSourceSwitchClarification('unknown', 'reference_files', { hasReferenceFiles: false });
    assert.match(t, /Nothing is uploaded to this mode yet/);
    assert.doesNotMatch(t, /Switch to a mode/);
  });
  test('a reference-bound mode WITH files keeps the original wording (pinned elsewhere too)', () => {
    const t = buildSourceSwitchClarification('reference_files', 'profile', { hasReferenceFiles: true });
    assert.match(t, /only answers from your uploaded material/);
  });
  test('the no-args call is unchanged, so existing callers are not disturbed', () => {
    assert.match(buildSourceSwitchClarification('reference_files'), /only answers from your uploaded material.*résumé/);
  });
});

describe('the decision carries the requested source', () => {
  test('from a canonical turn decision', () => {
    const own = resolveSourceOwnership({
      question: 'how do i stack up against the jd',
      turnSourceDecision: {
        outcome: 'explicit_denied', owner: 'clarify', reasonCode: 'explicit_switch_not_enabled',
        explicitRequest: 'job_description', explicitRequests: ['job_description'], allowedEvidenceKinds: [],
      },
    });
    assert.equal(own.requestedSource, 'job_description');
    assert.equal(own.shouldClarifyInsteadOfProfile, true);
  });
  test('from the legacy regex path', () => {
    const own = resolveSourceOwnership({
      question: 'from my resume what did i do at acme',
      contract: { sourceAuthority: 'reference_files_only' },
      profileContextPolicy: 'allowed',
    });
    assert.equal(own.requestedSource, 'profile');
  });
});

describe('wiring: every call site passes the requested source', () => {
  test('WTA passes requestedSource and hasReferenceFiles', () => {
    const i = engine.indexOf("buildSourceSwitchClarification(\n                            wtaOwnershipDecision.owner");
    assert.ok(i > 0, 'WTA call must be the multi-argument form');
    const call = engine.slice(i, i + 400);
    assert.ok(call.includes('wtaOwnershipDecision.requestedSource'));
    assert.ok(call.includes('hasReferenceFiles'));
  });
  test('manual chat passes requestedSource and hasReferenceFiles at both sites', () => {
    const sites = ipc.split('buildSourceSwitchClarification(').length - 1;
    assert.ok(sites >= 3, `expected the two manual sites plus phone mirror, found ${sites}`);
    assert.equal((ipc.match(/manualOwnership\.requestedSource/g) || []).length, 2, 'both manual-chat sites must pass the requested source');
    assert.equal(ipc.includes('buildSourceSwitchClarification(manualOwnership.owner)'), false, 'no bare owner-only manual call may remain');
    assert.ok(ipc.includes("buildSourceSwitchClarification(_pOwn.owner, _pExplicitSwitch, { hasReferenceFiles"), 'phone mirror must pass availability too');
  });
});

describe('WTA never-retrieve gate', () => {
  test('an empty allowed-evidence list grants nothing, at BOTH places the gate is derived', () => {
    // The gate is assigned twice, ~300 lines apart. The first fix (2026-09-05)
    // landed only at the first site and the second silently undid it on every
    // mode with a persisted contract. Count the rule, do not anchor on one.
    const hits = engine.split(/allowedEvidenceKinds\.length === 0\)\s*\{\s*wtaDecisionAllowsCandidateProfile = false;/).length - 1;
    assert.equal(hits, 2, `expected the empty-list rule at both assignment sites, found ${hits}`);
  });
});
