// A hung lone provider: blank for 9.4 s, and a superseded request left open
// (pipeline forensics 2026-11-13, F-LAT-03; P2-s16b, req#69).
//
// 1. A selected provider with no spare rung is hedged with a second call to
//    itself. With nothing measured yet that hedge fired at 0.6 x the 15 s
//    user-endpoint budget = 9 s, so a hung socket showed nothing for ~9.4 s
//    although the parallel retry answered in 0.5 s. The hedge now fires at a
//    first-useful point (4 s unmeasured; just above the slowest first token
//    once measured), still never below what the endpoint has shown it needs.
// 2. The hedge partner was opened even when the turn had already been
//    cancelled: its abort listener was attached to a signal that had ALREADY
//    fired, so it never ran and the request stayed open to the end.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;
const engine = await import(dist('llm/streamFallbackEngine.js'));
const deadlines = await import(dist('llm/liveDeadlines.js'));
const llmSrc = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

const cfg = {
    logPrefix: 'Test', maxAttempts: 1, ttftTimeoutMs: 2000, interChunkTimeoutMs: 2000,
    authCooldownMs: 1000, transientCooldownMs: 1000, incompatibleCooldownMs: 1000,
    backoffInitialMs: 1, backoffMaxMs: 1, cleanupTimeoutMs: 50,
    hedgeEnabled: true, hedgeDelayDefaultMs: 60, hedgeDelayEmaFactor: 0.6, hedgeDelayMinMs: 60, hedgeDelayMaxMs: 60,
};

const abortable = (sig) => new Promise((_, rej) => {
    if (sig.aborted) return rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    sig.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
});

function lone({ primaryHonoursAbort }) {
    const partnerOpens = [];
    const provider = {
        id: 'litellm', name: 'LiteLLM', isLocal: false, priority: 0,
        open: async function* (sig) {
            if (primaryHonoursAbort) await abortable(sig);
            else await new Promise(() => {}); // a socket that ignores the cancel
            yield 'never';
        },
        hedgeWith: {
            id: 'litellm#hedge', name: 'LiteLLM (parallel retry)',
            open: async function* (sig) {
                const rec = { abortedAtOpen: sig.aborted, abortedLater: false };
                partnerOpens.push(rec);
                sig.addEventListener('abort', () => { rec.abortedLater = true; }, { once: true });
                await abortable(sig);
                yield 'never';
            },
        },
    };
    return { provider, partnerOpens };
}

async function runCancelledAt(ms, opts) {
    const { provider, partnerOpens } = lone(opts);
    const outer = new AbortController();
    setTimeout(() => outer.abort('superseded'), ms);
    const it = engine.runStreamingFallback([provider], cfg, new Map(), {}, outer.signal);
    await Promise.race([(async () => { try { for await (const _ of it) { /* drain */ } } catch { /* ok */ } })(), new Promise((r) => setTimeout(r, 400))]);
    await new Promise((r) => setTimeout(r, 50));
    return partnerOpens;
}

describe('a cancelled turn never leaves a hedge request open (req#69)', () => {
    test('primary fails on the cancel: the partner is not launched for a dead turn', async () => {
        const opens = await runCancelledAt(20, { primaryHonoursAbort: true });
        for (const o of opens) assert.ok(o.abortedAtOpen || o.abortedLater, 'a partner opened after the cancel must be aborted');
        assert.equal(opens.length, 0, 'no request should be sent for a turn that is already cancelled');
    });

    test('hedge timer fires after the cancel: no partner request', async () => {
        const opens = await runCancelledAt(20, { primaryHonoursAbort: false });
        for (const o of opens) assert.ok(o.abortedAtOpen || o.abortedLater, 'a partner opened after the cancel must be aborted');
        assert.equal(opens.length, 0);
    });

    test('a live turn still hedges (unchanged)', async () => {
        const { provider, partnerOpens } = lone({ primaryHonoursAbort: true });
        provider.hedgeWith.open = async function* () { partnerOpens.push({}); yield 'answer'; };
        let text = '';
        for await (const t of engine.runStreamingFallback([provider], cfg, new Map(), {}, new AbortController().signal)) text += t;
        assert.equal(text, 'answer');
        assert.equal(partnerOpens.length, 1);
    });
});

describe('lone-provider hedge timing', () => {
    test('unmeasured: the parallel retry fires at a first-useful point, not 9 s into a 15 s budget', () => {
        assert.equal(typeof deadlines.loneProviderHedgeDelayMs, 'function');
        const d = deadlines.loneProviderHedgeDelayMs(15000, null);
        assert.ok(d <= 4000, `hedge at ${d}ms`);
        assert.ok(d >= 2500, 'still above a healthy first token');
    });

    test('measured fast endpoint: hedge just above its slowest first token', () => {
        const d = deadlines.loneProviderHedgeDelayMs(15000, { maxMs: 1200, count: 3 });
        assert.equal(d, 2700);
    });

    test('measured slow gateway: never fires before the endpoint\'s own observed tail', () => {
        const budget = deadlines.totalHardTimeoutMs({ isUserEndpoint: true, observedUserEndpointLatency: { maxMs: 11600, count: 6 } });
        const d = deadlines.loneProviderHedgeDelayMs(budget, { maxMs: 11600, count: 6 });
        assert.ok(d >= 11600 + 1500 || d === Math.round(budget * 0.85), `d=${d} budget=${budget}`);
        assert.ok(d < budget, 'and always leaves room for the retry to land');
    });

    test('the selected-provider path uses it for the hedge (floor and default)', () => {
        const start = llmSrc.indexOf('private async *streamSelectedProviderWithFailover(');
        const body = llmSrc.slice(start, llmSrc.indexOf('\n  }\n', start));
        assert.match(body, /loneProviderHedgeDelayMs\(/);
        assert.match(body, /hedgeDelayDefaultMs: loneHedgeMs/);
        assert.match(body, /hedgeDelayMinMs: loneHedgeMs/);
    });
});
