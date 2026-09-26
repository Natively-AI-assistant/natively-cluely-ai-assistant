// Custom Provider WIRE payload (2026-09-03).
//
// WHY THIS EXISTS SEPARATELY FROM CustomProviderScreenshotSize2026_07_19
// That test states the contract in its own words — "the wire format changes
// from data:image/png;base64,… to data:image/jpeg;base64,…" — and then asserts
// only `optimizer.optimize(...).mimeType === 'image/jpeg'`. It tests the
// OPTIMIZER, which was right, and never the ASSEMBLY, which was wrong: both
// executors optimized the screenshot to JPEG and then handed the ORIGINAL .png
// path to injectImageIntoMessages, which derives the declared mime from it. So
// `data:image/png;base64,<JPEG bytes>` shipped for months under a green test.
//
// The lesson is the test boundary, not the bug: a claim about what leaves the
// process has to be asserted on what leaves the process. Every assertion below
// reads a real HTTP request body received by a real local server, driven
// through the real built executors.
//
// Covers, in one pass over the same seam:
//   1  declared mime matches the actual magic bytes (both executors)
//   2  a spaced {{ IMAGE_BASE64 }} is substituted, not shipped literally
//   3  $& / $` / $' in a prompt survive placeholder expansion intact
//   4  the configured responsePath is honored, and a stale one degrades
//   5  non-OpenAI `messages` dialects are not auto-detected as vision
//
// Run: npm run build:electron && node --test electron/services/__tests__/CustomProviderWirePayload2026_09_03.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { LLMHelper } = require(path.join(repoRoot, 'dist-electron/electron/LLMHelper.js'));
const { customProviderSupportsVision } = require(path.join(repoRoot, 'dist-electron/electron/llm/visionCapability.js'));
const { validateCurl, blockedInfrastructureHost } = require(path.join(repoRoot, 'dist-electron/electron/utils/curlUtils.js'));
const { ImageOptimizer } = require(path.join(repoRoot, 'dist-electron/electron/services/screen/ImageOptimizer.js'));
const { isLocalVisionProvider } = require(path.join(repoRoot, 'dist-electron/electron/llm/visionPolicy.js'));
const { readActiveCustomProvider } = require(path.join(repoRoot, 'dist-electron/electron/llm/activeCustomProvider.js'));

let server;
let endpoint;
let shotDir;
let shotPng;
const received = [];

/** Response shape deliberately OUTSIDE extractFromCommonFormats' eight formats,
 *  so anything the executor returns had to come from the configured path. */
const RESPONSE_BODY = { data: { answer: 'ANSWER_FROM_ENDPOINT' } };

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      received.push({ body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(RESPONSE_BODY));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;

  // A .png source above the 1280px long-edge budget, noisy enough that it does
  // not trivially compress — i.e. the optimizer really re-encodes it.
  shotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpwire-'));
  shotPng = path.join(shotDir, 'screenshot.png');
  const w = 1600, h = 1000;
  const noise = Buffer.alloc(w * h * 4);
  for (let i = 0; i < noise.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    noise[i] = v; noise[i + 1] = v; noise[i + 2] = v; noise[i + 3] = 255;
  }
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } })
    .composite([{ input: noise, raw: { width: w, height: h, channels: 4 }, tile: true }])
    .png({ compressionLevel: 6 })
    .toFile(shotPng);
});

after(async () => {
  await new Promise(r => server.close(r));
  await fs.rm(shotDir, { recursive: true, force: true });
});

/** Bare instance over the real prototype. Only the privacy guard is stubbed —
 *  it is a separate boundary with its own tests, and it would otherwise need a
 *  full settings store to answer. Everything under test is the real code. */
function helperFor(provider) {
  const h = Object.create(LLMHelper.prototype);
  h.assertOutboundScopes = () => {};
  h.isProviderDisabled = () => false;
  h.customProvider = provider;
  h.isLocalOnlyMode = false;
  return h;
}

const openAiTemplate = () =>
  `curl ${endpoint} -H 'Content-Type: application/json' -d '{"model":"m","messages":[{"role":"user","content":"{{TEXT}}"}]}'`;

function containerOf(base64) {
  const b = Buffer.from(base64, 'base64');
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  return `unknown:${b.subarray(0, 4).toString('hex')}`;
}

/** Pull the image data URL out of the last request the server actually received. */
function imageDataUrlFromLastRequest() {
  const body = JSON.parse(received.at(-1).body);
  const part = body.messages[0].content.find(p => p.type === 'image_url');
  assert.ok(part, 'no image_url part reached the endpoint');
  const url = part.image_url.url;
  const sep = url.indexOf(';base64,');
  return { declared: url.slice(5, sep), base64: url.slice(sep + ';base64,'.length) };
}

// ── 1. the assertion the July test never made ───────────────────────────────

describe('declared mime matches the bytes on the wire', () => {
  test('executeCustomProvider', async () => {
    received.length = 0;
    const tpl = openAiTemplate();
    await helperFor({ id: 'p', name: 'p', curlCommand: tpl })
      .executeCustomProvider(tpl, 'combined', 'sys', 'user', '', shotPng);

    const { declared, base64 } = imageDataUrlFromLastRequest();
    assert.equal(containerOf(base64), 'image/jpeg',
      'the optimizer should have re-encoded the .png screenshot as JPEG');
    assert.equal(declared, containerOf(base64),
      `declared "${declared}" over ${containerOf(base64)} bytes — a strict endpoint decodes by the DECLARED type and rejects`);
  });

  test('streamWithCustom', async () => {
    received.length = 0;
    const tpl = openAiTemplate();
    const h = helperFor({ id: 'p', name: 'p', curlCommand: tpl });
    for await (const _ of LLMHelper.prototype.streamWithCustom.call(h, 'user', undefined, [shotPng], 'sys')) { /* drain */ }

    const { declared, base64 } = imageDataUrlFromLastRequest();
    assert.equal(containerOf(base64), 'image/jpeg');
    assert.equal(declared, containerOf(base64),
      'the streaming executor has the same defect shape as the non-streaming one; both need pinning');
  });

  test('the screenshot is still actually optimized, not just relabelled', async () => {
    received.length = 0;
    const tpl = openAiTemplate();
    await helperFor({ id: 'p', name: 'p', curlCommand: tpl })
      .executeCustomProvider(tpl, 'combined', 'sys', 'user', '', shotPng);
    const { base64 } = imageDataUrlFromLastRequest();
    const sourceBytes = (await fs.stat(shotPng)).size;
    assert.ok(base64.length < sourceBytes,
      'base64 of the optimized image should be smaller than the raw source file');
  });
});

// ── 2. detection and substitution must agree on the placeholder shape ───────

describe('placeholder expansion', () => {
  test('a spaced {{ IMAGE_BASE64 }} is substituted, not shipped literally', async () => {
    const tpl = `curl ${endpoint} -H 'Content-Type: application/json' -d '{"prompt":"{{TEXT}}","image":"{{ IMAGE_BASE64 }}"}'`;

    assert.equal(customProviderSupportsVision({ curlCommand: tpl }), true,
      'the spaced form is accepted as evidence of vision support');

    received.length = 0;
    await helperFor({ id: 'p', name: 'p', curlCommand: tpl })
      .executeCustomProvider(tpl, 'combined', 'sys', 'user', '', shotPng);

    const sent = JSON.parse(received.at(-1).body);
    assert.notEqual(sent.image, '{{ IMAGE_BASE64 }}',
      'detection accepted the spaced form while the replacer only matched the unspaced one, '
      + 'so the endpoint received the literal placeholder as its image');
    assert.equal(containerOf(sent.image), 'image/jpeg');
  });

  test('$-sequences in the prompt survive intact', async () => {
    // String.replace treats $&, $`, $' and $n in the REPLACEMENT as patterns.
    const prompt = "what does $& mean in sed? and $` and $' and $1 too";
    received.length = 0;
    const tpl = openAiTemplate();
    await helperFor({ id: 'p', name: 'p', curlCommand: tpl })
      .executeCustomProvider(tpl, prompt, 'sys', prompt, '');

    assert.equal(JSON.parse(received.at(-1).body).messages[0].content, prompt,
      'a question about sed rewrote itself when the value was used as a replacement string');
  });
});

// ── 3. the field the UI collects has to reach the executor ─────────────────

describe('responsePath', () => {
  const provider = () => ({ id: 'p', name: 'p', curlCommand: openAiTemplate(), responsePath: 'data.answer' });

  test('executeCustomProvider honors it', async () => {
    const p = provider();
    const out = await helperFor(p)
      .executeCustomProvider(p.curlCommand, 'combined', 'sys', 'user', '', undefined, p.responsePath);
    assert.equal(out, 'ANSWER_FROM_ENDPOINT',
      'Settings collects, stores and displays responsePath; the live executors must read it');
  });

  test('streamWithCustom honors it', async () => {
    const p = provider();
    let out = '';
    for await (const c of LLMHelper.prototype.streamWithCustom.call(helperFor(p), 'user', undefined, undefined, 'sys')) out += c;
    assert.equal(out, 'ANSWER_FROM_ENDPOINT',
      'a whole non-streaming JSON body arrives via parseStreamLine, not the !yieldedAny fallback — '
      + 'honoring the path in only one of the two left every non-streaming provider showing raw JSON');
  });

  test('a stale path degrades to shape detection instead of breaking the provider', async () => {
    const p = provider();
    const out = await helperFor(p)
      .executeCustomProvider(p.curlCommand, 'combined', 'sys', 'user', '', undefined, 'nope.not.here');
    assert.equal(out, JSON.stringify(RESPONSE_BODY),
      'a path that no longer resolves should fall through to the previous behavior');
  });
});

// ── 4. a messages array is not proof of the OpenAI multimodal dialect ──────

describe('vision auto-detect rejects dialects that cannot carry image_url', () => {
  const cases = [
    ['OpenAI-compatible', () => openAiTemplate(), true],
    ['Anthropic Messages (version header)',
      () => `curl https://api.anthropic.com/v1/messages -H 'x-api-key: k' -H 'anthropic-version: 2023-06-01' -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`, false],
    ['Ollama native /api/chat',
      () => `curl http://localhost:11434/api/chat -d '{"model":"llava","messages":[{"role":"user","content":"{{TEXT}}"}]}'`, false],
    ['Ollama OpenAI-compatible /v1 surface',
      () => `curl http://localhost:11434/v1/chat/completions -d '{"model":"llava","messages":[{"role":"user","content":"{{TEXT}}"}]}'`, true],
    ['Anthropic with an explicit image placeholder the user positioned',
      () => `curl https://api.anthropic.com/v1/messages -H 'anthropic-version: 2023-06-01' -d '{"messages":[{"role":"user","content":"{{TEXT}}","image":"{{IMAGE_BASE64}}"}]}'`, true],
  ];

  for (const [label, tpl, expected] of cases) {
    test(`${label} → ${expected}`, () => {
      assert.equal(customProviderSupportsVision({ curlCommand: tpl() }), expected,
        'Anthropic rejects an image_url part with 400; Ollama native ignores it and answers text-only '
        + 'about a screenshot it never saw — the silent drop this predicate exists to prevent');
    });
  }

  test('an explicit multimodal flag still overrides in both directions', () => {
    const anthropic = `curl https://api.anthropic.com/v1/messages -H 'anthropic-version: 2023-06-01' -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: anthropic, multimodal: true }), true);
    assert.equal(customProviderSupportsVision({ curlCommand: openAiTemplate(), multimodal: false }), false);
  });
});

// ── 5. review follow-ups (2026-09-04) ──────────────────────────────────────
// Raised on the fix pass itself, each verified rather than assumed.

describe('the Ollama-native exclusion does not catch OpenAI gateways', () => {
  const body = `-d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`;
  const cases = [
    ['public gateway mounted at /api/chat', `curl https://gw.example.com/api/chat ${body}`, true],
    ['Ollama on its default port',          `curl http://192.168.1.9:11434/api/chat ${body}`, false],
    ['Ollama on loopback, custom port',     `curl http://127.0.0.1:9999/api/chat ${body}`, false],
    ['a gateway whose path also has /v1/',  `curl http://127.0.0.1:8080/v1/api/chat ${body}`, true],
  ];
  for (const [label, curl, expected] of cases) {
    test(`${label} → ${expected}`, () => {
      assert.equal(customProviderSupportsVision({ curlCommand: curl }), expected,
        'matching the /api/chat PATH alone silently disabled vision for any self-hosted '
        + 'OpenAI-compatible gateway that happens to use that route name');
    });
  }
});

describe('validateCurl names the right cause', () => {
  test('a -F form template is refused, and the message does not blame -d', () => {
    const r = validateCurl(`curl https://x.com/api -F 'text={{TEXT}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /-F form field|query/,
      'curl2Json puts -F into `form`, which no executor sends — but the old message told the '
      + 'user to fix quoting in a -d flag their template does not have');
    assert.doesNotMatch(r.message, /quoting in -d/);
  });

  test('a ?query= template is refused for the same reason', () => {
    const r = validateCurl(`curl 'https://x.com/api?q={{TEXT}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /-F form field|query/);
  });

  test('an unparseable -d body still gets the quoting message', () => {
    const r = validateCurl(`curl https://x.com/api -d '{"p": {{TEXT}}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /quoting in -d/);
  });
});

describe('metadata hosts are refused; ordinary local endpoints are not', () => {
  for (const [url, blocked] of [
    ['http://169.254.169.254/latest/meta-data/', true],
    ['http://metadata.google.internal/computeMetadata/v1/', true],
    ['http://127.0.0.1:11434/v1/chat/completions', false],
    ['http://192.168.1.50:1234/v1/chat/completions', false],
    ['https://api.openai.com/v1/chat/completions', false],
  ]) {
    test(`${url} → ${blocked ? 'refused' : 'allowed'}`, () => {
      assert.equal(Boolean(blockedInfrastructureHost(url)), blocked,
        'the broad SSRF check blocked every loopback and RFC-1918 host, which is what a custom '
        + 'provider is for; only metadata endpoints are never a legitimate model host');
    });
  }
});

describe('the optimizer reuse guard', () => {
  test('never resolves to a path whose file has been deleted', async () => {
    // The reuse map is keyed on the produced path, so this is the registry →
    // executeCustomProvider double-encode case: optimize() is handed its own
    // earlier output. If that file has since been swept, the guard must not
    // return the stale record — a dead path resolves fine here and then makes
    // getBase64() throw much later, sending callers into their raw-read
    // fallback and shipping the unoptimized multi-MB source.
    //
    // Rejecting is the correct outcome, not a re-encode: the deleted output IS
    // the source for this call, so there is nothing left to encode from. It
    // matches the contract the July test already pins — a missing source throws
    // so the caller can fall back deliberately, rather than failing obscurely.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpwire-opt-'));
    const opt = new ImageOptimizer(dir);
    const first = await opt.optimize(shotPng, { profile: 'balanced', provider: 'custom', cacheKey: 'k1' });
    await fs.unlink(first.path);

    await assert.rejects(
      () => opt.optimize(first.path, { profile: 'balanced', provider: 'custom', cacheKey: 'k2' }),
      /cannot stat source image/i,
      'the guard returned its stale record instead of failing on the missing file',
    );

    // And a fresh encode from a source that still exists keeps working.
    const recovered = await opt.optimize(shotPng, { profile: 'balanced', provider: 'custom', cacheKey: 'k3' });
    await fs.stat(recovered.path);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a different requested quality re-encodes instead of reusing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpwire-optq-'));
    const opt = new ImageOptimizer(dir);
    const q85 = await opt.optimize(shotPng, { profile: 'balanced', provider: 'custom', cacheKey: 'a' });
    const q60 = await opt.optimize(q85.path, { profile: 'balanced', provider: 'custom', quality: 60, cacheKey: 'b' });
    assert.notEqual(q60.path, q85.path, 'a quality the caller explicitly asked for must not be ignored');
    assert.ok(q60.byteSize < q85.byteSize, 'the lower-quality request should actually produce a smaller file');
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('an identical repeat request still short-circuits', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpwire-optr-'));
    const opt = new ImageOptimizer(dir);
    const first = await opt.optimize(shotPng, { profile: 'balanced', provider: 'custom', cacheKey: 'a' });
    const again = await opt.optimize(first.path, { profile: 'balanced', provider: 'custom', cacheKey: 'b' });
    assert.equal(again.path, first.path, 'the double-encode this guard exists to prevent');
    assert.equal(again.cacheHit, true);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

// ── 6. review round two (2026-09-04) ───────────────────────────────────────

describe('the three consumers of "is this custom provider local" agree', () => {
  // The regression this pins: widening anyLocalVisionProviderConfigured() to
  // count local custom providers, without teaching isLocalVisionProvider() the
  // same thing, made private_vision promise local vision and then throw
  // VisionPolicyError at dispatch — a worse outcome than the refusal it
  // replaced, and the opposite of what the widening was for.
  test('the last boundary accepts a local custom provider', () => {
    assert.equal(isLocalVisionProvider('custom_provider', { customProviderIsLocal: true }), true);
    assert.equal(isLocalVisionProvider('custom_curl', { customProviderIsLocal: true }), true);
  });

  test('and still refuses a cloud one, and Codex, and an unknown label', () => {
    assert.equal(isLocalVisionProvider('custom_provider', { customProviderIsLocal: false }), false);
    assert.equal(isLocalVisionProvider('custom_provider'), false, 'a caller that does not know must get the safe answer');
    assert.equal(isLocalVisionProvider('codex'), false, 'Codex routes to chatgpt.com — never local');
    assert.equal(isLocalVisionProvider('openai'), false);
    assert.equal(isLocalVisionProvider('ollama'), true);
  });
});

describe('the vision gates count the ACTIVE custom provider, not every saved one', () => {
  const local = { id: 'l', name: 'local', curlCommand: `curl http://127.0.0.1:1234/v1/chat -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'` };
  const withActive = (provider, fn) => {
    const g = globalThis;
    const prev = g.__nativelyGetLLMHelper;
    g.__nativelyGetLLMHelper = () => ({ getActiveCustomProvider: () => provider });
    try { return fn(); } finally { g.__nativelyGetLLMHelper = prev; }
  };

  test('reads the active provider', () => {
    assert.equal(withActive(local, () => readActiveCustomProvider()?.id), 'l');
  });

  test('returns null when a non-custom model is selected', () => {
    assert.equal(withActive(null, () => readActiveCustomProvider()), null,
      'setModel nulls customProvider; the vision chain then has no custom rung to run, '
      + 'so the gates must not claim one is available');
  });

  test('and null when no helper is up at all', () => {
    const g = globalThis;
    const prev = g.__nativelyGetLLMHelper;
    delete g.__nativelyGetLLMHelper;
    try { assert.equal(readActiveCustomProvider(), null); } finally { g.__nativelyGetLLMHelper = prev; }
  });
});

describe('a responsePath that resolves to empty falls back to shape detection', () => {
  test('empty string is a miss, not a blank answer', async () => {
    // A reasoning model that puts everything in reasoning_content leaves
    // choices[0].message.content as "". Before responsePath was honored, shape
    // detection still produced text; returning '' would be a new blank-answer bug.
    const h = helperFor(null);
    const data = { choices: [{ message: { content: '' } }], data: { answer: 'FALLBACK_TEXT' } };
    const out = LLMHelper.prototype.extractCustomAnswer.call(h, data, 'choices[0].message.content');
    assert.notEqual(out, '', 'an empty resolution must not become the answer');
  });

  test('a non-empty resolution still wins over shape detection', () => {
    const h = helperFor(null);
    const data = { choices: [{ message: { content: 'SHAPE' } }], data: { answer: 'PATH' } };
    assert.equal(LLMHelper.prototype.extractCustomAnswer.call(h, data, 'data.answer'), 'PATH');
  });
});

describe('dialect detection reads the URL and headers, never the body', () => {
  const openAiBody = `-d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`;

  test('a body that merely mentions anthropic-version keeps vision', () => {
    const curl = `curl https://gw.example.com/v1/chat/completions ${'-d'} '{"messages":[{"role":"user","content":"Explain the anthropic-version: header. {{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), true,
      'scanning the whole template let a system prompt about the Anthropic API silently disable vision');
  });

  test('a real anthropic-version header still excludes', () => {
    const curl = `curl https://api.anthropic.com/v1/messages -H 'anthropic-version: 2023-06-01' ${openAiBody}`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), false);
  });

  test('a /v1/ string inside the body does not defeat the Ollama-native guard', () => {
    const curl = `curl http://127.0.0.1:11434/api/chat -d '{"messages":[{"role":"user","content":"see https://api.openai.com/v1/chat {{TEXT}}"}]}'`;
    assert.equal(customProviderSupportsVision({ curlCommand: curl }), false,
      'the URL check must read the endpoint, not prose in the prompt');
  });
});
