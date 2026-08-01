import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import type { DefenceConfig } from './config';
import { publicConfig } from './config';
import { ProjectIndexer } from './projectIndexer';
import { QuestionDetector } from './questionDetector';
import { AnswerEngine } from './answerEngine';
import { SttProvider } from './providers';
import { ProviderError } from './providers';
import { AudioChunkTracker, AudioProtocolError, allowedAudioMimeTypes } from './audioProtocol';
import type { DefenceSettings, StructuredAnswer } from './types';

const DEFAULT_SETTINGS: DefenceSettings = { inputLanguage: 'auto', outputLanguage: 'follow', answerDepth: 'standard', searchMode: 'off' };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface Pairing { id: string; codeHash: string; secretHash: string; expiresAt: number; used: boolean; failedAttempts: number }
interface SessionDiagnostics { lastAudioBytes?: number; lastAudioMime?: string; lastSttLatencyMs?: number; sttStatus?: number; sttRetries?: number; sttRequestId?: string; partialCount: number; finalCount: number; lastErrorCode?: string; retrievalMs?: number; candidateCount?: number; evidenceCount?: number; llmFirstResponseMs?: number; llmTotalMs?: number; llmStatus?: number; llmRetries?: number; llmRequestId?: string; schemaValid?: boolean }
interface Session { id: string; tokenHash: string; createdAt: number; settings: DefenceSettings; detector: QuestionDetector; audio: AudioChunkTracker; transcript: string; answers: StructuredAnswer[]; diagnostics: SessionDiagnostics; questionCounter: number; lastQuestionId?: string; revision: number; abort?: AbortController }
interface ProjectRegistryEntry { projectId: string; displayName: string; sourcePath: string; indexPath: string; personaPath?: string; verifiedFactsPath?: string }
type ServerMode = 'full' | 'companion';
interface DefenceRuntime { pairings: Map<string, Pairing>; sessions: Map<string, Session> }
export function createDefenceRuntime(): DefenceRuntime { return { pairings: new Map(), sessions: new Map() }; }

function token(): string { return crypto.randomBytes(24).toString('base64url'); }
function hash(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeEqual(a: string, b: string): boolean { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function loopback(address?: string): boolean { return !address || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
export function isAdminRequestAllowed(remoteAddress: string | undefined, adminLocalOnly: boolean): boolean { return !adminLocalOnly || loopback(remoteAddress); }

function lanAddresses(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) if (item.family === 'IPv4' && !item.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address)) result.push(item.address);
  return result;
}

function contentType(file: string): string {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' } as Record<string, string>)[path.extname(file)] || 'application/octet-stream';
}

export class DefenceServer {
  private server: http.Server | https.Server; private wss: WebSocketServer; private listeningPort = 0;
  private indexer: ProjectIndexer; private engine: AnswerEngine; private stt: SttProvider;
  private pairings: Map<string, Pairing>; private sessions: Map<string, Session>;
  private requestBuckets = new Map<string, { count: number; reset: number }>();
  constructor(private config: DefenceConfig, private mode: ServerMode = 'full', runtime: DefenceRuntime = createDefenceRuntime()) {
    this.pairings = runtime.pairings; this.sessions = runtime.sessions;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: Math.max(10 * 1024 * 1024, Math.ceil(config.maxAudioBytes * 4 / 3) + 64 * 1024) });
    this.indexer = new ProjectIndexer(config.projectSourcePath, config.indexPath); this.engine = new AnswerEngine(config); this.stt = new SttProvider(config.stt);
    const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => { void this.handle(req, res); };
    this.server = config.tls.enabled
      ? https.createServer({ cert: fs.readFileSync(config.tls.certPath), key: fs.readFileSync(config.tls.keyPath), minVersion: 'TLSv1.2' }, handler)
      : http.createServer(handler);
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    (this.wss as any).on('connection', (ws: WebSocket, _req: http.IncomingMessage, session: Session) => this.socket(ws, session));
  }
  async listen(): Promise<{ port: number; urls: string[] }> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.port, this.config.host, resolve); });
    const address = this.server.address(); const port = typeof address === 'object' && address ? address.port : this.config.port; this.listeningPort = port;
    const hosts = this.config.host === '0.0.0.0' ? ['127.0.0.1', ...lanAddresses()] : [this.config.host];
    const protocol = this.config.tls.enabled ? 'https' : 'http'; return { port, urls: hosts.map(host => `${protocol}://${host}:${port}`) };
  }
  async close(): Promise<void> { for (const client of this.wss.clients) client.close(); await new Promise<void>(resolve => this.server.close(() => resolve())); }

  private rate(remote = ''): boolean {
    const now = Date.now(); const bucket = this.requestBuckets.get(remote);
    if (!bucket || bucket.reset < now) { this.requestBuckets.set(remote, { count: 1, reset: now + 60_000 }); return true; }
    bucket.count++; return bucket.count <= 180;
  }
  private json(res: http.ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(body);
  }
  private async body(req: http.IncomingMessage): Promise<any> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > this.config.maxUploadBytes) throw new Error('request_too_large'); chunks.push(chunk); }
    if (!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  private auth(req: http.IncomingMessage): Session | undefined {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    return [...this.sessions.values()].find(session => Date.now() - session.createdAt < SESSION_TTL_MS && safeEqual(session.tokenHash, hash(bearer)));
  }
  private publicDir(): string {
    const source = path.resolve(process.cwd(), 'electron/defence/public');
    return fs.existsSync(source) ? source : path.resolve(__dirname, '../../../electron/defence/public');
  }
  private projectRegistry(): { activeProjectId?: string; projects: ProjectRegistryEntry[] } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.config.projectsConfigPath, 'utf8'));
      return { activeProjectId: String(parsed.activeProjectId || ''), projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
    } catch { return { projects: [] }; }
  }
  private async staticFile(url: URL, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.mode === 'companion' && !['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/service-worker.js'].includes(url.pathname)) return this.json(res, 404, { error: 'not_found' });
    if (url.pathname === '/admin' && !isAdminRequestAllowed(req.socket.remoteAddress, this.config.adminLocalOnly)) return this.json(res, 403, { error: 'admin_loopback_required' });
    const requested = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : url.pathname.slice(1);
    const root = this.publicDir(); const file = path.resolve(root, requested);
    if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) return this.json(res, 404, { error: 'not_found' });
    try { const data = await fs.promises.readFile(file); res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(data); }
    catch { this.json(res, 404, { error: 'not_found' }); }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.rate(req.socket.remoteAddress)) return this.json(res, 429, { error: 'rate_limited' });
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); const method = req.method || 'GET';
      if (!url.pathname.startsWith('/api/')) return await this.staticFile(url, req, res);
      if (this.mode === 'companion') {
        const allowed = (method === 'GET' && url.pathname === '/api/health')
          || (method === 'POST' && url.pathname === '/api/pairing/verify')
          || /^\/api\/defence\/(?:session(?:\/[^/]+)?|answer|retry|history(?:\/\d+)?)$/.test(url.pathname);
        if (!allowed) return this.json(res, 404, { error: 'not_found' });
      }
      if (method === 'GET' && url.pathname === '/api/health') return this.json(res, 200, { ok: true, config: { ...publicConfig(this.config), adminNotExposed: this.mode === 'companion' } });
      const isLocal = loopback(req.socket.remoteAddress);
      const adminAllowed = isAdminRequestAllowed(req.socket.remoteAddress, this.config.adminLocalOnly);
      if (url.pathname === '/api/projects' && method === 'GET') {
        if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' });
        const registry = this.projectRegistry(); return this.json(res, 200, { activeProjectId: this.config.projectId, projects: registry.projects.map(project => ({ projectId: project.projectId, displayName: project.displayName, sourcePath: project.sourcePath, selected: project.projectId === this.config.projectId })) });
      }
      if (url.pathname === '/api/projects/select' && method === 'POST') {
        if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); const data = await this.body(req); const registry = this.projectRegistry(); const selected = registry.projects.find(project => project.projectId === String(data.projectId || ''));
        if (!selected) return this.json(res, 404, { error: 'project_not_registered' });
        const source = path.resolve(selected.sourcePath); const index = path.resolve(selected.indexPath); if (!(await fs.promises.stat(source)).isDirectory()) return this.json(res, 400, { error: 'project_source_not_directory' });
        this.config.projectId = selected.projectId; this.config.projectDisplayName = selected.displayName; this.config.projectSourcePath = source; this.config.indexPath = index; this.indexer = new ProjectIndexer(source, index); this.engine = new AnswerEngine(this.config);
        return this.json(res, 200, { ok: true, projectId: selected.projectId, displayName: selected.displayName, sourcePath: source, indexPath: index, indexed: fs.existsSync(path.join(index, 'manifest.json')) });
      }
      if (url.pathname === '/api/pairing/create' && method === 'POST') {
        if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' });
        const id = crypto.randomUUID(); const code = String(crypto.randomInt(100000, 1000000)); const secret = token();
        const pairing = { id, codeHash: hash(code), secretHash: hash(secret), expiresAt: Date.now() + this.config.pairingTtlMs, used: false, failedAttempts: 0 };
        this.pairings.set(id, pairing); const protocol = this.config.tls.enabled ? 'https' : 'http'; const hosts = this.config.host === '0.0.0.0' ? lanAddresses() : [this.config.host];
        const urls = this.config.publicMode === 'companion-only'
          ? [this.config.companionPublicUrl || `${protocol}://${this.config.companionHost}:${this.config.companionPort}`]
          : hosts.map(ip => `${protocol}://${ip}:${this.listeningPort || this.config.port}`);
        const pairUrl = urls[0] ? `${urls[0]}/?pairingId=${encodeURIComponent(id)}&pairingSecret=${encodeURIComponent(secret)}` : '';
        const qrDataUrl = pairUrl ? await QRCode.toDataURL(pairUrl, { errorCorrectionLevel: 'M', margin: 1, width: 280 }) : null;
        return this.json(res, 201, { id, code, secret, pairUrl, qrDataUrl, expiresAt: new Date(pairing.expiresAt).toISOString(), urls });
      }
      if (url.pathname === '/api/pairing/verify' && method === 'POST') {
        const data = await this.body(req); const pairing = this.pairings.get(String(data.id || ''));
        if (!pairing || pairing.used || pairing.expiresAt < Date.now() || pairing.failedAttempts >= 5) return this.json(res, 401, { error: 'invalid_or_expired_pairing' });
        const secretValid = typeof data.secret === 'string' && safeEqual(pairing.secretHash, hash(data.secret)); const codeValid = typeof data.code === 'string' && safeEqual(pairing.codeHash, hash(data.code));
        if (!secretValid && !codeValid) { pairing.failedAttempts++; if (pairing.failedAttempts >= 5) pairing.used = true; return this.json(res, 401, { error: 'invalid_or_expired_pairing', attemptsRemaining: Math.max(0, 5 - pairing.failedAttempts) }); }
        pairing.used = true; const rawToken = token(); const id = crypto.randomUUID();
        this.sessions.set(id, { id, tokenHash: hash(rawToken), createdAt: Date.now(), settings: DEFAULT_SETTINGS, detector: new QuestionDetector(), audio: new AudioChunkTracker(), transcript: '', answers: [], diagnostics: { partialCount: 0, finalCount: 0 }, questionCounter: 0, revision: 0 });
        return this.json(res, 200, { sessionId: id, token: rawToken, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
      }
      if (url.pathname.startsWith('/api/pairing/') && method === 'DELETE') { if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); this.pairings.delete(url.pathname.split('/').pop()!); return this.json(res, 200, { ok: true }); }
      if (url.pathname === '/api/project/index' && method === 'POST') {
        if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); const data = await this.body(req);
        if (data.path) { const selected = path.resolve(String(data.path)); const stat = await fs.promises.stat(selected); if (!stat.isDirectory()) return this.json(res, 400, { error: 'project_path_not_directory' }); this.config.projectSourcePath = selected; this.indexer = new ProjectIndexer(selected, this.config.indexPath); }
        const result = await this.indexer.index(Boolean(data.fullRebuild)); return this.json(res, 200, result);
      }
      if (url.pathname === '/api/project/index/status' && method === 'GET') { if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); return this.json(res, 200, this.indexer.getProgress()); }
      if (url.pathname === '/api/project/sources' && method === 'GET') { if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); const manifest = await this.indexer.load(); return this.json(res, 200, { projectRoot: manifest.projectRoot, commit: manifest.commit, files: Object.keys(manifest.files), chunks: manifest.chunks.length }); }
      if (url.pathname === '/api/project/index' && method === 'DELETE') { if (!adminAllowed) return this.json(res, 403, { error: 'admin_loopback_required' }); await this.indexer.clear(); return this.json(res, 200, { ok: true }); }
      if (url.pathname === '/api/defence/session' && method === 'POST') { const session = this.auth(req); if (!session) return this.json(res, 401, { error: 'unauthorized' }); return this.json(res, 200, { id: session.id, settings: session.settings }); }
      const sessionMatch = url.pathname.match(/^\/api\/defence\/session\/([^/]+)$/);
      if (sessionMatch) { const session = this.auth(req); if (!session || session.id !== sessionMatch[1]) return this.json(res, 401, { error: 'unauthorized' }); if (method === 'DELETE') { this.sessions.delete(session.id); return this.json(res, 200, { ok: true }); } return this.json(res, 200, { id: session.id, settings: session.settings, transcript: session.transcript, answers: session.answers, diagnostics: session.diagnostics, nextAudioSequence: session.audio.nextSequence }); }
      if (url.pathname === '/api/defence/answer' && method === 'POST') { const session = this.auth(req); if (!session) return this.json(res, 401, { error: 'unauthorized' }); const data = await this.body(req); const answer = await this.generate(session, String(data.question || '')); return this.json(res, 200, answer); }
      if (url.pathname === '/api/defence/retry' && method === 'POST') { const session = this.auth(req); if (!session) return this.json(res, 401, { error: 'unauthorized' }); const question = session.answers.at(-1)?.question || ''; return this.json(res, 200, await this.generate(session, question)); }
      if (url.pathname === '/api/defence/history' && method === 'GET') { const session = this.auth(req); if (!session) return this.json(res, 401, { error: 'unauthorized' }); return this.json(res, 200, session.answers); }
      const historyMatch = url.pathname.match(/^\/api\/defence\/history\/(\d+)$/); if (historyMatch && method === 'DELETE') { const session = this.auth(req); if (!session) return this.json(res, 401, { error: 'unauthorized' }); session.answers.splice(Number(historyMatch[1]), 1); return this.json(res, 200, { ok: true }); }
      this.json(res, 404, { error: 'not_found' });
    } catch (error) { const message = error instanceof Error ? error.message : 'request_failed'; this.json(res, message === 'request_too_large' ? 413 : 400, { error: message.replace(/[A-Za-z]:\\[^\s]+/g, '[LOCAL_PATH]') }); }
  }

  private upgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); if (url.pathname !== '/api/defence/live') return socket.destroy();
      const raw = url.searchParams.get('token') || ''; const session = [...this.sessions.values()].find(item => Date.now() - item.createdAt < SESSION_TTL_MS && safeEqual(item.tokenHash, hash(raw)));
      if (!session) return socket.destroy(); this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req, session));
    } catch { socket.destroy(); }
  }
  private send(ws: WebSocket, value: unknown): void { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
  private socket(ws: WebSocket, session: Session): void {
    this.send(ws, { type: 'session', sessionId: session.id, settings: session.settings, transcript: session.transcript, answers: session.answers, capabilities: publicConfig(this.config).capabilities, nextAudioSequence: session.audio.nextSequence, diagnostics: { ...session.diagnostics, secure: this.config.tls.enabled, allowedMimeTypes: allowedAudioMimeTypes() } });
    ws.on('message', async (raw, binary) => {
      try {
        if (binary) throw new AudioProtocolError('AUDIO_METADATA_REQUIRED', 'Binary audio without authenticated metadata is not accepted.');
        const message = JSON.parse(raw.toString());
        if (message.type === 'settings') { session.settings = { ...session.settings, ...message.settings }; return this.send(ws, { type: 'settings', settings: session.settings }); }
        if (message.type === 'transcript') return await this.onTranscript(ws, session, String(message.text || ''), Boolean(message.final), Number(message.silenceMs || 0));
        if (message.type === 'audio') {
          const decision = session.audio.accept(message, this.config, session.id); if (decision.action === 'duplicate') return this.send(ws, { type: 'audio-ack', sequence: message.sequence, duplicate: true, nextAudioSequence: decision.expectedSequence });
          session.diagnostics.lastAudioBytes = decision.bytes.length; session.diagnostics.lastAudioMime = decision.metadata.mimeType; const started = performance.now();
          const result = await this.stt.transcribeWithMetrics(decision.bytes, decision.metadata.mimeType); session.diagnostics.lastSttLatencyMs = Math.round(performance.now() - started); session.diagnostics.sttStatus = result.timing.status; session.diagnostics.sttRetries = result.timing.retries; session.diagnostics.sttRequestId = result.timing.requestId;
          this.send(ws, { type: 'audio-ack', sequence: decision.metadata.sequence, duplicate: false, nextAudioSequence: session.audio.nextSequence });
          return await this.onTranscript(ws, session, result.value, true, decision.metadata.finalChunk ? 1000 : 0);
        }
        if (message.type === 'generate') { const question = String(message.question || session.transcript); this.send(ws, { type: 'retrieval', state: 'searching' }); const answer = await this.generate(session, question); return this.send(ws, { type: 'answer', answer }); }
        if (message.type === 'cancel') { session.abort?.abort(); session.revision++; return this.send(ws, { type: 'cancelled', questionId: session.lastQuestionId, revision: session.revision }); }
        if (message.type === 'clear') { session.transcript = ''; session.answers = []; session.detector.reset(); return this.send(ws, { type: 'cleared' }); }
      } catch (error) { const code = error instanceof ProviderError || error instanceof AudioProtocolError ? error.code : 'MESSAGE_FAILED'; session.diagnostics.lastErrorCode = code; this.send(ws, { type: 'error', code, message: error instanceof Error ? error.message : 'The request failed.' }); }
    });
  }
  private async onTranscript(ws: WebSocket, session: Session, text: string, final: boolean, silenceMs = 0): Promise<void> {
    if (!text) return; session.transcript = text; final ? session.diagnostics.finalCount++ : session.diagnostics.partialCount++; const result = session.detector.push(text, { final, silenceMs }); this.send(ws, { type: 'transcript', text: session.transcript, final, detector: result });
    if (result.state === 'complete' && result.question) { this.send(ws, { type: 'retrieval', state: 'searching' }); const answer = await this.generate(session, result.question); this.send(ws, { type: 'answer', answer }); }
  }
  private async generate(session: Session, question: string): Promise<StructuredAnswer> {
    if (!question.trim()) throw new Error('question_required'); session.abort?.abort(); session.abort = new AbortController();
    const normalized = question.trim(); const retrying = session.answers.at(-1)?.question === normalized;
    if (!retrying) { session.questionCounter++; session.lastQuestionId = `q-${session.questionCounter}`; session.revision = 1; } else session.revision++;
    const generationId = crypto.randomUUID(); const answer = await this.engine.answer(normalized, await this.indexer.load(), session.settings);
    answer.questionId = session.lastQuestionId; answer.revision = session.revision; answer.generationId = generationId;
    if (answer.diagnostics) Object.assign(session.diagnostics, answer.diagnostics);
    session.answers.push(answer); if (session.answers.length > 50) session.answers.shift(); return answer;
  }
}
