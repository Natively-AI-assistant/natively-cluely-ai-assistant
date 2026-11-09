/**
 * Synthetic meeting transcripts (campaign Phase 1, step 3) on AgentRouter gpt-6.1-sol (D3, 2026-11-10).
 *
 * Plans each transcript so the corpus meets taxonomy.md's quotas: a mode, the USER's name or none,
 * 2-4 other participants, and 5 hard-case tags that apply to the mode, picking the least-covered
 * ones first. The model writes the transcript as JSON turns with its OWN intent annotation
 * (`ask`, `tags`). That annotation only steers the segmenter's fake judge; labels come from the
 * teacher. Half the transcripts are then stripped of punctuation and casing (STT providers without
 * punctuation), which taxonomy.md calls `no_punctuation`.
 *
 * The generator never sees a judge-eval case. The leakage check runs on its output anyway.
 *
 *   AGENTROUTER_API_KEY=… node data/generate_transcripts.mjs --n 1000 --out data/work/transcripts.jsonl [--concurrency 3] [--seed 1]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { respond, parseJsonReply, stats, FatalGatewayError, MODEL } from './agentrouter_client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const MODES = {
  general: 'a general work meeting or call',
  'technical-interview': 'a technical job interview (coding, system design or debugging) where the USER is the candidate',
  'looking-for-work': 'a job interview (behavioural, experience, fit) where the USER is the candidate',
  sales: 'a sales call where the USER is the seller and OTHERS are the prospect or buyer team',
  recruiting: 'a recruiting call where the USER is the recruiter screening a candidate (OTHERS)',
  'team-meet': 'an internal team meeting or stand-up with several colleagues',
  lecture: 'a lecture or class where the USER is a student; the lecturer mostly talks to the whole room',
  seminar: 'a seminar or workshop with a presenter and several participants; the USER is one participant',
  'call-center': 'a customer support call where the USER is the agent and OTHERS is the customer',
};
const MODE_COLUMNS = ['general', 'technical-interview', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'seminar', 'call-center'];

/** Tags, their descriptions and per-mode applicability, read from taxonomy.md (the one source). */
export function loadTaxonomy(file = path.join(here, 'taxonomy.md')) {
  const md = fs.readFileSync(file, 'utf8');
  const tags = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\| `([a-z_]+)` \| ([^|]+) \| ([^|]+) \| (.+) \|$/);
    if (m) tags[m[1]] = { expected: m[2].trim(), looks: m[4].trim(), modes: new Set() };
  }
  const app = md.slice(md.indexOf('Applicability'));
  for (const line of app.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 10 || cells[0].startsWith('tag') || cells[0].startsWith('---')) continue;
    const names = cells[0].split(',').map((s) => s.trim());
    for (const name of names) {
      if (!tags[name]) throw new Error(`taxonomy applicability names unknown tag ${name}`);
      cells.slice(1).forEach((c, i) => { if (c === '✓') tags[name].modes.add(MODE_COLUMNS[i]); });
    }
  }
  // Corpus-wide properties, not steered per transcript.
  delete tags.no_punctuation;
  for (const [k, t] of Object.entries(tags)) if (!t.modes.size) throw new Error(`tag ${k} applies to no mode`);
  return tags;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const FIRST = ['Jordan', 'Priya', 'Mateo', 'Aisha', 'Wei', 'Olusegun', 'Sofia', 'Dmitri', 'Hannah', 'Kenji', 'Fatima', 'Liam', 'Ananya', 'Carlos', 'Mei', 'Tomasz', 'Zanele', 'Rahul', 'Elif', 'Noah', 'Ingrid', 'Kwame', 'Lucia', 'Arjun', 'Yuki', 'Samir', 'Chloe', 'Bogdan', 'Amara', 'Diego', 'Nadia', 'Ethan', 'Leila', 'Hiro', 'Grace', 'Omar', 'Freya', 'Vikram', 'Thandiwe', 'Marco'];
const LAST = ['Lee', 'Sharma', 'Garcia', 'Okafor', 'Chen', 'Novak', 'Haddad', 'Kim', 'Rossi', 'Mensah', 'Ivanova', 'Tanaka', 'Silva', 'Patel', 'Nguyen', 'Kowalski', 'Dlamini', 'Yilmaz', 'Brown', 'Andersen'];

/** Deterministic plan for transcript i. `counts` tracks planned tag coverage across the corpus. */
export function planTranscript(i, seed, tags, counts) {
  const r = rng(seed * 100_003 + i);
  const mode = MODE_COLUMNS[i % MODE_COLUMNS.length];
  const named = ['team-meet', 'lecture', 'seminar'].includes(mode) || r() < 0.4;
  const people = new Set();
  while (people.size < 1 + Math.floor(r() * 3) + 1) people.add(pick(r, FIRST));
  const userFirst = pick(r, FIRST.filter((n) => !people.has(n)));
  const user_name = named ? `${userFirst} ${pick(r, LAST)}` : null;
  const applicable = Object.keys(tags).filter((t) => tags[t].modes.has(mode));
  // least-covered first, ties broken by the seed
  const order = applicable.map((t) => [t, (counts[t] ?? 0) + r() * 0.5]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  const chosen = order.slice(0, 5);
  if (!named) {
    const ix = chosen.indexOf('addressed_to_user_slip');
    if (ix >= 0) chosen.splice(ix, 1, order[5]);
  }
  for (const t of chosen) counts[t] = (counts[t] ?? 0) + 1;
  return {
    transcript_id: `syn-${String(seed).padStart(2, '0')}-${String(i).padStart(5, '0')}`,
    seed: seed * 100_003 + i,
    mode, user_name, others: [...people], tags: chosen,
    turns_target: 14 + Math.floor(r() * 14),
    no_punctuation: r() < 0.5,
    topic_seed: Math.floor(r() * 1e9),
  };
}

const INSTRUCTIONS = `You write realistic, varied transcripts of live spoken meetings, used to train a classifier that decides when an assistant should draft an answer for one participant, the USER. Write the way people actually talk: filler words, restarts, half sentences, interruptions, people thinking aloud, small talk, topic drift. Never write stage directions, markdown or narration. Use fresh, specific content each time (company, product, technology, numbers, places), never generic placeholders.

Reply with JSON only:
{"turns": [{"speaker": "USER" | "<participant first name>", "text": "<what they said>", "ask": true|false, "tags": ["<tag>", ...]}]}

- "ask": true only when that turn contains a finished question or task the USER is expected to answer or start now.
- "tags": the hard-case tags (from the list you are given) that the turn demonstrates; [] for ordinary turns.
- Several consecutive turns by the same participant are fine; that is how long explanations arrive.
- Speaker "USER_ECHO" is the USER's own voice picked up by the meeting audio (speakers leaking into the call capture): the USER thinking aloud or asking the others something ("can I use Python for this?"). Use it for every user_own_voice turn, and never tag a plain "USER" turn user_own_voice.`;

function promptFor(plan, tags) {
  const tagLines = plan.tags.map((t) => `- ${t} (usually ${tags[t].expected}): ${tags[t].looks}`).join('\n');
  return `Meeting: ${MODES[plan.mode]}.
Participants other than the USER: ${plan.others.join(', ')}.
The USER ${plan.user_name ? `is ${plan.user_name}; others may address them by first name, sometimes mis-heard by speech recognition (a near-miss spelling).` : 'is never named.'}
Length: about ${plan.turns_target} turns.
Variety seed: ${plan.topic_seed} (use it to pick an unusual topic and setting).

Work each of these hard cases into the conversation naturally, at least twice each in different turns and wordings, and tag those turns:
${tagLines}

Mix in ordinary turns too: some plain questions for the USER, some answers by the USER, some talk that needs no answer.`;
}

export function stripPunctuation(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function validate(obj, plan) {
  if (!obj || !Array.isArray(obj.turns) || obj.turns.length < 6) return 'no turns';
  const names = new Set(['USER', 'USER_ECHO', ...plan.others]);
  for (const t of obj.turns) {
    if (typeof t?.text !== 'string' || !t.text.trim()) return 'empty turn';
    if (typeof t.speaker !== 'string') return 'no speaker';
    if (!names.has(t.speaker)) t.speaker = t.speaker.toUpperCase() === 'USER' ? 'USER' : t.speaker.toUpperCase() === 'USER_ECHO' ? 'USER_ECHO' : plan.others[0];
    // a user_own_voice turn on the USER channel never reaches the judge; move it to the echo
    if (t.speaker === 'USER' && Array.isArray(t.tags) && t.tags.includes('user_own_voice')) t.speaker = 'USER_ECHO';
    t.ask = t.ask === true;
    t.tags = Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string') : [];
  }
  if (!obj.turns.some((t) => t.speaker !== 'USER' && t.speaker !== 'USER_ECHO')) return 'no OTHERS turns';
  return null;
}

async function generate(plan, tags, log) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await respond({ instructions: INSTRUCTIONS, input: promptFor(plan, tags), effort: 'low', maxOutputTokens: 16000, log });
    const obj = parseJsonReply(r.text);
    const err = validate(obj, plan);
    if (err) { log(`${plan.transcript_id}: ${err}${r.incomplete ? ` (incomplete: ${r.incomplete}, ${r.usage?.output_tokens ?? '?'} out)` : ''}, retrying`); continue; }
    const turns = obj.turns.map((t) => ({
      speaker: t.speaker === 'USER' ? 'USER' : 'OTHERS',
      who: t.speaker,
      text: plan.no_punctuation ? stripPunctuation(t.text) : t.text.trim(),
      ask: t.ask,
      tags: t.tags,
    })).filter((t) => t.text);
    return { transcript_id: plan.transcript_id, seed: plan.seed, mode: plan.mode, user_name: plan.user_name, others: plan.others,
      planned_tags: plan.tags, no_punctuation: plan.no_punctuation, generator: MODEL, turns };
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const n = Number(opt('--n', 10));
  const seed = Number(opt('--seed', 1));
  const out = opt('--out');
  const concurrency = Number(opt('--concurrency', 3));
  if (!out) throw new Error('--out is required');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tags = loadTaxonomy();
  const counts = {};
  const plans = Array.from({ length: n }, (_, i) => planTranscript(i, seed, tags, counts));
  if (args.includes('--plan-only')) { console.log(JSON.stringify(counts, null, 1)); return; }
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).transcript_id) : []);
  const todo = plans.filter((p) => !done.has(p.transcript_id));
  const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  log(`${todo.length} transcripts to write (${done.size} done), ${MODEL}, concurrency ${concurrency}`);
  let next = 0, finished = 0, failed = 0, fatal = null;
  const t0 = Date.now();
  async function worker() {
    while (!fatal && next < todo.length) {
      const plan = todo[next++];
      try {
        const tx = await generate(plan, tags, log);
        if (tx) fs.appendFileSync(out, JSON.stringify(tx) + '\n'); else failed++;
      } catch (e) {
        if (e instanceof FatalGatewayError) { fatal = e; break; }
        failed++;
        log(`skip ${plan.transcript_id}: ${String(e.message || e).slice(0, 160)}`);
      }
      if (++finished % 5 === 0) log(`${finished}/${todo.length}  ${((Date.now() - t0) / finished / 1000).toFixed(1)} s each  tok in ${stats.inputTokens} out ${stats.outputTokens}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`done: ${finished - failed} written, ${failed} failed, ${stats.calls} calls, ${stats.inputTokens} in / ${stats.outputTokens} out, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (fatal) { log(`STOPPED: ${fatal.message}`); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
