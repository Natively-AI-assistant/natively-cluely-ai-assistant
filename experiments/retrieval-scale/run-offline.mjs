#!/usr/bin/env node
// Offline retrieval-scale harness.
//
// Drives the REAL production modules from dist-electron — ModeHybridRetriever
// (chunk → index → hybrid rank → rerank → select), the V3 orchestrator with the
// real mode retrieval port, and the context packer — over the generated
// fixtures, and records where each needle is lost:
//
//   retr  needle chunk is in the retriever's returned chunks
//   evid  needle chunk is in the orchestrator's accepted evidence
//   pack  needle chunk is in the packed <evidence> block the model reads
//
// No LLM is called; this isolates everything between upload and the prompt.
//
// Run (better-sqlite3 is built for Electron's ABI):
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 npx electron experiments/retrieval-scale/run-offline.mjs \
//     --stack lexical|local|vector [--rerank] [--sizes 5k,70k] [--kinds resume] [--scenario single|trio] [--mode general]
//
// Stacks:
//   lexical  no embedding provider ready (key-less boot, failed probe)
//   local    MiniLM vectors, provider name 'local' (what a key-less user runs)
//   vector   the same MiniLM vectors under a hosted provider name — a LOWER
//            BOUND for hosted users (voyage/gemini embed better than MiniLM)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const dist = (p) => require(path.join(ROOT, 'dist-electron/electron', p));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const STACK = arg('stack', 'lexical');
const SIZES = arg('sizes', '5k,15k,30k,70k').split(',');
const KINDS = arg('kinds', 'resume,jd,reference').split(',');
const SCENARIO = arg('scenario', 'single');
const MODE = arg('mode', 'general');
const VARIANTS = arg('variants', 'lex,para,stt').split(',');
const RERANK = has('rerank');
const OUT = arg('out', path.join(HERE, 'out', `offline_${STACK}${RERANK ? '_rerank' : ''}_${SCENARIO}_${MODE}.json`));
const VERBOSE = has('verbose');
// --fullrank: also run one unbounded retrieve per question and record where the
// needle sits in the retriever's COMPLETE ordering (and with what scores).
const FULLRANK = has('fullrank');

if (!VERBOSE) { const keep = console.log; console.warn = () => {}; console.info = () => {}; console.debug = () => {}; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('##')) keep(...a.map((x) => (typeof x === 'string' ? x.replace(/^## ?/, '') : x))); }; }
const say = (...a) => console.log('##', ...a);

const { ModeHybridRetriever } = dist('services/modes/ModeHybridRetriever.js');
const { orchestrate, decide } = dist('context-intelligence/orchestration/orchestrator.js');
const { createModeRetrievalPort } = dist('context-intelligence/retrieval/mode-retrieval-port.js');
const { resolveModePolicy } = dist('context-intelligence/policies/mode-policy-registry.js');
const { packContext } = dist('context-intelligence/generation/context-packer.js');
const { normalizeDocumentGroundedRetrievalQuery } = dist('llm/documentGroundedPrompt.js');

// --- embedder ---------------------------------------------------------------
let extractor = null;
async function embed(texts) {
  if (!extractor) {
    const tf = await import('@huggingface/transformers');
    tf.env.allowRemoteModels = false;
    tf.env.localModelPath = path.join(ROOT, 'resources/models');
    extractor = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
  }
  const out = [];
  for (let i = 0; i < texts.length; i += 16) {
    const t = await extractor(texts.slice(i, i + 16), { pooling: 'mean', normalize: true });
    out.push(...t.tolist());
  }
  return out;
}

let crossEncoder = null;
async function rerank(query, passages) {
  if (!crossEncoder) {
    const tf = await import('@huggingface/transformers');
    tf.env.allowRemoteModels = false;
    tf.env.localModelPath = path.join(ROOT, 'resources/models');
    const tokenizer = await tf.AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2');
    const model = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' });
    crossEncoder = { tokenizer, model };
  }
  const { tokenizer, model } = crossEncoder;
  const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true, max_length: 512 });
  const { logits } = await model(inputs);
  return logits.tolist().map((l, index) => ({ index, score: 1 / (1 + Math.exp(-l[0])) })).sort((a, b) => b.score - a.score);
}

function makePipeline() {
  const name = STACK === 'local' ? 'local' : 'natively';
  const space = `${name}:all-minilm-l6-v2:384`;
  const ready = STACK !== 'lexical';
  return {
    isReady: () => ready,
    getActiveProviderName: () => name,
    getActiveSpaceKey: () => space,
    getActiveProviderMaxBatch: () => 32,
    getEmbeddingForQuery: async (q) => (await embed([q]))[0],
    getEmbedding: async (q) => (await embed([q]))[0],
    getEmbeddings: async (t) => embed(t),
    getEmbeddingsWithFallback: async (t) => ({ embeddings: await embed(t), space }),
  };
}

// --- run ----------------------------------------------------------------------
const Database = require('better-sqlite3');
const questions = JSON.parse(fs.readFileSync(path.join(HERE, 'out/questions.json'), 'utf8'));
// The packer XML-escapes evidence; undo that before matching or every needle
// containing a quote or ampersand reads as dropped.
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s) => unesc(s).toLowerCase().replace(/\s+/g, ' ').trim();
// A chunk carries the needle when it contains EVERY `must` string (the fact
// line, plus the owning entity for sibling facts whose line alone is ambiguous).
const carries = (text, q) => { const t = norm(text); return q.must.every((m) => t.includes(norm(m).slice(0, 90))); };

const policy = resolveModePolicy(MODE);
// Experiment knobs (--cap / --tokens / --cands): evidence capacity overrides.
// orchestrator.js is its own esbuild bundle with its own copy of the policy
// registry, so mutating the policy here would not reach it. Instead the
// override path runs decide() → (patched plan) → port.retrieve() → packContext()
// by hand: the same production functions, minus orchestrate()'s answerability
// bookkeeping, which does not affect which evidence is packed.
const OVERRIDE = arg('cap') || arg('tokens') || arg('cands')
  ? { cap: Number(arg('cap', policy.retrievalPolicy.maximumAcceptedEvidence)), cands: Number(arg('cands', policy.retrievalPolicy.maximumCandidates)), tokens: Number(arg('tokens', policy.contextBudget.evidenceTokens)) }
  : null;
if (OVERRIDE) say(`OVERRIDE cap=${OVERRIDE.cap} cands=${OVERRIDE.cands} tokens=${OVERRIDE.tokens}`);
const EVIDENCE_TOKENS = OVERRIDE ? OVERRIDE.tokens : policy.contextBudget.evidenceTokens;
// --plain: what a PDF/DOCX extraction yields — no heading marks, no bold, no fences.
const PLAIN = (md) => (has('plain') ? md.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^```$/gm, '') : md);
const rows = [];
// General-knowledge questions that must NOT be pulled into retrieval by corpus
// arbitration, though the fixtures mention Kafka, Kubernetes, Redis, p99 … often.
const GENERAL_NEGATIVES = [
  'What is a mutex?', 'What is the difference between TCP and UDP?', 'Reverse a linked list in Python',
  'Explain the CAP theorem', 'What is Kubernetes?', 'How does Kafka guarantee ordering?', 'What is p99 latency?',
  'How do I center a div in CSS?', 'What is the time complexity of quicksort?', 'Explain how Redis persistence works',
  'What is a good way to negotiate salary?', 'How should I answer tell me about yourself?',
];
const negatives = [];
for (const size of SIZES) {
  const groups = SCENARIO === 'trio' ? [KINDS] : KINDS.map((k) => [k]);
  for (const group of groups) {
    const db = new Database(':memory:');
    const pipeline = makePipeline();
    const hr = new ModeHybridRetriever(db, { searchSimilar: async () => [], hasEmbeddings: () => false }, pipeline);
    if (RERANK) hr.__setRerankerForTests({ rerank });
    const files = group.map((kind) => ({ id: `f-${kind}-${size}`, modeId: 'm1', fileName: `${kind}_${size}.md`, content: PLAIN(fs.readFileSync(path.join(HERE, 'out', `${kind}_${size}.md`), 'utf8')), createdAt: new Date().toISOString() }));
    const t0 = Date.now();
    if (STACK !== 'lexical') for (const f of files) await hr.indexFile(f);
    const chunkCount = db.prepare('SELECT COUNT(*) n, SUM(embedding IS NOT NULL) e FROM mode_reference_chunks').get();
    say(`[${size} ${group.join('+')}] indexed chunks=${chunkCount.n} embedded=${chunkCount.e ?? 0} in ${Date.now() - t0}ms`);

    let lastRetr = null;
    const modesManager = {
      probeReferenceAnchors: (_mode, fs_, question) => hr.probeAnchors(fs_, question),
      // Mirrors ModeContextRetriever.retrieveHybrid's forwarding exactly.
      retrieveHybridRaw: async (mode, fs_, o) => {
        const retrievalQuery = o.forceDocumentGrounding ? normalizeDocumentGroundedRetrievalQuery(o.query) : o.query;
        const res = await hr.retrieve({ query: retrievalQuery, modeId: mode.id, files: fs_, tokenBudget: o.tokenBudget, topK: o.topK, hasTranscript: false, allowRerank: RERANK ? o.allowRerank : false, forceDocumentGrounding: o.forceDocumentGrounding, rerankSurface: o.rerankSurface, rerankPoolMultiplier: o.rerankPoolMultiplier, queryEmbedRetryBudgetMs: o.queryEmbedRetryBudgetMs });
        lastRetr = res;
        return res;
      },
    };
    const port = createModeRetrievalPort({ modesManager, modeInfo: { id: 'm1' }, files, allowedSourceTypes: policy.allowedSourceTypes, tokenBudget: EVIDENCE_TOKENS, userId: 'local', rerankSurface: 'manual' });

    for (const q of questions) {
      if (q.size !== size || !group.includes(q.kind) || !VARIANTS.includes(q.variant)) continue;
      lastRetr = null;
      const t1 = Date.now();
      const req = { requestId: q.id, requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'local' }, sessionId: `s-${q.id}`, manualQuestion: q.question, hasAttachedDocuments: true, attachedFileNames: files.map((f) => f.fileName), attachedSourceCount: files.length /* as engine-bridge passes it */ };
      let r;
      if (OVERRIDE) {
        const d0 = decide(req);
        const x = d0.retrievalPlan.exhaustive ? [2, 3] : [1, 1];
        const decision = { ...d0, retrievalPlan: { ...d0.retrievalPlan, maximumCandidates: OVERRIDE.cands * x[0], maximumAcceptedEvidence: OVERRIDE.cap * x[1] } };
        const got = d0.retrievalPlan.shouldRetrieve === false || !(d0.retrievalPlan.queries?.length) ? { evidence: [], attempts: [] } : await port.retrieve({ decision });
        r = { decision, evidence: got.evidence, answerability: 'n/a', trace: { retrievalAttempts: got.attempts, fallbackUsed: 'n/a' } };
      } else {
        r = await orchestrate(req, port);
      }
      const packed = packContext(r.decision, r.evidence, { evidenceTokens: (OVERRIDE ? EVIDENCE_TOKENS : (r.decision.retrievalPlan.evidenceTokens ?? EVIDENCE_TOKENS)) * (r.decision.retrievalPlan.exhaustive ? 3 : 1), /* = prompt-composer */ conversationTokens: policy.contextBudget.conversationTokens, transcriptTokens: policy.contextBudget.transcriptTokens });
      const key = q.must?.length ? q : null;
      const retrChunks = lastRetr?.chunks ?? [];
      const retrRank = key ? retrChunks.findIndex((c) => carries(c.text, key)) : -1;
      let full = null;
      if (FULLRANK && key && lastRetr) {
        const wide = await hr.retrieve({ query: normalizeDocumentGroundedRetrievalQuery(r.decision.retrievalPlan.queries?.[0] ?? q.question), modeId: 'm1', files, tokenBudget: 10_000_000, topK: 100_000, hasTranscript: false, allowRerank: false, forceDocumentGrounding: true, rerankSurface: 'manual' });
        const i = wide.chunks.findIndex((c) => carries(c.text, key));
        full = { rank: i, of: wide.chunks.length, ...(i >= 0 ? { score: +wide.chunks[i].score?.toFixed(3), fts: +wide.chunks[i].ftsScore?.toFixed(3), vec: +wide.chunks[i].vectorScore?.toFixed(3), top: +wide.chunks[0].score?.toFixed(3) } : {}) };
      }
      const rej = r.trace.retrievalAttempts.flatMap((a) => a.rejections ?? []).map((x) => x.reason);
      rows.push({
        id: q.id, kind: q.kind, size, variant: q.variant, type: q.type, scenario: SCENARIO,
        path: r.decision.answerPath ?? r.decision.path, intent: r.decision.turnType ?? r.decision.intent,
        retrieved: lastRetr !== null, retrCount: retrChunks.length, retrRank,
        retr: key ? retrRank >= 0 : null,
        evid: key ? r.evidence.some((e) => carries(e.content, key)) : null,
        pack: key ? packed.evidenceBlock.split('</evidence>').some((b) => carries(b, key)) : null,
        evidCount: r.evidence.length, packCount: packed.includedEvidenceIds.length,
        answerability: r.answerability, fallback: r.trace.fallbackUsed, rejections: [...new Set(rej)],
        full, query: r.decision.retrievalPlan.queries?.[0],
        usedHybrid: lastRetr?.usedHybrid, usedFallback: lastRetr?.usedFallback, ms: Date.now() - t1,
      });
    }
    for (const gq of GENERAL_NEGATIVES) {
      const d = await orchestrate({ requestId: 'neg', requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'local' }, sessionId: `neg-${size}-${gq.length}`, manualQuestion: gq, hasAttachedDocuments: true, attachedFileNames: files.map((f) => f.fileName) }, port);
      negatives.push({ size, files: group.join('+'), question: gq, retrieved: d.decision.retrievalPlan.shouldRetrieve === true, anchored: hr.probeAnchors(files, gq) });
    }
    db.close();
  }
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));

// --- summary ---------------------------------------------------------------------
const needles = rows.filter((r) => r.retr !== null);
const rate = (xs, f) => (xs.length ? `${Math.round((100 * xs.filter(f).length) / xs.length)}%`.padStart(4) : '   -');
say(`\nstack=${STACK} rerank=${RERANK} scenario=${SCENARIO} mode=${MODE}  (needle questions: ${needles.length})`);
say('size  kind       n   routed  retr  evid  pack   | lex  para  stt | planted sibling (pack)');
for (const size of SIZES) for (const kind of [...KINDS, 'ALL']) {
  const xs = needles.filter((r) => r.size === size && (kind === 'ALL' || r.kind === kind));
  if (!xs.length) continue;
  say(`${size.padEnd(5)} ${kind.padEnd(10)} ${String(xs.length).padStart(3)}  ${rate(xs, (r) => r.retrieved)}   ${rate(xs, (r) => r.retr)}  ${rate(xs, (r) => r.evid)}  ${rate(xs, (r) => r.pack)}   | ${['lex', 'para', 'stt'].map((v) => rate(xs.filter((r) => r.variant === v), (r) => r.pack)).join('  ')} | ${rate(xs.filter((r) => r.type !== 'sibling'), (r) => r.pack)}    ${rate(xs.filter((r) => r.type === 'sibling'), (r) => r.pack)}`);
}
const anchoredNeg = negatives.filter((n) => n.anchored);
say(`general-knowledge negatives: ${negatives.length} asked, ${anchoredNeg.length} anchored by the corpus probe, ${negatives.filter((n) => n.retrieved).length} retrieved`);
for (const n of anchoredNeg) say(`   ANCHORED [${n.size} ${n.files}] ${n.question}`);
say(`-> ${path.relative(ROOT, OUT)}`);
process.exit(0);
