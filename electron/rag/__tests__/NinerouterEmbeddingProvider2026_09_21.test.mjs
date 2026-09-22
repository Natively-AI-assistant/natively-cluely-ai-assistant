/**
 * 9Router embeddings.
 *
 * OpenAI-shaped like OpenRouter's, with two deliberate differences, both of
 * which come from 9Router being something the USER RUNS rather than a service.
 *
 * 1. THE SPACE KEY CARRIES THE HOST.
 *    OpenRouterEmbeddingProvider says why it does NOT: "OpenRouter is a single
 *    service, so a model id means one thing. (For a self-hosted endpoint it
 *    means whatever that box is serving, which is why that one keys on host.)"
 *    9Router is the self-hosted case. Its catalogue includes
 *    `openai-compatible-*` and `custom-embedding-*` entries pointed at whatever
 *    baseUrl their owner configured, so `custom-embedding-x/my-model` means one
 *    thing on this machine and something else on another. CustomEmbeddingProvider
 *    already states the trade-off: "A false re-index when the endpoint moves is
 *    recoverable; silent incomparability is not."
 *
 * 2. A MISSING KEY IS NOT A CLIENT-SIDE ERROR.
 *    9Router's REQUIRE_API_KEY defaults to false, so a keyless instance is a
 *    legitimate configuration. OpenRouter throws "No API key configured" before
 *    it sends; doing that here would break a working setup. The server decides.
 *
 * Dimensions are MEASURED, never declared — and for a sharper reason than
 * OpenRouter's. `/v1/models/info` reports no dimension at all for 5 of the 6
 * embedding models a stock instance serves, and 9Router forwards `dimensions`
 * upstream where only OpenAI v3 models honour it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { NinerouterEmbeddingProvider } =
  require(path.join(__dirname, '../../../dist-electron/electron/rag/providers/NinerouterEmbeddingProvider.js'));

const BASE = 'http://localhost:20128/v1';

/** A provider whose transport is a stub, so every assertion is about OUR code. */
function make({ dimensions = 3, model = 'gemini/text-embedding-004', apiKey = 'sk-x', baseUrl = BASE, reply } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {}, body: JSON.parse(init?.body || '{}') });
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: reply.statusText || '',
      headers: { get: () => null },
      json: async () => reply.body,
    };
  };
  return { p: new NinerouterEmbeddingProvider({ apiKey, model, dimensions, baseUrl, fetchImpl }), calls };
}

const vec = (n, fill = 0.1) => Array.from({ length: n }, () => fill);

describe('embedding-space identity', () => {
  test('the space carries the HOST, so two instances never share vectors', () => {
    const a = new NinerouterEmbeddingProvider({ apiKey: '', model: 'gemini/text-embedding-004', dimensions: 768, baseUrl: 'http://localhost:20128/v1' });
    const b = new NinerouterEmbeddingProvider({ apiKey: '', model: 'gemini/text-embedding-004', dimensions: 768, baseUrl: 'https://tunnel.example.com/v1' });
    assert.notEqual(a.space, b.space,
      'same model id on two instances must NOT be treated as the same space — a 9Router '
      + 'catalogue can point a model id at an arbitrary upstream');
    assert.match(a.space, /localhost:20128/, 'the host must be part of the identity');
  });

  test('the same instance and model is stable across construction', () => {
    const a = new NinerouterEmbeddingProvider({ apiKey: 'k1', model: 'gemini/text-embedding-004', dimensions: 768, baseUrl: BASE });
    const b = new NinerouterEmbeddingProvider({ apiKey: 'k2', model: 'gemini/text-embedding-004', dimensions: 768, baseUrl: BASE });
    assert.equal(a.space, b.space, 'rotating the key must not restate the corpus');
  });

  test('dimensions are part of the identity', () => {
    const a = new NinerouterEmbeddingProvider({ apiKey: '', model: 'm', dimensions: 768, baseUrl: BASE });
    const b = new NinerouterEmbeddingProvider({ apiKey: '', model: 'm', dimensions: 1536, baseUrl: BASE });
    assert.notEqual(a.space, b.space);
  });
});

describe('the request', () => {
  test('POSTs to {base}/embeddings and sends the requested width', async () => {
    const { p, calls } = make({ reply: { status: 200, body: { data: [{ index: 0, embedding: vec(3) }] } } });
    await p.embed('hello');
    assert.match(calls[0].url, /\/v1\/embeddings$/);
    assert.equal(calls[0].body.model, 'gemini/text-embedding-004');
    assert.equal(calls[0].body.dimensions, 3);
    assert.equal(calls[0].headers['Authorization'], 'Bearer sk-x');
  });

  test('a keyless instance still sends the request', async () => {
    // REQUIRE_API_KEY defaults to false. Refusing client-side would break a
    // legitimate local setup — the server is entitled to accept it.
    const { p, calls } = make({ apiKey: '', reply: { status: 200, body: { data: [{ index: 0, embedding: vec(3) }] } } });
    const out = await p.embed('hello');
    assert.equal(out.length, 3);
    assert.equal(calls[0].headers['Authorization'], undefined,
      'no key means no empty Bearer header');
  });
});

describe('what comes back is checked, not trusted', () => {
  test('a width that does not match the measured one is refused', async () => {
    // 9Router forwards `dimensions` upstream and only OpenAI v3 honours it, so
    // the returned length is the only authority. Writing a wrong-width vector
    // stamps a wrong space key over a real corpus.
    const { p } = make({ dimensions: 768, reply: { status: 200, body: { data: [{ index: 0, embedding: vec(384) }] } } });
    await assert.rejects(() => p.embed('hello'), /dimension mismatch/i);
  });

  test('a batch is ordered by data[].index, never by array position', async () => {
    // The schema carries an index precisely because a server may answer out of
    // order. Trusting position pairs vectors with the wrong chunks — it looks
    // fine and retrieves nonsense.
    const { p } = make({
      dimensions: 2,
      reply: { status: 200, body: { data: [
        { index: 2, embedding: [0.3, 0.3] },
        { index: 0, embedding: [0.1, 0.1] },
        { index: 1, embedding: [0.2, 0.2] },
      ] } },
    });
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.deepEqual(out, [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]);
  });

  test('a partial batch is refused rather than silently short', async () => {
    const { p } = make({ dimensions: 2, reply: { status: 200, body: { data: [{ index: 0, embedding: [0.1, 0.1] }] } } });
    await assert.rejects(() => p.embedBatch(['a', 'b']), /refusing a partial batch/i);
  });

  test('an out-of-range index is refused', async () => {
    const { p } = make({ dimensions: 2, reply: { status: 200, body: { data: [{ index: 9, embedding: [0.1, 0.1] }] } } });
    await assert.rejects(() => p.embedBatch(['a']), /out-of-range/i);
  });

  test('an empty batch never hits the network', async () => {
    const { p, calls } = make({ reply: { status: 500, body: {} } });
    assert.deepEqual(await p.embedBatch([]), []);
    assert.equal(calls.length, 0);
  });
});

describe('errors are classified so the caller can decide', () => {
  test('OUR 401 is a permanent auth failure', async () => {
    // 9Router's own rejection: no model prefix, and it names the credential.
    const { p } = make({ reply: { status: 401, statusText: 'Unauthorized', body: { error: { message: 'Missing API key', type: 'authentication_error', code: 'invalid_api_key' } } } });
    await assert.rejects(() => p.embed('x'), (e) => {
      assert.equal(e.permanentAuthFailure, true);
      assert.equal(e.retryable, false);
      return true;
    });
  });

  test('a RELAYED upstream 401 is NOT our auth failure', async () => {
    // Measured on the live instance. 9Router propagates the upstream's status
    // verbatim, so a model whose Google service account has been deleted comes
    // back as a top-level 401:
    //
    //   {"error":{"message":"[gemini/text-embedding-004] [401]: The bound
    //             service account is deleted or disabled..."}}
    //
    // while a sibling model on the SAME instance and the SAME key embeds fine
    // at 3072d. Treating that as permanentAuthFailure makes isAvailable()
    // rethrow, which tells the resolver the 9Router credential is dead and can
    // demote the whole provider — changing the active embedding SPACE and
    // stranding the corpus — because of one broken upstream account.
    //
    // The tell is the `[model] [status]:` prefix 9Router adds when it is
    // relaying, and the absence of its own authentication_error type.
    const { p } = make({
      reply: {
        status: 401, statusText: 'Unauthorized',
        body: { error: { message: '[gemini/text-embedding-004] [401]: The bound service account is deleted or disabled.' } },
      },
    });
    await assert.rejects(() => p.embed('x'), (e) => {
      assert.equal(e.permanentAuthFailure, false,
        'one dead upstream model must not be reported as a dead 9Router credential');
      assert.equal(e.retryable, true);
      return true;
    });
  });

  test('a relayed upstream 404 is likewise not fatal to the provider', async () => {
    const { p } = make({
      reply: { status: 404, statusText: 'Not Found', body: { error: { message: '[nvidia/nv-embedqa-e5-v5] [404]: 404 page not found' } } },
    });
    await assert.rejects(() => p.embed('x'), (e) => {
      assert.equal(e.permanentAuthFailure, false);
      return true;
    });
  });

  test('500 is retryable', async () => {
    const { p } = make({ reply: { status: 500, statusText: 'Server Error', body: {} } });
    await assert.rejects(() => p.embed('x'), (e) => {
      assert.equal(e.permanentAuthFailure, false);
      assert.equal(e.retryable, true);
      return true;
    });
  });

  test('a transport failure never leaks the key or the raw cause into the message', async () => {
    const { p } = make({ reply: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:20128 key=sk-secret'), { name: 'TypeError' }) });
    await assert.rejects(() => p.embed('x'), (e) => {
      assert.ok(!/sk-/.test(e.message), `the key must never reach a log line: ${e.message}`);
      assert.equal(e.retryable, true);
      return true;
    });
  });
});
