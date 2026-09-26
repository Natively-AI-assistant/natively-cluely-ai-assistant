// scripts/smoke-document-grounded-trace.js
//
// HEADLESS RUNTIME TRACE for document-grounded custom mode.
// Drives the REAL production code path (compiled dist-electron) the same way
// scripts/e2e-document-grounded-real-path.js does — but adds per-stage
// instrumentation so every question's behavior is captured to JSON.
//
//   real ModesManager + ModeContextRetriever (real chunking/retrieval)
//   → real LLMHelper.streamChat with CHAT_MODE_PROMPT
//   → model = natively  →  POST https://api.natively.software/v1/chat
//   → server-chosen serverModel (observed via llmHelper.getLastProviderModel())
//
// All 8 trace questions are captured to
// debug-artifacts/document-grounded-system-map/trace-qNN.json + summary.
//
// Runs the SAME 8 questions as the user's report:
//   1. main topic
//   2. research questions
//   3. OpenVLA-OFT
//   4. Mercury X1 DoF           <-- the "facts are in PDF" smoking gun
//   5. Mercury X1 sensors
//   6. role of ROS#
//   7. role of Unity
//   8. four main phases
//
// Run:
//   RUN_NATIVELY_API_E2E=1 NATIVELY_API_KEY=<key> \
//     ./node_modules/.bin/electron scripts/smoke-document-grounded-trace.js
//
// Key value is never logged.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const outDir = path.join(repoRoot, 'debug-artifacts', 'document-grounded-system-map');
fs.mkdirSync(outDir, { recursive: true });

const KEY = process.env.NATIVELY_API_KEY || '';
if (process.env.RUN_NATIVELY_API_E2E !== '1' || !KEY) {
  console.log('[trace] SKIP — set RUN_NATIVELY_API_E2E=1 + NATIVELY_API_KEY to run');
  process.exit(0);
}

// Point userData at a throwaway dir BEFORE app is ready so the real DB is
// created in isolation (never touches the user's live natively.db).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-trace-'));
app.setPath('userData', tmpUserData);

const CUSTOM_PROMPT = [
  'Act as my real-time seminar presentation assistant.',
  'I have uploaded a seminar/thesis file.',
  'Answer from the uploaded seminar content first.',
  'Do not invent facts, numbers, methods, results, or claims.',
  'If something is not in the file, say it is not directly mentioned in my seminar material.',
  'Keep answers natural, confident, student-friendly, and speakable.',
].join(' ');

const FIXTURE_DIR = path.join(repoRoot, 'tests/fixtures/modes/custom/seminar-presentation');
// Includes the real PDF + the 5 text fixtures — mirrors the production corpus
// shape the user reported (PDF + auxiliary text). The PDF is the primary
// thesis material; text files add structured context for some answers.
const FIXTURE_FILES = [
  'seminar_vla_overview.txt',
  'seminar_hardware_specs.txt',
  'seminar_simulation_stack.md',
  'seminar_evaluation_results.csv',
  'seminar_dataset_training.txt',
  'seminar_custom_prompt_rules.txt',
  'seminar_real_thesis.pdf',
];

// The 8 trace questions. Same wording every time.
const QUESTIONS = [
  { idx: 1, q: 'What is the main topic of my thesis?',
    expected: ['Agentic AI', 'Vision-Language-Action', 'robotic', 'Mercury X1'] },
  { idx: 2, q: 'What are the two research questions?',
    expected: ['agentic', 'VLA', 'Vision-Language-Action', 'embodied', 'cognition'] },
  { idx: 3, q: 'What is OpenVLA-OFT?',
    expected: ['OpenVLA-OFT', 'LoRA', 'parallel decoding', 'action chunking', '43x', 'fine-?tun'] },
  { idx: 4, q: 'How many degrees of freedom does Mercury X1 have?',
    expected: ['19', 'degrees of freedom', 'Mercury X1'] },
  { idx: 5, q: 'What sensors does Mercury X1 use?',
    expected: ['LiDAR', 'ultrasonic', 'vision', 'Mercury X1'] },
  { idx: 6, q: 'What is the role of ROS#?',
    expected: ['ROS#', 'Unity', 'ROS', 'bridg'] },
  { idx: 7, q: 'What is the role of Unity?',
    expected: ['Unity', 'simulat', 'teleop', 'VR', 'ROS#'] },
  { idx: 8, q: 'What are the four main phases of the project?',
    expected: ['teleoperation', 'data collection', 'training', 'Agentic AI'] },
];

const FORBIDDEN_DRIFT = [
  'TalentScope', 'real-time technical interview platform', 'Convex',
  'Stream SDK', 'Clerk', 'Next.js', 'Tailwind', 'RBAC', 'synchronized code execution',
];
const GREETING_RE = /what would you like help with|how can i help|what can i (?:help|do)/i;
const NOT_MENTIONED_RE = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis) material|found|present|specifi)/i;

// ──────────────────────────────────────────────────────────────────────
// Diagnostic: inspect what the PDF + chunker actually produce.
// Runs BEFORE the LLM loop and dumps to ingestion-diag.json.
// ──────────────────────────────────────────────────────────────────────
async function runIngestionDiag({ modesMgr, modeId }) {
  const diag = {
    fixtures: [],
    retrieval_trace: {},
  };

  // Snapshot the per-file corpus shape.
  const refFiles = modesMgr.getReferenceFiles(modeId);
  for (const file of refFiles) {
    diag.fixtures.push({
      id: file.id,
      fileName: file.fileName,
      contentLength: file.content.length,
      pageCount: file.pageCount,
      extractedPageCount: file.extractedPageCount,
      preview: file.content.slice(0, 240),
      hasPageMarkers: /\[Page\s+\d+\]/.test(file.content),
      hasMarkdownHeadings: /^#{1,3}\s+/m.test(file.content),
      hasNumberedHeadings: /^\s*\d+(?:\.\d+){0,2}\s+/m.test(file.content),
    });
  }

  // Try parsing the real PDF directly with the production pdf-parse module.
  const pdfFile = refFiles.find(f => /\.pdf$/i.test(f.fileName));
  if (pdfFile) {
    try {
      const { PDFParse } = require(path.join(repoRoot, 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'index.cjs'));
      const buf = fs.readFileSync(path.join(FIXTURE_DIR, pdfFile.fileName));
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      await parser.destroy();
      diag.pdf_parse = {
        total: infoResult?.total,
        numpages: textResult?.pages?.length,
        text_length: (textResult?.text || '').length,
        text_preview: (textResult?.text || '').slice(0, 400),
      };
    } catch (e) {
      diag.pdf_parse = { error: String(e && e.message || e) };
    }
  }

  // The ModesManager has a private `modeContextRetriever` field; at runtime
  // (compiled JS) it's still on the object — we don't actually need it here
  // because the public buildRetrievedActiveModeContextBlock API surfaces
  // everything we need. Skip direct access.
  // Use the public buildRetrievedActiveModeContextBlock path (forceDocumentGrounding=true)
  // with a probe query that should hit every file. Then count chunks and capture first 5.
  try {
    const probeQuery = 'thesis Mercury X1 OpenVLA-OFT Unity ROS# teleoperation AgenticVLA';
    const block = modesMgr.buildRetrievedActiveModeContextBlock(
      probeQuery, undefined, 1800, 'lecture_answer', true, modeId, { forceDocumentGrounding: true },
    );
    // Count <snippet> occurrences in the formatted block.
    const snippetCount = (block.match(/<snippet>/g) || []).length;
    diag.chunker_diagnostic = {
      probe_query: probeQuery,
      block_length: block.length,
      snippet_count: snippetCount,
      has_document_identity_block: /<document_identity/.test(block),
      block_head: block.slice(0, 1500),
    };
  } catch (e) {
    diag.chunker_diagnostic = { error: String(e && e.message || e) };
  }

  fs.writeFileSync(path.join(outDir, 'ingestion-diag.json'), JSON.stringify(diag, null, 2));

  // Also dump 5 sample chunks (using the retriever's chunker) to a txt file.
  // Use distinct, file-specific probe terms so each file surfaces its own
  // chunks (not a generic shared chunk from custom_prompt_rules).
  try {
    const lines = [];
    const refFiles2 = modesMgr.getReferenceFiles(modeId);
    const perFileProbes = {
      'seminar_vla_overview.txt': 'OpenVLA-OFT AutoGen AgenticVLA',
      'seminar_hardware_specs.txt': 'Mercury X1 LiDAR ultrasonic',
      'seminar_simulation_stack.md': 'Unity ROS# Quest C920',
      'seminar_evaluation_results.csv': 'Success Rate MSE benchmark',
      'seminar_dataset_training.txt': 'dataset preprocessing LoRA finetune',
      'seminar_custom_prompt_rules.txt': 'reference files seminar answer',
      'seminar_real_thesis.pdf': 'data analyst datasets insights',
    };
    let sampled = 0;
    for (const file of refFiles2) {
      if (sampled >= 5) break;
      const probe = perFileProbes[file.fileName] || file.fileName.replace(/\.[^.]+$/, '');
      const block = modesMgr.buildRetrievedActiveModeContextBlock(
        probe, undefined, 1800, 'lecture_answer', true, modeId, { forceDocumentGrounding: true },
      );
      const matches = [...block.matchAll(/<snippet>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<\/snippet>/g)];
      if (matches.length === 0) continue;
      lines.push(`===== SAMPLE FROM ${file.fileName} (probe: "${probe}") =====`);
      const sampleText = matches[0][1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      lines.push(sampleText.slice(0, 500));
      lines.push('');
      sampled++;
    }
    fs.writeFileSync(path.join(outDir, 'ingestion-samples.txt'), lines.join('\n'));
  } catch (e) {
    fs.writeFileSync(path.join(outDir, 'ingestion-samples.txt'), `ERROR: ${e.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-question instrumentation
// ──────────────────────────────────────────────────────────────────────
async function traceQuestion(llmHelper, mm, modeId, qDef, llmFactory) {
  const q = qDef.q;
  const expectedTerms = qDef.expected;

  // Capture the [ModeContextRetriever] / [LLMHelper] log lines emitted by
  // the production code during this question, so the harness can record the
  // top scores / page counts / matched sections the production code itself
  // already computes (they never make it into the snippet XML).
  // Install BEFORE any production-code call so we capture every log line
  // produced during retrieval + LLM streaming.
  const capturedLogs = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const capture = (...args) => {
    const text = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    capturedLogs.push(text);
  };
  console.log = (...args) => { capture(...args); return origLog.apply(console, args); };
  console.error = (...args) => { capture(...args); return origErr.apply(console, args); };
  console.warn = (...args) => { capture(...args); return origWarn.apply(console, args); };

  const start = Date.now();
  const modeInfo = mm.getActiveModeDocumentGroundingInfo();

  // 1) Run the retrieval engine directly (no LLM). This is the EXACT block
  //    that gets injected as context on the real streamChat call.
  const retrievalStart = Date.now();
  const contextBlock = mm.buildRetrievedActiveModeContextBlock(
    q, undefined, 1800, 'lecture_answer', true, modeId, { forceDocumentGrounding: true },
  ) || '';
  const retrievalMs = Date.now() - retrievalStart;

  // 2) Capture retrieval telemetry by parsing the formatted block.
  const snippetRegex = /<snippet>([\s\S]*?)<\/snippet>/g;
  const snippets = [];
  let m;
  while ((m = snippetRegex.exec(contextBlock)) !== null) {
    const snippetXml = m[1];
    const sourceMatch = snippetXml.match(/<source>([\s\S]*?)<\/source>/);
    const textMatch = snippetXml.match(/<text>([\s\S]*?)<\/text>/);
    let parsedSource = null;
    if (sourceMatch) {
      try { parsedSource = JSON.parse(sourceMatch[1]); } catch (_) { /* leave null */ }
    }
    const text = textMatch ? textMatch[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      : '';
    snippets.push({
      sourceId: parsedSource?.sourceId || null,
      fileName: parsedSource?.fileName || null,
      sourceType: parsedSource?.type || null,
      chunkIndex: parsedSource?.chunkIndex ?? null,
      score: parsedSource?.score ?? null,
      ftsScore: parsedSource?.ftsScore ?? null,
      vectorScore: parsedSource?.vectorScore ?? null,
      text_length: text.length,
      snippet_start: text.slice(0, 240),
      has_page_marker: /\[Page\s+\d+\]/.test(text),
      page_marker: (text.match(/\[Page\s+(\d+)\]/) || [])[1] || null,
      first_heading: (text.match(/^\s*(?:#{1,3}\s+|(?:\d+(?:\.\d+){0,2}\s+))([^\n]+)/m) || [])[1] || null,
    });
  }

  const topReferenceScores = snippets.map(s => s.score).filter(s => typeof s === 'number').slice(0, 5);
  const queryMatchedPages = Array.from(new Set(
    snippets.map(s => s.page_marker).filter(p => p !== null)
  )).sort((a, b) => Number(a) - Number(b));
  const queryMatchedSections = Array.from(new Set(
    snippets.map(s => s.first_heading).filter(h => h !== null)
  ));

  const identityBlockMatch = contextBlock.match(/<document_identity[\s\S]*?<\/document_identity>/);
  const hasIdentityBlock = Boolean(identityBlockMatch);

  // 3) Run the real streamChat with CHAT_MODE_PROMPT — same shape as
  //    gemini-chat-stream IPC builds (system = CHAT_MODE_PROMPT, user = context+question).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const llmStart = Date.now();
  let answer = '';
  let err = null;
  try {
    // Pull the doc-grounded shaping helpers by require (same path the live
    // code uses). We need to interpose on shapeDocumentGroundedSystemPrompt
    // so the SHAPED system prompt is what gets sent, matching the live path.
    const dgPrompt = require(path.join(distRoot, 'llm', 'documentGroundedPrompt.js'));
    const promptsMod = require(path.join(distRoot, 'llm', 'prompts.js'));
    const CHAT_MODE_PROMPT = promptsMod.CHAT_MODE_PROMPT || promptsMod.default?.CHAT_MODE_PROMPT;
    const shapedSystem = dgPrompt.shapeDocumentGroundedSystemPrompt(CHAT_MODE_PROMPT, true);
    const userPayload = dgPrompt.buildDocumentGroundedUserContent({
      question: q, retrievedBlock: contextBlock, active: true,
    }) || `CONTEXT:\n${contextBlock}\n\nUSER QUESTION:\n${q}`;
    answer = await llmFactory(shapedSystem, userPayload, controller.signal);
  } catch (e) {
    err = e;
  } finally {
    clearTimeout(timeout);
  }
  const llmMs = Date.now() - llmStart;
  const totalMs = Date.now() - start;
  const trimmed = (answer || '').trim();

  const reported = llmHelper.getLastProviderModel ? llmHelper.getLastProviderModel() : null;

  // 4) Match / missing detection.
  const matched = [];
  const missing = [];
  for (const ev of expectedTerms) {
    const re = ev instanceof RegExp ? ev : new RegExp(ev, 'i');
    if (re.test(trimmed)) matched.push(ev.toString());
    else missing.push(ev.toString());
  }

  // 5) Drift / greeting / fail-closed checks.
  const driftHit = FORBIDDEN_DRIFT.filter(d => trimmed.toLowerCase().includes(d.toLowerCase()));
  const isGreeting = GREETING_RE.test(trimmed);
  const isNotMentioned = NOT_MENTIONED_RE.test(trimmed);
  const empty = trimmed.length < 8;

  // 6) Pass/fail: must include at least 60% of expected terms AND not be a greeting.
  //    Missing ALL high-signal terms = fail. Saying "not directly mentioned"
  //    while the model DID NOT mention the requested content (matched < half
  //    of expected AND said not-mentioned) is the worst-case fail-closed
  //    failure the user reported — flag it explicitly.
  const signalFail = missing.length === expectedTerms.length;
  const greetingFail = isGreeting;
  const driftFail = driftHit.length > 0;
  // Detect "false fail-closed": model says "not mentioned" but didn't even
  // attempt to name the requested terms (matched < 50% AND said not-mentioned).
  const failClosedFalse = isNotMentioned && matched.length < Math.max(1, Math.ceil(expectedTerms.length / 2));
  const pass = !signalFail && !greetingFail && !driftFail && !empty && !failClosedFalse;

  // Parse the captured [ModeContextRetriever] / [LLMHelper] logs to pull out
  // the scores / page metadata that the production code computed but did NOT
  // surface into the snippet XML.
  let prodTopScores = [];
  let prodMatchedPages = [];
  let prodMatchedSections = [];
  let prodReferenceFilePageCount = null;
  let prodReferenceFileChunkCount = null;
  let prodRetrievedReferenceChunks = null;
  let prodReferenceFileIngestedByPageHeuristic = null;
  let prodDocGroundedValidatorSignal = null;
  for (const log of capturedLogs) {
    // NOTE: console.log args are (label, obj). My capture stringifies the obj
    // via JSON.stringify which strips whitespace + escapes quotes. So the
    // patterns below accept both pretty-printed AND JSON-encoded shapes.
    const m1 = log.match(/retrievedReferenceChunks["\s:]+(\d+)/);
    if (m1) prodRetrievedReferenceChunks = Number(m1[1]);
    const m2 = log.match(/topReferenceScores["\s:]*\[([^\]]*)\]/);
    if (m2) {
      prodTopScores = m2[1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    }
    const m3 = log.match(/queryMatchedPages["\s:]*\[([^\]]*)\]/);
    if (m3) {
      prodMatchedPages = m3[1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    }
    const m4 = log.match(/queryMatchedSections["\s:]*\[([^\]]*)\]/);
    if (m4) {
      prodMatchedSections = m4[1].split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
    }
    const m5 = log.match(/referenceFilePageCount["\s:]+(null|\d+)/);
    if (m5) prodReferenceFilePageCount = m5[1] === 'null' ? null : Number(m5[1]);
    const m6 = log.match(/referenceFileChunkCount["\s:]+(\d+)/);
    if (m6) prodReferenceFileChunkCount = Number(m6[1]);
    const m7 = log.match(/referenceFileIngestedByPageHeuristic["\s:]+(\w+)/);
    if (m7) prodReferenceFileIngestedByPageHeuristic = m7[1];
    const m8 = log.match(/\[DocGrounded\]\s+([^\n]+)/);
    if (m8) prodDocGroundedValidatorSignal = m8[1];
    const m9 = log.match(/firstPassTooGeneric["\s:]+(\w+)/);
    if (m9 && prodRetrievedReferenceChunks === 0) {
      prodDocGroundedValidatorSignal = (prodDocGroundedValidatorSignal || '') +
        (prodDocGroundedValidatorSignal ? '; ' : '') +
        `firstPassTooGeneric=${m9[1]}`;
    }
    // Capture targeted_retry logs (when selected.length === 0 path triggers the retry)
    const m10 = log.match(/targetedRetryTriggered["\s:]+(\w+)/);
    if (m10) prodDocGroundedValidatorSignal = (prodDocGroundedValidatorSignal || '') +
      (prodDocGroundedValidatorSignal ? '; ' : '') +
      `targetedRetryTriggered=${m10[1]}`;
    const m11 = log.match(/targetedRetryRetrievedChunks["\s:]+(\d+)/);
    if (m11) prodDocGroundedValidatorSignal = (prodDocGroundedValidatorSignal || '') +
      (prodDocGroundedValidatorSignal ? '; ' : '') +
      `targetedRetryRetrievedChunks=${m11[1]}`;
    const m12 = log.match(/targetedRetryTerms["\s:]*\[([^\]]*)\]/);
    if (m12) prodDocGroundedValidatorSignal = (prodDocGroundedValidatorSignal || '') +
      (prodDocGroundedValidatorSignal ? '; ' : '') +
      `targetedRetryTerms=${m12[1]}`;
  }

  // Restore the original console.* methods before any post-trace work.
  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;

  return {
    question: q,
    expected_evidence_terms: expectedTerms.map(String),
    matched_terms: matched,
    missing_terms: missing,
    pass,
    answer: trimmed,
    answer_length: trimmed.length,
    timings_ms: { retrieval: retrievalMs, llm: llmMs, total: totalMs },
    custom_mode: {
      modeId,
      isCustom: modeInfo.isCustom,
      hasCustomPrompt: modeInfo.hasCustomPrompt,
      hasReferenceFiles: modeInfo.hasReferenceFiles,
      documentGrounded: modeInfo.documentGrounded,
      documentGroundedCustomModeActive: modeInfo.documentGroundedCustomModeActive,
      modeName: modeInfo.modeName,
    },
    flags: {
      documentGrounded: modeInfo.documentGrounded,
      documentGroundedCustomModeActive: modeInfo.documentGroundedCustomModeActive,
      forceDocumentGrounding: true,
    },
    reference_file: {
      id: 'see fixtures',
      name: 'mixed: 1 PDF + 5 text fixtures',
      pageCount: modeInfo.hasReferenceFiles ? '(see ingestion-diag.json)' : undefined,
      chunkCount: snippets.length,
      sectionCount: queryMatchedSections.length,
    },
    retrieval: {
      generated_query: q,
      extracted_entities: 'see ModeContextRetriever extractHighSignalEntityTerms (not exported; inferred from prod logs)',
      retrieved_chunks: snippets,
      chunks_in_prompt: snippets.length,
      topReferenceScores,
      queryMatchedPages,
      queryMatchedSections,
      has_identity_block: hasIdentityBlock,
      context_block_length: contextBlock.length,
      context_block_head: contextBlock.slice(0, 600),
      // Captured from production console.log ([ModeContextRetriever] document-grounded retrieval):
      prod_top_reference_scores: prodTopScores,
      prod_query_matched_pages: prodMatchedPages,
      prod_query_matched_sections: prodMatchedSections,
      prod_reference_file_page_count: prodReferenceFilePageCount,
      prod_reference_file_chunk_count: prodReferenceFileChunkCount,
      prod_retrieved_reference_chunks: prodRetrievedReferenceChunks,
      prod_reference_file_ingested_by_page_heuristic: prodReferenceFileIngestedByPageHeuristic,
      targeted_retry_triggered: false, // populated by retriever's own logs (not captured in this trace)
      targeted_retry_terms: [],
      targeted_retry_chunks: 0,
    },
    prompt: {
      char_count: trimmed ? (answer.length + contextBlock.length) : 0,
      head: '',
      tail: '',
      includes_profile: /resume|candidate|TalentScope|work experience|career/i.test(contextBlock),
      includes_resume: /resume/i.test(contextBlock),
      includes_jd: /job description|\bjd\b/i.test(contextBlock),
      includes_history: /prior assistant|previous answer|earlier turn/i.test(contextBlock),
    },
    provider: {
      model: 'natively',
      is_natively: true,
      serverModel: reported,
      gemini_model: reported && /gemini/i.test(reported) ? reported : null,
    },
    validation: {
      passed: pass,
      why: [
        signalFail ? `MISSING ALL expected terms: ${missing.join(', ')}` : null,
        greetingFail ? 'GREETING' : null,
        driftFail ? `DRIFT: ${driftHit.join(', ')}` : null,
        empty ? 'EMPTY/TINY' : null,
        isNotMentioned ? 'SAID NOT MENTIONED (flagged for follow-up; matches fail-closed cue)' : null,
      ].filter(Boolean).join('; ') || 'ok',
    },
    session_tracker: { saved: 'unknown — would require GUI; see LLMHelper docs', id: null },
    error: err ? String(err.message || err) : null,
  };
}

async function main() {
  await app.whenReady();

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm', 'prompts.js'));

  // Build a fresh seminar mode in the throwaway DB.
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/seminar/i.test(m.name)) { try { mm.deleteMode(m.id); } catch (_) { /* ignore */ } }
  }
  const mode = mm.createMode({ name: 'Seminar Presentation Assistant (Trace)', templateType: 'general' });
  const modeId = mode.id;
  mm.updateMode(modeId, { customContext: CUSTOM_PROMPT });
  // Add the real PDF + the 5 text files so the corpus mirrors production.
  // PDFs are read with pdf-parse so we get the actual extracted text plus a
  // real pageCount (mirrors the production reference-file upload IPC, which
  // also passes pdf-parse's `data.total` into the DB row).
  for (const fileName of FIXTURE_FILES) {
    const fullPath = path.join(FIXTURE_DIR, fileName);
    let content;
    let pageCount;
    let extractedPageCount;
    if (/\.pdf$/i.test(fileName)) {
      try {
        const { PDFParse } = require(path.join(repoRoot, 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'index.cjs'));
        const buf = fs.readFileSync(fullPath);
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo();
        await parser.destroy();
        content = textResult?.text || '';
        pageCount = infoResult?.total ?? infoResult?.numpages ?? textResult?.pages?.length ?? undefined;
        extractedPageCount = textResult?.pages?.length ?? undefined;
        console.log(`[trace] PDF "${fileName}" parsed: pageCount=${pageCount} extractedPages=${extractedPageCount} chars=${content.length}`);
      } catch (e) {
        console.warn(`[trace] pdf-parse failed for ${fileName}, skipping:`, e.message);
        continue;
      }
    } else {
      content = fs.readFileSync(fullPath, 'utf8');
    }
    mm.addReferenceFile({ modeId, fileName, content, pageCount, extractedPageCount });
  }
  mm.setActiveMode(modeId);

  const grounding = mm.getActiveModeDocumentGroundingInfo();
  console.log('[trace] documentGroundedCustomModeActive =', grounding.documentGroundedCustomModeActive);
  console.log('[trace] hasReferenceFiles =', grounding.hasReferenceFiles);
  console.log('[trace] reference file count =', mm.getReferenceFiles(modeId).length);

  // Task 3 — ingestion diagnostic
  await runIngestionDiag({ modesMgr: mm, modeId });

  // Set up the LLM helper to use the natively backend with the real key.
  const llmHelper = new LLMHelper();
  llmHelper.setNativelyKey(KEY);
  llmHelper.setModel('natively');

  // LLM factory: drive the production streamChat so we get the full
  // CHAT_MODE_PROMPT + doc-grounded shaping + natively backend + serverModel.
  async function llmFactory(systemPrompt, userPayload, signal) {
    let out = '';
    try {
      const gen = llmHelper.streamChat(
        userPayload,            // message = shaped user payload
        undefined,              // imagePaths
        undefined,              // context (already inside userPayload)
        systemPrompt,           // system prompt override = CHAT_MODE + doc-grounded override
        true,                   // ignoreKnowledgeMode
        true,                   // skipModeInjection (we already pulled active-mode context)
        [],                     // extraDataScopes
        signal,                 // abortSignal
      );
      for await (const tok of gen) {
        if (typeof tok === 'string') out += tok;
        if (signal && signal.aborted) break;
      }
    } catch (e) {
      if (signal && signal.aborted) {
        // ignore
      } else {
        throw e;
      }
    }
    return out;
  }

  const summary = { started_at: new Date().toISOString(), questions: [] };
  const failureRootCauses = {};

  for (const qDef of QUESTIONS) {
    const trace = await traceQuestion(llmHelper, mm, modeId, qDef, llmFactory);
    const outFile = path.join(outDir, `trace-q${String(qDef.idx).padStart(2, '0')}.json`);
    fs.writeFileSync(outFile, JSON.stringify(trace, null, 2));
    console.log(`\n[trace] Q${qDef.idx} ${trace.pass ? 'PASS' : 'FAIL'} — ${qDef.q}`);
    console.log(`         serverModel=${trace.provider.serverModel || '?'} latency=${trace.timings_ms.llm}ms`);
    console.log(`         chunks=${trace.retrieval.chunks_in_prompt} matched=${trace.matched_terms.length}/${trace.expected_evidence_terms.length}`);
    console.log(`         A: ${trace.answer.slice(0, 220).replace(/\n/g, ' / ')}${trace.answer.length > 220 ? ' …' : ''}`);
    if (!trace.pass) {
      console.log(`         WHY: ${trace.validation.why}`);
    }

    // For task 4: dump the FULL prompt for the smoke-gun question (Q4 Mercury
    // X1 DoF, which PASSED) and the two FAIL cases (Q2 + Q8) so the assembled
    // prompt is observable for every interesting question.
    if ([2, 4, 8].includes(qDef.idx)) {
      try {
        const dgPrompt = require(path.join(distRoot, 'llm', 'documentGroundedPrompt.js'));
        const ctxBlock = mm.buildRetrievedActiveModeContextBlock(
          qDef.q, undefined, 1800, 'lecture_answer', true, modeId, { forceDocumentGrounding: true },
        ) || '';
        const userPayload = dgPrompt.buildDocumentGroundedUserContent({
          question: qDef.q, retrievedBlock: ctxBlock, active: true,
        }) || `CONTEXT:\n${ctxBlock}\n\nUSER QUESTION:\n${qDef.q}`;
        const fullPrompt = `===== SYSTEM PROMPT =====\n${CHAT_MODE_PROMPT}\n===== USER PAYLOAD =====\n${userPayload}`;
        const padded = String(qDef.idx).padStart(2, '0');
        fs.writeFileSync(path.join(outDir, `full-prompt-q${padded}.txt`), fullPrompt);
      } catch (e) {
        fs.writeFileSync(path.join(outDir, `full-prompt-q${String(qDef.idx).padStart(2, '0')}.txt`), `ERROR: ${e.message}`);
      }
    }

    summary.questions.push({
      idx: qDef.idx,
      question: qDef.q,
      pass: trace.pass,
      why: trace.validation.why,
      matched: trace.matched_terms,
      missing: trace.missing_terms,
      serverModel: trace.provider.serverModel,
      latency_ms: trace.timings_ms.llm,
      answer_excerpt: trace.answer.slice(0, 160),
    });

    if (!trace.pass) {
      failureRootCauses[`q${qDef.idx}`] = {
        root_cause: trace.validation.why,
        matched: trace.matched_terms,
        missing: trace.missing_terms,
        chunks_in_prompt: trace.retrieval.chunks_in_prompt,
        top_scores: trace.retrieval.topReferenceScores,
        answer: trace.answer.slice(0, 400),
      };
    }
  }

  // Task 5 — SessionTracker dump.
  // Since this is headless, the live SessionTracker lives in app state but is
  // not the same instance. We can read the temp DB to confirm mode + files
  // were persisted, then dump a synthetic SessionTracker view from the
  // captured answer history.
  try {
    const sessionDump = {
      note: 'Headless run — true live SessionTracker requires the GUI. Capturing the observable artifact: the answers that would have been re-fed via the rolling 100s context (autoContextSnapshot) if the user kept typing.',
      answers_observed_in_order: summary.questions.map(q => ({
        idx: q.idx, pass: q.pass, excerpt: q.answer_excerpt,
      })),
      would_next_question_see_a_bad_answer: summary.questions.some(q => !q.pass),
      modes_persisted: mm.getModes().map(m => ({ id: m.id, name: m.name, templateType: m.templateType, customContextLength: m.customContext.length })),
      reference_files_persisted: mm.getReferenceFiles(modeId).map(f => ({ id: f.id, fileName: f.fileName, contentLength: f.content.length })),
    };
    fs.writeFileSync(path.join(outDir, 'session-tracker-state.json'), JSON.stringify(sessionDump, null, 2));
  } catch (e) {
    fs.writeFileSync(path.join(outDir, 'session-tracker-state.json'), JSON.stringify({ error: String(e.message) }, null, 2));
  }

  summary.completed_at = new Date().toISOString();
  summary.server_models_observed = Array.from(new Set(summary.questions.map(q => q.serverModel).filter(Boolean)));
  summary.failure_root_causes = failureRootCauses;
  fs.writeFileSync(path.join(outDir, 'trace-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n[trace] ===== DONE =====');
  console.log(`[trace] pass=${summary.questions.filter(q => q.pass).length}/${summary.questions.length}`);
  console.log(`[trace] serverModels observed: ${summary.server_models_observed.join(', ') || '(none)'}`);
  console.log(`[trace] artifacts written to ${outDir}`);

  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('[trace] FATAL:', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) { /* noop */ }
  process.exit(2);
});