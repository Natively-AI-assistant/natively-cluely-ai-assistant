/**
 * OpenRouter as a first-class AI provider.
 *
 * The defects this pins are all ORDERING and NAMESPACING defects. OpenRouter's
 * model ids are vendor-namespaced (`openai/gpt-oss-120b`, `anthropic/claude-sonnet-5`),
 * which collides head-on with three existing classifiers:
 *
 *   1. isKnownGroqModel() — `openai/gpt-oss-120b` is literally in Groq's catalogue
 *   2. providerFamily()'s `modelId.includes('openai')` catch-all
 *   3. stripProviderRoutingPrefix(), which takes TWO segments, not one
 *
 * Get any of them wrong and an OpenRouter request is billed to another vendor's
 * key, or refused as a text-only model. Source assertions are used where the
 * logic lives inside an un-importable IPC closure; everything importable is
 * exercised for real.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ipc = read('electron/ipcHandlers.ts');
const llm = read('electron/LLMHelper.ts');
const fetcher = read('electron/utils/modelFetcher.ts');
const caps = read('electron/llm/modelCapabilities.ts');
const settings = read('src/components/settings/AIProvidersSettings.tsx');
const providerCard = read('src/components/settings/ProviderCard.tsx');

/** providerFamily()'s body — the ordered if-chain that classifies a model id. */
const providerFamilySource = () => {
  const start = ipc.indexOf('const providerFamily = (modelId: string): string => {');
  assert.ok(start >= 0, 'providerFamily() should exist');
  return ipc.slice(start, ipc.indexOf('\n      };', start));
};

const modelAvailableSource = () => {
  const start = ipc.indexOf('const modelAvailable = (modelId: string): boolean => {');
  assert.ok(start >= 0, 'modelAvailable() should exist');
  // Anchored on the closure's own terminator, like providerFamilySource above.
  // It previously ended on `ipc.indexOf('if (modelAvailable(defaultModel)) return null;')`,
  // a CALL SITE that has since gained a guard and now reads
  // `if (!isRetiredId(defaultModel) && modelAvailable(defaultModel))`. indexOf
  // returned -1, `slice(start, -1)` ran to the end of a 17k-line file, and every
  // ordering assertion below was matching against the whole of ipcHandlers.ts
  // rather than this function — the third time this suite has been bitten by
  // pinning a slice to a line that was free to move.
  const end = ipc.indexOf('\n      };', start);
  assert.ok(end > start, 'modelAvailable() should terminate');
  return ipc.slice(start, end);
};

// The bound is load-bearing, so it is CHECKED rather than assumed: if the slice
// ever runs long again, these assertions silently start matching unrelated code
// and the suite goes green against a broken ordering.
test('the sliced sources are actually bounded to their functions', () => {
  for (const [label, src] of [['providerFamily', providerFamilySource()], ['modelAvailable', modelAvailableSource()]]) {
    assert.ok(src.length < 6000, `${label} slice is ${src.length} chars — it has escaped its function`);
    assert.ok(!src.includes('safeHandle('), `${label} slice reaches into the IPC handlers below it`);
  }
});

describe('the openrouter/ prefix is classified BEFORE the vendor catch-alls', () => {
  // Both functions are ordered if-chains, so "correct" here is a matter of
  // POSITION, not presence. An assertion that only checked presence would pass
  // against a version that classifies openrouter last and is completely broken.
  const requireOrdering = (src, label, openrouterNeedle, laterNeedles) => {
    const at = src.indexOf(openrouterNeedle);
    assert.ok(at >= 0, `${label} must classify openrouter/ ids (looked for: ${openrouterNeedle})`);
    for (const needle of laterNeedles) {
      const other = src.indexOf(needle);
      assert.ok(other >= 0, `${label}: expected to find ${needle}`);
      assert.ok(
        at < other,
        `${label}: the openrouter/ check must come BEFORE ${needle} — ` +
        'OpenRouter ids are vendor-namespaced, so a later check claims them first ' +
        'and the request is gated by (and billed to) the wrong provider key',
      );
    }
  };

  test('providerFamily() returns openrouter before the groq/openai branches', () => {
    requireOrdering(
      providerFamilySource(),
      'providerFamily()',
      "if (modelId.startsWith('openrouter/')) return 'openrouter';",
      ['isKnownGroqModel(modelId)', "modelId.includes('openai')"],
    );
  });

  test('modelAvailable() gates openrouter on its own key, before the groq/openai branches', () => {
    requireOrdering(
      modelAvailableSource(),
      'modelAvailable()',
      "if (modelId.startsWith('openrouter/')) return has(cm.getOpenrouterApiKey());",
      ['isKnownGroqModel(modelId)', "modelId.includes('openai')"],
    );
  });

  test('LLMHelper picks the provider for a direct request before the vendor predicates', () => {
    const start = llm.indexOf("if (selected === 'natively') provider = 'natively';");
    assert.ok(start >= 0, 'the direct-assist provider selection chain should exist');
    const chain = llm.slice(start, start + 2000);
    const at = chain.indexOf('isOpenRouterModel(selected)');
    assert.ok(at >= 0, 'the chain must classify OpenRouter models');
    for (const needle of ['isGroqModel(selected)', 'isOpenAiModel(selected)']) {
      assert.ok(at < chain.indexOf(needle), `isOpenRouterModel must be tested before ${needle}`);
    }
  });
});

describe('the two prefix strips are different, and both are load-bearing', () => {
  // ONE segment for the wire, TWO for the capability table. Conflating them is
  // the single likeliest way to break this provider.
  test('the capability strip takes TWO segments, so a bare vendor model is recognised', async () => {
    const mod = await import(path.join(root, 'dist-electron/electron/llm/modelCapabilities.js'));
    assert.equal(mod.stripProviderRoutingPrefix('openrouter/anthropic/claude-sonnet-5'), 'claude-sonnet-5');
    assert.equal(mod.stripProviderRoutingPrefix('openrouter/openai/gpt-5.6-terra'), 'gpt-5.6-terra');
    assert.equal(mod.stripProviderRoutingPrefix('openrouter/google/gemini-3.8-flash'), 'gemini-3.8-flash');
  });

  test('every shipped preset resolves to a cloud model that supports images', async () => {
    // Directly guards the comment in STANDARD_CLOUD_MODELS.openrouter. A preset
    // whose bare name the table does not know resolves text-only, and Code Hint
    // then refuses every screenshot on a fresh OpenRouter setup.
    const mod = await import(path.join(root, 'dist-electron/electron/llm/modelCapabilities.js'));
    const presets = [
      'openrouter/anthropic/claude-sonnet-5',
      'openrouter/openai/gpt-5.6-terra',
      'openrouter/google/gemini-3.8-flash',
    ];
    for (const id of presets) {
      const c = mod.getModelCapabilities(id, false);
      assert.equal(c.supportsImages, true, `${id} should resolve as image-capable`);
    }
  });

  test('the ROUTING_PREFIX_RE admits openrouter alongside the other gateways', () => {
    const m = caps.match(/const ROUTING_PREFIX_RE = ([^\n]+)/);
    assert.ok(m, 'ROUTING_PREFIX_RE should exist');
    assert.match(m[1], /openrouter/, 'openrouter must be a stripped routing prefix');
  });

  test('the WIRE id keeps the vendor segment — only `openrouter/` comes off', () => {
    const start = llm.indexOf('private openrouterWireModel(');
    assert.ok(start >= 0, 'openrouterWireModel() should exist');
    const fn = llm.slice(start, start + 220);
    assert.match(fn, /replace\(\/\^openrouter\\\/\/, ''\)/,
      'the wire id must strip exactly one segment; OpenRouter expects `anthropic/claude-sonnet-5`');
    assert.doesNotMatch(fn, /stripProviderRoutingPrefix/,
      'the two-segment strip would send `claude-sonnet-5`, which OpenRouter 404s');
  });

  test('direct-assist does NOT pre-strip openrouter before the capability lookup', () => {
    // Pre-stripping leaves `anthropic/claude-sonnet-5`, which is no longer a
    // routing prefix — so nothing removes the vendor segment and the model
    // resolves as unknown/text-only.
    for (const [label, src] of [['LLMHelper', llm], ['requestBuilder', read('electron/direct-assist/requestBuilder.ts')]]) {
      assert.doesNotMatch(
        src,
        /provider === 'openrouter'\s*\?\s*\w+\.replace\(\/\^openrouter/,
        `${label} must let getModelCapabilities() do the stripping`,
      );
    }
  });
});

describe('the in-band SSE error is detected', () => {
  test('the stream loop checks for an error BEFORE reading the delta', () => {
    const start = llm.indexOf('private async * streamWithOpenRouter(');
    assert.ok(start >= 0, 'streamWithOpenRouter() should exist');
    const fn = llm.slice(start, llm.indexOf('\n  }', llm.indexOf('for await', start)));
    const check = fn.indexOf('assertNoOpenRouterStreamError');
    const delta = fn.indexOf('delta?.content');
    assert.ok(check >= 0, 'the stream must inspect chunks for an in-band error');
    assert.ok(check < delta, 'the error check must precede the content read');
  });

  test('both an `error` payload and finish_reason=error throw', () => {
    const start = llm.indexOf('private assertNoOpenRouterStreamError(');
    assert.ok(start >= 0, 'assertNoOpenRouterStreamError() should exist');
    const fn = llm.slice(start, llm.indexOf('\n  }', start));
    assert.match(fn, /chunk\?\.error/, 'an error payload must be detected');
    assert.match(fn, /finish_reason === 'error'/, 'a finish_reason=error must be detected');
    // Two throws, but not two LIVE throws on every path: openai@6.38 already
    // raises APIError on a streamed chunk carrying `error`, so mid-stream only
    // the finish_reason branch is reachable. The blocking path needs both.
    assert.equal((fn.match(/throw new Error/g) || []).length, 2, 'both shapes must THROW, so the fallback chain engages');
  });

  test('the blocking path checks the same shape', () => {
    const start = llm.indexOf('private async generateWithOpenRouter(');
    assert.ok(start >= 0, 'generateWithOpenRouter() should exist');
    const fn = llm.slice(start, llm.indexOf('\n  }', start));
    assert.match(fn, /assertNoOpenRouterStreamError/);
  });
});

describe('the outbound boundary and the disabled-provider switch reach OpenRouter', () => {
  test('both executors assert outbound scopes under the `openrouter` family id', () => {
    // The DEFINITION, not the first call site: runVisionRequest's
    // `case 'openrouter'` mentions generateWithOpenRouter earlier in the file.
    for (const name of ['private async generateWithOpenRouter(', 'private async * streamWithOpenRouter(']) {
      const start = llm.indexOf(name);
      assert.ok(start >= 0, `${name} should exist`);
      const fn = llm.slice(start, llm.indexOf('\n  }', start));
      assert.match(fn, /assertOutboundScopes\('openrouter'/, `${name} must pass the boundary`);
    }
  });

  test('the client accessor honours the disabled-provider switch', () => {
    assert.match(
      llm,
      /private get openrouterClient\(\): OpenAI \| null \{ return this\.isProviderDisabled\('openrouter'\) \? null : this\._openrouterClient \}/,
      'switching OpenRouter off in Settings must null the client, like every other provider',
    );
  });

  test('the family id is the one the UI writes', () => {
    // providerFamily(), isProviderDisabled() and the CLOUD_PROVIDERS row must
    // all spell it identically or the switch silently no-ops.
    const table = settings.match(/export const CLOUD_PROVIDERS = \[([\s\S]*?)\n\];/)[1];
    assert.match(table, /id: 'openrouter' as const/);
  });
});

describe('the gateway catalogue never floods the picker', () => {
  test('ProviderCard forwards the opt-in flag to the model list', () => {
    // Without this every cloud card defaults to optIn=false, so OpenRouter's
    // empty allow-list would read as "All" and put the whole catalogue into
    // routing the first time the list is opened (onFirstOpen auto-fetches).
    assert.match(providerCard, /optIn=\{isOptInModelProvider\(providerId\)\}/);
  });

  test('"Set default" allow-lists the model for an opt-in provider', () => {
    // Reproduced live 2026-09-17: the preference was stored but the empty opt-in
    // allow-list was left alone, so the default never reached the overlay picker.
    const start = settings.indexOf('const handleSetDefaultModel = async');
    const fn = settings.slice(start, settings.indexOf('\n    };', start));
    assert.match(fn, /const needsAllow = isOptInModelProvider\(provider\)\s*\?\s*!current\.includes\(modelId\)/);
  });

  test('a catalogue fetch never adopts a default for an opt-in provider', () => {
    // Reproduced live 2026-09-17: with no default, fetching OpenRouter's catalogue
    // wrote openrouter/aion-labs/aion-2.0 (alphabetically first, not ticked) as
    // the provider default.
    const start = providerCard.indexOf('const handleFetchModels = async');
    const fn = providerCard.slice(start, providerCard.indexOf('\n    };', start));
    const gate = fn.indexOf('!isOptInModelProvider(providerId)');
    assert.ok(gate >= 0, 'the auto-adopt must be gated on the provider not being opt-in');
    assert.ok(gate < fn.indexOf('setProviderPreferredModel('), 'the gate must precede the write');
  });

  test('the fetcher prefixes every id and drops the duplicate :batch rows', () => {
    const start = fetcher.indexOf('async function fetchOpenRouterModels(');
    assert.ok(start >= 0, 'fetchOpenRouterModels() should exist');
    const fn = fetcher.slice(start, fetcher.indexOf('\n}', start));
    assert.match(fn, /openrouter\.ai\/api\/v1\/models/);
    assert.match(fn, /endsWith\(':batch'\)/, ':batch ids duplicate the base model on a non-streaming endpoint');
    assert.match(fn, /id: `openrouter\/\$\{m\.id\}`/, 'ids must carry the routing prefix or they collide with Groq/OpenAI');
  });
});

describe('the shared key is not silently torn down', () => {
  test('clearing the key reports whether retrieval was deactivated', () => {
    const start = ipc.indexOf("safeHandle('set-openrouter-api-key'");
    assert.ok(start >= 0, 'the key handler should exist');
    const handler = ipc.slice(start, ipc.indexOf("safeHandle('set-litellm-config'", start));
    assert.match(handler, /retrievalDeactivated/, 'the handler must report the coupling');
    // Read BEFORE the write, or setOpenrouterApiKey's own revert has already
    // moved the reranker to local and there is nothing left to report.
    assert.ok(
      handler.indexOf('retrievalDeactivated =') < handler.indexOf('cm.setOpenrouterApiKey('),
      'retrieval state must be sampled BEFORE the credential write triggers the revert',
    );
  });

  test('a REFUSED credential write is reported as a failure and never reaches the live client', () => {
    // Reproduced live 2026-09-17: with an undecryptable credentials.enc the store
    // refused the write, yet the handler answered success:true and LLMHelper got
    // the key anyway — the card read "Saved" for a key gone after a restart.
    const start = ipc.indexOf("safeHandle('set-openrouter-api-key'");
    const handler = ipc.slice(start, ipc.indexOf("safeHandle('set-litellm-config'", start));
    const write = handler.indexOf('const saved = cm.setOpenrouterApiKey(');
    const refusal = handler.indexOf("error: 'credential_store_degraded'");
    const liveClient = handler.indexOf('getLLMHelper().setOpenrouterApiKey(');
    assert.ok(write >= 0, 'the setter result must be captured');
    assert.ok(refusal > write, 'a refused write must return credential_store_degraded');
    assert.ok(refusal < liveClient, 'the refusal must return BEFORE the live client is given the key');
    assert.match(handler.slice(write, refusal), /if \(saved === false\)/);
  });

  test('the card shows a refused save/remove instead of silently stopping', () => {
    assert.match(settings, /keyWriteFailureText\(result as any, 'save'\)/);
    assert.match(settings, /keyWriteFailureText\(result as any, 'remove'\)/);
    assert.match(providerCard, /keyWriteError \|\| testError \|\| /, 'a refused write outranks the other notes');
  });

  test('the key handler waits for the retrieval activation BEFORE broadcasting', () => {
    // Reproduced live 2026-09-17: the save answered and broadcast while the
    // OpenRouter reranker activation was still in flight, so the panel re-read
    // reranker 'local' and the remove dialog never warned about retrieval.
    const start = ipc.indexOf("safeHandle('set-openrouter-api-key'");
    const handler = ipc.slice(start, ipc.indexOf("safeHandle('set-litellm-config'", start));
    const settle = handler.indexOf('await cm.whenHostedRetrievalSettled()');
    assert.ok(settle > handler.indexOf('const saved = cm.setOpenrouterApiKey('), 'settle must follow the write');
    assert.ok(settle < handler.indexOf('broadcastCredentialsChanged()'), 'settle must precede the broadcast');
  });

  test('the remove dialog re-reads the retrieval coupling when it opens', () => {
    const start = settings.indexOf('const handleRemoveKey = async');
    assert.ok(start >= 0, 'handleRemoveKey must be able to await a fresh read');
    const fn = settings.slice(start, settings.indexOf('const performRemoveKey', start));
    assert.ok(
      fn.indexOf('refreshOpenrouterRetrievalCoupling()') < fn.indexOf('setPendingConfirm('),
      'the coupling must be refreshed before the dialog renders its copy',
    );
    assert.match(fn, /setTimeout\(resolve, 1000\)/, 'the fresh read must be bounded so the trash button never hangs');
  });

  test('the same key is loaded at boot, so an embeddings user gets chat for free', () => {
    assert.match(
      read('electron/ProcessingHelper.ts'),
      /if \(openrouterKey\) this\.llmHelper\.setOpenrouterApiKey\(openrouterKey\);/,
    );
  });

  test('an OpenRouter-only user gets a usable default when another provider dies', () => {
    // Without a rung here `next` resolves to null for a user whose only working
    // provider is OpenRouter, so the stored default stays pinned to the dead
    // model and routing reports "No AI providers configured".
    const fn = modelAvailableSource();
    const ladder = ipc.slice(ipc.indexOf('const next = defaultModel.startsWith('), ipc.indexOf('if (!next) {'));
    assert.match(ladder, /openrouterFallbackModel && modelAvailable\(openrouterFallbackModel\)/,
      'the reconciliation ladder must be able to land on OpenRouter');
    // Gated by modelAvailable(), never a raw key check: that is what keeps the
    // opt-in allow-list and the disabled switch authoritative for the default.
    assert.doesNotMatch(ladder, /getOpenrouterApiKey/,
      'the fallback must go through modelAvailable(), not a raw credential read');
    assert.ok(fn.length > 0, 'sanity: modelAvailable() was located');
  });

  test('the remove dialog warns before the click, not after', () => {
    assert.match(settings, /alsoDisablesRetrieval/, 'the confirmation must explain the retrieval coupling');
  });
});
