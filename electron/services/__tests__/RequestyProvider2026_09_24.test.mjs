/**
 * Requesty as an AI provider, wired the same way as OpenRouter.
 *
 * Requesty ids come in two shapes, and both reach the classifiers:
 *
 *   1. catalogue ids, vendor-namespaced like OpenRouter's (`openai/gpt-4o-mini`)
 *   2. managed policy ids, bare vendor names (`claude-sonnet-5`, `gpt-5.6-terra`)
 *
 * Either one without the `requesty/` routing prefix is claimed by Groq, OpenAI,
 * Claude or Gemini and billed to that key. So, as in the OpenRouter suite, most
 * of this is ORDERING: the prefix check has to win. Everything importable is
 * executed; logic inside the IPC closure is asserted on bounded source slices.
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
const modelUtils = read('src/utils/modelUtils.ts');
const vision = read('electron/services/screen/VisionProviderRegistry.ts');

const sliceTo = (src, startNeedle, endNeedle) => {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} should exist`);
  const end = src.indexOf(endNeedle, start);
  assert.ok(end > start, `${startNeedle} should terminate`);
  return src.slice(start, end);
};

const providerFamilySource = () => sliceTo(ipc, 'const providerFamily = (modelId: string): string => {', '\n      };');
const modelAvailableSource = () => sliceTo(ipc, 'const modelAvailable = (modelId: string): boolean => {', '\n      };');
const keyHandlerSource = () => sliceTo(ipc, "safeHandle('set-requesty-api-key'", '\n  });');

test('the sliced sources are actually bounded to their functions', () => {
  for (const [label, src] of [
    ['providerFamily', providerFamilySource()],
    ['modelAvailable', modelAvailableSource()],
    ['set-requesty-api-key', keyHandlerSource()],
  ]) {
    assert.ok(src.length < 6000, `${label} slice is ${src.length} chars, it has escaped its function`);
    assert.ok(!src.slice(1).includes('safeHandle('), `${label} slice reaches into another IPC handler`);
  }
});

describe('the requesty/ prefix is classified BEFORE the vendor catch-alls', () => {
  const requireOrdering = (src, label, needle, laterNeedles) => {
    const at = src.indexOf(needle);
    assert.ok(at >= 0, `${label} must classify requesty/ ids (looked for: ${needle})`);
    for (const later of laterNeedles) {
      const other = src.indexOf(later);
      assert.ok(other >= 0, `${label}: expected to find ${later}`);
      assert.ok(at < other, `${label}: the requesty/ check must come BEFORE ${later}`);
    }
  };

  test('providerFamily() returns requesty before the groq/openai branches', () => {
    requireOrdering(
      providerFamilySource(),
      'providerFamily()',
      "if (modelId.startsWith('requesty/')) return 'requesty';",
      ['isKnownGroqModel(modelId)', "modelId.includes('openai')"],
    );
  });

  test('modelAvailable() gates requesty on its own key, before the groq/openai branches', () => {
    requireOrdering(
      modelAvailableSource(),
      'modelAvailable()',
      "if (modelId.startsWith('requesty/')) return has(cm.getRequestyApiKey());",
      ['isKnownGroqModel(modelId)', "modelId.includes('openai')"],
    );
  });

  test('LLMHelper picks the provider for a direct request before the vendor predicates', () => {
    const start = llm.indexOf("if (selected === 'natively') provider = 'natively';");
    assert.ok(start >= 0, 'the direct-assist provider selection chain should exist');
    const chain = llm.slice(start, start + 2000);
    const at = chain.indexOf('isRequestyModel(selected)');
    assert.ok(at >= 0, 'the chain must classify Requesty models');
    for (const needle of ['isGroqModel(selected)', 'isOpenAiModel(selected)']) {
      assert.ok(at < chain.indexOf(needle), `isRequestyModel must be tested before ${needle}`);
    }
  });

  test('isOpenAiModel() refuses requesty ids', () => {
    const fn = sliceTo(llm, 'private isOpenAiModel(', '\n  }');
    assert.match(fn, /if \(this\.isRequestyModel\(modelId\)\) return false;/);
  });

  test('Requesty is on the opt-in allow-list in both places that keep one', () => {
    assert.match(ipc, /const optInFamily = [^\n]*family === 'requesty'/);
    assert.match(modelUtils, /export const isOptInModelProvider = [^\n]*provider === 'requesty'/);
  });
});

describe('the capability strip and the wire strip', () => {
  test('the capability strip resolves both id shapes to the bare model', async () => {
    const mod = await import(path.join(root, 'dist-electron/electron/llm/modelCapabilities.js'));
    assert.equal(mod.stripProviderRoutingPrefix('requesty/openai/gpt-4o-mini'), 'gpt-4o-mini');
    assert.equal(mod.stripProviderRoutingPrefix('requesty/claude-sonnet-5'), 'claude-sonnet-5');
    assert.equal(mod.stripProviderRoutingPrefix('requesty/gpt-5.6-terra'), 'gpt-5.6-terra');
  });

  test('every shipped preset resolves to a cloud model that supports images', async () => {
    const mod = await import(path.join(root, 'dist-electron/electron/llm/modelCapabilities.js'));
    const block = sliceTo(modelUtils, 'requesty: {', '\n    },');
    const presets = [...block.matchAll(/'(requesty\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(presets.length >= 1, 'STANDARD_CLOUD_MODELS.requesty should ship presets');
    for (const id of presets) {
      assert.equal(mod.getModelCapabilities(id, false).supportsImages, true, `${id} should resolve as image-capable`);
    }
  });

  test('the ROUTING_PREFIX_RE admits requesty alongside the other gateways', () => {
    const m = caps.match(/const ROUTING_PREFIX_RE = ([^\n]+)/);
    assert.ok(m, 'ROUTING_PREFIX_RE should exist');
    assert.match(m[1], /requesty/);
  });

  test('the WIRE id strips only `requesty/`, never the vendor segment', () => {
    const fn = sliceTo(llm, 'private requestyWireModel(', '\n  }');
    assert.match(fn, /replace\(\/\^requesty\\\/\/, ''\)/);
    assert.doesNotMatch(fn, /stripProviderRoutingPrefix/,
      'the capability strip would send `gpt-4o-mini`, dropping the vendor Requesty needs');
  });
});

describe('the executors', () => {
  for (const name of ['private async generateWithRequesty(', 'private async * streamWithRequesty(']) {
    test(`${name} honours local-only mode, the outbound boundary and in-band errors`, () => {
      const fn = sliceTo(llm, name, '\n  }\n');
      assert.match(fn, /if \(this\.isLocalOnlyMode\) throw/);
      assert.match(fn, /assertOutboundScopes\('requesty'/);
      assert.match(fn, /this\.rateLimiters\.requesty\.acquire\(\)/);
      assert.match(fn, /assertNoRequestyStreamError/);
      assert.doesNotMatch(fn, /response_format/, 'an explicit text response_format is rejected upstream');
    });
  }

  test('the stream checks for an error BEFORE reading the delta', () => {
    const fn = sliceTo(llm, 'private async * streamWithRequesty(', '\n  }\n');
    assert.ok(fn.indexOf('assertNoRequestyStreamError') < fn.indexOf('delta?.content'));
  });

  test('both an `error` payload and finish_reason=error throw', () => {
    const fn = sliceTo(llm, 'private assertNoRequestyStreamError(', '\n  }');
    assert.match(fn, /chunk\?\.error/);
    assert.match(fn, /finish_reason === 'error'/);
    assert.equal((fn.match(/throw new Error/g) || []).length, 2);
  });

  test('the client accessor honours the disabled-provider switch', () => {
    assert.match(
      llm,
      /private get requestyClient\(\): OpenAI \| null \{ return this\.isProviderDisabled\('requesty'\) \? null : this\._requestyClient \}/,
    );
  });

  test('the client targets the Requesty router', () => {
    assert.match(llm, /const REQUESTY_BASE_URL = "https:\/\/router\.requesty\.ai\/v1"/);
    assert.match(llm, /baseURL: REQUESTY_BASE_URL/);
  });

  test('the family id is the one the UI writes', () => {
    const table = settings.match(/export const CLOUD_PROVIDERS = \[([\s\S]*?)\n\];/)[1];
    assert.match(table, /id: 'requesty' as const/);
  });
});

describe('Requesty is only ever an explicit choice', () => {
  test('the stream cascade adds Requesty only when a requesty/ model is selected', () => {
    const at = llm.indexOf("cloud.push({ id: 'requesty'");
    assert.ok(at >= 0, 'the stream cascade should know Requesty');
    const guard = llm.lastIndexOf('if (', at);
    assert.match(llm.slice(guard, at), /this\.isRequestyModel\(this\.currentModelId\) && this\.requestyClient/);
  });

  test('the vision rung is gated on the selected model', () => {
    const fn = sliceTo(vision, 'function requesty(', '\n}');
    assert.match(fn, /const isSelected = \/\^requesty\\\/\/i\.test\(activeModelId\);/);
  });

  test('the default-model reconciliation ladder can recover onto the preferred Requesty model', () => {
    const ladder = ipc.slice(ipc.indexOf('const next = defaultModel.startsWith('), ipc.indexOf('if (!next) {'));
    assert.ok(ladder.length > 0, 'the reconciliation ladder should exist');
    // Without this rung a Requesty-only user whose default went stale is told
    // "No AI providers configured" while holding a working key.
    assert.match(ladder, /requestyFallbackModel && modelAvailable\(requestyFallbackModel\)/);
    // Gated by modelAvailable(), never a raw key check, so the opt-in allow-list
    // and the disabled switch stay authoritative.
    assert.doesNotMatch(ladder, /getRequestyApiKey/);
    assert.match(ipc, /const requestyFallbackModel: string \| null = cm\.getPreferredModel\?\.\('requesty'\) \|\| null;/);
  });
});

describe('model discovery and key handling', () => {
  test('the fetcher lists managed policies first, then the catalogue, all prefixed', () => {
    const fn = sliceTo(fetcher, 'async function fetchRequestyModels(', '\n}');
    assert.ok(fn.indexOf('/models/managed') >= 0, 'managed policies should be listed');
    assert.ok(fn.indexOf('/models/managed') < fn.indexOf('${REQUESTY_BASE_URL}/models`'),
      'managed policies come first');
    const list = sliceTo(fetcher, 'async function listRequestyChatModels(', '\n}');
    assert.match(list, /id: `requesty\/\$\{m\.id\}`/);
    assert.doesNotMatch(list, /includes\('\/'\)/, 'managed ids have no slash and must not be dropped');
  });

  test('a REFUSED credential write is reported and never reaches the live client', () => {
    const handler = keyHandlerSource();
    const write = handler.indexOf('const saved = cm.setRequestyApiKey(');
    const refusal = handler.indexOf("error: 'credential_store_degraded'");
    const liveClient = handler.indexOf('getLLMHelper().setRequestyApiKey(');
    assert.ok(write >= 0 && refusal > write && refusal < liveClient);
    assert.match(handler.slice(write, refusal), /if \(saved === false\)/);
  });

  test('the key is loaded at boot', () => {
    assert.match(read('electron/ProcessingHelper.ts'), /if \(requestyKey\) this\.llmHelper\.setRequestyApiKey\(requestyKey\);/);
  });

  test('the connection test validates with an authenticated model list, not a key endpoint', () => {
    const start = ipc.indexOf("else if (provider === 'requesty') {");
    assert.ok(start >= 0, 'test-llm-connection should handle requesty');
    const branch = ipc.slice(start, start + 800);
    assert.match(branch, /https:\/\/router\.requesty\.ai\/v1\/models'/);
    assert.match(branch, /Authorization: `Bearer \$\{apiKey\}`/);
  });

  test('no key prefix is enforced', () => {
    for (const src of [ipc, settings, read('electron/services/CredentialsManager.ts')]) {
      assert.doesNotMatch(src, /startsWith\('rqsty-'\)|startsWith\("rqsty-"\)/);
    }
  });
});
