// benchmark/harness/judge.mjs — blind LLM-judge evaluation.
// Judge: Gemini 3.1 Pro (a third model family: neither GPT-5.6 Luna nor DeepSeek).
// The judge sees ONLY: numbered source transcript (as speaker-labelled lines + cast list),
// the gold reference fact sheet, and ONE candidate summary under an opaque id.
// It never sees model name, provider, effort, price, latency, or other candidates.
//   node judge.mjs [--concurrency 6] [--only CONV] [--rejudge-sample 18]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { renderSummary } from './render.mjs'

const require = createRequire(import.meta.url)
const BENCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const ROOT = path.resolve(BENCH, '..')
const env = require(path.join(ROOT, 'natively-api/node_modules/dotenv')).parse(fs.readFileSync(path.join(ROOT, '.env')))
const JUDGE_MODEL = 'gemini-3.1-pro-preview'
const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const CONC = Number(arg('--concurrency', 6))
const ONLY = arg('--only', null)
const REJUDGE = Number(arg('--rejudge-sample', 0))
const SALT = 'natively-bench-2026-09-17'

const blindId = (rel) => 'S-' + crypto.createHash('sha256').update(SALT + rel).digest('hex').slice(0, 8)

function numberedTranscript(convId, ref) {
  const src = fs.readFileSync(path.join(BENCH, 'transcripts/src', `${convId}.txt`), 'utf8').split(/\r?\n/)
  const shown = Object.fromEntries((ref.speakers || []).map(s => [s.label, s.shown_to_model_as || s.label]))
  const lines = []
  src.forEach((l, i) => {
    const m = /^S(\d+):\s*(.*)$/.exec(l)
    if (!m) return
    const label = `S${m[1]}`
    const who = shown[label] || (m[1] === '0' ? 'Me' : `Speaker ${m[1]}`)
    lines.push(`L${i + 1} [${who}] ${m[2]}`)
  })
  return lines.join('\n')
}

const SYSTEM = `You are a meticulous, impartial evaluator of AI-generated meeting notes for a note-taking product.
You will receive (1) a source transcript with line numbers, (2) a GOLD reference fact sheet written by a human analyst from that transcript, and (3) ONE candidate set of notes.
The candidate notes include the displayed notes (title, overview, summary bullets, template sections) and structured blocks (action items, decisions, open questions, risks, follow-up draft). Evaluate the notes AS A WHOLE: a fact counts as retained if it is conveyed correctly anywhere in the notes.

Rules:
- The fact sheet states FINAL values. When the transcript contains corrections, the final value is the truth. Reporting a superseded value (without clearly marking it as superseded) is a contradiction and a numeric/timeline error.
- Items listed under "not_decisions" were only floated or rejected. Presenting them as decided/agreed is a critical error.
- Hallucination = any claim not supported by the transcript (invented names, numbers, dates, owners, decisions, or conclusions). Check the transcript, not just the fact sheet, before calling something hallucinated.
- Misattribution (wrong person said/owns something) counts against speaker_attribution and factual_accuracy.
- Judge only what is written. Do not reward length for its own sake; do not penalize density when every line is substantive. Penalize repetition, filler, and irrelevant small talk/distractors under conciseness.
- Be consistent and strict. Use the full 1-10 range.

Score anchors (1-10): 10 = flawless; 8 = minor omissions or wording issues, no material errors; 6 = several important omissions or one material error; 4 = many important omissions or multiple material errors; 2 = largely wrong or unusable; 1 = empty/garbage.

For fact_checks, give EVERY fact id from the fact sheet exactly one status:
- "present": conveyed correctly with its key qualifiers (value, owner, deadline, condition)
- "partial": the gist is there but a key qualifier (number, owner, deadline, condition) is missing or vague
- "missing": not conveyed
- "contradicted": the notes state something incompatible (e.g. a superseded value, wrong owner, wrong number)

Return ONLY JSON with exactly this shape:
{
  "factual_accuracy": 1-10,
  "important_information_retention": 1-10,
  "hallucination_control": 1-10,
  "action_item_retention": 1-10,
  "decision_retention": 1-10,
  "speaker_attribution": 1-10,
  "numeric_accuracy": 1-10,
  "entity_retention": 1-10,
  "timeline_accuracy": 1-10,
  "conclusion_accuracy": 1-10,
  "structure": 1-10,
  "conciseness": 1-10,
  "readability": 1-10,
  "overall_summary_quality": 1-10,
  "critical_errors": ["..."],
  "missing_important_information": ["..."],
  "hallucinated_information": ["..."],
  "superseded_values_reported": [{"correction_id": "C..", "reported": "..."}],
  "not_decisions_reported_as_decided": ["..."],
  "distractors_included": ["..."],
  "fact_checks": [{"id": "F01", "status": "present|partial|missing|contradicted"}],
  "rationale": "3-6 sentences"
}`

async function callJudge(userText) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = Date.now()
    let r, j
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body),
      })
      j = await r.json()
    } catch (e) { await new Promise(res => setTimeout(res, 5000 * (attempt + 1))); continue }
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 10000 * (attempt + 1))); continue }
    if (r.status !== 200) throw new Error(`judge http ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
    const text = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
    let parsed
    try { parsed = JSON.parse(text) } catch { const a = text.indexOf('{'), b = text.lastIndexOf('}'); parsed = JSON.parse(text.slice(a, b + 1)) }
    return { parsed, usage: j.usageMetadata, model_version: j.modelVersion, ms: Date.now() - t, attempts: attempt + 1 }
  }
  throw new Error('judge: retries exhausted')
}

const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'manifest.json'), 'utf8'))
const tasks = []
for (const cfg of fs.readdirSync(path.join(BENCH, 'outputs'))) {
  for (const conv of fs.readdirSync(path.join(BENCH, 'outputs', cfg))) {
    if (ONLY && conv !== ONLY) continue
    for (const f of fs.readdirSync(path.join(BENCH, 'outputs', cfg, conv))) {
      if (!f.endsWith('.json') || f.includes('.crash')) continue
      const rel = `${cfg}/${conv}/${f}`
      const evalPath = path.join(BENCH, 'evaluations', cfg, conv, f)
      if (!fs.existsSync(evalPath)) tasks.push({ cfg, conv, f, rel, evalPath })
    }
  }
}
// Optional judge-noise sample: re-judge N already-judged summaries into *.rejudge.json
if (REJUDGE) {
  const judged = []
  for (const cfg of fs.readdirSync(path.join(BENCH, 'evaluations')).filter(d => !d.endsWith('.json'))) for (const conv of fs.readdirSync(path.join(BENCH, 'evaluations', cfg))) for (const f of fs.readdirSync(path.join(BENCH, 'evaluations', cfg, conv))) if (/^run\d\.json$/.test(f)) judged.push({ cfg, conv, f, rel: `${cfg}/${conv}/${f}`, evalPath: path.join(BENCH, 'evaluations', cfg, conv, f.replace('.json', '.rejudge.json')) })
  const pick = judged.sort((a, b) => blindId(a.rel + 'r').localeCompare(blindId(b.rel + 'r'))).slice(0, REJUDGE).filter(t => !fs.existsSync(t.evalPath))
  tasks.length = 0; tasks.push(...pick)
}
tasks.sort((a, b) => blindId(a.rel).localeCompare(blindId(b.rel)))   // order independent of config
if (args.includes('--reverse')) tasks.reverse()
const LIMIT = Number(arg('--limit', 0)); if (LIMIT) tasks.length = Math.min(tasks.length, LIMIT)
console.log(`judge tasks: ${tasks.length}`)

const refCache = {}
let next = 0, ok = 0, fail = 0
async function worker() {
  while (next < tasks.length) {
    const t = tasks[next++]
    // claim the task so parallel judge instances never double-judge
    if (fs.existsSync(t.evalPath)) continue
    fs.mkdirSync(path.dirname(t.evalPath), { recursive: true })
    const claim = t.evalPath + '.pending'
    try { fs.writeFileSync(claim, String(process.pid), { flag: 'wx' }) } catch { continue }
    try {
      const ref = refCache[t.conv] ||= JSON.parse(fs.readFileSync(path.join(BENCH, 'references', `${t.conv}.json`), 'utf8'))
      const run = JSON.parse(fs.readFileSync(path.join(BENCH, 'outputs', t.cfg, t.conv, t.f), 'utf8'))
      const id = blindId(t.rel)
      const { speakers, facts, corrections, not_decisions, distractors, open_questions_at_end, summary_must_include, context } = ref
      const factSheet = { context, speakers, facts: facts.map(f => ({ id: f.id, type: f.type, importance: f.importance, statement: f.statement, owner: f.owner ?? null, deadline: f.deadline ?? null, lines: f.lines })), corrections, not_decisions, distractors, open_questions_at_end, summary_must_include }
      const userText = `SOURCE TRANSCRIPT (speaker labels are exactly what the note-taker saw; the cast list maps them to people)\nCAST: ${JSON.stringify(speakers)}\n\n${numberedTranscript(t.conv, ref)}\n\n=== GOLD REFERENCE FACT SHEET ===\n${JSON.stringify(factSheet, null, 1)}\n\n=== CANDIDATE NOTES (id ${id}) ===\n${renderSummary(run.summary)}\n\nEvaluate candidate ${id}. Return only the JSON.`
      const res = await callJudge(userText)
      fs.mkdirSync(path.dirname(t.evalPath), { recursive: true })
      fs.writeFileSync(t.evalPath, JSON.stringify({ blind_id: id, judge_model: JUDGE_MODEL, judge_model_version: res.model_version, judge_ms: res.ms, judge_attempts: res.attempts, judge_usage: res.usage, fact_count: facts.length, evaluation: res.parsed }, null, 1))
      ok++
      if (ok % 10 === 0) console.log(`judged ${ok}/${tasks.length} (fail ${fail})`)
    } catch (e) {
      fail++
      console.error(`judge fail ${t.rel}: ${String(e.message).slice(0, 300)}`)
    } finally {
      try { fs.unlinkSync(claim) } catch { }
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker))
console.log(`judge done ok=${ok} fail=${fail}`)
