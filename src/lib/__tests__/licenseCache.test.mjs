// Guards the cross-restart license hint (src/lib/licenseCache.ts).
//
// The bug this protects against: opening Plans & Billing flashed the wrong
// Pro card for ~1s on every app launch, because the snapshot lived in a
// module-level variable that died with the renderer process. Persistence is
// the fix, so what needs testing is the persistence itself — a fresh module
// evaluation (which is what an app restart IS, from this module's point of
// view) must come back already populated.
//
// Each case re-imports with a cache-busting query string to force a genuinely
// fresh module evaluation, since ESM caches by specifier.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'natively_license_snapshot_v1';
let store = {};

// Minimal localStorage stand-in. Node has no DOM; the module only ever calls
// these three methods.
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};

let evaluation = 0;
/** Re-evaluate the module from scratch — stands in for an app restart. */
const restart = () => import(`../licenseCache.ts?restart=${++evaluation}`);

describe('licenseCache — survives restart', () => {
    beforeEach(() => { store = {}; });

    test('a fresh evaluation with nothing stored reports unknown', async () => {
        const { getLicenseSnapshot } = await restart();
        assert.equal(getLicenseSnapshot(), null);
    });

    test('a snapshot written in one session is present in the next', async () => {
        const first = await restart();
        first.setLicenseSnapshot({ isPremium: true, provider: 'natively_api' });

        // THE REGRESSION: with a module-level-only cache this came back null,
        // so the first paint after launch guessed wrong and then corrected.
        const second = await restart();
        assert.deepEqual(second.getLicenseSnapshot(), { isPremium: true, provider: 'natively_api' });
    });

    test('clearing removes it for future sessions too', async () => {
        const first = await restart();
        first.setLicenseSnapshot({ isPremium: true, provider: 'dodo' });
        first.setLicenseSnapshot(null);

        const second = await restart();
        assert.equal(second.getLicenseSnapshot(), null);
    });

    test('a downgrade to non-premium overwrites rather than lingering', async () => {
        const first = await restart();
        first.setLicenseSnapshot({ isPremium: true, provider: 'dodo' });
        first.setLicenseSnapshot({ isPremium: false });

        const second = await restart();
        assert.equal(second.getLicenseSnapshot().isPremium, false);
    });

    test('a corrupt or half-written entry falls back to unknown, not a throw', async () => {
        // A crash mid-write, or a hand-edited value. Rendering must degrade to
        // the cold path rather than throwing inside a state initialiser.
        for (const junk of ['{"isPremium"', 'null', '{}', '{"isPremium":"yes"}', '[]']) {
            store[KEY] = junk;
            const m = await restart();
            assert.equal(m.getLicenseSnapshot(), null, `should reject: ${junk}`);
        }
    });

    test('a non-string provider is dropped, not carried through', async () => {
        // provider must be `string | undefined`; anything else would reach the
        // `=== 'natively_api'` comparison that decides whether to hide the
        // app-only-licence section.
        store[KEY] = JSON.stringify({ isPremium: true, provider: 42 });
        const { getLicenseSnapshot } = await restart();
        assert.deepEqual(getLicenseSnapshot(), { isPremium: true, provider: undefined });
    });

    test('unknown provider means standalone, never bundled', async () => {
        // The safety property: NativelyProSettings hides its Deactivate button
        // only for provider === 'natively_api'. An unknown provider must fall
        // through to the standalone branch, so it must not be guessable as
        // 'natively_api' from a partial record.
        store[KEY] = JSON.stringify({ isPremium: true });
        const { getLicenseSnapshot } = await restart();
        assert.notEqual(getLicenseSnapshot().provider, 'natively_api');
    });

    test('storage failure degrades to in-memory instead of throwing', async () => {
        const m = await restart();
        const realSet = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        try {
            assert.doesNotThrow(() => m.setLicenseSnapshot({ isPremium: true, provider: 'dodo' }));
            // The in-session benefit must survive even when persistence can't.
            assert.equal(m.getLicenseSnapshot().isPremium, true);
        } finally {
            globalThis.localStorage.setItem = realSet;
        }
    });
});
