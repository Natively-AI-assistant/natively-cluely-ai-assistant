// electron/services/phoneMirrorKnowledgeGateway.ts
//
// Tailscale knowledge gateway HTTP handlers (ticket 16 / locked routes from
// ticket 13). Lives in its own module so PhoneMirrorService.handleHttp only
// thin-wires here — keeps merge conflict surface small vs ticket 17 (WS).
//
// Auth: phone token via `Authorization: Bearer <token>` and/or `?t=` (same
// token as Phone Mirror phone clients). Extension `/dom` stays extToken-only.

import type http from 'http';
import type { URL } from 'url';

export const KNOWLEDGE_GATEWAY_DEFAULT_LIMIT = 5;
export const KNOWLEDGE_GATEWAY_MAX_LIMIT = 20;

export type KnowledgeGatewayDocType =
  | 'lesson'
  | 'resume'
  | 'jd'
  | 'reference'
  | 'all';

export interface KnowledgeGatewayChunk {
  text: string;
  similarity: number;
  docType: string;
}

export interface RagGatewayChunk {
  text: string;
  similarity: number;
  meta?: Record<string, unknown>;
}

export interface KnowledgeGatewayDocCount {
  docType: string;
  count: number;
}

/**
 * Injectable seam for KnowledgeOrchestrator + RAG retrieve. Tests supply fakes;
 * main/ipcHandlers wire the real orchestrator + RAGManager.getRetriever().
 */
export interface KnowledgeGatewayDeps {
  isKnowledgeReady: () => boolean;
  isRagReady: () => boolean;
  listDocs: () => KnowledgeGatewayDocCount[] | Promise<KnowledgeGatewayDocCount[]>;
  queryKnowledge: (
    query: string,
    docType: KnowledgeGatewayDocType | undefined,
    limit: number,
  ) => Promise<KnowledgeGatewayChunk[]>;
  queryRag: (query: string, limit: number) => Promise<RagGatewayChunk[]>;
}

export interface KnowledgeGatewayAuth {
  phoneToken: string;
  equal: (a: string, b: string) => boolean;
}

const KNOWLEDGE_PATHS = new Set([
  '/knowledge/healthz',
  '/knowledge/docs',
  '/knowledge/query',
  '/rag/query',
]);

const VALID_DOC_TYPES = new Set<string>(['lesson', 'resume', 'jd', 'reference', 'all']);

export function isKnowledgeGatewayPath(pathname: string): boolean {
  return KNOWLEDGE_PATHS.has(pathname);
}

/** Extract phone token from Bearer header and/or `?t=` (Bearer wins if both). */
export function extractPhoneMirrorToken(
  req: http.IncomingMessage,
  url: URL,
): string {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const m = header.match(/^Bearer\s+(\S+)\s*$/i);
    if (m?.[1]) return m[1];
  }
  return url.searchParams.get('t') || '';
}

export function clampGatewayLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return KNOWLEDGE_GATEWAY_DEFAULT_LIMIT;
  }
  const n = Math.floor(raw);
  if (n < 1) return KNOWLEDGE_GATEWAY_DEFAULT_LIMIT;
  return Math.min(n, KNOWLEDGE_GATEWAY_MAX_LIMIT);
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { error: 'unauthorized' });
}

function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > maxBytes) {
        tooLarge = true;
        json(res, 413, { error: 'payload_too_large' });
        req.socket.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        json(res, 400, { error: 'bad_request' });
        resolve(null);
      }
    });
    req.on('error', () => {
      json(res, 400, { error: 'bad_request' });
      resolve(null);
    });
  });
}

/**
 * Handle a knowledge/RAG gateway request. Caller must have confirmed the path
 * via `isKnowledgeGatewayPath`. Always consumes the response.
 */
export async function handleKnowledgeGatewayRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  auth: KnowledgeGatewayAuth,
  deps: KnowledgeGatewayDeps | null,
): Promise<void> {
  const provided = extractPhoneMirrorToken(req, url);
  if (!auth.phoneToken || !provided || !auth.equal(provided, auth.phoneToken)) {
    unauthorized(res);
    return;
  }

  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  if (pathname === '/knowledge/healthz') {
    if (method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    json(res, 200, {
      ok: true,
      knowledgeReady: Boolean(deps?.isKnowledgeReady()),
      ragReady: Boolean(deps?.isRagReady()),
    });
    return;
  }

  if (pathname === '/knowledge/docs') {
    if (method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    try {
      const docs = deps ? await deps.listDocs() : [];
      json(res, 200, { docs: Array.isArray(docs) ? docs : [] });
    } catch (err) {
      console.warn('[PhoneMirrorKnowledgeGateway] listDocs failed:', err);
      json(res, 200, { docs: [] });
    }
    return;
  }

  if (pathname === '/knowledge/query') {
    if (method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const parsed = await readJsonBody(req, res, 64_000);
    if (parsed === null) return;
    const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      json(res, 400, { error: 'bad_request', message: 'query required' });
      return;
    }
    let docType: KnowledgeGatewayDocType | undefined;
    if (body.docType !== undefined && body.docType !== null) {
      if (typeof body.docType !== 'string' || !VALID_DOC_TYPES.has(body.docType)) {
        json(res, 400, { error: 'bad_request', message: 'invalid docType' });
        return;
      }
      docType = body.docType as KnowledgeGatewayDocType;
    }
    const limit = clampGatewayLimit(body.limit);
    try {
      const chunks = deps ? await deps.queryKnowledge(query, docType, limit) : [];
      json(res, 200, { chunks: Array.isArray(chunks) ? chunks.slice(0, limit) : [] });
    } catch (err) {
      console.warn('[PhoneMirrorKnowledgeGateway] queryKnowledge failed:', err);
      json(res, 200, { chunks: [] });
    }
    return;
  }

  if (pathname === '/rag/query') {
    if (method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const parsed = await readJsonBody(req, res, 64_000);
    if (parsed === null) return;
    const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      json(res, 400, { error: 'bad_request', message: 'query required' });
      return;
    }
    const limit = clampGatewayLimit(body.limit);
    try {
      const chunks = deps ? await deps.queryRag(query, limit) : [];
      json(res, 200, { chunks: Array.isArray(chunks) ? chunks.slice(0, limit) : [] });
    } catch (err) {
      console.warn('[PhoneMirrorKnowledgeGateway] queryRag failed:', err);
      json(res, 200, { chunks: [] });
    }
    return;
  }

  json(res, 404, { error: 'not_found' });
}

type KnowledgeOrchestratorLike = {
  queryRelevantChunks: (
    query: string,
    docTypeOrLimit?: string | number,
    maybeLimit?: number,
  ) => Promise<Array<{ text: string; similarity: number; docType: string }>>;
  listDocTypeCounts?: () => Array<{ docType: string; count: number }>;
};

type RagManagerLike = {
  getEmbeddingPipeline?: () => { isReady?: () => boolean } | null;
  getRetriever: () => {
    retrieveGlobal: (
      query: string,
      options?: { topK?: number },
    ) => Promise<{
      chunks: Array<{
        text: string;
        similarity: number;
        meetingId?: string;
        speaker?: string;
        startMs?: number;
        endMs?: number;
        chunkIndex?: number;
      }>;
    }>;
  };
};

/**
 * Build production deps from KnowledgeOrchestrator + RAGManager. Accepts
 * getters so late init / re-init is reflected without re-wiring PhoneMirror.
 * Keeps the HTTP module free of direct knowledge/rag imports so tests stay light.
 */
export function createKnowledgeGatewayDeps(opts: {
  getKnowledgeOrchestrator: () => KnowledgeOrchestratorLike | null | undefined;
  getRagManager: () => RagManagerLike | null | undefined;
}): KnowledgeGatewayDeps {
  const orch = () => opts.getKnowledgeOrchestrator() ?? null;
  const rag = () => opts.getRagManager() ?? null;
  return {
    isKnowledgeReady: () => Boolean(orch()),
    isRagReady: () => {
      const r = rag();
      if (!r) return false;
      try {
        return Boolean(r.getEmbeddingPipeline?.()?.isReady?.());
      } catch {
        return false;
      }
    },
    listDocs: () => {
      const o = orch();
      if (!o?.listDocTypeCounts) return [];
      try {
        return o.listDocTypeCounts();
      } catch {
        return [];
      }
    },
    queryKnowledge: async (query, docType, limit) => {
      const o = orch();
      if (!o) return [];
      const typeFilter =
        !docType || docType === 'all' ? undefined : docType;
      const rows = typeFilter
        ? await o.queryRelevantChunks(query, typeFilter, limit)
        : await o.queryRelevantChunks(query, limit);
      return (rows || []).map((r) => ({
        text: r.text,
        similarity: r.similarity,
        docType: r.docType,
      }));
    },
    queryRag: async (query, limit) => {
      const r = rag();
      if (!r) return [];
      const ctx = await r.getRetriever().retrieveGlobal(query, { topK: limit });
      return (ctx.chunks || []).map((c) => {
        const meta: Record<string, unknown> = {};
        if (c.meetingId !== undefined) meta.meetingId = c.meetingId;
        if (c.speaker !== undefined) meta.speaker = c.speaker;
        if (c.startMs !== undefined) meta.startMs = c.startMs;
        if (c.endMs !== undefined) meta.endMs = c.endMs;
        if (c.chunkIndex !== undefined) meta.chunkIndex = c.chunkIndex;
        return {
          text: c.text,
          similarity: c.similarity,
          ...(Object.keys(meta).length ? { meta } : {}),
        };
      });
    },
  };
}
