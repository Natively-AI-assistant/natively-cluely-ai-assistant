// electron/llm/__tests__/SdDeepDiveContextPackTier0.test.mjs
//
// SPEC 06 — SD context pack budgets: floor vs adaptive, eviction, excludes.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdDeepDiveContextPackTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const packMod = await import(
  pathToFileURL(path.join(distLlm, 'sdDeepDiveContextPack.js')).href
);

function makeSheet(overrides = {}) {
  return {
    problemKey: 'url-shortener',
    coverageGaps: {
      entities: { uncovered: false },
      api: { uncovered: true },
      hld: { uncovered: true },
      deep_dive_topics: { uncovered: true },
    },
    committed: [
      {
        id: 'c1',
        section: 'entities',
        text: 'URL maps to a short code via Base62.',
        fillSource: 'speech',
        status: 'committed',
        updatedAt: 1,
      },
    ],
    updatedAt: 1,
    schemaVersion: 1,
    ...overrides,
  };
}

describe('SD context pack floor (SPEC 06)', () => {
  test('floor always includes sheet + latest interviewer when provided', () => {
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'How would you handle hot keys?',
    });

    assert.ok(result.blocks.designSheet, 'design sheet block present');
    assert.match(result.blocks.designSheet, /URL maps to a short code/);
    assert.ok(result.blocks.latestInterviewer, 'latest interviewer block present');
    assert.match(result.blocks.latestInterviewer, /hot keys/);
    assert.match(result.pack, /URL maps to a short code/);
    assert.match(result.pack, /hot keys/);
  });

  test('LESSON included only when chunks present', () => {
    const without = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'Continue.',
      lessonChunks: [],
    });
    assert.equal(without.blocks.lesson, null);
    assert.doesNotMatch(without.pack, /<reference_file\b/);

    const withChunks = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'Continue.',
      lessonChunks: [{ text: '## Potential Deep Dives\nHot-key sharding.' }],
    });
    assert.ok(withChunks.blocks.lesson);
    assert.match(withChunks.pack, /<reference_file\b/);
    assert.match(withChunks.pack, /Hot-key sharding/);
  });

  test('recent window capped at maxItems=3 and maxTotalChars=6000; out-of-window excluded', () => {
    const items = [
      { answerId: 'a1', capturedAt: 100, text: 'oldest answer about entities' },
      { answerId: 'a2', capturedAt: 200, text: 'mid answer about api' },
      { answerId: 'a3', capturedAt: 300, text: 'newer answer about hld' },
      { answerId: 'a4', capturedAt: 400, text: 'newest answer about deep dive' },
    ];
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'Continue.',
      recentSdAnswers: items,
    });
    assert.equal(result.meta.recentItemCount, 3);
    assert.match(result.pack, /newest answer about deep dive/);
    assert.match(result.pack, /newer answer about hld/);
    assert.match(result.pack, /mid answer about api/);
    assert.doesNotMatch(result.pack, /oldest answer about entities/);

    const fat = 'x'.repeat(2500);
    const charCapped = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'Continue.',
      recentSdAnswers: [
        { answerId: 'b1', capturedAt: 1, text: fat },
        { answerId: 'b2', capturedAt: 2, text: fat },
        { answerId: 'b3', capturedAt: 3, text: fat },
      ],
    });
    // 3 * 2500 = 7500 > 6000 → drop oldest until ≤6000
    assert.ok(charCapped.meta.recentItemCount <= 2);
    assert.match(charCapped.pack, /\[b3@/);
    assert.doesNotMatch(charCapped.pack, /\[b1@/);
    const recentBody = charCapped.blocks.recentSdAnswers || '';
    const textChars = (recentBody.match(/x+/g) || []).join('').length;
    assert.ok(textChars <= 6000, `recent text chars ${textChars} should be ≤6000`);
  });
});

describe('SD context pack overflow eviction (SPEC 06)', () => {
  test('adaptive dropped first on overflow while floor remains', () => {
    const sheetText = 'COMMIT'.repeat(200);
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet({
        committed: [{
          id: 'c1',
          section: 'entities',
          text: sheetText,
          fillSource: 'speech',
          status: 'committed',
          updatedAt: 1,
        }],
      }),
      latestInterviewer: 'Probe about caching.',
      lessonChunks: [{ text: '## Deep Dives\n' + 'CACHE'.repeat(100) }],
      recentSdAnswers: [
        { answerId: 'r1', capturedAt: 1, text: 'recent ' + 'R'.repeat(200) },
      ],
      adaptiveSlice: 'ADAPTIVE_MARKER ' + 'A'.repeat(4000),
      budgets: { maxTotalTokens: 800 },
    });

    assert.equal(result.blocks.adaptive, null);
    assert.equal(result.meta.droppedAdaptive, true);
    assert.doesNotMatch(result.pack, /ADAPTIVE_MARKER/);
    assert.ok(result.blocks.designSheet);
    assert.ok(result.blocks.latestInterviewer);
    assert.match(result.pack, /Probe about caching/);
  });

  test('eviction order: adaptive → truncate recent (oldest first) → truncate LESSON Understanding first; never drop sheet+utterance', () => {
    const utterance = 'LIVE_PROBE_ANCHOR how do you shard?';
    const understanding = {
      text: '## Understanding the Problem\nUNDERSTANDING_CHUNK ' + 'U'.repeat(800),
    };
    const deepDive = {
      text: '## Potential Deep Dives\nDEEP_DIVE_CHUNK ' + 'D'.repeat(800),
    };

    // Stage 1: only adaptive needs to go
    const stage1 = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: utterance,
      lessonChunks: [understanding, deepDive],
      recentSdAnswers: [
        { answerId: 'old', capturedAt: 1, text: 'OLD_RECENT ' + 'O'.repeat(400) },
        { answerId: 'new', capturedAt: 2, text: 'NEW_RECENT ' + 'N'.repeat(400) },
      ],
      adaptiveSlice: 'ADAPTIVE_ONLY ' + 'A'.repeat(2000),
      budgets: { maxTotalTokens: 900 },
    });
    assert.equal(stage1.meta.droppedAdaptive, true);
    assert.doesNotMatch(stage1.pack, /ADAPTIVE_ONLY/);
    assert.match(stage1.pack, /LIVE_PROBE_ANCHOR/);
    assert.match(stage1.pack, /URL maps to a short code/);

    // Stage 2: force recent truncate after adaptive gone (tight budget)
    const stage2 = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: utterance,
      lessonChunks: [deepDive],
      recentSdAnswers: [
        { answerId: 'old', capturedAt: 1, text: 'OLD_RECENT ' + 'O'.repeat(1200) },
        { answerId: 'new', capturedAt: 2, text: 'NEW_RECENT ' + 'N'.repeat(1200) },
      ],
      adaptiveSlice: 'ADAPTIVE_GONE ' + 'A'.repeat(800),
      budgets: { maxTotalTokens: 700 },
    });
    assert.equal(stage2.meta.droppedAdaptive, true);
    assert.equal(stage2.meta.truncatedRecent, true);
    assert.doesNotMatch(stage2.pack, /OLD_RECENT/);
    assert.match(stage2.pack, /NEW_RECENT|LIVE_PROBE_ANCHOR/);
    assert.match(stage2.pack, /LIVE_PROBE_ANCHOR/);
    assert.ok(stage2.blocks.designSheet);

    // Stage 3: LESSON Understanding evicted before Deep Dive; anchors survive
    const stage3 = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: utterance,
      lessonChunks: [understanding, deepDive],
      recentSdAnswers: [
        { answerId: 'only', capturedAt: 1, text: 'ONLY_RECENT ' + 'R'.repeat(2000) },
      ],
      adaptiveSlice: 'ADAPTIVE ' + 'A'.repeat(2000),
      budgets: { maxTotalTokens: 500 },
    });
    assert.equal(stage3.meta.droppedAdaptive, true);
    assert.ok(stage3.meta.truncatedLesson || stage3.meta.truncatedRecent);
    assert.doesNotMatch(stage3.pack, /UNDERSTANDING_CHUNK/);
    // Deep dive may survive longer than Understanding; anchors must remain
    assert.match(stage3.pack, /LIVE_PROBE_ANCHOR/);
    assert.ok(stage3.blocks.designSheet);
    assert.ok(stage3.blocks.latestInterviewer);
    // Never keep adaptive while dropping anchors
    assert.equal(stage3.blocks.adaptive, null);
  });

  test('LESSON truncate prefers Understanding over Deep Dive when both compete', () => {
    // Floor anchors small; no recent; two fat LESSON chunks; budget fits only one.
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'LIVE_PROBE',
      lessonChunks: [
        { text: '## Understanding the Problem\nUNDERSTANDING_KEEP_OR_DROP ' + 'U'.repeat(2000) },
        { text: '## Potential Deep Dives\nDEEP_DIVE_SHOULD_SURVIVE ' + 'D'.repeat(2000) },
      ],
      budgets: { maxTotalTokens: 600 },
    });
    assert.equal(result.meta.truncatedLesson, true);
    assert.doesNotMatch(result.pack, /UNDERSTANDING_KEEP_OR_DROP/);
    assert.match(result.pack, /DEEP_DIVE_SHOULD_SURVIVE/);
    assert.match(result.pack, /LIVE_PROBE/);
    assert.ok(result.blocks.designSheet);
  });
});

describe('SD context pack hard cap & excludes (SPEC 06)', () => {
  test('assembled pack stays within ~8–12k token hard band under default budgets', () => {
    const fatChunk = (label) => ({
      text: `## ${label}\n` + 'Z'.repeat(3000),
    });
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet({
        committed: Array.from({ length: 20 }, (_, i) => ({
          id: `c${i}`,
          section: 'entities',
          text: 'commitment text ' + 'C'.repeat(180),
          fillSource: 'speech',
          status: 'committed',
          updatedAt: i,
        })),
      }),
      latestInterviewer: 'I'.repeat(400),
      lessonChunks: [
        fatChunk('Understanding the Problem'),
        fatChunk('Potential Deep Dives'),
        fatChunk('Non-Functional Requirements'),
        fatChunk('Deep Dives'),
        fatChunk('Scalability'),
        fatChunk('Extra Should Cap'), // k≤5 → excluded
      ],
      recentSdAnswers: [
        { answerId: 'r1', capturedAt: 1, text: 'R'.repeat(2000) },
        { answerId: 'r2', capturedAt: 2, text: 'R'.repeat(2000) },
        { answerId: 'r3', capturedAt: 3, text: 'R'.repeat(2000) },
      ],
      adaptiveSlice: 'ADAPT ' + 'A'.repeat(8000),
    });

    assert.ok(
      result.meta.tokenEstimate <= packMod.SD_CONTEXT_PACK_HARD_CAP_TOKENS,
      `tokenEstimate ${result.meta.tokenEstimate} exceeds hard cap`,
    );
    assert.ok(result.meta.lessonChunkCount <= 5);
    assert.ok(result.meta.recentItemCount <= 3);
  });

  test('full transcript never present even when passed; unset sdPhase still builds post-gate pack', () => {
    const transcriptMarker = 'FULL_MEETING_TRANSCRIPT_SHOULD_NEVER_APPEAR ' + 'T'.repeat(500);
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'What about consistency?',
      lessonChunks: [{ text: '## Deep Dives\nQuorum reads.' }],
      recentSdAnswers: [
        { answerId: 'r1', capturedAt: 1, text: 'We use quorum.' },
      ],
      adaptiveSlice: 'extra probe nfr',
      transcript: transcriptMarker,
      sdPhase: null, // unset/legacy → post-gate pack (builder always assembles when called)
    });

    assert.doesNotMatch(result.pack, /FULL_MEETING_TRANSCRIPT_SHOULD_NEVER_APPEAR/);
    assert.ok(result.blocks.designSheet);
    assert.ok(result.blocks.latestInterviewer);
    assert.ok(result.blocks.lesson);
    assert.ok(result.blocks.recentSdAnswers);
    assert.ok(result.blocks.adaptive);
  });

  test('WTA inject budget keeps pack under retrievedModeContext default (floor survives)', () => {
    const fat = (label) => ({ text: `## ${label}\n` + 'X'.repeat(2500) });
    const result = packMod.buildSdDeepDiveContextPack({
      sheet: makeSheet(),
      latestInterviewer: 'Probe the cache.',
      lessonChunks: [
        fat('Understanding the Problem'),
        fat('Potential Deep Dives'),
        fat('Non-Functional Requirements'),
        fat('Deep Dives'),
        fat('Scalability'),
      ],
      recentSdAnswers: [
        { answerId: 'r1', capturedAt: 1, text: 'R'.repeat(3000) },
        { answerId: 'r2', capturedAt: 2, text: 'R'.repeat(3000) },
        { answerId: 'r3', capturedAt: 3, text: 'R'.repeat(3000) },
      ],
      adaptiveSlice: 'ADAPT ' + 'A'.repeat(8000),
      budgets: { maxTotalTokens: packMod.SD_CONTEXT_PACK_WTA_INJECT_MAX_TOKENS },
    });

    assert.ok(
      result.meta.tokenEstimate <= packMod.SD_CONTEXT_PACK_WTA_INJECT_MAX_TOKENS,
      `tokenEstimate ${result.meta.tokenEstimate} exceeds WTA inject cap`,
    );
    assert.ok(result.blocks.designSheet, 'sheet floor must survive');
    assert.ok(result.blocks.latestInterviewer, 'utterance floor must survive');
    assert.match(result.pack, /<design_sheet>/);
    assert.match(result.pack, /<latest_interviewer>/);
  });
});
