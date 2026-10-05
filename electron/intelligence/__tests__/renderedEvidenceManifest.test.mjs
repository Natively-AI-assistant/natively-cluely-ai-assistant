// electron/intelligence/__tests__/renderedEvidenceManifest.test.mjs
//
// Covers electron/intelligence/context-os/renderedEvidenceManifest.ts — the
// structured record of which factual evidence was rendered into a prompt
// (ids, kinds, families and their counts) and the serialization check.
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/intelligence/__tests__/renderedEvidenceManifest.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  RENDERED_EVIDENCE_FAMILIES,
  familyForTurnEvidenceKind,
  familyForRenderedSourceKind,
  buildRenderedEvidenceManifest,
  manifestIncludesSerializedEvidence,
} = require(path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/renderedEvidenceManifest.js'));

const ALL_FAMILIES = ['reference_files', 'resume', 'projects', 'job_description', 'transcript', 'meeting_rag'];
const zeroFamilies = () => Object.fromEntries(ALL_FAMILIES.map((f) => [f, 0]));

const item = (evidenceId, sourceKind, authority = 'evidence') => ({
  evidenceId,
  sourceKind,
  sourceId: `src-${evidenceId}`,
  sourceOwner: 'reference_files',
  authority,
  trustLevel: 'user_uploaded',
  text: `text of ${evidenceId}`,
  supports: { property: 'unknown' },
  score: { final: 1 },
  reasonIncluded: 'test',
});

describe('RENDERED_EVIDENCE_FAMILIES', () => {
  test('lists the six families in canonical order, without duplicates', () => {
    assert.deepEqual(RENDERED_EVIDENCE_FAMILIES, ALL_FAMILIES);
    assert.equal(new Set(RENDERED_EVIDENCE_FAMILIES).size, RENDERED_EVIDENCE_FAMILIES.length);
  });
});

describe('familyForTurnEvidenceKind', () => {
  test('maps every turn evidence kind to its family', () => {
    assert.equal(familyForTurnEvidenceKind('profile_resume'), 'resume');
    assert.equal(familyForTurnEvidenceKind('projects'), 'projects');
    assert.equal(familyForTurnEvidenceKind('profile_jd'), 'job_description');
    assert.equal(familyForTurnEvidenceKind('live_transcript'), 'transcript');
    assert.equal(familyForTurnEvidenceKind('meeting_rag'), 'meeting_rag');
    assert.equal(familyForTurnEvidenceKind('reference_files'), 'reference_files');
  });

  test('every mapped family is a known family', () => {
    for (const kind of ['profile_resume', 'projects', 'profile_jd', 'live_transcript', 'meeting_rag', 'reference_files']) {
      assert.ok(RENDERED_EVIDENCE_FAMILIES.includes(familyForTurnEvidenceKind(kind)), kind);
    }
  });

  test('an unknown kind has no family', () => {
    assert.equal(familyForTurnEvidenceKind('hindsight_memory'), undefined);
    assert.equal(familyForTurnEvidenceKind(undefined), undefined);
  });
});

describe('familyForRenderedSourceKind', () => {
  test('all reference-file shaped kinds collapse to reference_files', () => {
    for (const kind of ['mode_reference_file', 'mode_reference_chunk', 'okf_document_card']) {
      assert.equal(familyForRenderedSourceKind(kind), 'reference_files', kind);
    }
  });

  test('profile kinds map to resume / projects / job_description', () => {
    assert.equal(familyForRenderedSourceKind('profile_resume'), 'resume');
    assert.equal(familyForRenderedSourceKind('profile_project'), 'projects');
    assert.equal(familyForRenderedSourceKind('profile_projects'), 'projects');
    assert.equal(familyForRenderedSourceKind('profile_jd'), 'job_description');
  });

  test('transcript and meeting RAG kinds map to their own families', () => {
    assert.equal(familyForRenderedSourceKind('live_transcript'), 'transcript');
    assert.equal(familyForRenderedSourceKind('meeting_rag_chunk'), 'meeting_rag');
  });

  test('kinds outside the rendered families return null', () => {
    for (const kind of ['hindsight_memory', 'assistant_claim', 'meeting_rag', 'reference_files', 'PROFILE_RESUME', '', undefined, null]) {
      assert.equal(familyForRenderedSourceKind(kind), null, String(kind));
    }
  });
});

describe('buildRenderedEvidenceManifest', () => {
  test('an empty pack yields an all-zero manifest', () => {
    assert.deepEqual(buildRenderedEvidenceManifest({ packId: 'p1', turnId: 't1', items: [] }), {
      packId: 'p1',
      turnId: 't1',
      evidenceIds: [],
      evidenceKinds: [],
      evidenceFamilies: [],
      countsByKind: {},
      countsByFamily: zeroFamilies(),
    });
  });

  test('a missing pack id becomes null', () => {
    assert.equal(buildRenderedEvidenceManifest({ turnId: 't', items: [] }).packId, null);
    assert.equal(buildRenderedEvidenceManifest({ packId: undefined, turnId: 't', items: [] }).packId, null);
  });

  test('counts evidence by kind and by family', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [
        item('e0', 'mode_reference_chunk'),
        item('e1', 'mode_reference_chunk'),
        item('e2', 'okf_document_card'),
        item('e3', 'profile_resume'),
        item('e4', 'live_transcript'),
      ],
    });
    assert.deepEqual(manifest.evidenceIds, ['e0', 'e1', 'e2', 'e3', 'e4']);
    assert.deepEqual(manifest.countsByKind, {
      mode_reference_chunk: 2,
      okf_document_card: 1,
      profile_resume: 1,
      live_transcript: 1,
    });
    assert.deepEqual(manifest.countsByFamily, { ...zeroFamilies(), reference_files: 3, resume: 1, transcript: 1 });
  });

  test('evidenceKinds follow first appearance, evidenceFamilies follow canonical order', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [
        item('a', 'meeting_rag_chunk'),
        item('b', 'live_transcript'),
        item('c', 'profile_jd'),
        item('d', 'mode_reference_file'),
        item('e', 'meeting_rag_chunk'),
      ],
    });
    assert.deepEqual(manifest.evidenceKinds, ['meeting_rag_chunk', 'live_transcript', 'profile_jd', 'mode_reference_file']);
    assert.deepEqual(manifest.evidenceFamilies, ['reference_files', 'job_description', 'transcript', 'meeting_rag']);
  });

  test('only items with evidence authority are recorded', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [
        item('ref', 'live_transcript', 'referent_only'),
        item('forb', 'profile_resume', 'forbidden'),
        item('style', 'profile_jd', 'style'),
        item('ok', 'mode_reference_chunk', 'evidence'),
      ],
    });
    assert.deepEqual(manifest.evidenceIds, ['ok']);
    assert.deepEqual(manifest.evidenceKinds, ['mode_reference_chunk']);
    assert.deepEqual(manifest.evidenceFamilies, ['reference_files']);
    assert.deepEqual(manifest.countsByFamily, { ...zeroFamilies(), reference_files: 1 });
  });

  test('a repeated evidence id is recorded and counted once (first one wins)', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [item('dup', 'profile_resume'), item('dup', 'live_transcript'), item('other', 'profile_resume')],
    });
    assert.deepEqual(manifest.evidenceIds, ['dup', 'other']);
    assert.deepEqual(manifest.countsByKind, { profile_resume: 2 });
    assert.deepEqual(manifest.countsByFamily, { ...zeroFamilies(), resume: 2 });
  });

  test('a referent-only item does not reserve its id against a later evidence item', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [item('x', 'live_transcript', 'referent_only'), item('x', 'profile_resume', 'evidence')],
    });
    assert.deepEqual(manifest.evidenceIds, ['x']);
    assert.deepEqual(manifest.countsByKind, { profile_resume: 1 });
  });

  test('evidence of a kind with no family is counted by kind only', () => {
    const manifest = buildRenderedEvidenceManifest({
      packId: 'p',
      turnId: 't',
      items: [item('h0', 'hindsight_memory'), item('h1', 'hindsight_memory')],
    });
    assert.deepEqual(manifest.evidenceIds, ['h0', 'h1']);
    assert.deepEqual(manifest.countsByKind, { hindsight_memory: 2 });
    assert.deepEqual(manifest.evidenceFamilies, []);
    assert.deepEqual(manifest.countsByFamily, zeroFamilies());
  });

  test('family counts always add up to the family-mapped evidence items', () => {
    const items = [
      item('1', 'mode_reference_file'), item('2', 'profile_project'), item('3', 'profile_projects'),
      item('4', 'profile_jd'), item('5', 'meeting_rag_chunk'), item('6', 'hindsight_memory'),
    ];
    const manifest = buildRenderedEvidenceManifest({ packId: 'p', turnId: 't', items });
    const total = Object.values(manifest.countsByFamily).reduce((a, b) => a + b, 0);
    assert.equal(total, 5);
    assert.equal(manifest.countsByFamily.projects, 2);
    assert.equal(Object.values(manifest.countsByKind).reduce((a, b) => a + b, 0), manifest.evidenceIds.length);
  });

  test('each call returns fresh, independent count objects', () => {
    const a = buildRenderedEvidenceManifest({ packId: 'p', turnId: 't', items: [item('1', 'profile_resume')] });
    const b = buildRenderedEvidenceManifest({ packId: 'p', turnId: 't', items: [] });
    assert.notEqual(a.countsByFamily, b.countsByFamily);
    assert.equal(b.countsByFamily.resume, 0);
    assert.deepEqual(RENDERED_EVIDENCE_FAMILIES, ALL_FAMILIES);
  });

  test('does not mutate the pack', () => {
    const pack = { packId: 'p', turnId: 't', items: [item('1', 'profile_resume'), item('1', 'profile_resume')] };
    const snapshot = JSON.parse(JSON.stringify(pack));
    buildRenderedEvidenceManifest(pack);
    assert.deepEqual(pack, snapshot);
  });
});

describe('manifestIncludesSerializedEvidence', () => {
  const manifestWith = (evidenceIds) => ({
    packId: 'p', turnId: 't', evidenceIds, evidenceKinds: [], evidenceFamilies: [], countsByKind: {}, countsByFamily: zeroFamilies(),
  });

  test('true when every evidence id appears as an id attribute', () => {
    const prompt = '<evidence id="t:doc:0" source_kind="x">a</evidence>\n<evidence id="t:doc:1">b</evidence>';
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['t:doc:0', 't:doc:1']), prompt), true);
  });

  test('false when any id is missing', () => {
    const prompt = '<evidence id="t:doc:0">a</evidence>';
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['t:doc:0', 't:doc:1']), prompt), false);
  });

  test('an empty manifest is vacuously included, even in an empty prompt', () => {
    assert.equal(manifestIncludesSerializedEvidence(manifestWith([]), ''), true);
  });

  test('a non-empty manifest is never included in an empty prompt', () => {
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['a']), ''), false);
  });

  test('the id must match exactly: a longer id sharing the prefix does not count', () => {
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['t:doc:1']), '<evidence id="t:doc:10">a</evidence>'), false);
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['t:doc:10']), '<evidence id="t:doc:1">a</evidence>'), false);
  });

  test('the id appearing only as body text does not count', () => {
    assert.equal(manifestIncludesSerializedEvidence(manifestWith(['t:doc:0']), '<text>see t:doc:0</text>'), false);
  });
});
