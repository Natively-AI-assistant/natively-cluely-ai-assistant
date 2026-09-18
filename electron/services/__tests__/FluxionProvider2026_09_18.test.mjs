/**
 * Fluxion AI as a first-class AI provider.
 *
 * Fluxion is a RESELLER gateway, and that single fact is what every assertion
 * here is really about. OpenRouter's ids at least look foreign
 * (`anthropic/claude-sonnet-5`); Fluxion's are the vendors' own — `claude-opus-5`,
 * `gpt-5.5`, `gemini-3.1-pro`, `deepseek-v4-flash-0731` are live catalogue
 * entries AND live ids inside this app, two of them (`claude-sonnet-4-6`,
 * `gpt-5.4`) being literally its own fallback-ladder defaults.
 *
 * So the failure being guarded against is not an error. Drop the `fluxion/`
 * prefix anywhere in the chain and the request is billed to the user's REAL
 * Anthropic/OpenAI/Gemini key, returns a perfectly good answer, and logs
 * nothing unusual. There is no symptom to notice later.
 *
 * WHAT IS EXECUTED AND WHAT IS NOT — stated plainly, because a test that
 * appears to run 36 ids while really regex-matching a source string is worse
 * than no test:
 *   • stripProviderRoutingPrefix() and getModelCapabilities() are exported, so
 *     all 36 ids are genuinely RUN through them.
 *   • providerFamily(), modelAvailable() and the direct-assist chain are
 *     closures inside a 17k-line IPC function / private class methods. They
 *     cannot be imported, so they are asserted by SOURCE ORDERING, the same
 *     convention ProviderVisibilityFilters.test.mjs uses — and the slices are
 *     themselves bounds-checked, because an unbounded slice is how those
 *     assertions silently stop covering the function they name.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const ipc = read('electron/ipcHandlers.ts');
const llm = read('electron/LLMHelper.ts');
const fetcher = read('electron/utils/modelFetcher.ts');
const capsSrc = read('electron/llm/modelCapabilities.ts');
const modelUtils = read('src/utils/modelUtils.ts');
const settings = read('src/components/settings/AIProvidersSettings.tsx');
const providerCard = read('src/components/settings/ProviderCard.tsx');
const marks = read('src/components/ui/aiProviderMarks.ts');
const credentials = read('electron/services/CredentialsManager.ts');

const { getModelCapabilities, stripProviderRoutingPrefix } = require(dist('llm/modelCapabilities.js'));

/**
 * Fluxion's ENTIRE public catalogue, captured from the live
 * GET /api/v1/model-plaza/public on 2026-09-17 (11 groups, 36 distinct models).
 * Kept whole rather than sampled: the collision risk is per-id, and a sample
 * would be chosen by the same intuition that would miss the surprising ones
 * (glm-, kimi-, grok- classify as 'unknown', which routes DIFFERENTLY from the
 * claude-/gpt-/gemini- ids people think of first).
 */
const FLUXION_CATALOGUE = [
  'claude-fable-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-4-5',
  'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5',
  'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'codex-auto-review',
  'deepseek-v4-flash-0731', 'gemini-3.1-pro', 'gemini-3.1-pro-high', 'gemini-3.1-pro-low',
  'gemini-3.7-flash', 'gemini-3.7-flash-high', 'gemini-3.7-flash-low', 'glm-5.2',
  'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-image-2', 'grok-4.5',
  'grok-4.6', 'grok-build', 'grok-composer-2.5-fast', 'kimi-k2.6', 'kimi-k3',
  'nano-banana-2',
];

const providerFamilySource = () => {
  const start = ipc.indexOf('const providerFamily = (modelId: string): string => {');
  assert.ok(start >= 0, 'providerFamily() should exist');
  const end = ipc.indexOf('\n      };', start);
  assert.ok(end > start, 'providerFamily() should terminate');
  return ipc.slice(start, end);
};

const modelAvailableSource = () => {
  const start = ipc.indexOf('const modelAvailable = (modelId: string): boolean => {');
  assert.ok(start >= 0, 'modelAvailable() should exist');
  const end = ipc.indexOf('\n      };', start);
  assert.ok(end > start, 'modelAvailable() should terminate');
  return ipc.slice(start, end);
};

const directAssistSource = () => {
  const start = llm.indexOf('public getDirectAssistSelection(): DirectAssistSelection {');
  assert.ok(start >= 0, 'getDirectAssistSelection() should exist');
  const end = llm.indexOf('\n  }', start);
  assert.ok(end > start, 'getDirectAssistSelection() should terminate');
  return llm.slice(start, end);
};

describe('the catalogue is real and the collision is total', () => {
  test('every id Fluxion sells is one an existing classifier would claim', () => {
    // This is the PREMISE of the prefix, asserted rather than asserted-about.
    // If this ever stops being true the prefix is still correct, but the
    // urgency recorded throughout these comments would no longer be.
    const claimedByAVendorPrefix = FLUXION_CATALOGUE.filter(id =>
      id.startsWith('claude-') || id.startsWith('gpt-') || id.startsWith('gemini-') || /^deepseek-v/.test(id));
    assert.ok(
      claimedByAVendorPrefix.length >= 27,
      `expected most of the catalogue to collide with a vendor prefix, got ${claimedByAVendorPrefix.length}`,
    );
  });

  test("Fluxion resells ids this app ships as its OWN defaults", () => {
    // The sharpest form of the problem: these are not look-alikes.
    for (const id of ['claude-sonnet-4-6', 'gpt-5.4']) {
      assert.ok(FLUXION_CATALOGUE.includes(id), `${id} should be in the captured catalogue`);
      assert.ok(
        modelUtils.includes(`'${id}'`),
        `${id} is BOTH a Fluxion model and one of this app's own preset ids — `
        + 'that is exactly why the prefix cannot be dropped',
      );
    }
  });
});

describe('the fluxion/ prefix survives the capability layer (EXECUTED, all 36)', () => {
  test('stripProviderRoutingPrefix takes exactly ONE segment, not two', () => {
    // The inversion vs OpenRouter. Fluxion ids are bare, so there is no vendor
    // segment underneath; a two-segment strip would eat the model name itself.
    for (const id of FLUXION_CATALOGUE) {
      assert.equal(
        stripProviderRoutingPrefix(`fluxion/${id}`), id,
        `fluxion/${id} must strip back to exactly ${id}`,
      );
    }
  });

  test('a prefixed id resolves to the SAME capabilities as the bare one', () => {
    // What this buys: the capability table already knows `claude-opus-5`, so if
    // the prefix reaches it unstripped every Fluxion model resolves text-only —
    // the Code Hint refusal class. Comparing against the bare id proves the
    // prefix is transparent rather than merely "not crashing".
    for (const id of FLUXION_CATALOGUE) {
      const bare = getModelCapabilities(id, false);
      const prefixed = getModelCapabilities(`fluxion/${id}`, false);
      assert.equal(
        prefixed.supportsImages, bare.supportsImages,
        `fluxion/${id} image support diverged from ${id}`,
      );
    }
  });

  test('the routing prefix list names fluxion', () => {
    assert.match(capsSrc, /ROUTING_PREFIX_RE = \/\^\(\?:[^/]*fluxion[^/]*\)\\\//,
      'fluxion must be in ROUTING_PREFIX_RE or nothing above strips it');
  });
});

describe('the fluxion/ prefix is classified BEFORE every vendor branch', () => {
  // Ordering, not presence. A version that classifies fluxion LAST would pass a
  // presence check and be completely broken, because claude-/gpt-/gemini-/
  // deepseek- all match first.
  // Needles must be unique to CODE. `includes('openai')` and `isKnownGroqModel`
  // both appear verbatim in the explanatory comment above the openrouter check,
  // which sits ABOVE the fluxion check — so matching the bare substring found
  // the prose and reported a false failure on correct code. Every needle below
  // therefore carries its `return`/gate tail, which only the real branch has.
  const requireOrdering = (src, label, fluxionNeedle, laterNeedles) => {
    const at = src.indexOf(fluxionNeedle);
    assert.ok(at >= 0, `${label} must classify fluxion/ ids (looked for: ${fluxionNeedle})`);
    for (const needle of laterNeedles) {
      const other = src.indexOf(needle);
      assert.ok(other >= 0, `${label}: expected to find ${needle}`);
      assert.ok(
        at < other,
        `${label}: the fluxion/ check must come BEFORE ${needle} — otherwise a `
        + "Fluxion model is gated by, and billed to, another vendor's key",
      );
    }
  };

  test('the sliced sources are actually bounded to their functions', () => {
    // Without this the assertions below can silently start matching unrelated
    // code further down the file and pass against a broken ordering. This is
    // not hypothetical: the OpenRouter suite's modelAvailable slice was pinned
    // to a call site that later gained a guard, so indexOf returned -1 and the
    // slice ran to the end of a 17k-line file.
    for (const [label, src] of [
      ['providerFamily', providerFamilySource()],
      ['modelAvailable', modelAvailableSource()],
      ['getDirectAssistSelection', directAssistSource()],
    ]) {
      assert.ok(src.length < 6000, `${label} slice is ${src.length} chars — it has escaped its function`);
      assert.ok(!src.includes('safeHandle('), `${label} slice reaches into the IPC handlers below it`);
    }
  });

  test('providerFamily() classifies fluxion before claude/gpt/gemini/deepseek/custom', () => {
    requireOrdering(providerFamilySource(), 'providerFamily()', "startsWith('fluxion/')) return 'fluxion'", [
      "startsWith('gemini-') || modelId.startsWith('models/')) return 'gemini'",
      "isKnownGroqModel(modelId)) return 'groq'",
      "includes('openai')) return 'openai'",
      "startsWith('claude-')) return 'claude'",
      "test(modelId)) return 'deepseek'",
      "allProviders.some((p: any) => p?.id === modelId)) return 'custom'",
    ]);
  });

  test('modelAvailable() gates fluxion on the FLUXION key, before every vendor arm', () => {
    const src = modelAvailableSource();
    requireOrdering(src, 'modelAvailable()', "startsWith('fluxion/')) return has(cm.getFluxionApiKey())", [
      'return has(cm.getGeminiApiKey())',
      'return has(cm.getGroqApiKey())',
      'return has(cm.getOpenaiApiKey())',
      'return has(cm.getClaudeApiKey())',
      'return has(cm.getDeepseekApiKey())',
    ]);
    assert.match(
      src, /startsWith\('fluxion\/'\)\) return has\(cm\.getFluxionApiKey\(\)\)/,
      'a fluxion/ id must be gated on the Fluxion key, not another vendor\'s',
    );
  });

  test('the direct-assist chain classifies fluxion before its vendor predicates', () => {
    requireOrdering(directAssistSource(), 'getDirectAssistSelection()', 'isFluxionModel(selected)', [
      'isGroqModel(selected)',
      'isOpenAiModel(selected)',
      'isClaudeModel(selected)',
      'isDeepseekModel(selected)',
      'isGeminiModel(selected)',
    ]);
  });

  test('isOpenAiModel/isClaudeModel exclude fluxion ids at the source', () => {
    // The ordering-independent belt to the braces above. LLMHelper's own comment
    // records why: excluding a family inside the predicate fixes every dispatch
    // site at once, so the three cascades cannot drift apart.
    const openAi = llm.slice(llm.indexOf('private isOpenAiModel('), llm.indexOf('private isClaudeModel('));
    assert.match(openAi, /isFluxionModel\(modelId\)\) return false/,
      'isOpenAiModel must exclude fluxion ids — fluxion/gpt-* would otherwise match startsWith("gpt-")');
  });
});

describe('two protocols, because the key does not reveal its group', () => {
  test('both base URLs exist and the Anthropic one has NO /v1', () => {
    // The Anthropic SDK appends /v1/messages itself. A base URL of
    // https://fluxionai.world/v1 would request /v1/v1/messages — the exact
    // duplicated-path mistake Fluxion's own docs warn about twice.
    assert.match(llm, /FLUXION_OPENAI_BASE_URL = "https:\/\/fluxionai\.world\/v1"/);
    assert.match(llm, /FLUXION_ANTHROPIC_BASE_URL = "https:\/\/fluxionai\.world"/);
  });

  test('exactly one client is built, so a request cannot take the unchosen protocol', () => {
    const setter = llm.slice(llm.indexOf('public setFluxionConfig('), llm.indexOf('private hasFluxionCredential('));
    assert.match(setter, /fluxionOpenAIClient = trimmed && this\.fluxionProtocol === 'openai'/);
    assert.match(setter, /fluxionAnthropicClient = trimmed && this\.fluxionProtocol === 'anthropic'/);
  });

  test('the protocol is persisted, or it silently reverts on restart', () => {
    assert.match(credentials, /fluxionProtocol\?: 'openai' \| 'anthropic'/);
    assert.match(credentials, /public setFluxionProtocol\(/);
    assert.match(ipc, /fluxionProtocol: creds\.fluxionProtocol === 'anthropic' \? 'anthropic' : 'openai'/,
      'get-stored-credentials must report the protocol or the card cannot prefill it');
    assert.match(read('electron/ProcessingHelper.ts'), /setFluxionConfig\(fluxionKey, credManager\.getFluxionProtocol\(\)\)/,
      'boot must hydrate the protocol WITH the key, or an anthropic-group user rebuilds an openai client every launch');
  });

  test('changing the protocol does not delete the stored key', () => {
    // The trap this closes: the selector persists on click, and the handler
    // writes whatever key it is handed. An omitted key must mean "keep", not "".
    const handler = ipc.slice(ipc.indexOf("safeHandle('set-fluxion-config'"), ipc.indexOf("safeHandle('set-litellm-config'"));
    assert.match(handler, /const keyOmitted = config\?\.apiKey === undefined/);
    assert.match(handler, /keyOmitted \? storedKey :/,
      'an omitted apiKey must preserve the stored key — otherwise the protocol toggle wipes it');
    assert.match(settings, /setFluxionConfig\(\{ protocol: proto \}\)/,
      'the selector must omit apiKey entirely, not send an empty string');
  });

  test('a degraded credential store is reported, not silently half-applied', () => {
    const handler = ipc.slice(ipc.indexOf("safeHandle('set-fluxion-config'"), ipc.indexOf("safeHandle('set-litellm-config'"));
    const refusal = handler.indexOf('credential_store_degraded');
    const liveClient = handler.indexOf('setFluxionConfig(normalizedKey, protocol)');
    assert.ok(refusal >= 0 && liveClient > refusal,
      'the refusal must be checked BEFORE the live client is touched, or chat works this '
      + 'session against a key that is gone after restart');
  });
});

describe('Test Connection and the catalogue cannot be broken by a model', () => {
  test('the probe is GET /v1/models, not a chat completion', () => {
    // Verified live 2026-09-17: 401 API_KEY_REQUIRED unauthenticated, 401
    // INVALID_API_KEY with a bogus key, so a 200 is real evidence. No model
    // dependency, so unlike the Groq and NVIDIA ladders it cannot be broken by
    // a retirement.
    assert.match(ipc, /axios\.get\('https:\/\/fluxionai\.world\/v1\/models'/);
    // Anchored on the URL, which occurs exactly once. `provider === 'fluxion'`
    // does NOT: its first hit is the key lookup in fetch-provider-models, so
    // slicing from there measured the wrong handler entirely.
    const probeAt = ipc.indexOf("axios.get('https://fluxionai.world/v1/models'");
    assert.ok(probeAt > 0, 'the Fluxion probe should exist');
    const leg = ipc.slice(probeAt, probeAt + 400);
    assert.match(leg, /Authorization: `Bearer \$\{apiKey\}`/,
      'Bearer works for BOTH protocols — the gateway takes it on every route');
  });

  test('the fetcher prefixes every id and drops the non-chat rows', () => {
    assert.match(fetcher, /id: `fluxion\/\$\{m\.id\}`/, 'every fetched id must be prefixed');
    for (const id of ['gpt-image-2', 'nano-banana-2', 'grok-imagine', 'codex-auto-review']) {
      assert.ok(
        fetcher.includes(`'${id}'`),
        `${id} must be filtered out — it does not answer on chat/completions`,
      );
    }
  });

  test('the image-only models are the ones dropped, and they are real', () => {
    // Guards the filter against drift in BOTH directions: the ids must still be
    // in the catalogue (or the filter is dead code) and must still be excluded.
    for (const id of ['gpt-image-2', 'nano-banana-2']) {
      assert.ok(FLUXION_CATALOGUE.includes(id), `${id} should still be in the captured catalogue`);
    }
  });
});

describe('the provider is reachable from the UI', () => {
  test('fluxion is a cloud provider card', () => {
    assert.match(settings, /id: 'fluxion' as const/);
  });

  test('presets exist, or the picker can never reach the provider', () => {
    // The picker loop iterates STANDARD_CLOUD_MODELS, so no entry = unreachable
    // even with a valid key.
    const entry = modelUtils.slice(modelUtils.indexOf('fluxion: {'), modelUtils.indexOf("pmKey: 'fluxionPreferredModel'"));
    assert.ok(entry.length > 0, 'STANDARD_CLOUD_MODELS needs a fluxion entry');
    for (const id of ['fluxion/gpt-5.6-terra', 'fluxion/claude-sonnet-5', 'fluxion/gemini-3.7-flash']) {
      assert.ok(entry.includes(id), `${id} should be a shipped preset`);
      assert.ok(
        FLUXION_CATALOGUE.includes(id.replace('fluxion/', '')),
        `${id} must be a REAL catalogue entry, not an invented one`,
      );
    }
  });

  test('the OpenAI-protocol preset leads, because that is the default protocol', () => {
    const entry = modelUtils.slice(modelUtils.indexOf('fluxion: {'), modelUtils.indexOf("pmKey: 'fluxionPreferredModel'"));
    const ids = [...entry.matchAll(/'(fluxion\/[^']+)'/g)].map(m => m[1]);
    assert.equal(
      ids[0], 'fluxion/gpt-5.6-terra',
      'the first preset is what "Set default" tends to land on, and a Claude preset '
      + "is unreachable until the user flips the protocol selector",
    );
  });

  test('fluxion is NOT opt-in, and routing agrees', () => {
    // 36 group-scoped models is nvidia_nim territory, not OpenRouter's 444. The
    // two sides must agree or the picker offers what routing rejects.
    assert.doesNotMatch(
      modelUtils, /isOptInModelProvider = \(provider: string\): boolean => [^;]*'fluxion'/,
      'fluxion should not be opt-in',
    );
    assert.doesNotMatch(
      modelAvailableSource(), /optInFamily = [^;]*'fluxion'/,
      "routing's opt-in mirror must agree with isOptInModelProvider",
    );
  });

  test('the card resolves a real brand mark, not the generic fallback', () => {
    assert.match(marks, /fluxion: fluxionMark/, 'fluxion must be in AI_PROVIDER_MARKS');
    assert.ok(
      fs.existsSync(path.join(root, 'src/assets/provider-logos/fluxion.svg')),
      'the imported mark must exist on disk',
    );
  });

  test('the protocol selector is rendered through the extras slot', () => {
    assert.match(providerCard, /extraControls\?: React\.ReactNode/);
    assert.match(settings, /extraControls=\{id !== 'fluxion' \? undefined :/,
      'only Fluxion should get the selector — the table drives all eight cards');
  });
});
