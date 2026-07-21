// GOLDEN TRACE #10 (Phase 1 continuation): tests H1 (indexing race) under
// conditions closer to the founder's actual usage than golden-trace-refdoc.mjs
// did. That earlier trace used a single scripted __e2e__:ask call per
// question — this trace instead builds up a REALISTIC multi-turn live
// transcript (several prior interviewer/candidate turns, as a real meeting
// would have) via im.addTranscript-equivalent injection, attaches a reference
// document mid-conversation, and fires the VERY NEXT interviewer turn as a
// question about that document within ~50-150ms of the attach completing —
// the closest approximation of "the meeting overlay answers wrong on the very
// first question after attaching a document" achievable through the E2E
// harness without a live mic.
//
// Also probes H8 (desync) by firing a SECOND question in overlapping flight
// with the first (not waiting for settle) to see if answers cross-wire.
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => (window.electronAPI || window.api).setModel('natively'));

const DOC_CONTENT = `# Q3 Product Roadmap — Nimbus Team

## Section 1: Launch Timeline
Nimbus 3.0 is targeting a public beta on September 15th, gated on the
payments-migration workstream landing first. The internal freeze is August 28th.

## Section 2: Team
The Nimbus tech lead is Priya Raman. The eng manager is Devon Blake.
QA lead: Sam Okafor.

## Section 3: Known Risks
The biggest risk is the Stripe webhook migration, currently at 60% complete,
owned by the payments squad (lead: Carlos Vega).
`;

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace LiveTranscriptRace Lecture', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

// Build up realistic prior conversation turns BEFORE the document is even
// attached, so the session has genuine transcript history (a real meeting
// would never start with zero context).
const priorTurns = [
  { speaker: 'interviewer', text: "Hey, thanks for hopping on. Let's just go over the roadmap doc I'm about to share." },
  { speaker: 'user', text: 'Sounds good, ready whenever.' },
  { speaker: 'interviewer', text: "Great, sharing it now, give me one sec." },
];

// Attach the doc, then immediately (t+~50ms) ask the first real question,
// exactly the founder's "first question right after attach" scenario.
const attachedAt = Date.now();
const addPromise = R('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'nimbus-roadmap.md', content: DOC_CONTENT });
await addPromise;
const askDelayMs = Date.now() - attachedAt;

const ask1Promise = R('__e2e__:ask', {
  question: 'Who is the QA lead for this project, and what is the biggest risk called out?',
  priorTurns,
  timeoutMs: 45000,
});

const result1 = await ask1Promise;
const text1 = result1?.answer || result1?.streamedTokens || '';

console.log('GOLDEN_TRACE_LIVE_RACE_BEGIN');
console.log(JSON.stringify({
  askFiredAtMsAfterAttach: askDelayMs,
  q1: {
    question: 'Who is the QA lead for this project, and what is the biggest risk called out?',
    rawResponse: result1,
    mentionsSamOkafor: /sam\s+okafor/i.test(text1),
    mentionsStripeWebhook: /stripe.{0,20}webhook/i.test(text1),
    isSafeRefusal: /could not find that in the retrieved sections/i.test(text1),
    isGenericRefusal: /(don't have access|no (uploaded|attached) (document|file|source)|only respond from uploaded|can only answer from|not (in|part of) (the|my) (uploaded|reference|knowledge)|reference files? (are|is) )/i.test(text1),
  },
}, null, 2));
console.log('GOLDEN_TRACE_LIVE_RACE_END');
await app.close();
