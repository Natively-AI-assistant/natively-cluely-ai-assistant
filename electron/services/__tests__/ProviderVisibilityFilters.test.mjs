// Guards the provider-visibility feature: switching a provider off, narrowing
// which of its models reach the picker, and the runtime reconciliation that moves
// the active model when either filter hides it.
//
// Source-inspection style, matching CredentialStorage.test.mjs — ipcHandlers'
// modelAvailable()/providerFamily() are closures over AppState and can't be
// instantiated here, but the invariants that break are structural: filter
// ordering, family-classification ordering, and the two filter surfaces
// (main-process routing vs renderer picker) agreeing on family names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const IPC = 'electron/ipcHandlers.ts';
const CM = 'electron/services/CredentialsManager.ts';
const SETTINGS = 'src/components/settings/AIProvidersSettings.tsx';

function modelAvailableSource() {
    const src = read(IPC);
    const start = src.indexOf('      const modelAvailable = (modelId: string): boolean => {');
    assert.ok(start >= 0, 'modelAvailable() should exist in ipcHandlers');
    const end = src.indexOf('      if (modelAvailable(defaultModel)) return null;', start);
    assert.ok(end > start, 'modelAvailable() should be followed by the defaultModel check');
    return src.slice(start, end);
}

test('modelAvailable() applies the visibility filters BEFORE the credential arms', () => {
    const body = modelAvailableSource();
    const disabledAt = body.indexOf('getDisabledProviders');
    const allowListAt = body.indexOf('getCloudEnabledModels');
    const firstCredentialAt = body.indexOf('getNativelyApiKey');

    assert.ok(disabledAt >= 0, 'should consult disabledProviders');
    assert.ok(allowListAt >= 0, 'should consult the per-provider allow-list');
    // Ordering is the invariant: a provider the user switched off must be rejected
    // even when its credential is present. Checking credentials first would return
    // true before the filters ever ran.
    assert.ok(
        disabledAt < firstCredentialAt,
        'the disabled-provider check must precede the credential checks',
    );
    assert.ok(
        allowListAt < firstCredentialAt,
        'the enabled-models check must precede the credential checks',
    );
});

test('an empty allow-list means "all models allowed" — no sentinel model id is ever stored', () => {
    const body = modelAvailableSource();
    // Only a POPULATED list filters. This is what keeps "disable every model"
    // out of persisted state: hiding a provider entirely is disabledProviders'
    // job, so no magic id (e.g. '_none_') is needed or written.
    assert.match(body, /enabledForFamily\.length > 0 && !enabledForFamily\.includes\(modelId\)/);
    assert.doesNotMatch(read(IPC), /_none_/, 'no sentinel model id in the main process');
    assert.doesNotMatch(read(SETTINGS), /_none_/, 'no sentinel model id in the renderer');
    assert.doesNotMatch(read(CM), /_none_/, 'no sentinel model id in persisted state');
});

test('providerFamily() resolves custom-provider ids last, by identity', () => {
    const src = read(IPC);
    const start = src.indexOf('      const providerFamily = (modelId: string): string => {');
    assert.ok(start >= 0, 'providerFamily() should exist');
    const body = src.slice(start, src.indexOf("        return 'unknown';", start));

    // Custom provider ids are arbitrary strings, so the identity lookup has to be
    // the final check — otherwise a custom id that happens to start with a
    // built-in prefix would be misclassified, and (worse) built-in ids could be
    // captured by a custom provider that reused the id.
    const customAt = body.indexOf("return 'custom'");
    assert.ok(customAt >= 0, "should classify saved custom providers as 'custom'");
    for (const builtin of ['natively', 'codex-cli', 'litellm', 'ollama', 'gemini', 'groq', 'openai', 'claude', 'deepseek']) {
        assert.ok(
            body.indexOf(`return '${builtin}'`) < customAt,
            `built-in family '${builtin}' must be classified before the custom identity lookup`,
        );
    }
});

test('reconciliation installs nothing when every candidate is filtered out', () => {
    const src = read(IPC);
    const start = src.indexOf("      const next = modelAvailable('natively') ? 'natively'");
    assert.ok(start >= 0, 'the replacement chain should route through modelAvailable()');
    const body = src.slice(start, src.indexOf('llmHelper.setModel(next, allProviders);', start));

    // Every candidate goes through modelAvailable(), so none of them can be a
    // provider the user just switched off...
    assert.doesNotMatch(
        body,
        /has\(cm\.get(Gemini|Openai|Claude|Groq|Deepseek|Natively)ApiKey\(\)\) \?/,
        'candidates must be tested with modelAvailable(), not raw key checks',
    );
    // ...and when they all fail we must return WITHOUT persisting a default.
    // Writing one back would re-activate the provider that was just disabled.
    const guard = body.indexOf('if (!next) {');
    const setDefault = body.indexOf('cm.setDefaultModel(next);');
    assert.ok(guard >= 0, 'should guard the no-available-model case');
    assert.ok(guard < setDefault, 'the guard must return before setDefaultModel');
    assert.match(body.slice(guard, setDefault), /return null;/);
});

test('the renderer picker and main-process routing agree on family names', () => {
    const ipcFamilies = new Set(
        [...modelAvailableSource().matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
    );
    const ipcAll = new Set(
        [...read(IPC).matchAll(/return '([a-z-]+)';/g)].map((m) => m[1]),
    );
    const rendererFamilies = new Set(
        [...read(SETTINGS).matchAll(/isProviderEnabled\('([a-z-]+)'\)/g)].map((m) => m[1]),
    );

    // Every family the renderer hides must be one the main process can also
    // classify, or the picker and the router disagree: the model vanishes from
    // the list while routing still accepts it (or vice versa).
    for (const family of rendererFamilies) {
        assert.ok(
            ipcAll.has(family),
            `renderer filters on '${family}' but providerFamily() never returns it`,
        );
    }
    assert.ok(ipcFamilies.size > 0, 'sanity: parsed some ids out of modelAvailable()');
});

test('every provider with a UI toggle is a family the main process can classify', () => {
    const toggled = new Set(
        [...read(SETTINGS).matchAll(/handleToggleProvider\('([a-z-]+)'/g)].map((m) => m[1]),
    );
    const ipcAll = new Set(
        [...read(IPC).matchAll(/return '([a-z-]+)';/g)].map((m) => m[1]),
    );
    assert.ok(toggled.size >= 5, 'expected toggles for at least the five cloud providers');
    for (const family of toggled) {
        assert.ok(
            ipcAll.has(family),
            `Settings can switch '${family}' off but providerFamily() never returns it, ` +
            'so routing would keep treating its models as available',
        );
    }
});

test('CredentialsManager persists both filters and documents the empty-list contract', () => {
    const src = read(CM);
    assert.match(src, /disabledProviders\?: string\[\];/);
    assert.match(src, /cloudEnabledModels\?: Record<string, string\[\]>;/);
    assert.match(src, /public getDisabledProviders\(\): string\[\]/);
    assert.match(src, /public setDisabledProviders\(providers: string\[\]\): void/);
    assert.match(src, /public getCloudEnabledModels\(provider: string\): string\[\]/);
    assert.match(src, /public setCloudEnabledModels\(provider: string, models: string\[\]\): boolean/);
    // Both getters must default to an empty array rather than undefined, so
    // callers can treat "absent" and "no filter" identically.
    assert.match(src, /return this\.credentials\.disabledProviders \|\| \[\];/);
    assert.match(src, /return this\.credentials\.cloudEnabledModels\?\.\[provider\] \|\| \[\];/);
});

test('LiteLLM model discovery is cache-first and never probes an unconfigured proxy', () => {
    const src = read(IPC);
    const start = src.indexOf('  const discoverLitellmModels = async');
    assert.ok(start >= 0, 'discoverLitellmModels() should exist');
    const discover = src.slice(start, src.indexOf("  safeHandle('get-available-litellm-models'", start));

    // With no proxy configured we must not fall back to localhost:4000 — that
    // burned a connection attempt on every model-picker open.
    assert.match(discover, /if \(!configuredURL\) return \[\];/);
    assert.match(discover, /cm\.setLitellmModels\(models\)/, 'a successful discovery should populate the cache');

    const handlerStart = src.indexOf("  safeHandle('get-available-litellm-models'");
    const handler = src.slice(handlerStart, src.indexOf('  safeHandle(', handlerStart + 10));
    // Cache first. The cold-start fetch is the fallback, not the default path:
    // this handler feeds ModelSelectorWindow (the overlay dropdown), which must
    // not block on a network round-trip once a cache exists.
    const cachedAt = handler.indexOf('getLitellmModels()');
    const fetchAt = handler.indexOf('discoverLitellmModels');
    assert.ok(cachedAt >= 0 && fetchAt >= 0, 'should read cache and be able to discover');
    assert.ok(cachedAt < fetchAt, 'the cache must be consulted before any network call');
});

test('the LiteLLM model cache is dropped when its proxy changes or is removed', () => {
    const src = read(IPC);
    const start = src.indexOf("  safeHandle('set-litellm-config'");
    assert.ok(start >= 0);
    const body = src.slice(start, start + 4000);
    // A cache belongs to one proxy. Keeping it after the URL changes (or the
    // proxy is removed) leaves models in the picker with nothing behind them.
    assert.match(body, /if \(!newUrl\.trim\(\) \|\| prevUrl !== newUrl\) \{\s*\n\s*cm\.setLitellmModels\(\[\]\);/);
});

test('no native confirm() survives in the AI Providers settings surface', () => {
    for (const file of [SETTINGS, 'src/components/settings/ProviderCard.tsx']) {
        const src = read(file);
        // Native confirm() wedges Chromium's input-focus and pointer-event
        // subsystem on Windows after the modal closes. Comments may mention it;
        // calls may not.
        const calls = [...src.matchAll(/(^|[^.\w'"`])confirm\s*\(/gm)].filter((m) => {
            const lineStart = src.lastIndexOf('\n', m.index) + 1;
            const line = src.slice(lineStart, src.indexOf('\n', m.index));
            return !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*');
        });
        assert.equal(calls.length, 0, `${file} must not call native confirm() (found ${calls.length})`);
    }
});
