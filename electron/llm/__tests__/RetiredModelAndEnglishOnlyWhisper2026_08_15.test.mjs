// electron/llm/__tests__/RetiredModelAndEnglishOnlyWhisper2026_08_15.test.mjs
//
// Two defects from the 2026-08-12 production triage of user `paras`.
//
// A) A RETIRED MODEL ID IS RETRIED THREE TIMES PER CALL, FOREVER.
//    Groq decommissioned `meta-llama/llama-4-scout-17b-16e-instruct`. The 404
//    ("The model `…` does not exist or you do not have access to it") fell
//    through every branch of classifyVisionError to `unknown`, which the engine
//    treats as TRANSIENT — so the live vision path burned three attempts with
//    backoff on a permanently dead id, on every single request. ModelVersion-
//    Manager was never told either: its event-driven rediscovery hook
//    (`onModelError`) was wired only into the NON-streaming vision path, so the
//    pin survived a discovery run that happened the same morning (07:56Z).
//
// B) LOCAL WHISPER TRANSCRIBED NOTHING, 15,733 TIMES.
//    The worker FORCED `language='english'` on English-only checkpoints, and
//    set `task:'transcribe'` unconditionally. transformers.js rejects both for
//    a non-multilingual model — verified in the installed library source:
//      if (e.is_multilingual) {…} else if (s || r) throw new Error(
//        "Cannot specify `task` or `language` for an English-only model…")
//    (s = generationConfig.language, r = generationConfig.task). Every audio
//    window threw; the streaming loop re-dispatched ~every 1.5s.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same import shape as VisionStreamFallback.test.mjs — this module is not
// re-exported from the llm barrel.
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/visionStreamFallback.js');
const {
  classifyVisionError,
  DEFAULT_VISION_FALLBACK_CONFIG,
  MODEL_GONE_COOLDOWN_MS,
  runStreamingVisionFallback,
  markVisionUnhealthy,
} = await import(pathToFileURL(modPath).href);

// The real body, as captured in the production log.
const GROQ_404 =
  '404 {"error":{"message":"The model `meta-llama/llama-4-scout-17b-16e-instruct` '
  + 'does not exist or you do not have access to it","type":"invalid_request_error",'
  + '"code":"model_not_found"}}';

describe('a retired model id is classified as permanently gone, not transient', () => {
  test('the real Groq 404 classifies as model_gone', () => {
    assert.equal(classifyVisionError(new Error(GROQ_404), false), 'model_gone');
  });

  test('a status-only 404 (no message) also classifies', () => {
    const err = Object.assign(new Error('request failed'), { status: 404 });
    assert.equal(classifyVisionError(err, false), 'model_gone');
  });

  test('it is NOT classified as unknown — the bug was the transient retry path', () => {
    // `unknown` routes to backoff+retry, which is what burned three attempts
    // per call on a permanently dead id.
    assert.notEqual(classifyVisionError(new Error(GROQ_404), false), 'unknown');
  });
});

describe('the new class does not steal from its neighbours', () => {
  test('a genuine auth failure is still auth', () => {
    const err = new Error('401 Unauthorized: invalid api key');
    assert.equal(classifyVisionError(err, false), 'auth');
  });

  test('a 403 that also names a model is auth, not model_gone', () => {
    // Credentials are the actionable problem here; demoting the provider for
    // 24h would be the wrong remedy.
    const err = new Error('403 Forbidden — api key cannot access model gpt-5.4');
    assert.equal(classifyVisionError(err, false), 'auth');
  });

  test('a 5xx body that merely QUOTES 404 is server, not model_gone', () => {
    // This is why the bare '404' substring matcher was rejected: misfiring here
    // would demote a healthy provider for a day — worse than the original bug.
    const err = Object.assign(
      new Error('503 Service Unavailable (request id req-404-abc): upstream overloaded'),
      { status: 503 },
    );
    assert.equal(classifyVisionError(err, false), 'server');
  });

  test('a rate limit is still rate', () => {
    assert.equal(classifyVisionError(new Error('429 too many requests'), false), 'rate');
  });

  test('a timeout is still timeout', () => {
    assert.equal(classifyVisionError(new Error('anything'), true), 'timeout');
  });
});

describe('a retired model is demoted long enough to matter', () => {
  test('the cooldown is far longer than the structural-incompatibility one', () => {
    const cfg = DEFAULT_VISION_FALLBACK_CONFIG;
    assert.equal(cfg.modelGoneCooldownMs, MODEL_GONE_COOLDOWN_MS);
    assert.ok(
      cfg.modelGoneCooldownMs >= 24 * 3600_000,
      'a retired id must not be re-probed on the 10-minute incompatible cooldown — that only '
      + 'converts "3 wasted retries per call" into "3 wasted retries every 10 minutes, forever"',
    );
  });
});

// BEHAVIOURAL: drive the real engine. The classification tests above prove the
// label; this proves the thing the user actually feels — the retry burn.
describe('the engine stops retrying a retired model (behavioural)', () => {
  const drive = async (errFactory) => {
    let opens = 0;
    let goneNotifications = 0;
    const provider = {
      id: 'groq', name: 'Groq Llama-4 Scout', isLocal: false, priority: 1,
      open: async function* () { opens++; throw errFactory(); },
    };
    const health = new Map();
    const out = [];
    try {
      for await (const chunk of runStreamingVisionFallback(
        [provider],
        { ...DEFAULT_VISION_FALLBACK_CONFIG, hedgeEnabled: false },
        health,
        {
          now: () => 1_000_000,
          random: () => 0,
          sleep: async () => {},          // no real backoff in tests
          log: () => {}, warn: () => {},
          onModelGone: () => { goneNotifications++; },
        },
      )) out.push(chunk);
    } catch { /* chain exhausted — expected */ }
    return { opens, goneNotifications, health };
  };

  test('a retired model is attempted ONCE, not maxAttempts times', async () => {
    const { opens } = await drive(() => new Error(GROQ_404));
    assert.equal(opens, 1,
      `a permanently dead model id must not be retried; it was opened ${opens}× `
      + `(maxAttempts is ${DEFAULT_VISION_FALLBACK_CONFIG.maxAttempts})`);
  });

  test('a genuinely transient error IS still retried — no over-correction', async () => {
    const { opens } = await drive(() => new Error('503 upstream overloaded'));
    assert.equal(opens, DEFAULT_VISION_FALLBACK_CONFIG.maxAttempts,
      'transient failures must keep their retries');
  });

  test('the caller is notified exactly once so rediscovery can run', async () => {
    const { goneNotifications } = await drive(() => new Error(GROQ_404));
    assert.equal(goneNotifications, 1);
  });

  test('the provider is demoted for the long window', async () => {
    const { health } = await drive(() => new Error(GROQ_404));
    const entry = health.get('groq');
    assert.ok(entry, 'the provider must be marked unhealthy');
    assert.equal(entry.openUntil, 1_000_000 + MODEL_GONE_COOLDOWN_MS);
  });
});

describe('the live vision path can actually tell the version manager', () => {
  const helperSrc = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
  const engineSrc = fs.readFileSync(path.resolve(__dirname, '../visionStreamFallback.ts'), 'utf8');

  test('the engine invokes the hook, it is not merely declared', () => {
    // An optional hook nobody calls is the same silent no-op class as an
    // optional-chained method that does not exist.
    assert.match(engineSrc, /onModelGone\(provider\.id, provider\.name, err\)/,
      'the model_gone branch must actually invoke the hook');
  });

  test('the STREAMING vision call site wires it to onModelError', () => {
    // The non-streaming path already did this; the live path — the one users
    // hit — did not, which is why a discovery run that same morning left the
    // dead pin in place.
    const idx = helperSrc.indexOf('runStreamingVisionFallback(');
    assert.ok(idx > 0, 'could not find the streaming vision call site');
    const call = helperSrc.slice(idx, idx + 1200);
    assert.match(call, /onModelGone:/, 'the streaming path must pass the hook');
    assert.match(call, /modelVersionManager\.onModelError\(/, 'the hook must trigger rediscovery');
  });

  test('the engine stays pure — no imports at all', () => {
    // Checked on IMPORT STATEMENTS, not on any mention of the name: the doc
    // comment for the hook legitimately explains why ModelVersionManager is
    // absent, and a substring match flags that as a violation.
    const imports = engineSrc.match(/^\s*import\s.+$/gm) || [];
    const requires = engineSrc.match(/\brequire\(['"][^'"]+['"]\)/g) || [];
    assert.deepEqual(imports, [],
      `visionStreamFallback must stay dependency-free; found: ${imports.join(' | ')}`);
    assert.deepEqual(requires, [],
      `visionStreamFallback must stay dependency-free; found: ${requires.join(' | ')}`);
  });
});

// ── B) English-only Whisper ────────────────────────────────────────────────
describe('an English-only Whisper checkpoint is sent neither task nor language', () => {
  const workerSrc = fs.readFileSync(
    path.resolve(__dirname, '../../audio/whisper/whisperWorker.ts'), 'utf8');

  test('the forced language="english" assignment is gone', () => {
    // It forced the option on exactly the models that reject it.
    assert.ok(
      !/if \(ENGLISH_ONLY_MODELS\.has\(loadedModelId\)\) \{\s*\n\s*language = 'english';/.test(workerSrc),
      'English-only models must not be given a language',
    );
  });

  test('language is nulled for English-only models', () => {
    assert.match(workerSrc, /const isEnglishOnly = ENGLISH_ONLY_MODELS\.has\(loadedModelId\);/);
    assert.match(workerSrc, /if \(isEnglishOnly\) \{\s*\n\s*language = null;/);
  });

  test('task is stripped too — fixing only language would still throw', () => {
    // `task: 'transcribe'` is set unconditionally in BOTH opts branches, so the
    // library's `else if (s || r) throw` fires on `task` alone.
    assert.match(workerSrc, /if \(isEnglishOnly\) \{\s*\n\s*delete opts\.task;/);
  });

  test('a multilingual model still receives its language', () => {
    // The over-broad version of this fix would strip the option for everyone
    // and silently transcribe non-English audio as phonetic English.
    assert.match(workerSrc, /\} else if \(language\) \{\s*\n\s*opts\.language = language;/);
  });

  test('the library constraint this rests on is still true', () => {
    // If a transformers.js upgrade relaxes it, this fix can be revisited —
    // but silently drifting is worse.
    const dist = path.resolve(
      __dirname, '../../../node_modules/@huggingface/transformers/dist/transformers.web.min.js');
    if (!fs.existsSync(dist)) return; // dependency not installed in this env
    const lib = fs.readFileSync(dist, 'utf8');
    assert.ok(
      lib.includes('Cannot specify `task` or `language` for an English-only model'),
      'the library no longer rejects task/language for English-only models — revisit the fix',
    );
  });
});

describe('a deterministic worker error does not flood the log', () => {
  const sttSrc = fs.readFileSync(path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts'), 'utf8');

  test('identical consecutive errors are throttled', () => {
    assert.match(sttSrc, /this\.repeatedWorkerErrorCount % 100 === 0/,
      'a per-audio-window error must not write one ERROR line per window');
  });

  test('a NEW error message still logs immediately', () => {
    // Throttling must not hide a different failure appearing later.
    assert.match(sttSrc, /this\.lastWorkerErrorMessage = msg\.message;\s*\n\s*this\.repeatedWorkerErrorCount = 1;/);
  });

  test('the throttle touches logging only, never dispatch', () => {
    const start = sttSrc.indexOf("} else if (msg.type === 'error') {");
    const block = sttSrc.slice(start, start + 1400);
    assert.ok(
      !/return;/.test(block.slice(0, block.indexOf('console.error'))),
      'the error branch must not short-circuit transcription handling',
    );
  });
});
