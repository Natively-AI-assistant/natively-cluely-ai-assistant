// Pattern H (deep-run 2 issue 11, 2026-08-01).
//
// Live evidence: a session that started "WITHOUT audio capture" — guaranteed
// empty STT transcript — still ran generateMeetingSummary on 3,297 chars of
// manual chat and queued 30 chunks + 1 summary for embedding, then retained
// the chat-derived summary into Hindsight. Separately, EmbeddingPipeline's
// drain loop had no stop hook, so an in-flight embed could resume after
// before-quit closed the shared better-sqlite3 handle and write into a
// closed (or emergency-closed, uncheckpointed) database.
//
// Wiring is pinned by source assertion (the repo's established pattern for
// MeetingPersistence, which cannot be constructed without Electron); the
// eligibility predicate and the embedding stop hook are exercised against the
// compiled modules.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const dist = (rel) => pathToFileURL(path.join(repoRoot, 'dist-electron/electron', rel)).href;

describe('zero-eligible finalization wiring', () => {
  test('stopMeeting computes memoryEligibleCount at the snapshot, where origin still exists', () => {
    const src = read('electron/MeetingPersistence.ts');
    assert.match(src, /isMemoryEligibleSegment/);
    assert.match(src, /memoryEligibleCount,\s*\n\s*\};/m, 'the snapshot must carry the count');
    assert.match(src, /return \{ meetingId, memoryEligibleCount \};/,
      'the caller needs the count to skip the provenance-blind RAG step');
  });

  test('processAndSaveMeeting early-exits before any LLM call on zero eligible segments', () => {
    const src = read('electron/MeetingPersistence.ts');
    const exitIdx = src.indexOf('ZERO-ELIGIBLE EARLY EXIT');
    const titleIdx = src.indexOf('generateMeetingSummary(titlePrompt');
    assert.ok(exitIdx !== -1, 'early exit block missing');
    assert.ok(titleIdx !== -1, 'title call site moved — re-verify ordering');
    assert.ok(exitIdx < titleIdx, 'the exit must run BEFORE the title LLM call');
    assert.match(src, /NO_MEMORY_ELIGIBLE_TRANSCRIPT/);
    assert.match(src, /summaryStatus: 'completed'/,
      'a skipped session must not surface as a failed summary');
  });

  test('main.ts skips meeting RAG for zero-eligible sessions', () => {
    const src = read('electron/main.ts');
    assert.match(src, /stopResult\?\.memoryEligibleCount \?\? 1\) > 0/,
      'RAG must be gated on eligibility (fail-open when absent)');
  });
});

describe('eligibility predicate matches the live zero-audio session shape', () => {
  test('manual chat + assistant answers yield zero eligible segments; stt is eligible', async () => {
    const { isMemoryEligibleSegment } = await import(dist('intelligence/MeetingMemoryService.js'));
    const zeroAudioSession = [
      { speaker: 'user', text: 'What is the meeting objective?', origin: 'manual_chat' },
      { speaker: 'AI Assistant', text: 'The objective is…', origin: 'assistant', confidence: 1.0 },
      { speaker: 'user', text: 'What did we decide?', origin: 'manual_chat' },
    ];
    assert.equal(zeroAudioSession.filter((s) => isMemoryEligibleSegment(s)).length, 0);
    assert.equal(isMemoryEligibleSegment({ speaker: 'Alice', text: 'Ship it Friday.', origin: 'stt', confidence: 0.92 }), true);
  });
});

describe('embedding pipeline stop hook', () => {
  test('RAGManager.dispose stops the pipeline before the DB handle can close', () => {
    const src = read('electron/rag/RAGManager.ts');
    assert.match(src, /this\.embeddingPipeline\.stop\(\)/);
    // Ordering inside dispose: stop() before vectorStore.destroy().
    const d = src.slice(src.indexOf('async dispose('));
    assert.ok(d.indexOf('embeddingPipeline.stop()') < d.indexOf('vectorStore.destroy()'));
  });

  test('a stopped pipeline refuses new work and never touches the database', async () => {
    const { EmbeddingPipeline } = await import(dist('rag/EmbeddingPipeline.js'));
    let dbTouched = 0;
    const explodingDb = { prepare: () => { dbTouched++; throw new Error('db must not be touched after stop'); } };
    const explodingStore = { getChunksWithoutEmbeddings: () => { dbTouched++; throw new Error('store must not be read after stop'); } };
    const p = new EmbeddingPipeline(explodingDb, explodingStore);
    p.stop();
    await p.processQueue();          // would prepare() the stuck-item reset if not guarded
    await p.queueMeeting('m-1');     // would read the vector store if not guarded
    assert.equal(dbTouched, 0, 'stopped pipeline performed DB/store access');
  });

  test('the drain loop checks stopped after every await before writing', () => {
    const src = read('electron/rag/EmbeddingPipeline.ts');
    assert.match(src, /await ForegroundGate\.waitUntilIdle\(\);\s*\n\s*if \(this\.stopped\) break;/);
    assert.match(src, /if \(this\.stopped\) break;[\s\S]{0,400}status = 'completed'/,
      'the post-embed write must be guarded — the embed await can outlive shutdown');
  });
});
