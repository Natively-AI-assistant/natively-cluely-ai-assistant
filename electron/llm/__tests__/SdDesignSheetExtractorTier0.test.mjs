// electron/llm/__tests__/SdDesignSheetExtractorTier0.test.mjs
//
// SPEC 05: post-answer extract + merge / supersession / race / provisional.
// Pure seam — no IntelligenceEngine / WhatToAnswerLLM wiring.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdDesignSheetExtractorTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const extractor = await import(
  pathToFileURL(path.join(distLlm, 'sdDesignSheetExtractor.js')).href
);

const MEETING = 'meeting-1';
const PROBLEM = 'url-shortener';

function emptyState(problemKey = PROBLEM) {
  return {
    sheet: gate.createEmptySdDesignSheet(problemKey),
    recent: gate.createEmptyRecentSdAnswers(problemKey),
  };
}

describe('SdDesignSheetExtractor Tier0 (SPEC 05)', () => {
  test('merge after completed answer updates commitments by stable id', () => {
    const { sheet, recent } = emptyState();
    const result = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'Entities: URL and User map short codes to long URLs.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-1',
        commitments: [
          {
            id: 'entities:url',
            section: 'entities',
            text: 'URL maps short code to long URL',
            fillSource: 'speech',
          },
        ],
      },
    });

    assert.equal(result.discarded, false);
    const active = result.sheet.committed.filter((c) => c.status === 'committed');
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'entities:url');
    assert.equal(active[0].text, 'URL maps short code to long URL');
    assert.equal(active[0].section, 'entities');
  });

  test('revision supersedes prior commitment under same stable id', () => {
    const { sheet, recent } = emptyState();
    const first = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'Entities: store URL rows.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-1',
        commitments: [
          {
            id: 'entities:url',
            section: 'entities',
            text: 'URL table only',
            fillSource: 'speech',
          },
        ],
      },
    });

    const second = extractor.mergeExtractedAnswer({
      sheet: first.sheet,
      recent: first.recent,
      spokenText: 'Revised: URL and ClickEvent entities.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-2',
        commitments: [
          {
            id: 'entities:url',
            section: 'entities',
            text: 'URL + ClickEvent',
            fillSource: 'speech',
          },
        ],
      },
    });

    const sameId = second.sheet.committed.filter((c) => c.id === 'entities:url');
    assert.ok(sameId.length >= 2, 'prior + replacement both retained');
    const active = sameId.filter((c) => c.status === 'committed');
    const superseded = sameId.filter((c) => c.status === 'superseded');
    assert.equal(active.length, 1);
    assert.equal(active[0].text, 'URL + ClickEvent');
    assert.equal(superseded.length, 1);
    assert.equal(superseded[0].status, 'superseded');
    assert.equal(superseded[0].supersededById, 'entities:url');
    assert.ok(superseded[0].supersededReason);
  });

  test('race discard on problemKey or meetingId mismatch leaves prior state unchanged', () => {
    const { sheet, recent } = emptyState();
    const seeded = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'seed',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-seed',
        commitments: [
          {
            id: 'entities:url',
            section: 'entities',
            text: 'seeded URL',
            fillSource: 'speech',
          },
        ],
      },
    });

    const beforeCommitted = structuredClone(seeded.sheet.committed);
    const beforeRecent = structuredClone(seeded.recent);
    const withProv = extractor.startProvisional(seeded.sheet, 'ans-stale');

    const badProblem = extractor.mergeExtractedAnswer({
      sheet: withProv,
      recent: seeded.recent,
      spokenText: 'should not apply',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: 'other-problem',
      extracted: {
        answerId: 'ans-stale',
        commitments: [
          {
            id: 'entities:url',
            section: 'entities',
            text: 'stale overwrite',
            fillSource: 'speech',
          },
        ],
      },
    });
    assert.equal(badProblem.discarded, true);
    assert.deepEqual(badProblem.sheet.committed, beforeCommitted);
    assert.equal(badProblem.sheet.provisional, undefined);
    assert.deepEqual(badProblem.recent, beforeRecent);

    const badMeeting = extractor.mergeExtractedAnswer({
      sheet: seeded.sheet,
      recent: seeded.recent,
      spokenText: 'should not apply',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: 'meeting-other',
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-stale-2',
        commitments: [
          {
            id: 'api:create',
            section: 'api',
            text: 'POST /shorten',
            fillSource: 'speech',
          },
        ],
      },
    });
    assert.equal(badMeeting.discarded, true);
    assert.deepEqual(badMeeting.sheet.committed, beforeCommitted);
    assert.equal(badMeeting.recent.items.length, beforeRecent.items.length);
  });

  test('provisional flag set by startProvisional and cleared after successful merge', () => {
    const { sheet, recent } = emptyState();
    const withProv = extractor.startProvisional(sheet, 'ans-prov');
    assert.ok(withProv.provisional);
    assert.equal(withProv.provisional.answerId, 'ans-prov');
    assert.deepEqual(withProv.committed, []);

    const cleared = extractor.clearProvisional(withProv);
    assert.equal(cleared.provisional, undefined);

    const again = extractor.startProvisional(sheet, 'ans-merge');
    const merged = extractor.mergeExtractedAnswer({
      sheet: again,
      recent,
      spokenText: 'API: POST /shorten',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-merge',
        commitments: [
          {
            id: 'api:shorten',
            section: 'api',
            text: 'POST /shorten',
            fillSource: 'speech',
          },
        ],
      },
    });
    assert.equal(merged.discarded, false);
    assert.equal(merged.sheet.provisional, undefined);
    assert.equal(
      merged.sheet.committed.filter((c) => c.status === 'committed').length,
      1,
    );
  });

  test('recent window prepends by answerId and evicts over maxItems', () => {
    let { sheet, recent } = emptyState();
    // Ownership: maxItems=3; force small total so char eviction also exercises.
    recent = { ...recent, cap: { maxItems: 3, maxTotalChars: 6000 } };

    for (let i = 1; i <= 4; i += 1) {
      const r = extractor.mergeExtractedAnswer({
        sheet,
        recent,
        spokenText: `Answer number ${i} about design.`,
        meetingId: MEETING,
        problemKey: PROBLEM,
        currentMeetingId: MEETING,
        currentProblemKey: PROBLEM,
        extracted: {
          answerId: `ans-${i}`,
          commitments: i === 1
            ? [
                {
                  id: 'entities:url',
                  section: 'entities',
                  text: 'URL entity',
                  fillSource: 'speech',
                },
              ]
            : [],
        },
      });
      assert.equal(r.discarded, false);
      sheet = r.sheet;
      recent = r.recent;
    }

    assert.equal(recent.items.length, 3);
    assert.equal(recent.items[0].answerId, 'ans-4');
    assert.equal(recent.items[1].answerId, 'ans-3');
    assert.equal(recent.items[2].answerId, 'ans-2');
    assert.ok(!recent.items.some((x) => x.answerId === 'ans-1'));

    // Upsert same answerId does not duplicate.
    const upserted = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'Answer number 4 revised speech.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: { answerId: 'ans-4', commitments: [] },
    });
    assert.equal(upserted.recent.items.filter((x) => x.answerId === 'ans-4').length, 1);
    assert.equal(upserted.recent.items[0].text, 'Answer number 4 revised speech.');
  });

  test('coverage gaps flip uncovered→false when section covered', () => {
    const { sheet, recent } = emptyState();
    assert.equal(sheet.coverageGaps.api.uncovered, true);

    const result = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'API design for shorten.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-api',
        commitments: [
          {
            id: 'api:shorten',
            section: 'api',
            text: 'POST /shorten',
            fillSource: 'speech',
          },
        ],
        coveredSections: ['api'],
      },
    });

    assert.equal(result.sheet.coverageGaps.api.uncovered, false);
    assert.equal(result.sheet.coverageGaps.entities.uncovered, true);
    assert.equal(result.sheet.coverageGaps.hld.uncovered, true);
  });

  test('evidence-only: empty spoken text does not invent commitments', () => {
    const { sheet, recent } = emptyState();
    const result = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: '',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: { answerId: 'ans-empty' },
    });

    assert.equal(result.discarded, false);
    assert.deepEqual(result.sheet.committed, []);
    for (const id of ['entities', 'api', 'hld', 'deep_dive_topics']) {
      assert.equal(result.sheet.coverageGaps[id].uncovered, true);
    }
  });

  test('interviewer invalidation supersedes matching commitment without replacement', () => {
    const { sheet, recent } = emptyState();
    const seeded = extractor.mergeExtractedAnswer({
      sheet,
      recent,
      spokenText: 'Use Redis cache.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-1',
        commitments: [
          {
            id: 'hld:cache',
            section: 'hld',
            text: 'Redis cache',
            fillSource: 'speech',
          },
        ],
      },
    });

    const invalidated = extractor.mergeExtractedAnswer({
      sheet: seeded.sheet,
      recent: seeded.recent,
      spokenText: 'Interviewer said no Redis; drop cache tier.',
      meetingId: MEETING,
      problemKey: PROBLEM,
      currentMeetingId: MEETING,
      currentProblemKey: PROBLEM,
      extracted: {
        answerId: 'ans-2',
        commitments: [
          {
            id: 'hld:cache',
            section: 'hld',
            text: '',
            invalidate: true,
            supersededReason: 'interviewer rejected Redis',
          },
        ],
      },
    });

    const active = invalidated.sheet.committed.filter(
      (c) => c.id === 'hld:cache' && c.status === 'committed',
    );
    const superseded = invalidated.sheet.committed.filter(
      (c) => c.id === 'hld:cache' && c.status === 'superseded',
    );
    assert.equal(active.length, 0);
    assert.equal(superseded.length, 1);
    assert.match(superseded[0].supersededReason, /interviewer rejected/);
    assert.equal(invalidated.sheet.coverageGaps.hld.uncovered, true);
  });
});
