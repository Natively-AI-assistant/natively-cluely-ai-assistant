/**
 * Production-shaped segmentation (campaign Phase 1, step 5).
 *
 * Feeds each synthetic transcript through the REAL SimpleAutoAnswerEngine on a fake
 * clock, with a recording host, and writes out every JudgeRequest the engine emits.
 * Those are exactly the candidates a judge would see in production: merged finals,
 * stall-promoted interims with clipped last words, mid-word cuts, and the engine's
 * lastAnsweredText at that moment. Clean sentences are NOT training data; these are.
 *
 *   npm run build:electron        # once, from the repo root
 *   node ml/auto-answer-decider/data/segment_via_replay.mjs <transcripts.jsonl> > candidates.jsonl
 *   node ml/auto-answer-decider/data/segment_via_replay.mjs --self-test
 *
 * Transcript line:
 *   {"transcript_id","mode","user_name"|null,"seed"?,
 *    "turns":[{"speaker":"OTHERS"|"OTHERS/speaker_1"|"USER","text","ask"?:bool,"tags"?:[...]}]}
 * `ask` is the GENERATOR's intent annotation. It only drives the fake judge, so the
 * engine's own state (answered asks, held verdicts, busy parking) evolves realistically.
 * The training LABEL comes from the teacher, never from `ask`.
 *
 * STT profiles, picked per transcript from the seed:
 *   streaming-endpoint  interims every 1-3 words, finals at clauses or every 6-14 words,
 *                       a provider endpoint at the turn end, local VAD hint accepted (Deepgram/Soniox-like)
 *   relay-bursty        bursts of finals, no endpoint, occasional mid-word cut across finals,
 *                       occasional late or missing last final, so the stall cap promotes the interim
 *                       (the NativelyPro relay)
 *   rest-batch          no interims, one final 1.0-2.5 s after the speech stops, no local hint (Groq/Whisper REST)
 * Speaker labels are NOT passed to the engine: main.ts's ingest() sends no speakerId today,
 * so production candidates carry none. The transcript's speaker names only tell OTHERS from USER.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const dist = (f) => require(path.join(root, 'dist-electron/electron', f));
const { SimpleAutoAnswerEngine } = dist('intelligence/autoAnswer/SimpleAutoAnswer.js');
const { FakeClock } = await import(path.join(root, 'electron/intelligence/autoAnswer/__tests__/fakeClock.mjs'));

const MODE_NAMES = {
  general: 'General', 'technical-interview': 'Technical Interview', 'looking-for-work': 'Looking for work',
  sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', lecture: 'Lecture', seminar: 'Seminar',
  'call-center': 'Call Center',
};
export const PROFILES = ['streaming-endpoint', 'relay-bursty', 'rest-batch'];
const HOT_WINDOW_MS = 180_000; // main.ts recentTurns: the same 180 s the answer is written from

/** mulberry32: small, seedable, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const hashSeed = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
/** Share of `part`'s words found, in order-free bag terms, in `whole`. */
function containment(part, whole) {
  const p = norm(part); if (!p.length) return 0;
  const bag = new Map(); for (const w of norm(whole)) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0; for (const w of p) { const n = bag.get(w) ?? 0; if (n > 0) { hit++; bag.set(w, n - 1); } }
  return hit / p.length;
}

/** Chunk one OTHERS turn's words into finals, per profile. */
function finalChunks(words, profile, r) {
  if (profile === 'rest-batch') return [words];
  const chunks = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const clauseEnd = /[.?!,;:]$/.test(words[i]);
    const cap = profile === 'relay-bursty' ? between(r, 4, 10) : between(r, 6, 14);
    if ((clauseEnd && cur.length >= 3 && r() < 0.7) || cur.length >= cap) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Replay one transcript. Returns the candidates (one per judge call).
 * `opts.wordMs` etc. exist for tests; defaults are the realistic ranges.
 */
export async function replayTranscript(tx, opts = {}) {
  const r = rng(tx.seed ?? hashSeed(tx.transcript_id));
  const profile = opts.profile ?? tx.stt_profile ?? PROFILES[Math.floor(r() * PROFILES.length)];
  const clock = new FakeClock();
  const turns = [];                 // finalized hot-window turns, as main.ts keeps them
  const candidates = [];
  const othersTurns = [];           // {index, text, ask, tags, startAt, endAt}
  const st = { accepting: true, streaming: false, generation: 1 };
  const flush = () => new Promise((res) => setImmediate(res));
  const advance = async (ms) => { let left = ms; while (left > 0) { const s = Math.min(50, left); clock.advance(s); left -= s; await flush(); } };

  // The fake judge: answers from the generator's annotation. A candidate that ends
  // inside a turn is unfinished; one that contains a whole ask turn not yet answered
  // is an ask; everything else is not. Its only job is to move the engine's state.
  function oracle(req) {
    const cand = req.candidateText;
    const covered = othersTurns.filter(t => containment(t.text, cand) >= 0.8);
    const tail = norm(cand).slice(-3).join(' ');
    const open = othersTurns.find(t => t.endAt > clock.now() - 1 && !covered.includes(t) && norm(t.text).join(' ').includes(tail));
    if (open) return JSON.stringify({ is_ask: false, directed_at_user: true, complete: false, act: 'incomplete', answerability: 0, question_text: null });
    const ask = [...covered].reverse().find(t => t.ask);
    return ask
      ? JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', answerability: 0.95, question_text: null })
      : JSON.stringify({ is_ask: false, directed_at_user: false, complete: true, act: 'statement', answerability: 0.05, question_text: null });
  }

  const host = {
    isEnabled: () => true,
    isMeetingActive: () => true,
    meetingGeneration: () => st.generation,
    engineAccepting: () => st.accepting,
    answerStreamActive: () => st.streaming,
    recentTurns: () => turns.filter(t => t.timestamp >= clock.now() - HOT_WINDOW_MS),
    dispatch: () => {
      // The answer streams for a few seconds; the engine parks candidates meanwhile.
      st.streaming = true; st.accepting = false;
      clock.setTimeout(() => { st.streaming = false; st.accepting = true; engine.onEngineIdle(); }, between(r, 3500, 8000));
    },
    judgeCandidate: async (req) => {
      const overlap = othersTurns.filter(t => containment(t.text, req.candidateText) >= 0.5 || containment(req.candidateText, t.text) >= 0.5);
      candidates.push({
        id: `${tx.transcript_id}-c${String(candidates.length).padStart(2, '0')}`,
        transcript_id: tx.transcript_id,
        mode: tx.mode,
        user_name: tx.user_name ?? null,
        context: (req.recentTurns ?? []).map(t => ({ speaker: t.role === 'interviewer' ? 'OTHERS' : 'USER', text: t.text })),
        last_answered: req.lastAnsweredText ?? null,
        candidate: req.candidateText,
        transcript_lagging: req.transcriptLagging === true,
        hard_case_tags: [...new Set(overlap.flatMap(t => t.tags ?? []))],
        replay: { profile, oracle: null, overlap_turns: overlap.map(t => t.index), at_ms: clock.now() },
      });
      const verdict = oracle(req);
      candidates[candidates.length - 1].replay.oracle = JSON.parse(verdict).complete === false ? 'incomplete' : JSON.parse(verdict).is_ask ? 'ask' : 'not_ask';
      // A judge takes time: 300-1200 ms, so stale/held paths get exercised.
      await new Promise((res) => clock.setTimeout(res, between(r, 300, 1200)));
      return verdict;
    },
    modeName: () => MODE_NAMES[tx.mode] ?? null,
    userName: () => tx.user_name ?? null,
    telemetry: () => {},
    log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();

  const sttProvider = profile === 'rest-batch' ? 'groq' : profile === 'relay-bursty' ? 'natively' : 'deepgram';
  const wordMs = () => (opts.wordMs ?? between(r, 300, 430));
  const seg = (speaker, text, final) => ({ speaker, text, final, timestamp: clock.now(), origin: 'stt', sttProvider, punctuationSource: final ? 'provider_final' : 'none' });

  // Finals arrive IN ORDER: a lagging final holds back every final after it (a relay
  // backlog), it is never overtaken. A lost final (lag null) holds nothing back.
  let backlogUntil = 0;
  const ingestFinal = (text) => { turns.push({ role: 'interviewer', text, timestamp: clock.now() }); engine.ingest(seg('interviewer', text, true)); };
  function deliverFinal(text, lag) {
    const at = Math.max(clock.now() + lag, backlogUntil);
    if (at <= clock.now()) { ingestFinal(text); return; }
    backlogUntil = at;
    clock.setTimeout(() => ingestFinal(text), at - clock.now());
  }

  for (let i = 0; i < tx.turns.length; i++) {
    const turn = tx.turns[i];
    const isUser = turn.speaker === 'USER';
    const words = String(turn.text).split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (isUser) {
      await advance(words.length * wordMs());
      turns.push({ role: 'user', text: turn.text, timestamp: clock.now() });
      engine.ingest(seg('user', turn.text, true));
      await advance(between(r, 300, 1500));
      continue;
    }
    const meta = { index: i, text: turn.text, ask: !!turn.ask, tags: turn.tags ?? [], startAt: clock.now(), endAt: Infinity };
    othersTurns.push(meta);
    engine.onLocalSpeechStart();
    const chunks = finalChunks(words, profile, r);
    // Relay stall, decided before the turn is spoken: 25% the last final lags 3.5-8 s
    // (the stall cap promotes the frozen interim first), 5% it never comes. A stalled
    // interim usually froze mid-word (live 2026-09-27: "...how would you partition the ord").
    let relayLag = null;
    if (profile === 'relay-bursty') {
      const roll = r();
      relayLag = roll < 0.05 ? null : roll < 0.30 ? between(r, 3500, 8000) : between(r, 300, 1200);
    }
    const stalled = profile === 'relay-bursty' && (relayLag === null || relayLag >= 3500);
    const freezeEarly = stalled && r() < 0.6;
    let spoken = [];
    const pendingFinals = [];
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      for (let w = 0; w < chunk.length; w++) {
        const word = chunk[w];
        if (profile === 'rest-batch') { await advance(wordMs()); spoken.push(word); continue; }
        // Streaming STT revises its interim every 70-110 ms while someone talks, the partial
        // word included, so continuous speech never leaves the engine's EARLY_JUDGE_MS
        // (120 ms) gap. Speakers DO pause: a hesitation (~7% of words) or a breath after a
        // clause (~35% of clause ends) of 150-700 ms, and that is where early judging happens.
        const prev = spoken.length ? spoken[spoken.length - 1] : (c > 0 ? chunks[c - 1][chunks[c - 1].length - 1] : '');
        if (spoken.length + c > 0 && r() < (/[,;:.?!]$/.test(prev) ? 0.35 : 0.07)) await advance(between(r, 150, 700));
        const dur = wordMs();
        const ticks = Math.max(2, Math.ceil(dur / between(r, 70, 110)));
        for (let t = 1; t <= ticks; t++) {
          await advance(Math.round(dur / ticks));
          const partial = t < ticks ? word.slice(0, Math.max(1, Math.ceil(word.length * t / ticks))) : word;
          const lastWord = c === chunks.length - 1 && w === chunk.length - 1;
          if (freezeEarly && lastWord && t > 1) continue;   // the interim froze on a clipped word
          engine.ingest(seg('interviewer', [...spoken, partial].join(' '), false));
        }
        spoken.push(word);
      }
      let text = chunk.join(' ');
      const last = c === chunks.length - 1;
      // relay: a final cut mid-word, the rest of the word opening the next final
      if (profile === 'relay-bursty' && !last && r() < 0.12) {
        const tail = chunk[chunk.length - 1];
        if (tail.length > 4) {
          const cut = between(r, 2, tail.length - 2);
          text = [...chunk.slice(0, -1), tail.slice(0, cut)].join(' ');
          chunks[c + 1].unshift(tail.slice(cut));   // the relay sends the word's remainder as the next final's first token
        }
      }
      if (profile === 'rest-batch' || !last) {
        pendingFinals.push(text);
        if (profile !== 'rest-batch') {
          deliverFinal(text, 0);
          pendingFinals.pop();
          spoken = [];
        }
      } else {
        pendingFinals.push(text);
      }
    }
    meta.endAt = clock.now();
    // Speech stopped. What the providers do now differs.
    if (profile === 'streaming-endpoint') {
      engine.onLocalSpeechEnd();
      await advance(between(r, 80, 400));
      const text = pendingFinals.pop();
      turns.push({ role: 'interviewer', text, timestamp: clock.now() });
      engine.ingest(seg('interviewer', text, true));
      engine.onProviderEndpoint();
    } else if (profile === 'relay-bursty') {
      engine.onLocalSpeechEnd();
      const text = pendingFinals.pop();
      if (relayLag !== null) deliverFinal(text, relayLag);
    } else {
      // REST: one final for the whole segment, after the upload.
      await advance(between(r, 1000, 2500));
      const text = pendingFinals.pop();
      turns.push({ role: 'interviewer', text, timestamp: clock.now() });
      engine.ingest(seg('interviewer', text, true));
    }
    // The gap before the next speaker.
    const next = tx.turns[i + 1];
    await advance(next ? between(r, next.speaker === 'USER' ? 600 : 250, next.speaker === 'USER' ? 2500 : 1500) : 9000);
  }
  await advance(12_000);
  engine.onMeetingStop();
  return candidates;
}

async function selfTest() {
  const tx = {
    transcript_id: 'selftest-1', mode: 'technical-interview', user_name: 'Jordan Lee', seed: 42,
    turns: [
      { speaker: 'OTHERS', text: 'Thanks for joining today, I run the platform team here.', tags: ['statement_needs_ack'] },
      { speaker: 'OTHERS', text: 'So to start, how would you design a rate limiter for a public API?', ask: true, tags: ['direct_question'] },
      { speaker: 'USER', text: 'I would start with a token bucket per client key and keep counters in Redis.' },
      { speaker: 'OTHERS', text: 'Okay so you would keep the counters in Redis, right?', tags: ['paraphrase_of_user'] },
      { speaker: 'OTHERS', text: 'And what happens when a Redis node fails during a traffic spike?', ask: true, tags: ['followup_probe'] },
    ],
  };
  const out = {};
  for (const p of PROFILES) out[p] = await replayTranscript(tx, { profile: p });
  for (const [p, c] of Object.entries(out)) {
    console.error(`${p}: ${c.length} candidates`);
    for (const x of c) console.error(`   [${x.replay.oracle}${x.transcript_lagging ? ', lagging' : ''}] ${x.candidate}`);
  }
  const total = Object.values(out).reduce((n, c) => n + c.length, 0);
  if (!total) { console.error('self-test FAILED: no candidates'); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg || arg === '--self-test') {
    await selfTest();
  } else {
    const lines = fs.readFileSync(arg, 'utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      const tx = JSON.parse(line);
      for (const c of await replayTranscript(tx)) process.stdout.write(JSON.stringify(c) + '\n');
    }
  }
}
