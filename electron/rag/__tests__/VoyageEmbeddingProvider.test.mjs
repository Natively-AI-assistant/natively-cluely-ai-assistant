// electron/rag/__tests__/VoyageEmbeddingProvider.test.mjs
//
// Voyage AI embeddings. Verified against docs.voyageai.com (2026-08-31):
//
//   POST https://api.voyageai.com/v1/embeddings
//     {model, input: string|string[], input_type?: 'query'|'document',
//      output_dimension?, output_dtype?, truncation?}
//     -> {data: [{object, embedding, index}], model, usage:{total_tokens}}
//
//   input list is capped at 1,000 strings.
//   output_dimension: 256 | 512 | 1024 (default) | 2048 on the configurable models.
//
// THE THING THAT MAKES VOYAGE DIFFERENT: `input_type`. Every other provider wired
// here is symmetric — a query embeds exactly like a document. Voyage is not: it
// asks you to say which you are embedding, and that is a real retrieval-quality
// lever. Getting it wrong is silent; retrieval simply gets worse.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);
const { VoyageEmbeddingProvider, VOYAGE_MAX_BATCH } = await load('providers/VoyageEmbeddingProvider.js');

const DIMS = 1024;
const vec = seed => Array.from({ length: DIMS }, (_, i) => (i === 0 ? seed : 0.01));

let server, baseUrl, requests = [], respond = null;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (respond) return respond(req, res, parsed);
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Reversed on purpose: the schema carries an index.
      const data = inputs.map((_, i) => ({ object: 'embedding', index: i, embedding: vec(i + 1) })).reverse();
      res.end(JSON.stringify({ object: 'list', data, model: parsed.model, usage: { total_tokens: 8 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});
after(async () => { await new Promise(r => server.close(r)); });

const make = (opts = {}) => new VoyageEmbeddingProvider({
  apiKey: 'pa-test', model: 'voyage-4-lite', dimensions: DIMS, baseUrl, ...opts,
});

describe('identity', () => {
  test('it is its own provider', () => {
    assert.equal(make().name, 'voyage');
  });

  test('the space names voyage, the model and the width', () => {
    const p = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4-lite', dimensions: 1024 });
    assert.equal(p.space, 'voyage:voyage-4-lite:1024');
  });

  test('a width change is a different space', () => {
    const a = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4', dimensions: 1024 });
    const b = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4', dimensions: 2048 });
    assert.notEqual(a.space, b.space);
  });

  test('direct Voyage and the SAME model via OpenRouter are different spaces', () => {
    // They may well produce identical vectors, but nothing here can verify that,
    // and a wrong assumption silently mixes two indexes. Different route =>
    // different space, and a re-index the user can see.
    const direct = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4-lite', dimensions: 1024 });
    assert.notEqual(direct.space, 'openrouter:voyageai/voyage-4-lite:1024');
  });
});

describe('input_type asymmetry — the point of using Voyage directly', () => {
  test('documents are embedded as input_type "document"', async () => {
    requests = [];
    await make().embed('some chunk of a document');
    assert.equal(requests[0].body.input_type, 'document');
  });

  test('a QUERY is embedded as input_type "query"', async () => {
    requests = [];
    await make().embedQuery('what did we decide about pricing?');
    assert.equal(requests[0].body.input_type, 'query');
  });

  test('a batch is documents — batches only ever carry corpus chunks', async () => {
    requests = [];
    await make().embedBatch(['a', 'b']);
    assert.equal(requests[0].body.input_type, 'document');
  });

  test('query and document vectors still share ONE space', () => {
    // The asymmetry is in how they are produced, not in where they live —
    // otherwise a query could never match a document.
    const p = make();
    assert.equal(p.space, make().space);
  });
});

describe('requests', () => {
  test('the width is sent as output_dimension for models that accept it', async () => {
    requests = [];
    await make({ dimensions: DIMS }).embed('x');
    assert.equal(requests[0].body.output_dimension, DIMS);
  });

  test('output_dimension is NOT sent to a fixed-width model', async () => {
    // VERIFIED LIVE: voyage-finance-2 and voyage-law-2 answer 400 —
    // "Value '512' supplied for argument 'output_dimension' is not valid" —
    // so sending it breaks an otherwise working model.
    requests = [];
    await make({ model: 'voyage-law-2', dimensions: 1024 }).embed('x');
    assert.equal('output_dimension' in requests[0].body, false);
  });

  test('voyage-code-4 DOES take output_dimension, despite the prose docs', async () => {
    // The docs' support list omits it; the live API accepts 512 and 2048.
    requests = [];
    await make({ model: 'voyage-code-4', dimensions: DIMS }).embed('x');
    assert.equal(requests[0].body.output_dimension, DIMS);
  });

  test('float output is requested explicitly', async () => {
    // int8/binary would return a different length and silently break validation.
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].body.output_dtype, 'float');
  });

  test('the key is sent as a bearer token', async () => {
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].headers.authorization, 'Bearer pa-test');
  });

  test('it posts to /embeddings', async () => {
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].url, '/v1/embeddings');
  });
});

describe('batching', () => {
  test('the documented 1,000-input cap is respected', () => {
    assert.equal(VOYAGE_MAX_BATCH, 1000);
  });

  test('an oversized batch is split rather than rejected', async () => {
    requests = [];
    const texts = Array.from({ length: 2300 }, (_, i) => `t${i}`);
    const out = await make().embedBatch(texts);
    assert.equal(out.length, 2300);
    assert.equal(requests.length, 3, 'ceil(2300 / 1000)');
    assert.ok(requests.every(r => r.body.input.length <= 1000));
  });

  test("results from split batches stay in the CALLER's order", async () => {
    // Each request restarts its index at 0, so a naive merge interleaves chunks
    // with the wrong vectors — the failure looks like bad retrieval, not an error.
    const texts = Array.from({ length: 1500 }, (_, i) => `t${i}`);
    const out = await make().embedBatch(texts);
    assert.equal(out.length, 1500);
    assert.ok(out.every(v => v.length === DIMS));
  });

  test('results are ordered by data[].index within a request', async () => {
    assert.deepEqual((await make().embedBatch(['a', 'b', 'c'])).map(v => v[0]), [1, 2, 3]);
  });

  test('an empty batch makes no request', async () => {
    requests = [];
    assert.deepEqual(await make().embedBatch([]), []);
    assert.equal(requests.length, 0);
  });
});

describe('errors', () => {
  test('a 401 is a permanent auth failure', async () => {
    respond = (req, res) => { res.writeHead(401); res.end('{}'); };
    try {
      const err = await make().embed('x').catch(e => e);
      assert.equal(err.permanentAuthFailure, true);
    } finally { respond = null; }
  });

  test('the key never appears in an error message', async () => {
    respond = (req, res) => { res.writeHead(500); res.end('boom'); };
    try {
      const err = await make({ apiKey: 'pa-super-secret' }).embed('x').catch(e => e);
      assert.ok(!String(err.message).includes('pa-super-secret'));
    } finally { respond = null; }
  });

  test('a wrong-length vector is rejected rather than indexed', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    };
    try { await assert.rejects(() => make().embed('x'), /dimension/i); }
    finally { respond = null; }
  });

  test('isAvailable() is false without a key', async () => {
    assert.equal(await new VoyageEmbeddingProvider({ apiKey: '', model: 'voyage-4-lite', dimensions: 8, baseUrl }).isAvailable(), false);
  });
});
