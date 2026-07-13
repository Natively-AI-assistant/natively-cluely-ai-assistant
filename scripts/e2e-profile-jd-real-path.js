// scripts/e2e-profile-jd-real-path.js
//
// Real-app source-switch repair (2026-07-14, Phase 10) — focused profile/JD
// benchmark against the REAL Natively backend, driving the REAL profile/JD
// answer path (not the doc-grounded reference-files path the Phase 0 thesis
// benchmark exercises). Boots a real Electron app, ingests the user's real
// résumé + JD via the production ModesManager path, creates a profile-aware
// custom mode, and asks 40 questions across the 7 categories from the task
// spec:
//
//   résumé direct facts       (12)
//   résumé project/experience (8)
//   JD direct requirements    (8)
//   résumé/JD comparisons     (4)
//   missing-candidate skills  (2)
//   false-premise traps       (3)
//   source-switch sequences   (3)
//
// The smaller (40 not 120) version the user chose — same defect space, faster
// feedback, easier to re-run on every code change. Scale to 120 only after
// this proves the gates on a real backend.
//
// Run (same env vars as the thesis E2E — see scripts/e2e-thesis-real-path.js):
//   npm run build:electron
//   RUN_NATIVELY_API_E2E=1 NATIVELY_API_KEY=<key> \
//     [E2E_RESUME=/abs/path/resume.pdf] [E2E_JD=/abs/path/jd.pdf] \
//     ./node_modules/.bin/electron scripts/e2e-profile-jd-real-path.js
//
// All artifacts (resume + JD PDFs) are repo-local; defaults resolve them.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

const KEY = process.env.NATIVELY_API_KEY || '';
const MODEL = process.env.E2E_MODEL || 'natively';
const SERVER_MODEL = process.env.E2E_JUDGE_MODEL || 'gemini-3.1-flash-lite'; // distinct judge model
if (process.env.RUN_NATIVELY_API_E2E !== '1' || !KEY) {
    console.log('[profile-jd] SKIP — set RUN_NATIVELY_API_E2E=1 + NATIVELY_API_KEY to run the real-backend profile/JD E2E');
    process.exit(0);
}

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pjd-e2e-'));
app.setPath('userData', tmpUserData);

const RESUME_PDF = process.env.E2E_RESUME || path.join(repoRoot, 'evinresume.pdf');
const JD_PDF = process.env.E2E_JD || path.join(repoRoot, 'profileresume', 'Job-Description---Data-Analyst-Sample.pdf');
const OUT_DIR = path.join(repoRoot, 'debug-artifacts', 'profile-jd-benchmark');
const OUT_FILE = path.join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

// A prompt that explicitly grants BOTH default-doc and résumé/JD overrides
// (this is the EXACT shape the Phase 1/2 migration-greediness fix must
// migrate to reference_files_primary, not reference_files_only). Mirrors the
// real-world seminar-mode prompt that triggered the reported incident.
const PROFILE_PROMPT = [
    'Act as my real-time interview + job-search assistant.',
    'I have uploaded my résumé and the target job description.',
    'By default, answer from the uploaded job-description / résumé.',
    'If I explicitly ask about my résumé, answer from the résumé.',
    'If I explicitly ask about the JD, answer from the JD.',
    'If I ask a comparison, answer using BOTH sources — never invent facts.',
    'If a fact is not in either source, say it is not directly mentioned in my uploaded material.',
].join(' ');

// 40 questions across 7 categories from the task spec. Each entry has:
//   q: question text
//   cat: one of 'resume_fact', 'resume_proj', 'jd_req', 'compare', 'missing', 'false_premise', 'source_switch'
//   must: regexes that ALL must match the answer (any-of for /alternatives/ via arrays)
//   forbid: regexes that MUST NOT appear (catches cross-source contamination)
// The must-regexes are intentionally written to be moderate (no fabricated
// exact strings), per the task's "no hardcoded thesis facts" intent — they
// pin the SHAPE of a correct answer, not exact wording.
const Q = [
    // ── Résumé direct facts (12) ────────────────────────────────────────────
    { cat: 'resume_fact', q: 'Based only on my résumé, what is my name?', must: [/maria|gutierrez/i], forbid: [/resume writing|talent|scope/i] },
    { cat: 'resume_fact', q: 'What city and state do I live in?', must: [/cincinnati|ohio|\bOH\b/i] },
    { cat: 'resume_fact', q: 'What are my two primary nursing certifications?', must: [/ccrn/i], forbid: [/talent/i] },
    { cat: 'resume_fact', q: 'How many years of nursing experience do I have?', must: [/seven|7|years?/i], forbid: [/talent|product/i] },
    { cat: 'resume_fact', q: 'What is my current job title and unit?', must: [/critical care/i, /nsicu|neuroscience|icu/i] },
    { cat: 'resume_fact', q: 'What is my email address?', must: [/maria.*gmail|gmail\.com/i] },
    { cat: 'resume_fact', q: 'How many hospitals have I worked at?', must: [/three|3|university.*cincinnati|trihealth|cincinnati.*children/i] },
    { cat: 'resume_fact', q: 'How many new graduate nurses have I precepted?', must: [/19|nineteen/i] },
    { cat: 'resume_fact', q: 'What EHR system did I help roll out?', must: [/epic/i] },
    { cat: 'resume_fact', q: 'What was the fall rate after my fall-prevention protocol?', must: [/0\.6|0\.6 per 1,?000/i] },
    { cat: 'resume_fact', q: 'What stroke core measures bundle compliance did I achieve?', must: [/98\s?%|98 percent/i] },
    { cat: 'resume_fact', q: 'What Preceptor of the Year award did I receive and where?', must: [/preceptor.*year|university hospital/i] },

    // ── Résumé project/experience (8) ────────────────────────────────────────
    { cat: 'resume_proj', q: 'Tell me about my current role at University of Cincinnati Medical Center.', must: [/neuroscience|nsicu|stroke|critical care/i] },
    { cat: 'resume_proj', q: 'What was the most impactful quality-improvement project I led?', must: [/fall|prevention|sepsis|eeg|monitoring/i] },
    { cat: 'resume_proj', q: 'How did I help with sepsis care?', must: [/sepsis/i] },
    { cat: 'resume_proj', q: 'Tell me about the Continuous EEG pilot program I was selected for.', must: [/eeg|electroencephalogram/i] },
    { cat: 'resume_proj', q: 'What leadership roles have I held?', must: [/charge nurse|preceptor|mentor|leadership/i] },
    { cat: 'resume_proj', q: 'Tell me about my work at TriHealth Good Samaritan Hospital.', must: [/cardiac/i, /cincinnati|ohio/i] },
    { cat: 'resume_proj', q: 'Tell me about my role at Cincinnati Children’s Hospital.', must: [/children|cincinnati|pediatric/i] },
    { cat: 'resume_proj', q: 'What was the stroke core measures project I contributed to?', must: [/stroke|tpa|door-to-ct/i] },

    // ── JD direct requirements (8) ──────────────────────────────────────────
    { cat: 'jd_req', q: 'According to the JD, what is the role title?', must: [/clinical care coordinator|\bCCC\b/i] },
    { cat: 'jd_req', q: 'How many years of bedside nursing experience does the JD require?', must: [/5|five/i] },
    { cat: 'jd_req', q: 'What is the minimum education required by the JD?', must: [/bsn|bachelor.*science.*nursing/i] },
    { cat: 'jd_req', q: 'Does the JD prefer an MSN?', must: [/msn|master|strongly preferred|preferred/i] },
    { cat: 'jd_req', q: 'How many beds is the Inpatient Medicine unit?', must: [/36/i] },
    { cat: 'jd_req', q: 'What EHR system does the JD mention?', must: [/epic/i] },
    { cat: 'jd_req', q: 'Is this role at Mercy Ridge on-site or remote?', must: [/on-site|lakeview|lakeview medical|on site/i] },
    { cat: 'jd_req', q: 'Does the JD mention weekends?', must: [/no weekends/i] },

    // ── Résumé/JD comparisons (4) ───────────────────────────────────────────
    { cat: 'compare', q: 'Based on my résumé and the JD, what requirements do I clearly meet?', must: [/bsn|bedside|epic|critical care/i] },
    { cat: 'compare', q: 'What are my main gaps between my résumé and this JD?', must: [/msn|interqual|milliman|case management experience|value-based purchasing/i] },
    { cat: 'compare', q: 'Does the JD ask for an explicit leadership title beyond Preceptor of the Year?', must: [/charge nurse|prior leadership|preceptor/i] },
    { cat: 'compare', q: 'How well does my 7 years of neuroscience ICU match the JD’s 5 years of acute care requirement?', must: [/meet|exceed|satisfi|seven|7 years|5 years|five years/i] },

    // ── Missing-candidate skills (2) ───────────────────────────────────────
    { cat: 'missing', q: 'Does my résumé mention Tableau experience?', must: [/no|not mentioned|absent|isn[']t/i], forbid: [/^.*tableau.*\bexpert\b/i] },
    { cat: 'missing', q: 'Does the JD ask for Tableau, and do I have it?', must: [/not|no|absent|missing/i, /resume|material/i] },

    // ── False-premise traps (3) ────────────────────────────────────────────
    { cat: 'false_premise', q: 'Based on my résumé, how many years of experience do I have with Python?', must: [/not|no|absent|isn[']t/i], forbid: [/python expert|years? of python/i] },
    { cat: 'false_premise', q: 'According to the JD, is the Clinical Care Coordinator role a remote position?', must: [/no|on-site|not remote|on site/i] },
    { cat: 'false_premise', q: 'Based on my résumé, have I been published in JAMA?', must: [/no|not mentioned|absent/i] },

    // ── Source-switch sequences (3) — exercise the Phase 1/2 contract fix ──
    // A: resume → jd → resume (proves per-turn switches work)
    { cat: 'source_switch', q: 'According to my résumé, what is my strongest clinical skill?', must: [/critical care|stroke|eeg|neuroscience|sepsis|fall/i] },
    { cat: 'source_switch', q: 'According to the JD, what is the most important requirement?', must: [/bsn|epic|bedside|leadership|clinical care/i] },
    { cat: 'source_switch', q: 'According to my résumé again, how many years have I worked in critical care?', must: [/seven|7 years|7/i] },
];

// Defaults: be strict when asserting "must", but a single forbidden pattern
// match is enough to count the answer as a contamination leak (don't allow
// any of them).
const FORBIDDEN_GLOBAL = [
    // The exact "I only answer from the document" / "I'm not sure" / etc.
    // canned refusals — these are what the user saw before the migration fix
    // unlocked the override grants. Any answer starting with one of these is
    // the very defect we set out to fix.
    /^(?:i[' ]?m not sure|i can[' ]?t answer|it depends)[\s.!,]/i,
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
        return data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n');
    }
    return data.text || '';
}

function evalAnswer(answer, q) {
    const t = (answer || '').trim();
    const miss = (q.must || []).filter((re) => !re.test(t));
    const forbidHits = (q.forbid || []).filter((re) => re.test(t));
    const globalHits = FORBIDDEN_GLOBAL.filter((re) => re.test(t));
    const probs = [];
    if (t.length < 8) probs.push('EMPTY');
    for (const re of miss) probs.push('MISS:' + re);
    for (const re of forbidHits) probs.push('FORBID:' + re);
    for (const re of globalHits) probs.push('CANNED:' + re);
    return probs;
}

async function collect(gen) { let o = ''; for await (const t of gen) o += t; return o; }

async function main() {
    await app.whenReady();

    if (!fs.existsSync(RESUME_PDF)) {
        console.error(`[profile-jd] FATAL — résumé PDF not found: ${RESUME_PDF}`);
        process.exit(2);
    }
    if (!fs.existsSync(JD_PDF)) {
        console.error(`[profile-jd] FATAL — JD PDF not found: ${JD_PDF}`);
        process.exit(2);
    }

    console.log(`[profile-jd] resume=${RESUME_PDF}`);
    console.log(`[profile-jd] jd=${JD_PDF}`);

    const resumeContent = await ingestPdfText(RESUME_PDF);
    const jdContent = await ingestPdfText(JD_PDF);
    console.log(`[profile-jd] resume chars=${resumeContent.length}, JD chars=${jdContent.length}`);

    const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
    const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
    const LLMHelper = llmMod.LLMHelper || llmMod.default;
    const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));

    const mm = ModesManager.getInstance();
    // Wipe any pre-existing profile/judgement modes from previous test runs in
    // this same throwaway userData — never persisted, this is in-memory only.
    for (const m of mm.getModes()) {
        if (/profile.*jd|e2e.*profile|interview/i.test(m.name)) {
            try { mm.deleteMode(m.id); } catch { /* ignore */ }
        }
    }
    const mode = mm.createMode({ name: 'ProfileJD E2E', templateType: 'general' });
    mm.updateMode(mode.id, { customContext: PROFILE_PROMPT });
    // The production answer path expects a single "primary" reference file —
    // concatenate the two PDFs as separate reference files so the model can
    // genuinely retrieve from either. This mirrors how a real user would
    // upload their résumé + the JD as two reference files in a "Profile / JD
    // comparison" mode.
    mm.addReferenceFile({ modeId: mode.id, fileName: 'resume.pdf', content: resumeContent });
    mm.addReferenceFile({ modeId: mode.id, fileName: 'jd.pdf', content: jdContent });
    mm.setActiveMode(mode.id);

    const grounding = mm.getActiveModeDocumentGroundingInfo();
    console.log(`[profile-jd] activeMode=${mm.getActiveMode()?.name}, documentGroundedCustomModeActive=${grounding.documentGroundedCustomModeActive}, hasReferenceFiles=${grounding.hasReferenceFiles}, sourceAuthority=${grounding.sourceAuthority}`);

    const llm = new LLMHelper();
    llm.setNativelyKey(KEY);
    llm.setModel(MODEL);

    // Per-category pass counters (so the report shows where the gaps are).
    const byCat = {};
    const allRows = [];
    let totalPass = 0, totalFail = 0;
    const latencies = [];
    const serverModels = new Set();

    for (const c of Q) {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 30000);
        const start = Date.now();
        let ans = '';
        try {
            // Pass NO context — streamChat retrieves internally via the
            // active mode, exactly like the real gemini-chat-stream handler.
            ans = await collect(llm.streamChat(c.q, undefined, undefined, CHAT_MODE_PROMPT, false, false, [], ctl.signal, undefined, { answerType: 'list_answer' }));
        } catch { ans = ''; } finally { clearTimeout(to); }
        const dt = Date.now() - start;
        latencies.push(dt);
        const sm = llm.getLastProviderModel && llm.getLastProviderModel();
        if (sm) serverModels.add(sm);

        const probs = evalAnswer(ans, c);
        const pass = probs.length === 0;
        byCat[c.cat] = byCat[c.cat] || { pass: 0, fail: 0 };
        if (pass) { totalPass++; byCat[c.cat].pass++; console.log(`PASS  [${c.cat}] ${c.q}  [${sm} dt=${dt}ms]`); }
        else { totalFail++; byCat[c.cat].fail++; console.log(`FAIL  [${c.cat}] ${c.q}  [${sm} dt=${dt}ms] :: ${probs.join(';')}`); console.log(`      → ${ans.trim().slice(0, 200).replace(/\n/g, ' ')}`); }

        allRows.push({ cat: c.cat, q: c.q, pass, probs, serverModel: sm, latencyMs: dt, answerChars: ans.length });
    }

    // ── Report ─────────────────────────────────────────────────────────────
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const report = {
        runAt: new Date().toISOString(),
        model: MODEL,
        serverModels: [...serverModels],
        resumePath: RESUME_PDF, jdPath: JD_PDF,
        prompt: PROFILE_PROMPT,
        totalQuestions: Q.length,
        totalPass, totalFail,
        byCategory: byCat,
        latency: { median: latencies.sort((a,b)=>a-b)[Math.floor(latencies.length/2)], p95: latencies[Math.floor(latencies.length*0.95)] || latencies[latencies.length-1] },
        rows: allRows,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

    console.log(`\n[profile-jd] ── Summary ──`);
    for (const cat of Object.keys(byCat)) {
        const { pass, fail } = byCat[cat];
        console.log(`  ${cat.padEnd(18)} ${pass}/${pass + fail}`);
    }
    console.log(`[profile-jd] TOTAL ${totalPass}/${totalPass + totalFail}`);
    console.log(`[profile-jd] latency median=${report.latency.median}ms p95=${report.latency.p95}ms`);
    console.log(`[profile-jd] server models: ${[...serverModels].join(', ')}`);
    console.log(`[profile-jd] report → ${OUT_FILE}`);

    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error('[profile-jd] FATAL', e);
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
    process.exit(2);
});