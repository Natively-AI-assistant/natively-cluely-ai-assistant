// No real meeting ever had a searchable summary (2026-10-04): indexing ran the
// moment a meeting ended, before its notes existed, found no summary, logged
// "skipping" and marked the queue row completed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { buildSummaryTextForSearch, SUMMARY_TEXT_MAX_CHARS } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/summaryTextForSearch.js')).href);
const { isSpokenSavedLine, encodeSavedOrigin, decodeSavedOrigin } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/intelligence/savedTranscriptOrigin.js')).href);
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

describe('the text that is embedded for a meeting', () => {
  test('notes in the sections format are not empty', () => {
    // The shape the notes pipeline saves: tldr mirrored into keyPoints, no legacy overview-only.
    const text = buildSummaryTextForSearch({
      overview: 'The team agreed the launch date.',
      tldr: ['Launch moves to Friday'],
      keyPoints: ['Launch moves to Friday'],
      sections: [{ title: 'Decisions', bullets: ['Ship behind a flag', 'QA signs off Thursday'] }],
      actionItems: ['Priya sends the checklist'],
    });
    assert.equal(text, 'The team agreed the launch date. Launch moves to Friday. Ship behind a flag. QA signs off Thursday. Action: Priya sends the checklist.');
  });

  test('older notes with only key points and action items still work', () => {
    assert.equal(buildSummaryTextForSearch({ keyPoints: ['Budget approved'], actionItems: ['Send invoice'] }), 'Budget approved. Action: Send invoice.');
  });

  test('nothing to say means no summary row', () => {
    assert.equal(buildSummaryTextForSearch({ actionItems: [], keyPoints: [] }), '');
    assert.equal(buildSummaryTextForSearch(null, 'See detailed summary'), '');
    assert.equal(buildSummaryTextForSearch(undefined, ''), '');
  });

  test("the placeholder row's text is not a summary", () => {
    // What the meeting looks like at meeting end, while the notes are written.
    assert.equal(buildSummaryTextForSearch({ actionItems: [], keyPoints: [] }, 'Generating summary...'), '');
    assert.equal(buildSummaryTextForSearch(undefined, 'Processing...'), '');
    assert.equal(buildSummaryTextForSearch(undefined, 'Generating summary…'), '');
  });

  test('a meeting with only the old summary string uses it', () => {
    assert.equal(buildSummaryTextForSearch(undefined, 'Talked about hiring.'), 'Talked about hiring.');
  });

  test('the text is capped', () => {
    const long = buildSummaryTextForSearch({ keyPoints: Array.from({ length: 400 }, (_, i) => `Point number ${i} about the roadmap`) });
    assert.ok(long.length <= SUMMARY_TEXT_MAX_CHARS);
  });
});

describe('which saved lines are meeting speech', () => {
  test('with an origin, only speech', () => {
    assert.equal(isSpokenSavedLine({ speaker: 'user', origin: 'stt' }), true);
    assert.equal(isSpokenSavedLine({ speaker: 'interviewer', origin: 'stt' }), true);
    assert.equal(isSpokenSavedLine({ speaker: 'user', origin: 'manual_chat' }), false);
    assert.equal(isSpokenSavedLine({ speaker: 'assistant', origin: 'assistant' }), false);
    assert.equal(isSpokenSavedLine({ speaker: 'user', origin: 'system_instruction' }), false);
  });

  test('an older meeting keeps every line except the assistant\'s', () => {
    assert.equal(isSpokenSavedLine({ speaker: 'user' }), true);
    assert.equal(isSpokenSavedLine({ speaker: 'interviewer' }), true);
    assert.equal(isSpokenSavedLine({ speaker: 'assistant' }), false);
    assert.equal(isSpokenSavedLine(null), false);
  });

  test('the session that was indexed as four segments, three of them the assistant\'s', () => {
    const rows = [
      { speaker: 'user', text: 'hi', origin: 'manual_chat' },
      { speaker: 'assistant', text: 'Hi, how can I help?', origin: 'assistant', chatReply: true },
      { speaker: 'user', text: 'what model are you ?', origin: 'manual_chat' },
      { speaker: 'assistant', text: "I'm Natively, an AI assistant.", origin: 'assistant', chatReply: true },
      { speaker: 'user', text: 'Name.', origin: 'stt' },
    ];
    assert.deepEqual(rows.filter(isSpokenSavedLine).map(r => r.text), ['Name.']);
  });

  test('the stored form round-trips', () => {
    assert.equal(encodeSavedOrigin({ origin: 'assistant', chatReply: true }), 'assistant_chat');
    assert.deepEqual(decodeSavedOrigin('assistant_chat'), { origin: 'assistant', chatReply: true });
    assert.equal(encodeSavedOrigin({ origin: 'stt' }), 'stt');
    assert.equal(encodeSavedOrigin({ origin: 'nope' }), null);
    assert.equal(encodeSavedOrigin({}), null);
    assert.deepEqual(decodeSavedOrigin(null), {});
    assert.deepEqual(decodeSavedOrigin('nope'), {});
  });
});

describe('wiring', () => {
  test('the summary is indexed when the notes are saved, and after a regenerate', () => {
    const persistence = read('electron/MeetingPersistence.ts');
    assert.match(persistence, /meetingSaved = true;\s*if \(generationSucceeded\) this\.notifyNotesSaved\(meetingId\);/);
    assert.match(persistence, /if \(ok\) this\.notifyNotesSaved\(meetingId\);/);
    const main = read('electron/main.ts');
    assert.match(main, /setMeetingNotesSavedListener\?\.\(\(meetingId: string\) => \{[\s\S]{0,200}rag\.indexMeetingSummary\(meetingId\)/);
  });

  test('a meeting with no summary yet gets no summary queue row', () => {
    const pipeline = read('electron/rag/EmbeddingPipeline.ts');
    const queueMeeting = pipeline.slice(pipeline.indexOf('async queueMeeting('), pipeline.indexOf('private enqueueSummaryRowIfNeeded('));
    assert.ok(!/insert\.run\(meetingId, null\)/.test(queueMeeting), 'the unconditional summary row is gone');
    assert.match(queueMeeting, /this\.enqueueSummaryRowIfNeeded\(meetingId\)/);
    assert.match(pipeline, /SELECT 1 FROM chunk_summaries WHERE meeting_id = \? AND embedding IS NULL/);
  });

  test('saving a summary keeps its row id', () => {
    const store = read('electron/rag/VectorStore.ts');
    const body = store.slice(store.indexOf('saveSummary(meetingId: string, summaryText: string)'));
    assert.match(body.slice(0, 1800), /ON CONFLICT\(meeting_id\) DO UPDATE SET/);
    assert.ok(!/INSERT OR REPLACE INTO chunk_summaries/.test(store), 'REPLACE would orphan the old vector');
  });

  test('both indexing paths index speech only and share one summary builder', () => {
    for (const file of ['electron/main.ts', 'electron/rag/RAGManager.ts']) {
      const src = read(file);
      assert.match(src, /transcript\.filter\(isSpokenSavedLine\)\.map\(/, `${file} filters before mapping`);
      assert.match(src, /buildSummaryTextForSearch\(meeting\.detailedSummary, meeting\.summary\)/, `${file} uses the shared builder`);
    }
  });

  test('indexing a meeting a second time replaces its chunks instead of doubling them', () => {
    const src = read('electron/rag/RAGManager.ts');
    const body = src.slice(src.indexOf('async processMeeting('), src.indexOf('// 4. Save summary if provided'));
    const del = body.indexOf('this.vectorStore.deleteChunksForMeeting(meetingId);');
    const save = body.indexOf('this.vectorStore.saveChunks(chunks);');
    assert.ok(del > 0 && save > del, 'existing chunks are removed before the new ones are saved');
    assert.match(body, /DELETE FROM embedding_queue WHERE meeting_id = \? AND chunk_id IS NOT NULL/);
  });

  test('an embed that finishes after the summary changed is dropped and queued again', () => {
    const pipeline = read('electron/rag/EmbeddingPipeline.ts');
    const body = pipeline.slice(pipeline.indexOf('private async embedMeetingSummary('));
    const embed = body.indexOf('await this.embedWithTimeout(p, row.summary_text');
    const recheck = body.indexOf('current.summary_text !== row.summary_text');
    const store = body.indexOf('this.vectorStore.storeSummaryEmbedding(meetingId, embedding);');
    assert.ok(embed > 0 && recheck > embed && store > recheck, 'the text is re-read after the embed call and before the store');
  });

  test('the backfill examines each meeting once and yields between meetings', () => {
    const src = read('electron/rag/RAGManager.ts');
    const body = src.slice(src.indexOf('async backfillMeetingSummaries('), src.indexOf('* Ensure demo meeting is processed'));
    assert.match(body, /summary_backfill_cursor_v1/);
    assert.match(body, /if \(stored === 'done'\) return 0;/);
    assert.match(body, /WHERE m\.rowid < \?/);
    assert.match(body, /await new Promise<void>\(resolve => setImmediate\(resolve\)\);/);
    assert.match(body, /if \(reachedEnd\) saveCursor\.run\(CURSOR_KEY, 'done'\);/);
  });

  test('the launch backfill runs beside the demo-meeting check', () => {
    assert.match(read('electron/ProcessingHelper.ts'), /ragManager\.backfillMeetingSummaries\(\)\.catch\(console\.error\);/);
  });
});
