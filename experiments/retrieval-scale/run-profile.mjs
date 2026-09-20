#!/usr/bin/env node
// Profile Intelligence (résumé + JD) retrieval-scale harness.
//
// Drives the REAL V3 profile path — createProfileRetrievalPort → orchestrate()
// → packContext() — over the generated résumé/JD fixtures, as profile
// documents (NOT mode attachments). No LLM, no DB.
//
//   node experiments/retrieval-scale/run-profile.mjs [--mode looking-for-work] [--structured heuristic|none] [--sizes 5k,15k]
//
// `structured`: what the ingest's structuring step produced.
//   heuristic  premium HeuristicExtractor — what a user gets when the
//              structuring LLM call fails or times out (silent fallback)
//   none       raw text only — the lossless floor the port always has
// A real LLM extraction sits between/above these; it cannot be produced offline.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const dist = (p) => require(path.join(ROOT, 'dist-electron', p));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = arg('mode', 'looking-for-work');
const STRUCTURED = arg('structured', 'heuristic');
const SIZES = arg('sizes', '5k,15k,30k,70k').split(',');
// --vectors: bind the profile port's semantic arm to a REAL ModeHybridRetriever with the bundled
// MiniLM (a lower bound for hosted embedders). Needs sqlite → run with ELECTRON_RUN_AS_NODE=1 electron.
const VECTORS = argv.includes('--vectors');
const OUT = arg('out', path.join(HERE, 'out', `profile_${MODE}_${STRUCTURED}${argv.includes('--plain') ? '_plain' : ''}${argv.includes('--vectors') ? '_vectors' : ''}.json`));
const keep = console.log; console.warn = () => {}; console.info = () => {}; console.log = () => {};
const say = (...a) => keep(...a);

const { orchestrate } = dist('electron/context-intelligence/orchestration/orchestrator.js');
const { createProfileRetrievalPort } = dist('electron/context-intelligence/retrieval/profile-retrieval-port.js');
const { resolveModePolicy } = dist('electron/context-intelligence/policies/mode-policy-registry.js');
const { packContext } = dist('electron/context-intelligence/generation/context-packer.js');
const { heuristicResumeExtract, heuristicJDExtract } = dist('premium/electron/knowledge/HeuristicExtractor.js');
const MAX_PROFILE_DOCUMENT_CHARS = 200_000;
const { buildProfileRawRetriever, profilePseudoFiles } = dist('electron/services/knowledge/v3ProfileSources.js');
const { normalizeDocumentGroundedRetrievalQuery } = dist('electron/llm/documentGroundedPrompt.js');
let extractor = null;
async function embed(texts) {
  if (!extractor) { const tf = await import('@huggingface/transformers'); tf.env.allowRemoteModels = false; tf.env.localModelPath = path.join(ROOT, 'resources/models'); extractor = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' }); }
  const out = []; for (let i = 0; i < texts.length; i += 16) out.push(...(await extractor(texts.slice(i, i + 16), { pooling: 'mean', normalize: true })).tolist()); return out;
}
async function makeRawRetriever(docs) {
  const { ModeHybridRetriever } = dist('electron/services/modes/ModeHybridRetriever.js');
  const Database = require('better-sqlite3');
  const space = 'natively:all-minilm-l6-v2:384';
  const hr = new ModeHybridRetriever(new Database(':memory:'), { searchSimilar: async () => [], hasEmbeddings: () => false }, {
    isReady: () => true, getActiveProviderName: () => 'natively', getActiveSpaceKey: () => space, getActiveProviderMaxBatch: () => 32,
    getEmbeddingForQuery: async (q) => (await embed([q]))[0], getEmbedding: async (q) => (await embed([q]))[0], getEmbeddingsWithFallback: async (t) => ({ embeddings: await embed(t), space }) });
  for (const f of profilePseudoFiles(docs)) await hr.indexFile(f);
  // Mirrors ModeContextRetriever.retrieveHybrid's forwarding.
  const mm = { retrieveHybridRaw: (mode, files, o) => hr.retrieve({ query: normalizeDocumentGroundedRetrievalQuery(o.query), modeId: mode.id, files, tokenBudget: o.tokenBudget, topK: o.topK, hasTranscript: false, allowRerank: false, forceDocumentGrounding: true, rerankSurface: o.rerankSurface }) };
  return buildProfileRawRetriever(mm, docs, { tokenBudget: policy.contextBudget.evidenceTokens, rerankSurface: 'manual', meetingActive: () => false });
} // premium/electron/knowledge/DocumentReader.ts

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s) => unesc(s).toLowerCase().replace(/\s+/g, ' ').trim();
const carries = (text, q) => { const t = norm(text); return q.must.every((m) => t.includes(norm(m).slice(0, 90))); };

const policy = resolveModePolicy(MODE);
const questions = JSON.parse(fs.readFileSync(path.join(HERE, 'out/questions.json'), 'utf8')).filter((q) => q.kind !== 'reference' && q.must?.length);
const rows = [];
for (const size of SIZES) {
  const docs = ['resume', 'jd'].map((kind) => {
    // --plain: what a PDF extraction yields — no markdown heading marks, no bold.
    const md = fs.readFileSync(path.join(HERE, 'out', `${kind}_${size}.md`), 'utf8');
    const rawText = argv.includes('--plain') ? md.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^```$/gm, '') : md;
    // --structured live: what the REAL structuring LLM produced for the 15k fixtures (exported from a
    // live run's isolated profile into out/live_structured_15k.json). The heuristic extractor yields far
    // fewer competing sections than the LLM does, and the first ship gate for the semantic arm was
    // measured without them — a live regression on a lexical question got through it.
    const structured = STRUCTURED === 'none' ? null
      : STRUCTURED === 'live' ? JSON.parse(fs.readFileSync(path.join(HERE, 'out/live_structured_15k.json'), 'utf8'))[kind === 'resume' ? 'resume' : 'job_description']
      : (kind === 'resume' ? heuristicResumeExtract(rawText) : heuristicJDExtract(rawText));
    return { kind, sourceId: `p-${kind}`, versionId: 'v1', fileName: `${kind}_${size}.md`, structured, rawText, chars: rawText.length };
  });
  for (const d of docs) if (d.chars > MAX_PROFILE_DOCUMENT_CHARS) say(`NOTE [${size}] ${d.fileName}: ${d.chars} chars > ${MAX_PROFILE_DOCUMENT_CHARS} — the real upload REJECTS this file (DocumentReader); retrieval below is hypothetical`);
  const rawRetriever = VECTORS ? await makeRawRetriever(docs) : null;
  const port = createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'local', ...(rawRetriever ? { rawRetriever } : {}) });
  if (!port) { say(`[${size}] no profile port (mode ${MODE} has no profileSources?)`); continue; }
  // --debug-q "<id or text>": print the evidence chosen for one question, then carry on.
  const DEBUG_Q = arg('debug-q', null);
  for (const q of questions.filter((x) => x.size === size && (!DEBUG_Q || x.id === DEBUG_Q || x.question === DEBUG_Q))) {
    const r = await orchestrate({ requestId: q.id, requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'local' }, sessionId: `s-${q.id}`, manualQuestion: q.question, hasAttachedDocuments: true, attachedFileNames: [], profileOnlyDocuments: true /* what engine-bridge sets: 0 mode files, 2 profile docs */ }, port);
    const packed = packContext(r.decision, r.evidence, { evidenceTokens: policy.contextBudget.evidenceTokens * (r.decision.retrievalPlan.exhaustive ? 3 : 1), conversationTokens: policy.contextBudget.conversationTokens, transcriptTokens: policy.contextBudget.transcriptTokens });
    if (DEBUG_Q) { say(`\nQ ${q.id}: ${q.question}  claims=${r.decision.claimRequirements.map((c) => c.claimType).join(',')} fallback=${r.trace.fallbackUsed}`); for (const e of r.evidence) say(`  ${e.finalScore.toFixed(3)} ${e.sourceType.padEnd(16)} ${carries(e.content, q) ? 'NEEDLE' : '      '} | ${e.content.replace(/\s+/g, ' ').slice(0, 130)}`); }
    const rej = r.trace.retrievalAttempts.flatMap((a) => a.rejections ?? []).map((x) => x.reason);
    rows.push({ id: q.id, kind: q.kind, size, variant: q.variant, type: q.type, retrieved: r.decision.retrievalPlan.shouldRetrieve === true, planned: r.decision.retrievalPlan.sourceTypes, claims: r.decision.claimRequirements.map((c) => c.claimType),
      retr: null, evid: r.evidence.some((e) => carries(e.content, q)), pack: packed.evidenceBlock.split('</evidence>').some((b) => carries(b, q)), evidCount: r.evidence.length, packCount: packed.includedEvidenceIds.length, fallback: r.trace.fallbackUsed, rejections: [...new Set(rej)] });
  }
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
const rate = (xs, f) => (xs.length ? `${Math.round((100 * xs.filter(f).length) / xs.length)}%`.padStart(4) : '   -');
say(`\nprofile path  mode=${MODE} structured=${STRUCTURED}  (${rows.length} questions)`);
say('size  kind     n   routed  evid  pack   | lex  para  stt | planted sibling (pack)');
for (const size of SIZES) for (const kind of ['resume', 'jd', 'ALL']) {
  const xs = rows.filter((r) => r.size === size && (kind === 'ALL' || r.kind === kind));
  if (!xs.length) continue;
  say(`${size.padEnd(5)} ${kind.padEnd(7)} ${String(xs.length).padStart(3)}  ${rate(xs, (r) => r.retrieved)}   ${rate(xs, (r) => r.evid)}  ${rate(xs, (r) => r.pack)}   | ${['lex', 'para', 'stt'].map((v) => rate(xs.filter((r) => r.variant === v), (r) => r.pack)).join('  ')} | ${rate(xs.filter((r) => r.type !== 'sibling'), (r) => r.pack)}    ${rate(xs.filter((r) => r.type === 'sibling'), (r) => r.pack)}`);
}
say(`-> ${path.relative(ROOT, OUT)}`);
