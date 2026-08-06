import {
  KnowledgeGatewayError,
  buildKnowledgeBaseUrl,
  buildKnowledgeUrl,
  knowledgeAuthHeaders,
  parseDocs,
  parseHealthz,
  parseKnowledgeChunks,
  parseRagChunks,
  queryKnowledge,
  queryRag,
  getKnowledgeHealthz,
  listKnowledgeDocs,
  type FetchLike,
} from '../knowledgeGatewayClient';

const pairing = {
  host: '100.64.0.2',
  port: '4123',
  phoneToken: 'secret+tok',
};

function mockFetch(opts: {
  status?: number;
  body?: unknown;
  capture?: { url?: string; init?: Parameters<FetchLike>[1] };
}): FetchLike {
  return async (url, init) => {
    if (opts.capture) {
      opts.capture.url = url;
      opts.capture.init = init;
    }
    const status = opts.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => opts.body ?? {},
      text: async () => JSON.stringify(opts.body ?? {}),
    };
  };
}

describe('knowledgeGatewayClient URLs / auth', () => {
  it('builds HTTP base and path URLs from pairing', () => {
    expect(buildKnowledgeBaseUrl(pairing)).toBe('http://100.64.0.2:4123');
    expect(buildKnowledgeUrl(pairing, '/knowledge/query')).toBe(
      'http://100.64.0.2:4123/knowledge/query',
    );
    expect(buildKnowledgeUrl(pairing, 'rag/query')).toBe(
      'http://100.64.0.2:4123/rag/query',
    );
  });

  it('sets Bearer Authorization header', () => {
    expect(knowledgeAuthHeaders('abc123')).toEqual({
      Authorization: 'Bearer abc123',
      Accept: 'application/json',
    });
  });

  it('sends Bearer auth on knowledge query', async () => {
    const capture: { url?: string; init?: Parameters<FetchLike>[1] } = {};
    await queryKnowledge(
      pairing,
      { query: 'system design', docType: 'resume', limit: 3 },
      mockFetch({
        body: { chunks: [] },
        capture,
      }),
    );
    expect(capture.url).toBe('http://100.64.0.2:4123/knowledge/query');
    expect(capture.init?.method).toBe('POST');
    expect(capture.init?.headers?.Authorization).toBe('Bearer secret+tok');
    expect(JSON.parse(capture.init?.body || '{}')).toEqual({
      query: 'system design',
      docType: 'resume',
      limit: 3,
    });
  });

  it('sends RAG query to /rag/query', async () => {
    const capture: { url?: string; init?: Parameters<FetchLike>[1] } = {};
    await queryRag(
      pairing,
      { query: 'past meeting note' },
      mockFetch({ body: { chunks: [] }, capture }),
    );
    expect(capture.url).toBe('http://100.64.0.2:4123/rag/query');
    expect(JSON.parse(capture.init?.body || '{}')).toEqual({
      query: 'past meeting note',
    });
  });
});

describe('knowledgeGatewayClient parse', () => {
  it('parses knowledge chunks', () => {
    expect(
      parseKnowledgeChunks({
        chunks: [
          { text: 'Hello', similarity: 0.91, docType: 'lesson' },
          { text: 'Skip bad', similarity: 'x', docType: 1 },
        ],
      }),
    ).toEqual([
      { text: 'Hello', similarity: 0.91, docType: 'lesson' },
      { text: 'Skip bad', similarity: 0, docType: 'unknown' },
    ]);
  });

  it('parses RAG chunks with optional meta', () => {
    expect(
      parseRagChunks({
        chunks: [
          {
            text: 'From meeting',
            similarity: 0.7,
            meta: { meetingId: 'm1', speaker: 'Alex' },
          },
        ],
      }),
    ).toEqual([
      {
        text: 'From meeting',
        similarity: 0.7,
        meta: { meetingId: 'm1', speaker: 'Alex' },
      },
    ]);
  });

  it('parses docs and healthz', () => {
    expect(
      parseDocs({
        docs: [
          { docType: 'resume', count: 2 },
          { docType: 'lesson', count: 0 },
        ],
      }),
    ).toEqual([
      { docType: 'resume', count: 2 },
      { docType: 'lesson', count: 0 },
    ]);
    expect(
      parseHealthz({ ok: true, knowledgeReady: true, ragReady: false }),
    ).toEqual({ ok: true, knowledgeReady: true, ragReady: false });
  });

  it('returns empty arrays for missing chunks', () => {
    expect(parseKnowledgeChunks({})).toEqual([]);
    expect(parseRagChunks({ chunks: null })).toEqual([]);
  });
});

describe('knowledgeGatewayClient errors', () => {
  it('surfaces 401 clearly', async () => {
    await expect(
      queryKnowledge(
        pairing,
        { query: 'x' },
        mockFetch({ status: 401, body: { error: 'unauthorized' } }),
      ),
    ).rejects.toMatchObject({
      name: 'KnowledgeGatewayError',
      status: 401,
      code: 'unauthorized',
      isUnauthorized: true,
    });

    const err = await getKnowledgeHealthz(
      pairing,
      mockFetch({ status: 401, body: { error: 'unauthorized' } }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnowledgeGatewayError);
    expect((err as KnowledgeGatewayError).message).toMatch(/401/);
    expect((err as KnowledgeGatewayError).message).toMatch(/phone token/i);
  });

  it('propagates gateway error codes', async () => {
    await expect(
      listKnowledgeDocs(
        pairing,
        mockFetch({
          status: 400,
          body: { error: 'bad_request', message: 'query required' },
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'query required',
    });
  });
});
