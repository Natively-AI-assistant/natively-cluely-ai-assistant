/**
 * Teacher labeling (campaign Phase 1, step 6) on AgentRouter gpt-6.1-sol (decision D3, 2026-11-10).
 *
 * Lean ensemble, two independent views of each candidate:
 *   judge   the app's own buildJudgePrompt, parsed and routed by parseJudgeVerdict +
 *           routeForVerdict. wait_incomplete → wait; evaluate+answer → answer; else silent.
 *   rubric  the §4 `respond` question with the serialized §4 state (the model's own input).
 * They agree → done (2 votes). They disagree → both are asked again at a higher reasoning effort
 * (4 votes in all). The majority wins; a 2-2 tie goes to the adjudication queue (label null).
 *
 *   AGENTROUTER_API_KEY=… node data/teacher_label.mjs --candidates cands.jsonl --out labels.jsonl [--concurrency 3]
 *   AGENTROUTER_API_KEY=… node data/teacher_label.mjs --gold --out results/teacher-gold.jsonl   # teacher accuracy, EVAL ONLY
 *
 * The output is resumable: ids already in --out are skipped. Records are synthetic; nothing
 * here ever reads a user transcript.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { respond, parseJsonReply, stats, FatalGatewayError, MODEL } from './agentrouter_client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const J = require(path.join(root, 'dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
const S = require(path.join(root, 'dist-electron/electron/intelligence/autoAnswer/decider/deciderState.js'));

export const MODE_NAMES = {
  general: 'General', 'technical-interview': 'Technical Interview', 'looking-for-work': 'Looking for work',
  sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', lecture: 'Lecture', seminar: 'Seminar',
  'call-center': 'Call Center',
};
const LABELS = ['answer', 'silent', 'wait'];

export const RUBRIC_INSTRUCTIONS = `You label one moment of a live meeting for a classifier. ${S.DECIDER_QUESTION.instructions ?? ''}

You get a JSON state:
- mode: the kind of meeting.
- addressed_to: "user" if the latest speech names the USER, "other" if it names someone else, "none" if it names nobody. It was computed from names in the text and can be wrong when a name is mis-heard.
- transcript_lagging: true when the transcript is behind the speaker, so the last word may be cut off.
- context: the previous turns, oldest first. OTHERS is the meeting audio (one or several people), USER is the person the assistant helps.
- last_answered: the ask the assistant already answered, or null.
- candidate: the latest speech from OTHERS. Judge THIS.

Labels:
- answer: ${S.DECIDER_QUESTION.criteria?.answer ?? 'a finished question or task for the USER'}
- silent: ${S.DECIDER_QUESTION.criteria?.silent ?? 'not an ask for the USER'}
- wait: ${S.DECIDER_QUESTION.criteria?.wait ?? 'unfinished'}

Hard cases:
- A task stated as a sentence ("your job is to build X", "we need a schema for orders") is answer. So is a short or yes/no question, and a report that implies "how do we fix this".
- Explanation that only contains question words, a recap ending in "right?" or "okay?", a paraphrase of what the USER said, permission ("feel free to…"), arranging the session (scheduling, "go ahead and share your screen", time checks) and "we'll come back to that" are silent.
- A small check the USER still has to reply to ("can you hear me okay?", "can you see my screen?", "are you ready to start?") is answer: the USER must respond.
- A question the speaker answers themselves is silent. A question followed by a DIFFERENT person's short reply is still answer if the USER is meant to answer it.
- Named to someone other than the USER: silent. The USER's own words leaking onto the meeting audio ("can I use Python?") are silent.
- The ask in last_answered, restated or with details added: silent. A genuinely changed requirement: answer.
- Ends mid-sentence ("…and the", "your task is—"), or announces "three things" and has given one: wait.
- transcript_lagging with a clipped last word: answer if the ask is already clear without it, otherwise wait.

Reply with JSON only: {"label": "answer" | "silent" | "wait", "reason": "<12 words max>"}`;

function judgeRequest(rec) {
  return {
    candidateText: rec.candidate,
    recentTurns: rec.context.map((t, i) => ({ role: t.speaker === 'USER' ? 'user' : 'interviewer', text: t.text, timestamp: i })),
    modeName: MODE_NAMES[rec.mode] ?? 'General',
    questionId: rec.id,
    lastAnsweredText: rec.last_answered ?? null,
    userName: rec.user_name ?? null,
    ...(rec.transcript_lagging ? { transcriptLagging: true } : {}),
  };
}

function stateFor(rec) {
  const fields = S.buildDeciderStateFields({
    candidateText: rec.candidate,
    recentTurns: rec.context.map((t, i) => ({ role: t.speaker === 'USER' ? 'user' : 'interviewer', text: t.text, timestamp: i })),
    modeId: rec.mode,
    lastAnsweredText: rec.last_answered ?? null,
    userName: rec.user_name ?? null,
    transcriptLagging: !!rec.transcript_lagging,
  });
  return S.serializeDeciderState(fields);
}

async function judgeVote(rec, effort, log) {
  const req = judgeRequest(rec);
  const r = await respond({ input: J.buildJudgePrompt(req), effort, maxOutputTokens: 3000, log });
  const v = J.parseJudgeVerdict(r.text, req.candidateText);
  if (!v) return { label: null, raw: r.text.slice(0, 300), ms: r.ms, incomplete: r.incomplete ?? null };
  const route = J.routeForVerdict(v);
  const label = route.route === 'wait_incomplete' ? 'wait' : route.route === 'evaluate' && route.action === 'answer' ? 'answer' : 'silent';
  return { label, act: v.act, answerability: v.answerability, ms: r.ms };
}

async function rubricVote(rec, effort, log) {
  const r = await respond({ instructions: RUBRIC_INSTRUCTIONS, input: stateFor(rec), effort, maxOutputTokens: 3000, log });
  const o = parseJsonReply(r.text);
  const label = o && LABELS.includes(o.label) ? o.label : null;
  return { label, reason: typeof o?.reason === 'string' ? o.reason.slice(0, 200) : null, ms: r.ms, ...(label ? {} : { raw: r.text.slice(0, 300), incomplete: r.incomplete ?? null }) };
}

export async function labelRecord(rec, log = () => {}) {
  const votes = [];
  const [j, r] = await Promise.all([judgeVote(rec, 'none', log), rubricVote(rec, 'none', log)]);
  votes.push({ view: 'judge', effort: 'none', ...j }, { view: 'rubric', effort: 'none', ...r });
  if (!(j.label && j.label === r.label)) {
    const [j2, r2] = await Promise.all([judgeVote(rec, 'medium', log), rubricVote(rec, 'medium', log)]);
    votes.push({ view: 'judge', effort: 'medium', ...j2 }, { view: 'rubric', effort: 'medium', ...r2 });
  }
  const tally = () => {
    const counts = Object.fromEntries(LABELS.map((l) => [l, votes.filter((v) => v.label === l).length]));
    const ranked = LABELS.slice().sort((a, b) => counts[b] - counts[a]);
    return { counts, valid: votes.filter((v) => v.label).length, top: counts[ranked[0]] > counts[ranked[1]] ? ranked[0] : null };
  };
  let t = tally();
  if (t.valid && !t.top) {
    // a tie: one more vote, the production judge prompt at high effort, breaks it. The soft
    // label keeps the split (3/5 vs 2/5), so the student learns these are uncertain.
    votes.push({ view: 'judge', effort: 'high', tiebreak: true, ...(await judgeVote(rec, 'high', log)) });
    t = tally();
  }
  const { counts, valid } = t;
  const label = t.top;
  const soft = valid ? LABELS.map((l) => counts[l] / valid) : null;
  return { id: rec.id, label, soft, votes, teacher: MODEL, needs_adjudication: label === null };
}

function goldRecords() {
  const dir = path.join(root, 'electron/intelligence/autoAnswer/__tests__/judge-eval');
  const ids = Object.fromEntries(Object.entries(MODE_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).forEach((c, i) => {
      const modeName = c.modeName ?? 'Technical Interview';
      out.push({
        id: `gold:${file}#${i}`, set: file, expect: c.expect,
        mode: S.modeIdForName(modeName) ?? ids[modeName.toLowerCase()] ?? 'general',
        user_name: c.userName ?? null,
        context: (c.ctx ?? []).map((t) => ({ speaker: t.role === 'user' ? 'USER' : 'OTHERS', text: t.text })),
        last_answered: c.lastAnswered ?? null, candidate: c.text, transcript_lagging: false,
      });
    });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const out = opt('--out');
  if (!out) throw new Error('--out is required');
  const concurrency = Number(opt('--concurrency', 3));
  const limit = Number(opt('--limit', Infinity));
  const recs = args.includes('--gold') ? goldRecords()
    : fs.readFileSync(opt('--candidates'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const todo = recs.filter((r) => !done.has(r.id)).slice(0, limit);
  const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  log(`${todo.length} to label (${done.size} already done), model ${MODEL}, concurrency ${concurrency}`);
  let next = 0, finished = 0, fatal = null;
  const t0 = Date.now();
  async function worker() {
    while (!fatal && next < todo.length) {
      const rec = todo[next++];
      try {
        const res = await labelRecord(rec, log);
        const row = { ...res, ...(rec.expect ? { expect: rec.expect, set: rec.set } : {}) };
        fs.appendFileSync(out, JSON.stringify(row) + '\n');
      } catch (e) {
        if (e instanceof FatalGatewayError) { fatal = e; break; }
        log(`skip ${rec.id}: ${String(e.message || e).slice(0, 160)}`);
      }
      if (++finished % 10 === 0) log(`${finished}/${todo.length}  ${((Date.now() - t0) / finished / 1000).toFixed(1)} s/record  calls ${stats.calls}  tok in ${stats.inputTokens} out ${stats.outputTokens}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`done: ${finished} records, ${stats.calls} calls, ${stats.inputTokens} in / ${stats.outputTokens} out tokens (${stats.reasoningTokens} reasoning), ${stats.retries} retries, ${stats.quotaWaits} quota waits, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (fatal) { log(`STOPPED: ${fatal.message}`); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
