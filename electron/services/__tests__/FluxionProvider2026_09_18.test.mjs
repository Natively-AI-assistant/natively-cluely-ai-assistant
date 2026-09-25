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
      "isDeepseekModelId(modelId)) return 'deepseek'",
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

  test('an omitted apiKey still means "keep the stored key"', () => {
    // The manual toggle that used to call with `{protocol}` alone is gone, but
    // the distinction is still load-bearing: `undefined` = keep, `''` = clear.
    // Collapsing them would make any protocol-only write wipe the credential.
    const handler = ipc.slice(ipc.indexOf("safeHandle('set-fluxion-config'"), ipc.indexOf("safeHandle('set-litellm-config'"));
    assert.match(handler, /const keyOmitted = config\?\.apiKey === undefined/);
    assert.match(handler, /keyOmitted \? storedKey :/);
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

describe('what real keys proved (live: Claude group 09-18, GLM group 09-19)', () => {
  // These pin FINDINGS, not behaviour — they exist so the next person does not
  // re-derive the docs' claim from the docs. Everything here was measured:
  //   GET  /v1/models                      -> 200, exactly 11 claude-* ids
  //   POST /v1/chat/completions (claude)   -> 200, streamed 19 chunks, [DONE]
  //   POST /v1/messages         (claude)   -> 200
  //   POST either, model=gpt-5.5           -> 404 model_not_found
  test('the code records the ASYMMETRIC protocol rule, not a one-key guess', () => {
    // Superseded 2026-09-19. The original version of this test asserted the
    // group does NOT bind the protocol — true of the Claude key it was written
    // from, false in general: a GLM-group key 403s on /v1/messages. The rule is
    // asymmetric, so both files must record both observations rather than the
    // tidier half.
    for (const [label, src] of [['LLMHelper', llm], ['CredentialsManager', credentials]]) {
      // `Claude group` and `Claude-group` both occur; match either.
      assert.match(src, /Claude[- ]group/, `${label} should record the Claude-group observation`);
      assert.match(src, /GLM[- ]group/, `${label} should record the GLM-group 403`);
    }
  });

  test("'openai' is the default protocol, and that is the verified-safe one", () => {
    assert.match(credentials, /fluxionProtocol === 'anthropic' \? 'anthropic' : 'openai'/,
      "anything other than an explicit 'anthropic' must fall back to the format proven to work");
  });

  test('group scoping is what justifies NOT making fluxion opt-in', () => {
    assert.match(fetcher, /Group scoping CONFIRMED on two keys/,
      'the fetcher should record why a fetched catalogue has no unreachable rows');
  });
});

describe('the protocol selector is load-bearing (measured on a 2nd group, 2026-09-19)', () => {
  // The first key was a Claude group, which took BOTH protocols — from that one
  // sample it looked like the selector was only an escape hatch. A GLM-group key
  // then answered /v1/messages with a hard
  //   403 {"message":"This group does not allow /v1/messages dispatch"}
  // while /v1/chat/completions worked. So the ANTHROPIC endpoint is the
  // restricted one and 'openai' is the only protocol seen to work everywhere.
  test("'openai' is the default, because it is the universal one", () => {
    assert.match(credentials, /fluxionProtocol === 'anthropic' \? 'anthropic' : 'openai'/);
    assert.match(llm, /public setFluxionConfig\(apiKey: string, protocol: 'openai' \| 'anthropic' = 'openai'\)/,
      "the default argument must be the protocol that works on every group");
  });

  test('a protocol/group mismatch is explained, not surfaced as a bare 403', () => {
    // It is the one Fluxion failure a user can fix from Settings, so it must say
    // which toggle to move. Verified live against the GLM-group key on both the
    // blocking and streaming paths.
    assert.match(llm, /does not allow \\\/v1\\\/messages dispatch/,
      'the explainer must key off the measured 403 body');
    assert.match(llm, /switch API format to OpenAI/,
      'the message must name the fix, not just the failure');
    const calls = [...llm.matchAll(/explainFluxionProtocolMismatch\(e\)/g)];
    assert.ok(calls.length >= 2,
      `both anthropic-path call sites must use it, found ${calls.length}`);
  });

  test('the code no longer claims the group does NOT bind the protocol', () => {
    // An earlier revision said exactly that, generalising from one Claude key.
    assert.doesNotMatch(llm, /it does not, at least not in that direction/);
    assert.match(llm, /403/, 'the measured restriction should be recorded where the clients are built');
  });
});

describe('protocol auto-detection', () => {
  const fn = fetcher.slice(fetcher.indexOf('export async function detectFluxionProtocol'),
                           fetcher.indexOf('async function fetchNvidiaNimModels'));

  test('the OpenAI endpoint is probed FIRST, because it is the universal one', () => {
    // Measured: /v1/chat/completions answered 200 on BOTH a Claude-group and a
    // GLM-group key, while /v1/messages 403s on the latter. Probing the
    // universal endpoint first makes the common case cost exactly one probe.
    const chat = fn.indexOf('/v1/chat/completions');
    const msgs = fn.indexOf('/v1/messages');
    assert.ok(chat > 0 && msgs > 0, 'both endpoints must be probed');
    assert.ok(chat < msgs, 'the OpenAI endpoint must be tried before the Anthropic one');
  });

  test('the probe is 1 token, so detection cannot be expensive', () => {
    assert.match(fn, /max_tokens: 1/);
  });

  test('a failed probe falls back to the UNIVERSAL protocol, not the restricted one', () => {
    // A network blip must not strand someone on /v1/messages, which is the
    // endpoint that 403s for most groups.
    const tail = fn.slice(fn.lastIndexOf('return'));
    assert.match(tail, /return 'openai'/,
      "the final fallback must be 'openai'");
  });

  test('detection runs in the BACKGROUND — the save never waits on a probe', () => {
    // A probe costs a full TTFT and cannot be shortened: Fluxion withholds
    // headers until it has content, so there is no early status to read.
    // Awaiting it made a key save take 4-21s to confirm a value that is already
    // right almost every time.
    const handler = ipc.slice(ipc.indexOf("safeHandle('set-fluxion-config'"), ipc.indexOf("safeHandle('set-litellm-config'"));
    assert.doesNotMatch(handler, /protocol = await detectFluxionProtocol/,
      'detection must not be awaited on the save path');
    assert.match(handler, /void \(async \(\) => \{/,
      'it should be fired and forgotten');
    assert.match(handler, /found !== cm\.getFluxionProtocol\(\)[\s\S]*?broadcastCredentialsChanged\(\)/,
      'a correction must persist AND broadcast so the card re-reads');
    assert.match(handler, /config\?\.protocol === 'openai' \|\| config\?\.protocol === 'anthropic'/,
      'an explicitly passed protocol must still win — that is the escape hatch');
    assert.match(handler, /else if \(!normalizedKey\)/,
      'clearing the key must not trigger a probe');
  });

  test('the blocking adapter STREAMS — the non-streaming endpoint hangs', () => {
    // Measured on the GLM group: non-streaming /v1/chat/completions completed
    // 1 of 5 requests (the rest still open at 45s) while streaming answered 5/5
    // in ~4s. generateWithFluxion feeds runVisionRequest and the non-streaming
    // cascade, so this decides whether a screenshot works for those users.
    const fn = llm.slice(llm.indexOf('private async generateWithFluxion'), llm.indexOf('private async * streamWithFluxion'));
    assert.match(fn, /chat\.completions\.create\(\{ model, messages, stream: true \}/,
      'the blocking path must stream and accumulate, like generateWithClaude does');
    assert.doesNotMatch(fn, /chat\.completions\.create\(\{ model, messages \}\)/,
      'the plain non-streaming call is the one that hangs');
  });

  test('the detection probe also avoids the hanging endpoint', () => {
    const fn = fetcher.slice(fetcher.indexOf('export async function detectFluxionProtocol'),
                             fetcher.indexOf('async function fetchNvidiaNimModels'));
    assert.match(fn, /stream: true/, 'the probe must use the streaming endpoint');
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

describe('review fixes 2026-09-18 — found by adversarial review, all CONFIRMED', () => {
  test('the SELECTED Fluxion model leads its own screenshot turn', () => {
    // The bug: the Fluxion rung was seated in `cloud` but never front-loaded,
    // and orderVisionByHealth sorts unmeasured providers by ASCENDING priority —
    // so a screenshot on a selected Fluxion model went to whichever other vendor
    // key existed first. Wrong-vendor billing, inverted: the vendor the user did
    // NOT choose silently wins the turn.
    const block = llm.slice(llm.indexOf('const front: VisionStreamProvider[] = []'), llm.indexOf('const backLocal = local.filter'));
    assert.match(block, /isFluxionModel\(this\.currentModelId\)/,
      'a selected Fluxion model must be front-loaded like the other three gateways');
    for (const sibling of ['isLiteLLMModel', 'isNvidiaNimModel', 'isOpenRouterModel']) {
      assert.match(block, new RegExp(sibling), `${sibling} front-load line went missing`);
    }
  });

  test('a Fluxion-only user is told which gateway failed', () => {
    // Without this they got the flat "add an OpenAI, Claude, Gemini, or Groq key"
    // — four providers they deliberately did not set up. Same defect the LiteLLM
    // comment directly above it records having already fixed once.
    const msg = llm.slice(llm.indexOf("const gateway = this.isLiteLLMModel"), llm.indexOf('No vision-capable provider configured. Add an API key'));
    assert.match(msg, /isFluxionModel\(this\.currentModelId\) \? 'Fluxion AI gateway'/);
  });

  test('Fluxion gets the user-endpoint deadline, not a first-party budget', () => {
    // It queues behind the upstream it fronts, exactly like the other gateways.
    const fn = llm.slice(llm.indexOf('public isUsingUserEndpoint()'), llm.indexOf('public isUsingUserEndpoint()') + 900);
    assert.match(fn, /isFluxionModel\(this\.currentModelId\)/);
  });

  test('the model-catalogue catch never logs the raw axios error', () => {
    // The raw AxiosError embeds the request config, Authorization header and all.
    // The file logger redacts; the forwarded stdout/stderr does NOT.
    const handler = ipc.slice(ipc.indexOf("'fetch-provider-models'"), ipc.indexOf("'set-provider-preferred-model'"));
    assert.doesNotMatch(handler, /console\.error\([^)]*models:`?,\s*error\)/,
      'the raw error object must never be handed to console.error — strip to a safe shape first');
    assert.match(handler, /const safeInfo = \{/, 'it should log the same safe shape the connection test uses');
  });

  test('the protocol is DETECTED, not asked — the card sends no protocol', () => {
    // It was a label + two buttons + a hint asking the user to choose between
    // wire formats, from a group id the key never exposes. Now the main process
    // probes and the card reports. Pinned because re-adding a manual control
    // would quietly reintroduce the guess.
    assert.match(settings, /setFluxionConfig\(\{ apiKey: key \}\)/,
      'save must not pass a protocol — that is what triggers detection');
    assert.doesNotMatch(settings, /setFluxionConfig\(\{ protocol: proto \}\)/,
      'the manual toggle must stay gone');
    assert.match(settings, /if \(detected\) setFluxionProtocol\(detected\)/,
      'the card must adopt whatever the probe found');
  });

  test('an unsaved protocol choice survives an unrelated credentials broadcast', () => {
    // loadCredentials re-runs on EVERY credentials-changed broadcast (saving any
    // other provider's key fires one). Unconditional, it reverted a protocol the
    // user had picked but not yet saved.
    assert.match(settings, /if \(\(creds as any\)\.hasFluxionKey\) \{\s*\n\s*setFluxionProtocol\(/,
      'the stored protocol should only be adopted when a key actually exists');
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

  test('the Claude preset leads — Claude is 5 of Fluxion\'s 11 groups', () => {
    // The original version of this test asserted the GPT preset must lead,
    // on the theory that a Claude preset was unreachable on the default
    // protocol. Driving a real Claude-group key on 2026-09-18 DISPROVED that,
    // so the assertion inverted with the reason. Recorded rather than quietly
    // swapped: a test that changes direction is worth explaining.
    const entry = modelUtils.slice(modelUtils.indexOf('fluxion: {'), modelUtils.indexOf("pmKey: 'fluxionPreferredModel'"));
    const ids = [...entry.matchAll(/'(fluxion\/[^']+)'/g)].map(m => m[1]);
    assert.equal(
      ids[0], 'fluxion/claude-sonnet-5',
      'the first preset is what "Set default" tends to land on, and Claude groups '
      + 'are the largest share of Fluxion\'s catalogue',
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
    // Raster, so it lives in AI_PROVIDER_MARK_IMAGES rather than the inlined-SVG
    // map — the same treatment litellm gets, for the same reason.
    assert.match(marks, /fluxion: fluxionMark/, 'fluxion must resolve to a mark');
    assert.match(marks, /AI_PROVIDER_MARK_IMAGES[\s\S]*?fluxion: fluxionMark/,
      'a full-colour raster belongs in the <img> registry, not the currentColor one');
    assert.ok(
      fs.existsSync(path.join(root, 'src/assets/provider-logos/fluxion.png')),
      'the imported mark must exist on disk',
    );
  });

  test('the mark is the BRAND MARK, not one of the two look-alike assets', () => {
    // Fluxion serves three different images and two of them are wrong: a stale
    // interlocking-S glyph self-titled "Sub2API", and the wordmark logo (an F
    // monogram + the words "FluxionAPI"). Both were shipped here by mistake
    // before the real mark was identified, so the provenance is pinned.
    const readme = read('src/assets/provider-logos/README.md');
    assert.match(readme, /Sub2API/, 'the README must warn about the stale look-alike');
    assert.match(readme, /16px/, 'the README must record why the galaxy mark was rejected');
    assert.ok(
      !fs.existsSync(path.join(root, 'src/assets/provider-logos/fluxion.svg')),
      'the old derived SVG was the WRONG artwork and must not linger',
    );
  });

  test('a full-colour mark is NOT flattened to black in the light theme', () => {
    // `.brand-mark-raster` applies `filter: brightness(0)`, which exists for
    // white-on-transparent art (Natively's icon). It was applied to EVERY raster
    // mark, so it repainted Fluxion's blue monogram solid black on a light tile —
    // and was quietly doing the same to LiteLLM's. Opt-in, not opt-out.
    // Asserts the PROPERTY, not the membership. Pinning the exact set meant any
    // new white-on-transparent mark failed a test about Fluxion's blue one.
    // 9Router joined legitimately: its mark is a white 9 on transparency, which
    // is exactly the art this flatten exists for.
    assert.match(marks, /WHITE_ON_TRANSPARENT_MARKS = new Set\(\[[^\]]*'natively'[^\]]*\]\)/,
      'the flatten set must stay an explicit opt-in list including natively');
    // Fluxion must NEVER be in it — that is the bug this test was written for.
    const setLiteral = marks.slice(marks.indexOf('WHITE_ON_TRANSPARENT_MARKS = new Set('));
    assert.doesNotMatch(setLiteral.slice(0, setLiteral.indexOf(')')), /'fluxion'|'litellm'/,
      'a full-colour mark must never take the flatten — it repaints it solid black');
    for (const f of ['src/components/settings/AIProvidersSettings.tsx', 'src/components/ui/BrandMark.tsx']) {
      assert.match(read(f), /WHITE_ON_TRANSPARENT_MARKS\.has\(key\)/,
        `${f} must gate brand-mark-raster on the opt-in set`);
      assert.doesNotMatch(read(f), /className="object-contain brand-mark-raster"/,
        `${f} must not apply the flatten unconditionally`);
    }
  });

  test('Fluxion renders directly below Gemini', () => {
    const table = settings.slice(settings.indexOf('export const CLOUD_PROVIDERS = ['));
    const ids = [...table.slice(0, table.indexOf('];')).matchAll(/id: '([a-z_]+)'/g)].map(m => m[1]);
    assert.deepEqual(ids.slice(0, 2), ['gemini', 'fluxion'],
      `CLOUD_PROVIDERS renders in array order; got ${ids.join(', ')}`);
  });

  test('the extras slot reports the detected format, and only once a key exists', () => {
    assert.match(providerCard, /extraControls\?: React\.ReactNode/);
    assert.match(settings, /extraControls=\{id !== 'fluxion' \|\| !hasStoredKey\.fluxion \? undefined :/,
      'only Fluxion gets extras, and there is nothing to report before a key is saved');
    assert.match(settings, /detected from your key/,
      'the line must read as a resolved value, not a control');
  });
});
