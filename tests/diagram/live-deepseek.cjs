// tests/diagram/live-deepseek.cjs — LIVE check of diagram answers against a real model.
//
// Opt-in, costs API calls:
//   npm run build:electron
//   RUN_DIAGRAM_LIVE=1 ELECTRON_RUN_AS_NODE=1 electron tests/diagram/live-deepseek.cjs --out=<dir> [--only=L1,L2] [--suite=design|catalog|undecided] [--model=deepseek-flash]
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
  // A "walk me through" question that does not ask for a picture: drawing is the model's call.
  { id: 'L4', mode: 'technical-interview', expect: 'diagram', optional: true, steps: [['wta', 'Walk me through the request flow when a user logs in with Google OAuth, between the browser, our backend and Google.']] },
  { id: 'L5', mode: 'technical-interview', expect: 'diagram', steps: [['wta', "What states does an order go through from checkout to delivery, and what moves it between them? Draw it as a state diagram."]] },
  { id: 'L6', mode: 'technical-interview', expect: 'diagram', steps: [['manual', 'Design a rate limiter for a public API.']] },
  { id: 'L7', mode: 'general', expect: 'diagram', steps: [['wta', 'Can you sketch the architecture for a file upload pipeline with virus scanning and thumbnails?']] },
  { id: 'L8', mode: 'technical-interview', expect: 'diagram', steps: [['wta', "Design Twitter's home timeline. Go deep: fan-out, caching, storage, and how you'd handle celebrities."]] },
  { id: 'L9', mode: 'technical-interview', expect: 'diagram+code', steps: [['wta', 'Design an idempotent payment API and show the handler code in TypeScript.']] },
  { id: 'L10', mode: 'technical-interview', expect: 'diagram', steps: [['wta', 'Draw the Google OAuth login flow between the browser, our backend and Google as a sequence diagram.']] },
  { id: 'C1', mode: 'technical-interview', expect: 'none', steps: [['wta', 'Write a function to solve two sum.']] },
  { id: 'C2', mode: 'technical-interview', expect: 'none', steps: [['wta', 'What is a hash table and when would you use one?']] },
  { id: 'C3', mode: 'looking-for-work', expect: 'none', steps: [['wta', 'Tell me about a time you disagreed with a teammate.']] },
];

// ── the nine-mode catalog, live ─────────────────────────────────────────────
//
// `seed` is what was said before the question (the evidence a visual may use).
// `judge` decides from the committed answer whether the model did the right
// thing — including the cases where the right thing is NOT to draw.
const CATALOG_SCENARIOS = [
  {
    id: 'M1', mode: 'sales', seed: ['We are at ten thousand dollars a month in revenue right now.'],
    steps: [
      ['wta', 'What would revenue look like at 5% monthly growth over the next three months?', 'forecast'],
      ['wta', 'Make it 3%', 'update'],
      // Shorten the answer that holds the 3% chart: its numbers must not move.
      ['refine', 'shorten', 'refine'],
      ['wta', 'Why is the last month higher?', 'explain'],
    ],
  },
  { id: 'M2', mode: 'sales', seed: [], steps: [['wta', 'What would revenue look like at 5% monthly growth?', 'no-baseline']] },
  { id: 'M3', mode: 'sales', seed: ['Of the 200 leads we created in Q3, 120 were qualified, 60 got a proposal and 22 closed.'], steps: [['wta', 'Where are deals dropping out?', 'funnel']] },
  { id: 'M4', mode: 'sales', seed: ['Setup costs twelve thousand dollars and it saves us about twenty-five hundred dollars a month.'], steps: [['wta', 'Show the expected savings and break-even over eight months.', 'breakeven']] },
  { id: 'M5', mode: 'technical-interview', seed: [], steps: [['wta', 'Model users, orders, and payments.', 'er']] },
  { id: 'M6', mode: 'technical-interview', seed: [], steps: [['wta', 'Design the objects for a parking lot.', 'class']] },
  { id: 'M7', mode: 'lecture', seed: [], steps: [['wta', 'Construct the DFA over the alphabet a and b that accepts strings ending in ab.', 'dfa']] },
  { id: 'M8', mode: 'lecture', seed: [], steps: [['wta', 'Draw customers and orders in Chen notation: one customer places many orders, and every order has a customer.', 'chen']] },
  { id: 'M9', mode: 'call-center', seed: ['My router keeps dropping the connection since this morning.', 'The internet light is blinking orange and I already restarted it once.'], steps: [['wta', 'Walk me through diagnosing this issue.', 'decision']] },
  { id: 'M10', mode: 'recruiting', seed: ['The role needs Kubernetes in production, experience leading a team, and on-call experience.', 'I ran a forty node Kubernetes cluster for two years and I mentored two engineers.'], steps: [['wta', "Map this candidate's experience to the role.", 'matrix']] },
  { id: 'M11', mode: 'looking-for-work', seed: [], steps: [['wta', 'Summarize my career progression.', 'no-evidence']] },
  { id: 'M12', mode: 'team-meet', seed: ['The orders API is blocked by the schema migration.', 'Mobile checkout is waiting on the orders API.', 'The checkout design is done and ready.'], steps: [['wta', 'Show which work blocks which.', 'dependency']] },
  { id: 'M13', mode: 'general', seed: ['For this year engineering gets 420 thousand dollars, design 120 thousand, marketing 210 thousand and support 90 thousand.'], steps: [['wta', 'Show how the budget is split.', 'breakdown']] },
  { id: 'M14', mode: 'seminar', seed: [], steps: [['wta', 'Draw the method described in this paper.', 'no-evidence']] },
  { id: 'M15', mode: 'general', seed: ['We talked about pricing, about onboarding, and about the launch email.', 'The risks were slow adoption and support load.'], steps: [['wta', 'Organize the ideas we discussed.', 'mindmap']] },
  { id: 'M16', mode: 'team-meet', seed: ['Beta goes out on October 12th, the public launch is November 2nd, and the review is on November 16th.'], steps: [['wta', 'Show release milestones.', 'timeline']] },
  { id: 'N1', mode: 'sales', seed: [], steps: [['wta', 'How do I handle the pricing objection in one sentence?', 'control']] },
  { id: 'N2', mode: 'call-center', seed: [], steps: [['wta', 'What is your return policy for opened items?', 'control']] },
  { id: 'N3', mode: 'lecture', seed: [], steps: [['wta', 'What is gradient descent?', 'control']] },
];

// ── turns the four-language rules cannot place, live ────────────────────────
//
// Spanish, Russian, Chinese, Japanese. The rules leave each of the labelled
// steps below UNDECIDED (pinned in diagramUndecided.test.mjs), so the prompt
// carries the conditional contract and the model decides: a drawing asked
// for, a change to the one on the table, a question about it, or neither.
// The first step of U1 and U4 is a design ask the rules do place: it puts a
// drawing on the table through the real engine.
const UNDECIDED_SCENARIOS = [
  {
    id: 'U1', mode: 'technical-interview', seed: [],
    steps: [
      ['wta', 'Diseña un servicio de notificaciones que envíe correo y SMS, con reintentos.', 'u-draw'],
      ['wta', 'póngale también una cola de mensajes muertos pues, para lo que falla del todo', 'u-update'],
      ['wta', 'y el proveedor de SMS ese, ¿es nuestro o es de fuera?', 'explain'],
      ['wta', '¿A qué hora quedamos mañana con el equipo de pagos?', 'u-none'],
    ],
  },
  { id: 'U2', mode: 'general', seed: [], steps: [['wta', 'Мне бы табличку: Постгрес против Монги — транзакции, масштабирование, стоимость поддержки.', 'u-draw']] },
  { id: 'U3', mode: 'general', seed: [], steps: [['wta', '上周培训的时候老师画了一张特别复杂的时序图，我到现在都没消化', 'u-none']] },
  {
    id: 'U4', mode: 'technical-interview', seed: [],
    steps: [
      ['wta', 'オンライン書店のシステム構成を設計してください。', 'u-draw'],
      ['wta', '決済のところは外部のやつ使うから、名前を「外部決済」に変えといて', 'u-update'],
      ['wta', '来週の面接って何時からでしたっけ', 'u-none'],
    ],
  },
  { id: 'U5', mode: 'team-meet', seed: [], steps: [['wta', 'надо бы как-нибудь нарисовать схему всего этого хозяйства, а то новички путаются', 'u-none']] },
  { id: 'U6', mode: 'general', seed: [], steps: [['wta', 'parce, hágame un favor y me pinta ahí cómo va el flujo de aprobación de un crédito, desde que el cliente lo pide hasta que se desembolsa', 'u-draw']] },
  // Decisions the rules make on weak evidence, handed to the model as well:
  // a request to draw while a drawing is in focus (a change to it, or a new
  // drawing), an edit that names the drawing, a named kind of what is there.
  {
    id: 'U7', mode: 'technical-interview', seed: [],
    steps: [
      ['wta', '设计一个在线书店的系统架构', 'u-draw'],
      ['wta', '支付后面再画一个支付宝和微信的框，标成外部的', 'u-same-design'],
      ['wta', '刚才那个架构图里再加一个推荐服务，接到网关后面', 'u-same-design'],
      ['wta', '画个时序图解释一下TCP三次握手', 'u-new-sequence'],
    ],
  },
  {
    id: 'U8', mode: 'sales', seed: [],
    steps: [
      ['wta', '用柱状图画一下上季度各专科的完成量：全科1240，皮肤科860，儿科430，心理610', 'u-draw'],
      ['wta', '这个给我转成表格吧，专科一列，完成量一列', 'u-table'],
    ],
  },
];

const SUITE = arg('suite', 'all');
const selected = (list) => list.filter((s) => !ONLY || ONLY.split(',').some((o) => s.id === o));
const RUN = [
  ...(SUITE === 'catalog' || SUITE === 'undecided' ? [] : selected(SCENARIOS)),
  ...(SUITE === 'design' || SUITE === 'undecided' ? [] : selected(CATALOG_SCENARIOS)),
  ...(SUITE === 'design' || SUITE === 'catalog' ? [] : selected(UNDECIDED_SCENARIOS)),
];

(async () => {
  const lib = (name) => import(pathToFileURL(path.join(root, 'src/lib/diagram', name)).href);
  const { parseFencedBlocks, isVisualBlock } = await lib('fencedBlocks.mjs');
  const { checkDiagramSource } = await lib('diagramPolicy.mjs');
  const { compileVisualSource } = await lib('visualArtifact.mjs');
  const { analyseErDiagram, describeErDiagram } = await lib('erSemantics.mjs');
  const { validateAutomaton, automatonAccepts } = await lib('automaton.mjs');

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
    const payloads = list.filter((b) => b.kind === 'chart' || b.kind === 'notation');
    const code = list.filter((b) => b.kind === 'code');
    const prose = list.filter((b) => b.kind === 'prose').map((b) => result.answer.slice(b.start, b.end)).join(' ');
    const streamed = result.tokens.map((t) => t[1]).join('');
    const streamBlocks = (() => {
      const parsed = parseFencedBlocks(streamed, { final: true });
      const arr = Array.isArray(parsed) ? parsed : parsed.blocks || [];
      return arr.filter(isVisualBlock);
    })();
    return {
      // Chart and notation blocks, compiled by the same adapters the app draws with.
      payloadBlocks: payloads.map((b) => {
        const compiled = compileVisualSource(b.kind, b.source);
        return {
          kind: b.kind,
          closed: b.closed,
          ok: compiled.ok,
          label: compiled.ok ? compiled.label : null,
          view: compiled.ok ? compiled.view : null,
          badges: compiled.ok ? compiled.badges : [],
          table: compiled.ok && compiled.table ? compiled.table : null,
          notes: compiled.ok ? compiled.notes : [],
          refused: compiled.ok ? null : { code: compiled.code, message: compiled.message, missing: compiled.missing || [] },
          source: b.source,
        };
      }),
      hasMarkdownTable: /^\|.+\|\s*\n\|\s*:?-{3,}/m.test(prose),
      visualBlockCount: mermaid.length + payloads.length,
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
      providerCalls: result.calls.filter((c) => c.model).length,
      // Contract occurrences in the request that produced the answer (0 or 1 expected).
      // The model call (a local-model availability probe can precede it on the wire).
      contractSent: (result.calls.find((c) => c.model) || { contract: 0 }).contract,
      systemChars: (result.calls.find((c) => c.model) || { systemChars: 0 }).systemChars,
    };
  }

  const records = [];
  out(`##### live diagram check · model=${MODEL} · V3=${process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3}`);
  // What "the right thing" is for a catalog turn, judged from the committed answer.
  const tableValues = (a) => (a.payloadBlocks[0] && a.payloadBlocks[0].table ? a.payloadBlocks[0].table.rows.flat().filter((v) => typeof v === 'number') : []);
  const has = (list, wanted) => wanted.every((w) => list.some((v) => Math.abs(v - w) < 0.005));
  const JUDGES = {
    forecast: (a) => (a.payloadBlocks[0]?.ok && a.payloadBlocks[0].label === 'Forecast' && has(tableValues(a), [10000, 10500, 11025, 11576.25]) ? [true, 'forecast chart, computed 10,500 / 11,025 / 11,576.25'] : [false, `wanted the computed forecast: ${JSON.stringify(a.payloadBlocks[0]?.refused || tableValues(a))}`]),
    update: (a) => (a.payloadBlocks[0]?.ok && has(tableValues(a), [10300, 10609, 10927.27]) ? [true, 'updated to 3%: 10,300 / 10,609 / 10,927.27'] : [false, `wanted the 3% forecast: ${JSON.stringify(a.payloadBlocks[0]?.refused || tableValues(a))}`]),
    explain: (a) => (a.visualBlockCount === 0 ? [true, 'prose, no new chart'] : [false, 'redrew on a question']),
    // An undecided turn (the model decides; see UNDECIDED_SCENARIOS).
    'u-draw': (a) => (a.mermaidBlocks.some((b) => b.ok) || a.payloadBlocks.some((b) => b.ok) || a.hasMarkdownTable ? [true, 'drew what was asked for'] : [false, 'no drawing for a request']),
    'u-update': (a) => (a.mermaidBlocks.some((b) => b.ok && b.nodes >= 3) ? [true, 'the drawing came back changed, whole'] : [false, 'no updated drawing for a change']),
    'u-none': (a) => (a.visualBlockCount === 0 && !a.hasMarkdownTable ? [true, 'answered in words'] : [false, 'drew on a turn that asked for nothing']),
    // The drawing on the table came back changed (the session says it is the next version of the same design).
    'u-same-design': (a, prev, answer, design) => (a.mermaidBlocks.some((b) => b.ok) && design && design.version >= 2 ? [true, `the design on the table, changed: version ${design.version}`] : [false, `wanted the next version of the design on the table: ${JSON.stringify(design ? { version: design.version, view: design.view } : null)}`]),
    'u-new-sequence': (a, prev, answer, design) => (a.mermaidBlocks[0]?.ok && a.mermaidBlocks[0].type === 'sequence' && design && design.version === 1 ? [true, 'a new sequence diagram, not a change to the design'] : [false, `wanted a new sequence diagram: ${a.mermaidBlocks[0]?.type || 'no diagram'}, version ${design ? design.version : '—'}`]),
    'u-table': (a, prev, answer) => (a.hasMarkdownTable && ['1240', '860', '430', '610'].every((n) => String(answer).replace(/,/g, '').includes(n)) ? [true, 'the chart\'s own numbers, as a table'] : [false, a.hasMarkdownTable ? 'a table, without the chart\'s numbers' : 'no table of the chart']),
    refine: (a, prev) => (a.payloadBlocks[0]?.ok && prev && a.payloadBlocks[0].source.trim() === prev.trim() ? [true, 'prose shortened, chart unchanged'] : [false, 'the chart changed or was dropped']),
    'no-baseline': (a) => (a.visualBlockCount === 0 ? [true, 'no chart: the baseline was never given'] : a.payloadBlocks[0] && !a.payloadBlocks[0].ok ? [true, `chart refused locally: ${a.payloadBlocks[0].refused.message}`] : [false, `drew a forecast from an invented baseline (stamped ${JSON.stringify(a.payloadBlocks[0]?.badges)}): ${JSON.stringify(tableValues(a).slice(0, 4))}`]),
    funnel: (a) => (a.payloadBlocks[0]?.ok && has(tableValues(a), [200, 120, 60, 22]) ? [true, `stage counts 200 / 120 / 60 / 22${a.payloadBlocks[0].notes.length ? ` (${a.payloadBlocks[0].notes[0]})` : ''}`] : [false, `wanted the stated counts: ${JSON.stringify(a.payloadBlocks[0]?.refused || tableValues(a))}`]),
    breakeven: (a) => (a.payloadBlocks[0]?.ok && has(tableValues(a), [-12000, 500]) ? [true, `break-even computed (${a.payloadBlocks[0].notes.find((n) => /Paid back/.test(n)) || 'no outcome note'})`] : [false, `wanted the break-even calculation: ${JSON.stringify(a.payloadBlocks[0]?.refused || tableValues(a))}`]),
    er: (a) => {
      const b = a.mermaidBlocks[0];
      if (!b || b.type !== 'er' || !b.ok) return [false, `wanted an erDiagram, got ${b ? b.type : 'no diagram'}`];
      const er = analyseErDiagram(b.source);
      return [er.relationships.length >= 2, `${er.entities.length} entities, ${er.relationships.length} relationships. ${describeErDiagram(er).slice(0, 150)}${er.notes.length ? ` · NOTE ${er.notes[0]}` : ''}`];
    },
    class: (a) => (a.mermaidBlocks[0]?.type === 'class' && a.mermaidBlocks[0].ok ? [true, `classDiagram, relations: ${(a.mermaidBlocks[0].source.match(/<\|--|<\|\.\.|\*--|o--|-->/g) || []).join(' ')}`] : [false, `wanted a classDiagram, got ${a.mermaidBlocks[0]?.type || 'none'}`]),
    dfa: (a) => {
      const b = a.payloadBlocks[0];
      if (!b || !b.ok || b.view !== 'automaton') return [false, `wanted an automaton: ${JSON.stringify(b?.refused || b?.view || 'no block')}`];
      const checked = validateAutomaton(JSON.parse(b.source));
      const good = ['ab', 'aab', 'bab', 'abab'].every((w) => automatonAccepts(checked.model, [...w])) && ['', 'a', 'b', 'ba', 'abb', 'aba'].every((w) => !automatonAccepts(checked.model, [...w]));
      return [good && checked.model.type === 'dfa', `${checked.model.type.toUpperCase()} with ${checked.model.states.length} states; accepts exactly the strings ending in ab: ${good}`];
    },
    chen: (a) => (a.payloadBlocks[0]?.ok && a.payloadBlocks[0].view === 'chen' ? [true, `Chen model drawn${a.payloadBlocks[0].notes.length ? ` · ${a.payloadBlocks[0].notes[0]}` : ''}`] : [false, `wanted a Chen model: ${JSON.stringify(a.payloadBlocks[0]?.refused || a.mermaidBlocks[0]?.type || 'no block')}`]),
    decision: (a) => (a.mermaidBlocks[0]?.ok && /\{[^}]+\}/.test(a.mermaidBlocks[0].source) && /-->\|/.test(a.mermaidBlocks[0].source) ? [true, 'decision tree with labelled branches'] : [false, 'no decision tree with labelled branches']),
    matrix: (a, _prev, answer) => (a.hasMarkdownTable && /unknown/i.test(answer) ? [true, 'evidence table, with "unknown" where nothing was said'] : [false, a.hasMarkdownTable ? 'a table, but nothing marked unknown (on-call was never discussed)' : 'no table']),
    'no-evidence': (a, _prev, answer) => {
      const invented = a.mermaidBlocks.some((b) => /\b(?:19|20)\d{2}\b|Acme|Globex/.test(b.source)) || a.payloadBlocks.length > 0;
      return [!invented, invented ? 'drew from facts that were never given' : a.visualBlockCount === 0 ? `nothing drawn; it said: ${answer.replace(/\s+/g, ' ').slice(0, 110)}` : 'drew only a labelled outline'];
    },
    dependency: (a) => (a.mermaidBlocks[0]?.ok && /-->\|"?\w/.test(a.mermaidBlocks[0].source) && /schema/i.test(a.mermaidBlocks[0].source) ? [true, 'dependency map with labelled arrows, from what was said'] : [false, 'no labelled dependency map']),
    breakdown: (a) => (a.payloadBlocks[0]?.ok && has(tableValues(a).map((v) => (v >= 1000 ? v / 1000 : v)), [420, 120, 210, 90]) ? [true, `budget chart (${a.payloadBlocks[0].label}) with the four stated amounts`] : [false, `wanted the stated amounts: ${JSON.stringify(a.payloadBlocks[0]?.refused || tableValues(a))}`]),
    mindmap: (a) => (a.mermaidBlocks[0]?.type === 'mindmap' && a.mermaidBlocks[0].ok ? [true, 'mind map of the ideas raised'] : [false, `wanted a mind map, got ${a.mermaidBlocks[0]?.type || 'none'}`]),
    timeline: (a) => (a.mermaidBlocks[0]?.ok && ['timeline', 'gantt'].includes(a.mermaidBlocks[0].type) ? [true, `${a.mermaidBlocks[0].type} with the stated dates`] : [false, `wanted a timeline, got ${a.mermaidBlocks[0]?.type || 'none'}`]),
    control: (a) => (a.visualBlockCount === 0 && !a.hasMarkdownTable ? [true, 'answered in words'] : [false, 'drew something for a question that wanted words']),
  };

  let previousPayload = null;
  for (const sc of RUN) {
    setMode(sc.mode);
    const ctx = newSession();
    for (const line of sc.seed || []) ctx.session.addTranscript({ speaker: 'system', text: line, timestamp: Date.now() - 5000, final: true });
    for (let i = 0; i < sc.steps.length; i += 1) {
      const [kind, question, label] = sc.steps[i];
      const id = sc.steps.length > 1 ? `${sc.id}.${i + 1}` : sc.id;
      const result = await turn(ctx, kind, question, undefined);
      const a = analyse(result);
      const design = ctx.session.getActiveDesign ? ctx.session.getActiveDesign() : null;
      const judge = JUDGES[label];
      // The original system-design scenarios: a first design is a system-design
      // diagram (never a catalog visual: "Design Twitter's home timeline" once
      // came back as a Mermaid timeline), and a control draws nothing.
      const designVerdict = () => {
        if (sc.expect === 'none') return a.visualBlockCount === 0 ? [true, 'answered without a visual'] : [false, 'drew something for a control question'];
        if (i > 0 || !String(sc.expect).startsWith('diagram')) return null;
        const first = a.mermaidBlocks[0];
        if (!first) return sc.optional ? null : [false, 'no diagram'];
        return [first.ok && ['flowchart', 'sequence', 'state'].includes(first.type) && a.payloadBlocks.length === 0, `a ${first.type} diagram (${first.nodes} nodes, ${first.edges} connections)`];
      };
      const verdict = sc.seed !== undefined ? (judge ? judge(a, previousPayload, result.answer, design) : null) : designVerdict();
      if (a.payloadBlocks[0] && label !== 'refine') previousPayload = a.payloadBlocks[0].source;
      records.push({
        verdict: verdict ? { pass: verdict[0], note: verdict[1] } : null,
        // What was said before the question (shown by live-record.mjs).
        seed: i === 0 && Array.isArray(sc.seed) ? sc.seed : [],
        id, scenario: sc.id, mode: sc.mode, route: kind, label: label || (sc.expect === 'none' ? 'control' : 'create'), expect: sc.expect,
        question, answer: result.answer, tokens: result.tokens, totalMs: result.totalMs, errors: result.errors,
        analysis: a,
        activeDesign: design ? { artifactId: design.artifactId, version: design.version, view: design.view, parentArtifactId: design.parentArtifactId || null } : null,
        // Prompt sizes only — the prompts themselves stay out of the record.
        calls: result.calls.map((c) => ({ ...c })),
      });
      const blocks = [
        ...a.mermaidBlocks.map((b) => `${b.type || '?'} ${b.ok ? 'ok' : `REJECTED:${b.rejection}`} ${b.nodes}n/${b.edges}e @${b.startsAtChar}`),
        ...a.payloadBlocks.map((b) => (b.ok ? `${b.kind}:${b.label}${b.badges.length ? ` [${b.badges.join(',')}]` : ''}` : `${b.kind} REFUSED:${b.refused.code}`)),
        ...(a.hasMarkdownTable ? ['markdown table'] : []),
      ].join(' | ') || 'no visual';
      out(`\n${id.padEnd(5)} [${sc.mode}] [${kind}${label ? `:${label}` : ''}] ${JSON.stringify(question.slice(0, 70))}`);
      if (verdict) out(`      ${verdict[0] ? 'PASS' : 'FAIL'}  ${verdict[1]}`);
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

  const judged = records.filter((r) => r.verdict);
  if (judged.length) {
    const failed = judged.filter((r) => !r.verdict.pass);
    out(`\n##### live: ${judged.length - failed.length}/${judged.length} judged turns did the right thing${failed.length ? `  NOT: ${failed.map((r) => r.id).join(', ')}` : ''}`);
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
