// Outbound provider-data-scope enforcement on the V3 answer path (2026-08-01).
//
// D1/D2/D3: the six "Cloud provider data scopes" toggles in Settings > AI
// Providers > Privacy did nothing on the shipped default path. V3 packs every
// source as `<evidence source_type="…">`; LLMHelper only recognised the legacy
// tag vocabulary, so no scope was inferred, the V3 call site declared `[]`, and
// the one enforcement action (`context = undefined`) was a no-op because a V3
// prompt carries its evidence in the MESSAGE.
//
// EVERY assertion below is on the PROMPT STRING that is handed to
// llmHelper.streamChat — i.e. on what actually leaves the process. Asserting
// that `withheldDataScopes` contains 'reference_files' would pass happily while
// the résumé shipped; that is explicitly not what these tests do.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const base = path.resolve(repoRoot, 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const {
  SOURCE_TYPE_DATA_SCOPE, dataScopeForSourceType, sourceTypesForScopes,
  filterEvidenceByProviderScopes, dataScopesForEvidence, dataScopesForEvidenceMarkup,
  applyEnvScopeDenials, parseDeniedScopesEnv, readProviderScopePolicy,
  DENY_PROVIDER_SCOPES_ENV,
} = await load('policies/provider-scope-policy.js');
const { buildV3Prompt } = await load('orchestration/engine-bridge.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { decide } = await load('orchestration/orchestrator.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

// ── fixtures ────────────────────────────────────────────────────────────────

const SECRET_CODE = 'WORKER_BATCH_SIZE = 64';
const SECRET_RESUME = 'Led the RedisMart caching prototype at Acme';

const evidence = (over = {}) => ({
  evidenceId: 'ev1', sourceType: 'CODING_SAMPLE', sourceId: 'f-config', versionId: 'legacy',
  scopeId: 'u:local', documentTitle: 'queueforge_config.py', chunkIndex: 0,
  content: `CACHE_TTL_SECONDS = 420\n${SECRET_CODE}`,
  keywordScore: 0.9, semanticScore: 0.7, finalScore: 0.95,
  authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
  isDirectFact: true, isInferred: false, trustLevel: 'untrusted_reference', metadata: {},
  ...over,
});

const resumeEvidence = (over = {}) => evidence({
  evidenceId: 'ev-resume', sourceType: 'RESUME', sourceId: 'resume-1', documentTitle: 'resume.pdf',
  content: SECRET_RESUME,
  authorityFor: ['USER_EMPLOYMENT'], acceptedFor: ['USER_EMPLOYMENT'],
  ...over,
});

const port = (items = []) => ({ retrieve: async () => ({ evidence: items, attempts: [] }) });

async function withEnvDenial(value, fn) {
  const before = process.env[DENY_PROVIDER_SCOPES_ENV];
  if (value === undefined) delete process.env[DENY_PROVIDER_SCOPES_ENV];
  else process.env[DENY_PROVIDER_SCOPES_ENV] = value;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env[DENY_PROVIDER_SCOPES_ENV];
    else process.env[DENY_PROVIDER_SCOPES_ENV] = before;
  }
}

const bridge = (over = {}) => buildV3Prompt({
  surface: 'manual-chat', pathTag: 'ipc',
  question: 'What is the current worker batch size?',
  modeTemplateType: 'technical-interview', modeUniqueId: 'mode_scope1', modeName: 'Technical Interview',
  attachedSourceCount: 2,
  requestId: `scope_${Math.random().toString(36).slice(2)}`, requestSequence: 3,
  scope: { userId: 'local', sessionId: `scope-session-${Math.random().toString(36).slice(2)}` },
  retrieval: port([evidence()]),
  ...over,
});

// ── 1. The mapping ──────────────────────────────────────────────────────────

describe('SourceType → ProviderDataScope mapping', () => {
  test('every SourceType declared in the contracts is mapped (drift guard)', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/context-intelligence/contracts/types.ts'), 'utf8');
    const union = src.slice(src.indexOf('export type SourceType ='), src.indexOf(';', src.indexOf('export type SourceType =')));
    const members = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    assert.ok(members.length >= 10, `parsed too few SourceType members: ${members.length}`);
    for (const m of members) {
      assert.ok(SOURCE_TYPE_DATA_SCOPE[m], `SourceType ${m} has no provider data scope — evidence of that type would leave unclassified`);
    }
    assert.deepEqual(
      Object.keys(SOURCE_TYPE_DATA_SCOPE).sort(), [...members].sort(),
      'the map and the SourceType union have drifted apart',
    );
  });

  test('the mapping is the documented one', () => {
    assert.equal(dataScopeForSourceType('MEETING_TRANSCRIPT'), 'transcript');
    assert.equal(dataScopeForSourceType('CONVERSATION_STATE'), 'transcript');
    assert.equal(dataScopeForSourceType('RESUME'), 'profile_history');
    assert.equal(dataScopeForSourceType('PROFILE_FACT'), 'profile_history');
    assert.equal(dataScopeForSourceType('JOB_DESCRIPTION'), 'reference_files');
    assert.equal(dataScopeForSourceType('REFERENCE_FILE'), 'reference_files');
    assert.equal(dataScopeForSourceType('PROJECT_FILE'), 'reference_files');
    assert.equal(dataScopeForSourceType('CODING_SAMPLE'), 'reference_files');
    assert.equal(dataScopeForSourceType('CANDIDATE_FILE'), 'reference_files');
    assert.equal(dataScopeForSourceType('SCREEN_CONTEXT'), 'screenshots');
    assert.equal(dataScopeForSourceType('NOT_A_SOURCE_TYPE'), undefined);
  });

  test('sourceTypesForScopes inverts the map', () => {
    assert.deepEqual([...sourceTypesForScopes(['transcript'])].sort(), ['CONVERSATION_STATE', 'MEETING_TRANSCRIPT']);
    assert.equal(sourceTypesForScopes(['reference_files']).has('JOB_DESCRIPTION'), true);
    assert.equal(sourceTypesForScopes(['reference_files']).has('RESUME'), false);
    assert.equal(sourceTypesForScopes([]).size, 0);
  });
});

// ── 2. The filter ───────────────────────────────────────────────────────────

describe('evidence filter', () => {
  test('withholds only the denied scope, keeps the rest', () => {
    const r = filterEvidenceByProviderScopes([evidence(), resumeEvidence()], { reference_files: false });
    assert.deepEqual(r.evidence.map((e) => e.evidenceId), ['ev-resume']);
    assert.deepEqual(r.withheldScopes, ['reference_files']);
    assert.equal(r.withheldCount, 1);
  });

  test('an allowed policy (all six true) changes nothing', () => {
    const items = [evidence(), resumeEvidence()];
    const all = { transcript: true, screenshots: true, reference_files: true, profile_history: true, embeddings: true, post_call_summary: true };
    const r = filterEvidenceByProviderScopes(items, all);
    assert.deepEqual(r.evidence, items);
    assert.deepEqual(r.withheldScopes, []);
    assert.equal(r.withheldCount, 0);
  });

  test('no policy at all = everything allowed (a settings read failure must not start withholding)', () => {
    const items = [evidence(), resumeEvidence()];
    assert.deepEqual(filterEvidenceByProviderScopes(items, undefined).evidence, items);
  });

  test('dataScopesForEvidence reports what a set carries', () => {
    assert.deepEqual(dataScopesForEvidence([evidence(), resumeEvidence()]).sort(), ['profile_history', 'reference_files']);
    assert.deepEqual(dataScopesForEvidence([]), []);
  });
});

// ── 3. Deny-only env override ───────────────────────────────────────────────

describe('deny-only env override', () => {
  test('parses a comma list and ignores unknown names', () => {
    assert.deepEqual(parseDeniedScopesEnv('transcript, reference_files, nonsense'), ['transcript', 'reference_files']);
    assert.deepEqual(parseDeniedScopesEnv(''), []);
    assert.deepEqual(parseDeniedScopesEnv(undefined), []);
  });

  test('can only DENY — it can never grant a scope the user switched off', () => {
    const stored = { transcript: false, reference_files: true };
    const merged = applyEnvScopeDenials(stored, 'reference_files');
    assert.equal(merged.transcript, false, 'env must not be able to re-enable a denied scope');
    assert.equal(merged.reference_files, false);
    // No env value → the stored policy is returned untouched.
    assert.deepEqual(applyEnvScopeDenials(stored, undefined), stored);
  });

  test('readProviderScopePolicy applies the env denial live (no caching)', () => {
    const before = readProviderScopePolicy();
    assert.ok(before === undefined || before.reference_files !== false);
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'reference_files';
    assert.equal(readProviderScopePolicy().reference_files, false);
    delete process.env[DENY_PROVIDER_SCOPES_ENV];
    const after = readProviderScopePolicy();
    assert.ok(after === undefined || after.reference_files !== false, 'policy was cached across reads');
  });
});

// ── 4. THE PAYLOAD: what buildV3Prompt hands to streamChat ──────────────────

describe('composed prompt is the enforcement boundary', () => {
  test('BASELINE: with every scope allowed the evidence is present and declared', async () => {
    const r = await withEnvDenial(undefined, () => bridge());
    assert.ok(r, 'bridge returned null');
    assert.ok(r.user.includes(SECRET_CODE), 'baseline must ship the evidence — otherwise the denial test is vacuous');
    assert.deepEqual(r.packedDataScopes, ['reference_files']);
    assert.deepEqual(r.withheldDataScopes, []);
    assert.equal(r.evidenceCount, 1);
  });

  test('reference_files denied: the document text is NOT in the outbound prompt', async () => {
    const r = await withEnvDenial('reference_files', () => bridge());
    assert.ok(r, 'bridge returned null');
    assert.ok(!r.user.includes(SECRET_CODE), 'LEAK: withheld document content is in the outbound prompt');
    assert.ok(!r.user.includes('CACHE_TTL_SECONDS'), 'LEAK: withheld document content is in the outbound prompt');
    assert.ok(!r.user.includes('queueforge_config.py'), 'LEAK: withheld document identity is in the outbound prompt');
    assert.ok(!/<evidence\b/.test(r.user), 'LEAK: an evidence block survived the filter');
    assert.equal(r.evidenceCount, 0);
    assert.deepEqual(r.withheldDataScopes, ['reference_files']);
    assert.deepEqual(r.packedDataScopes, []);
  });

  test('profile_history denied withholds the résumé and leaves other evidence alone', async () => {
    const r = await withEnvDenial('profile_history', () => bridge({
      question: 'What did I do at Acme, and what is the worker batch size?',
      retrieval: port([evidence(), resumeEvidence()]),
    }));
    assert.ok(r, 'bridge returned null');
    assert.ok(!r.user.includes(SECRET_RESUME), 'LEAK: résumé content in the outbound prompt with profile_history denied');
    assert.ok(r.user.includes(SECRET_CODE), 'reference-file evidence must survive a profile_history denial');
    assert.deepEqual(r.withheldDataScopes, ['profile_history']);
    assert.deepEqual(r.packedDataScopes, ['reference_files']);
  });

  test('an emptied evidence set produces an honest refusal, not a document-blaming one', async () => {
    const r = await withEnvDenial('reference_files', () => bridge());
    assert.match(r.user, /privacy setting/i);
    assert.match(r.user, /Settings > AI Providers > Privacy/);
    // The retrieval-miss wording must NOT appear: it tells the user the source
    // was consulted and came up empty, when in fact it was never sent.
    assert.ok(!/No supporting evidence was retrieved/i.test(r.user),
      'the prompt reports a retrieval miss for material the privacy setting withheld');
    assert.ok(!/has NO reference material attached/i.test(r.user),
      'the prompt claims nothing is attached when files are attached and were withheld');
    assert.ok(!/the résumé and profile material do not cover this/i.test(r.user),
      'the prompt blames the document for a gap the privacy setting created');
    assert.match(r.user, /Do NOT answer from general knowledge/i);
  });

  test('transcript denied drops the conversation-state summary from the payload', async () => {
    const summary = 'Previous question: How many nodes were in the cluster?';
    const allowed = await withEnvDenial(undefined, () => bridge({ conversationSummary: summary }));
    assert.ok(allowed.user.includes(summary), 'baseline must ship the summary — otherwise the denial test is vacuous');
    assert.ok(allowed.packedDataScopes.includes('transcript'));

    const denied = await withEnvDenial('transcript', () => bridge({ conversationSummary: summary }));
    assert.ok(!denied.user.includes(summary), 'LEAK: conversation-state text survived a transcript denial');
    assert.ok(!denied.user.includes('How many nodes'), 'LEAK: conversation-state text survived a transcript denial');
    assert.ok(denied.withheldDataScopes.includes('transcript'));
    assert.ok(!denied.packedDataScopes.includes('transcript'));
  });

  test('MEETING_TRANSCRIPT evidence is withheld under a transcript denial', async () => {
    const spoken = 'Marcus said the launch slips to Q3';
    const meeting = evidence({
      evidenceId: 'ev-meet', sourceType: 'MEETING_TRANSCRIPT', sourceId: 'meeting-1',
      documentTitle: 'Team Meet', content: spoken,
      authorityFor: ['MEETING_STATEMENT'], acceptedFor: ['MEETING_STATEMENT'],
    });
    const allowed = await withEnvDenial(undefined, () => bridge({
      question: 'What did Marcus say about the launch?', modeTemplateType: 'meeting', retrieval: port([meeting]),
    }));
    assert.ok(allowed.user.includes(spoken), 'baseline must ship the transcript evidence');

    const denied = await withEnvDenial('transcript', () => bridge({
      question: 'What did Marcus say about the launch?', modeTemplateType: 'meeting', retrieval: port([meeting]),
    }));
    assert.ok(!denied.user.includes(spoken), 'LEAK: meeting transcript content shipped with transcript denied');
    assert.deepEqual(denied.withheldDataScopes, ['transcript']);
  });

  test('REGRESSION: with all six scopes allowed the prompt is byte-identical to no policy at all', async () => {
    // Distinct sessionIds: conversation state advances per session, so reusing
    // one would make the second prompt differ for a reason unrelated to scopes.
    const a = await withEnvDenial(undefined, () => bridge({
      requestId: 'scope_fixed_1', requestSequence: 1,
      scope: { userId: 'local', sessionId: 'scope-fixed-session-a' },
    }));
    // Same call with the env override present but naming nothing: the deny path
    // is evaluated and must withhold nothing.
    const b = await withEnvDenial('', () => bridge({
      requestId: 'scope_fixed_2', requestSequence: 1,
      scope: { userId: 'local', sessionId: 'scope-fixed-session-b' },
    }));
    assert.equal(a.user, b.user);
    assert.equal(a.system, b.system);
    assert.deepEqual(a.packedDataScopes, b.packedDataScopes);
  });
});

// ── 5. Prompt/evidence coherence ────────────────────────────────────────────

describe('composer coherence when material was withheld', () => {
  const decision = (q = 'Do I have Kubernetes experience?') => decide({
    requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId: 'technical-interview',
    scope: { userId: 'local' }, sessionId: 's1', manualQuestion: q,
  });
  const inventory = resumeEvidence({ metadata: { completeInventory: true } });
  const policy = MODE_POLICIES['technical-interview'];

  test('the checked-absence contract is suppressed when ANY evidence was withheld', () => {
    const intact = composePrompt({ decision: decision(), policy, evidence: [inventory] });
    assert.match(intact.system, /# Checked absence/, 'baseline must render the contract');

    const filtered = composePrompt({
      decision: decision(), policy, evidence: [inventory], withheldScopes: ['reference_files'],
    });
    assert.ok(!/# Checked absence/.test(filtered.system),
      'a truncated evidence set was still described as a COMPLETE record — this licenses "the résumé does not list it" about material that was removed');
  });

  test('partial withholding is disclosed alongside the surviving evidence', () => {
    const p = composePrompt({
      decision: decision(), policy, evidence: [evidence()], withheldScopes: ['profile_history'],
    });
    assert.match(p.user, /# Withheld material/);
    assert.match(p.user, /Profile & history/);
    assert.match(p.user, /never state that something is absent/i);
    assert.ok(p.user.includes(SECRET_CODE), 'surviving evidence must still be present');
  });

  test('REGRESSION: an empty withheld list composes byte-identically to omitting it', () => {
    const a = composePrompt({ decision: decision(), policy, evidence: [inventory] });
    const b = composePrompt({ decision: decision(), policy, evidence: [inventory], withheldScopes: [] });
    assert.equal(a.system, b.system);
    assert.equal(a.user, b.user);
    assert.deepEqual(a.sections, b.sections);
  });
});

// ── 6. Wiring ───────────────────────────────────────────────────────────────

describe('the V3 transport declares the scopes it is sending', () => {
  // STRUCTURAL, and honestly labelled as such: because the bridge already
  // filtered the evidence, reverting this line to `[]` leaks nothing and no
  // behavioural test can fail. What it costs is honesty at the transport — the
  // routing/denial decision goes back to being guessed from the bytes — so it
  // is guarded here rather than not at all.
  test('ipcHandlers passes the bridge-declared scopes into streamChat', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    assert.match(src, /composed\.packedDataScopes \?\? \[\],/,
      'the V3 call site must declare its real data scopes, not []');
  });
});

// ── 7. Markup read-back (the transport backstop's input) ────────────────────

describe('scopes read back off composed markup', () => {
  test('V3 evidence markup discloses its scopes', () => {
    const markup = '<evidence evidence_id="e1" source_type="RESUME" source_id="r">x</evidence>\n'
      + '<evidence evidence_id="e2" source_type="MEETING_TRANSCRIPT" source_id="m">y</evidence>';
    assert.deepEqual(dataScopesForEvidenceMarkup(markup).sort(), ['profile_history', 'transcript']);
    assert.deepEqual(dataScopesForEvidenceMarkup('no evidence here'), []);
    assert.deepEqual(dataScopesForEvidenceMarkup(undefined), []);
  });
});
