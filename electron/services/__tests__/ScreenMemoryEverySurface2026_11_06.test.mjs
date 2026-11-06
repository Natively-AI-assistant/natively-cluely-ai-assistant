/**
 * Every surface that answers on a screenshot remembers it (2026-11-06).
 *
 * Typed chat and What to answer no longer make a describe call before the
 * answer (screenPrepass.ts). That call's summary used to be the turn's screen
 * text whenever the after-answer transcription failed; now the same call runs
 * AFTER the answer, only then (transcribeScreenForMemory's backupDescribe).
 *
 * Custom buttons and phone questions were never recorded in the conversation
 * at all: a follow-up had no record of the press, the question, or the screen.
 *
 * No network: the vision call every reader ends in (LLMHelper.runVisionRequest)
 * is replaced. The build bundles each module with its own copy of the screen
 * service, so stubbing one copy's understand() would not reach the others; the
 * helper is shared through the same global accessor main.ts sets.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helper, isolateSingletons, userData, dist, require, CRED_SLOT, setScopes } from './fakeOllamaHarness.mjs';

const { transcribeScreenForMemory, getBackupScreenRead, getTranscriptionByNames } = require(dist('services/screen/screenTranscription.js'));
const { getScreenshotDescription, hashImageSet } = require(dist('services/screen/ScreenshotDescriptionStore.js'));
const { SCREEN_BEING_READ, SCREEN_NOT_TRANSCRIBED } = require(dist('services/screen/screenDescription.js'));
const { STRUCTURED_EXTRACTION_SYSTEM_PROMPT } = require(dist('services/screen/visionPrompts.js'));
const { getConversationState, clearConversationState } = require(dist('context-intelligence/question/conversation-state-store.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));
isolateSingletons();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let n = 0;
/**
 * A new screenshot each time: neither the description store nor the service
 * cache hits. Unique bytes per RUN too: under Electron the store is SQLite in a
 * test folder that outlives the run, and keys on the bytes.
 */
const runId = `${process.pid}${Date.now() % 100000}`;
// The service's own cache matches images by a PERCEPTUAL hash, so images that
// differ in one glyph look alike to it: each one is also a different width.
const shot = () => {
  const p = path.join(userData, `memory-surface-${process.pid}-${++n}.png`);
  fs.writeFileSync(p, renderDigitsPng(`${'1'.repeat(n)}${runId}`));
  return p;
};

/** One cloud vision key (Gemini), so the chain has rungs. */
const geminiKey = (present = true) => {
  const none = () => undefined;
  globalThis[CRED_SLOT] = {
    getDisabledProviders: () => [], anyVisionProviderConfigured: () => present, anyLocalVisionProviderConfigured: () => false,
    getNativelyApiKey: none, getOpenaiApiKey: none, getGeminiApiKey: () => (present ? 'key-gemini' : undefined), getClaudeApiKey: none,
    getGroqApiKey: none, getDeepseekApiKey: none, getOpenrouterApiKey: none, getNvidiaNimApiKey: none,
    getFluxionApiKey: none, getAgentRouterApiKey: none, getLitellmBaseURL: none, getNinerouterBaseURL: none,
    getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
  };
};

// A failure that opens no breaker (invalid_payload), so one test's failed read
// never makes the next test's rung skip.
const FAIL = () => new Error('413 payload too large');

/**
 * The vision call. `transcribe` = the record's extraction prompt; `describe` =
 * any other (the short read the answer used to wait for). A reply that is
 * undefined or an Error fails that read.
 */
let replies = {};
let asked = [];
const vision = (r) => { replies = r; asked = []; };
/** The reads made, in order, with a rung's retry on the next rung folded in. */
const reads = () => asked.filter((k, i) => k !== asked[i - 1]);
const h = helper('http://127.0.0.1:1', 'unused');
Object.assign(h, { useOllama: false, currentModelId: 'gemini-3.8-flash' });
h.isCodexAvailable = () => false;
let transcribeDelayMs = 0;
/** The bytes of each image the vision call was SENT (the optimizer's output), by sha. */
let sent = [];
h.runVisionRequest = async (_id, _userPrompt, systemPrompt, imagePath) => {
  const kind = systemPrompt === STRUCTURED_EXTRACTION_SYSTEM_PROMPT ? 'transcribe' : 'describe';
  asked.push(kind);
  try { sent.push(crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex')); } catch { sent.push(null); }
  if (kind === 'transcribe' && transcribeDelayMs) await new Promise((r) => setTimeout(r, transcribeDelayMs));
  const reply = replies[kind];
  if (reply === undefined) throw FAIL();
  if (reply instanceof Error) throw reply;
  return reply;
};
const useHelper = () => { globalThis.__nativelyGetLLMHelper = () => h; };

/** The backup's own log line: the only trace of "the backup was not even tried". */
let logged = [];
let realLog;
beforeEach(() => {
  geminiKey(); useHelper(); vision({});
  logged = []; realLog = console.log;
  console.log = (...args) => { if (String(args[0]).startsWith('[screen-memory]')) logged.push(args); realLog(...args); };
});
afterEach(() => { console.log = realLog; delete globalThis.__nativelyGetLLMHelper; });
const backupTried = () => logged.some((a) => /backup read/.test(String(a[0])));

/**
 * Two screenshots that differ in one glyph of a very wide image: the
 * PERCEPTUAL hash (ImageHashService.computeHash, a 16×16 average) gives them
 * the same value for about 3 in 4 such pairs, so bases are tried until a pair
 * does. New bytes every run, or the store (which outlives a run) answers first.
 */
async function lookAlikePair() {
  const { ImageHashService } = require(dist('services/screen/ImageHashService.js'));
  const hashes = new ImageHashService();
  const make = (digits) => { const p = path.join(userData, `lookalike-${process.pid}-${++n}.png`); fs.writeFileSync(p, renderDigitsPng(digits)); return p; };
  for (let i = 0; i < 10; i++) {
    const base = `${runId}${n}${i}`.repeat(30).slice(0, 170);
    const x = make(`${base}1`); const y = make(`${base}7`);
    if (await hashes.computeHash(x) === await hashes.computeHash(y)) return [x, y];
  }
  assert.fail('no look-alike pair found');
}

describe('the backup read after a failed transcription', () => {
  test('transcription works: no backup call, and the transcription is stored', async () => {
    const p = shot();
    vision({ transcribe: 'FATAL E4012: disk quota exceeded', describe: 'never asked' });
    const text = await transcribeScreenForMemory([p], 'why did it fail?', { backupDescribe: 'what_to_say' });
    assert.match(text, /E4012/);
    assert.deepEqual(reads(), ['transcribe']);
    assert.equal(backupTried(), false);
    const stored = getScreenshotDescription(hashImageSet([p]));
    // The store is SQLite; under plain Node its native module may not load, and then nothing is stored at all.
    if (stored) assert.match(stored.description, /E4012/);
  });

  test('transcription fails: the short read is recorded, and NOT stored as a transcription', async () => {
    const p = shot();
    vision({ describe: 'A build log that failed on disk quota.' });
    const text = await transcribeScreenForMemory([p], 'why did it fail?', { backupDescribe: 'what_to_say' });
    assert.match(text, /A build log that failed on disk quota\./);
    assert.deepEqual(reads(), ['transcribe', 'describe']);
    assert.equal(getScreenshotDescription(hashImageSet([p])), null,
      'the store holds transcriptions only, so the next capture is transcribed again');
  });

  test('a backup read is kept by the screenshots\' names, for Direct Assist, and outlives the file', async () => {
    const p = shot();
    vision({ describe: 'A terminal with a failed npm install.' });
    const recorded = await transcribeScreenForMemory([p], 'q', { backupDescribe: 'manual_use_screen' });
    assert.match(recorded, /A terminal with a failed npm install\./);
    assert.equal(getBackupScreenRead([p]), recorded, 'the same text the ring gets');
    // The renderer's path and the canonical one differ in folder, never in name.
    assert.equal(getBackupScreenRead([path.join(userData, 'elsewhere', path.basename(p))]), recorded);
    fs.unlinkSync(p);
    assert.equal(getBackupScreenRead([p]), recorded, 'the queue deletes the file; the read stays');
    assert.equal(getBackupScreenRead([p, shot()]), '', 'a different set is a different set');
  });

  test('a slow full read still lands: the record has its own time, not the 6 s answer budget (3.6 s a rung)', async () => {
    const p = shot();
    vision({ transcribe: 'Deploy failed: ECONNRESET at step 4 of 7', describe: 'never asked' });
    transcribeDelayMs = 4200;
    try {
      const text = await transcribeScreenForMemory([p], 'q', { backupDescribe: 'manual_use_screen' });
      assert.match(text, /ECONNRESET at step 4 of 7/);
      assert.equal(backupTried(), false);
    } finally { transcribeDelayMs = 0; }
  });

  test('Direct Assist finds a transcription by the screenshots\' names once the files are gone', async () => {
    const p = shot();
    vision({ transcribe: 'Invoice INV-2207 total $4,180.00' });
    await transcribeScreenForMemory([p], 'q');
    // The store is SQLite and may not load under plain Node; then nothing is stored to find.
    if (!getScreenshotDescription(hashImageSet([p]))) return;
    fs.unlinkSync(p);
    assert.equal(hashImageSet([p]), null, 'by bytes: gone with the file');
    assert.match(getTranscriptionByNames([p]), /INV-2207/);
    assert.match(getTranscriptionByNames([path.join(userData, 'renderer-side', path.basename(p))]), /INV-2207/);
    assert.equal(getTranscriptionByNames([shot()]), '');
  });

  test('a screen that LOOKS like the last one is still read: the record never takes a perceptual match', async () => {
    const [a, b] = await lookAlikePair();
    sent = [];
    vision({ transcribe: 'Line 12: return total * 1.05;' });
    await transcribeScreenForMemory([a], 'q');
    vision({ transcribe: 'Line 12: return total * 1.07;' });
    const text = await transcribeScreenForMemory([b], 'q');
    assert.match(text, /1\.07/, 'the new screen\'s own text, not the look-alike\'s');
    assert.equal(sent.length, 2);
    assert.notEqual(sent[1], sent[0], 'the new screen\'s own image was sent, not the look-alike\'s optimized file');
  });

  test('the read BEFORE an answer, too: a look-alike screen is read again, from its own image', async () => {
    const { getScreenUnderstandingService } = require(dist('services/screen/ScreenUnderstandingService.js'));
    const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
    const [a, b] = await lookAlikePair();
    const understand = (imagePath) => getScreenUnderstandingService().understand({
      modeId: 'look-alike', transcript: 'q', userAction: 'manual_use_screen', qualityMode: 'balanced',
      imagePaths: [imagePath], screenUnderstandingMode: 'vision_first',
      providerPolicy: { localOnly: false, allowScreenshots: true, visionAvailable: true, localVisionAvailable: false },
    });
    sent = [];
    vision({ describe: 'An invoice for $4,180.' });
    assert.match(composeScreenDescription(await understand(a)), /\$4,180/);
    vision({ describe: 'An invoice for $4,780.' });
    assert.match(composeScreenDescription(await understand(b)), /\$4,780/, 'not the cached read of the screen it looks like');
    assert.equal(sent.length, 2, 'the new screen was read');
    assert.notEqual(sent[1], sent[0], 'from its own image');
    // The same screenshot again is still a cache hit: no second read.
    assert.match(composeScreenDescription(await understand(b)), /\$4,780/);
    assert.equal(sent.length, 2);
  });

  test('two screenshots in the other order are a different read: the latest one is the one read', async () => {
    const { getScreenUnderstandingService } = require(dist('services/screen/ScreenUnderstandingService.js'));
    const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
    const a = shot(); const b = shot();
    const understand = (imagePaths) => getScreenUnderstandingService().understand({
      modeId: 'order', transcript: 'q', userAction: 'manual_use_screen', qualityMode: 'balanced',
      imagePaths, screenUnderstandingMode: 'vision_first',
      providerPolicy: { localOnly: false, allowScreenshots: true, visionAvailable: true, localVisionAvailable: false },
    });
    sent = [];
    vision({ describe: 'Screen B.' });
    assert.match(composeScreenDescription(await understand([a, b])), /Screen B\./);
    vision({ describe: 'Screen A.' });
    assert.match(composeScreenDescription(await understand([b, a])), /Screen A\./, 'not B\'s cached read');
    assert.equal(sent.length, 2);
    assert.notEqual(sent[1], sent[0], 'A\'s own image was sent, not B\'s encoded file');
  });

  test('a transcribed screen keeps no backup read', async () => {
    const p = shot();
    vision({ transcribe: 'npm ERR! code ERESOLVE' });
    await transcribeScreenForMemory([p], 'q', { backupDescribe: 'manual_use_screen' });
    assert.equal(getBackupScreenRead([p]), '');
  });

  test('no backup asked for: one read, nothing recorded (other callers unchanged)', async () => {
    vision({ describe: 'never asked' });
    assert.equal(await transcribeScreenForMemory([shot()], 'q'), '');
    assert.deepEqual(reads(), ['transcribe']);
  });

  test('both fail: empty, so the caller records "could not be read"', async () => {
    vision({});
    assert.equal(await transcribeScreenForMemory([shot()], 'q', { backupDescribe: 'what_to_say' }), '');
    assert.deepEqual(reads(), ['transcribe', 'describe']);
    assert.equal(backupTried(), true);
  });

  test('no vision provider: no backup (it would find none either)', async () => {
    geminiKey(false);
    vision({ describe: 'must not be asked' });
    assert.equal(await transcribeScreenForMemory([shot()], 'q', { backupDescribe: 'what_to_say' }), '');
    assert.deepEqual(reads(), []);
    assert.equal(backupTried(), false);
  });

  test('screenshots scope off: no backup (it would be refused the same way)', async () => {
    setScopes({ screenshots: false });
    try {
      vision({ describe: 'must not be asked' });
      assert.equal(await transcribeScreenForMemory([shot()], 'q', { backupDescribe: 'what_to_say' }), '');
      assert.deepEqual(reads(), []);
      assert.equal(backupTried(), false);
    } finally {
      setScopes({});
    }
  });
});

/** Waits for the async ring write (recordLiveTurn runs detached). */
async function turnFor(key, predicate, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const turn = (getConversationState(key)?.turns ?? []).find(predicate);
    if (turn || Date.now() > until) return turn;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('custom buttons and phone questions are recorded in the conversation', () => {
  const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
  const { SessionTracker } = require(dist('SessionTracker.js'));
  const BUTTON = { id: 'b1', name: 'Rephrase', instruction: 'Rewrite it.' };
  const engineWith = (reply = ['I led ', 'the migration.']) => {
    const session = new SessionTracker();
    session.addTranscript({ speaker: 'user', text: 'I kind of led the migration I guess.', timestamp: Date.now() - 20_000, final: true });
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.customButtonLLM = { async *generateStream() { for (const t of reply) yield t; } };
    engine.on('error', () => {});
    // Constructing the engine makes an LLMHelper, which takes the global
    // accessor; the screen reads go to the fake again.
    useHelper();
    return engine;
  };
  beforeEach(() => clearConversationState());

  test('a button press with no screenshot: its answer is the last answer', async () => {
    const engine = engineWith();
    await engine.runCustomButton(BUTTON, []);
    const turn = await turnFor(engine.conversationSessionId(), (t) => t.q === 'Rephrase');
    assert.ok(turn, 'the press is in the conversation');
    assert.equal(turn.a, 'I led the migration.');
    assert.equal(turn.from, undefined, 'a press is the user\'s, not a heard question');
    assert.equal(turn.screen, undefined);
  });

  test('a button press on a screenshot: recorded, then the screen\'s text arrives', async () => {
    const engine = engineWith();
    vision({ transcribe: 'Ticket ENG-4471: migrate billing to Postgres' });
    await engine.runCustomButton(BUTTON, [shot()]);
    const key = engine.conversationSessionId();
    const turn = await turnFor(key, (t) => t.q === 'Rephrase' && /ENG-4471/.test(t.screen ?? ''));
    assert.ok(turn, JSON.stringify(getConversationState(key)?.turns));
  });

  test('a button press whose transcription fails: the backup read is recorded', async () => {
    const engine = engineWith();
    vision({ describe: 'A ticket about a billing migration.' });
    await engine.runCustomButton(BUTTON, [shot()]);
    const turn = await turnFor(engine.conversationSessionId(), (t) => /billing migration/.test(t.screen ?? ''));
    assert.ok(turn);
    assert.deepEqual(reads(), ['transcribe', 'describe']);
  });

  test('a button press whose answer was superseded is not recorded', async () => {
    const engine = engineWith();
    engine.customButtonLLM = { async *generateStream() { yield 'half'; engine.currentGenerationId += 1; yield ' more'; } };
    await engine.runCustomButton(BUTTON, []);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((getConversationState(engine.conversationSessionId())?.turns ?? []).length, 0);
  });

  test('a phone question with a screenshot: question, answer and screen are recorded', async () => {
    const engine = engineWith();
    vision({ transcribe: 'Error 503 from api.example.dev' });
    engine.recordPhoneTurn('It is a gateway error.', 'what is this error?', [shot()], engine.conversationSessionId());
    const turn = await turnFor(engine.conversationSessionId(), (t) => t.q === 'what is this error?' && /503/.test(t.screen ?? ''));
    assert.ok(turn);
    assert.equal(turn.a, 'It is a gateway error.');
    assert.equal(turn.from, undefined);
  });

  test('a phone question whose screen cannot be read at all: "could not be read", never silence', async () => {
    const engine = engineWith();
    vision({});
    engine.recordPhoneTurn('Hard to say.', 'what does it say?', [shot()]);
    const key = engine.conversationSessionId();
    const turn = await turnFor(key, (t) => t.q === 'what does it say?' && t.screen === SCREEN_NOT_TRANSCRIBED);
    assert.ok(turn, JSON.stringify(getConversationState(key)?.turns));
    assert.deepEqual(reads(), ['transcribe', 'describe']);
    assert.notEqual(turn.screen, SCREEN_BEING_READ);
  });

  test('a phone follow-up reads the conversation, screens included', async () => {
    const engine = engineWith();
    vision({ transcribe: 'Error 503 from api.example.dev' });
    engine.recordPhoneTurn('It is a gateway error.', 'what is this error?', [shot()], engine.conversationSessionId());
    assert.ok(await turnFor(engine.conversationSessionId(), (t) => /503/.test(t.screen ?? '')));
    const block = engine.conversationHistoryBlock('');
    assert.match(block, /^<conversation_history data_only="true">/);
    assert.match(block, /what is this error\?/);
    assert.match(block, /Error 503 from api\.example\.dev/, 'the screen\'s text, for "what did that screenshot say?"');
  });

  test('no conversation yet: no history block', () => {
    assert.equal(engineWith().conversationHistoryBlock(''), '');
  });

  test('a phone question without images is recorded with no screen', async () => {
    const engine = engineWith();
    engine.recordPhoneTurn('Tuesday at 3.', 'when is the review?');
    const turn = await turnFor(engine.conversationSessionId(), (t) => t.q === 'when is the review?');
    assert.ok(turn);
    assert.equal(turn.screen, undefined);
  });
});

describe('wiring', () => {
  test('the backup is a SHORT read: the actions that take the direct prompt, never the extraction one', async () => {
    const { buildVisionPrompts, DIRECT_VISION_SYSTEM_PROMPT } = require(dist('services/screen/visionPrompts.js'));
    for (const userAction of ['manual_use_screen', 'what_to_say']) {
      assert.equal(buildVisionPrompts({ userAction, modeId: 'screen-memory', qualityMode: 'balanced' }).systemPrompt, DIRECT_VISION_SYSTEM_PROMPT, userAction);
    }
    // dynamic_action is the transcription's own long JSON read: no use as a backup.
    assert.equal(buildVisionPrompts({ userAction: 'dynamic_action', modeId: 'screen-memory', qualityMode: 'balanced' }).systemPrompt, STRUCTURED_EXTRACTION_SYSTEM_PROMPT);
    assert.match(read('electron/services/screen/screenTranscription.ts'),
      /export type BackupRead = Extract<UserAction, 'manual_use_screen' \| 'what_to_say'>;/);
    assert.doesNotMatch(read('electron/IntelligenceEngine.ts'), /backupDescribe: 'dynamic_action'/);
  });

  test('typed chat asks for the backup only when it skipped the describe call', () => {
    assert.match(read('electron/ipcHandlers.ts'),
      /transcribeScreenForMemory\(imagePaths, v3Question\.trim\(\) \|\| undefined,\s*v3ScreenEvidence \? \{ backupDescribe: 'manual_use_screen' \} : \{\}\)/);
  });

  test('What to answer asks for the backup only when it skipped the describe call', () => {
    const engine = read('electron/IntelligenceEngine.ts');
    assert.match(engine, /\.\.\.\(options\?\.screenFromImage \? \{ backupDescribe: 'what_to_say' as const \} : \{\}\),/);
    assert.match(engine, /transcribeScreenForMemory\(shots, question\?\.trim\(\) \|\| undefined,\s*extra\.backupDescribe \? \{ backupDescribe: extra\.backupDescribe \} : \{\}\)/);
  });

  test('the phone path records its answer, with its images, where it saves it', () => {
    const src = read('electron/ipcHandlers.ts');
    const saved = src.split("intelligenceManager.addAssistantMessage(full, undefined, 'phone_mirror');")[1]?.slice(0, 900) ?? '';
    assert.match(saved, /intelligenceManager\.recordPhoneTurn\(full, String\(message \|\| ''\), phoneImagePaths, myPhoneConversationKey\)/);
    assert.match(src, /const myPhoneConversationKey = \(\(\) => \{\s*try \{ return intelligenceManager\.conversationSessionId\(\); \}/);
  });

  test('the phone chat gets the conversation history, before the question joins it, unless document-grounded', () => {
    const src = read('electron/ipcHandlers.ts');
    const at = src.indexOf("console.warn('[PhoneMirror] Failed to capture pre-turn context:', ctxErr);");
    assert.ok(at > 0);
    const after = src.slice(at, at + 1600);
    assert.match(after, /if \(!phoneDocGrounded\) \{\s*try \{\s*const history = intelligenceManager\.conversationHistoryBlock\(context \?\? ''\);\s*if \(history\) context = context\?\.trim\(\) \? `\$\{history\}\\n\\n\$\{context\}` : history;/);
    assert.ok(after.indexOf('conversationHistoryBlock') < after.indexOf('intelligenceManager.addTranscript('),
      'read before the phone\'s question is added, as the 100 s snapshot is');
  });

  test('the phone\'s source routing still asks whether anything was SAID, not whether there is history', () => {
    const src = read('electron/ipcHandlers.ts');
    const flag = src.indexOf('const phoneHasLiveTranscript = Boolean(context && String(context).trim());');
    assert.ok(flag > 0 && flag < src.indexOf('intelligenceManager.conversationHistoryBlock(context'), 'taken before the history joins the context');
    const phone = src.slice(flag, src.indexOf('const stream = llmHelper.streamChat(message, phoneImagePaths.length', flag));
    assert.equal((phone.match(/hasLiveTranscript: phoneHasLiveTranscript,/g) ?? []).length, 2);
    assert.doesNotMatch(phone, /hasLiveTranscript: Boolean\(context/);
  });

  test('Code hint and Brainstorm ask for the backup when they have a screenshot', () => {
    const engine = read('electron/IntelligenceEngine.ts');
    for (const name of ['Code hint', 'Brainstorm approaches']) {
      const at = engine.indexOf(`IntelligenceEngine.actionTurnQuestion('${name}'`);
      assert.ok(at > 0, name);
      assert.match(engine.slice(at, at + 500), /\.\.\.\(imagePaths\?\.length \? \{ backupDescribe: 'manual_use_screen' as const \} : \{\}\)/, name);
    }
  });

  test('Direct Assist history looks a transcription up by bytes, then by names', () => {
    assert.match(read('electron/ipcHandlers.ts'),
      /const described = screenStorePre\.getDescriptionForImageSet\(rawTurns\[i\]\.imagePaths\)\s*\|\| getTranscriptionByNames\(rawTurns\[i\]\.imagePaths\)\s*\|\| null;/);
  });

  test('Direct Assist asks for the backup, and its history reads it only for a screen sent neither as text nor as bytes', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /\.transcribeScreenForMemory\(request\.imagePaths, request\.currentRequest, \{ backupDescribe: 'manual_use_screen' \}\)/);
    assert.match(src, /const backupRead = !describedByTurn\.has\(index\) && turn\.imagePaths\.length && !canonicalPaths\.length\s*\? getBackupScreenRead\(turn\.imagePaths\)/);
    // Kept on device: withheld from a cloud provider, as a transcription is.
    assert.match(src, /\?\? \(backupRead && keptOnDeviceText\(backupRead\) && !directSelectionOnDevice \? ON_DEVICE_SCREEN_WITHHELD : backupRead\)/);
  });

  test('the ⌘Enter test hook skips the describe call exactly as the real handler does', () => {
    const body = read('electron/ipcHandlers.ts').split("safeHandle('__e2e__:ask'")[1].split('safeHandle(')[0];
    assert.match(body, /answerReadsScreenshotItself\(\{/);
    assert.match(body, /if \(e2eScreenFromImage\) \{[\s\S]{0,200}return \{ screenFromImage: true \};/);
    assert.match(body, /\.\.\.\(screenFromImage \? \{ screenFromImage \} : \{\}\),/);
  });
});
