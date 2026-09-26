// scripts/benchmark-thesis-doc-grounded-retrieval.js
//
// OKF Phase 0 retrieval-only benchmark (no LLM calls). Loads
// "Sample thesis for testing.pdf" through the real ingestion path, activates
// a document-grounded custom mode, and runs the 19 OKF benchmark questions
// through the REAL retrieval pipeline (ModesManager.buildRetrievedActiveModeContextBlock)
// — the exact entry point LLMHelper._streamChatInner uses. No model call is
// made; this measures retrieval coverage only.
//
// Run:
//   npm run build:electron
//   ./node_modules/.bin/electron scripts/benchmark-thesis-doc-grounded-retrieval.js
//
// Output: ./debug-artifacts/okf-thesis-benchmark/retrieval-baseline.json

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-bench-'));
app.setPath('userData', tmpUserData);

const PDF_PATH = process.env.OKF_BENCH_PDF || path.join(repoRoot, 'Sample thesis for testing.pdf');
const OUT_DIR = path.join(repoRoot, 'debug-artifacts', 'okf-thesis-benchmark');
const OUT_FILE = path.join(OUT_DIR, 'retrieval-baseline.json');

// The 19 OKF benchmark questions, each with the expected-evidence regexes the
// retrieved context block must satisfy for a "pass".
const QUESTIONS = [
  { q: 'What is the main topic of my thesis?', expect: [/agentic ai|vision-language-action|vla|embodied/i] },
  { q: 'Explain my thesis in simple words.', expect: [/agentic|vla|robot/i] },
  { q: 'What problem is this thesis trying to solve?', expect: [/lack|autonomy|limitation|contextual/i] },
  { q: 'What are the two research questions?', expect: [/research question|RQ1|RQ2/i] },
  { q: 'What are the main objectives of the thesis?', expect: [/objective|phase|teleoperation|methodology/i] },
  { q: 'How is this thesis connected to embodied AI?', expect: [/embodied/i] },
  { q: 'What does embodied cognition mean in this thesis?', expect: [/embodied cognition/i] },
  { q: 'How is this thesis related to AGI?', expect: [/AGI|general intelligence/i] },
  { q: 'Why are VLA models important for robotics? What are the limitations of current VLA models?', expect: [/vla/i] },
  { q: 'What is a Vision-Language-Action model?', expect: [/vision-language-action|vla/i] },
  { q: 'What is OpenVLA?', expect: [/openvla/i] },
  { q: 'What is OpenVLA-OFT?', expect: [/openvla-oft/i] },
  { q: 'How is OpenVLA-OFT different from OpenVLA?', expect: [/openvla-oft/i, /openvla/i] },
  { q: 'What is Agentic AI?', expect: [/agentic ai/i] },
  { q: 'What are the three core components of an AI agent?', expect: [/model|tool|instruction/i] },
  { q: 'What is AutoGen used for in this thesis?', expect: [/autogen/i] },
  { q: 'Why was AutoGen selected over other frameworks?', expect: [/autogen/i] },
  { q: 'What is AgenticVLA?', expect: [/agenticvla/i] },
  { q: 'Why does AgenticVLA improve over a normal VLA?', expect: [/agenticvla/i] },
];

async function ingestPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (pdfjsLib) {
    try {
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(workerPath).href;
    } catch { /* best effort */ }
  }
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(pdfPath) }).getText();
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return {
      content: data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n'),
      pageCount: data.pages.length,
    };
  }
  return { content: data.text || '', pageCount: 0 };
}

function extractMatchedPages(block) {
  const matches = block.match(/\[Page (\d+)\]/g) || [];
  return [...new Set(matches.map((m) => Number(m.match(/\d+/)[0])))].sort((a, b) => a - b);
}

function extractMatchedSections(block) {
  const matches = block.match(/\[Section ([\d.]+[^\]]*)\]/g) || [];
  return [...new Set(matches.map((m) => m.replace(/^\[Section /, '').replace(/\]$/, '')))];
}

async function main() {
  await app.whenReady();

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`[okf-bench] FATAL: PDF not found at ${PDF_PATH}`);
    process.exit(1);
  }

  const { content, pageCount } = await ingestPdfText(PDF_PATH);
  console.log(`[okf-bench] ingested ${PDF_PATH} — contentChars=${content.length} pageCount=${pageCount} pageMarkers=${(content.match(/\[Page \d+\]/g) || []).length}`);

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));

  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/okf.?bench|thesis/i.test(m.name)) {
      try { mm.deleteMode(m.id); } catch { /* ignore */ }
    }
  }
  const CUSTOM_PROMPT = [
    'Act as my real-time seminar presentation assistant.',
    'I have uploaded a thesis/seminar reference file.',
    'Answer from the uploaded reference material as the source of truth.',
    'Do not use knowledge outside the uploaded material to invent facts.',
  ].join(' ');
  const mode = mm.createMode({ name: 'OKF Bench Thesis', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: CUSTOM_PROMPT });
  mm.addReferenceFile({ modeId: mode.id, fileName: 'Sample thesis for testing.pdf', content });
  mm.setActiveMode(mode.id);

  const grounding = mm.getActiveModeDocumentGroundingInfo();
  if (grounding.documentGroundedCustomModeActive !== true) {
    console.error('[okf-bench] FATAL: documentGroundedCustomModeActive is not true', grounding);
    process.exit(1);
  }

  const results = [];
  let passCount = 0;
  for (const { q, expect } of QUESTIONS) {
    const start = Date.now();
    let block = '';
    try {
      block = mm.buildRetrievedActiveModeContextBlock(
        q, undefined, undefined, 'lecture_answer', true, undefined, { forceDocumentGrounding: true },
      ) || '';
    } catch (err) {
      console.error(`[okf-bench] retrieval threw for "${q}":`, err && err.message);
    }
    const elapsedMs = Date.now() - start;
    const matchedPages = extractMatchedPages(block);
    const matchedSections = extractMatchedSections(block);
    const blockLower = block.toLowerCase();
    const expectedEvidenceFound = expect.map((re) => re.test(block));
    const pass = expectedEvidenceFound.every(Boolean);
    if (pass) passCount++;
    const topChunks = block
      .split(/\n\n(?=\[(?:Page|Section) )/)
      .slice(0, 3)
      .map((c) => c.slice(0, 220));
    results.push({
      question: q,
      retrievedPages: matchedPages,
      retrievedSections: matchedSections,
      topChunks,
      expectedEvidenceFound: expect.map((re, i) => ({ pattern: String(re), found: expectedEvidenceFound[i] })),
      pass,
      blockChars: block.length,
      elapsedMs,
    });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${q}  pages=[${matchedPages.join(',')}] chars=${block.length} ${elapsedMs}ms`);
  }

  const summary = {
    timestamp: new Date().toISOString(),
    pdfPath: PDF_PATH,
    pageCount,
    totalQuestions: QUESTIONS.length,
    passCount,
    passRate: passCount / QUESTIONS.length,
    results,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2));
  console.log(`\n[okf-bench] ${passCount}/${QUESTIONS.length} passed (${(summary.passRate * 100).toFixed(1)}%)`);
  console.log(`[okf-bench] wrote ${OUT_FILE}`);

  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('[okf-bench] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
