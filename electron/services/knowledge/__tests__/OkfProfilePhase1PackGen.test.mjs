/**
 * OKF Profile Intelligence — Phase 1 (2026-07-02): profile pack card generation,
 * verification, and OKF conformance. Runs the PURE (no-DB) transform pipeline
 * against the deterministic synthetic fixture, exercising the same
 * ProfileCardTemplates + OkfProfileVerifier + OkfMarkdownExporter + OkfConformance
 * modules the live ProfilePackBuilder uses.
 *
 * Requires: npm run build:electron (dist-electron/electron/services/knowledge/*.js)
 * Run: node --test electron/services/knowledge/__tests__/OkfProfilePhase1PackGen.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS } from './fixtures/profile-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

async function loadModule(relPath) {
  return import(pathToFileURL(path.join(distRoot, relPath)).href);
}

function nowIso() {
  return '2026-07-02T00:00:00.000Z';
}

// Mirror ProfilePackBuilder.buildSourceText for the verifier grounding check.
function buildSourceText(kind, sd, artifacts) {
  const parts = [];
  if (kind === 'resume') {
    const id = sd.identity || {};
    parts.push(id.name, id.summary, id.location, id.email, id.github, id.linkedin);
    for (const e of sd.experience || []) parts.push(e.company, e.role, e.start_date, e.end_date, ...(e.bullets || []));
    for (const p of sd.projects || []) parts.push(p.name, p.description, ...(p.technologies || []));
    for (const ed of sd.education || []) parts.push(ed.institution, ed.degree, ed.field, ed.gpa);
    for (const a of sd.achievements || []) parts.push(a.title, a.description);
    const skills = sd.skills || {};
    for (const cat of Object.keys(skills)) parts.push(cat, ...(skills[cat] || []));
  } else {
    parts.push(sd.title, sd.company, sd.location, sd.description_summary, sd.level);
    parts.push(...(sd.requirements || []), ...(sd.nice_to_haves || []), ...(sd.responsibilities || []));
    parts.push(...(sd.keywords || []), ...(sd.technologies || []));
  }
  if (artifacts) parts.push(JSON.stringify(artifacts));
  return parts.filter((x) => typeof x === 'string' && x.trim()).join(' \n ');
}

async function buildResumeCards() {
  const { buildResumeCardDrafts } = await loadModule('services/knowledge/ProfileCardTemplates.js');
  const drafts = buildResumeCardDrafts(FIXTURE_RESUME, { totalExperienceYears: 6 });
  return drafts.map((d) => ({
    id: `pcard_${crypto.createHash('sha1').update(d.conceptId).digest('hex').slice(0, 16)}`,
    packId: 'ppack_test', sourceId: 'psrc_test', type: d.type, title: d.title, slug: d.slug,
    conceptId: d.conceptId, body: d.body, sourcePages: [], sourceSections: [d.sourceCategory],
    sourceQuotes: d.sourceQuotes, entities: d.entities, tags: d.tags, relatedCardIds: [],
    confidence: d.confidence, generatedFrom: d.generatedFrom, sourceChecksum: 'x',
    userEdited: false, approvalStatus: 'generated', updatedAt: nowIso(), cardVersion: 1, pii: true,
  }));
}

test('Phase1: resume produces identity, summary, experience, project, education, achievement, skills cards', async () => {
  const cards = await buildResumeCards();
  const types = new Set(cards.map((c) => c.type));
  assert.ok(types.has('candidate_identity'), 'identity card present');
  assert.ok(types.has('candidate_summary'), 'summary card present');
  assert.ok(types.has('candidate_experience'), 'experience card present');
  assert.ok(types.has('candidate_project'), 'project card present');
  assert.ok(types.has('candidate_education'), 'education card present');
  assert.ok(types.has('candidate_achievement'), 'achievement card present');
  assert.ok(types.has('candidate_skills'), 'skills card present');

  // one experience card per role
  const expCards = cards.filter((c) => c.type === 'candidate_experience');
  assert.equal(expCards.length, 2, 'one experience card per role');

  // one skills card per non-empty category (7 in fixture)
  const skillCards = cards.filter((c) => c.type === 'candidate_skills');
  assert.equal(skillCards.length, 7, 'one skills card per non-empty category');
});

test('Phase1: experience card cites its resume bullets as source evidence', async () => {
  const cards = await buildResumeCards();
  const nimbus = cards.find((c) => c.type === 'candidate_experience' && c.title.includes('Nimbus Data'));
  assert.ok(nimbus, 'Nimbus Data experience card exists');
  const quoteTexts = nimbus.sourceQuotes.map((q) => q.text);
  assert.ok(quoteTexts.some((t) => t.includes('reduced event processing latency by 40%')), 'bullet quoted as evidence');
  assert.ok(nimbus.body.includes('reduced event processing latency by 40%'), 'bullet appears in body');
});

test('Phase1: every profile card is pii=true', async () => {
  const cards = await buildResumeCards();
  assert.ok(cards.length > 0);
  assert.ok(cards.every((c) => c.pii === true), 'all profile cards marked pii');
});

test('Phase1: skills cards match the structured skill categories exactly', async () => {
  const cards = await buildResumeCards();
  const skillCards = cards.filter((c) => c.type === 'candidate_skills');
  const langCard = skillCards.find((c) => c.title === 'Languages Skills');
  assert.ok(langCard, 'languages skills card');
  for (const lang of FIXTURE_RESUME.skills.languages) {
    assert.ok(langCard.body.includes(lang), `languages card contains ${lang}`);
  }
});

test('Phase1: OkfProfileVerifier accepts all deterministic cards (grounded in source)', async () => {
  const { verifyProfileCards } = await loadModule('services/knowledge/OkfProfileVerifier.js');
  const cards = await buildResumeCards();
  const sourceText = buildSourceText('resume', FIXTURE_RESUME);
  const { accepted, rejected } = verifyProfileCards(cards, sourceText);
  assert.equal(rejected.length, 0, `no cards rejected (rejected: ${JSON.stringify(rejected.map((r) => r.result.reasons))})`);
  assert.equal(accepted.length, cards.length, 'all cards accepted');
});

test('Phase1: OkfProfileVerifier REJECTS a fabricated card (invented employer not in source)', async () => {
  const { verifyProfileCards } = await loadModule('services/knowledge/OkfProfileVerifier.js');
  const sourceText = buildSourceText('resume', FIXTURE_RESUME);
  const fabricated = [{
    id: 'pcard_fake', packId: 'p', sourceId: 's', type: 'candidate_experience',
    title: 'Chief Astronaut at Galactic Ventures',
    slug: 'experience-galactic', conceptId: 'candidate/experience-galactic',
    body: 'Piloted interstellar cargo missions and negotiated treaties with extraterrestrial syndicates orbiting Jupiter.',
    sourcePages: [], sourceSections: ['experience'],
    sourceQuotes: [{ text: 'Piloted interstellar cargo missions', page: 0, section: 'experience' }],
    entities: ['Galactic Ventures'], tags: ['experience'], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'structured_profile', sourceChecksum: 'x',
    userEdited: false, approvalStatus: 'generated', updatedAt: nowIso(), cardVersion: 1, pii: true,
  }];
  const { rejected } = verifyProfileCards(fabricated, sourceText);
  assert.equal(rejected.length, 1, 'fabricated card rejected');
});

test('Phase1: JD produces role, requirements, nice-to-haves, keywords + artifact cards', async () => {
  const { buildJdCardDrafts, buildArtifactCardDrafts } = await loadModule('services/knowledge/ProfileCardTemplates.js');
  const jdDrafts = buildJdCardDrafts(FIXTURE_JD);
  const artDrafts = buildArtifactCardDrafts(FIXTURE_ARTIFACTS);
  const types = new Set([...jdDrafts, ...artDrafts].map((d) => d.type));
  assert.ok(types.has('target_job_role'), 'role card');
  assert.ok(types.has('target_job_requirements'), 'requirements card');
  assert.ok(types.has('target_job_nice_to_haves'), 'nice-to-haves card');
  assert.ok(types.has('target_job_keywords'), 'keywords card');
  assert.ok(types.has('artifact_gap_analysis'), 'gap analysis artifact card');
  assert.ok(types.has('artifact_negotiation'), 'negotiation artifact card');
  assert.ok(types.has('artifact_mock_questions'), 'mock questions artifact card');
  assert.ok(types.has('artifact_culture_mapping'), 'culture mapping artifact card');
  assert.ok(types.has('artifact_intro'), 'intro artifact card');
});

test('Phase1: exported profile cards are OKF v0.1 conformant (every file has non-empty type)', async () => {
  const { exportPack } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const cards = await buildResumeCards();
  const pack = {
    id: 'ppack_test', sourceId: 'psrc_test', modeId: '__profile_okf__', fileName: 'Candidate Resume',
    cards, entities: [], relations: [], indexMd: '',
    stats: { cardCount: cards.length, entityCount: 0, relationCount: 0, sourcePages: 0, sourceSections: 0, avgConfidence: 1, extractionMs: 1 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso(),
  };
  const files = exportPack(pack, { sourceFileId: 'resume', sourceFileName: 'Candidate Resume', bundleDirOverride: 'candidate' });
  const result = checkConformance(files);
  assert.ok(result.conformant, `bundle conformant (violations: ${JSON.stringify(result.violations)})`);
  // Every concept file carries a type line.
  for (const f of files.filter((x) => !/(^|\/)(index|log)\.md$/.test(x.path))) {
    assert.match(f.content, /\ntype: /, `${f.path} has a type field`);
  }
});
