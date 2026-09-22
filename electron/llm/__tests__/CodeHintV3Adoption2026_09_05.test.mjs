// electron/llm/__tests__/CodeHintV3Adoption2026_09_05.test.mjs
//
// Code hint was the one of the V3 bridge's five stated surfaces that was never
// connected. Its header names "assist, clarify, brainstorm, code-hint and
// manual answer"; the first three take a `v3` argument and code-hint did not,
// so a coding question asked in a mode holding reference files got no source
// authority while the same question through assist did.
//
// Driven for real against a fake LLMHelper rather than asserted against source,
// because the thing that matters is which arguments reach streamChat, and
// positional arguments are exactly what a source assertion reads past.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { CodeHintLLM } = await import(
  pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/CodeHintLLM.js')).href
);

/** Records exactly what streamChat was called with. */
function fakeHelper() {
  const calls = [];
  return {
    calls,
    getCapabilities: () => ({ supportsImages: true, tier: 'cloud', name: 'test-model' }),
    getPromptTier: () => 'cloud',
    fitContextForCurrentModel: (s) => `FITTED(${s})`,
    async *streamChat(...args) { calls.push(args); yield 'ok'; },
  };
}

const drain = async (gen) => { const out = []; for await (const t of gen) out.push(t); return out; };

// streamChat(message, imagePaths, context, systemPromptOverride,
//            ignoreKnowledgeMode, skipModeInjection, extraDataScopes,
//            abortSignal, thinkingBudget, routeOptions)
const ARG = {
  message: 0, images: 1, context: 2, systemPrompt: 3,
  ignoreKnowledgeMode: 4, skipModeInjection: 5, routeOptions: 9,
};

describe('code hint without V3', () => {
  test('is byte-for-byte the legacy call', async () => {
    // The whole safety argument for this change: the four positional arguments
    // it used to pass defaulted ignoreKnowledgeMode and skipModeInjection to
    // false, so passing Boolean(undefined) explicitly must be identical.
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(['/tmp/a.png'], 'two sum', 'screenshot', undefined));
    assert.equal(h.calls.length, 1);
    const a = h.calls[0];
    assert.equal(a[ARG.ignoreKnowledgeMode], false);
    assert.equal(a[ARG.skipModeInjection], false);
    assert.equal(a[ARG.routeOptions], undefined);
  });

  test('still fits the message to the model', async () => {
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(undefined, 'two sum', 'screenshot', undefined));
    assert.match(String(h.calls[0][ARG.message]), /^FITTED\(/);
  });
});

describe('code hint with V3', () => {
  const v3 = { system: 'V3 SYSTEM PROMPT', user: 'V3 USER CONTENT with <evidence>…</evidence>' };

  test('uses the V3 system prompt, not the v2 or legacy one', async () => {
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(undefined, 'two sum', 'screenshot', undefined, v3));
    assert.equal(h.calls[0][ARG.systemPrompt], v3.system);
  });

  test('sends V3 turn content UNFITTED', async () => {
    // fitContextForCurrentModel truncates from the middle. Applied to a governed
    // evidence block that would drop cited text while leaving the citation, so a
    // V3-composed turn must bypass it.
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(undefined, 'two sum', 'screenshot', undefined, v3));
    assert.equal(h.calls[0][ARG.message], v3.user);
    assert.doesNotMatch(String(h.calls[0][ARG.message]), /FITTED/);
  });

  test('marks the turn V3-owned so it is not re-classified or re-injected', async () => {
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(undefined, 'two sum', 'screenshot', undefined, v3));
    const a = h.calls[0];
    assert.equal(a[ARG.ignoreKnowledgeMode], true, 'a V3-owned prompt must not be re-classified');
    assert.equal(a[ARG.skipModeInjection], true, 'V3 already carries the mode contract; injecting again stacks two');
    assert.deepEqual(a[ARG.routeOptions], { v3Owned: true });
  });

  test('images still reach the provider', async () => {
    const h = fakeHelper();
    await drain(new CodeHintLLM(h).generateStream(['/tmp/a.png'], 'two sum', 'screenshot', undefined, v3));
    assert.deepEqual(h.calls[0][ARG.images], ['/tmp/a.png']);
  });
});

describe('the vision guard still fires first', () => {
  test('a model without image support refuses before any V3 work', async () => {
    const h = fakeHelper();
    h.getCapabilities = () => ({ supportsImages: false, tier: 'local-small', name: 'tiny' });
    const out = await drain(new CodeHintLLM(h).generateStream(['/tmp/a.png'], 'two sum', 'screenshot', undefined,
      { system: 'S', user: 'U' }));
    assert.equal(h.calls.length, 0, 'must not call the provider at all');
    assert.match(out.join(''), /doesn't support image input/);
  });
});
