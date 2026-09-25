/**
 * Judge-prompt EVAL harness (2026-08-25). NOT a unit test — it calls the real
 * model, so it is invoked manually and never by `npm test`:
 *
 *   GEMINI_API_KEY=… node electron/intelligence/autoAnswer/__tests__/judgeEval.mjs
 *   … [judge-eval/wordle-coding-round.json]        # any labeled candidate set
 *
 *   # The OpenAI rung of generateJudgeVerdict (2026-09-22), same request shape:
 *   JUDGE_EVAL_PROVIDER=openai JUDGE_EVAL_MODEL=gpt-5.4-mini OPENAI_API_KEY=… node …/judgeEval.mjs
 *   # …or the pre-2026-09-22 fallback (chat model, no JSON mode) for comparison:
 *   JUDGE_EVAL_PROVIDER=openai-legacy JUDGE_EVAL_MODEL=gpt-5.6-luna OPENAI_API_KEY=… node …/judgeEval.mjs
 *
 * Why it exists: the judge prompt was twice "improved" by reasoning about it
 * (a prefix-caching reorder, a strengthened merge rule) and both times the
 * change silently traded recall for precision or back. Prompt edits are only
 * as good as their measurement, so every edit is scored against candidates
 * captured from real meetings.
 *
 * The fixture is every candidate the engine actually judges on the standing
 * test video (youtube 5xf4_Kx7azg, 0:00-2:10 = meeting fd28a1af), in both the
 * DB-replay and live-interim segmentations, labeled by whether it carries an
 * ask that has not been answered yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => require(path.resolve(__dirname, '../../../../dist-electron/electron', f));
const { buildJudgePrompt, parseJudgeVerdict, routeForVerdict } = dist('intelligence/autoAnswer/AutoAnswerJudge.js');
const { resolveAutoAnswerThresholds } = dist('context-intelligence/policies/mode-policy-registry.js');

const PROVIDER = process.env.JUDGE_EVAL_PROVIDER ?? 'gemini';
const MODEL = process.env.JUDGE_EVAL_MODEL ?? (PROVIDER === 'gemini' ? 'gemini-3.1-flash-lite' : 'gpt-5.4-mini');
const { getOpenAiReasoningEffort } = dist('llm/modelCapabilities.js');
const CONCURRENCY = 6;
const TH = resolveAutoAnswerThresholds('technical-interview');
const EVAL_DIR = path.join(__dirname, 'judge-eval');
const SET_PATHS = process.argv.length > 2
  ? process.argv.slice(2)
  : fs.readdirSync(EVAL_DIR).filter(f => f.endsWith('.json')).sort().map(f => path.join(EVAL_DIR, f));

function apiKey() {
  if (PROVIDER !== 'gemini') {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    throw new Error('set OPENAI_API_KEY');
  }
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.replace(/^["']|["']$/g, '');
  const envFile = path.resolve(__dirname, '../../../../.env');
  if (!fs.existsSync(envFile)) throw new Error('set GEMINI_API_KEY');
  const line = fs.readFileSync(envFile, 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('set GEMINI_API_KEY');
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}
const KEY = apiKey();

async function judge(c) {
  const prompt = buildJudgePrompt({
    candidateText: c.text,
    recentTurns: (c.ctx ?? []).map((t, i) => ({ ...t, timestamp: i })),
    modeName: c.modeName ?? 'Technical Interview',
    questionId: 'eval',
    lastAnsweredText: c.lastAnswered ?? null,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const t0 = performance.now();
      let raw;
      if (PROVIDER === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json' } }),
        });
        const j = await res.json();
        if (j.error) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        raw = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? null;
      } else {
        // 'openai' mirrors generateJudgeVerdict's OpenAI rung; 'openai-legacy'
        // mirrors what the judge did before it: generateWithOpenai on the chat
        // model — no JSON mode, the chat path's own reasoning effort.
        const effort = process.env.JUDGE_EVAL_EFFORT ?? getOpenAiReasoningEffort(MODEL);
        const body = PROVIDER === 'openai'
          ? { model: MODEL, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 512, response_format: { type: 'json_object' }, ...(effort ? { reasoning_effort: effort } : {}) }
          : { model: MODEL, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 4096, reasoning_effort: process.env.JUDGE_EVAL_LEGACY_EFFORT ?? 'low' };
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (j.error) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        raw = j.choices?.[0]?.message?.content ?? null;
      }
      const ms = Math.round(performance.now() - t0);
      const v = parseJudgeVerdict(raw, c.text);
      const r = v ? routeForVerdict(v) : null;
      // The judge's own action decides (2026-08-25); the thresholds only ever
      // demote. "fires" here means it would draft an answer unasked.
      return { fires: r?.route === 'evaluate' && r.action === 'answer', act: v?.act ?? 'UNPARSED', ans: v?.answerability ?? null, action: v?.action, ms };
    } catch { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
  }
  return { fires: false, act: 'ERROR', ans: null };
}

let anyProblem = false;
for (const SET_PATH of SET_PATHS) {
  const SET = JSON.parse(fs.readFileSync(SET_PATH, 'utf8'));
  const results = new Array(SET.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) { const i = next++; if (i >= SET.length) return; results[i] = await judge(SET[i]); }
  }));

  let tp = 0, fp = 0, fn = 0, tn = 0;
  const falses = [], misses = [];
  SET.forEach((c, i) => {
    const want = c.expect === 'ask', got = results[i].fires;
    if (want && got) tp++;
    else if (want) { fn++; misses.push({ i, ...results[i], note: c.note, text: c.text.slice(0, 80) }); }
    else if (got) { fp++; falses.push({ i, ...results[i], note: c.note, text: c.text.slice(0, 80) }); }
    else tn++;
  });
  const prec = tp + fp ? tp / (tp + fp) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
  const lat = results.map(r => r.ms).filter(x => typeof x === 'number').sort((a, b) => a - b);
  const pct = (q) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : NaN;
  console.log(`\n${path.basename(SET_PATH)} · ${PROVIDER}/${MODEL} · ${SET.length} candidates`);
  console.log(`TP=${tp} FP=${fp} FN=${fn} TN=${tn}  precision=${prec.toFixed(3)} recall=${rec.toFixed(3)}  latency p50=${pct(0.5)}ms p90=${pct(0.9)}ms`);
  for (const f of falses) console.log(`  FALSE FIRE #${f.i} [${f.act} ${f.action} ${f.ans}] ${JSON.stringify(f.text)}${f.note ? '\n     note: ' + f.note : ''}`);
  for (const m of misses) console.log(`  MISS      #${m.i} [${m.act} ${m.action} ${m.ans}] ${JSON.stringify(m.text)}${m.note ? '\n     note: ' + m.note : ''}`);
  if (fp || fn) anyProblem = true;
}
process.exitCode = anyProblem ? 1 : 0;
