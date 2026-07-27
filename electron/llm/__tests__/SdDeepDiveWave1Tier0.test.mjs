// electron/llm/__tests__/SdDeepDiveWave1Tier0.test.mjs
//
// Wave 1: design-sheet schema, SessionTracker extension lifecycle helpers,
// and post-gate LESSON score-gate pure seams (SPECs 02/03/04).
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdDeepDiveWave1Tier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const scoreGate = await import(pathToFileURL(path.join(distLlm, 'sdLessonScoreGate.js')).href);

describe('Design sheet empty defaults / coverage / floor (SPEC 04)', () => {
  test('empty design sheet marks all four gaps uncovered with no commitments', () => {
    const sheet = gate.createEmptySdDesignSheet('url-shortener');
    assert.equal(sheet.problemKey, 'url-shortener');
    assert.equal(sheet.schemaVersion, 1);
    assert.deepEqual(sheet.committed, []);
    for (const id of ['entities', 'api', 'hld', 'deep_dive_topics']) {
      assert.equal(sheet.coverageGaps[id].uncovered, true, `${id} should start uncovered`);
    }
    const window = gate.createEmptyRecentSdAnswers('url-shortener');
    assert.equal(window.problemKey, 'url-shortener');
    assert.equal(window.schemaVersion, 1);
    assert.deepEqual(window.items, []);
    assert.equal(window.cap.maxItems, 3);
    assert.equal(window.cap.maxTotalChars, 1800);
  });

  test('continue selects first uncovered gap in entities → api → hld → deep_dive_topics', () => {
    const sheet = gate.createEmptySdDesignSheet('p');
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), 'entities');

    sheet.coverageGaps.entities.uncovered = false;
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), 'api');

    sheet.coverageGaps.api.uncovered = false;
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), 'hld');

    sheet.coverageGaps.hld.uncovered = false;
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), 'deep_dive_topics');

    sheet.coverageGaps.deep_dive_topics.uncovered = false;
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), null);
  });

  test('injectable floor includes only committed entries; superseded stay on sheet', () => {
    const now = 1_700_000_000_000;
    const sheet = gate.createEmptySdDesignSheet('p', now);
    sheet.committed = [
      {
        id: 'c1',
        section: 'entities',
        text: 'URL, User, Click',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: now,
      },
      {
        id: 'c0',
        section: 'entities',
        text: 'old Link entity',
        fillSource: 'assumption',
        status: 'superseded',
        supersededById: 'c1',
        supersededReason: 'interviewer rejected Link',
        updatedAt: now - 1,
      },
    ];
    sheet.coverageGaps = gate.coverageGapsFromCommitments(sheet.committed);

    assert.equal(sheet.coverageGaps.entities.uncovered, false);
    assert.equal(gate.selectNextUncoveredCoverageGap(sheet), 'api');

    const floor = gate.serializeDesignSheetFloor(sheet);
    assert.ok(floor.some((c) => c.id === 'c1' && c.text.includes('URL')));
    assert.ok(!floor.some((c) => c.id === 'c0'));
    assert.ok(!floor.some((c) => /old Link entity/.test(c.text)));
    // Sheet still retains superseded for audit
    assert.ok(sheet.committed.some((c) => c.id === 'c0' && c.status === 'superseded'));
  });
});

describe('Deep-dive extension merge / problemKey reset (SPEC 03)', () => {
  test('problemKey change resets designSheet and recentSdAnswers to empty defaults', () => {
    const prior = {
      ...gate.createEmptyRequirementsArtifact('problem-a'),
      designSheet: gate.createEmptySdDesignSheet('problem-a'),
      recentSdAnswers: gate.createEmptyRecentSdAnswers('problem-a'),
    };
    prior.designSheet.committed = [
      {
        id: 'x',
        section: 'api',
        text: 'POST /shorten',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 1,
      },
    ];
    prior.designSheet.coverageGaps = gate.coverageGapsFromCommitments(prior.designSheet.committed);
    prior.recentSdAnswers.items = [
      { answerId: 'a1', capturedAt: 1, text: 'prior answer text' },
    ];

    const prepared = gate.createEmptyRequirementsArtifact('problem-b');
    const merged = gate.mergeDeepDiveExtensionBeforeCheckpoint(prior, prepared);

    assert.equal(merged.problemKey, 'problem-b');
    assert.equal(merged.designSheet.problemKey, 'problem-b');
    assert.deepEqual(merged.designSheet.committed, []);
    assert.equal(merged.designSheet.coverageGaps.entities.uncovered, true);
    assert.equal(merged.recentSdAnswers.problemKey, 'problem-b');
    assert.deepEqual(merged.recentSdAnswers.items, []);
  });

  test('same problemKey merge-before-checkpoint preserves designSheet and recentSdAnswers', () => {
    const prior = {
      ...gate.createEmptyRequirementsArtifact('same'),
      designSheet: gate.createEmptySdDesignSheet('same'),
      recentSdAnswers: gate.createEmptyRecentSdAnswers('same'),
    };
    prior.designSheet.committed = [
      {
        id: 'keep',
        section: 'hld',
        text: 'CDN + Redis',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 9,
      },
    ];
    prior.recentSdAnswers.items = [
      { answerId: 'r1', capturedAt: 9, text: 'recent speech wins' },
    ];

    // Gate prepare returns gate-only shape (drops siblings) — merge must reattach.
    let prepared = gate.createEmptyRequirementsArtifact('same');
    prepared = gate.fillSlotFromInterviewer(prepared, 'scale_qps', '10k QPS');
    assert.equal(prepared.designSheet, undefined);

    const merged = gate.mergeDeepDiveExtensionBeforeCheckpoint(prior, prepared);
    assert.equal(merged.slots.scale_qps.filled, true);
    assert.equal(merged.designSheet.committed[0]?.id, 'keep');
    assert.equal(merged.recentSdAnswers.items[0]?.answerId, 'r1');
  });

  test('ensureSdDeepDiveExtension defaults missing siblings on legacy gate-only artifact', () => {
    const legacy = gate.createEmptyRequirementsArtifact('legacy');
    assert.equal(legacy.designSheet, undefined);
    const hydrated = gate.ensureSdDeepDiveExtension(legacy);
    assert.equal(hydrated.designSheet.problemKey, 'legacy');
    assert.deepEqual(hydrated.designSheet.committed, []);
    assert.equal(hydrated.recentSdAnswers.problemKey, 'legacy');
    assert.deepEqual(hydrated.recentSdAnswers.items, []);
  });
});

describe('Post-gate LESSON score gate (SPEC 02 helpers)', () => {
  const chunks = [
    { text: '## Potential Deep Dives\nBase62 tradeoffs.', similarity: 0.72 },
    { text: '## Understanding the Problem\nClarify the shortener.', similarity: 0.41 },
    { text: '## Functional Requirements\nCreate short links.', similarity: 0.55 },
    { text: '## Non-Functional Requirements\nLow latency.', similarity: 0.61 },
  ];

  test('post_requirements excludes similarity < 0.5', () => {
    const gated = scoreGate.applyScoreGate(chunks, 'post_requirements');
    assert.equal(gated.length, 3);
    assert.ok(gated.every((c) => c.similarity >= 0.5));
    assert.ok(!gated.some((c) => /Understanding the Problem/.test(c.text)));
  });

  test('requirements phase is identity for applyScoreGate', () => {
    const gated = scoreGate.applyScoreGate(chunks, 'requirements');
    assert.equal(gated.length, chunks.length);
    assert.deepEqual(gated, chunks);
  });

  test('all-weak scores yield empty list (omit path)', () => {
    const weak = [
      { text: '## Potential Deep Dives\nx', similarity: 0.3 },
      { text: '## Non-Functional Requirements\ny', similarity: 0.49 },
    ];
    const gated = scoreGate.applyScoreGate(weak, 'post_requirements');
    assert.deepEqual(gated, []);
  });

  test('post-gate preference orders Deep Dive / NFR ahead of FR without hard-excluding FR', () => {
    const strong = [
      { text: '## Functional Requirements\nCreate short links.', similarity: 0.7 },
      { text: '## Potential Deep Dives\nBase62 tradeoffs.', similarity: 0.7 },
      { text: '## Non-Functional Requirements\nLow latency.', similarity: 0.7 },
    ];
    const gated = scoreGate.applyScoreGate(strong, 'post_requirements');
    const ordered = scoreGate.preferDeepDiveSections(gated, 'post_requirements');
    assert.equal(ordered.length, 3);
    assert.match(ordered[0].text, /Deep Dives|Non-Functional/);
    assert.match(ordered[1].text, /Deep Dives|Non-Functional/);
    assert.match(ordered[2].text, /Functional Requirements/);
  });

  test('preferDeepDiveSections is identity under requirements (sibling path untouched)', () => {
    const out = scoreGate.preferDeepDiveSections(chunks, 'requirements');
    assert.deepEqual(out, chunks);
  });
});

describe('SessionTracker hydrate defaults deep-dive siblings', () => {
  test('bind restores gate-only checkpoint with empty sheet/window defaults', async () => {
    const distElectron = path.resolve(__dirname, '../../../dist-electron/electron');
    const { SessionTracker } = await import(
      pathToFileURL(path.join(distElectron, 'SessionTracker.js')).href
    );
    const session = new SessionTracker();
    const legacy = gate.createEmptyRequirementsArtifact('restored');
    session.bindSdRequirementsMeeting('meet-restore', () => legacy);
    const art = session.getSdRequirementsArtifact();
    assert.ok(art);
    assert.equal(art.problemKey, 'restored');
    assert.ok(art.designSheet);
    assert.deepEqual(art.designSheet.committed, []);
    assert.equal(art.designSheet.coverageGaps.entities.uncovered, true);
    assert.ok(art.recentSdAnswers);
    assert.deepEqual(art.recentSdAnswers.items, []);
  });

  test('setSdRequirementsArtifact defaults missing extension fields', async () => {
    const distElectron = path.resolve(__dirname, '../../../dist-electron/electron');
    const { SessionTracker } = await import(
      pathToFileURL(path.join(distElectron, 'SessionTracker.js')).href
    );
    const session = new SessionTracker();
    session.setSdRequirementsArtifact(gate.createEmptyRequirementsArtifact('set-me'));
    const art = session.getSdRequirementsArtifact();
    assert.equal(art.designSheet.problemKey, 'set-me');
    assert.equal(art.recentSdAnswers.problemKey, 'set-me');
  });
});
