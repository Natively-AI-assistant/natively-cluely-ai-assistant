// tests/e2e-modes/llmJudge.mjs
// Optional semantic judge for criteria the deterministic scorer can't fully
// verify (e.g. "answer is genuinely grounded in the document", "tone matches").
// Uses the SAME local backend (MiniMax) via the local-test header. Outputs a
// STRUCTURED per-criterion verdict, saved as an artifact. Judge verdicts NEVER
// override a deterministic hard-fail — they are advisory + recorded.

const API_BASE = process.env.NATIVELY_API_BASE || 'http://localhost:3000';
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || 'local-test';

const JUDGE_SYSTEM =
  'You are a fair but rigorous evaluation judge. You are given an interview question, a candidate ' +
  'answer, and a list of criteria. For each criterion output a boolean pass and a one-line reason. ' +
  'Output ONLY a JSON object: {"verdicts":[{"criterion":string,"pass":boolean,"reason":string}]}. ' +
  'Judge SUBSTANCE, not surface form: a criterion is met if the answer ACCOMPLISHES what it asks, ' +
  'even without explicit labels. E.g. "uses a STAR structure" is satisfied by a flowing narrative ' +
  'that conveys a situation, a task/challenge, the actions the speaker took, and a result — it does ' +
  'NOT require the literal words Situation/Task/Action/Result. "Cites the section/document" is met by ' +
  'any clear reference to the source, not a specific citation format. FAIL only when the answer ' +
  'genuinely fabricates facts, hedges without answering, or misses the substance of the criterion.';

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error('no json');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('unbalanced json');
}

export async function judge(question, answer, criteria, opts = {}) {
  const user = [
    `QUESTION: ${question}`,
    '',
    `CANDIDATE ANSWER: ${answer}`,
    '',
    'CRITERIA (evaluate each):',
    ...criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    'Return the JSON object now.',
  ].join('\n');
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-natively-local-test': LOCAL_TOKEN },
    body: JSON.stringify({ system: JUDGE_SYSTEM, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data = await res.json();
  const parsed = extractJson(data.content || '');
  return { model: data.model, verdicts: parsed.verdicts || [] };
}
