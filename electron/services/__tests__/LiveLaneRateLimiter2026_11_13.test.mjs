// Background section compiles must not make the live judge/answer wait
// (pipeline forensics 2026-11-13, F-LAT-06).
//
// dev-s09c: creating a mode fired ~112 section-compile calls through the same
// per-provider token bucket the live Auto Answer judge uses. The bucket drained
// and the first judge of the meeting waited 2.6 s in RateLimiter.acquire, then
// timed out. Live work now has priority: background acquires never take the
// last share of the bucket, a queued live waiter is served before every
// background waiter, and background work holds off while live calls are recent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/RateLimiter.js')).href);
const { RateLimiter, runAsBackgroundLlmWork } = mod;

const settledWithin = (p, ms) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);

describe('live vs background lanes', () => {
    test('a live acquire is not queued behind a burst of background acquires', async () => {
        assert.equal(typeof runAsBackgroundLlmWork, 'function', 'background work must be markable');
        const rl = new RateLimiter(8, 0.01); // small bucket, effectively no refill during the test
        // The compile storm: far more background calls than the bucket holds.
        const bg = [];
        await runAsBackgroundLlmWork(async () => {
            for (let i = 0; i < 12; i++) { const p = rl.acquire(); p.catch(() => {}); bg.push(p); }
        });
        // The judge.
        const live = rl.acquire();
        assert.equal(await settledWithin(live, 100), true, 'the live judge must not wait behind background compiles');
        rl.destroy();
    });

    test('when live work itself drains the bucket, a queued live waiter is served before background waiters', async () => {
        const rl = new RateLimiter(2, 1);
        await rl.acquire(); await rl.acquire(); // live drains it
        const order = [];
        await runAsBackgroundLlmWork(async () => {
            const b = rl.acquire(); b.then(() => order.push('bg'), () => {});
        });
        const l = rl.acquire(); l.then(() => order.push('live'));
        await settledWithin(l, 2500);
        assert.equal(order[0], 'live', `served in order ${order.join(',')}`);
        rl.destroy();
    });

    test('background work still runs when nothing live is happening (unchanged otherwise)', async () => {
        const rl = new RateLimiter(8, 0.01, { liveQuietMs: 0 });
        let ok = 0;
        await runAsBackgroundLlmWork(async () => { for (let i = 0; i < 4; i++) { await rl.acquire(); ok++; } });
        assert.equal(ok, 4);
        rl.destroy();
    });

    test('background work yields while live calls are recent', async () => {
        const rl = new RateLimiter(8, 0.01, { liveQuietMs: 300 });
        await rl.acquire(); // a live call just happened (judge)
        let p;
        await runAsBackgroundLlmWork(async () => { p = rl.acquire(); });
        assert.equal(await settledWithin(p, 100), false, 'a compile must not start while the meeting is answering');
        assert.equal(await settledWithin(p, 1600), true, 'it runs once live work goes quiet');
        rl.destroy();
    });

    test('a plain acquire outside background work is live (existing callers unchanged)', async () => {
        const rl = new RateLimiter(3, 0.01);
        for (let i = 0; i < 3; i++) assert.equal(await settledWithin(rl.acquire(), 50), true);
        rl.destroy();
    });
});

describe('the section compiles run in the background lane', () => {
    test('both ModesManager compile paths wrap the compiler in runAsBackgroundLlmWork', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(path.resolve(__dirname, '../ModesManager.ts'), 'utf8');
        const one = src.slice(src.indexOf('private compileSectionPromptAsync('), src.indexOf('public compileAllSectionsAsync('));
        const all = src.slice(src.indexOf('public compileAllSectionsAsync('), src.indexOf('private static llmHelperForCompiler'));
        assert.match(one, /runAsBackgroundLlmWork\(\(\) => new SectionPromptCompiler\(llmHelper\)\.compile\(/);
        assert.match(all, /runAsBackgroundLlmWork\(\(\) => Promise\.all\(/);
    });
});
