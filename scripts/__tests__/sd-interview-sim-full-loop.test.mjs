// scripts/__tests__/sd-interview-sim-full-loop.test.mjs
// SPEC 08 — turn default, driver continue/advance, LESSON ingest gates, tone.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const {
  DEFAULT_LIVE_MAX_TURNS,
  isNonspecificInterviewerText,
  createThinCandidateAgent,
} = require('../lib/sd-interview-sim/t2.js');
const {
  CASUAL_SD_TONE_INSTRUCTION,
  createLiveWhatToAnswerSut,
} = require('../lib/sd-interview-sim/liveSut.js');
const {
  resolveLessonsDir,
  shouldIngestLessonsForT2,
  walkLessonFiles,
} = require('../lib/sd-interview-sim/lessonIngest.js');

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('sd-interview-sim SPEC 08 full-loop defaults', () => {
  test('DEFAULT_LIVE_MAX_TURNS is at least 30', () => {
    assert.ok(DEFAULT_LIVE_MAX_TURNS >= 30);
    assert.equal(DEFAULT_LIVE_MAX_TURNS, 32);
  });

  test('CASUAL_SD_TONE_INSTRUCTION mentions Delivery Framework and casual we', () => {
    assert.match(CASUAL_SD_TONE_INSTRUCTION, /Delivery Framework/i);
    assert.match(CASUAL_SD_TONE_INSTRUCTION, /\bwe\b/i);
    assert.match(CASUAL_SD_TONE_INSTRUCTION, /casual/i);
  });
});

describe('sd-interview-sim nonspecific interviewer', () => {
  test('detects continue cues', () => {
    assert.equal(isNonspecificInterviewerText('continue'), true);
    assert.equal(isNonspecificInterviewerText('Go on'), true);
    assert.equal(isNonspecificInterviewerText('ok'), true);
    assert.equal(isNonspecificInterviewerText(''), true);
  });

  test('rejects specific probes', () => {
    assert.equal(
      isNonspecificInterviewerText('What is peak QPS and p99 latency for redirects?'),
      false,
    );
  });
});

describe('sd-interview-sim thin driver continue/advance', () => {
  test('emits advance once when checklist complete and gate visible', async () => {
    const decisions = [];
    const agent = createThinCandidateAgent({
      onDecision: (d) => decisions.push(d.action),
      getGateStatus: () => ({ checklistComplete: true, visible: true }),
    });
    const first = await agent({ interviewerTurn: { text: 'Looks good, anything else?' } });
    const second = await agent({ interviewerTurn: { text: 'Looks good, anything else?' } });
    assert.equal(first.action, 'advance');
    assert.equal(second.action, 'trigger');
    assert.deepEqual(decisions, ['advance', 'trigger']);
    assert.equal(first.text, undefined);
  });

  test('emits continue on nonspecific interviewer text', async () => {
    const agent = createThinCandidateAgent({
      getGateStatus: () => ({ checklistComplete: false, visible: true }),
    });
    const d = await agent({ interviewerTurn: { text: 'continue' } });
    assert.equal(d.action, 'continue');
  });

  test('emits trigger on specific probe', async () => {
    const agent = createThinCandidateAgent();
    const d = await agent({
      interviewerTurn: { text: 'How do you shard the URL mapping table?' },
    });
    assert.equal(d.action, 'trigger');
  });
});

describe('sd-interview-sim live SUT tone + advance flag', () => {
  test('passes casual promptInstruction and sdRequirementsUiAdvance on advance', async () => {
    const calls = [];
    const im = {
      async runWhatShouldISay(_q, _c, _img, options) {
        calls.push(options);
        return '## Requirements\n- we shorten URLs\n';
      },
    };
    const sut = createLiveWhatToAnswerSut({ intelligenceManager: im });
    const out = await sut({
      interviewerTurn: { text: 'advance please' },
      candidateAction: 'advance',
    });
    assert.match(out.meta.promptInstruction, /casual/i);
    assert.equal(out.meta.sdRequirementsUiAdvance, true);
    assert.equal(calls[0].sdRequirementsUiAdvance, true);
    assert.match(calls[0].promptInstruction, /Delivery Framework/i);
  });
});

describe('sd-interview-sim LESSON ingest helpers', () => {
  test('shouldIngestLessonsForT2 defaults on; opt-out with 0', () => {
    assert.equal(shouldIngestLessonsForT2({}), true);
    assert.equal(shouldIngestLessonsForT2({ SD_INTERVIEW_SIM_T2_INGEST_LESSONS: '0' }), false);
  });

  test('resolveLessonsDir finds fixtures or repo lessons when present', () => {
    const dir = resolveLessonsDir({ repoRoot, env: {} });
    // Either full corpus or fixtures may exist in this checkout.
    if (dir) {
      assert.ok(fs.existsSync(dir));
      const files = walkLessonFiles(dir);
      assert.ok(Array.isArray(files));
    } else {
      assert.equal(dir, null);
    }
  });

  test('walkLessonFiles returns md/txt under a temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-lesson-'));
    fs.writeFileSync(path.join(tmp, 'a.md'), '# hi');
    fs.writeFileSync(path.join(tmp, 'README.md'), 'skip');
    const files = walkLessonFiles(tmp);
    assert.equal(files.length, 1);
    assert.match(files[0], /a\.md$/);
  });
});
