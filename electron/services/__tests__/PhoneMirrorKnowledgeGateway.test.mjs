// electron/services/__tests__/PhoneMirrorKnowledgeGateway.test.mjs
//
// Ticket 16 — Tailscale knowledge gateway HTTP on Phone Mirror.
// Drives the REAL compiled PhoneMirrorService (dist-electron) with injectable
// KnowledgeOrchestrator / RAG fakes at the HTTP seam.
//
// Asserts:
//   - phone-token auth (Bearer and ?t=); bad/missing → 401
//   - /knowledge/query → KnowledgeOrchestrator path
//   - /rag/query → RAG retrieve path (not streaming LLM)
//   - limit default 5, capped at 20; empty corpus → 200 + chunks:[]
//   - phone token still cannot access extension /dom

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

const compiledServicePath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/PhoneMirrorService.js',
);
const compiledGatewayPath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/phoneMirrorKnowledgeGateway.js',
);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-kgw-'));

const safeStorageStub = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
  decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
};

class FakeBrowserWindow {
  static getFocusedWindow() {
    return null;
  }
  static getAllWindows() {
    return [];
  }
}

const electronStub = {
  app: {
    isReady: () => true,
    getPath: () => userDataDir,
    whenReady: () => Promise.resolve(),
    on: () => {},
  },
  BrowserWindow: FakeBrowserWindow,
  safeStorage: safeStorageStub,
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let PhoneMirrorService;
let clampGatewayLimit;
let extractPhoneMirrorToken;
let createKnowledgeGatewayDeps;

before(async () => {
  const mod = await import(pathToFileURL(compiledServicePath).href);
  PhoneMirrorService = mod.PhoneMirrorService;
  const gw = await import(pathToFileURL(compiledGatewayPath).href);
  clampGatewayLimit = gw.clampGatewayLimit;
  extractPhoneMirrorToken = gw.extractPhoneMirrorToken;
  createKnowledgeGatewayDeps = gw.createKnowledgeGatewayDeps;
});

after(() => {
  Module._load = originalLoad;
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
});

async function freshService() {
  const svc = PhoneMirrorService.getInstance();
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.setKnowledgeGatewayDeps(null);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  return { svc, info };
}

async function httpJson(port, method, pathname, { token, bearer, body } = {}) {
  const url = new URL(`http://127.0.0.1:${port}${pathname}`);
  if (token) url.searchParams.set('t', token);
  const headers = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function makeFakeDeps(overrides = {}) {
  const calls = { knowledge: [], rag: [], listDocs: 0 };
  const deps = {
    isKnowledgeReady: () => true,
    isRagReady: () => true,
    listDocs: () => {
      calls.listDocs += 1;
      return [
        { docType: 'lesson', count: 2 },
        { docType: 'resume', count: 1 },
      ];
    },
    queryKnowledge: async (query, docType, limit) => {
      calls.knowledge.push({ query, docType, limit });
      return [
        { text: `k:${query}`, similarity: 0.91, docType: docType && docType !== 'all' ? docType : 'lesson' },
      ];
    },
    queryRag: async (query, limit) => {
      calls.rag.push({ query, limit });
      return [
        {
          text: `r:${query}`,
          similarity: 0.77,
          meta: { meetingId: 'm1' },
        },
      ];
    },
    ...overrides,
  };
  return { deps, calls };
}

// ---------------------------------------------------------------------------

describe('phoneMirrorKnowledgeGateway helpers', () => {
  test('clampGatewayLimit defaults to 5 and caps at 20', () => {
    assert.equal(clampGatewayLimit(undefined), 5);
    assert.equal(clampGatewayLimit(null), 5);
    assert.equal(clampGatewayLimit('x'), 5);
    assert.equal(clampGatewayLimit(0), 5);
    assert.equal(clampGatewayLimit(-3), 5);
    assert.equal(clampGatewayLimit(3), 3);
    assert.equal(clampGatewayLimit(20), 20);
    assert.equal(clampGatewayLimit(99), 20);
    assert.equal(clampGatewayLimit(5.9), 5);
  });

  test('extractPhoneMirrorToken prefers Bearer over ?t=', () => {
    const url = new URL('http://localhost/knowledge/healthz?t=fromQuery');
    const req = { headers: { authorization: 'Bearer fromHeader' } };
    assert.equal(extractPhoneMirrorToken(req, url), 'fromHeader');
    assert.equal(
      extractPhoneMirrorToken({ headers: {} }, url),
      'fromQuery',
    );
  });

  test('createKnowledgeGatewayDeps maps orchestrator + retrieveGlobal (not query stream)', async () => {
    const orchCalls = [];
    const retrieveCalls = [];
    const deps = createKnowledgeGatewayDeps({
      getKnowledgeOrchestrator: () => ({
        listDocTypeCounts: () => [{ docType: 'jd', count: 1 }],
        queryRelevantChunks: async (query, a, b) => {
          orchCalls.push([query, a, b]);
          return [{ text: 'chunk', similarity: 0.5, docType: 'jd' }];
        },
      }),
      getRagManager: () => ({
        getEmbeddingPipeline: () => ({ isReady: () => true }),
        getRetriever: () => ({
          retrieveGlobal: async (query, opts) => {
            retrieveCalls.push([query, opts]);
            return {
              chunks: [
                {
                  text: 'meeting bit',
                  similarity: 0.6,
                  meetingId: 'mtg',
                  speaker: 'A',
                },
              ],
            };
          },
        }),
        // Intentionally present — gateway must NOT call this streaming LLM path.
        query: async function* () {
          throw new Error('RAGManager.query must not be used by gateway');
        },
      }),
    });

    assert.equal(deps.isKnowledgeReady(), true);
    assert.equal(deps.isRagReady(), true);
    assert.deepEqual(await deps.listDocs(), [{ docType: 'jd', count: 1 }]);

    const k = await deps.queryKnowledge('hello', 'resume', 7);
    assert.deepEqual(orchCalls[0], ['hello', 'resume', 7]);
    assert.equal(k[0].docType, 'jd');

    await deps.queryKnowledge('all-q', 'all', 4);
    // (query, limit) overload — third formal param on the spy is undefined
    assert.equal(orchCalls[1][0], 'all-q');
    assert.equal(orchCalls[1][1], 4);
    assert.equal(orchCalls[1][2], undefined);

    const r = await deps.queryRag('meet?', 3);
    assert.deepEqual(retrieveCalls[0], ['meet?', { topK: 3 }]);
    assert.equal(r[0].meta.meetingId, 'mtg');
  });
});

describe('PhoneMirror knowledge gateway HTTP', () => {
  test('missing/bad token → 401 on all gateway routes', async () => {
    const { svc, info } = await freshService();
    const { deps } = makeFakeDeps();
    svc.setKnowledgeGatewayDeps(deps);

    for (const [method, path, body] of [
      ['GET', '/knowledge/healthz'],
      ['GET', '/knowledge/docs'],
      ['POST', '/knowledge/query', { query: 'x' }],
      ['POST', '/rag/query', { query: 'x' }],
    ]) {
      const noTok = await httpJson(info.port, method, path, { body });
      assert.equal(noTok.status, 401, `${path} missing token`);
      const bad = await httpJson(info.port, method, path, {
        token: 'not-the-phone-token',
        body,
      });
      assert.equal(bad.status, 401, `${path} bad token`);
    }

    await svc.stop({ persist: false });
  });

  test('Bearer phone token authenticates /knowledge/healthz', async () => {
    const { svc, info } = await freshService();
    svc.setKnowledgeGatewayDeps(makeFakeDeps().deps);

    const r = await httpJson(info.port, 'GET', '/knowledge/healthz', {
      bearer: info.token,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.knowledgeReady, true);
    assert.equal(r.json.ragReady, true);
    assert.equal(r.json.token, undefined);
    assert.equal(r.json.phoneToken, undefined);

    await svc.stop({ persist: false });
  });

  test('?t= phone token lists docs and queries knowledge + rag', async () => {
    const { svc, info } = await freshService();
    const { deps, calls } = makeFakeDeps();
    svc.setKnowledgeGatewayDeps(deps);

    const docs = await httpJson(info.port, 'GET', '/knowledge/docs', {
      token: info.token,
    });
    assert.equal(docs.status, 200);
    assert.deepEqual(docs.json.docs, [
      { docType: 'lesson', count: 2 },
      { docType: 'resume', count: 1 },
    ]);

    const kq = await httpJson(info.port, 'POST', '/knowledge/query', {
      token: info.token,
      body: { query: 'design patterns', docType: 'lesson', limit: 3 },
    });
    assert.equal(kq.status, 200);
    assert.equal(kq.json.chunks.length, 1);
    assert.equal(kq.json.chunks[0].text, 'k:design patterns');
    assert.equal(kq.json.chunks[0].docType, 'lesson');
    assert.deepEqual(calls.knowledge[0], {
      query: 'design patterns',
      docType: 'lesson',
      limit: 3,
    });

    const rq = await httpJson(info.port, 'POST', '/rag/query', {
      token: info.token,
      body: { query: 'what did we decide', limit: 2 },
    });
    assert.equal(rq.status, 200);
    assert.equal(rq.json.chunks[0].text, 'r:what did we decide');
    assert.equal(rq.json.chunks[0].meta.meetingId, 'm1');
    assert.deepEqual(calls.rag[0], { query: 'what did we decide', limit: 2 });

    await svc.stop({ persist: false });
  });

  test('limit defaults to 5 and is capped at 20', async () => {
    const { svc, info } = await freshService();
    const { deps, calls } = makeFakeDeps();
    svc.setKnowledgeGatewayDeps(deps);

    await httpJson(info.port, 'POST', '/knowledge/query', {
      token: info.token,
      body: { query: 'q' },
    });
    assert.equal(calls.knowledge[0].limit, 5);

    await httpJson(info.port, 'POST', '/rag/query', {
      token: info.token,
      body: { query: 'q', limit: 100 },
    });
    assert.equal(calls.rag[0].limit, 20);

    await svc.stop({ persist: false });
  });

  test('empty corpus → 200 + chunks:[] (not 500)', async () => {
    const { svc, info } = await freshService();
    svc.setKnowledgeGatewayDeps(
      makeFakeDeps({
        queryKnowledge: async () => [],
        queryRag: async () => [],
      }).deps,
    );

    const kq = await httpJson(info.port, 'POST', '/knowledge/query', {
      token: info.token,
      body: { query: 'nothing here' },
    });
    assert.equal(kq.status, 200);
    assert.deepEqual(kq.json.chunks, []);

    const rq = await httpJson(info.port, 'POST', '/rag/query', {
      token: info.token,
      body: { query: 'nothing here' },
    });
    assert.equal(rq.status, 200);
    assert.deepEqual(rq.json.chunks, []);

    // Deps throw must also degrade to empty 200, not 500.
    svc.setKnowledgeGatewayDeps(
      makeFakeDeps({
        queryKnowledge: async () => {
          throw new Error('db down');
        },
      }).deps,
    );
    const errQ = await httpJson(info.port, 'POST', '/knowledge/query', {
      token: info.token,
      body: { query: 'x' },
    });
    assert.equal(errQ.status, 200);
    assert.deepEqual(errQ.json.chunks, []);

    await svc.stop({ persist: false });
  });

  test('without injected deps, authenticated healthz reports not ready + empty queries', async () => {
    const { svc, info } = await freshService();
    // deps left null

    const hz = await httpJson(info.port, 'GET', '/knowledge/healthz', {
      token: info.token,
    });
    assert.equal(hz.status, 200);
    assert.equal(hz.json.knowledgeReady, false);
    assert.equal(hz.json.ragReady, false);

    const kq = await httpJson(info.port, 'POST', '/knowledge/query', {
      token: info.token,
      body: { query: 'x' },
    });
    assert.equal(kq.status, 200);
    assert.deepEqual(kq.json.chunks, []);

    await svc.stop({ persist: false });
  });

  test('phone token cannot access extension /dom (regression)', async () => {
    const { svc, info } = await freshService();
    svc.setKnowledgeGatewayDeps(makeFakeDeps().deps);

    // Phone token works on knowledge gateway…
    const hz = await httpJson(info.port, 'GET', '/knowledge/healthz', {
      token: info.token,
    });
    assert.equal(hz.status, 200);

    // …but must NOT unlock /dom (extToken only).
    const dom = await fetch(
      `http://127.0.0.1:${info.port}/dom?t=${encodeURIComponent(info.token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dom: 'should not deliver', probe: true }),
      },
    );
    assert.equal(dom.status, 401);

    // Ext token still works for /dom probe.
    const ok = await fetch(
      `http://127.0.0.1:${info.port}/dom?t=${encodeURIComponent(info.extToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dom: 'probe', probe: true }),
      },
    );
    assert.equal(ok.status, 200);

    await svc.stop({ persist: false });
  });

  test('extension token is rejected on knowledge routes (phone token only)', async () => {
    const { svc, info } = await freshService();
    svc.setKnowledgeGatewayDeps(makeFakeDeps().deps);

    const r = await httpJson(info.port, 'GET', '/knowledge/healthz', {
      token: info.extToken,
    });
    assert.equal(r.status, 401);

    await svc.stop({ persist: false });
  });
});
