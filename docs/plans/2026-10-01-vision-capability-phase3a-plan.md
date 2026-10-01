# Vision Capability Phase 3a: The One-Time Image Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When you select a model nobody publishes image data about, Natively tests it once, in the background, by showing it a generated image with a number and checking the number comes back. The result is saved and decides whether that model gets screenshots.

**Architecture:** A pure probe engine (`visionProbe.ts`) asks a model through Natively's own adapters, judged by a strict classifier (`visionProbeOutcome.ts`), using an image generated in pure Node (`visionTestImage.ts`). Results live in the phase-2 store under a new optional `tests` section and reach the resolver as a `testedVision` fact, ranked after provider data and before the name list. Direct Assist's per-provider switch is factored into one dispatcher that Direct Assist and the probe both call. Only "yes" and "no" results change behaviour; "unknown" keeps today's handling.

**Tech Stack:** TypeScript (Electron main), Node `zlib` for PNG, esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (section 2 "The one-time test", delivery item 3). Earlier plans: phase 1 and phase 2 in the same folder.

## Global Constraints

- macOS and Windows: no OS-specific code. The test image is generated in pure Node (no fonts, no native modules). Temp files go under `os.tmpdir()` with a unique name and are deleted after the stream ends.
- A transient failure is never an answer. "No" needs a real reply without the number (confirmed by a second attempt with a different number) or a recognised image-refusal error. Everything else is "unknown" and is retried later.
- Stored data survives upgrades: the store file stays `version: 1`; `tests` is an optional section. A phase-2 file must load with its OpenRouter catalogue intact.
- A test request must not appear in the Usage tab, change `visionHealth` or provider latency stats, or trigger model discovery. It calls adapters directly, below the layers that record those.
- Tests run only when all hold:
  - the verdict is unknown (or a saved test is older than 30 days);
  - the provider is testable and has a credential;
  - the provider is not switched off;
  - the screenshots scope and private-vision mode allow images to leave the device.

  Testable providers: `openai`, `claude`, `gemini`, `nvidia_nim`, `openrouter`, `fluxion`, `agentrouter`, `litellm`, `ninerouter`. Not tested: route-decided providers, Groq (its table is authoritative), Ollama (`/api/show`), custom/cURL (template).
- Probing is off until `enableVisionProbing()` is called (ProcessingHelper does, at startup), so no test or benchmark sends a probe by accident.
- Only one Natively dev app and one build at a time on this machine; check `uptime` and `pgrep` before starting either (memory: one app instance at a time).
- API keys are never printed or put on argv. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Deferred, with reasons (Task 8 records them in the design doc):
  - "Unknown and nothing else can read it → test on the spot, send only if it passes" needs rungs that send to the selected model, which is phase 5. In 3a an unknown selection behaves as today and is tested in the background.
  - Direct DeepSeek Flash image support is phase 3b.
  - Name-list "known text-only" entries are skipped: a test costs one tiny request once, and is more reliable than a hand list.

## Review Focus

1. A vision model that misreads the blocky digits once must not be marked text-only for 30 days: "no" from a reply needs two misses with two different numbers. Tested in Task 5.
2. An empty daily pool (402), rate limit (429), server error, timeout, content filter or auth failure must leave the model unknown, with a retry later, and never store "no". Tested in Tasks 1 and 5.
3. A phase-2 `vision-capabilities.json` (no `tests` key) must load with its catalogue intact, and a file written by this version must still load. Tested in Task 3.
4. Selecting a model while its provider is switched off, or while screenshots may not leave the device, must send nothing. Tested in Task 6.
5. Two selections of the same model in quick succession must produce one test, not two. Tested in Task 5.

## What a test result changes in 3a

| Site | Today | With a saved result |
|---|---|---|
| AgentRouter chain seat and registry rung | name list; unknown = not seated | "yes" seats, "no" skips |
| LiteLLM / NVIDIA NIM / Fluxion chain seats and registry rungs | seated whenever selected | "no" skips; "yes" and unknown seat as today |
| OpenRouter / 9Router seats | catalogue, else seated | test consulted when the catalogue has no entry |
| Direct Assist, direct vendors (`default:`) | name list; unknown = refuse | "yes" forwards |
| Direct Assist, gateways | forward | "no" refuses with its clear message |
| `getCapabilities()` | resolver | follows automatically |

## File structure

- Create `electron/llm/visionProbeOutcome.ts`: `isImageRefusalMessage`, `judgeProbeReply`, `judgeProbeError`. Pure.
- Create `electron/llm/visionTestImage.ts`: `newVisionTestNumber`, `renderDigitsPng`. Pure.
- Create `electron/llm/visionProbe.ts`: the `VisionProbe` engine with injected dependencies. Pure.
- Modify `electron/llm/streamFallbackEngine.ts`: image refusals classify as `no_vision` before the 404 → `model_gone` check; new `onNoVision` hook.
- Modify `electron/llm/visionCapabilityStore.ts`: `tests` section, `storedVisionTest`.
- Modify `electron/llm/visionResolver.ts`: `testedVision` fact, source `'test'`; `SEAT_ON_UNKNOWN` gains `litellm`, `nvidia_nim`, `fluxion`.
- Modify `electron/LLMHelper.ts`:
  - `openDirectProviderStream` (extracted);
  - probe wiring and triggers;
  - seats;
  - the Direct Assist gateway group;
  - LiteLLM `supports_vision`.
- Modify `electron/ProcessingHelper.ts`: `enableVisionProbing()` before the startup `setModel`.
- Modify `electron/services/screen/VisionProviderRegistry.ts`: `litellm()`, `nvidiaNim()`, `fluxion()`, `agentrouter()`, `ninerouter()`, `openrouter()` rungs pass the test fact.
- Tests (new unless noted):
  - `electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionTestImage2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionProbe2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs` (modify)
  - `electron/llm/__tests__/VisionResolver2026_10_01.test.mjs` (modify)
  - `electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs`

Commands run from the worktree root `.claude/worktrees/vision-phase3a`. `SP` = the session scratchpad. Tests need `npm run build:electron` first (check `uptime` and `pgrep -fl "build-electron|dev-agent"` before each build).

---

### Task 1: Recognising an image refusal

**Files:**
- Create: `electron/llm/visionProbeOutcome.ts`
- Modify: `electron/llm/streamFallbackEngine.ts` (`classifyStreamError`, before the `status === 404` block)
- Test: `electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs`

**Interfaces:**
- Produces:
  - `isImageRefusalMessage(message: string): boolean`
  - `type ProbeOutcome = 'yes' | 'no' | 'unknown'`
  - `judgeProbeReply(reply: string, number: string): ProbeOutcome`
  - `judgeProbeError(err: unknown): 'no' | 'unknown'`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Telling "this model cannot see images" apart from every other failure
 * (2026-10-01). Reproduced live: OpenRouter answers an image sent to a
 * text-only model with HTTP 404 "No endpoints found that support image input",
 * and the stream classifier read the 404 as a RETIRED model — demoted for 24
 * hours, discovery triggered. For the one-time image test the stakes are higher:
 * a transient failure stored as "no" would block a capable model for a month.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { isImageRefusalMessage, judgeProbeReply, judgeProbeError } = require(dist('llm/visionProbeOutcome.js'));
const { classifyStreamError } = require(dist('llm/streamFallbackEngine.js'));

const REFUSALS = [
  '404 No endpoints found that support image input',                        // OpenRouter, observed live 2026-10-01
  'The selected deepseek-v4-flash model does not support image input.',     // Natively's own Direct Assist wording
  "The current model doesn't support image input.",
  'Invalid content type. image_url is only supported by certain models.',   // OpenAI
  'This model does not support vision.',
  'Image input is not supported for this model',
  'images are not supported by this model',
];
const NOT_REFUSALS = [
  '402 Budget pool quota has been exhausted',
  '429 rate limit exceeded',
  '503 当前分组 default 下对于模型 x 无可用渠道',
  '401 unauthorized_client_error',
  '400 content-blocked',
  'The model `x` does not exist or you do not have access to it.',
  'This model does not support streaming.',
  'fetch failed',
  '',
];

describe('isImageRefusalMessage', () => {
  for (const m of REFUSALS) test(`refusal: ${m}`, () => assert.equal(isImageRefusalMessage(m), true));
  for (const m of NOT_REFUSALS) test(`not a refusal: ${m || '(empty)'}`, () => assert.equal(isImageRefusalMessage(m), false));
});

describe('the stream classifier', () => {
  test("OpenRouter's image 404 is no_vision, not a retired model", () => {
    const err = Object.assign(new Error('404 No endpoints found that support image input'), { status: 404 });
    assert.equal(classifyStreamError(err, false), 'no_vision');
  });
  test('a real retired-model 404 is still model_gone', () => {
    const err = Object.assign(new Error('The model `llama-4-scout` has been decommissioned'), { status: 404 });
    assert.equal(classifyStreamError(err, false), 'model_gone');
    assert.equal(classifyStreamError(Object.assign(new Error('Not Found'), { status: 404 }), false), 'model_gone');
  });
});

describe('judgeProbeReply', () => {
  test('the number, however it is written, is a yes', () => {
    for (const reply of ['7392', 'The number is 7392.', 'It shows 7 3 9 2', '7,392', '**7392**', 'The image displays "73 92".']) {
      assert.equal(judgeProbeReply(reply, '7392'), 'yes', reply);
    }
  });
  test('a real reply without the number is a no', () => {
    for (const reply of ["I can't see any image in this chat.", "Images aren't supported here.", 'The number is 1234.', 'I do not have the ability to view images.']) {
      assert.equal(judgeProbeReply(reply, '7392'), 'no', reply);
    }
  });
  test('an empty or near-empty reply is unknown, never a no', () => {
    for (const reply of ['', '   ', '\n', '.', 'ok']) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', JSON.stringify(reply));
  });
  test('the number inside a longer number does not count', () => {
    assert.equal(judgeProbeReply('173920', '7392'), 'no');
  });
});

describe('judgeProbeError', () => {
  test('only a recognised image refusal is a no', () => {
    for (const m of REFUSALS) assert.equal(judgeProbeError(new Error(m)), 'no', m);
    for (const m of NOT_REFUSALS) assert.equal(judgeProbeError(new Error(m)), 'unknown', m);
    assert.equal(judgeProbeError(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'unknown');
    assert.equal(judgeProbeError(undefined), 'unknown');
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Run: `node --test electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs`. Expected: `Cannot find module …/visionProbeOutcome.js`.

- [ ] **Step 3: Implement.** `electron/llm/visionProbeOutcome.ts`:

```ts
// electron/llm/visionProbeOutcome.ts
//
// Telling "this model cannot see images" apart from every other failure
// (design: docs/plans/2026-10-01-vision-capability-design.md, phase 3). Pure.
//
// STRICT ON PURPOSE. A "no" is saved for 30 days and stops a model receiving
// screenshots, so it needs positive evidence: a recognised image refusal, or a
// real reply that does not contain the number. An empty daily pool, a rate
// limit, a timeout, a content filter and an auth failure are all "unknown".

export type ProbeOutcome = 'yes' | 'no' | 'unknown';

// Each pattern is an image-specific refusal seen from a real provider, or
// Natively's own wording. Nothing generic ("does not support", "404") belongs
// here: `does not support streaming` and a retired-model 404 are not about images.
const IMAGE_REFUSAL_PATTERNS: readonly RegExp[] = [
  /support(?:s)? image input/,                                   // OpenRouter: "No endpoints found that support image input"
  /does(?: not|n't) support (?:image|vision)/,                   // "does not support image input", "doesn't support vision"
  /image_url is only supported/,                                 // OpenAI
  /images?(?: input| inputs)? (?:is|are)(?: not|n't) supported/, // "images are not supported", "image input is not supported"
  /images? not supported/,
  /\bno vision\b/,
  /vision is not/,
];

export function isImageRefusalMessage(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return m.length > 0 && IMAGE_REFUSAL_PATTERNS.some((re) => re.test(m));
}

/**
 * Judge the model's reply to "what number is shown?". Separators between digits
 * are ignored ("7 3 9 2", "7,392"); the number must stand alone, so "173920"
 * does not contain 7392. An empty or one-word reply is unknown, not "no": some
 * gateways return an empty stream when a channel misbehaves.
 */
export function judgeProbeReply(reply: string, number: string): ProbeOutcome {
  const text = String(reply || '');
  const joined = text.replace(/(\d)[\s,.\-_]+(?=\d)/g, '$1');
  if (new RegExp(`(?<!\\d)${number}(?!\\d)`).test(joined)) return 'yes';
  return text.replace(/[^\p{L}\p{N}]/gu, '').length >= 6 ? 'no' : 'unknown';
}

/** An error is a "no" only when it is a recognised image refusal. */
export function judgeProbeError(err: unknown): 'no' | 'unknown' {
  const message = (err as { message?: unknown } | null | undefined)?.message ?? err ?? '';
  return isImageRefusalMessage(String(message)) ? 'no' : 'unknown';
}
```

In `electron/llm/streamFallbackEngine.ts`: import `isImageRefusalMessage` from `./visionProbeOutcome`. In `classifyStreamError`, immediately before the `status === 404 || status === 410 ||` block, add:

```ts
  // An image-specific refusal means "this model can't see", whatever status
  // carries it (2026-10-01). OpenRouter sends it as a 404, which the block
  // below read as a retired model: demoted for 24 h and discovery triggered.
  if (isImageRefusalMessage(msg)) return 'no_vision';
```

- [ ] **Step 4: Rebuild and run, with the existing classifier tests.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs electron/llm/__tests__/VisionStreamFallback.test.mjs electron/services/__tests__/GroqRetiredModels2026_08_23.test.mjs`. Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionProbeOutcome.ts electron/llm/streamFallbackEngine.ts electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs
git commit -m "fix(vision): an image refusal is 'this model can't see', not a retired model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The test image

**Files:**
- Create: `electron/llm/visionTestImage.ts`
- Test: `electron/llm/__tests__/VisionTestImage2026_10_01.test.mjs`

**Interfaces:**
- Produces: `newVisionTestNumber(random?: () => number): string` (four digits, 1000–9999); `renderDigitsPng(digits: string, scale?: number): Buffer`.

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The one-time test's image (2026-10-01): digits drawn from a built-in bitmap
 * font into a PNG by pure Node, so it is byte-identical on macOS and Windows —
 * no system fonts, no native modules.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { newVisionTestNumber, renderDigitsPng } = require(dist('llm/visionTestImage.js'));

/** Minimal PNG reader for 8-bit greyscale, filter 0: returns { width, height, pixels }. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let off = 8; let width = 0; let height = 0; const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    assert.equal(png.readUInt32BE(off + 8 + len), zlib.crc32(png.subarray(off + 4, off + 8 + len)), `${type} CRC`);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert.equal(data[9], 0); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = [];
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0, 'filter byte');
    pixels.push(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)));
  }
  return { width, height, pixels };
}

describe('newVisionTestNumber', () => {
  test('always four digits, never a leading zero', () => {
    for (const r of [0, 0.5, 0.9999999]) assert.match(newVisionTestNumber(() => r), /^[1-9]\d{3}$/);
    assert.equal(newVisionTestNumber(() => 0), '1000');
    assert.equal(newVisionTestNumber(() => 0.9999999), '9999');
  });
});

describe('renderDigitsPng', () => {
  test('a valid greyscale PNG with dark digits on a light background', () => {
    const { width, height, pixels } = decode(renderDigitsPng('7392'));
    assert.ok(width >= 300 && height >= 120, `${width}x${height}`);
    const dark = pixels.reduce((n, row) => n + row.filter((v) => v < 64).length, 0);
    assert.ok(dark > width * height * 0.08 && dark < width * height * 0.5, `dark share ${dark / (width * height)}`);
    assert.equal(pixels[0][0], 255, 'the margin is white');
  });
  test('deterministic, and different numbers give different images', () => {
    assert.ok(renderDigitsPng('7392').equals(renderDigitsPng('7392')));
    assert.ok(!renderDigitsPng('7392').equals(renderDigitsPng('7393')));
  });
  test('each digit occupies its own cell: 1111 is darker on the right than 1 followed by blanks would be', () => {
    const a = decode(renderDigitsPng('1111')); const b = decode(renderDigitsPng('8888'));
    const dark = (d) => d.pixels.reduce((n, row) => n + row.filter((v) => v < 64).length, 0);
    assert.ok(dark(b) > dark(a), 'an 8 has more ink than a 1');
  });
  test('rejects anything but digits', () => {
    assert.throws(() => renderDigitsPng('12a4'));
    assert.throws(() => renderDigitsPng(''));
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Expected: `Cannot find module …/visionTestImage.js`.

- [ ] **Step 3: Implement `electron/llm/visionTestImage.ts`.**

```ts
// electron/llm/visionTestImage.ts
//
// The image the one-time vision test shows a model: four digits, drawn from a
// built-in 5x7 bitmap font into an 8-bit greyscale PNG (design:
// docs/plans/2026-10-01-vision-capability-design.md, phase 3). Pure Node —
// zlib and PNG chunks only — so the bytes are identical on macOS and Windows:
// no system font, no native module, nothing to differ between machines.

import zlib from 'node:zlib';

const FONT: Readonly<Record<string, readonly string[]>> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
const GLYPH_W = 5; const GLYPH_H = 7; const MARGIN = 2; const GAP = 1;

/** A four-digit number, 1000–9999: no leading zero for a model to drop. */
export function newVisionTestNumber(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}

/** Black digits on white, each font cell `scale` pixels square. */
export function renderDigitsPng(digits: string, scale = 14): Buffer {
  if (!/^\d+$/.test(digits)) throw new Error('renderDigitsPng: digits only');
  const cellsW = MARGIN * 2 + digits.length * GLYPH_W + (digits.length - 1) * GAP;
  const cellsH = MARGIN * 2 + GLYPH_H;
  const width = cellsW * scale; const height = cellsH * scale;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter type 0 on every row
  [...digits].forEach((d, i) => {
    const left = MARGIN + i * (GLYPH_W + GAP);
    FONT[d].forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      for (let py = 0; py < scale; py++) {
        const rowStart = ((MARGIN + gy) * scale + py) * (width + 1) + 1;
        raw.fill(0, rowStart + (left + gx) * scale, rowStart + (left + gx + 1) * scale);
      }
    }));
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

(`zlib.crc32` is available: Node 25.9 on this machine and Node 24.18 inside Electron, checked 2026-10-01.)

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionTestImage2026_10_01.test.mjs`. Expected: PASS.

- [ ] **Step 5: Check real models can read it, before building on it.** Write `$SP/vp3-legible.mjs`: it reads keys from `.env` itself (never printing them), renders `renderDigitsPng('7392')` from the built bundle, and sends it with "What number is shown in this image? Answer with the number only." to:
  - Gemini (`gemini-3.1-flash-lite`, `generateContent` with `inline_data`);
  - OpenRouter `openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5` and `qwen/qwen2.5-vl-72b-instruct` (chat completions with an `image_url` data URL). If an id is missing from the catalogue, pick the nearest listed model of that family.

Run it once. Expected: every model answers 7392. If any vision model misreads, raise `scale` or thicken the font and re-run before continuing. Record the replies in the ledger.

- [ ] **Step 6: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionTestImage.ts electron/llm/__tests__/VisionTestImage2026_10_01.test.mjs
git commit -m "feat(vision): the one-time test's image, drawn in pure Node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Saving test results

**Files:**
- Modify: `electron/llm/visionCapabilityStore.ts`
- Modify: `electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`

**Interfaces:**
- Produces:
  - `VisionCapabilityStore.tested(provider: string, baseURL: string, wireModel: string): { reads: boolean; at: number } | undefined`
  - `VisionCapabilityStore.recordTest(provider: string, baseURL: string, wireModel: string, reads: boolean): void`
  - `storedVisionTest(provider: string, routedModel: string, baseURL?: string): { reads: boolean; at: number } | undefined`
  - `normalizeVisionBaseURL(url: string | null | undefined): string` (trim, strip trailing slashes and a trailing `/v1`)

- [ ] **Step 1: Write the failing tests.** Append to `VisionCapabilityStore2026_10_01.test.mjs`:

```js
describe('test results (phase 3)', () => {
  test('a recorded test is returned with its time, for that provider, base URL and model only', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 500 });
    s.recordTest('fluxion', '', 'glm-5.3', false);
    assert.deepEqual(s.tested('fluxion', '', 'glm-5.3'), { reads: false, at: 500 });
    assert.equal(s.tested('fluxion', '', 'other'), undefined);
    assert.equal(s.tested('agentrouter', '', 'glm-5.3'), undefined);
    assert.equal(s.tested('fluxion', 'http://x', 'glm-5.3'), undefined);
  });
  test('tests and catalogues do not disturb each other, and both round-trip', () => {
    const file = tmpFile();
    const a = new S.VisionCapabilityStore({ filePath: file, now: () => 7 });
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    a.recordTest('openrouter', '', 'new/model', true);
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'b/c': false }));
    const b = new S.VisionCapabilityStore({ filePath: file });
    assert.deepEqual(b.tested('openrouter', '', 'new/model'), { reads: true, at: 7 }, 'a catalogue refresh keeps test results');
    assert.equal(b.answer('openrouter', '', 'b/c'), false);
  });
  test('a phase-2 file (no tests section) loads with its catalogue intact', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'openai/gpt-4o': true } } } }));
    const s = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(s.fetchedAt('openrouter', ''), 9);
    assert.equal(s.tested('openrouter', '', 'openai/gpt-4o'), undefined);
  });
  test('a malformed tests section is ignored without losing the catalogue', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'a/b': true } } }, tests: { 'x|': { m: { reads: 'yes', at: 'never' } }, bad: 5 } }));
    const s = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(s.answer('openrouter', '', 'a/b'), true);
    assert.equal(s.tested('x', '', 'm'), undefined);
  });
  test('storedVisionTest strips the routing prefix; normalizeVisionBaseURL makes writer and reader agree', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 1 });
    s.recordTest('litellm', S.normalizeVisionBaseURL('http://localhost:4000/v1/'), 'my-model', true);
    S.__setVisionCapabilityStore(s);
    assert.deepEqual(S.storedVisionTest('litellm', 'litellm/my-model', S.normalizeVisionBaseURL('http://localhost:4000')), { reads: true, at: 1 });
    assert.equal(S.normalizeVisionBaseURL(' http://h:1/v1// '), 'http://h:1');
    assert.equal(S.normalizeVisionBaseURL(undefined), '');
    S.__setVisionCapabilityStore(null);
  });
});
```

- [ ] **Step 2: Run; verify they fail.** Expected: `s.recordTest is not a function`.

- [ ] **Step 3: Implement.** In `visionCapabilityStore.ts`:

1. Types: add `interface TestResult { reads: boolean; at: number }`, and `tests?: Record<string, Record<string, TestResult>>` to `PersistedShape`.
2. Field: `private tests = new Map<string, Record<string, TestResult>>();`
3. Methods:

```ts
  /** A saved one-time test result, or undefined when this model was never tested. */
  tested(provider: string, baseURL: string, wireModel: string): TestResult | undefined {
    const models = this.tests.get(catalogueKey(provider, baseURL));
    return models && Object.prototype.hasOwnProperty.call(models, wireModel) ? models[wireModel] : undefined;
  }

  /** Save a definite test result. Transient failures are never recorded. */
  recordTest(provider: string, baseURL: string, wireModel: string, reads: boolean): void {
    const key = catalogueKey(provider, baseURL);
    this.tests.set(key, { ...(this.tests.get(key) ?? {}), [wireModel]: { reads, at: this.now() } });
    this.save();
  }
```

4. In `load()`, after the providers loop and inside the same `try`:

```ts
      // Optional since phase 3. A phase-2 file has no tests section.
      if (parsed.tests && typeof parsed.tests === 'object') {
        for (const [key, models] of Object.entries(parsed.tests)) {
          if (!models || typeof models !== 'object') continue;
          const clean: Record<string, TestResult> = {};
          for (const [id, r] of Object.entries(models)) {
            if (r && typeof r.reads === 'boolean' && Number.isFinite(r.at)) clean[id] = { reads: r.reads, at: r.at };
          }
          this.tests.set(key, clean);
        }
      }
```

and in the `catch`, also `this.tests.clear();`.

5. In `save()`, write `tests: Object.fromEntries(this.tests)` into the payload.
6. Exports:

```ts
/** One spelling for a self-hosted endpoint, so the writer and the reader build the same key. */
export function normalizeVisionBaseURL(url: string | null | undefined): string {
  return String(url ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
}

/** A saved test result for a ROUTED id. */
export function storedVisionTest(provider: string, routedModel: string, baseURL = ''): { reads: boolean; at: number } | undefined {
  const wire = (routedModel || '').startsWith(`${provider}/`) ? routedModel.slice(provider.length + 1) : routedModel;
  return getVisionCapabilityStore().tested(provider, baseURL, wire);
}
```

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`. Expected: PASS (16 tests).

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionCapabilityStore.ts electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs
git commit -m "feat(vision): the capability store keeps one-time test results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The resolver ranks a test result

**Files:**
- Modify: `electron/llm/visionResolver.ts`
- Modify: `electron/llm/__tests__/VisionResolver2026_10_01.test.mjs`

**Interfaces:**
- Produces:
  - `VisionSource` gains `'test'`
  - `VisionFacts.testedVision?: (provider: string, routedModel: string) => boolean | undefined`
  - `gatewaySeatReadsImages` accepts `'litellm' | 'nvidia_nim' | 'fluxion'` too (unknown → seated, as today)

- [ ] **Step 1: Write the failing tests.** Append to `VisionResolver2026_10_01.test.mjs`:

```js
describe('a one-time test result (phase 3)', () => {
  const tested = (map) => ({ testedVision: (provider, routed) => map[`${provider}:${routed}`] });
  test('beats the name list, both ways', () => {
    assert.deepEqual(v('agentrouter', 'agentrouter/glm-5.3', tested({ 'agentrouter:agentrouter/glm-5.3': true })), { reads: 'yes', source: 'test' });
    assert.deepEqual(v('openai', 'gpt-5.5', tested({ 'openai:gpt-5.5': false })), { reads: 'no', source: 'test' });
  });
  test("loses to the provider's own data", () => {
    const facts = { ...tested({ 'openrouter:openrouter/a/b': true }), providerReportsVision: () => false };
    assert.deepEqual(v('openrouter', 'openrouter/a/b', facts), { reads: 'no', source: 'provider' });
    const nine = { ...tested({ 'ninerouter:ninerouter/a/b': true }), ninerouterVisionModels: ['x/y'] };
    assert.deepEqual(v('ninerouter', 'ninerouter/a/b', nine), { reads: 'no', source: 'provider' });
  });
  test('fills in where a catalogue has no entry', () => {
    assert.deepEqual(v('openrouter', 'openrouter/new/model', { ...tested({ 'openrouter:openrouter/new/model': false }), providerReportsVision: () => undefined }), { reads: 'no', source: 'test' });
    assert.deepEqual(v('ninerouter', 'ninerouter/a/b', tested({ 'ninerouter:ninerouter/a/b': true })), { reads: 'yes', source: 'test' });
  });
  test('never applies to route-decided providers or Ollama', () => {
    assert.deepEqual(v('deepseek', 'deepseek-v4-flash', tested({ 'deepseek:deepseek-v4-flash': true })), { reads: 'no', source: 'route' });
    assert.deepEqual(v('natively', 'natively', tested({ 'natively:natively': false })), { reads: 'yes', source: 'route' });
    assert.deepEqual(v('ollama', 'llama3.1:8b', tested({ 'ollama:llama3.1:8b': true })), unknown);
  });
  test('gateway seats: a tested "no" is skipped; unknown seats as it always did', () => {
    for (const p of ['litellm', 'nvidia_nim', 'fluxion']) {
      const id = `${p}/some/model`;
      assert.equal(gatewaySeatReadsImages(p, id), true, `${p} unknown`);
      assert.equal(gatewaySeatReadsImages(p, id, tested({ [`${p}:${id}`]: false })), false, `${p} tested no`);
    }
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/glm-5.3', tested({ 'agentrouter:agentrouter/glm-5.3': true })), true);
  });
});
```

- [ ] **Step 2: Run; verify they fail.** Expected: source is `names` or `null` where `test` is expected; `gatewaySeatReadsImages('litellm', …)` returns false for unknown (undefined policy).

- [ ] **Step 3: Implement.** In `visionResolver.ts`:

1. `export type VisionSource = 'route' | 'provider' | 'test' | 'names';` and update its comment (`override` joins in phase 4).
2. Add to `VisionFacts`:

```ts
  /** A saved one-time image test result (visionCapabilityStore), for a ROUTED id; undefined = never tested. */
  testedVision?: (provider: string, routedModel: string) => boolean | undefined;
```

3. Add below `fromNames`:

```ts
/** A saved test result, then the name list. The test ranks first: it asked this very model. */
function fromTestThenNames(q: VisionQuery, facts: VisionFacts): VisionVerdict {
  const tested = facts.testedVision?.(q.provider, q.model || '');
  if (tested !== undefined) return answer(tested, 'test');
  return fromNames(q.model || '', false);
}
```

4. In `resolveVision`, replace the three `return fromNames(model, false);` in the `ninerouter` case, the `openrouter` case and `default:` with `return fromTestThenNames(q, facts);`.
5. Extend the seat map and its comment:

```ts
const SEAT_ON_UNKNOWN = { ninerouter: true, openrouter: true, litellm: true, nvidia_nim: true, fluxion: true, agentrouter: false } as const;
```

- [ ] **Step 4: Rebuild and run, with the phase 1 and 2 suites.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionResolver2026_10_01.test.mjs electron/llm/__tests__/OpenRouterVisionData2026_10_01.test.mjs electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs`. Expected: PASS; the characterization unchanged.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionResolver.ts electron/llm/__tests__/VisionResolver2026_10_01.test.mjs
git commit -m "feat(vision): the resolver ranks a one-time test result after provider data, before names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The probe engine

**Files:**
- Create: `electron/llm/visionProbe.ts`
- Test: `electron/llm/__tests__/VisionProbe2026_10_01.test.mjs`

**Interfaces:**
- Consumes: `newVisionTestNumber`, `renderDigitsPng` (Task 2); `judgeProbeReply`, `judgeProbeError`, `ProbeOutcome` (Task 1); `VisionQuery` (visionResolver).
- Produces:

```ts
export const VISION_PROBE_QUESTION: string;
export const VISION_PROBE_SYSTEM: string;
export interface VisionProbeDeps {
  /** Ask the model through Natively's own adapter. Throws on any refusal or failure. */
  ask: (selection: VisionQuery, imagePath: string, signal: AbortSignal) => AsyncIterable<string>;
  writeImage: (png: Buffer) => string;
  removeImage: (imagePath: string) => void;
  recorded: (selection: VisionQuery) => { reads: boolean; at: number } | undefined;
  record: (selection: VisionQuery, reads: boolean) => void;
  keyOf: (selection: VisionQuery) => string;
  now?: () => number; random?: () => number; log?: (message: string) => void;
  timeoutMs?: number; retryMs?: number; staleMs?: number;
}
export class VisionProbe {
  constructor(deps: VisionProbeDeps);
  /** A fresh saved result, or run the test (one at a time per model). `force` ignores freshness and backoff. */
  ensure(selection: VisionQuery, opts?: { force?: boolean }): Promise<ProbeOutcome>;
}
```

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The one-time image test's engine (2026-10-01), with every dependency
 * injected: no network, no disk, no clock.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { VisionProbe } = require(dist('llm/visionProbe.js'));

const SEL = { provider: 'fluxion', model: 'fluxion/glm-5.3' };

/** A probe whose model replies come from `replies` (strings, Errors, or functions of the number shown). */
function rig(replies, extra = {}) {
  const state = { asks: [], images: new Set(), removed: 0, saved: new Map(), clock: 1_000_000, numbers: ['7392', '4816', '2057', '6630'] };
  let n = 0;
  const probe = new VisionProbe({
    ask: async function* (selection, imagePath, signal) {
      const shown = state.numbers[state.asks.length % state.numbers.length];
      state.asks.push({ selection, imagePath, shown });
      assert.ok(state.images.has(imagePath), 'the image exists while the model is asked');
      const r = replies[Math.min(state.asks.length - 1, replies.length - 1)];
      const value = typeof r === 'function' ? r(shown, signal) : r;
      if (value instanceof Promise) { yield await value; return; }
      if (value instanceof Error) throw value;
      for (const piece of String(value).match(/.{1,5}/gs) ?? []) yield piece;
    },
    writeImage: () => { const p = `/img/${n++}.png`; state.images.add(p); return p; },
    removeImage: (p) => { state.images.delete(p); state.removed += 1; },
    recorded: (s) => state.saved.get(`${s.provider}|${s.model}`),
    record: (s, reads) => state.saved.set(`${s.provider}|${s.model}`, { reads, at: state.clock }),
    keyOf: (s) => `${s.provider}|${s.model}`,
    now: () => state.clock,
    random: (() => { let i = 0; return () => (Number(state.numbers[i++ % state.numbers.length]) - 1000) / 9000 + 1e-9; })(),
    timeoutMs: 50, retryMs: 600_000, staleMs: 30 * 86_400_000,
    ...extra,
  });
  return { probe, state };
}
const shownBack = (shown) => `The number is ${shown}.`;

describe('a definite answer', () => {
  test('the model reads the number back: yes, saved, one request, image removed', async () => {
    const { probe, state } = rig([shownBack]);
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.deepEqual(state.saved.get('fluxion|fluxion/glm-5.3'), { reads: true, at: 1_000_000 });
    assert.equal(state.asks.length, 1);
    assert.equal(state.images.size, 0, 'no image left behind');
  });
  test('a recognised image refusal is an immediate no', async () => {
    const { probe, state } = rig([new Error('404 No endpoints found that support image input')]);
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 1);
    assert.equal(state.saved.get('fluxion|fluxion/glm-5.3').reads, false);
  });
  test('a real reply without the number is a no only after a second miss with a different number', async () => {
    const { probe, state } = rig(["Images aren't supported in this chat.", 'I cannot see any image.']);
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 2);
    assert.notEqual(state.asks[0].shown, state.asks[1].shown);
    assert.equal(state.saved.get('fluxion|fluxion/glm-5.3').reads, false);
  });
  test('one misread followed by a correct read is a yes', async () => {
    const { probe, state } = rig(['The number is 7892.', shownBack]);
    assert.equal(await probe.ensure(SEL), 'yes');
    assert.equal(state.asks.length, 2);
  });
});

describe('a transient failure is never an answer', () => {
  for (const [label, reply] of [
    ['an empty daily pool', new Error('402 Budget pool quota has been exhausted')],
    ['a rate limit', new Error('429 rate limit exceeded')],
    ['a server error', new Error('503 no available channel')],
    ['a content filter', new Error('400 content-blocked')],
    ['a bad key', new Error('401 unauthorized')],
    ['an empty reply', ''],
    ['a privacy block', new Error('Screenshots and current page data are disabled for cloud providers.')],
  ]) {
    test(`${label}: unknown, nothing saved`, async () => {
      const { probe, state } = rig([reply]);
      assert.equal(await probe.ensure(SEL), 'unknown');
      assert.equal(state.saved.size, 0);
      assert.equal(state.images.size, 0);
    });
  }
  test('a model that never answers times out as unknown, and the request is aborted', async () => {
    let aborted = false;
    const { probe, state } = rig([(_shown, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => { aborted = true; resolve(''); }); })]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(aborted, true);
    assert.equal(state.saved.size, 0);
  });
  test('a miss followed by a transient failure stays unknown', async () => {
    const { probe, state } = rig(['I cannot see an image.', new Error('429 rate limit')]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(state.saved.size, 0);
  });
  test('after unknown, the next attempt waits for the backoff; force skips it', async () => {
    const { probe, state } = rig([new Error('429 rate limit'), shownBack]);
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(await probe.ensure(SEL), 'unknown');
    assert.equal(state.asks.length, 1, 'no second request inside the backoff');
    state.clock += 600_001;
    assert.equal(await probe.ensure(SEL), 'yes');
    const again = rig([new Error('429 rate limit'), shownBack]);
    await again.probe.ensure(SEL);
    assert.equal(await again.probe.ensure(SEL, { force: true }), 'yes');
  });
});

describe('once per model', () => {
  test('a fresh saved result is returned without asking', async () => {
    const { probe, state } = rig([shownBack]);
    state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: state.clock - 1000 });
    assert.equal(await probe.ensure(SEL), 'no');
    assert.equal(state.asks.length, 0);
  });
  test('a result older than 30 days is tested again; force also re-tests', async () => {
    const { probe, state } = rig([shownBack]);
    state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: state.clock - 31 * 86_400_000 });
    assert.equal(await probe.ensure(SEL), 'yes');
    const forced = rig([shownBack]);
    forced.state.saved.set('fluxion|fluxion/glm-5.3', { reads: false, at: forced.state.clock });
    assert.equal(await forced.probe.ensure(SEL, { force: true }), 'yes');
  });
  test('concurrent callers share one test', async () => {
    const { probe, state } = rig([shownBack]);
    const [a, b] = await Promise.all([probe.ensure(SEL), probe.ensure(SEL)]);
    assert.deepEqual([a, b], ['yes', 'yes']);
    assert.equal(state.asks.length, 1);
  });
  test('different models are tested separately', async () => {
    const { probe, state } = rig([shownBack]);
    await Promise.all([probe.ensure(SEL), probe.ensure({ provider: 'fluxion', model: 'fluxion/other' })]);
    assert.equal(state.asks.length, 2);
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Expected: `Cannot find module …/visionProbe.js`.

- [ ] **Step 3: Implement `electron/llm/visionProbe.ts`.**

```ts
// electron/llm/visionProbe.ts
//
// The one-time image test (design: docs/plans/2026-10-01-vision-capability-design.md,
// phase 3): show a model a generated image of a random number, ask what it
// shows, and save whether the number came back. Pure — the adapter call, the
// disk and the clock are injected — so the rules below are tested without a
// network.
//
// The rules that matter:
//   • A transient failure is never an answer. Only a recognised image refusal,
//     or TWO real replies without the number (two different numbers), is "no".
//     One misread must not block a capable model for a month.
//   • One test at a time per model; a fresh saved result is returned without
//     asking; an unknown is retried only after a backoff.

import type { VisionQuery } from './visionResolver';
import { judgeProbeError, judgeProbeReply, type ProbeOutcome } from './visionProbeOutcome';
import { newVisionTestNumber, renderDigitsPng } from './visionTestImage';

// Worded like a person asking, on purpose: AgentRouter's content filter rejects
// canned probe text ("Say X") before authentication is even checked.
export const VISION_PROBE_QUESTION = 'What number is shown in this image?';
export const VISION_PROBE_SYSTEM = 'Answer with the number only.';

const DEFAULT_TIMEOUT_MS = 45_000;            // GPT-6 Astra's first token takes 8–13 s
const DEFAULT_RETRY_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPLY_CHARS = 600;

export interface VisionProbeDeps {
  /** Ask the model through Natively's own adapter. Throws on any refusal or failure. */
  ask: (selection: VisionQuery, imagePath: string, signal: AbortSignal) => AsyncIterable<string>;
  writeImage: (png: Buffer) => string;
  removeImage: (imagePath: string) => void;
  recorded: (selection: VisionQuery) => { reads: boolean; at: number } | undefined;
  record: (selection: VisionQuery, reads: boolean) => void;
  keyOf: (selection: VisionQuery) => string;
  now?: () => number;
  random?: () => number;
  log?: (message: string) => void;
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

interface Attempt { outcome: ProbeOutcome; refused: boolean; number: string }

export class VisionProbe {
  private readonly inFlight = new Map<string, Promise<ProbeOutcome>>();
  private readonly lastUnknownAt = new Map<string, number>();

  constructor(private readonly deps: VisionProbeDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** A fresh saved result, or run the test (one at a time per model). `force` ignores freshness and backoff. */
  ensure(selection: VisionQuery, opts: { force?: boolean } = {}): Promise<ProbeOutcome> {
    const key = this.deps.keyOf(selection);
    const running = this.inFlight.get(key);
    if (running) return running;
    if (!opts.force) {
      const saved = this.deps.recorded(selection);
      if (saved && this.now() - saved.at < (this.deps.staleMs ?? DEFAULT_STALE_MS)) return Promise.resolve(saved.reads ? 'yes' : 'no');
      const failedAt = this.lastUnknownAt.get(key);
      if (failedAt !== undefined && this.now() - failedAt < (this.deps.retryMs ?? DEFAULT_RETRY_MS)) return Promise.resolve('unknown');
    }
    const run = this.run(selection, key).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, run);
    return run;
  }

  private async run(selection: VisionQuery, key: string): Promise<ProbeOutcome> {
    const first = await this.attempt(selection, null);
    let outcome: ProbeOutcome = first.outcome;
    // A reply without the number could be one misread: confirm with another number.
    if (first.outcome === 'no' && !first.refused) {
      const second = await this.attempt(selection, first.number);
      outcome = second.outcome === 'yes' ? 'yes' : second.outcome === 'no' ? 'no' : 'unknown';
    }
    if (outcome === 'unknown') {
      this.lastUnknownAt.set(key, this.now());
    } else {
      this.lastUnknownAt.delete(key);
      this.deps.record(selection, outcome === 'yes');
    }
    this.deps.log?.(`[VisionProbe] ${key}: ${outcome}`);
    return outcome;
  }

  private async attempt(selection: VisionQuery, avoid: string | null): Promise<Attempt> {
    let number = newVisionTestNumber(this.deps.random);
    if (number === avoid) number = String(1000 + ((Number(number) - 1000 + 4567) % 9000));
    const imagePath = this.deps.writeImage(renderDigitsPng(number));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      let reply = '';
      for await (const piece of this.deps.ask(selection, imagePath, controller.signal)) {
        reply += piece;
        if (judgeProbeReply(reply, number) === 'yes' || reply.length >= MAX_REPLY_CHARS) break;
      }
      if (controller.signal.aborted) return { outcome: 'unknown', refused: false, number };
      return { outcome: judgeProbeReply(reply, number), refused: false, number };
    } catch (err) {
      if (controller.signal.aborted) return { outcome: 'unknown', refused: false, number };
      const judged = judgeProbeError(err);
      return { outcome: judged, refused: judged === 'no', number };
    } finally {
      clearTimeout(timer);
      controller.abort(); // stop a stream we broke out of early
      try { this.deps.removeImage(imagePath); } catch { /* best effort */ }
    }
  }
}
```

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionProbe2026_10_01.test.mjs`. Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionProbe.ts electron/llm/__tests__/VisionProbe2026_10_01.test.mjs
git commit -m "feat(vision): the one-time image test engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Asking through Natively's own adapters

**Files:**
- Modify: `electron/LLMHelper.ts`
- Modify: `electron/ProcessingHelper.ts` (before `this.llmHelper.setModel(defaultModel, allProviders)`)
- Test: `electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs`

**Interfaces:**
- Consumes: `VisionProbe`, `VISION_PROBE_QUESTION`, `VISION_PROBE_SYSTEM` (Task 5); `storedVisionTest`, `normalizeVisionBaseURL`, `getVisionCapabilityStore` (Task 3).
- Produces (all on `LLMHelper`):
  - `private async *openDirectProviderStream(args: { provider: DirectAssistProvider; model: string; userPrompt: string; systemPrompt: string; imagePaths: string[]; custom: CustomProvider | null; curl: CurlProvider | null; providerIsLocal: boolean }, abortSignal?: AbortSignal): AsyncGenerator<string, void, unknown>`
  - `public enableVisionProbing(): void`
  - `private visionStoreBaseURL(provider: string): string`
  - `private maybeProbeSelectedVision(opts?: { force?: boolean }): void`
  - `private getVisionProbe(): VisionProbe`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The one-time image test, wired into LLMHelper (2026-10-01): asked through
 * the same adapter a real screenshot uses, only when it should be, and without
 * touching anything a real answer records.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));

let store;
beforeEach(() => { store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store); });

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '', ollamaModel: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [],
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => [], onModelError: () => { throw new Error('a probe must never trigger discovery'); } },
    directProviderHasCredential: () => true,
    ...state,
  });
  return h;
}
/** Adapters stubbed to read the test image and answer with the digits they can "see" in its file name. */
function withAdapters(h, reply) {
  const seen = [];
  const adapter = (name) => async function* (_prompt, _system, imagePaths) {
    seen.push({ name, imagePaths: [...(imagePaths || [])], existed: (imagePaths || []).every((p) => fs.existsSync(p)) });
    const r = typeof reply === 'function' ? reply(name) : reply;
    if (r instanceof Error) throw r;
    yield r;
  };
  for (const name of ['streamWithFluxion', 'streamWithAgentRouter', 'streamWithOpenRouter', 'streamWithLiteLLM', 'streamWithNvidiaNim', 'streamWithNinerouter']) h[name] = adapter(name);
  h.streamWithOpenaiMultimodal = async function* (_prompt, imagePaths) { seen.push({ name: 'streamWithOpenaiMultimodal', imagePaths: [...imagePaths], existed: imagePaths.every((p) => fs.existsSync(p)) }); const r = typeof reply === 'function' ? reply('openai') : reply; if (r instanceof Error) throw r; yield r; };
  return seen;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('setModel starts a test only when it should', () => {
  test('an unknown Fluxion model is asked once through the Fluxion adapter, with a real image file, then cleaned up', async () => {
    const h = helper(); h.enableVisionProbing();
    const seen = withAdapters(h, new Error('404 No endpoints found that support image input'));
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].name, 'streamWithFluxion');
    assert.equal(seen[0].existed, true, 'the adapter was handed a file that exists');
    assert.equal(fs.existsSync(seen[0].imagePaths[0]), false, 'and it is removed afterwards');
    assert.deepEqual(store.tested('fluxion', '', 'glm-5.3')?.reads, false);
  });
  test('probing is off until enabled: tests and benchmarks never send one by accident', async () => {
    const h = helper(); const seen = withAdapters(h, 'x');
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 0);
  });
  for (const [label, model] of [
    ['a model the name list already knows', 'fluxion/claude-opus-5'],
    ['a direct DeepSeek model (its adapter carries no image)', 'deepseek-v4-flash'],
    ['a Groq model (its own table decides)', 'llama-3.3-70b-versatile'],
    ['Natively', 'natively'],
  ]) {
    test(`${label}: no test`, async () => {
      const h = helper(); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
      h.setModel(model);
      await settle();
      assert.equal(seen.length, 0);
    });
  }
  test('a model already tested this month is not asked again', async () => {
    const h = helper(); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
    store.recordTest('fluxion', '', 'glm-5.3', true);
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 0);
  });
  test('no credential, provider switched off, or screenshots not allowed out: nothing is sent', async () => {
    for (const state of [
      { directProviderHasCredential: () => false },
      { isProviderDisabled: (p) => p === 'fluxion' },
      { getDeniedOutboundScopes: () => ['screenshots'] },
      { assertOutboundImagesAllowed: () => { throw new Error('private vision'); } },
    ]) {
      const h = helper(state); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
      h.setModel('fluxion/glm-5.3');
      await settle();
      assert.equal(seen.length, 0, JSON.stringify(Object.keys(state)));
      assert.equal(store.tested('fluxion', '', 'glm-5.3'), undefined);
    }
  });
  test('a self-hosted proxy is keyed by its address, spelled one way', async () => {
    const h = helper({ litellmBaseURL: 'http://localhost:4000/v1/' }); h.enableVisionProbing();
    withAdapters(h, new Error('this model does not support image input'));
    h.setModel('litellm/internal-model');
    await settle();
    assert.equal(store.tested('litellm', 'http://localhost:4000', 'internal-model')?.reads, false);
  });
});

describe('a test leaves no trace in what real answers record', () => {
  test('no vision health entry, no discovery', async () => {
    const h = helper(); h.enableVisionProbing();
    withAdapters(h, new Error('404 No endpoints found that support image input'));
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(h.visionHealth.size, 0);
  });
});

describe('Direct Assist still dispatches through the same adapters after the extraction', () => {
  test('openDirectProviderStream routes each provider to its adapter with the model it was given', async () => {
    const h = helper(); const seen = withAdapters(h, 'ok');
    for (const [provider, model, expected] of [['fluxion', 'fluxion/a', 'streamWithFluxion'], ['agentrouter', 'agentrouter/a', 'streamWithAgentRouter'], ['openrouter', 'openrouter/a/b', 'streamWithOpenRouter'], ['litellm', 'litellm/a', 'streamWithLiteLLM'], ['openai', 'gpt-x', 'streamWithOpenaiMultimodal']]) {
      for await (const _ of h.openDirectProviderStream({ provider, model, userPrompt: 'u', systemPrompt: 's', imagePaths: ['/tmp/x.png'], custom: null, curl: null, providerIsLocal: false })) { /* drain */ }
      assert.equal(seen.at(-1).name, expected, provider);
    }
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Expected: `h.enableVisionProbing is not a function`.

- [ ] **Step 3: Implement in `electron/LLMHelper.ts`.**

1. **Extract the dispatcher.** In `streamDirectAssistFrozen`, cut the whole `switch (provider) { … }` (from the comment `// Every branch yields from one exact adapter and returns.` to the switch's closing brace) and replace it with:

```ts
    yield* this.openDirectProviderStream({
      provider, model, userPrompt: directUserPrompt, systemPrompt: request.systemPrompt,
      imagePaths, custom, curl, providerIsLocal: directProviderIsLocal,
    }, abortSignal);
```

Paste the switch into a new method directly below `streamDirectAssistFrozen`. Rename inside it: `directUserPrompt` → `args.userPrompt`, `request.systemPrompt` → `args.systemPrompt`, `directProviderIsLocal` → `args.providerIsLocal`; destructure `const { provider, model, imagePaths, custom, curl } = args;`. Each `return;` after a `yield*` stays.

```ts
  /**
   * One exact adapter for one provider and model: no race, no ladder, no
   * recovery. Direct Assist dispatches through it after its own gates, and the
   * one-time vision test (visionProbe.ts) asks through it too, so a passed test
   * means a real screenshot takes the same path.
   */
  private async *openDirectProviderStream(
    args: {
      provider: DirectAssistProvider; model: string; userPrompt: string; systemPrompt: string;
      imagePaths: string[]; custom: CustomProvider | null; curl: CurlProvider | null; providerIsLocal: boolean;
    },
    abortSignal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const { provider, model, imagePaths, custom, curl } = args;
    // …the switch, unchanged apart from the three renames…
  }
```

2. **Imports.** Add `import { VisionProbe, VISION_PROBE_QUESTION, VISION_PROBE_SYSTEM } from "./llm/visionProbe"`, extend the visionCapabilityStore import with `normalizeVisionBaseURL, storedVisionTest`, and make sure `os` and `crypto` are imported (`grep -n "^import os\|^import crypto\|from 'node:os'\|from \"os\"\|from \"crypto\"" electron/LLMHelper.ts`).

3. **Fields**, next to the OpenRouter vision fields:

```ts
  // The one-time image test (2026-10-01). Off until enableVisionProbing():
  // ProcessingHelper turns it on at startup, so a test or benchmark that builds
  // an LLMHelper never sends a probe by accident.
  private visionProbingEnabled = false
  private visionProbe: VisionProbe | null = null
```

4. **Methods**, next to `visionFacts`:

```ts
  /** Providers the one-time test can ask. The rest are decided by their route, their own table, or /api/show. */
  private static readonly VISION_TESTABLE: ReadonlySet<string> = new Set(
    ['openai', 'claude', 'gemini', 'nvidia_nim', 'openrouter', 'fluxion', 'agentrouter', 'litellm', 'ninerouter'],
  );

  public enableVisionProbing(): void { this.visionProbingEnabled = true; }

  /** The address a self-hosted provider's answers are saved under; '' for hosted services. */
  private visionStoreBaseURL(provider: string): string {
    if (provider === 'litellm') return normalizeVisionBaseURL(this.litellmBaseURL);
    if (provider === 'ninerouter') return normalizeVisionBaseURL(this.ninerouterBaseURL);
    return '';
  }

  private getVisionProbe(): VisionProbe {
    if (this.visionProbe) return this.visionProbe;
    const wire = (s: { provider: string; model: string }) => s.model.startsWith(`${s.provider}/`) ? s.model.slice(s.provider.length + 1) : s.model;
    this.visionProbe = new VisionProbe({
      ask: (selection, imagePath, signal) => this.askForVisionProbe(selection, imagePath, signal),
      writeImage: (png) => {
        const file = path.join(os.tmpdir(), `natively-vision-test-${crypto.randomBytes(8).toString('hex')}.png`);
        fs.writeFileSync(file, png);
        return file;
      },
      removeImage: (file) => { fs.rmSync(file, { force: true }); },
      recorded: (s) => getVisionCapabilityStore().tested(s.provider, this.visionStoreBaseURL(s.provider), wire(s)),
      record: (s, reads) => getVisionCapabilityStore().recordTest(s.provider, this.visionStoreBaseURL(s.provider), wire(s), reads),
      keyOf: (s) => `${s.provider}|${this.visionStoreBaseURL(s.provider)}|${wire(s)}`,
      log: (m) => console.log(m),
    });
    return this.visionProbe;
  }

  /**
   * The test's one request: the same gates a real screenshot passes (provider
   * switched off, private-vision mode, the screenshots scope), then the exact
   * adapter for this provider and model. It calls the adapter directly, below
   * the layers that write usage, latency, vision health or model discovery.
   */
  private async *askForVisionProbe(
    selection: { provider: DirectAssistProvider; model: string }, imagePath: string, signal: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    if (this.isProviderDisabled(selection.provider)) throw new ProviderDisabledError(selection.provider);
    this.assertOutboundImagesAllowed(selection.provider, true);
    if (this.getDeniedOutboundScopes(VISION_PROBE_QUESTION, [imagePath], []).includes('screenshots')) {
      throw new Error('Screenshots are not allowed to leave this device.');
    }
    yield* this.openDirectProviderStream({
      provider: selection.provider, model: selection.model, userPrompt: VISION_PROBE_QUESTION,
      systemPrompt: VISION_PROBE_SYSTEM, imagePaths: [imagePath], custom: null, curl: null, providerIsLocal: false,
    }, signal);
  }

  /**
   * Test the selected model once, in the background, when nothing yet says
   * whether it reads images (or its saved test is over 30 days old — the probe
   * decides freshness). Never awaited: the answer path does not wait on it.
   */
  private maybeProbeSelectedVision(opts: { force?: boolean } = {}): void {
    if (!this.visionProbingEnabled) return;
    let selection: DirectAssistSelection;
    try { selection = this.getDirectAssistSelection(); } catch { return; }
    if (!LLMHelper.VISION_TESTABLE.has(selection.provider)) return;
    if (!this.directProviderHasCredential(selection.provider) || this.isProviderDisabled(selection.provider)) return;
    const verdict = this.visionVerdict(selection);
    if (!opts.force && verdict.reads !== 'unknown' && verdict.source !== 'test') return;
    try {
      this.assertOutboundImagesAllowed(selection.provider, true);
      if (this.getDeniedOutboundScopes(VISION_PROBE_QUESTION, ['probe.png'], []).includes('screenshots')) return;
    } catch { return; }
    void this.getVisionProbe().ensure(selection, opts).catch(() => { /* a probe never surfaces an error */ });
  }
```

5. **Facts.** In `visionFacts`, replace the `providerReportsVision` line with:

```ts
      providerReportsVision: (provider, routed) => storedVisionAnswer(provider, routed, this.visionStoreBaseURL(provider)),
      testedVision: (provider, routed) => storedVisionTest(provider, routed, this.visionStoreBaseURL(provider))?.reads,
```

6. **Trigger.** In `setModel`, after the OpenRouter refresh line, add `this.maybeProbeSelectedVision();`.

In `electron/ProcessingHelper.ts`, immediately before `this.llmHelper.setModel(defaultModel, allProviders);`:

```ts
      // The one-time image test may run for the saved selection (2026-10-01):
      // keys are hydrated above, and the capability store is already configured.
      this.llmHelper.enableVisionProbing();
```

(If the `setModel` call sits inside an `if (defaultModel)`, put `enableVisionProbing()` just before that `if`, so a later selection is tested too.)

- [ ] **Step 4: Rebuild and run, with the Direct Assist suites (the extraction must change nothing).**

Run: `npm run build:electron && node --test electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs electron/services/__tests__/NinerouterDirectAssist2026_09_21.test.mjs electron/services/__tests__/DirectAssistIpcBridge2026_08_29.test.mjs electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/ProcessingHelper.ts electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs
git commit -m "feat(vision): test an unknown model once, in the background, through its own adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Seats follow a test result; a refused screenshot re-tests

**Files:**
- Modify: `electron/LLMHelper.ts`: the LiteLLM / NVIDIA NIM / Fluxion chain seats, the Direct Assist gateway group, the chain's hooks, and `refreshLitellmModelBudgets`.
- Modify: `electron/llm/streamFallbackEngine.ts`: the `onNoVision` hook.
- Modify: `electron/services/screen/VisionProviderRegistry.ts`: six rungs.
- Test: `electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs` (append)

**Interfaces:**
- Consumes: `gatewaySeatReadsImages` (Task 4), `visionFacts`, `maybeProbeSelectedVision` (Task 6).
- Produces: `FallbackHooks.onNoVision?: (providerId: string, providerName: string, err: any) => void`.

- [ ] **Step 1: Write the failing tests.** Append:

```js
describe('a saved test result decides the seat (phase 3)', () => {
  async function chain(model, extra = {}) {
    const opened = [];
    const stub = (name) => async function* () { opened.push(name); yield 'ok'; };
    const h = helper({
      currentModelId: model, client: {}, openaiClient: null, claudeClient: null, groqClient: null,
      litellmClient: {}, nvidiaNimClient: {}, hasFluxionCredential: () => true, hasAgentRouterCredential: () => true,
      codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null, hasNatively: () => false,
      streamWithLiteLLM: stub('litellm'), streamWithNvidiaNim: stub('nvidia_nim'), streamWithFluxion: stub('fluxion'),
      streamWithAgentRouter: stub('agentrouter'), streamWithGeminiModel: stub('gemini'), ...extra,
    });
    for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ }
    return opened;
  }
  for (const [provider, model, base] of [['fluxion', 'fluxion/glm-5.3', ''], ['nvidia_nim', 'nvidia_nim/meta/text-model', ''], ['litellm', 'litellm/internal-model', 'http://localhost:4000']]) {
    test(`${provider}: tested "no" → another provider answers; untested → the selected model still leads`, async () => {
      assert.equal((await chain(model))[0], provider, 'untested: seated as before');
      store.recordTest(provider, base, model.slice(provider.length + 1), false);
      const opened = await chain(model);
      assert.ok(!opened.includes(provider), `opened: ${opened}`);
      assert.equal(opened[0], 'gemini');
    });
  }
  test('AgentRouter: an unknown model is not seated until its test says yes', async () => {
    assert.ok(!(await chain('agentrouter/glm-5.3')).includes('agentrouter'));
    store.recordTest('agentrouter', '', 'glm-5.3', true);
    assert.equal((await chain('agentrouter/glm-5.3'))[0], 'agentrouter');
  });
  test('Direct Assist: a gateway model tested "no" is refused; untested still forwards; a direct model tested "yes" forwards', () => {
    const h = helper();
    assert.equal(h.directSelectionSupportsImages({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, null, null), true);
    store.recordTest('fluxion', '', 'glm-5.3', false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, null, null), false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openai', model: 'gpt-next-unknown' }, null, null), false);
    store.recordTest('openai', '', 'gpt-next-unknown', true);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openai', model: 'gpt-next-unknown' }, null, null), true);
  });
});

describe('a real screenshot refused as image-unsupported re-tests the model', () => {
  test('the engine reports it, and the chain forces a re-test of the selection', async () => {
    const { runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } = require(dist('llm/visionStreamFallback.js'));
    const reported = [];
    const refuse = { id: 'fluxion', name: 'Fluxion (glm-5.3)', isLocal: false, priority: 0, open: async function* () { throw new Error('this model does not support image input'); } };
    const ok = { id: 'gemini_flash', name: 'Gemini', isLocal: false, priority: 1, open: async function* () { yield 'ok'; } };
    for await (const _ of runStreamingVisionFallback([refuse, ok], { ...DEFAULT_VISION_FALLBACK_CONFIG, hedgeEnabled: false }, new Map(), { onNoVision: (id) => reported.push(id), sleep: async () => {} })) { /* drain */ }
    assert.deepEqual(reported, ['fluxion']);
  });
  test('registry rungs pass the test fact', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
    for (const fn of ['litellm', 'nvidiaNim', 'fluxion', 'agentrouter', 'ninerouter', 'openrouter']) {
      const start = src.indexOf(`function ${fn}(`);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      assert.match(body, /gatewaySeatReadsImages\(/, fn);
      assert.match(body, /registryVisionFacts\(/, fn);
    }
  });
});

describe("LiteLLM's supports_vision", () => {
  test('only true is saved; false and missing stay unknown', async () => {
    const h = helper({ litellmBaseURL: 'http://localhost:4000/v1', litellmApiKey: 'k', litellmModelBudgetsFetchedAt: 0, litellmModelBudgetsFetch: null, litellmModelBudgets: new Map(), litellmModelInputCaps: new Map() });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
      { model_name: 'internal-mm', model_info: { supports_vision: true } },
      { model_name: 'plain', model_info: { supports_vision: false } },
      { model_name: 'unset', model_info: {} },
    ] }) });
    try { await h.refreshLitellmModelBudgets(); } finally { globalThis.fetch = realFetch; }
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'internal-mm'), true);
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'plain'), undefined);
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'unset'), undefined);
    assert.equal(h.getCapabilities.call(helper({ currentModelId: 'litellm/internal-mm', litellmBaseURL: 'http://localhost:4000/v1' })).supportsImages, true);
  });
});
```

- [ ] **Step 2: Run; verify they fail.** Expected: Fluxion/NIM/LiteLLM are still seated after a "no"; Direct Assist still forwards; `onNoVision` is never called; the registry and LiteLLM tests fail.

- [ ] **Step 3: Implement.**

`electron/llm/streamFallbackEngine.ts`:
- Add to `FallbackHooks`:

```ts
  /** A provider refused the image as unsupported. Notification only. */
  onNoVision?: (providerId: string, providerName: string, err: any) => void;
```

- Beside `const onModelGone = hooks.onModelGone ?? (() => { });` add `const onNoVision = hooks.onNoVision ?? (() => { });`.
- In the `} else if (cls === 'no_vision' || cls === 'payload') {` branch, as its first statement: `if (cls === 'no_vision') { try { onNoVision(provider.id, provider.name, err); } catch { /* notification only */ } }`.

`electron/LLMHelper.ts`:
- **Chain seats.** Replace the three conditions:
  - `if (this.isLiteLLMModel(this.currentModelId) && this.litellmClient) {` → append `&& gatewaySeatReadsImages('litellm', this.currentModelId, this.visionFacts({ provider: 'litellm', model: this.currentModelId }))` inside the `if`.
  - Same for `nvidia_nim` (`isNvidiaNimModel && nvidiaNimClient`) and `fluxion` (`isFluxionModel && hasFluxionCredential()`).
  - `agentRouterModelSupportsVision` and `ninerouterModelSupportsVision`: pass `this.visionFacts({ provider, model: modelId })` as the facts argument (keeping the 9Router catalogue in it), so a test result reaches them.

  Above the LiteLLM seat add one comment: `// A model tested as text-only is not seated (2026-10-01); untested seats as before.`
- **At the top of `streamVisionWithFallback`** (after the `tiers` setup): `this.maybeProbeSelectedVision();` with the comment `// Still unknown (a test that hit a transient failure)? Try again in the background; a no-op when known or backing off.`
- **Hooks.** In the `runStreamingVisionFallback` hooks object, add:

```ts
        // A real screenshot refused as image-unsupported contradicts whatever
        // said this model reads images: test it again now (2026-10-01).
        onNoVision: (id) => {
          const selected = (() => { try { return this.getDirectAssistSelection().provider; } catch { return null; } })();
          if (id === selected) this.maybeProbeSelectedVision({ force: true });
        },
```

- **Direct Assist.** In `directSelectionSupportsImages`, replace the grouped gateway cases' `return true;` (the group now is `litellm`, `nvidia_nim`, `fluxion`, `agentrouter`, `ninerouter`) with:

```ts
        // …and since 2026-10-01 a model TESTED as text-only (or catalogued so)
        // is refused with Direct Assist's own clear message. Untested still
        // forwards, for the reason above.
        return readsImages(this.visionVerdict(selection, custom, curl), true);
```

- **LiteLLM.** In `refreshLitellmModelBudgets`, declare `const freshVision = new Map<string, boolean>();` beside `freshInput`; inside the loop add:

```ts
          // Only `true` is trustworthy: absence and `false` also mean the admin
          // never set it (LiteLLM docs, model_info.supports_vision).
          if (name && entry?.model_info?.supports_vision === true) freshVision.set(name, true);
```

  and after `this.litellmModelInputCaps = freshInput;` add `getVisionCapabilityStore().replaceProviderAnswers('litellm', normalizeVisionBaseURL(issuedForBaseURL), freshVision);`.
- **Resolver.** In `visionResolver.ts`, add a `litellm` case before `default:`:

```ts
    // LiteLLM's /model/info can say `supports_vision: true`; nothing there means "no".
    case 'litellm': {
      if (facts.providerReportsVision?.('litellm', model) === true) return answer(true, 'provider');
      return fromTestThenNames(q, facts);
    }
```

`electron/services/screen/VisionProviderRegistry.ts`:
- Import `storedVisionTest, normalizeVisionBaseURL` (extend the existing import) and add near the helpers:

```ts
/** The saved facts both screenshot paths read (provider catalogues and one-time tests). */
function registryVisionFacts(baseURL = '', extra: { ninerouterVisionModels?: readonly string[] } = {}) {
  return {
    ...extra,
    providerReportsVision: (p: string, m: string) => storedVisionAnswer(p, m, baseURL),
    testedVision: (p: string, m: string) => storedVisionTest(p, m, baseURL)?.reads,
  };
}
```

- `litellm()`: `supportsVision: !!baseURL && isSelected && gatewaySeatReadsImages('litellm', modelId, registryVisionFacts(normalizeVisionBaseURL(baseURL))),`
- `nvidiaNim()`: `supportsVision: !!apiKey && isSelected && gatewaySeatReadsImages('nvidia_nim', modelId, registryVisionFacts()),`
- `fluxion()`: the same with `'fluxion'`.
- `openrouter()`: replace its inline facts object with `registryVisionFacts()`.
- `ninerouter()`: `gatewaySeatReadsImages('ninerouter', modelId, registryVisionFacts(normalizeVisionBaseURL(baseURL), { ninerouterVisionModels: creds.getNinerouterVisionModels?.() || [] }))`.
- `agentrouter()`: `isSelected && gatewaySeatReadsImages('agentrouter', activeModelId, registryVisionFacts())`.

- [ ] **Step 4: Rebuild and run every vision suite.**

Run:
```bash
npm run build:electron && git grep -z -l -E "supportsImages|visionCapability|gatewaySeatReadsImages|streamVisionWithFallback|VisionProbe|directSelectionSupportsImages" -- 'electron/**/__tests__/*.test.mjs' | xargs -0 node --test
```
Expected: PASS; the characterization still 0 lost / 177 gained.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/llm/streamFallbackEngine.ts electron/llm/visionResolver.ts electron/services/screen/VisionProviderRegistry.ts electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs
git commit -m "feat(vision): a model tested as text-only stops getting screenshots; a refusal re-tests it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Live check, docs, validation, landing

**Files:**
- Modify: `docs/plans/2026-10-01-vision-capability-design.md`: section 2, delivery items 3 and 5, the known-gap note.
- Modify: `electron/llm/CodeHintLLM.ts`: the known-gap comment.

- [ ] **Step 1: Live, through the real adapters, without launching the app.** Write `$SP/vp3-live.mjs`:
  - Stub `electron` the way the tests do, then build a real `LLMHelper` from the bundle.
  - Set the Gemini, OpenRouter and AgentRouter keys from `.env` through its setters (never printing them).
  - Call `enableVisionProbing()`, then force a probe per selection and print only the outcome and the saved result.

  Selections and expected outcomes:
  - `gemini-3.1-flash-lite` → yes
  - `openrouter/openai/gpt-4o-mini` → yes
  - `openrouter/deepseek/deepseek-v4-flash` → no (OpenRouter's image refusal)
  - `agentrouter/deepseek-v4-flash` → yes
  - `agentrouter/gpt-6-astra` → yes, or unknown if the daily pool is empty
  - `gpt-4o-mini` on the OpenAI key (no credits) → unknown

  Save the output to `$SP/vp3-live.txt`.

- [ ] **Step 2: Live, in the app (one instance; check `uptime` and `pgrep -fl "dev-agent|build-electron"` first).** Start `npm run dev:agent`; set the OpenRouter and Gemini keys over stdin; pick an OpenRouter model that the authenticated catalogue does not list (find one by comparing the fixture's ids with `.agent/userdata/vision-capabilities.json`), and `setModel` it. Expected: a `[VisionProbe] openrouter||<id>: yes|no` line, and a `tests` entry in `vision-capabilities.json`. Relaunch and `setModel` the same id: no second probe line. Stop the app through the launcher.

- [ ] **Step 3: Docs.**
  - **Design doc, section 2:** the test is built as designed, except "no" from a reply needs two misses.
  - **Delivery item 3:** done in 3a, apart from the DeepSeek adapter (3b).
  - **Delivery item 5:** gains "the on-the-spot test when nothing else can read the screenshot".
  - **Known gap:** closed for OpenRouter (catalogue), and for any LiteLLM / NVIDIA NIM / Fluxion model once tested. An untested selection behaves as before until its background test finishes.
  - **`CodeHintLLM.ts` comment:** the same correction.

- [ ] **Step 4: Full validation.** One at a time: `npm run typecheck:electron`, then `npm test` with the model weights linked in from the main checkout and unlinked afterwards (as in phases 1 and 2). Expected: 0 failures. Confirm nothing was left in `os.tmpdir()` matching `natively-vision-test-*.png` or `vision-capabilities.json`.

- [ ] **Step 5: Final review, then landing** with the same recipe as phases 1 and 2 (merge in a temp worktree, tree equals the tested branch, compare-and-swap, sync the root checkout, dirty set unchanged). Do not push.

- [ ] **Step 6: Completion report** (CLAUDE.md format):
  - `Tested physically on macOS`;
  - `Reviewed but not executed on Windows`, `Requires physical Windows verification`;
  - the live outcomes;
  - remaining risks: a provider whose refusal wording is not on the allow-list stays unknown rather than "no"; NVIDIA NIM, LiteLLM and Fluxion were not exercised live (no keys here).
