/**
 * OKF Profile Intelligence — Phase 3 (2026-07-02): Markdown bundle export.
 * Builds the profile packs from the fixture and exports them via the REAL
 * ProfileMarkdownExporter, proving:
 *   - the mandated bundle layout (candidate/, target-job/, artifacts/, references/)
 *   - every concept file is OKF v0.1 conformant (non-empty type, parseable YAML)
 *   - pii: true on every concept file
 *   - references/ are pointer concepts (no raw resume/JD text copied)
 *   - # Citations on every card
 *
 * Pure export path (packs built in-memory) — runs on bare node against dist.
 * Requires: npm run build:electron.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS } from './fixtures/profile-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}

function mintCards(drafts, sourceId) {
  return drafts.map((d) => ({
    id: `pcard_${crypto.createHash('sha1').update(`${sourceId}:${d.conceptId}`).digest('hex').slice(0, 16)}`,
    packId: `ppack_${sourceId}`, sourceId, type: d.type, title: d.title, slug: d.slug, conceptId: d.conceptId,
    body: d.body, sourcePages: [], sourceSections: [d.sourceCategory], sourceQuotes: d.sourceQuotes,
    entities: d.entities, tags: d.tags, relatedCardIds: [], confidence: d.confidence,
    generatedFrom: d.generatedFrom, sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated',
    updatedAt: '2026-07-02T00:00:00.000Z', cardVersion: 1, pii: true,
  }));
}

async function buildBundle() {
  const { buildResumeCardDrafts, buildJdCardDrafts, buildArtifactCardDrafts } = await load('services/knowledge/ProfileCardTemplates.js');
  const { exportProfileBundle } = await load('services/knowledge/ProfileMarkdownExporter.js');

  const resumeCards = mintCards(buildResumeCardDrafts(FIXTURE_RESUME, { totalExperienceYears: 6 }), 'psrc_resume');
  const jdCards = mintCards([...buildJdCardDrafts(FIXTURE_JD), ...buildArtifactCardDrafts(FIXTURE_ARTIFACTS)], 'psrc_jd');

  const mkPack = (id, cards, fileName) => ({
    id, sourceId: id, modeId: '__profile_okf__', fileName, cards, entities: [], relations: [], indexMd: '',
    stats: { cardCount: cards.length, entityCount: 0, relationCount: 0, sourcePages: 0, sourceSections: 0, avgConfidence: 1, extractionMs: 1 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: '2026-07-02T00:00:00.000Z',
  });

  return exportProfileBundle({
    resumePack: mkPack('psrc_resume', resumeCards, 'Candidate Resume'),
    jdPack: mkPack('psrc_jd', jdCards, 'Target Job Description'),
    nowIso: '2026-07-02T00:00:00.000Z',
  });
}

test('Phase3: bundle has the mandated layout (index/log/candidate/target-job/artifacts/references)', async () => {
  const files = await buildBundle();
  const paths = new Set(files.map((f) => f.path));
  assert.ok(paths.has('index.md'), 'root index.md');
  assert.ok(paths.has('log.md'), 'root log.md');
  assert.ok(paths.has('candidate/index.md'), 'candidate/index.md');
  assert.ok(paths.has('target-job/index.md'), 'target-job/index.md');
  assert.ok(paths.has('artifacts/index.md'), 'artifacts/index.md');
  assert.ok(paths.has('references/resume.md'), 'references/resume.md');
  assert.ok(paths.has('references/job-description.md'), 'references/job-description.md');
  // Some concept files under each dir.
  assert.ok([...paths].some((p) => p.startsWith('candidate/') && p !== 'candidate/index.md'), 'candidate concept files');
  assert.ok([...paths].some((p) => p.startsWith('artifacts/') && p !== 'artifacts/index.md'), 'artifact concept files');
});

test('Phase3: exported bundle is OKF v0.1 conformant', async () => {
  const files = await buildBundle();
  const { checkConformance } = await load('services/knowledge/OkfConformance.js');
  const result = checkConformance(files);
  assert.ok(result.conformant, `conformant (violations: ${JSON.stringify(result.violations)})`);
});

test('Phase3: every concept file has pii: true and a non-empty type', async () => {
  const files = await buildBundle();
  const concepts = files.filter((f) => !/(^|\/)(index|log)\.md$/.test(f.path));
  assert.ok(concepts.length > 0);
  for (const f of concepts) {
    assert.match(f.content, /\ntype: \S/, `${f.path} has non-empty type`);
    assert.match(f.content, /\npii: true/, `${f.path} marked pii: true`);
  }
});

test('Phase3: every candidate/target-job card has a # Citations section', async () => {
  const files = await buildBundle();
  const cards = files.filter((f) => (f.path.startsWith('candidate/') || f.path.startsWith('target-job/') || f.path.startsWith('artifacts/')) && !f.path.endsWith('index.md'));
  for (const f of cards) {
    assert.match(f.content, /# Citations/, `${f.path} has Citations`);
  }
});

test('Phase3: references/ are POINTER concepts — no raw resume text copied in', async () => {
  const files = await buildBundle();
  const resumeRef = files.find((f) => f.path === 'references/resume.md');
  assert.ok(resumeRef, 'resume reference exists');
  // The full resume summary sentence must NOT be present (pointer only).
  assert.ok(!resumeRef.content.includes('Backend-leaning full-stack engineer with 6 years'), 'no raw resume summary copied');
  assert.match(resumeRef.content, /natively:\/\/profile-doc\//, 'pointer resource URI present');
  assert.match(resumeRef.content, /pii: true/, 'reference marked pii');
});

test('Phase3: bundle-relative links in index use absolute (/) form', async () => {
  const files = await buildBundle();
  const rootIndex = files.find((f) => f.path === 'index.md');
  assert.match(rootIndex.content, /\]\(\/candidate\/index\.md\)/, 'absolute bundle-relative link');
});
