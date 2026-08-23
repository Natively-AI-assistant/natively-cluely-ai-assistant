/**
 * Replay runner for Auto Answer fixtures (V2 §31, V3 Amendments 7 and 9).
 *
 * A fixture is a CANONICAL conversation: timestamped transcript events
 * (partials + finals per speaker), VAD edges per channel, and lifecycle
 * events. Provider DIALECTS re-express the same conversation the way each
 * STT provider actually delivers it — Flux turn-level finals + EndOfTurn,
 * Nova is_final fragments + speech_final/UtteranceEnd, AssemblyAI finals +
 * end_of_turn with confidence, ElevenLabs finals-only, REST-Whisper batch
 * finals with upload latency — so parity is a tested property: shouldAnswer,
 * the reconstructed question and the trigger count must be identical across
 * dialects; only latency may differ.
 *
 * Fixture schema:
 * {
 *   "name": "...", "bucket": "positive|negative|...",
 *   "context": [{ "role": "interviewer"|"user", "text": "...", "atOffset": -30000 }],   // prior turns
 *   "events": [
 *     { "at": 0,    "speaker": "interviewer", "final": false, "text": "Tell me about the hardest" },
 *     { "at": 450,  "speaker": "interviewer", "final": true,  "text": "Tell me about the hardest" },
 *     { "at": 100,  "edge": { "channel": "interviewer", "speaking": true } },
 *     { "at": 2000, "speaker": "user", "final": true, "text": "..." },
 *     { "at": 3000, "manual": true }, { "at": 4000, "engineIdle": true }, { "at": 5000, "stop": true }
 *   ],
 *   "expected": { "shouldAnswer": true, "question": "...", "triggerCount": 1, "skipReason": ["..."], "isFollowUp": true },
 *   "expectedFail": true,                // audio-dependent; the text path is expected to miss it
 *   "knownGap": ["rest-whisper"]         // dialects where parity is a recorded gap, not a failure
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, HARD_CAP_MS, QUIET } from './harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(__dirname, 'fixtures');

export const DIALECTS = ['canonical', 'flux', 'nova', 'assemblyai', 'elevenlabs', 'rest-whisper'];

/** Consecutive same-speaker transcript events closer than this form one utterance. */
const UTTERANCE_GAP_MS = 1500;
/** REST providers upload on speech_ended and the final lands after the round trip. */
const REST_UPLOAD_LATENCY_MS = 800;
/** Nova emits UtteranceEnd this long after the last word when no speech_final fired. */
const NOVA_UTTERANCE_END_MS = 1000;
const FLUX_EOT_CONFIDENCE = 0.8;
const ASSEMBLY_EOT_CONFIDENCE = 0.85;

export function loadFixtures(dir = FIXTURE_DIR) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    fixture.file = f;
    return fixture;
  });
}

/** Group transcript events into utterances (same speaker, small gaps), carrying their finals and partials. */
function utterancesOf(events) {
  const out = [];
  for (const e of events) {
    if (!('speaker' in e)) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === e.speaker && e.at - last.lastAt <= UTTERANCE_GAP_MS) {
      last.items.push(e); last.lastAt = e.at;
    } else {
      out.push({ speaker: e.speaker, items: [e], firstAt: e.at, lastAt: e.at });
    }
  }
  return out;
}

/** Re-express canonical events in a provider dialect. Returns a new, sorted event list. */
export function toDialect(events, dialect) {
  if (dialect === 'canonical') return [...events].sort(byAt);
  const nonTranscript = events.filter(e => !('speaker' in e));
  const out = [...nonTranscript];
  for (const u of utterancesOf(events)) {
    const finals = u.items.filter(i => i.final);
    const partials = u.items.filter(i => !i.final);
    const joined = finals.map(f => f.text.trim()).filter(Boolean).join(' ');
    const endAt = finals.length ? finals[finals.length - 1].at : u.lastAt;
    switch (dialect) {
      case 'flux':
        // Turn-level: partials stream (EagerEndOfTurn is just an early partial), ONE final per turn + EndOfTurn.
        out.push(...partials);
        if (joined) {
          out.push({ at: endAt, speaker: u.speaker, final: true, text: joined });
          if (u.speaker === 'interviewer') out.push({ at: endAt + 1, endpoint: { type: 'speech_final', confidence: FLUX_EOT_CONFIDENCE } });
        }
        break;
      case 'nova':
        // is_final per fragment; speech_final on the last fragment of the turn; UtteranceEnd as the fallback.
        out.push(...partials, ...finals);
        if (finals.length && u.speaker === 'interviewer') {
          out.push({ at: endAt + 1, endpoint: { type: 'speech_final' } });
          out.push({ at: endAt + NOVA_UTTERANCE_END_MS, endpoint: { type: 'utterance_end' } });
        }
        break;
      case 'assemblyai':
        out.push(...partials, ...finals);
        if (finals.length && u.speaker === 'interviewer') out.push({ at: endAt + 1, endpoint: { type: 'speech_final', confidence: ASSEMBLY_EOT_CONFIDENCE } });
        break;
      case 'elevenlabs':
        out.push(...finals);           // finals only, no partials, no endpoint
        break;
      case 'rest-whisper':
        // One batch final per utterance, after the upload round trip. No partials, no endpoint.
        if (joined) out.push({ at: endAt + REST_UPLOAD_LATENCY_MS, speaker: u.speaker, final: true, text: joined });
        break;
      default:
        throw new Error(`unknown dialect ${dialect}`);
    }
  }
  return out.sort(byAt);
}

function byAt(a, b) { return a.at - b.at || (('speaker' in a) ? 0 : -1); }

/**
 * Run one fixture in one dialect. Returns what the controller did: dispatched
 * questions (text + answerability + timing), offers, skip reasons, and the
 * per-candidate scores for calibration.
 */
export function replay(fixture, dialect = 'canonical', options = {}) {
  const h = makeHarness(options.hostOverrides ?? {}, options.controllerOptions ?? {});
  const t0 = h.clock.now();
  for (const c of fixture.context ?? []) {
    h.state.turns.push({ role: c.role, text: c.text, timestamp: t0 + (c.atOffset ?? -30000) });
  }
  const events = toDialect(fixture.events, dialect);
  const dispatches = [];
  const origDispatch = h.host.dispatch;
  h.host.dispatch = (q, o) => { dispatches.push({ at: h.clock.now() - t0, text: q.text, answerability: q.answerability, dialogueAct: q.dialogueAct, isFollowUp: q.isFollowUp, id: q.id }); origDispatch(q, o); };

  let cursor = 0;
  for (const e of events) {
    if (e.at > cursor) { h.clock.advance(e.at - cursor); cursor = e.at; }
    if ('speaker' in e) {
      const seg = h.seg(e.speaker, e.text, e.final);
      if (e.final) h.state.turns.push({ role: e.speaker, text: e.text, timestamp: seg.timestamp, punctuationSource: seg.punctuationSource });
      h.controller.ingest(seg);
    } else if (e.edge) {
      h.edge(e.edge.channel, e.edge.speaking, e.edge.vadBacked === false ? { userEdgesVadBacked: false } : {});
    } else if (e.endpoint) {
      h.controller.onProviderEndpoint({ type: e.endpoint.type, timestamp: h.clock.now(), confidence: e.endpoint.confidence });
    } else if (e.manual) {
      h.state.manualActive = true; h.state.accepting = false;
    } else if (e.manualDone) {
      h.state.manualActive = false; h.state.accepting = true; h.controller.onEngineIdle();
    } else if (e.engineIdle) {
      h.state.accepting = true; h.controller.onEngineIdle();
    } else if (e.engineBusy) {
      h.state.accepting = false;
    } else if (e.stop) {
      h.controller.onMeetingStop(); h.state.meetingActive = false;
    } else if (e.start) {
      h.state.meetingActive = true; h.state.generation += 1; h.state.turns = []; h.controller.onMeetingStart();
    }
  }
  // Let every window, cap, hold and TTL run out.
  h.clock.advance(HARD_CAP_MS + QUIET * 2 + 10_000);

  const lastInterviewerAt = [...events].reverse().find(e => 'speaker' in e && e.speaker === 'interviewer' && e.final)?.at ?? 0;
  const candidates = h.state.events.filter(e => e.name === 'auto_answer_candidate');
  return {
    name: fixture.name, dialect,
    shouldAnswer: dispatches.length > 0,
    question: dispatches[0]?.text ?? null,
    questions: dispatches.map(d => d.text),
    triggerCount: dispatches.length,
    offers: h.state.offered.map(q => q.text),
    skips: h.state.skips,
    isFollowUp: dispatches[0]?.isFollowUp ?? null,
    dialogueAct: dispatches[0]?.dialogueAct ?? null,
    latencyMs: dispatches[0] ? dispatches[0].at - lastInterviewerAt : null,
    candidates: candidates.map(c => ({ id: c.questionId, answerability: c.answerability, dialogueAct: c.dialogueAct })),
    dispatches,
    cancelled: h.state.cancelled,
  };
}

/** Compare a replay result against the fixture's expectation. Returns a list of mismatch strings (empty = pass). */
export function judge(fixture, result) {
  const exp = fixture.expected ?? {};
  const problems = [];
  if (exp.shouldAnswer !== undefined && result.shouldAnswer !== exp.shouldAnswer) {
    problems.push(`shouldAnswer ${result.shouldAnswer} != ${exp.shouldAnswer} (skips: ${result.skips.join(',') || 'none'}; offers: ${result.offers.length})`);
  }
  if (exp.question !== undefined && exp.shouldAnswer && normalize(result.question) !== normalize(exp.question)) {
    problems.push(`question ${JSON.stringify(result.question)} != ${JSON.stringify(exp.question)}`);
  }
  if (exp.triggerCount !== undefined && result.triggerCount !== exp.triggerCount) {
    problems.push(`triggerCount ${result.triggerCount} != ${exp.triggerCount}`);
  }
  if (exp.isFollowUp !== undefined && result.isFollowUp !== exp.isFollowUp) {
    problems.push(`isFollowUp ${result.isFollowUp} != ${exp.isFollowUp}`);
  }
  if (exp.skipReason !== undefined && !exp.shouldAnswer && !exp.skipReason.some(r => result.skips.includes(r))) {
    problems.push(`skip reason ${result.skips.join(',') || 'none'} not in ${exp.skipReason.join('|')}`);
  }
  if (exp.cancelled !== undefined && !result.cancelled.includes(exp.cancelled)) {
    problems.push(`expected cancel ${exp.cancelled}, got ${result.cancelled.join(',') || 'none'}`);
  }
  if (exp.noOffer && result.offers.length) problems.push(`offered ${result.offers.length} card(s) on a must-be-silent fixture`);
  return problems;
}

export function normalize(s) {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
