// F-415 repro: the live indexer cannot re-stamp a meeting's embedding space
// after a MID-MEETING provider fallback.
//
// LiveRAGIndexer stamps on its first successful tick via
// stampMeetingSpaceIfUnset, which is `WHERE embedding_space IS NULL` — a no-op
// once set. If a later tick's primary call fails and getEmbeddingsWithFallback
// permanently promotes the local provider, the meeting row keeps claiming the
// OLD space while the newer chunks are in the NEW one. Query time uses
// getActiveSpaceKey() (now the local space) and the space filter then excludes
// the meeting entirely — zero live-RAG results exactly when the cloud provider
// is down and the fallback exists to help. The QUEUED path handles this
// correctly (activateMeetingFallback -> clearEmbeddingsForMeeting); the live
// path had no equivalent.
//
// Real better-sqlite3, real VectorStore method semantics.
const Database = require('better-sqlite3');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '../..');
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return { app: { getPath: () => '/tmp', isPackaged: false, isReady: () => true } };
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};
const { VectorStore } = require(path.join(root, 'dist-electron/electron/rag/VectorStore.js'));
Module._load = origLoad;

const db = new Database(':memory:');
db.exec(`CREATE TABLE meetings (
  id TEXT PRIMARY KEY, embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT
);`);
db.prepare('INSERT INTO meetings (id) VALUES (?)').run('live-meeting-current');

const vs = Object.create(VectorStore.prototype);
vs.db = db;

// Tick 1: cloud provider succeeds; the meeting is stamped.
vs.stampMeetingSpaceIfUnset('live-meeting-current', 'gemini', 768, 'gemini:embedding-2:768');
const afterFirst = db.prepare('SELECT embedding_space s FROM meetings WHERE id = ?').get('live-meeting-current').s;

// Tick 5: primary fails, the local provider is promoted permanently.
vs.stampMeetingSpaceIfUnset('live-meeting-current', 'local-minilm', 384, 'local:minilm:384');  // no-op by design
const restamped = typeof vs.restampMeetingSpaceOnChange === 'function'
  ? vs.restampMeetingSpaceOnChange('live-meeting-current', 'local-minilm', 384, 'local:minilm:384')
  : false;
const afterFallback = db.prepare('SELECT embedding_space s FROM meetings WHERE id = ?').get('live-meeting-current').s;

// Query time resolves the CURRENT active space.
const querySpace = 'local:minilm:384';
const visible = afterFallback === querySpace;

console.log(`[F-415] after tick 1: ${afterFirst} | after fallback: ${afterFallback} | query space: ${querySpace}`);
console.log(`[F-415] re-stamped: ${restamped} | meeting visible to live RAG: ${visible}`);

if (afterFirst !== 'gemini:embedding-2:768') { console.error('[F-415] Inconclusive: initial stamp did not apply'); process.exit(2); }
if (!visible) {
  console.error('[F-415] FAIL: the meeting still claims the old space, so the query-time space filter excludes it — live RAG returns nothing exactly when the fallback was meant to help (F-415 reproduced).');
  process.exit(1);
}
// A same-space tick must NOT rewrite (keep the common case a no-op).
const noop = vs.restampMeetingSpaceOnChange('live-meeting-current', 'local-minilm', 384, 'local:minilm:384');
if (noop) { console.error('[F-415] re-stamp fired for an unchanged space'); process.exit(1); }
console.log('[F-415] PASS: a mid-meeting provider promotion re-stamps the meeting; an unchanged space is a no-op.');
process.exit(0);
