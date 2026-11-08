// The meeting page's Ask reads a meeting that fits whole, and keeps general advice
// for general questions (2026-10-31, Natively vs Granola benchmark issues N2/N3):
// "What does Gareth need?" got "That didn't come up. Generally, ..." because
// retrieval sent only chunks that never say Gareth's name, while the notes named
// him eight times.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
//
// Pure logic plus an in-memory SQLite database; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'dist-electron/electron/rag');
const { buildWholeMeetingContext, loadWholeMeetingContext, notesAsText, WHOLE_MEETING_TOKEN_BUDGET } = await import(pathToFileURL(path.join(dist, 'wholeMeetingContext.js')).href);
const { buildRAGPrompt } = await import(pathToFileURL(path.join(dist, 'prompts.js')).href);
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const detailed = {
  overview: 'Priya and Gareth heard the Lumastudy seed pitch.',
  sectionsV3: [{ title: 'Investor asks', bullets: [{ text: 'Gareth: 18 months of monthly cohort data by November 9' }] }],
  actionItemsV3: [{ text: 'Send cohort data', owner: 'Me', deadline: 'November 9' }],
};
const chunks = [
  { text: 'ME: Thanks both for the time.', speaker: 'ME', startMs: 0, tokenCount: 10 },
  { text: 'THEM: I need 18 months of cohort data before I confirm a slot.', speaker: 'THEM', startMs: 60000, tokenCount: 20 },
];

test('a meeting that fits goes whole: notes that name the people, then every transcript line in order', () => {
  const ctx = buildWholeMeetingContext({ title: 'Lumastudy seed round with Priya and Gareth', detailed, chunks });
  assert.match(ctx, /^NOTES \(written from this meeting\):\nTitle: Lumastudy seed round with Priya and Gareth/);
  assert.match(ctx, /Gareth: 18 months of monthly cohort data by November 9/);
  assert.match(ctx, /Action items:\n- Me: Send cohort data \(by November 9\)/);
  assert.ok(ctx.indexOf('Thanks both') < ctx.indexOf('18 months of cohort data before'), 'transcript in order');
  assert.match(ctx, /FULL TRANSCRIPT \(ME is the user; THEM is everyone else\)/);
});

test('over the budget, or with no transcript, it stands aside for retrieval', () => {
  assert.equal(buildWholeMeetingContext({ detailed, chunks: [] }), null);
  assert.equal(buildWholeMeetingContext({ detailed, chunks: [{ ...chunks[0], tokenCount: WHOLE_MEETING_TOKEN_BUDGET + 1 }] }), null);
  assert.equal(notesAsText('t', null), '');
});

test('reads the meeting\'s own rows from the database', (t) => {
  let Database;
  try { Database = createRequire(import.meta.url)(path.join(root, 'node_modules/better-sqlite3')); } catch { t.skip('better-sqlite3 not loadable here'); return; }
  let db;
  try { db = new Database(':memory:'); } catch { t.skip('better-sqlite3 built for another runtime'); return; }
  db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, summary_json TEXT);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT, chunk_index INTEGER, speaker TEXT, start_timestamp_ms INTEGER, cleaned_text TEXT, token_count INTEGER);`);
  db.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?)').run('m1', 'Seed round', 0, JSON.stringify({ detailedSummary: detailed }));
  db.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?)').run('m2', 'Other', 0, '{}');
  chunks.forEach((c, i) => db.prepare('INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, cleaned_text, token_count) VALUES (?, ?, ?, ?, ?, ?)').run('m1', i, c.speaker, c.startMs, c.text, c.tokenCount));
  db.prepare('INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, cleaned_text, token_count) VALUES (?, ?, ?, ?, ?, ?)').run('m2', 0, 'THEM', 0, 'A different meeting entirely.', 5);
  const ctx = loadWholeMeetingContext(db, 'm1');
  assert.match(ctx, /Gareth/);
  assert.doesNotMatch(ctx, /different meeting/, 'only this meeting');
  assert.equal(loadWholeMeetingContext(db, 'm1', 5), null, 'over the budget');
  assert.equal(loadWholeMeetingContext(db, 'missing'), null);
  db.close();
});

test('the finished-meeting path is taken before retrieval, and never for the live meeting', () => {
  const mgr = read('electron/rag/RAGManager.ts');
  const q = mgr.slice(mgr.indexOf('async *queryMeeting('));
  assert.ok(q.indexOf('loadWholeMeetingContext(this.db, meetingId)') < q.indexOf('this.retriever.retrieve(query, { meetingId })'));
  assert.match(q, /if \(this\.liveIndexer\.getActiveMeetingId\(\) !== meetingId\) \{\s*const whole = loadWholeMeetingContext/);
  // The Ask handler lets exactly that case past its embeddings gate (2026-11-01): same test, no embeddings needed.
  assert.match(mgr, /canReadWholeMeeting\(meetingId: string\): boolean \{\s*return !!this\.llmHelper && this\.liveIndexer\.getActiveMeetingId\(\) !== meetingId && loadWholeMeetingContext\(this\.db, meetingId\) !== null;/);
  const ipc = read('electron/ipcHandlers.ts');
  const h = ipc.slice(ipc.indexOf("'rag:query-meeting'"), ipc.indexOf("'rag:query-meeting'") + 1500);
  assert.match(h, /if \(!ragManager \|\| \(!readsWhole && !ragManager\.isReady\(\)\)\)/);
  assert.match(h, /!readsWhole &&\s*!ragManager\.isMeetingProcessed\(meetingId\)/);
});

test('general advice only for a general question; a named person is looked for in the notes', () => {
  const p = buildRAGPrompt('What does Gareth need?', 'ctx', 'meeting');
  assert.match(p, /A question about the meeting itself \(a person, what someone said, needs or agreed, a figure, a date, a decision\) never gets general advice/);
  assert.match(p, /a person may be named only in the notes/);
  assert.match(p, /"The transcript doesn't say that was Helen\."/);
  // The always-answer contract still holds for general questions (AlwaysAnswer2026_09_07).
  assert.match(p, /never stop at "I didn't catch that"/);
});
