// scripts/answer-quality/real-engine-ablation.mjs
//
// THE TEST EVERY EARLIER ABLATION SHOULD HAVE BEEN.
//
// Every with/without-intent comparison so far injected the answer shape into a
// prompt I wrote. This drives the REAL IntelligenceEngine, the REAL
// SessionTracker, the REAL ModesManager and the REAL three-tier classifier,
// and records the prompt that is ACTUALLY DISPATCHED to the provider, via a
// recording stub at the one seam where WhatToAnswerLLM hands off:
// llmHelper.streamChatWithOutcome(userMessage, imagePaths, _, systemPrompt, ...).
//
// The question it answers: on the default path (Context Intelligence V3 is
// default ON), does the classifier's output reach the model at all?
//
// Run under ELECTRON_RUN_AS_NODE, the same way the engine's own tests run.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(process.cwd());
const require = createRequire(import.meta.url);
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);
process.resourcesPath ||= path.join(repoRoot, 'resources');

const { IntelligenceEngine } = await import(pathToFileURL(dist('IntelligenceEngine.js')).href);
const { SessionTracker } = require(dist('SessionTracker.js'));
const { ModesManager } = require(dist('services/ModesManager.js'));
const IC = require(dist('llm/IntentClassifier.js'));

// ── recording llmHelper ─────────────────────────────────────────────────────
const dispatched = [];
const unknownCalls = new Set();
const calledMethods = new Map();
const helper = new Proxy({}, {
  get(_, prop) {
    if (typeof prop === 'string' && prop !== 'then') calledMethods.set(prop, (calledMethods.get(prop) ?? 0) + 1);
    if (prop === 'streamChat') return (...args) => {
      dispatched.push({ via: 'streamChat', user: String(args[0] ?? ''), system: String(args[3] ?? ''), route: args[9] ?? null });
      return (async function* () { yield 'okay so here is what i would say about that.'; })();
    };
    if (prop === 'streamChatWithOutcome') return (...args) => {
      dispatched.push({ via: 'streamChatWithOutcome', user: String(args[0] ?? ''), system: String(args[3] ?? ''), route: args[9] ?? null });
      return { stream: (async function* () { yield 'okay so here is what i would say about that.'; })(), outcome: { truncated: false } };
    };
    if (prop === 'fitContextForCurrentModel') return (s) => s;
    if (prop === 'canUseLocalFallback') return () => false;
    if (prop === 'setNegotiationCoachingHandler') return () => {};
    if (prop === 'getCurrentModel' || prop === 'getSelectedModel' || prop === 'getModelId') return () => 'test-model';
    // Shapes WhatToAnswerLLM actually reads: capabilities.outputBudgetTokens, a tier string.
    if (prop === 'getCapabilities') return () => ({ outputBudgetTokens: 2000, supportsVision: false, supportsStreaming: true });
    if (prop === 'getPromptTier') return () => 'standard';
    if (prop === 'isUsingOllama') return () => false;
    if (prop === 'getKnowledgeOrchestrator') return () => null;
    if (prop === 'then') return undefined;
    unknownCalls.add(String(prop));
    return () => undefined;
  },
});

// ── active mode: technical interview, to match the fixture ─────────────────
const mm = ModesManager.getInstance();
try {
  const all = mm.getModes?.() ?? [];
  const ti = all.find((m) => m.templateType === 'technical-interview');
  if (ti && process.env.HARNESS_MODE === 'technical-interview') mm.setActiveMode(ti.id);
} catch (e) { console.log('[harness] could not set technical-interview mode:', e?.message); }
const activeInfo = mm.getActiveModeInfo?.();
console.log(`[harness] active mode: ${activeInfo?.templateType ?? 'NONE'} (${activeInfo?.id ?? '-'})`);

// ── capture the dispatch trace ─────────────────────────────────────────────
const traces = [];
const origLog = console.log;
console.log = (...a) => {
  const s = a.map(String).join(' ');
  if (s.includes('prompt_dispatched')) { try { traces.push(JSON.parse(s.slice(s.indexOf('{')))); } catch {} }
  if (process.env.HARNESS_VERBOSE) origLog(...a);
};

const session = new SessionTracker();
const engine = new IntelligenceEngine(helper, session);

const lines = fs.readFileSync(path.join(repoRoot, 'scripts/answer-quality/transcripts/technical-interview.turns.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean);
const MAX = Number(process.env.MAX_TURNS || 14);

const rows = [];
let t = Date.now();
for (const line of lines) {
  const m = /^(INTERVIEWER|USER):\s*(.+)$/i.exec(line); if (!m) continue;
  const [, who, rawText] = m; const text = rawText.replace(/^<text>\s*/i, '').trim();
  const speaker = who.toUpperCase() === 'USER' ? 'user' : 'interviewer';
  session.handleTranscript({ speaker, text, timestamp: (t += 4000), final: true });
  if (speaker !== 'interviewer' || rows.length >= MAX) continue;

  const before = dispatched.length; const beforeT = traces.length;
  // Manual press, so the sentinel path cannot silence it and the prompt is built.
  let emitted = null;
  const onAns = (a) => { emitted = a; };
  engine.on('suggested_answer', onAns);
  const returned = await engine.runWhatShouldISay(text, 0.9, undefined, { skipCooldown: true, forceFresh: true });
  engine.off?.('suggested_answer', onAns);
  if (process.env.HARNESS_VERBOSE) origLog(`[harness] returned=${JSON.stringify(String(returned ?? '').slice(0, 160))} emitted=${JSON.stringify(String(emitted ?? '').slice(0, 160))}`);

  const d = dispatched.slice(before); const tr = traces.slice(beforeT);
  const last = d[d.length - 1];
  const intent = await IC.classifyIntent(text, session.getFormattedContext(120), session.getAssistantResponseHistory().length).catch(() => null);
  // EVERY dispatch this turn made, not only the last. A turn can dispatch more
  // than once (structure repair, clause-coverage repair), and the claim is that
  // the classifier's output reaches NONE of them.
  const RE = /intent_and_shape|ANSWER SHAPE:|DETECTED INTENT:/;
  const anyIntent = d.some((x) => RE.test(x.user) || RE.test(x.system));
  rows.push({ q: text.slice(0, 50), intent: intent?.intent ?? '?', promptSource: tr[tr.length - 1]?.promptSource ?? (d.length ? 'untraced' : 'NOT DISPATCHED'),
    dispatches: d.length, intentInPrompt: d.length ? anyIntent : null, sys: last?.system.length ?? 0, usr: last?.user.length ?? 0 });
}
console.log = origLog;

console.log(`\nREAL ENGINE, REAL CLASSIFIER, REAL PROMPT ASSEMBLY — active mode ${activeInfo?.templateType ?? 'NONE'}\n`);
console.log('classifier said    promptSource  dispatches  intent in ANY dispatched prompt?   sys/usr chars   question');
console.log('-'.repeat(104));
for (const r of rows) console.log(`${r.intent.padEnd(18)} ${String(r.promptSource).padEnd(13)} ${String(r.dispatches).padEnd(11)} ${String(r.intentInPrompt).padEnd(34)} ${String(r.sys).padStart(5)}/${String(r.usr).padEnd(6)} "${r.q}"`);

const n = rows.filter((r) => r.promptSource !== 'NOT DISPATCHED').length;
const v3 = rows.filter((r) => r.promptSource === 'v3').length;
const withIntent = rows.filter((r) => r.intentInPrompt === true).length;
const totalDispatches = rows.reduce((a, r) => a + (r.dispatches || 0), 0);
console.log(`\nturns: ${n}   composed by V3: ${v3}   total provider dispatches: ${totalDispatches}   dispatches carrying the classifier's intent/shape: ${withIntent}`);
if (unknownCalls.size) console.log(`[harness] helper methods stubbed as no-op: ${[...unknownCalls].join(', ')}`);
console.log(`[harness] every helper method invoked: ${[...calledMethods].map(([k,v])=>k+'x'+v).join(', ') || 'NONE'}`);
process.exit(0);
