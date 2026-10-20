// "Fetch models" for OpenAI-compatible endpoints: URL validation, status
// mapping, timeout handling, response parsing, the stored-key origin guard,
// and the no-leak contract (the API key must never appear in a result or in
// console output — transport errors can carry it). The TS module is exercised
// as compiled (dist-electron), exactly what the IPC handler consumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { fetchCompatModels, isValidCompatBaseURL } = require(
    path.join(root, 'dist-electron/electron/llm/providers/openaiCompatModels.js'),
);

// Records every (url, init) and answers with a JSON Response.
function fakeFetch(body, status = 200) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
    };
    impl.calls = calls;
    return impl;
}

test('success: sorted deduped ids, exact URL, GET, bearer header', async () => {
    const impl = fakeFetch({ data: [{ id: 'qwen-plus' }, { id: 'b' }, { id: 'qwen-plus' }, { id: '' }, {}] });
    const res = await fetchCompatModels({ baseURL: 'https://x.test/v1/', apiKey: 'sk-test' }, { fetchImpl: impl });
    assert.deepEqual(res, { success: true, models: ['b', 'qwen-plus'] });
    assert.equal(impl.calls.length, 1);
    assert.equal(impl.calls[0].url, 'https://x.test/v1/models');
    assert.ok(impl.calls[0].init.method === 'GET' || impl.calls[0].init.method === undefined);
    assert.equal(impl.calls[0].init.headers.Authorization, 'Bearer sk-test');
});

test('401 maps to unauthorized with status; 404 to not_found', async () => {
    const r401 = await fetchCompatModels(
        { baseURL: 'https://x.test/v1', apiKey: 'sk-test' },
        { fetchImpl: fakeFetch({ error: 'nope' }, 401) },
    );
    assert.deepEqual(r401, { success: false, error: 'unauthorized', status: 401 });

    const r404 = await fetchCompatModels(
        { baseURL: 'https://x.test/v1' },
        { fetchImpl: fakeFetch({}, 404) },
    );
    assert.deepEqual(r404, { success: false, error: 'not_found', status: 404 });
});

test('TimeoutError rejection maps to timeout', async () => {
    const impl = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
    const res = await fetchCompatModels({ baseURL: 'https://x.test/v1' }, { fetchImpl: impl });
    assert.deepEqual(res, { success: false, error: 'timeout' });
});

test('a real AbortSignal.timeout firing maps to timeout', async () => {
    const slow = (url, init) => new Promise((resolve, reject) => {
        // The timer underlying AbortSignal.timeout does NOT keep Node's event
        // loop alive (in the Electron main process the loop never drains, so
        // this is test-only). Hold the loop with a ref'd timer until the abort
        // fires; if it never does, fail loudly instead of hanging.
        const keepAlive = setTimeout(() => reject(new Error('abort never fired')), 5_000);
        init.signal.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        });
    });
    const res = await fetchCompatModels({ baseURL: 'https://x.test/v1' }, { fetchImpl: slow, timeoutMs: 20 });
    assert.deepEqual(res, { success: false, error: 'timeout' });
});

test('invalid URLs are rejected before any fetch', async () => {
    let called = 0;
    const impl = async () => { called += 1; return new Response('{}'); };
    for (const baseURL of ['ftp://x', 'not a url', '']) {
        const res = await fetchCompatModels({ baseURL }, { fetchImpl: impl });
        assert.deepEqual(res, { success: false, error: 'invalid' });
    }
    assert.equal(called, 0);
    assert.equal(isValidCompatBaseURL('  https://x.test/v1  '), true);
    assert.equal(isValidCompatBaseURL('ftp://x'), false);
    assert.equal(isValidCompatBaseURL(''), false);
});

test('the key never appears in results or console output', async () => {
    const KEY = 'sk-secret-123';
    const seen = [];
    const orig = {};
    for (const m of ['log', 'warn', 'error', 'info', 'debug']) {
        orig[m] = console[m];
        console[m] = (...args) => { seen.push(args.map(String).join(' ')); };
    }
    try {
        const results = [
            await fetchCompatModels(
                { baseURL: 'https://x.test/v1', apiKey: KEY },
                { fetchImpl: fakeFetch({ data: [{ id: 'a' }] }) },
            ),
            await fetchCompatModels(
                { baseURL: 'https://x.test/v1', apiKey: KEY },
                { fetchImpl: fakeFetch({}, 401) },
            ),
            // The transport error message itself carries the key — it must be
            // dropped, not echoed into the result.
            await fetchCompatModels(
                { baseURL: 'https://x.test/v1', apiKey: KEY },
                { fetchImpl: async () => { throw new Error(`boom ${KEY}`); } },
            ),
        ];
        assert.deepEqual(results[0], { success: true, models: ['a'] });
        assert.deepEqual(results[1], { success: false, error: 'unauthorized', status: 401 });
        assert.deepEqual(results[2], { success: false, error: 'network' });
        for (const res of results) {
            assert.ok(!JSON.stringify(res).includes(KEY), `result leaks the key: ${JSON.stringify(res)}`);
        }
        for (const line of seen) {
            assert.ok(!line.includes(KEY), `console leaks the key: ${line}`);
        }
    } finally {
        for (const m of ['log', 'warn', 'error', 'info', 'debug']) console[m] = orig[m];
    }
});

test('stored key goes only to its own origin', async () => {
    const stored = { baseURL: 'https://a.test/v1', apiKey: 'sk-stored' };

    const same = fakeFetch({ data: [] });
    const r1 = await fetchCompatModels({ baseURL: 'https://a.test/v1', stored }, { fetchImpl: same });
    assert.equal(r1.success, true);
    assert.equal(same.calls[0].init.headers.Authorization, 'Bearer sk-stored');

    const other = fakeFetch({ data: [] });
    const r2 = await fetchCompatModels({ baseURL: 'https://evil.test/v1', stored }, { fetchImpl: other });
    assert.equal(r2.success, true);
    assert.equal(other.calls[0].init.headers.Authorization, undefined);
});
