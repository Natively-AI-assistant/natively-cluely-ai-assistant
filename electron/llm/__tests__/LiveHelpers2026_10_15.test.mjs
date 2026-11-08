// The overlay's live helpers (2026-10-15): What did I miss?, Define, Sound
// smart (electron/llm/liveHelpers.ts). Quick actions like Recap and Clarify:
// registered in the v2 prompt system and the quick-action turn, run by the
// engine on the press only, streamed into Recap's card or Clarify's line.
//
// Stubs only: no model, no network. Nothing here branches on the platform.
//
// Run under Electron, as `npm test` does:
//   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test --test-force-exit electron/llm/__tests__/LiveHelpers2026_10_15.test.mjs

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-live-helpers-'));
process.env.NATIVELY_TEST_USERDATA = userData;
process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';
{
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      app: { getPath: () => userData, getName: () => 'natively-test', getVersion: () => '0.0.0-test', isPackaged: false, isReady: () => true, on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => repoRoot },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (x) => Buffer.from(String(x)), decryptString: (b) => b.toString() },
      ipcMain: { handle() {}, on() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] },
      shell: {}, dialog: {}, screen: {}, nativeTheme: { on() {} }, powerMonitor: { on() {} }, systemPreferences: {},
    },
  };
}
after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ } });

const helpers = require(dist('llm/liveHelpers.js'));
const { buildQuickActionTurn } = require(dist('llm/quickActionTurn.js'));
const { buildSystemPromptV2, recommendedGenerationProfile } = require(dist('llm/promptSystemV2.js'));

const ACTIONS = ['catch_me_up', 'define', 'sound_smart'];
const TRANSCRIPT = '[INTERVIEWER]: We moved the launch to the 3rd because the SOC 2 audit slipped.\n[INTERVIEWER]: Can you own the vendor questionnaire?';

describe('registration', () => {
  test('each helper is a v2 action with its own contract, no diagram, a user-pressed silence gate', () => {
    for (const action of ACTIONS) {
      const prompt = buildSystemPromptV2({ mode: 'general', action, tier: 'cloud' });
      assert.match(prompt, new RegExp(`<active_action name="${action}">`));
      assert.match(prompt, /deliberately invoked this action/);
      assert.equal(recommendedGenerationProfile(action).variance, 'low');
    }
  });

  test('What did I miss? and Define are informational; Sound smart speaks in the user\'s voice', () => {
    assert.match(buildSystemPromptV2({ mode: 'sales', action: 'catch_me_up', tier: 'cloud' }), /informational task/);
    assert.match(buildSystemPromptV2({ mode: 'sales', action: 'define', tier: 'cloud' }), /informational task/);
    assert.match(buildSystemPromptV2({ mode: 'sales', action: 'sound_smart', tier: 'cloud' }), /in the mode's speaker voice/);
  });

  test('the action names are recognised and nothing else is', () => {
    for (const a of ACTIONS) assert.equal(helpers.isLiveHelperAction(a), true);
    for (const a of ['recap', 'clarify', '', null, 'define ']) assert.equal(helpers.isLiveHelperAction(a), false);
  });

  test('display rows: Sound smart in Clarify\'s line, the others in Recap\'s card', () => {
    assert.equal(helpers.liveHelperDisplayKind('sound_smart'), 'clarify');
    assert.equal(helpers.liveHelperDisplayKind('catch_me_up'), 'recap');
    assert.equal(helpers.liveHelperDisplayKind('define'), 'recap');
  });
});

describe('prompt inputs', () => {
  test('the request is the last thing in the turn, the transcript background', () => {
    for (const action of ACTIONS) {
      const system = buildSystemPromptV2({ mode: 'general', action, tier: 'cloud' });
      const turn = buildQuickActionTurn(action, system, TRANSCRIPT);
      const task = turn.slice(turn.lastIndexOf('<current_turn>'));
      assert.ok(turn.indexOf('SOC 2') < turn.lastIndexOf('<current_turn>'), 'transcript before the request');
      assert.match(task, action === 'catch_me_up' ? /what I missed/ : action === 'define' ? /Explain the most recent term/ : /one specific, insightful point or question/);
      assert.match(task, /in the language the conversation is in/);
    }
  });

  test('each request carries its own length, and a standing length replaces it', () => {
    const system = buildSystemPromptV2({ mode: 'general', action: 'define', tier: 'cloud' });
    assert.match(buildQuickActionTurn('define', system, TRANSCRIPT), /Under 50 words/);
    const withOwn = buildQuickActionTurn('define', system, TRANSCRIPT, { standingInstructions: 'Keep every answer under 20 words.' });
    assert.doesNotMatch(withOwn, /Under 50 words/);
  });

  test('with the v2 prompt system switched off, the legacy prompt still says which helper was pressed', () => {
    const helper = { getPromptTier: () => 'full', fitContextForCurrentModel: (t) => t, getAiResponseLanguage: () => 'auto', async *streamChat() {} };
    const llm = new helpers.LiveHelperLLM(helper);
    const v2 = llm.buildRequest('define', TRANSCRIPT);
    assert.match(v2.systemPrompt, /<active_action name="define">/);
    assert.match(v2.message, /<current_turn>/);
    process.env.NATIVELY_PROMPT_SYSTEM_V2 = '0';
    try {
      const legacy = llm.buildRequest('define', TRANSCRIPT);
      assert.doesNotMatch(legacy.systemPrompt, /<active_action/);
      assert.match(legacy.systemPrompt, /unfamiliar word/);
      assert.ok(legacy.message.startsWith(TRANSCRIPT));
      assert.match(legacy.message, /Task: explain the most recent unfamiliar term/);
    } finally {
      process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';
    }
  });

  test('streams through streamChat with the knowledge-mode intercept off (no reasoning path)', async () => {
    const calls = [];
    const helper = { getPromptTier: () => 'full', fitContextForCurrentModel: (t) => t, getAiResponseLanguage: () => 'auto', async *streamChat(...args) { calls.push(args); yield 'a'; yield 'b'; } };
    let out = '';
    for await (const tok of new helpers.LiveHelperLLM(helper).generateStream('sound_smart', TRANSCRIPT)) out += tok;
    assert.equal(out, 'ab');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][4], true, 'ignoreKnowledgeMode');
    assert.match(calls[0][3], /<active_action name="sound_smart">/);
  });

  test('What did I miss? looks back to the last touch, between 3 and 20 minutes', () => {
    const now = 1_000_000_000;
    assert.equal(helpers.catchUpWindowSeconds(now), 180);
    assert.equal(helpers.catchUpWindowSeconds(now, now - 30_000), 180);
    assert.equal(helpers.catchUpWindowSeconds(now, now - 9 * 60_000), 540);
    assert.equal(helpers.catchUpWindowSeconds(now, now - 90 * 60_000), 1200);
    assert.equal(helpers.catchUpWindowSeconds(now, now + 60_000), 180, 'a future time is ignored');
    assert.equal(helpers.catchUpWindowSeconds(now, Number.NaN), 180);
  });
});

describe('the engine runs a helper on the press', () => {
  const run = async (action, fill, opts) => {
    const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
    const { SessionTracker } = require(dist('SessionTracker.js'));
    const session = new SessionTracker();
    fill?.(session);
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    const seen = { contexts: [], tokens: [], finals: [], errors: [], modes: [] };
    engine.liveHelperLLM = { async *generateStream(a, context, o) { seen.contexts.push({ a, context, o }); yield 'Now: '; yield 'the audit.'; } };
    engine.on('live_helper_token', (t, a) => seen.tokens.push([t, a]));
    engine.on('live_helper', (t, a) => seen.finals.push([t, a]));
    engine.on('error', (e, m) => seen.errors.push([e.message, m]));
    engine.on('mode_changed', (m) => seen.modes.push(m));
    const result = await engine.runLiveHelper(action, opts);
    return { result, seen, session };
  };
  const say = (session, speaker, text, ago) => session.addTranscript({ speaker, text, timestamp: Date.now() - ago, final: true });

  test('What did I miss? reads only what was said in its window, streams and finishes', async () => {
    const { result, seen } = await run('catch_me_up', (s) => {
      say(s, 'system', 'Old topic from ten minutes ago about hiring.', 10 * 60_000);
      say(s, 'system', 'We moved the launch to the 3rd because the SOC 2 audit slipped.', 60_000);
    });
    assert.equal(result, 'Now: the audit.');
    assert.match(seen.contexts[0].context, /SOC 2/);
    assert.doesNotMatch(seen.contexts[0].context, /hiring/, 'outside the 3-minute window');
    assert.deepEqual(seen.tokens.map((t) => t[1]), ['catch_me_up', 'catch_me_up']);
    assert.deepEqual(seen.finals, [['Now: the audit.', 'catch_me_up']]);
    assert.equal(seen.modes[0], 'recap');
    assert.equal(seen.modes.at(-1), 'idle');
  });

  test('a longer window when the user last touched the overlay longer ago', async () => {
    const { seen } = await run('catch_me_up', (s) => {
      say(s, 'system', 'Old topic from ten minutes ago about hiring.', 10 * 60_000);
    }, { sinceMs: Date.now() - 12 * 60_000 });
    assert.match(seen.contexts[0].context, /hiring/);
  });

  test('nothing said: a sentence closes the row, no model call', async () => {
    const { result, seen } = await run('catch_me_up');
    assert.equal(result, null);
    assert.equal(seen.contexts.length, 0);
    assert.equal(seen.finals[0][0], helpers.LIVE_HELPER_EMPTY.catch_me_up);
  });

  test('Sound smart runs in Clarify\'s mode and its line can be refined afterwards', async () => {
    const { seen, session } = await run('sound_smart', (s) => say(s, 'system', 'We moved the launch because the SOC 2 audit slipped.', 30_000));
    assert.equal(seen.modes[0], 'clarify');
    assert.equal(session.getLastAssistantMessage(), 'Now: the audit.');
  });

  test('a press overtaken by an answer stops quietly', async () => {
    const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
    const { SessionTracker } = require(dist('SessionTracker.js'));
    const session = new SessionTracker();
    say(session, 'system', 'What does SOC 2 mean for us?', 20_000);
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    const finals = [];
    engine.on('live_helper', (t) => finals.push(t));
    engine.liveHelperLLM = { async *generateStream() { yield 'SOC 2 is'; engine.currentGenerationId++; yield ' an audit.'; } };
    assert.equal(await engine.runLiveHelper('define'), null);
    assert.equal(finals.length, 0);
  });

  test('a provider failure is reported in the row\'s mode', async () => {
    const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
    const { SessionTracker } = require(dist('SessionTracker.js'));
    const session = new SessionTracker();
    say(session, 'system', 'What does SOC 2 mean for us?', 20_000);
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    const errors = [];
    engine.on('error', (e, m) => errors.push(m));
    engine.liveHelperLLM = { async *generateStream() { throw new Error('quota'); } };
    assert.equal(await engine.runLiveHelper('define'), null);
    assert.deepEqual(errors, ['recap']);
  });
});

describe('wiring', () => {
  test('IPC, preload, main forwarding and the overlay chips are in place', () => {
    assert.match(read('electron/ipcHandlers.ts'), /safeHandle\('generate-live-helper'/);
    assert.match(read('electron/preload.ts'), /generateLiveHelper: \(action[^)]*\)[^=]*=>\s*\n?\s*ipcRenderer\.invoke\('generate-live-helper'/);
    const main = read('electron/main.ts');
    assert.match(main, /on\('live_helper_token'/);
    assert.match(main, /on\('live_helper',/);
    assert.match(read('electron/IntelligenceManager.ts'), /'live_helper', 'live_helper_token'/);
    const overlay = read('src/components/NativelyInterface.tsx');
    for (const a of ACTIONS) assert.match(overlay, new RegExp(`handleLiveHelper\\('${a}'\\)`));
  });

  test('no keyboard shortcut was taken: the global hotkey list is unchanged', () => {
    const keybinds = read('electron/services/KeybindManager.ts');
    assert.doesNotMatch(keybinds, /catchMeUp|catch_me_up|soundSmart|sound_smart|chat:define/);
    assert.doesNotMatch(read('src/hooks/useShortcuts.ts'), /catchMeUp|soundSmart|liveHelper/);
  });
});
