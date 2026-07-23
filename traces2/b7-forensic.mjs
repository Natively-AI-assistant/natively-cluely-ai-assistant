// [TRACE:LONGCTX] B7 retrieval-recall forensic — Family B, H11.
// Drives the REAL compiled ModeHybridRetriever (lexical path) + DocumentMap
// over the real Attention paper PDF to pin which layer drops the §5.2
// "8 P100 GPUs / 12 hours" chunk for the B7 question.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '..');

const { PDFParse } = require('pdf-parse');
const { ModeHybridRetriever } = require(path.join(REPO, 'dist-electron/electron/services/modes/ModeHybridRetriever.js'));
const DocMap = require(path.join(REPO, 'dist-electron/electron/services/modes/DocumentMap.js'));

const QUERY = 'what hardware and how long did training take for the base model?';

async function main() {
  const buf = fs.readFileSync(path.join(REPO, 'test-fixtures/modes-corpus/papers/attention_is_all_you_need_1706.03762.pdf'));
  const parsed = await new PDFParse({ data: buf }).getText();
  const content = parsed.text || '';
  console.log('PDF chars:', content.length);

  // ── Layer 1: DocumentMap / ToC / section detection ──────────────────
  const map = DocMap.buildDocumentMap(content);
  console.log('\n=== DocumentMap ===');
  console.log('hasToc:', map.hasToc, 'hasTocPath:', map.hasTocPath, 'sections:', map.sections.length);
  const sec52 = map.sections.filter(s => s.num && s.num.startsWith('5'));
  for (const s of sec52) console.log('  §' + s.num, JSON.stringify(s.heading));

  // ── Layer 2: does the query route to §5.2? ──────────────────────────
  const targets = map.hasToc ? DocMap.resolveTargetSections(QUERY, map) : [];
  console.log('\n=== resolveTargetSections ===');
  console.log('hasToc-gated targets:', JSON.stringify(targets));
  // also run it UNGATED to see if routing itself would work
  const targetsUngated = DocMap.resolveTargetSections(QUERY, map);
  console.log('ungated targets (what routing WOULD pick):', JSON.stringify(targetsUngated));

  // ── Layer 3: chunking — is the P100 sentence section-tagged §5.2? ────
  // Minimal in-memory deps: lexical-only path (embedding unavailable) — this
  // is exactly production's fallback and reproduces the ranking miss.
  const stubStmt = { run() {}, get() { return undefined; }, all() { return []; } };
  const db = { exec() {}, prepare() { return stubStmt; }, transaction(fn) { return fn; } };
  const embeddingPipeline = { isReady: () => false, getActiveSpaceKey: () => null, getEmbeddingsWithFallback: async () => [] };
  const vectorStore = {};
  const r = new ModeHybridRetriever(db, vectorStore, embeddingPipeline);
  const r2 = r;
  const file = { id: 'b7file', fileName: 'attention.pdf', content, modeId: 'm' };
  const chunks = r.chunkText(content); // private but reachable on instance
  const p100Chunks = chunks.map((t, i) => ({ i, t })).filter(x => /P100/.test(x.t));
  console.log('\n=== chunking ===');
  console.log('total chunks:', chunks.length, '| chunks containing P100:', p100Chunks.length);
  for (const c of p100Chunks) {
    const secTag = (c.t.match(/^\[Section\s+([\d.]+)\s*\|/) || [])[1] ?? 'UNTAGGED';
    console.log(`  chunk#${c.i} sectionTag=${secTag} :: ${c.t.replace(/\s+/g, ' ').slice(0, 160)}`);
  }

  // ── Layer 4: full retrieve() — does P100 survive to final block? ─────
  process.env.NATIVELY_RAG_DIAG = '1';
  const res = await r2.retrieve({
    query: QUERY,
    modeId: 'm',
    files: [file],
    forceDocumentGrounding: true,
    hasTranscript: true,
  });
  console.log('\n=== retrieve() result ===');
  console.log('usedFallback:', res.usedFallback, 'usedHybrid:', res.usedHybrid, 'chunks:', res.chunks?.length);
  const block = res.formattedContext || '';
  console.log('formattedContext chars:', block.length);
  console.log('P100 present in final block?', /P100/.test(block) ? 'YES' : 'NO ❌');
  console.log('"twelve hours" or "12 hours" present?', /(twelve hours|12 hours)/i.test(block) ? 'YES' : 'NO ❌');
  console.log('\n--- final block section tags (in order) ---');
  for (const m of block.matchAll(/\[Section\s+([\d.]+)\s*\|/g)) process.stdout.write(m[1] + ' ');
  console.log('\n\n--- selected chunk previews ---');
  (res.chunks || []).forEach((c, i) => {
    const secTag = (c.text.match(/^\[Section\s+([\d.]+)/) || [])[1] ?? 'UNTAGGED';
    console.log(`  [${i}] §${secTag} fts=${(c.ftsScore ?? 0).toFixed(3)} vec=${(c.vectorScore ?? 0).toFixed(3)} :: ${c.text.replace(/\s+/g, ' ').slice(0, 90)}`);
  });
}
main().catch(e => { console.error('FATAL', e?.stack || e); process.exit(1); });
