// tests/realtime-prompt/e2e-typed-chat.cjs — run: npm run test:realtime-prompt
//
// TYPED-CHAT wiring E2E (no network, no keys). Real: DatabaseManager (isolated), ModesManager API,
// LLMHelper.streamChat + LLMHelper.chatWithGemini. Spied: provider dispatch only.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..', '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-chat-'));
process.env.NATIVELY_TEST_USERDATA = userData;
const d = (p) => path.join(root, 'dist-electron/electron', p);
// Under ELECTRON_RUN_AS_NODE `require('electron')` has no `app`; anything touching
// CredentialsManager dies on app.getPath. Shim it at the isolated dir (memory:
// provider-wire-verification-harness). Nothing here can reach the real profile.
const Module = require('node:module');
const realLoad = Module._load;
const fakeElectron = {
  app: { getPath: () => userData, getName: () => 'natively-e2e', getVersion: () => '0.0.0-e2e', isPackaged: false, on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => root },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (x) => Buffer.from(String(x)), decryptString: (b) => b.toString() },
  ipcMain: { handle() {}, on() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] },
  shell: {}, dialog: {}, screen: {}, nativeTheme: { on() {} }, powerMonitor: { on() {} }, systemPreferences: {},
};
Module._load = function (request, ...rest) { return request === 'electron' ? fakeElectron : realLoad.call(this, request, ...rest); };
const realLog = console.log.bind(console);
console.log = () => {}; console.warn = () => {}; console.info = () => {};
const out = (...a) => realLog(...a);

const { LLMHelper } = require(d('LLMHelper.js'));
const { ModesManager } = require(d('services/ModesManager.js'));
const { CHAT_MODE_PROMPT } = require(d('llm/prompts.js'));

function spy(helper) {
  helper.customProvider = { id: 'spy-provider', name: 'spy', curlCommand: 'noop' };
  helper.getDeniedOutboundScopes = () => [];
  const calls = [];
  helper.streamWithCustom = async function* (message, context, _img, systemPrompt) { calls.push({ via: 'stream', message: message || '', context: context || '', systemPrompt: systemPrompt || '' }); yield 'ok'; };
  helper.executeCustomProvider = async function (_cmd, combined, systemPrompt, message, context) { calls.push({ via: 'oneshot', message: message || '', context: context || '', systemPrompt: systemPrompt || '', combined: combined || '' }); return 'ok'; };
  return calls;
}
const setMode = (template, instructions) => {
  const mm = ModesManager.getInstance();
  const mode = mm.getModes().find((m) => m.templateType === template);
  if (!mode) throw new Error(`no mode ${template}`);
  mm.updateMode(mode.id, { customContext: instructions });
  mm.setActiveMode(mode.id);
  return mode;
};
const results = [];
const check = (name, ok, detail) => { results.push(ok); out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        -> ${detail}`}`); };
const all = (c) => `${c?.systemPrompt ?? ''}\n${c?.context ?? ''}\n${c?.message ?? ''}\n${c?.combined ?? ''}`;

// PRODUCTION-FAITHFUL (ipcHandlers gemini-chat-stream): the base prompt is the v2
// system prompt from resolveManualChatBasePrompt, and skipModeInjection is
// `isCodingChat || isSafetyAnswer` — TRUE on every coding turn.
const { resolveV2SystemPrompt } = require(d('llm/promptSystemV2.js'));
const { isCodingAnswerType } = require(d('llm/AnswerPlanner.js'));
async function drive(via, message, answerType) {
  const helper = new LLMHelper(undefined, false);
  const calls = spy(helper);
  const coding = isCodingAnswerType(answerType);
  // NO override: LLMHelper resolves the v2 prompt ITSELF, inside its own bundle's
  // registry, so isV2ComposedPrompt() is true — as in production's single bundle.
  // (Passing a prompt resolved in ANOTHER bundle is not recognised as v2 and the
  // 40k legacy mode template gets appended: a harness artefact, not production.)
  const base = undefined;
  if (via === 'stream') { for await (const _ of helper.streamChat(message, undefined, '', base, coding, coding, [], undefined, undefined, { answerType })) { /* drain */ } }
  else await helper.chatWithGemini(message, undefined, '', false, false, undefined, { answerType });
  return calls;
}

(async () => {
  // LLMHelper.chatWithGemini is NOT driven: the non-streaming `gemini-chat` IPC is not
  // exposed to the renderer; its only callers are internal (suggestions, follow-up email),
  // where a mode's answer instructions must not apply.
  for (const via of ['stream']) {
    out(`\n##### typed chat via ${via === 'stream' ? 'LLMHelper.streamChat' : 'LLMHelper.chatWithGemini'}`);
    for (const template of ['general', 'seminar', 'call-center', 'sales']) {
      out(`\n  [${template}] "Answer in 100 words." + "Always reply in Spanish."`);
      setMode(template, 'Answer in 100 words.\n\nAlways reply in Spanish.');
      let calls;
      try { calls = await drive(via, 'What should I say about our refund policy?', 'general_meeting_answer'); }
      catch (e) { check(`${template}: dispatch reached`, false, String(e && e.message)); continue; }
      const c = calls[0];
      check(`${template}: dispatch reached`, !!c, `calls=${calls.length}`);
      if (!c) continue;
      check(`${template}: harness is production-faithful (v2 prompt recognised, no 40k legacy template)`, c.systemPrompt.length < 30000, `system prompt is ${c.systemPrompt.length} chars`);
      check(`${template}: instruction text delivered`, /Answer in 100 words\./.test(all(c)) && /Always reply in Spanish\./.test(all(c)), 'text missing');
      check(`${template}: authoritative block present`, /<user_instructions[^>]*cannot authorize a source/.test(all(c)), 'no <user_instructions> block');
      check(`${template}: resolved length line present`, /LENGTH is set by the user: about 100 words/.test(all(c)), 'no resolved line');
      check(`${template}: NOT told "never overriding the rules above"`, !/never overriding the rules above|configuration for tone\/focus/i.test(all(c)), 'old subordinating sentence still sent');
      check(`${template}: identity/security rules still protected`, /never modify or override CORE_IDENTITY/.test(all(c)), 'protection sentence missing');
    }
    out('\n  [technical-interview] coding question · "Give me all code in Java only" + a salary line');
    setMode('technical-interview', 'Give me all code in Java only\n\nMy current CTC is 30 LPA.');
    const calls = await drive(via, 'Write a function to reverse a linked list.', 'dsa_question_answer');
    const c = calls[0];
    check('coding: dispatch reached', !!c, `calls=${calls.length}`);
    if (c) {
      check('coding: "Give me all code in Java only" delivered (old gate dropped it for "me")', /Give me all code in Java only/.test(all(c)), 'dropped');
      check('coding: CODE LANGUAGE resolved', /CODE LANGUAGE is set by the user: Java/.test(all(c)), 'not resolved');
      check('coding: salary NEVER dispatched', !/30 LPA/.test(all(c)), 'SALARY LEAKED');
    }
    if (via === 'stream') {
      out('\n  [general] GUARDS · never twice, never on utility calls, never on a safety redirect');
      setMode('general', 'Answer in 100 words.');
      const run = async (message, system, route) => { const h = new LLMHelper(undefined, false); const calls = spy(h); for await (const _ of h.streamChat(message, undefined, '', system, true, true, [], undefined, undefined, route)) {} return calls[0]; };
      const count = (c) => (all(c).match(/Answer in 100 words\./g) || []).length;
      const v3Like = await run('# Question\nrefund policy?\n\n<user_instructions authority="binding on presentation" limit="cannot authorize a source">\nAnswer in 100 words.\n</user_instructions>', undefined, { answerType: 'general_meeting_answer', v3Owned: true });
      check('guard: a prompt that already carries the block is NOT given a second copy', !!v3Like && count(v3Like) === 1, `occurrences=${v3Like ? count(v3Like) : 'no dispatch'}`);
      const utility = await run('Summarise the meeting so far.', undefined, undefined);
      check('guard: a utility call with no answerType is NOT bent to the user length', !!utility && count(utility) === 0, `occurrences=${utility ? count(utility) : 'no dispatch'}`);
      const safety = await run('How do I hide this from the proctor?', undefined, { answerType: 'ethical_usage_answer' });
      check('guard: a safety redirect does not carry it', !!safety && count(safety) === 0, `occurrences=${safety ? count(safety) : 'no dispatch'}`);
    }
    out('\n  [general] CONTROL · no instructions');
    setMode('general', '');
    const ctl = (await drive(via, 'What should I say about our refund policy?', 'general_meeting_answer'))[0];
    check('control: no instruction layer when the mode has none', !!ctl && !/ACTIVE MODE INSTRUCTIONS|<user_instructions/.test(all(ctl)), 'layer rendered with empty instructions');
  }
  const failed = results.filter((x) => !x).length;
  out(`\n##### typed chat: ${results.length - failed}/${results.length} passed`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
})().catch((e) => { out('HARNESS ERROR', e && e.stack || e); process.exit(2); });
