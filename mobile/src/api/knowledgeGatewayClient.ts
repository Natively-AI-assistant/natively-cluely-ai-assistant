/**
 * Phone-token HTTP client for desktop knowledge gateway routes
 * (GET /knowledge/healthz, /knowledge/docs; POST /knowledge/query, /rag/query).
 * No SQLite — all queries hit the desktop over LAN/Tailscale.
 */

import type { PairingConfig } from '../protocol/types';

export type KnowledgeDocType =
  | 'lesson'
  | 'resume'
  | 'jd'
  | 'reference'
  | 'all';

export const KNOWLEDGE_DOC_TYPES: KnowledgeDocType[] = [
  'all',
  'lesson',
  'resume',
  'jd',
  'reference',
];

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

export interface KnowledgeHealthz {
  ok: boolean;
  knowledgeReady: boolean;
  ragReady: boolean;
}

export class KnowledgeGatewayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.name = 'KnowledgeGatewayError';
    this.status = status;
    this.code = code;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function assertPairing(config: PairingConfig): {
  host: string;
  port: number;
  token: string;
} {
  const host = config.host.trim();
  const portRaw = String(config.port).trim();
  const token = config.phoneToken.trim();
  if (!host) throw new Error('Host is required');
  if (!portRaw) throw new Error('Port is required');
  if (!token) throw new Error('Phone token is required');
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer 1–65535');
  }
  return { host, port, token };
}

/** Base HTTP origin for Phone Mirror knowledge routes. */
export function buildKnowledgeBaseUrl(config: PairingConfig): string {
  const { host, port } = assertPairing(config);
  return `http://${host}:${port}`;
}

export function buildKnowledgeUrl(
  config: PairingConfig,
  pathname: string,
): string {
  const base = buildKnowledgeBaseUrl(config);
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

export function knowledgeAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/json',
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseKnowledgeChunks(body: unknown): KnowledgeGatewayChunk[] {
  const root = asRecord(body);
  const raw = root?.chunks;
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeGatewayChunk[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const text = typeof row.text === 'string' ? row.text : '';
    const similarity =
      typeof row.similarity === 'number' && Number.isFinite(row.similarity)
        ? row.similarity
        : 0;
    const docType = typeof row.docType === 'string' ? row.docType : 'unknown';
    out.push({ text, similarity, docType });
  }
  return out;
}

export function parseRagChunks(body: unknown): RagGatewayChunk[] {
  const root = asRecord(body);
  const raw = root?.chunks;
  if (!Array.isArray(raw)) return [];
  const out: RagGatewayChunk[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const text = typeof row.text === 'string' ? row.text : '';
    const similarity =
      typeof row.similarity === 'number' && Number.isFinite(row.similarity)
        ? row.similarity
        : 0;
    const chunk: RagGatewayChunk = { text, similarity };
    if (row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)) {
      chunk.meta = row.meta as Record<string, unknown>;
    }
    out.push(chunk);
  }
  return out;
}

export function parseDocs(body: unknown): KnowledgeGatewayDocCount[] {
  const root = asRecord(body);
  const raw = root?.docs;
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeGatewayDocCount[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const docType = typeof row.docType === 'string' ? row.docType : '';
    const count =
      typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0;
    if (!docType) continue;
    out.push({ docType, count });
  }
  return out;
}

export function parseHealthz(body: unknown): KnowledgeHealthz {
  const root = asRecord(body);
  return {
    ok: Boolean(root?.ok),
    knowledgeReady: Boolean(root?.knowledgeReady),
    ragReady: Boolean(root?.ragReady),
  };
}

async function readGatewayError(
  status: number,
  res: { json(): Promise<unknown>; text(): Promise<string> },
): Promise<KnowledgeGatewayError> {
  if (status === 401) {
    return new KnowledgeGatewayError(
      401,
      'unauthorized',
      'Unauthorized (401) — check phone token matches desktop Sync / QR.',
    );
  }
  let code = 'request_failed';
  let message = `Request failed (${status})`;
  try {
    const text = await res.text();
    if (text.trim()) {
      try {
        const body = JSON.parse(text) as unknown;
        const root = asRecord(body);
        if (typeof root?.error === 'string') code = root.error;
        if (typeof root?.message === 'string') message = root.message;
        else if (typeof root?.error === 'string') message = root.error;
      } catch {
        message = text.trim().slice(0, 200);
      }
    }
  } catch {
    /* ignore */
  }
  return new KnowledgeGatewayError(status, code, message);
}

async function gatewayFetch(
  config: PairingConfig,
  pathname: string,
  init: {
    method: string;
    body?: Record<string, unknown>;
  },
  fetchImpl: FetchLike,
): Promise<unknown> {
  const { token } = assertPairing(config);
  const url = buildKnowledgeUrl(config, pathname);
  const headers: Record<string, string> = {
    ...knowledgeAuthHeaders(token),
  };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetchImpl(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw await readGatewayError(res.status, res);
  }
  return res.json();
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available');
  }
  return fetch as FetchLike;
}

export async function getKnowledgeHealthz(
  config: PairingConfig,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<KnowledgeHealthz> {
  const body = await gatewayFetch(
    config,
    '/knowledge/healthz',
    { method: 'GET' },
    fetchImpl,
  );
  return parseHealthz(body);
}

export async function listKnowledgeDocs(
  config: PairingConfig,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<KnowledgeGatewayDocCount[]> {
  const body = await gatewayFetch(
    config,
    '/knowledge/docs',
    { method: 'GET' },
    fetchImpl,
  );
  return parseDocs(body);
}

export async function queryKnowledge(
  config: PairingConfig,
  opts: {
    query: string;
    docType?: KnowledgeDocType;
    limit?: number;
  },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<KnowledgeGatewayChunk[]> {
  const query = opts.query.trim();
  if (!query) throw new Error('Query is required');
  const payload: Record<string, unknown> = { query };
  if (opts.docType && opts.docType !== 'all') {
    payload.docType = opts.docType;
  } else if (opts.docType === 'all') {
    payload.docType = 'all';
  }
  if (opts.limit !== undefined) payload.limit = opts.limit;
  const body = await gatewayFetch(
    config,
    '/knowledge/query',
    { method: 'POST', body: payload },
    fetchImpl,
  );
  return parseKnowledgeChunks(body);
}

export async function queryRag(
  config: PairingConfig,
  opts: { query: string; limit?: number },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<RagGatewayChunk[]> {
  const query = opts.query.trim();
  if (!query) throw new Error('Query is required');
  const payload: Record<string, unknown> = { query };
  if (opts.limit !== undefined) payload.limit = opts.limit;
  const body = await gatewayFetch(
    config,
    '/rag/query',
    { method: 'POST', body: payload },
    fetchImpl,
  );
  return parseRagChunks(body);
}
