/**
 * Shared test harness for the Auto Answer controller: a fake host, the fake
 * clock, and segment/edge factories on the same timeline. Zero real sleeps —
 * `advance()` moves the clock and drains the microtask queue the controller's
 * async dedup/dispatch steps use.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (rel) => require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/', rel));

export const Controller = dist('AutoAnswerController.js');
export const TurnManager = dist('AutoAnswerTurnManager.js');
export const Detector = dist('AutoAnswerDetector.js');
export const Policy = dist('AutoAnswerPolicy.js');
export const Queue = dist('AutoAnswerQueue.js');
export const Dedup = dist('AutoAnswerDedup.js');
export const ChannelGate = dist('AutoAnswerChannelGate.js');

export const { QUIET_WINDOW_MS, HARD_CAP_MS } = TurnManager;
export const QUIET = QUIET_WINDOW_MS.balanced;
export const { USER_SILENCE_MS, OVERLAP_VETO_MS, HOLD_BUDGET_MS } = ChannelGate;
export const { QUEUE_TTL_MS } = Queue;
export const { QUEUE_RETRY_MS, RHETORICAL_HOLD_MS } = Controller;
export const { CONFIRM_HIGH_MS, CONFIRM_MID_MS, CONFIDENT_ENDPOINT_P, LIKELY_ENDPOINT_P, POSSIBLE_ENDPOINT_P, confirmBudgetMs } = TurnManager;
export const Predictor = dist('AutoAnswerTurnPredictor.js');

export const flush = () => new Promise((r) => setImmediate(r));

export function makeHarness(overrides = {}, options = {}) {
  const clock = new FakeClock();
  const state = {
    enabled: true, meetingActive: true, generation: 3,
    accepting: true, manualActive: false,
    turns: [],                // what the Brain's hot window returns
    dispatched: [],           // {question, reuseSpeculative}
    offered: [],
    skips: [],                // skip reasons in order
    events: [],               // all telemetry
    cancelled: [],
    speculative: { questionId: null, text: null },
    noted: [],
    ...overrides,
  };
  const host = {
    isEnabled: () => state.enabled,
    isMeetingActive: () => state.meetingActive,
    meetingGeneration: () => state.generation,
    engineAccepting: () => state.accepting,
    manualAnswerActive: () => state.manualActive,
    recentTurns: () => state.turns,
    speculativeSnapshot: () => state.speculative,
    noteCandidate: (id, gen) => state.noted.push({ id, gen }),
    dispatch: (q, o) => state.dispatched.push({ question: q, reuseSpeculative: o.reuseSpeculative }),
    offer: (q) => state.offered.push(q),
    cancelAutomaticAnswer: (reason) => { state.cancelled.push(reason); return true; },
    telemetry: (e) => { state.events.push(e); if (e.name === 'auto_answer_ignored') state.skips.push(e.skipReason); },
    log: () => {},
  };
  const controller = new Controller.AutoAnswerController(host, { clock, embed: null, ...options });
  controller.onMeetingStart();

  const seg = (speaker, text, final = true, extra = {}) => ({
    speaker, text, final, timestamp: clock.now(), origin: 'stt',
    punctuationSource: /[.?!]$/.test(text) ? 'provider' : 'unavailable', ...extra,
  });
  /** Interviewer says `text` as one final, and the session records it. */
  const interviewerFinal = (text, extra = {}) => {
    const s = seg('interviewer', text, true, extra);
    state.turns.push({ role: 'interviewer', text, timestamp: s.timestamp, punctuationSource: s.punctuationSource });
    controller.ingest(s);
  };
  const userFinal = (text) => {
    const s = seg('user', text, true);
    state.turns.push({ role: 'user', text, timestamp: s.timestamp });
    controller.ingest(s);
  };
  const partial = (text) => controller.ingest(seg('interviewer', text, false));
  const edge = (channel, speaking, extra = {}) => controller.onSpeechEdge({
    channel, speaking, joint: 'neither', atMs: clock.now(), msSinceOtherEdge: -1, userEdgesVadBacked: true, ...extra,
  });
  const advance = async (ms) => { clock.advance(ms); await flush(); await flush(); };
  const texts = () => state.dispatched.map(d => d.question.text);

  return { clock, state, host, controller, seg, interviewerFinal, userFinal, partial, edge, advance, flush, texts };
}
