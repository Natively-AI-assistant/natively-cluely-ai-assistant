# Vision Capability Phase 1: One Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every "can this selection read a screenshot?" decision that phase 1 touches goes through one pure resolver, the name list is consolidated and corrected, and Code Hint stops refusing screenshots the vision chain would answer.

**Architecture:** A pure module, `electron/llm/visionResolver.ts`, answers `yes / no / unknown` plus a source, from facts the caller supplies (Ollama `/api/show` results, 9Router's catalogue, the active custom/cURL provider). LLMHelper and VisionProviderRegistry each supply their own facts and call the same functions, so they cannot drift. Until phase 3 adds the image test, each caller states what `unknown` means for it, and every caller keeps exactly its current behaviour. A characterization test over ~2,400 real model ids proves that.

**Tech Stack:** TypeScript (Electron main process), esbuild bundle in `dist-electron/`, `node:test` `.mjs` tests that `require` the built bundle.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (phase 1 of 5; read sections 1 and "Delivery").

## Global Constraints

- Natively ships on macOS and Windows. Phase 1 adds no OS-specific code, and no task may add a `process.platform` branch.
- A screenshot is never sent blind: no `unknown` or `no` answer may become a send where it was not one before.
- Phase 1 only widens. The characterization test forbids any answer going from "reads images" to "doesn't".
- Name-list additions must be verified this session (OpenAI model pages or OpenRouter `input_modalities`). Unverified ids stay out: `chatgpt-4o-latest`, `gpt-4.5*`, cloud `gemma-4*`, `mistral-small3.2`.
- API keys are never printed or put on argv. Scripts read `.env` themselves; renderer calls receive keys via `agent-browser eval --stdin`.
- Tests run against the built bundle: `npm run build:electron` before any `node --test`.
- Comments explain *why*, dated, in the surrounding style (see `modelCapabilities.ts`).
- Land on local `main` only (never push). Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Persisted cache: deferred to phase 2, where its first new writer (OpenRouter modalities) arrives. Phase 1 reads Ollama and 9Router answers where they are held today. Task 7 amends the design doc to say so.

## Review Focus

1. An Ollama tag in Hugging Face form (`hf.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M`) or the no-dash form Ollama actually publishes (`qwen2.5vl:7b`) must be recognised as vision. Tested in Task 2.
2. Dated or upper-case OpenAI ids (`o4-mini-2025-04-16`, `O3`) must read images; lookalikes (`o3-mini`, `o1-mini`, `gpt-4-turbo-preview`) must not. Tested in Task 2.
3. No usable selection (nothing selected, or an id with no adapter) must not make `getCapabilities()` throw; it keeps the name table's answer. Tested in Task 4.
4. A selected cURL provider: `getCapabilities()` used to classify its UUID. It must follow the template instead. Tested in Task 4.
5. Local-only mode with no local vision model must say so, not "add an OpenAI/Claude/Gemini/Groq key". Tested in Task 6.

## Consumer map: every vision decision, and its phase-1 fate

| Site | Today | Phase 1 |
|---|---|---|
| `CodeHintLLM.ts:34-47` pre-gate | names on the selected display string | **Removed**; the vision chain decides (Task 6) |
| `LLMHelper.getCapabilities()` `:14208` | names on `getCurrentModel()` (display string) | `supportsImages` from the resolver for `getDirectAssistSelection()`; tier and budgets unchanged (Task 4) |
| `LLMHelper.directSelectionSupportsImages` `:13795` | per-provider switch | gateways unchanged (`true`); everything else through the resolver, unknown→false; identical answers (Task 4) |
| `LLMHelper.ninerouterModelSupportsVision` `:2032` (used at `:4866`, `:8614`, `:10791`) | catalogue; empty = seat | `gatewaySeatReadsImages('ninerouter', …)`; identical (Task 4) |
| `LLMHelper.agentRouterModelSupportsVision` `:2433` (used at `:4882`, `:8637`, `:10733`) | names | `gatewaySeatReadsImages('agentrouter', …)`; identical (Task 4) |
| Chain custom seat `:8677` | `customProviderSupportsVision` | unchanged (the resolver uses the same predicate) |
| Chain Ollama seat, `resolveOllamaVisionModelForChain` | `/api/show` probe | unchanged (phase 5) |
| `probeOllama` `:3345` | `getModelCapabilities(model, true)` | code unchanged; answers widen with the consolidated list (Task 2) |
| Chain "nothing can read it" message `:8742` | generic "add an API key" | adds a local-only message (Task 6) |
| Registry `custom` `:274`, `isOllamaVisionModel` `:483` | shared predicates | unchanged |
| Registry `ninerouter()` `:356`, `agentrouter()` `:462` | own copies of the rules | `gatewaySeatReadsImages` (Task 5) |
| `performance/capabilityView.ts:63` | names + Groq table | unchanged (reads names) |
| `CredentialsManager.ts:1445/1469` | custom predicate | unchanged |
| `ModelVersionManager.ts:349` | Groq tier classification, not a gate | unchanged |

## File structure

- Create `electron/llm/visionResolver.ts`: the resolver, `readsImages`, `gatewaySeatReadsImages`. Pure: no SDK, fs or Electron imports.
- Modify `electron/llm/modelCapabilities.ts`: one Ollama list, OpenAI additions, `models/` prefix.
- Modify `electron/llm/visionCapability.ts`: Ollama list gains the no-dash `qwen…vl` form.
- Modify `electron/LLMHelper.ts`: `visionVerdict()`, and the five consumers above delegate to it; local-only message.
- Modify `electron/services/screen/VisionProviderRegistry.ts`: two rungs delegate.
- Modify `electron/llm/CodeHintLLM.ts`: gate removed.
- Tests (all new unless noted):
  - `electron/llm/__tests__/fixtures/visionCorpus2026_10_01.json`
  - `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionNameList2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionResolver2026_10_01.test.mjs`
  - `electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs`
  - `electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs` (modify)

Commands below run from the worktree root, `.claude/worktrees/vision-phase1`. `SP` is the session scratchpad.

---

### Task 1: Characterization corpus and baseline (base code, before any change)

**Files:**
- Create: `electron/llm/__tests__/fixtures/visionCorpus2026_10_01.json`
- Create: `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`

**Interfaces:**
- Produces: the fixture's `baseline` array (sorted `consumer|kind|model` keys answering "reads images" at the base commit), and the `INTENDED` rule array that Task 2 fills.

- [ ] **Step 1: Build the corpus.** Write `$SP/vp1-corpus.mjs`:

```js
// Builds the vision corpus fixture. Reads keys from .env itself; never prints them.
import fs from 'node:fs';
const root = '/Users/evin/natively-cluely-ai-assistant';
const env = Object.fromEntries(fs.readFileSync(`${root}/.env`, 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url.split('?')[0]} -> ${r.status}`);
  return r.json();
};
const openrouter = (await get('https://openrouter.ai/api/v1/models')).data.map((m) => m.id).sort();
const openai = (await get('https://api.openai.com/v1/models', { Authorization: `Bearer ${env.OPENAI_API_KEY}` })).data.map((m) => m.id).sort();
const gemini = [];
for (let token = ''; ;) {
  const page = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${token}` : ''}`, { 'x-goog-api-key': env.GEMINI_API_KEY });
  gemini.push(...page.models.map((m) => m.name.replace(/^models\//, '')));
  if (!page.nextPageToken) break;
  token = page.nextPageToken;
}
gemini.sort();
// Ollama library tags, hand-listed: vision families (current names, including
// the no-dash qwen2.5vl Ollama publishes) and common text-only models.
const ollama = [
  'llava:7b', 'llava:13b', 'llava-llama3', 'llava-phi3', 'bakllava', 'moondream',
  'llama3.2-vision:11b', 'llama3.2-vision:90b', 'gemma3:4b', 'gemma3:27b', 'gemma3n:e4b',
  'minicpm-v:8b', 'qwen2.5vl:7b', 'qwen2.5vl:72b', 'qwen3-vl:8b', 'qwen2-vl',
  'llama4:scout', 'llama4:maverick', 'granite3.2-vision', 'mistral-small3.1:24b', 'mistral-small3.2:24b',
  'hf.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M',
  'llama3.1:8b', 'llama3.2:3b', 'llama3.3:70b', 'qwen2.5:7b', 'qwen2.5-coder:7b', 'qwen3:8b',
  'deepseek-r1:8b', 'deepseek-coder-v2:16b', 'phi4', 'phi4-mini', 'mistral:7b', 'mixtral:8x7b',
  'gpt-oss:20b', 'codellama:13b', 'gemma2:9b', 'tinyllama', 'nomic-embed-text',
];
fs.writeFileSync(process.argv[2], JSON.stringify({
  fetched: '2026-10-01',
  sources: {
    openrouter: 'GET https://openrouter.ai/api/v1/models (public)',
    openai: "GET https://api.openai.com/v1/models with the development OpenAI key",
    gemini: 'GET generativelanguage.googleapis.com/v1beta/models with the development Gemini key',
    ollama: 'hand-listed from the Ollama library',
  },
  openrouter, openai, gemini, ollama, baseline: [],
}, null, 1) + '\n');
console.log({ openrouter: openrouter.length, openai: openai.length, gemini: gemini.length, ollama: ollama.length });
```

Run: `mkdir -p electron/llm/__tests__/fixtures && node $SP/vp1-corpus.mjs electron/llm/__tests__/fixtures/visionCorpus2026_10_01.json`
Expected: prints counts (OpenRouter ≈ 460, OpenAI ≈ 100, Gemini ≈ 50, Ollama 41). No key text in the output.

- [ ] **Step 2: Write the characterization test.**

```js
/**
 * Characterization of every screenshot decision phase 1 touches (2026-10-01).
 *
 * Phase 1 moves these decisions onto one resolver (electron/llm/visionResolver.ts).
 * The resolver's own tests prove the resolver; this proves the MOVE: for every
 * real model id in the corpus, in every form Natively stores it (direct,
 * gateway-prefixed, Gemini's `models/` form, Ollama tags), each consumer
 * answers exactly as it did at the base commit, except for the additions listed
 * in INTENDED, each with its reason. Nothing may go from "reads images" to
 * "doesn't": phase 1 only widens.
 *
 * The corpus is real: OpenRouter's public catalogue, the model lists of the
 * development OpenAI and Gemini keys, and Ollama library tags (see the fixture's
 * `sources`).
 *
 * Regenerate the baseline ONLY on the unmodified base commit:
 *   VISION_CHAR_WRITE=1 node --test electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs
 */
import { test } from 'node:test';
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
const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

const FIXTURE = path.join(__dirname, 'fixtures/visionCorpus2026_10_01.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Which direct provider would hold an OpenRouter vendor's bare id. Vendors
// Natively has no direct adapter for fall to 'groq', whose branch is the name
// table, the same as openai/claude/gemini.
const DIRECT_KIND = { openai: 'openai', anthropic: 'claude', google: 'gemini', deepseek: 'deepseek' };

/** Every form a corpus id is stored in, tagged with the provider kind that holds it. */
function forms(c) {
  const out = [];
  for (const id of c.openrouter) {
    out.push({ kind: 'openrouter', model: `openrouter/${id}` });
    out.push({ kind: 'litellm', model: `litellm/${id}` });
    out.push({ kind: 'ninerouter', model: `ninerouter/${id}` });
    out.push({ kind: DIRECT_KIND[id.split('/')[0]] ?? 'groq', model: id.split('/').pop() });
  }
  for (const id of c.openai) {
    out.push({ kind: 'openai', model: id });
    out.push({ kind: 'agentrouter', model: `agentrouter/${id}` });
    out.push({ kind: 'fluxion', model: `fluxion/${id}` });
  }
  for (const id of c.gemini) {
    out.push({ kind: 'gemini', model: id });
    out.push({ kind: 'gemini', model: `models/${id}` });
  }
  for (const tag of c.ollama) out.push({ kind: 'ollama', model: tag });
  return out;
}

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), ...state,
  });
  return h;
}

/** The `consumer|kind|model` keys whose answer is "reads images". */
function answers() {
  const yes = new Set();
  const plain = helper();
  // A fetched catalogue that marks only gpt-5, so every other 9Router id is a catalogue "no".
  const catalogued = helper({ ninerouterVisionModels: new Set(['openai/gpt-5']) });
  for (const { kind, model } of forms(fixture)) {
    const put = (consumer, value) => { if (value) yes.add(`${consumer}|${kind}|${model}`); };
    put('names', getModelCapabilities(model, kind === 'ollama').supportsImages);
    put('direct', plain.directSelectionSupportsImages({ provider: kind, model }, null, null));
    if (kind === 'ninerouter') {
      put('ninerouter-uncatalogued', plain.ninerouterModelSupportsVision(model));
      put('ninerouter-catalogued', catalogued.ninerouterModelSupportsVision(model));
    }
    if (kind === 'agentrouter') put('agentrouter', plain.agentRouterModelSupportsVision(model));
  }
  return yes;
}

const lastSegment = (key) => key.split('|')[2].split('/').pop().toLowerCase();

/**
 * Every widening phase 1 makes on purpose. A key that turns "yes" must match
 * one of these, and every rule must still match something: a rule that matches
 * nothing is stale, and a stale rule is where the next surprise hides.
 */
const INTENDED = [];

test('the corpus is the real one', () => {
  assert.ok(fixture.openrouter.length > 300, 'OpenRouter catalogue');
  assert.ok(fixture.openai.length > 30, 'OpenAI key model list');
  assert.ok(fixture.gemini.length > 20, 'Gemini key model list');
  assert.ok(fixture.ollama.length > 30, 'Ollama tags');
});

test('phase 1 changes no screenshot decision except the intended additions', () => {
  if (process.env.VISION_CHAR_WRITE === '1') {
    fixture.baseline = [...answers()].sort();
    fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 1) + '\n');
    return;
  }
  assert.ok(fixture.baseline.length > 500, 'baseline was never written');
  const before = new Set(fixture.baseline);
  const now = answers();
  const lost = [...before].filter((k) => !now.has(k));
  assert.deepEqual(lost, [], 'phase 1 only widens: these stopped reading images');
  const gained = [...now].filter((k) => !before.has(k));
  const unexplained = gained.filter((k) => !INTENDED.some((r) => r.match(k)));
  assert.deepEqual(unexplained, [], 'new "reads images" answers with no stated reason');
  for (const r of INTENDED) assert.ok(gained.some((k) => r.match(k)), `stale rule: ${r.why}`);
});
```

- [ ] **Step 3: Write the baseline from the base build.** The worktree's `dist-electron` was built at base `e5cd83c8`. If unsure, run `npm run build:electron` first.

Run: `VISION_CHAR_WRITE=1 node --test electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`
Expected: PASS; the fixture now has a non-empty `baseline`.

- [ ] **Step 4: Check mode passes on base.**

Run: `node --test electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Reproduce defect 1 live, on the base build.** Follow CLAUDE.md "Agent UI testing via CDP": run `agent-browser skills get core` and `agent-browser skills get electron`, then start `npm run dev:agent` in the background and wait for `[dev:agent] userData=…`. Then:

```bash
# Test screenshot: a small code snippet, inside userData (generate-code-hint only accepts images there).
python3 - <<'EOF'
from PIL import Image, ImageDraw, ImageFont
code = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []"
img = Image.new('RGB', (760, 200), 'white'); d = ImageDraw.Draw(img)
d.multiline_text((16, 16), code, fill='black', font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 20), spacing=6)
img.save('.agent/userdata/vp1-code.png')
EOF
# Keys go over stdin, never argv or console.
node -e '
const fs=require("fs");const env=Object.fromEntries(fs.readFileSync("/Users/evin/natively-cluely-ai-assistant/.env","utf8").split("\n").filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).trim().replace(/^["\x27]|["\x27]$/g,"")]}));
process.stdout.write(`(async()=>{await window.electronAPI.setGeminiApiKey(${JSON.stringify(env.GEMINI_API_KEY)});await window.electronAPI.setDeepseekApiKey(${JSON.stringify(env.DEEPSEEK_API_KEY)});return "keys set"})()`)' | agent-browser eval --stdin
agent-browser eval "window.electronAPI.setModel('deepseek-v4-flash').then(r => JSON.stringify(r))"
agent-browser eval "window.electronAPI.generateCodeHint(['$PWD/.agent/userdata/vp1-code.png'], 'Two Sum').then(r => JSON.stringify(r))"
```

Run these from the launcher target (`agent-browser tab`, then confirm with `agent-browser eval "location.search"`).
Expected (the bug): the hint contains `doesn't support image input`, even though a Gemini key is configured. Save the output to `$SP/vp1-live-before.txt`, then stop the app through the launcher.

- [ ] **Step 6: Commit.**

```bash
git add electron/llm/__tests__/fixtures/visionCorpus2026_10_01.json electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs
git commit -m "test(vision): characterize every screenshot decision phase 1 touches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One corrected name list

**Files:**
- Modify: `electron/llm/visionCapability.ts:20-22` (`OLLAMA_VISION_NAME_RE`)
- Modify: `electron/llm/modelCapabilities.ts:89-99` (`isCloudIdentifier`), `:151-155` (delete `ollamaSupportsImages`), `:176-240` (`getModelCapabilities`)
- Test: `electron/llm/__tests__/VisionNameList2026_10_01.test.mjs`
- Modify: `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs` (`INTENDED`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getModelCapabilities(id, isOllama).supportsImages` with the additions below; `isOllamaVisionModelByName` as the only Ollama list.

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The name list, corrected and consolidated (2026-10-01).
 *
 * Measured: OpenAI's o1, o1-pro, o3, o4-mini and gpt-4-turbo read images (OpenAI
 * model pages; OpenRouter input_modalities for o3-pro, o4-mini-high and
 * gpt-4-turbo), and Natively called every one of them text-only. Bare `o1` and
 * `o3` were not even recognised as cloud models. Two Ollama lists had drifted:
 * the one getModelCapabilities used lacked llama4, qwen3-vl, granite3.2-vision
 * and mistral-small3.1, and neither matched Ollama's own `qwen2.5vl` spelling.
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
const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
const { isOllamaVisionModelByName } = require(dist('llm/visionCapability.js'));

const reads = (id, ollama = false) => getModelCapabilities(id, ollama).supportsImages;

describe('OpenAI models that read images', () => {
  for (const id of ['o1', 'o1-2024-12-17', 'o1-pro', 'o1-pro-2025-03-19', 'o3', 'o3-2025-04-16', 'o3-pro',
    'o4-mini', 'o4-mini-2025-04-16', 'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'O3']) {
    test(id, () => assert.equal(reads(id), true));
  }
  for (const id of ['o1-mini', 'o1-preview', 'o3-mini', 'o3-mini-2025-01-31', 'o3-deep-research',
    'gpt-4', 'gpt-4-0613', 'gpt-4-turbo-preview', 'gpt-3.5-turbo', 'chatgpt-4o-latest', 'gpt-4.5-preview']) {
    test(`${id} is not claimed`, () => assert.equal(reads(id), false));
  }
  test('through gateways, the same answers', () => {
    assert.equal(reads('openrouter/openai/o3'), true);
    assert.equal(reads('openrouter/openai/o4-mini-high'), true);
    assert.equal(reads('litellm/openai/o4-mini'), true);
    assert.equal(reads('agentrouter/o3'), true);
    assert.equal(reads('openrouter/openai/o3-mini'), false);
  });
});

describe("Gemini ids in the API's own `models/` form", () => {
  for (const id of ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro']) {
    test(id, () => assert.equal(reads(`models/${id}`), reads(id)));
  }
  test('and they read images', () => assert.equal(reads('models/gemini-2.5-flash'), true));
});

describe('one Ollama list', () => {
  for (const tag of ['qwen2.5vl:7b', 'qwen2.5vl', 'qwen2.5-vl:7b', 'qwen3-vl:8b', 'qwen2-vl', 'llama4:scout',
    'granite3.2-vision', 'mistral-small3.1:24b', 'llava:13b', 'gemma3:4b', 'minicpm-v:8b',
    'hf.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M']) {
    test(`${tag} reads images`, () => assert.equal(reads(tag, true), true));
  }
  for (const tag of ['llama3.1:8b', 'qwen2.5-coder:7b', 'qwen3:8b', 'deepseek-r1:8b', 'phi4', 'mistral:7b', 'gpt-oss:20b', 'codellama:13b']) {
    test(`${tag} is not claimed`, () => assert.equal(reads(tag, true), false));
  }
  test('getModelCapabilities and the shared predicate agree on every tag', () => {
    for (const tag of ['qwen2.5vl:7b', 'llama4:scout', 'granite3.2-vision', 'llama3.1:8b', 'gemma3:4b', 'phi4']) {
      assert.equal(reads(tag, true), isOllamaVisionModelByName(tag), tag);
    }
  });
});
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `node --test electron/llm/__tests__/VisionNameList2026_10_01.test.mjs`
Expected: FAIL on `o1`, `o3`, `o4-mini`, `gpt-4-turbo`, `models/gemini-2.5-flash`, `qwen2.5vl:7b`, `llama4:scout`, `granite3.2-vision`, and the "agree" test.

- [ ] **Step 3: Implement.**

`electron/llm/visionCapability.ts`: in `OLLAMA_VISION_NAME_RE`, replace `qwen[0-9.]*-vl|qwen-vl` with `qwen[0-9.]*-?vl`, and extend the comment above it:

```ts
// Name heuristic (fallback only). Ollama's /api/show `capabilities` array is the
// authoritative source; this regex is used when capabilities are absent (older
// Ollama servers) or the probe failed. The ONLY Ollama list (2026-10-01):
// modelCapabilities.ts had a second, drifted copy. `qwen[0-9.]*-?vl` because
// Ollama publishes the family as `qwen2.5vl` (no dash); `qwen2.5-vl`,
// `qwen3-vl` and Hugging Face names keep theirs.
const OLLAMA_VISION_NAME_RE =
  /(llava|bakllava|moondream|llama-?3\.2-vision|llama3\.2-vision|gemma3|minicpm-v|qwen[0-9.]*-?vl|pixtral|llama-?4|granite3\.2-vision|mistral-small3\.1|llama-?guard3-vision)/i;
```

`electron/llm/modelCapabilities.ts`:

1. Change the import `import { modelNameSuggestsVision } from './visionCapability';` to `import { isOllamaVisionModelByName, modelNameSuggestsVision } from './visionCapability';`.
2. Delete `ollamaSupportsImages` and its comment. In the Ollama branch, use `supportsImages: isOllamaVisionModelByName(id),`.
3. In `isCloudIdentifier`, after the `gpt-`/`o1-` line, add:

```ts
  // Bare `o1` / `o3`: OpenAI's own ids, which the `o1-` prefixes above miss.
  if (/^o[1-9]$/.test(s)) return true;
```

4. Above `agentRouterDeepseekReadsImages`, add:

```ts
/**
 * OpenAI models outside the gpt-4o / 4.1 / 5 / 6 families that read images.
 * Verified 2026-10-01: OpenAI's model pages ("text and image inputs") for o1,
 * o1-pro, o3 and o4-mini; OpenRouter's input_modalities for o3-pro,
 * o4-mini-high and gpt-4-turbo. Left out on purpose: o1-mini, o1-preview and
 * o3-mini (text-only); gpt-4 and gpt-4-turbo-preview (the preview alias
 * predates vision); chatgpt-4o-latest and gpt-4.5 (not verified).
 */
const OPENAI_VISION_EXTRA_RE = /^(?:o[13](?:-pro)?|o4-mini(?:-high)?|gpt-4-turbo)(?:-\d{4}-\d{2}-\d{2})?$/;
```

5. In `getModelCapabilities`, change `const lower = id.toLowerCase();` to:

```ts
  // `models/gemini-2.5-flash` is Gemini's own listing form of `gemini-2.5-flash`
  // (isCloudIdentifier already accepts it), so every rule below sees it bare.
  const lower = id.toLowerCase().replace(/^models\//, '');
```

6. In the cloud branch's `supportsImages`, add `|| OPENAI_VISION_EXTRA_RE.test(lower)` after the `gpt-6` line.

- [ ] **Step 4: Rebuild and run; verify it passes.**

Run: `npm run build:electron && node --test electron/llm/__tests__/VisionNameList2026_10_01.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the characterization; name every gained key.**

Run: `node --test electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`
Expected: FAIL with an `unexplained` list of gained keys and an empty `lost` list. Every gained key must fall under one of the four rules below. If one doesn't, STOP and find out why; never widen a rule to swallow it. Then set `INTENDED`:

```js
const OPENAI_EXTRA = /^(?:o[13](?:-pro)?|o4-mini(?:-high)?|gpt-4-turbo)(?:-\d{4}-\d{2}-\d{2})?$/;
const INTENDED = [
  { why: 'OpenAI o1/o1-pro/o3/o3-pro/o4-mini/gpt-4-turbo read images (verified 2026-10-01)',
    match: (k) => OPENAI_EXTRA.test(lastSegment(k)) },
  { why: "Gemini's `models/` listing form reads like the bare id",
    match: (k) => k.split('|')[2].startsWith('models/gemini-') },
  { why: 'one Ollama list: the fuller shared list replaces the drifted copy',
    match: (k) => k.split('|')[1] === 'ollama' },
  { why: "Ollama's no-dash `qwen2.5vl` spelling, also reached through gateway names",
    match: (k) => /qwen[0-9.]*vl/.test(lastSegment(k)) },
];
```

Run again. Expected: PASS. If the `lost` list is ever non-empty, the change narrowed something. Fix the code, not the test.

- [ ] **Step 6: Commit.**

```bash
git add electron/llm/visionCapability.ts electron/llm/modelCapabilities.ts electron/llm/__tests__/VisionNameList2026_10_01.test.mjs electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs
git commit -m "fix(vision): OpenAI o-series, gpt-4-turbo and qwen2.5vl read screenshots; one Ollama list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The resolver

**Files:**
- Create: `electron/llm/visionResolver.ts`
- Test: `electron/llm/__tests__/VisionResolver2026_10_01.test.mjs`

**Interfaces:**
- Consumes: `getModelCapabilities` (Task 2), `customProviderSupportsVision`, `isOllamaVisionModelByName`, type `DirectAssistProvider` from `electron/direct-assist/types.ts`.
- Produces:
  - `type VisionAnswer = 'yes' | 'no' | 'unknown'`
  - `type VisionSource = 'route' | 'provider' | 'names'`
  - `interface VisionVerdict { reads: VisionAnswer; source: VisionSource | null }`
  - `interface VisionQuery { provider: DirectAssistProvider; model: string }`
  - `interface VisionFacts { ollamaReportsVision?: (model: string) => boolean | undefined; ninerouterVisionModels?: readonly string[]; customProvider?: { curlCommand?: string; multimodal?: boolean } | null }`
  - `resolveVision(q: VisionQuery, facts?: VisionFacts): VisionVerdict`
  - `readsImages(v: VisionVerdict, unknownMeans: boolean): boolean`
  - `gatewaySeatReadsImages(provider: 'ninerouter' | 'agentrouter', model: string, facts?: VisionFacts): boolean`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The vision resolver (2026-10-01): one answer to "can this selection read a
 * screenshot?", three-valued, with where the answer came from.
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
const { resolveVision, readsImages, gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));

const v = (provider, model, facts) => resolveVision({ provider, model }, facts);
const yes = (source) => ({ reads: 'yes', source });
const no = (source) => ({ reads: 'no', source });
const unknown = { reads: 'unknown', source: null };

describe('decided by the route', () => {
  test('Natively, Codex and Antigravity always carry the image to a model that reads it', () => {
    assert.deepEqual(v('natively', 'natively'), yes('route'));
    assert.deepEqual(v('codex-cli', 'gpt-5.5'), yes('route'));
    assert.deepEqual(v('antigravity', 'antigravity:gemini-3.1-pro'), yes('route'));
  });
  test("direct DeepSeek's adapter never attaches an image, whatever the model", () => {
    assert.deepEqual(v('deepseek', 'deepseek-v4-flash'), no('route'));
  });
  test("custom and cURL follow the provider's template", () => {
    assert.deepEqual(v('custom', 'id', { customProvider: { multimodal: true } }), yes('route'));
    assert.deepEqual(v('custom', 'id', { customProvider: { multimodal: false } }), no('route'));
    assert.deepEqual(v('curl', 'id', { customProvider: { curlCommand: 'curl -d \'{"image":"{{IMAGE_BASE64}}"}\' https://x' } }), yes('route'));
    assert.deepEqual(v('curl', 'id', { customProvider: { curlCommand: 'curl -d \'{"prompt":"{{TEXT}}"}\' https://x' } }), no('route'));
    assert.deepEqual(v('custom', 'id', {}), no('route'), 'no provider object: nothing can carry an image');
  });
});

describe('Ollama', () => {
  test("Ollama's own answer beats the name list, both ways", () => {
    assert.deepEqual(v('ollama', 'my-finetune:latest', { ollamaReportsVision: () => true }), yes('provider'));
    assert.deepEqual(v('ollama', 'llava:7b', { ollamaReportsVision: () => false }), no('provider'));
  });
  test('not probed: the name list can say yes, and never says no', () => {
    assert.deepEqual(v('ollama', 'qwen2.5vl:7b'), yes('names'));
    assert.deepEqual(v('ollama', 'llama3.1:8b'), unknown);
  });
});

describe('9Router', () => {
  const facts = { ninerouterVisionModels: ['openai/gpt-5'] };
  test("a fetched catalogue is the provider's answer, both ways", () => {
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-5', facts), yes('provider'));
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-3.5-turbo', facts), no('provider'));
  });
  test('an unfetched catalogue falls to the name list', () => {
    assert.deepEqual(v('ninerouter', 'ninerouter/openai/gpt-5'), yes('names'));
    assert.deepEqual(v('ninerouter', 'ninerouter/alicode/glm-5'), unknown);
  });
});

describe('everything else: the name list, which proves yes and never no', () => {
  test('gateways and direct vendors', () => {
    assert.deepEqual(v('agentrouter', 'agentrouter/claude-opus-5'), yes('names'));
    assert.deepEqual(v('agentrouter', 'agentrouter/glm-5.3'), unknown);
    assert.deepEqual(v('openai', 'o3'), yes('names'));
    assert.deepEqual(v('openai', 'gpt-3.5-turbo'), unknown);
    assert.deepEqual(v('gemini', 'gemini-2.5-flash'), yes('names'));
    assert.deepEqual(v('openrouter', 'openrouter/qwen/qwen2.5-vl-72b-instruct'), yes('names'));
  });
});

describe('readsImages: the caller states what unknown means', () => {
  test('yes and no ignore the policy', () => {
    assert.equal(readsImages(yes('names'), false), true);
    assert.equal(readsImages(no('route'), true), false);
  });
  test('unknown takes the policy', () => {
    assert.equal(readsImages(unknown, true), true);
    assert.equal(readsImages(unknown, false), false);
  });
});

describe('gatewaySeatReadsImages: one rule for both screenshot paths', () => {
  test('9Router seats on unknown (an unfetched catalogue is not "text-only"); AgentRouter does not', () => {
    assert.equal(gatewaySeatReadsImages('ninerouter', 'ninerouter/alicode/glm-5'), true);
    assert.equal(gatewaySeatReadsImages('agentrouter', 'agentrouter/glm-5.3'), false);
  });
  test('a catalogue "no" is never seated', () => {
    assert.equal(gatewaySeatReadsImages('ninerouter', 'ninerouter/alicode/glm-5', { ninerouterVisionModels: ['openai/gpt-5'] }), false);
  });
});
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `node --test electron/llm/__tests__/VisionResolver2026_10_01.test.mjs`
Expected: FAIL with `Cannot find module '…/llm/visionResolver.js'`.

- [ ] **Step 3: Implement `electron/llm/visionResolver.ts`.**

```ts
// electron/llm/visionResolver.ts
//
// ONE answer to "can this selection read a screenshot?" (design:
// docs/plans/2026-10-01-vision-capability-design.md, phase 1). Pure: every fact
// it needs is passed in, so LLMHelper (live instance state) and
// VisionProviderRegistry (persisted credentials) ask the same function the same
// question and cannot drift apart again — which is how the two Ollama lists,
// and the registry's own copies of the 9Router and AgentRouter rules, came to be.
//
// Three answers, not two. `unknown` means nothing Natively knows says either
// way, which is not "no": treating it as "no" is how every new model family
// came out text-only. Until the one-time image test lands (phase 3), each
// CALLER decides what unknown means for it (readsImages' second argument), and
// each keeps exactly the behaviour it had before this module existed.

import type { DirectAssistProvider } from '../direct-assist/types';
import { getModelCapabilities } from './modelCapabilities';
import { customProviderSupportsVision, isOllamaVisionModelByName } from './visionCapability';

export type VisionAnswer = 'yes' | 'no' | 'unknown';
/** Where an answer came from. `override` (phase 4) and `test` (phase 3) join later. */
export type VisionSource = 'route' | 'provider' | 'names';

export interface VisionVerdict {
  reads: VisionAnswer;
  /** null exactly when `reads` is 'unknown'. */
  source: VisionSource | null;
}

export interface VisionQuery {
  provider: DirectAssistProvider;
  /** As Natively stores it: routed for gateways (`agentrouter/gpt-6-astra`), the tag for Ollama. */
  model: string;
}

export interface VisionFacts {
  /** Ollama's own answer (/api/show capabilities) when probed; undefined = not probed. */
  ollamaReportsVision?: (model: string) => boolean | undefined;
  /** 9Router's catalogue: the WIRE ids it marks vision-capable. Empty = never fetched. */
  ninerouterVisionModels?: readonly string[];
  /** The active custom or cURL provider; its template decides whether an image can travel. */
  customProvider?: { curlCommand?: string; multimodal?: boolean } | null;
}

const UNKNOWN: VisionVerdict = { reads: 'unknown', source: null };
const answer = (reads: boolean, source: VisionSource): VisionVerdict => ({ reads: reads ? 'yes' : 'no', source });

/** The name list can prove yes; absence from a list is not evidence of no. */
function fromNames(model: string, isOllama: boolean): VisionVerdict {
  return getModelCapabilities(model, isOllama).supportsImages ? answer(true, 'names') : UNKNOWN;
}

export function resolveVision(q: VisionQuery, facts: VisionFacts = {}): VisionVerdict {
  const model = q.model || '';
  switch (q.provider) {
    // These adapters always carry the image to a model that reads it.
    case 'natively':
    case 'codex-cli':
    case 'antigravity':
      return answer(true, 'route');
    // Natively's DeepSeek adapter never attaches an image (phase 3 adds it for Flash).
    case 'deepseek':
      return answer(false, 'route');
    // An explicit multimodal flag, an {{IMAGE_BASE64}} placeholder, or an OpenAI-compatible body.
    case 'custom':
    case 'curl':
      return answer(customProviderSupportsVision(facts.customProvider ?? null), 'route');
    case 'ollama': {
      const reported = facts.ollamaReportsVision?.(model);
      if (reported !== undefined) return answer(reported, 'provider');
      return isOllamaVisionModelByName(model) ? answer(true, 'names') : UNKNOWN;
    }
    case 'ninerouter': {
      const catalogue = facts.ninerouterVisionModels ?? [];
      if (catalogue.length > 0) return answer(catalogue.includes(model.replace(/^ninerouter\//, '')), 'provider');
      return fromNames(model, false);
    }
    default:
      return fromNames(model, false);
  }
}

/** The boolean a caller acts on. `unknownMeans` is the caller's policy, stated at the call site. */
export function readsImages(v: VisionVerdict, unknownMeans: boolean): boolean {
  return v.reads === 'unknown' ? unknownMeans : v.reads === 'yes';
}

/**
 * Whether a selected gateway model is seated for a screenshot. One function for
 * BOTH screenshot paths — LLMHelper's streaming chain and VisionProviderRegistry
 * — so they cannot answer differently. Unknown keeps what each rung did before
 * phase 1: 9Router seats (an unfetched catalogue is not "text-only"; failing
 * closed on absent data was a bug once already), AgentRouter does not (no
 * evidence, no screenshot).
 */
export function gatewaySeatReadsImages(provider: 'ninerouter' | 'agentrouter', model: string, facts: VisionFacts = {}): boolean {
  return readsImages(resolveVision({ provider, model }, facts), provider === 'ninerouter');
}
```

- [ ] **Step 4: Rebuild and run; verify it passes.** The module has no importer yet, so it is not bundled. Import it from LLMHelper now (Task 4 uses it): add `import { gatewaySeatReadsImages, readsImages, resolveVision, type VisionVerdict } from './llm/visionResolver';` beside the other `./llm/` imports in `electron/LLMHelper.ts`. Check first whether `dist-electron/electron/llm/visionResolver.js` exists: esbuild may emit every file under `electron/` as an entry.

Run: `npm run build:electron && ls dist-electron/electron/llm/visionResolver.js && node --test electron/llm/__tests__/VisionResolver2026_10_01.test.mjs`
Expected: the file exists; PASS.

- [ ] **Step 5: Typecheck and commit.**

Run: `npm run typecheck:electron`
Expected: no errors (the import may be reported unused; Task 4 uses it).

```bash
git add electron/llm/visionResolver.ts electron/llm/__tests__/VisionResolver2026_10_01.test.mjs electron/LLMHelper.ts
git commit -m "feat(vision): one resolver for whether a selection reads screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: LLMHelper's decisions go through the resolver

**Files:**
- Modify: `electron/LLMHelper.ts`: `ninerouterModelSupportsVision` (`:2032`), `agentRouterModelSupportsVision` (`:2433`), `directSelectionSupportsImages` (`:13795`), `getCapabilities` (`:14208`); add `visionVerdict`.
- Test: `electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs` (the LLMHelper half)

**Interfaces:**
- Consumes: `resolveVision`, `readsImages`, `gatewaySeatReadsImages`, `VisionVerdict` (Task 3); `getDirectAssistSelection()` (existing, `:13531`).
- Produces: `private visionVerdict(selection: { provider: DirectAssistProvider; model: string }, custom?: CustomProvider | null, curl?: CurlProvider | null): VisionVerdict`.

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Every decision phase 1 moved onto the vision resolver (2026-10-01), executed.
 * The characterization test proves the move changed no answer across the
 * corpus; these pin the answers that SHOULD change: getCapabilities() used to
 * classify a display string (a custom provider's name, a cURL UUID, a 9Router
 * id without its catalogue) and now asks the selection that will actually run.
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
const { LLMHelper } = require(dist('LLMHelper.js'));
const { gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaModel: '', ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), ...state,
  });
  return h;
}
const caps = (state) => helper(state).getCapabilities().supportsImages;

describe('getCapabilities().supportsImages follows the selection that will run', () => {
  test('a custom provider whose template carries images', () => {
    const customProvider = { id: 'c1', name: 'My Vision Box', curlCommand: 'curl -d \'{"img":"{{IMAGE_BASE64}}"}\' https://x' };
    assert.equal(caps({ customProvider }), true, 'was false: the NAME "My Vision Box" matches no rule');
  });
  test('a selected cURL provider follows its template, not its UUID', () => {
    const activeCurlProvider = { id: '6f1c2a4e-uuid', name: 'curl', curlCommand: 'curl -d \'{"prompt":"{{TEXT}}"}\' https://x' };
    assert.equal(caps({ activeCurlProvider }), false);
    activeCurlProvider.multimodal = true;
    assert.equal(caps({ activeCurlProvider }), true);
  });
  test("an Ollama model Ollama itself reports as vision, whatever it's called", () => {
    assert.equal(caps({ useOllama: true, ollamaModel: 'my-finetune:latest', ollamaVisionCache: new Map([['my-finetune:latest', true]]) }), true);
  });
  test("a 9Router model its catalogue calls text-only", () => {
    assert.equal(caps({ currentModelId: 'ninerouter/openai/gpt-5', ninerouterVisionModels: new Set(['gemini/gemini-3.6-flash']) }), false);
  });
  test('unchanged for plain selections', () => {
    assert.equal(caps({ currentModelId: 'gpt-5.5' }), true);
    assert.equal(caps({ currentModelId: 'deepseek-v4-flash' }), false);
    assert.equal(caps({ currentModelId: 'agentrouter/deepseek-v4-flash' }), true);
  });
  test('no usable selection never throws; it keeps the name answer', () => {
    assert.doesNotThrow(() => helper({ currentModelId: '' }).getCapabilities());
    assert.equal(caps({ currentModelId: 'some-unknown-model-xyz' }), false);
  });
  test('tier and budgets still come from the name', () => {
    const h = helper({ currentModelId: 'gpt-5.5' });
    const c = h.getCapabilities();
    assert.equal(c.tier, 'cloud');
    assert.ok(c.outputBudgetTokens > 0);
  });
});

describe('the gateway seat rule is the one shared function', () => {
  const ids = ['ninerouter/openai/gpt-5', 'ninerouter/alicode/glm-5', 'ninerouter/gemini/gemini-3.6-flash'];
  for (const catalogue of [[], ['gemini/gemini-3.6-flash']]) {
    test(`9Router, catalogue ${JSON.stringify(catalogue)}`, () => {
      const h = helper({ ninerouterVisionModels: new Set(catalogue) });
      for (const id of ids) {
        assert.equal(h.ninerouterModelSupportsVision(id), gatewaySeatReadsImages('ninerouter', id, { ninerouterVisionModels: catalogue }), id);
      }
    });
  }
  test('AgentRouter', () => {
    const h = helper();
    for (const id of ['agentrouter/claude-opus-5', 'agentrouter/deepseek-v4-flash', 'agentrouter/glm-5.3', 'agentrouter/o3']) {
      assert.equal(h.agentRouterModelSupportsVision(id), gatewaySeatReadsImages('agentrouter', id), id);
    }
  });
});
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `node --test electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs`
Expected: FAIL on the custom-provider, cURL, Ollama-reported and 9Router-catalogue `getCapabilities` tests. The shared-rule tests may already pass; they guard the refactor.

- [ ] **Step 3: Implement.**

Add `visionVerdict` right above `directSelectionSupportsImages`:

```ts
  /**
   * The vision resolver's answer for a selection, with the facts only this
   * instance holds: Ollama's /api/show results, 9Router's catalogue, and the
   * active custom/cURL provider. See electron/llm/visionResolver.ts.
   */
  private visionVerdict(
    selection: { provider: DirectAssistProvider; model: string },
    custom: CustomProvider | null = this.customProvider,
    curl: CurlProvider | null = this.activeCurlProvider,
  ): VisionVerdict {
    return resolveVision(selection, {
      ollamaReportsVision: (m) => this.ollamaVisionCache.get(m),
      ninerouterVisionModels: selection.provider === 'ninerouter' ? [...this.ninerouterVisionModels] : undefined,
      customProvider: selection.provider === 'curl' ? curl : custom,
    });
  }
```

Replace the body of `directSelectionSupportsImages`. Keep the whole gateway comment block verbatim; only the cases outside it change:

```ts
    switch (selection.provider) {
      case 'litellm':
      case 'nvidia_nim':
      case 'openrouter':
      case 'fluxion':
      case 'agentrouter':
      // …(existing 9Router / gateway comments unchanged)…
      case 'ninerouter':
        return true;
      default:
        // Everything else asks the resolver (2026-10-01). Unknown stays "no"
        // for a direct selection, exactly as the name table answered: Direct
        // Assist has no other rung, and an image a model cannot read is
        // answered blind.
        return readsImages(this.visionVerdict(selection, custom, curl), false);
    }
```

Replace `ninerouterModelSupportsVision`'s body, keeping its doc comment:

```ts
    if (!this.isNinerouterModel(modelId)) return false;
    return gatewaySeatReadsImages('ninerouter', modelId, { ninerouterVisionModels: [...this.ninerouterVisionModels] });
```

Replace `agentRouterModelSupportsVision`'s body:

```ts
    return gatewaySeatReadsImages('agentrouter', modelId);
```

Replace `getCapabilities`:

```ts
  public getCapabilities(): ModelCapabilities {
    const caps = (!this.useOllama && !this.customProvider && !this.activeCurlProvider && this.isAntigravityModel(this.currentModelId))
      ? getModelCapabilities(this.getAntigravityModelId(this.currentModelId), false)
      : getModelCapabilities(this.getCurrentModel(), this.useOllama);
    // Tier and budgets still come from the name: callers size prompts from
    // them. Whether it reads images comes from the resolver, for the selection
    // that will actually run (2026-10-01). getCurrentModel() is a display
    // string — a custom provider's name, a cURL UUID — that no name rule can
    // classify, and it never saw Ollama's or 9Router's own answers.
    let supportsImages = caps.supportsImages;
    try {
      supportsImages = readsImages(this.visionVerdict(this.getDirectAssistSelection()), false);
    } catch {
      // No usable selection (nothing selected, or no adapter for this id): keep the name answer.
    }
    return { ...caps, supportsImages };
  }
```

- [ ] **Step 4: Rebuild; run this test, the characterization, and the existing vision tests.**

Run:
```bash
npm run build:electron && node --test \
  electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs \
  electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs \
  electron/services/__tests__/AgentRouterScreenshots2026_09_30.test.mjs \
  electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs \
  electron/services/__tests__/NinerouterVisionSeat2026_09_20.test.mjs \
  electron/services/__tests__/NinerouterDirectAssist2026_09_21.test.mjs \
  electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs \
  electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs
```
Expected: PASS. The characterization must show NO new gained keys (this task changes no answer in it).

- [ ] **Step 5: Typecheck and commit.**

Run: `npm run typecheck:electron`. Expected: no errors.

```bash
git add electron/LLMHelper.ts electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs
git commit -m "refactor(vision): LLMHelper's screenshot decisions go through the resolver

getCapabilities() now answers for the selection that will run (custom and
cURL templates, Ollama's own report, 9Router's catalogue) instead of a
display string. Every other answer is unchanged, proven over the corpus.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The screen-reading registry uses the same seat rule

**Files:**
- Modify: `electron/services/screen/VisionProviderRegistry.ts`: `ninerouter()` (`:347-367`), `agentrouter()` (`:457-475`), imports.
- Test: `electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs` (add the registry half)

**Interfaces:**
- Consumes: `gatewaySeatReadsImages` (Task 3).

- [ ] **Step 1: Write the failing test.** Append to `VisionResolverConsumers2026_10_01.test.mjs`. The registry's bundle inlines `CredentialsManager`, so its rungs cannot be built in a test. Instead, pin that both rungs call the shared function, whose answers the LLMHelper half already executes.

```js
import fs from 'node:fs';

describe('VisionProviderRegistry asks the same function', () => {
  // Its bundle inlines CredentialsManager, so the rungs cannot be built here;
  // the shared function they call is executed above against LLMHelper's.
  const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
  const body = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));
  test('9Router rung', () => {
    assert.match(body('ninerouter'), /gatewaySeatReadsImages\('ninerouter'/);
    assert.doesNotMatch(body('ninerouter'), /visionModels\.length === 0/, 'the private copy of the rule is gone');
  });
  test('AgentRouter rung', () => {
    assert.match(body('agentrouter'), /gatewaySeatReadsImages\('agentrouter'/);
    assert.doesNotMatch(body('agentrouter'), /getModelCapabilities/, 'the private copy of the rule is gone');
  });
});
```

- [ ] **Step 2: Run; verify it fails.**

Run: `node --test electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs`
Expected: the two registry tests FAIL.

- [ ] **Step 3: Implement.** Add `import { gatewaySeatReadsImages } from '../../llm/visionResolver';` beside the other `../../llm/` imports.

In `ninerouter()`, replace the two lines computing `visionModels` and `supportsImages` with:

```ts
  // The same rule LLMHelper's streaming chain seats this rung by (2026-10-01).
  const supportsImages = gatewaySeatReadsImages('ninerouter', modelId, { ninerouterVisionModels: creds.getNinerouterVisionModels?.() || [] });
```

In `agentrouter()`, replace the `readsImages` line with:

```ts
  const readsImages = isSelected && gatewaySeatReadsImages('agentrouter', activeModelId);
```

Remove `getModelCapabilities` from the registry's imports if nothing else uses it (check with `grep -n getModelCapabilities electron/services/screen/VisionProviderRegistry.ts`).

- [ ] **Step 4: Rebuild and run.**

Run: `npm run build:electron && node --test electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/services/__tests__/NinerouterVisionSeat2026_09_20.test.mjs electron/services/__tests__/VisionProviderRegistryOrder.test.mjs`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

Run: `npm run typecheck:electron`. Expected: no errors.

```bash
git add electron/services/screen/VisionProviderRegistry.ts electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs
git commit -m "refactor(vision): the screen-reading registry seats 9Router and AgentRouter by the shared rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Code Hint defers to the vision chain; local-only says so

**Files:**
- Modify: `electron/llm/CodeHintLLM.ts:33-47`
- Modify: `electron/LLMHelper.ts` (`streamVisionWithFallback`'s `ordered.length === 0` block, `:8742`)
- Modify: `electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs:102-112`
- Test: `electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs` (add the chain message test)

**Interfaces:**
- Consumes: nothing new. The chain's error keeps the `No vision-capable provider configured.` prefix, which `_streamChatInner` (`:10406`) turns into `I can't read screenshots with the current setup. <reason>`.

- [ ] **Step 1: Write the failing tests.** In `CodeHintV3Adoption2026_09_05.test.mjs`, replace the `describe('the vision guard still fires first', …)` block with:

```js
describe('Code Hint does not second-guess the vision chain (2026-10-01)', () => {
  test('a text-only SELECTED model still hands the screenshot to streamChat', async () => {
    // streamChat sends every image-bearing turn through the vision chain, which
    // answers with any configured provider that reads images. The old gate
    // refused here, so a DeepSeek user with a Gemini key could never get a hint.
    const h = fakeHelper();
    h.getCapabilities = () => ({ supportsImages: false, tier: 'cloud', name: 'deepseek-v4-flash' });
    const out = await drain(new CodeHintLLM(h).generateStream(['/tmp/a.png'], 'two sum', 'screenshot', undefined, v3));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0][ARG.images], ['/tmp/a.png']);
    assert.doesNotMatch(out.join(''), /doesn't support image input/);
  });
});
```

(`v3` is the V3 fixture the file's earlier describe blocks already use. If it is scoped inside a block, use `{ system: 'S', user: 'U' }`.)

Append to `VisionResolverConsumers2026_10_01.test.mjs`:

```js
describe('the chain says why when nothing can read the screenshot', () => {
  test('local-only mode with no local vision model names local-only, not cloud keys', async () => {
    const h = helper({
      isLocalOnlyMode: true, currentModelId: 'deepseek-v4-flash',
      modelVersionManager: { getAllVisionTiers: () => [] }, visionHealth: new Map(),
    });
    let error = null;
    try {
      for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ }
    } catch (e) { error = e; }
    assert.ok(error, 'must throw: nothing can read it');
    assert.match(error.message, /^No vision-capable provider configured\./, '_streamChatInner keys its user message on this prefix');
    assert.match(error.message, /local-only mode/i);
    assert.doesNotMatch(error.message, /OpenAI, Claude, Gemini, or Groq/);
  });
});
```

- [ ] **Step 2: Run; verify both fail.**

Run: `node --test electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs`
Expected: the Code Hint test FAILS (`calls.length` 0); the chain test FAILS (message names OpenAI, Claude, Gemini, or Groq).

- [ ] **Step 3: Implement.**

`CodeHintLLM.ts`: delete the `if (imagePaths?.length) { … }` block (lines 33-47, including its comments) and put this in its place:

```ts
            // No capability gate here (2026-10-01). streamChat sends every
            // image-bearing turn through the vision chain, which answers with any
            // configured provider that reads images and says plainly when none
            // can. Gating on the SELECTED model refused screenshots the chain
            // would have answered: a DeepSeek user with a Gemini key never got
            // a hint.
```

`LLMHelper.ts`, in `streamVisionWithFallback`, as the first statement inside `if (ordered.length === 0) {`:

```ts
      // Local-only mode seats local providers only, so the cloud advice below
      // (add an OpenAI/Claude/Gemini/Groq key) would send the user to providers
      // this mode refuses to use (2026-10-01).
      if (localOnly) {
        throw new Error('No vision-capable provider configured. Local-only mode is on and no local model that reads images is set up — install one in Ollama (for example qwen2.5vl, llama3.2-vision or gemma3), or turn off local-only mode.');
      }
```

- [ ] **Step 4: Rebuild and run.**

Run: `npm run build:electron && node --test electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/services/__tests__/ScreenUnderstandingModeEnforcement2026_08_01.test.mjs electron/llm/__tests__/OllamaVisionChainProbeBudget2026_09_22.test.mjs`
Expected: PASS.

- [ ] **Step 5: Verify live (after).** Repeat Task 1 Step 5 on this build (fresh `npm run dev:agent`; the userData keeps the keys and model).
Expected: `generateCodeHint` returns a hint about the Two Sum code, with no "doesn't support image input". The main-process log shows the vision chain committing to a Gemini rung. Save the output to `$SP/vp1-live-after.txt`, then stop the app through the launcher.

- [ ] **Step 6: Typecheck and commit.**

Run: `npm run typecheck:electron`. Expected: no errors.

```bash
git add electron/llm/CodeHintLLM.ts electron/LLMHelper.ts electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs
git commit -m "fix(code-hint): a text-only selected model no longer blocks screenshot hints

Code Hint refused whenever the SELECTED model was text-only, while the
vision chain it calls would have answered through any configured vision
provider. Reproduced live: DeepSeek selected, Gemini key set -> refused.
The chain also now says when local-only mode is why nothing can read it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Design-doc amendment, full validation, landing

**Files:**
- Modify: `docs/plans/2026-10-01-vision-capability-design.md` ("Delivery", item 1)

- [ ] **Step 1: Amend the design doc.** Replace delivery item 1 with:

```markdown
1. **Resolver and consolidated name list**, all phase-1 consumers moved onto
   it, proven unchanged by a characterization test over ~2,400 real ids.
   Fixes defects 1, 2, 3, 5. The persisted cache moves to phase 2, with its
   first new writer (OpenRouter modalities); phase 1 reads Ollama's and
   9Router's answers where they are held today.
```

- [ ] **Step 2: Full validation.**

Run, in order:
```bash
npm run typecheck:electron
npm run build:electron
npm test
```
Expected: typecheck clean, build succeeds. For `npm test`, compare any failure against the same test on base `e5cd83c8`: only pre-existing failures are acceptable, listed by name in the completion report. There is no lint script in `package.json`, so say so rather than claiming lint ran.

- [ ] **Step 3: Review the change set.** Run `git diff e5cd83c8 --stat`. With the code-review-graph MCP tools connected, run `detect_changes` and `get_impact_radius` on the changed files. Every consumer in the map above must show the listed fate, and nothing else.

- [ ] **Step 4: Commit the doc, then land on local main.** Use the shared-checkout landing recipe:
  1. `--no-ff` merge in a temp worktree detached at the current `main`.
  2. Rerun the targeted tests there.
  3. Compare-and-swap `git update-ref refs/heads/main <merge> <old>`.
  4. Write the changed files into the root checkout (3-way `git merge-file` for any that are dirty there), `git reset -q`, and confirm the root's dirty set is unchanged.

Do not push.

- [ ] **Step 5: Completion report** (CLAUDE.md format): files, behaviour change, `Reviewed but not executed on Windows`, `Requires physical Windows verification`, tested physically on macOS (dev app, Code Hint before/after), commands actually run, remaining risks. Remaining risks include: o-series vision not exercised live (no OpenAI credits), and Ollama not running here.
