// A file with surrounding whitespace re-indexed on EVERY launch, forever.
//
// `indexHash` is compared in three places and was computed from two different
// strings: `indexFileInner` hashed `file.content.trim()`, while
// `needsReindexing` and `markIndexed` hashed `file.content` raw. Any file whose
// content has leading or trailing whitespace therefore produced two different
// hashes, `needsReindexing` was PERMANENTLY true, and the file re-chunked and
// re-embedded on every single launch — no error, no warning, and no symptom
// beyond latency and the embedding bill.
//
// OBSERVED, not theorised. Against a copy of a real user database:
//
//   04_competitors.csv    415 chars raw / 414 trimmed  ->  needsReindex=true
//                                                          IMMEDIATELY after a
//                                                          successful re-index
//   two PDFs              no surrounding whitespace    ->  settled correctly
//
// which is also why it went unnoticed: whether a file loops depends on whether
// it happens to end in a newline, so most documents behave and CSVs do not.
//
// It predates CHUNKER_VERSION. The version only made each needless loop cost a
// full re-embed of the file.
//
// The fix normalizes INSIDE the hash rather than at the three call sites, so a
// fourth caller cannot reintroduce the drift.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { ModeHybridRetriever } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/services/modes/ModeHybridRetriever.js'));

// `indexHash` is module-private, so drive the behaviour through the public
// surface instead: index a file, then ask whether it needs indexing again.
const stubPipeline = () => ({
  isReady: () => true,
  getActiveSpaceKey: () => 'test:space:3',
  getActiveProviderName: () => 'gemini',
  getEmbeddingsWithFallback: async (texts) => ({
    embeddings: texts.map(() => [0.1, 0.2, 0.3]), space: 'test:space:3',
  }),
  getEmbeddings: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  getEmbedding: async () => [0.1, 0.2, 0.3],
  getEmbeddingForQuery: async () => [0.1, 0.2, 0.3],
});

function memoryDb() {
  const Database = cjsRequire(path.resolve(repoRoot, 'node_modules/better-sqlite3'));
  return new Database(':memory:');
}

const CASES = [
  ['trailing newline (the observed CSV shape)', 'a,b,c\n1,2,3\n'],
  ['leading whitespace', '\n  # Notes\n\nbody text here.\n'],
  ['no surrounding whitespace (the control)', '# Notes\n\nbody text here.'],
  ['trailing spaces and tabs', '# Notes\n\nbody.\t  \n  '],
];

describe('a file does not re-index on every launch because of whitespace', () => {
  for (const [label, content] of CASES) {
    test(label, async () => {
      const hr = new ModeHybridRetriever(memoryDb(), {}, stubPipeline());
      const file = { id: `f-${label.length}`, modeId: 'm', fileName: 'doc.md', content };

      assert.equal(hr.needsReindexing(file), true, 'a never-indexed file must index');
      await hr.indexFile(file);
      assert.equal(hr.needsReindexing(file), false,
        'after a successful index the file must SETTLE — true here is an infinite re-embed loop');

      // And a second pass must be a genuine no-op, not a silent re-embed.
      let embeds = 0;
      const counting = stubPipeline();
      counting.getEmbeddingsWithFallback = async (texts) => {
        embeds += texts.length;
        return { embeddings: texts.map(() => [0.1, 0.2, 0.3]), space: 'test:space:3' };
      };
      hr.embeddingPipeline = counting;
      await hr.indexFile(file);
      assert.equal(embeds, 0, `second launch re-embedded ${embeds} chunks`);
    });
  }

  test('content that differs ONLY by surrounding whitespace shares one index identity', () => {
    // The property underneath all of the above: trimming happens inside the
    // hash, so the three call sites cannot disagree about what a file is.
    const hr = new ModeHybridRetriever(memoryDb(), {}, stubPipeline());
    const base = { id: 'same', modeId: 'm', fileName: 'doc.md', content: '# A\n\nbody.' };
    const padded = { ...base, content: '\n\n# A\n\nbody.  \n' };
    return hr.indexFile(base).then(() => {
      assert.equal(hr.needsReindexing(padded), false,
        'a re-save that only changed trailing whitespace must not trigger a full re-embed');
    });
  });

  test('a REAL content change still re-indexes', () => {
    // The guard against over-correcting: trimming must not make the hash blind.
    const hr = new ModeHybridRetriever(memoryDb(), {}, stubPipeline());
    const file = { id: 'x', modeId: 'm', fileName: 'doc.md', content: '# A\n\nbody.' };
    return hr.indexFile(file).then(() => {
      assert.equal(hr.needsReindexing({ ...file, content: '# A\n\nDIFFERENT body.' }), true);
    });
  });
});
