// scripts/live-custom-mode-source-regression.js
// Live Gemini regression for custom document-grounded source isolation.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv(path.join(repoRoot, '.env'));
loadDotEnv(path.join(repoRoot, 'natively-api', '.env'));

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
if (!GEMINI_KEY) {
  console.error('[live-regression] missing GEMINI_API_KEY/GOOGLE_API_KEY in .env');
  process.exit(2);
}

const enforce = process.env.NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT === '1' || process.env.ENFORCE_SOURCE === '1';
process.env.NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT = enforce ? '1' : '0';
process.env.NATIVELY_RETRIEVAL_DIAGNOSTICS = process.env.NATIVELY_RETRIEVAL_DIAGNOSTICS || '1';
process.env.NATIVELY_TRACE = process.env.NATIVELY_TRACE || '1';

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), `natively-cmsi-${enforce ? 'on' : 'off'}-`));
app.setPath('userData', tmpUserData);

const outDir = path.join(repoRoot, 'debug-artifacts', 'custom-mode-source-regression');
fs.mkdirSync(outDir, { recursive: true });

const CUSTOM_PROMPT = [
  'Act as my real-time seminar presentation assistant.',
  'I have uploaded a seminar/thesis file.',
  'Answer from the uploaded seminar content first.',
  'Do not invent facts, numbers, methods, results, or claims.',
  'If something is not in the file, say it is not directly mentioned in my seminar material.',
  'Keep answers natural, confident, student-friendly, and speakable.',
].join(' ');

const FIXTURE_DIR = path.join(repoRoot, 'tests/fixtures/modes/custom/seminar-presentation');
const FIXTURE_FILES = [
  'seminar_vla_overview.txt',
  'seminar_hardware_specs.txt',
  'seminar_controller_specs.md',
  'seminar_simulation_stack.md',
  'seminar_evaluation_results.csv',
  'seminar_dataset_training.txt',
  'seminar_custom_prompt_rules.txt',
  'seminar_real_thesis.pdf',
];

const TARGETED = [
  'What are the four main phases of the project?',
  'What hardware was used for teleoperation?',
  'What processor controls the Mercury X1?',
  'What are the key specifications of the Mercury X1?',
  'What was the total cost of building the teleoperation system?',
  'What throughput improvement does that give?',
];

const FULL_30 = [
  ...TARGETED,
  'What is the main topic of my thesis?',
  'What are the two research questions?',
  'What is OpenVLA?',
  'What is OpenVLA-OFT?',
  'How is OpenVLA-OFT different from OpenVLA?',
  'What is AgenticVLA?',
  'What is the Mercury X1 robot?',
  'How many degrees of freedom does Mercury X1 have?',
  'What sensors does Mercury X1 use?',
  'What is the role of ROS#?',
  'What is the role of Unity?',
  'What camera setup was used for data collection?',
  'What was LoRA used for?',
  'What evaluation metrics were used?',
  'What VR headset was used for teleoperation?',
  'How many parameters does OpenVLA have?',
  'What is AgenticVLA built on?',
  'What framework was used for the agentic system?',
  'How many cameras were used for data collection?',
  'What benchmark showed 43x faster throughput?',
  'What task did the robot perform in the dataset?',
  'What format was the dataset stored in?',
  'What GPU memory/VRAM numbers are mentioned?',
  'What dataset sizes and sampling rates are mentioned?',
];

function xmlUnescape(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function parseSnippets(block) {
  const out = [];
  const re = /<snippet>([\s\S]*?)<\/snippet>/g;
  let m;
  while ((m = re.exec(block || ''))) {
    const source = (m[1].match(/<source>([\s\S]*?)<\/source>/) || [])[1] || '';
    const text = xmlUnescape((m[1].match(/<text>([\s\S]*?)<\/text>/) || [])[1] || '');
    let src = null;
    try { src = JSON.parse(source); } catch {}
    out.push({
      source: src,
      text,
      section: (text.match(/^\[Section\s+([\d.]+)\s*\|\s*p([^\]]+)\]/) || []).slice(1).join(' p') || null,
      first120: text.replace(/\s+/g, ' ').slice(0, 120),
    });
  }
  return out;
}

function judge(question, answer, validation) {
  const a = answer.toLowerCase();
  const fails = [];
  if (/natively/i.test(answer)) fails.push('mentions Natively');
  if (question.includes('processor controls')) {
    if (!/jetson\s+xavier/i.test(answer) || !/jetson\s+nano/i.test(answer)) fails.push('missing Jetson Xavier + Jetson Nano');
    if (/esp32/i.test(answer)) fails.push('mentions ESP32 for processor question');
    if (/xavier\s+nx/i.test(answer)) fails.push('mentions Xavier NX');
  }
  if (question.includes('hardware was used')) {
    for (const t of ['Mercury X1', 'Meta Quest 3', 'Orbbec Deeyea', 'Logitech C920']) if (!new RegExp(t.replace(/ /g, '\\s+'), 'i').test(answer)) fails.push(`missing ${t}`);
  }
  if (question.includes('total cost')) {
    if (!/could not find|not.*retrieved|not.*document|not.*material|not mentioned|not specified/i.test(answer)) fails.push('did not refuse absent cost');
  }
  if (question.includes('throughput improvement')) {
    if (!/43\s*x|43-fold|43 times/i.test(answer)) fails.push('missing 43x');
  }
  if (question.includes('dataset sizes and sampling')) {
    for (const t of ['480', '50', '25']) if (!a.includes(t)) fails.push(`missing ${t}`);
  }
  if (question.includes('VRAM')) {
    for (const t of ['96', '62', '24', '16']) if (!a.includes(t)) fails.push(`missing ${t} GB`);
  }
  if (validation && validation.action !== 'ship') fails.push(`validator=${validation.action}:${validation.reason}`);
  return { pass: fails.length === 0, reason: fails.join('; ') || 'ok' };
}

async function collect(gen) { let out = ''; for await (const t of gen) if (typeof t === 'string') out += t; return out; }

function buildRepairPrompt({ question, answer, retrievedBlock, reason, missing }) {
  const missingLine = missing && missing.length ? `\nValidator says the previous answer omitted these in-snippet values: ${missing.join(', ')}` : '';
  return [
    `QUESTION: ${question}`,
    '',
    'The previous answer failed document-grounded validation.',
    `Validation reason: ${reason || 'retry'}.${missingLine}`,
    '',
    'Previous answer:',
    answer || '(empty)',
    '',
    'Repair the answer using ONLY facts literally present in the retrieved excerpts below.',
    'If the excerpt contains the requested value, do not refuse. If the question asks for multiple values, scan every snippet and include every matching value already written there. Do not add any value that is not in the snippets.',
    '',
    'RETRIEVED EXCERPTS:',
    retrievedBlock || '(none)',
    '',
    `Now answer the original question directly and concisely: ${question}`,
  ].join('\n');
}

async function addFile(mm, modeId, fileName) {
  const fullPath = path.join(FIXTURE_DIR, fileName);
  let content = '';
  let pageCount, extractedPageCount;
  if (/\.pdf$/i.test(fileName)) {
    const { PDFParse } = require(path.join(repoRoot, 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'index.cjs'));
    const buf = fs.readFileSync(fullPath);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    await parser.destroy();
    content = textResult?.text || '';
    pageCount = infoResult?.total ?? infoResult?.numpages ?? textResult?.pages?.length ?? undefined;
    extractedPageCount = textResult?.pages?.length ?? undefined;
  } else {
    content = fs.readFileSync(fullPath, 'utf8');
  }
  mm.addReferenceFile({ modeId, fileName, content, pageCount, extractedPageCount });
}

async function main() {
  await app.whenReady();
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm', 'prompts.js'));
  const dg = require(path.join(distRoot, 'llm', 'documentGroundedPrompt.js'));
  const csi = require(path.join(distRoot, 'llm', 'customModeExecutionContract.js'));

  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) if (/source regression|seminar/i.test(m.name)) { try { mm.deleteMode(m.id); } catch {} }
  const mode = mm.createMode({ name: `Source Regression ${enforce ? 'ON' : 'OFF'}`, templateType: 'general' });
  mm.updateMode(mode.id, { customContext: CUSTOM_PROMPT });
  for (const f of FIXTURE_FILES) await addFile(mm, mode.id, f);
  mm.setActiveMode(mode.id);

  const llm = new LLMHelper(GEMINI_KEY);
  llm.setModel(process.env.E2E_MODEL || 'gemini');

  const questions = process.env.TEST_SET === 'targeted' ? TARGETED : FULL_30;
  const results = [];
  const capturedLogs = [];
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  const cap = (...args) => {
    const txt = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
    capturedLogs.push(txt);
  };
  console.log = (...args) => { cap(...args); return origLog.apply(console, args); };
  console.warn = (...args) => { cap(...args); return origWarn.apply(console, args); };
  console.error = (...args) => { cap(...args); return origErr.apply(console, args); };

  let previousAnswer = '';
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const answerType = dg.classifyDocumentQuestionShape(question, previousAnswer);
    const contract = csi.buildCustomModeExecutionContract({
      question,
      streamRoute: 'manual_chat_stream',
      modeId: mode.id,
      modeUniqueId: mode.id,
      answerType,
      isCustomMode: true,
      isDocGroundedCustomModeActive: true,
      hasReferenceFiles: true,
      hasCustomPrompt: true,
      hasLiveTranscript: false,
      hasProfileFacts: true,
      hasMeetingRag: false,
      hasLongTermMemory: true,
    });
    csi.logArbitratedContract(contract, question);

    const retrievedBlock = mm.buildRetrievedActiveModeContextBlock(
      question,
      undefined,
      undefined,
      answerType,
      true,
      mode.id,
      { forceDocumentGrounding: true, followUpReferentHint: previousAnswer || undefined },
    ) || '';
    const snippets = parseSnippets(retrievedBlock);

    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), Number(process.env.LIVE_Q_TIMEOUT_MS || 45000));
    let answer = '', error = null;
    const start = Date.now();
    try {
      answer = await collect(llm.streamChat(
        question,
        undefined,
        undefined,
        CHAT_MODE_PROMPT,
        false,
        false,
        [],
        ctl.signal,
        undefined,
        { answerType },
      ));
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      clearTimeout(timeout);
    }
    answer = answer.trim();
    let finalAnswer = answer;
    let docValidation = dg.validateDocumentGroundedAnswer({ question, answer: finalAnswer, retrievedBlock, answerType });
    let sourceValidation = csi.validateAgainstSourceContract({ contract, question, answer: finalAnswer, retrievedBlock });
    let regenRan = false;
    let regenError = null;
    let repairedFrom = null;
    if (!error && (!docValidation.ok || sourceValidation.action !== 'ship')) {
      const repairCtl = new AbortController();
      const repairTimeout = setTimeout(() => repairCtl.abort(), Number(process.env.LIVE_Q_TIMEOUT_MS || 45000));
      try {
        const repairPrompt = buildRepairPrompt({
          question,
          answer: finalAnswer,
          retrievedBlock,
          reason: !docValidation.ok ? docValidation.reason : sourceValidation.reason,
          missing: docValidation.missing || [],
        });
        const repaired = (await collect(llm.streamChat(
          repairPrompt,
          undefined,
          undefined,
          CHAT_MODE_PROMPT,
          false,
          false,
          [],
          repairCtl.signal,
          undefined,
          { answerType },
        ))).trim();
        if (repaired && !dg.completenessRegenFabricates(repaired, retrievedBlock)) {
          const repairedDocValidation = dg.validateDocumentGroundedAnswer({ question, answer: repaired, retrievedBlock, answerType });
          const repairedSourceValidation = csi.validateAgainstSourceContract({ contract, question, answer: repaired, retrievedBlock });
          if ((repairedDocValidation.ok || repairedDocValidation.action === 'ship') && repairedSourceValidation.action === 'ship') {
            repairedFrom = finalAnswer;
            finalAnswer = repaired;
            docValidation = repairedDocValidation;
            sourceValidation = repairedSourceValidation;
            regenRan = true;
          } else {
            regenError = `repair_rejected:${!repairedDocValidation.ok ? repairedDocValidation.reason : repairedSourceValidation.reason}`;
          }
        } else {
          regenError = repaired ? 'repair_fabricates' : 'repair_empty';
        }
      } catch (e) {
        regenError = e?.message || String(e);
      } finally {
        clearTimeout(repairTimeout);
      }
    }
    const finalAction = !docValidation.ok ? docValidation.action : sourceValidation.action;
    const finalReason = !docValidation.ok ? docValidation.reason : sourceValidation.reason;
    const localJudge = judge(question, finalAnswer, sourceValidation);
    const row = {
      idx: i + 1,
      question,
      answer: finalAnswer,
      originalAnswer: repairedFrom,
      answerType,
      selectedSourceContract: contract.sourceAuthority,
      validatorRan: dg.isDocGroundedAnswerType(answerType),
      sourceContractValidatorRan: true,
      regenRan,
      regenError,
      topRetrievedSections: snippets.slice(0, 5).map(s => s.section || s.first120),
      finalValidationAction: finalAction,
      finalValidationReason: finalReason,
      pass: localJudge.pass,
      reason: localJudge.reason,
      timingsMs: Date.now() - start,
      providerModel: llm.getLastProviderModel ? llm.getLastProviderModel() : null,
      error,
    };
    results.push(row);
    origLog(`[live-regression] ${enforce ? 'ON' : 'OFF'} Q${i + 1}/${questions.length} ${row.pass ? 'PASS' : 'FAIL'} ${question}`);
    origLog(`  type=${answerType} action=${finalAction} contract=${contract.sourceAuthority} ${row.reason}`);
    origLog(`  A: ${finalAnswer.slice(0, 220).replace(/\n/g, ' ')}${finalAnswer.length > 220 ? '…' : ''}`);
    previousAnswer = finalAnswer || previousAnswer;
  }

  console.log = origLog; console.warn = origWarn; console.error = origErr;
  const summary = {
    enforcement: enforce ? 'ON' : 'OFF',
    model: process.env.E2E_MODEL || 'gemini',
    questionSet: process.env.TEST_SET === 'targeted' ? 'targeted' : 'full30',
    pass: results.filter(r => r.pass).length,
    total: results.length,
    results,
    logs: {
      sourceArbiter: capturedLogs.filter(l => l.includes('[SOURCE-ARBITER]')),
      sourceGuard: capturedLogs.filter(l => l.includes('[SOURCE-GUARD]')),
      retrieval: capturedLogs.filter(l => l.includes('document-grounded retrieval') || l.includes('DOC-RANK') || l.includes('LEXICAL')),
      validators: capturedLogs.filter(l => l.includes('[DocGrounded]') || l.includes('validator')),
    },
  };
  const outFile = path.join(outDir, `${summary.questionSet}-${enforce ? 'enforcement-on' : 'enforcement-off'}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`[live-regression] wrote ${outFile}`);
  console.log(`[live-regression] score ${summary.pass}/${summary.total}`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  process.exit(summary.pass >= (summary.total === 6 ? 6 : 28) ? 0 : 1);
}

main().catch((e) => {
  console.error('[live-regression] FATAL', e);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  process.exit(2);
});
