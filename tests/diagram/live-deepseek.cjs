// tests/diagram/live-deepseek.cjs — LIVE check of diagram answers against a real model.
//
// Opt-in, costs API calls:
//   npm run build:electron
//   RUN_DIAGRAM_LIVE=1 ELECTRON_RUN_AS_NODE=1 electron tests/diagram/live-deepseek.cjs --out=<dir> [--only=L1,L2] [--model=deepseek-flash]
//
// Real: DatabaseManager (isolated dir), ModesManager, IntelligenceEngine, the
// planner / composer / prompt system, AND the real LLMHelper talking to
// DeepSeek with the key from .env. Nothing about the provider is stubbed —
// the request the app would send is the request that is sent.
//
// What it records per turn (to <out>/live-answers.json), for the replay check
// (live-replay.check.mjs) and for a person to read:
//   - the committed answer and every token the engine emitted, with its
//     arrival time (what the overlay actually receives);
//   - how many provider calls the turn made;
//   - time to first token, to the END of the Mermaid block, and to the end;
//   - the diagram policy verdict for every Mermaid block.
//
// It does NOT render anything (the main process has no DOM): whether Mermaid
// accepts the source is the replay check's job.
//
// Keys are read from .env and never printed. Platform note: Node APIs only.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const realLog = console.log.bind(console);
const out = (...a) => realLog(...a);

if (process.env.RUN_DIAGRAM_LIVE !== '1') {
  out('skipped: set RUN_DIAGRAM_LIVE=1 (calls a real model; needs DEEPSEEK_API_KEY in .env)');
  process.exit(0);
}

// .env: the worktree's own, else the main checkout's (a worktree has none).
function readEnv() {
  const candidates = [path.join(root, '.env')];
  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const at = root.indexOf(marker);
  if (at > 0) candidates.push(path.join(root.slice(0, at), '.env'));
  if (process.env.NATIVELY_ENV_FILE) candidates.unshift(process.env.NATIVELY_ENV_FILE);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const env = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return env;
  }
  return {};
}
const env = readEnv();
if (!env.DEEPSEEK_API_KEY) {
  out('skipped: no DEEPSEEK_API_KEY in .env');
  process.exit(0);
}

const MODEL = arg('model', 'deepseek-flash');
const ONLY = arg('only', '');
const OUT_DIR = path.resolve(arg('out', path.join(os.tmpdir(), 'natively-diagram-live')));
fs.mkdirSync(OUT_DIR, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-diagram-live-'));
process.env.NATIVELY_TEST_USERDATA = userData;
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = arg('v3', '1');
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;

// The real LLMHelper touches `app` at construction; this run has no app.
const electronStub = new Module('electron');
electronStub.exports = {
  app: {
    isReady: () => true,
    getPath: (n) => (n === 'userData' ? userData : os.tmpdir()),
    getAppPath: () => root,
    getName: () => 'natively-live-check',
    getVersion: () => '0.0.0-live',
    isPackaged: false,
    on: () => {},
    once: () => {},
  },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
  powerMonitor: { on: () => {} },
};
electronStub.loaded = true;
require.cache[require.resolve('electron')] = electronStub;

const quiet = () => {};
console.log = quiet; console.warn = quiet; console.info = quiet; console.debug = quiet;

const d = (p) => path.join(root, 'dist-electron/electron', p);
const { LLMHelper } = require(d('LLMHelper.js'));
const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
const { SessionTracker } = require(d('SessionTracker.js'));
const { ModesManager } = require(d('services/ModesManager.js'));

function setMode(template) {
  const mm = ModesManager.getInstance();
  const mode = mm.getModes().find((m) => m.templateType === template);
  if (!mode) throw new Error(`no mode for template ${template}`);
  mm.updateMode(mode.id, { customContext: '' });
  mm.setActiveMode(mode.id);
}

// Every request that leaves the process, observed at fetch (the answer path
// reaches the provider through more than one helper method, so the wire is the
// only place that sees all of them). Bodies are measured, not kept; the
// Authorization header is never read.
const wire = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
  let host = '';
  try { host = new URL(url).host; } catch { host = '?'; }
  const entry = { host, path: '', model: null, stream: null, thinking: null, maxTokens: null, systemChars: 0, userChars: 0, messages: 0, contract: false, activeDesign: false, startedAt: Date.now(), status: null };
  try { entry.path = new URL(url).pathname; } catch { /* keep empty */ }
  try {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (body && Array.isArray(body.messages)) {
      const text = (m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : '');
      entry.model = body.model ?? null;
      entry.stream = body.stream ?? null;
      entry.thinking = body.thinking ? body.thinking.type : null;
      entry.maxTokens = body.max_tokens ?? null;
      entry.messages = body.messages.length;
      const all = body.messages.map(text).join('\n');
      entry.systemChars = body.messages.filter((m) => m.role === 'system').map(text).join('').length;
      entry.userChars = body.messages.filter((m) => m.role === 'user').map(text).join('').length;
      entry.contract = all.split('<diagram_contract>').length - 1;
      entry.activeDesign = /<active_design view=/.test(all) || /kind="active_design"/.test(all);
      entry.examples = (all.match(/Reference \d+/g) || []).length;
    }
  } catch { /* not a JSON chat body */ }
  wire.push(entry);
  const response = await realFetch(input, init);
  entry.status = response.status;
  return response;
};

function realHelper() {
  const helper = new LLMHelper(undefined, false, undefined, undefined, undefined, undefined, undefined, env.DEEPSEEK_API_KEY);
  helper.setModel(MODEL);
  return helper;
}

function newSession() {
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(realHelper(), session);
  return { engine, session, calls: wire };
}

/** Run one turn; returns everything the overlay would have received, timed. */
async function turn(ctx, kind, question, extra) {
  const tokens = [];
  const errors = [];
  let committed = null;
  const tokenEvent = kind === 'refine' ? 'refined_answer_token' : 'suggested_answer_token';
  const finalEvent = kind === 'refine' ? 'refined_answer' : 'suggested_answer';
  const t0 = Date.now();
  const onToken = (t) => tokens.push([Date.now() - t0, String(t)]);
  const onFinal = (a) => { committed = String(a); };
  const onError = (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300));
  ctx.engine.on(tokenEvent, onToken);
  ctx.engine.on(finalEvent, onFinal);
  ctx.engine.on('error', onError);
  const callsBefore = ctx.calls.length;
  let returned = null;
  try {
    if (kind === 'wta') {
      ctx.session.addTranscript({ speaker: 'system', text: question, timestamp: Date.now(), final: true });
      returned = await ctx.engine.runWhatShouldISay(question, 0.9, undefined, { skipCooldown: true });
    } else if (kind === 'manual') {
      returned = await ctx.engine.runManualAnswer(question);
    } else if (kind === 'refine') {
      returned = await ctx.engine.runFollowUp(question, extra);
    } else if (kind === 'brainstorm') {
      returned = await ctx.engine.runBrainstorm(undefined, question);
    }
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err).slice(0, 300));
  }
  const totalMs = Date.now() - t0;
  ctx.engine.off(tokenEvent, onToken);
  ctx.engine.off(finalEvent, onFinal);
  ctx.engine.off('error', onError);
  const answer = String(committed ?? returned ?? '');
  const calls = ctx.calls.slice(callsBefore);
  return { kind, question, answer, tokens, totalMs, errors, calls };
}

const SCENARIOS = [
  { id: 'L1', mode: 'technical-interview', expect: 'diagram', steps: [['wta', 'How would you design a URL shortener like bit.ly?']] },
  {
    id: 'L2', mode: 'technical-interview', expect: 'diagram',
    steps: [
      ['wta', 'Design a notification service that sends email and SMS, with retries.'],
      ['wta', 'Add retry handling and a dead-letter queue', 'update'],
      ['wta', 'Why do we need the queue?', 'explain'],
      ['wta', 'Show that as a sequence diagram.', 'view'],
      ['refine', 'shorten', 'refine'],
    ],
  },
  { id: 'L3', mode: 'technical-interview', expect: 'diagram', steps: [['wta', 'Design a real-time chat system like WhatsApp for 50 million daily users.']] },
  { id: 'L4', mode: 'technical-interview', expect: 'diagram', steps: [['wta', 'Walk me through the request flow when a user logs in with Google OAuth, between the browser, our backend and Google.']] },
  { id: 'L5', mode: 'technical-interview', expect: 'diagram', steps: [['wta', "What states does an order go through from checkout to delivery, and what moves it between them? Draw it as a state diagram."]] },
  { id: 'L6', mode: 'technical-interview', expect: 'diagram', steps: [['manual', 'Design a rate limiter for a public API.']] },
  { id: 'L7', mode: 'general', expect: 'diagram', steps: [['wta', 'Can you sketch the architecture for a file upload pipeline with virus scanning and thumbnails?']] },
  { id: 'L8', mode: 'technical-interview', expect: 'diagram', steps: [['wta', "Design Twitter's home timeline. Go deep: fan-out, caching, storage, and how you'd handle celebrities."]] },
  { id: 'L9', mode: 'technical-interview', expect: 'diagram+code', steps: [['wta', 'Design an idempotent payment API and show the handler code in TypeScript.']] },
  { id: 'L10', mode: 'technical-interview', expect: 'diagram', steps: [['wta', 'Draw the Google OAuth login flow between the browser, our backend and Google as a sequence diagram.']] },
  { id: 'C1', mode: 'technical-interview', expect: 'none', steps: [['wta', 'Write a function to solve two sum.']] },
  { id: 'C2', mode: 'technical-interview', expect: 'none', steps: [['wta', 'What is a hash table and when would you use one?']] },
  { id: 'C3', mode: 'looking-for-work', expect: 'none', steps: [['wta', 'Tell me about a time you disagreed with a teammate.']] },
].filter((s) => !ONLY || ONLY.split(',').some((o) => s.id === o));

(async () => {
  const lib = (name) => import(pathToFileURL(path.join(root, 'src/lib/diagram', name)).href);
  const { parseFencedBlocks } = await lib('fencedBlocks.mjs');
  const { checkDiagramSource } = await lib('diagramPolicy.mjs');

  /** Arrival time (ms) of the character at `offset` in the token stream. */
  const arrivalOf = (tokens, offset) => {
    let seen = 0;
    for (const [ms, text] of tokens) {
      seen += text.length;
      if (seen >= offset) return ms;
    }
    return null;
  };
  const words = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  function analyse(result) {
    const blocks = parseFencedBlocks(result.answer, { final: true }).blocks || parseFencedBlocks(result.answer, { final: true });
    const list = Array.isArray(blocks) ? blocks : [];
    const mermaid = list.filter((b) => b.kind === 'mermaid');
    const code = list.filter((b) => b.kind === 'code');
    const prose = list.filter((b) => b.kind === 'prose').map((b) => result.answer.slice(b.start, b.end)).join(' ');
    const streamed = result.tokens.map((t) => t[1]).join('');
    const streamBlocks = (() => {
      const parsed = parseFencedBlocks(streamed, { final: true });
      const arr = Array.isArray(parsed) ? parsed : parsed.blocks || [];
      return arr.filter((b) => b.kind === 'mermaid');
    })();
    return {
      mermaidBlocks: mermaid.map((b) => {
        const verdict = checkDiagramSource(b.source);
        return {
          closed: b.closed,
          startsAtChar: b.start,
          type: verdict.type,
          ok: verdict.ok,
          rejection: verdict.rejection || null,
          neutralised: verdict.neutralised,
          nodes: verdict.complexity.nodes,
          edges: verdict.complexity.edges,
          lines: verdict.complexity.lines,
          source: b.source,
        };
      }),
      codeBlocks: code.map((b) => b.lang || b.info || ''),
      proseWords: words(prose),
      answerChars: result.answer.length,
      firstTokenMs: result.tokens.length ? result.tokens[0][0] : null,
      // When the diagram's closing fence reached the overlay (it can draw from here).
      diagramCompleteMs: streamBlocks.length && streamBlocks[0].closed ? arrivalOf(result.tokens, streamBlocks[0].end) : null,
      streamedEqualsCommitted: streamed.trim() === result.answer.trim(),
      providerCalls: result.calls.length,
      // Contract occurrences in the request that produced the answer (0 or 1 expected).
      contractSent: result.calls.length ? result.calls[0].contract : 0,
      systemChars: result.calls.length ? result.calls[0].systemChars : 0,
    };
  }

  const records = [];
  out(`##### live diagram check · model=${MODEL} · V3=${process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3}`);
  for (const sc of SCENARIOS) {
    setMode(sc.mode);
    const ctx = newSession();
    for (let i = 0; i < sc.steps.length; i += 1) {
      const [kind, question, label] = sc.steps[i];
      const id = sc.steps.length > 1 ? `${sc.id}.${i + 1}` : sc.id;
      const result = await turn(ctx, kind, question, undefined);
      const a = analyse(result);
      const design = ctx.session.getActiveDesign ? ctx.session.getActiveDesign() : null;
      records.push({
        id, scenario: sc.id, mode: sc.mode, route: kind, label: label || (sc.expect === 'none' ? 'control' : 'create'), expect: sc.expect,
        question, answer: result.answer, tokens: result.tokens, totalMs: result.totalMs, errors: result.errors,
        analysis: a,
        activeDesign: design ? { artifactId: design.artifactId, version: design.version, view: design.view, parentArtifactId: design.parentArtifactId || null } : null,
        // Prompt sizes only — the prompts themselves stay out of the record.
        calls: result.calls.map((c) => ({ ...c })),
      });
      const blocks = a.mermaidBlocks.map((b) => `${b.type || '?'} ${b.ok ? 'ok' : `REJECTED:${b.rejection}`} ${b.nodes}n/${b.edges}e @${b.startsAtChar}`).join(' | ') || 'no diagram';
      out(`\n${id.padEnd(5)} [${kind}${label ? `:${label}` : ''}] ${JSON.stringify(question.slice(0, 70))}`);
      out(`      ${blocks}${a.codeBlocks.length ? `  + code(${a.codeBlocks.join(',')})` : ''}`);
      const wireNote = result.calls.map((c) => `${c.model || c.host}${c.thinking ? ` thinking:${c.thinking}` : ''} ${c.status} contract×${c.contract}${c.examples ? ` ex×${c.examples}` : ''}${c.activeDesign ? ' +design' : ''} sys=${c.systemChars}`).join(' ; ');
      out(`      wire: ${wireNote || 'no request'}`);
      out(`      calls=${a.providerCalls} · first token ${a.firstTokenMs} ms · diagram complete ${a.diagramCompleteMs ?? '—'} ms · done ${result.totalMs} ms · ${a.proseWords} prose words · ${a.answerChars} chars${a.streamedEqualsCommitted ? '' : ' · committed≠streamed'}${result.errors.length ? ` · ERRORS ${JSON.stringify(result.errors)}` : ''}`);
      if (design) out(`      design on the table: ${design.artifactId} (v${design.version}, ${design.view})`);
    }
  }

  // ── the repair path, live ────────────────────────────────────────────────
  // Exactly what the diagram:repair handler does (electron/services/diagram/
  // diagramIpc.ts): the broken block and the parser's message, on the selected
  // model, with no mode prompt and no transcript. The source below is broken in
  // ways the local fix-ups do not cover (an unclosed label, an arrow Mermaid
  // does not have), and the diagnostic is the pinned Mermaid's own message.
  if (!ONLY || ONLY.split(',').includes('R1')) {
    const { buildDiagramRepairRequest, extractRepairedDiagram } = await lib('diagramRepair.mjs');
    const broken = [
      'flowchart LR',
      '    client["Client"] -->|"POST /shorten"| api["API Service"',
      '    api -->|"write mapping"| db[("URL Store")]',
      '    api ->> cache["Cache"]',
      '    cache -->|"miss"| db',
    ].join('\n');
    const diagnostic = "Parse error on line 2:\n...en\"| api[\"API Service\"    api -->|\"write\n-----------------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', got 'PS'";
    const request = buildDiagramRepairRequest({ source: broken, diagnostic, stage: 'parse' });
    const before = wire.length;
    const helper = realHelper();
    const t0 = Date.now();
    let outText = '';
    let error = null;
    try {
      for await (const chunk of helper.streamChat(request.user, undefined, undefined, request.system, true, true, [], new AbortController().signal)) outText += chunk;
    } catch (err) {
      error = String(err && err.message ? err.message : err).slice(0, 200);
    }
    const ms = Date.now() - t0;
    const repaired = extractRepairedDiagram(outText, broken);
    const verdict = repaired.ok ? checkDiagramSource(repaired.source) : null;
    const answer = repaired.ok ? '```mermaid\n' + repaired.source + '\n```' : '';
    out(`\nR1    [repair] a block with an unclosed label and a wrong arrow`);
    out(`      wire: ${wire.slice(before).map((c) => `${c.model || c.host} ${c.status} sys=${c.systemChars} user=${c.userChars}`).join(' ; ') || 'no request'}`);
    out(`      ${repaired.ok ? `repaired in ${ms} ms · policy ${verdict.ok ? 'ok' : `REJECTED:${verdict.rejection}`} · ${verdict.complexity.nodes}n/${verdict.complexity.edges}e` : `NOT repaired (${repaired.reason}) in ${ms} ms`}${error ? ` · ERROR ${error}` : ''}`);
    if (repaired.ok) {
      const fabricated = { kind: 'wta', question: '(repair)', answer, tokens: [[0, answer]], totalMs: ms, errors: [], calls: wire.slice(before) };
      records.push({
        id: 'R1', scenario: 'R1', mode: 'technical-interview', route: 'wta', label: 'repair', expect: 'diagram',
        question: 'Repair of a broken block (unclosed label, wrong arrow)', answer, tokens: fabricated.tokens, totalMs: ms, errors: [],
        analysis: analyse(fabricated), activeDesign: null, calls: wire.slice(before).map((c) => ({ ...c })), repairedFrom: broken,
      });
    }
  }

  const file = path.join(OUT_DIR, 'live-answers.json');
  fs.writeFileSync(file, JSON.stringify({ model: MODEL, v3: process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3, at: new Date().toISOString(), records }, null, 1));
  out(`\nwrote ${file}`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ }
  setTimeout(() => process.exit(0), 300);
})().catch((e) => {
  out('HARNESS ERROR', (e && e.stack) || e);
  process.exit(2);
});
