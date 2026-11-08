// electron/llm/__tests__/LongMeetingTranscriptKept2026_10_15.test.mjs
//
// Reported 2026-10-15 (Windows, 2.9.2): a 187-minute meeting was saved with
// only its last ~73 minutes of transcript. SessionTracker.compactTranscriptIfNeeded
// drops the oldest 500 segments of `fullTranscript` every time it passes 1800,
// to keep the prompt context small, and MeetingPersistence saved that same
// array to the database. Compaction is for the prompt; the saved meeting must
// keep every segment.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { SessionTracker } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js')).href
);

const settle = () => new Promise((r) => setImmediate(r));

async function feed(tracker, count, startMs) {
  for (let i = 0; i < count; i++) {
    tracker.addTranscript({
      speaker: i % 2 ? 'user' : 'interviewer',
      text: `line ${i}`,
      timestamp: startMs + i * 2000,
      final: true,
      confidence: 1,
      origin: 'stt',
    });
    // Let each compaction finish (no recap LLM → it resolves at once).
    await settle();
  }
}

describe('long meeting: compaction never shortens the saved transcript', () => {
  test('3,000 segments in → 3,000 segments to persist, oldest first', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 3000, Date.now() - 6_000_000);

    // Nothing is compacted any more (2026-10-15): the assistant's view is whole too.
    assert.equal(tracker.getFullTranscript().length, 3000);

    const kept = tracker.getPersistableTranscript();
    assert.equal(kept.length, 3000);
    assert.equal(kept[0].text, 'line 0');
    assert.equal(kept[2999].text, 'line 2999');
  });

  test('assistant answers are kept for persistence as well', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 1900, Date.now() - 4_000_000);
    tracker.addAssistantMessage('An answer the user saw.');
    await settle();
    const kept = tracker.getPersistableTranscript();
    assert.equal(kept.length, 1901);
    assert.equal(kept[0].text, 'line 0');
    assert.equal(kept[1900].speaker, 'assistant');
  });

  test('reset() clears the persisted copy with the session', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 10, Date.now());
    tracker.reset();
    assert.equal(tracker.getPersistableTranscript().length, 0);
  });
});

describe('long meeting: the assistant reads past compaction too', () => {
  test('recall and retrieval see the oldest lines', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 3000, Date.now() - 3000 * 2000);
    const durable = tracker.getDurableContext(Infinity);
    assert.equal(durable.length, 3000);
    assert.equal(durable[0].text, 'line 0');
    assert.equal(tracker.getRetrievalTranscript().length, 3000);
  });

  test('retrieval keeps the newest 6,000 lines of a very long meeting', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 6500, Date.now() - 6500 * 2000);
    const seen = tracker.getRetrievalTranscript();
    assert.equal(seen.length, 6000);
    assert.equal(seen[0].text, 'line 500');
    assert.equal(tracker.getPersistableTranscript().length, 6500, 'the saved meeting still has every line');
  });

  test('the reset shortcut mid-meeting: the assistant forgets, the saved meeting does not', async () => {
    const tracker = new SessionTracker();
    await feed(tracker, 20, Date.now() - 60_000);
    tracker.reset({ keepMeetingRecord: true });
    await feed(tracker, 3, Date.now());
    assert.equal(tracker.getDurableContext(Infinity).length, 3);
    assert.equal(tracker.getRetrievalTranscript().length, 3);
    assert.equal(tracker.getPersistableTranscript().length, 23);
  });

  test('past 500 AI answers the assistant keeps the newest 500; the saved meeting keeps all', () => {
    const tracker = new SessionTracker();
    for (let i = 0; i < 620; i++) tracker.logUsage('chat', `q${i}`, `a${i}`);
    assert.equal(tracker.getFullUsage().length, 500);
    const kept = tracker.getPersistableUsage();
    assert.equal(kept.length, 620);
    assert.equal(kept[0].question, 'q0');
    assert.equal(kept[619].question, 'q619');
  });

  test('the 2-hour window keeps only recent lines, found from the end, tolerating slightly out-of-order times', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    const add = (ts, text) => tracker.addTranscript({ speaker: 'interviewer', text, timestamp: ts, final: true, confidence: 1, origin: 'stt' });
    for (let i = 0; i < 1000; i++) add(now - 3 * 3600_000 + i * 1000, `old ${i}`); // three hours ago
    add(now - 60_000, 'recent a');
    add(now - 7300_000, 'late-arriving old line'); // out of order, older than the window
    add(now - 30_000, 'recent b');
    const texts = tracker.getDurableContext(7200).map(i => i.text);
    assert.deepEqual(texts, ['recent a', 'recent b']);
  });

  test('a diagram repaired after the reset shortcut reaches the saved answer and line', () => {
    const tracker = new SessionTracker();
    const broken = 'graph TD\n  A-->';
    tracker.addAssistantMessage('Here:\n```mermaid\n' + broken + '\n```');
    tracker.logUsage('chat', 'draw it', 'Here:\n```mermaid\n' + broken + '\n```');
    tracker.reset({ keepMeetingRecord: true });
    assert.equal(tracker.applyDiagramRepair(broken, 'graph TD\n  A-->B'), true);
    assert.ok(tracker.getPersistableUsage()[0].answer.includes('A-->B'));
    assert.ok(tracker.getPersistableTranscript().at(-1).text.includes('A-->B'));
  });

  test('archived screenshot previews are bounded: the oldest lose previews, keep text', () => {
    const tracker = new SessionTracker();
    SessionTracker.MAX_ARCHIVED_IMAGE_CHARS = 2500; // test-sized budget
    try {
      const img = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
      for (let i = 0; i < 4; i++) tracker.pushUsage({ type: 'assist', timestamp: Date.now(), question: `q${i}`, answer: `a${i}`, images: [img] });
      tracker.reset({ keepMeetingRecord: true }); // all four move to the archive
      const kept = tracker.getPersistableUsage();
      assert.equal(kept.length, 4);
      assert.deepEqual(kept.map(u => u.question), ['q0', 'q1', 'q2', 'q3']);
      assert.deepEqual(kept.map(u => Array.isArray(u.images)), [false, false, true, true]);
    } finally {
      SessionTracker.MAX_ARCHIVED_IMAGE_CHARS = 64 * 1024 * 1024;
    }
  });
});
