// scripts/smoke-okf-live-thesis.js
//
// OKF Phase 3 live verification: drives the REAL document-grounded path
// (ModesManager + KnowledgeManager OKF cards + LLMHelper.streamChat) against
// the real thesis PDF and a real Gemini key, with okfHybridRetrieval ON.
// Mirrors scripts/e2e-thesis-real-path.js but uses GEMINI_API_KEY directly
// (no NATIVELY_API_KEY needed) so it can run with the keys already in .env.
//
// Run:
//   npm run build:electron
//   ./node_modules/.bin/electron scripts/smoke-okf-live-thesis.js
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4, process.env.GEMINI_API_KEY_5, process.env.GEMINI_API_KEY_6,
].filter(Boolean);
const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_7, process.env.GROQ_API_KEY_8,
  process.env.GROQ_API_KEY_9, process.env.GROQ_API_KEY_10,
].filter(Boolean);
let groqCursor = 0;
function nextGroqKey() { const k = GROQ_KEYS[groqCursor % GROQ_KEYS.length]; groqCursor++; return k; }

if (GEMINI_KEYS.length === 0 && GROQ_KEYS.length === 0) {
  console.log('[smoke-okf-live] SKIP — no GEMINI_API_KEY or GROQ_API_KEY in .env');
  process.exit(0);
}

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-okf-live-'));
app.setPath('userData', tmpUserData);

const CUSTOM_PROMPT = [
  'Act as my real-time seminar presentation assistant.',
  'I have uploaded a seminar/thesis file.',
  'Answer from the uploaded seminar content first.',
  'Do not invent facts, numbers, methods, or results.',
  'Use only the uploaded reference material as source of truth.',
].join(' ');

const QUESTIONS = [
  { q: 'What is the main topic of my thesis?', must: [/agentic ai|vision-language-action|vla|embodied/i] },
  { q: 'What are the two research questions?', must: [/research question|RQ1|RQ2/i] },
  { q: 'What is OpenVLA?', must: [/openvla/i], should: [/7b|7 billion/i] },
  { q: 'What is OpenVLA-OFT?', must: [/openvla-oft/i], should: [/parallel decoding|action chunk|43x|43 times|fine-?tun/i] },
  { q: 'How is OpenVLA-OFT different from OpenVLA?', must: [/openvla-oft/i] },
  { q: 'What is Agentic AI?', must: [/agent/i] },
  { q: 'What are the three core components of an AI agent?', must: [/model/i], should: [/tool/i, /instruction/i] },
  { q: 'What is AgenticVLA?', must: [/agenticvla|agentic/i] },
  { q: 'Why does AgenticVLA improve over a normal VLA?', must: [/agenticvla/i] },
];

const GREETING = /what would you like help with|how can i help|what can i (?:help|do)/i;
const REFUSAL_PHRASE = /i could not find that in the retrieved sections/i;

async function collect(gen) { let o = ''; for await (const t of gen) o += t; return o; }

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
    return data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n');
  }
  return data.text || '';
}

async function main() {
  await app.whenReady();
  process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '1';
  process.env.NATIVELY_OKF_HYBRID_RETRIEVAL = '1';

  const pdfPath = path.join(repoRoot, 'Sample thesis for testing.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.log('[smoke-okf-live] SKIP — no thesis PDF at repo root');
    process.exit(0);
  }
  const content = await ingestPdfText(pdfPath);
  console.log(`[smoke-okf-live] ingested ${content.length} chars`);

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const { KnowledgeManager } = require(path.join(distRoot, 'services/knowledge/KnowledgeManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));

  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) if (/thesis|okf/i.test(m.name)) { try { mm.deleteMode(m.id); } catch { /* ignore */ } }
  const mode = mm.createMode({ name: 'OKF Live Thesis', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: CUSTOM_PROMPT });
  const file = mm.addReferenceFile({ modeId: mode.id, fileName: 'thesis.pdf', content });
  mm.setActiveMode(mode.id);

  const pack = KnowledgeManager.getInstance().getPackForFile(file.id);
  console.log(`[smoke-okf-live] OKF pack: ${pack ? pack.cards.length + ' cards' : 'NONE'}`);
  if (!pack || pack.cards.length === 0) {
    console.error('[smoke-okf-live] FATAL: expected an OKF pack with cards');
    process.exit(1);
  }

  if (mm.getActiveModeDocumentGroundingInfo().documentGroundedCustomModeActive !== true) {
    console.error('[smoke-okf-live] FATAL: documentGroundedCustomModeActive is not true');
    process.exit(1);
  }

  const useGroq = GROQ_KEYS.length > 0;
  console.log(`[smoke-okf-live] using provider=${useGroq ? 'groq' : 'gemini'} (${useGroq ? GROQ_KEYS.length : GEMINI_KEYS.length} keys for rotation)`);

  let pass = 0, fail = 0;
  for (const c of QUESTIONS) {
    // Groq's on-demand tier has a 12k TPM ceiling PER KEY; the doc-grounded
    // prompt (system override + identity block + cards + chunks) can exceed
    // that on a single key. Rotate to a fresh key per question so each
    // request starts with a fresh per-key token budget — same pattern as
    // scripts/smoke-document-grounded.js's pickGroqKey().
    const llm = useGroq
      ? new LLMHelper(undefined, false, undefined, undefined, nextGroqKey())
      : new LLMHelper(GEMINI_KEYS[0]);
    if (useGroq) {
      llm.setModel('llama');
    } else {
      llm.setApiKey(GEMINI_KEYS[0]);
      llm.setModel('gemini-3.1-flash-lite');
    }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 30000);
    let ans = '';
    try {
      ans = await collect(llm.streamChat(c.q, undefined, undefined, CHAT_MODE_PROMPT, false, false, [], ctl.signal, undefined, { answerType: 'lecture_answer' }));
    } catch (err) { ans = `ERROR: ${err?.message}`; } finally { clearTimeout(to); }
    const t = ans.trim();
    const probs = [];
    if (GREETING.test(t)) probs.push('GREETING');
    if (t.length < 8) probs.push('EMPTY');
    if (REFUSAL_PHRASE.test(t)) probs.push('REFUSED');
    const missedMust = (c.must || []).filter((re) => !re.test(t));
    if (missedMust.length) probs.push('MISS_MUST:' + missedMust.map(String).join(','));
    const missedShould = (c.should || []).filter((re) => !re.test(t));
    if (probs.length === 0) {
      pass++;
      console.log(`PASS  ${c.q}`);
      if (missedShould.length) console.log(`      (should-have miss: ${missedShould.map(String).join(',')})`);
    } else {
      fail++;
      console.log(`FAIL  ${c.q} :: ${probs.join(';')}`);
      console.log(`      → ${t.slice(0, 200).replace(/\n/g, ' ')}`);
    }
  }

  console.log(`\n[smoke-okf-live] ${pass}/${pass + fail} passed`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke-okf-live] FATAL', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(2);
});
