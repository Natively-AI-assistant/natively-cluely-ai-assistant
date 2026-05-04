import http from 'http';
import os from 'os';
import crypto from 'crypto';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { app } from 'electron';
import { SettingsManager } from './SettingsManager';
import { PHONE_MIRROR_HTML } from './phoneMirrorClient';

export interface PhoneMirrorInfo {
  running: boolean;
  enabled: boolean;
  exposeOnLan: boolean;
  port: number;
  loopbackUrl: string | null;
  primaryUrl: string | null;
  lanUrls: string[];
  token: string | null;
  qrDataUrl: string | null;
  clients: number;
}

export type StreamEvent =
  | { type: 'history'; messages: PersistedMessage[] }
  | { type: 'user'; id: string; content: string; createdAt: string }
  | { type: 'token'; streamId: string; token: string }
  | { type: 'done'; streamId: string; content: string; createdAt: string }
  | { type: 'error'; streamId: string; message: string };

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const DEFAULT_PORT = 4123;
const PORT_PROBE_RANGE = 12;
const HISTORY_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;
const RATE_HTTP_LIMIT = 120;
const TOKEN_BYTES = 24;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const STATUS_LISTENERS_KEY = Symbol('phone-mirror-status-listeners');

type StatusListener = (info: PhoneMirrorInfo) => void;

export class PhoneMirrorService {
  private static _instance: PhoneMirrorService | null = null;

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  private token = '';
  private exposeOnLan = false;
  private history: PersistedMessage[] = [];
  private livePartial: { streamId: string; tokens: string[] } | null = null;
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();
  private statusListeners = new Set<StatusListener>();
  private cachedInfo: PhoneMirrorInfo | null = null;
  private starting: Promise<PhoneMirrorInfo> | null = null;

  static getInstance(): PhoneMirrorService {
    if (!PhoneMirrorService._instance) PhoneMirrorService._instance = new PhoneMirrorService();
    return PhoneMirrorService._instance;
  }

  // ----- public lifecycle -----

  isRunning(): boolean {
    return this.server !== null;
  }

  async start(opts?: { exposeOnLan?: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    if (this.starting) return this.starting;
    if (this.isRunning()) {
      if (typeof opts?.exposeOnLan === 'boolean' && opts.exposeOnLan !== this.exposeOnLan) {
        return this.restart({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
      }
      return this.snapshot();
    }

    const exposeOnLan = opts?.exposeOnLan ?? !!SettingsManager.getInstance().get('phoneMirrorExposeOnLan');
    this.starting = this._start(exposeOnLan, opts?.persist !== false);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(opts?: { persist?: boolean }): Promise<void> {
    if (opts?.persist !== false) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', false);
    }
    await this._teardown();
    this.emitStatus();
  }

  async restart(opts: { exposeOnLan: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    await this._teardown();
    return this.start({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
  }

  async setExposeOnLan(value: boolean): Promise<PhoneMirrorInfo> {
    SettingsManager.getInstance().set('phoneMirrorExposeOnLan', value);
    if (!this.isRunning()) {
      this.exposeOnLan = value;
      return this.snapshot();
    }
    return this.restart({ exposeOnLan: value });
  }

  async rotateToken(): Promise<PhoneMirrorInfo> {
    this.token = generateToken();
    this.disconnectAllClients(4401, 'Token rotated');
    const info = await this.snapshot();
    this.emitStatus(info);
    return info;
  }

  async dispose(): Promise<void> {
    await this._teardown();
    this.statusListeners.clear();
  }

  // ----- public publishing API (called from ipcHandlers) -----

  publishUserMessage(id: string, content: string): void {
    if (!this.isRunning() || !content?.trim()) return;
    const msg: PersistedMessage = {
      id: 'u:' + id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    this.recordHistory(msg);
    this.broadcast({ type: 'user', id: msg.id, content: msg.content, createdAt: msg.createdAt });
  }

  publishToken(streamId: string, token: string): void {
    if (!this.isRunning() || !token) return;
    if (!this.livePartial || this.livePartial.streamId !== streamId) {
      this.livePartial = { streamId, tokens: [] };
    }
    this.livePartial.tokens.push(token);
    this.broadcast({ type: 'token', streamId, token });
  }

  publishDone(streamId: string, fullContent: string): void {
    if (!this.isRunning()) return;
    const createdAt = new Date().toISOString();
    const content = fullContent || (this.livePartial?.streamId === streamId ? this.livePartial.tokens.join('') : '');
    if (content.trim()) {
      const msg: PersistedMessage = { id: 'a:' + streamId, role: 'assistant', content, createdAt };
      this.recordHistory(msg);
      this.broadcast({ type: 'done', streamId, content, createdAt });
    }
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  publishError(streamId: string, message: string): void {
    if (!this.isRunning()) return;
    this.broadcast({ type: 'error', streamId, message: String(message || 'Stream error') });
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  // ----- snapshot / status -----

  async snapshot(): Promise<PhoneMirrorInfo> {
    const enabled = !!SettingsManager.getInstance().get('phoneMirrorEnabled');
    if (!this.isRunning()) {
      const info: PhoneMirrorInfo = {
        running: false,
        enabled,
        exposeOnLan: this.exposeOnLan,
        port: 0,
        loopbackUrl: null,
        primaryUrl: null,
        lanUrls: [],
        token: null,
        qrDataUrl: null,
        clients: 0,
      };
      this.cachedInfo = info;
      return info;
    }
    const loopbackUrl = `http://127.0.0.1:${this.port}/?t=${this.token}`;
    const lanUrls = this.exposeOnLan
      ? getLanIPs().map((ip) => `http://${ip}:${this.port}/?t=${this.token}`)
      : [];
    // If LAN is on, only advertise a real LAN URL — falling back to 127.0.0.1
    // would print a QR code the phone cannot reach (loopback ≠ phone).
    const primaryUrl = this.exposeOnLan ? (lanUrls[0] || null) : loopbackUrl;
    const qrDataUrl = primaryUrl ? await safeQr(primaryUrl) : null;
    const info: PhoneMirrorInfo = {
      running: true,
      enabled,
      exposeOnLan: this.exposeOnLan,
      port: this.port,
      loopbackUrl,
      primaryUrl,
      lanUrls,
      token: this.token,
      qrDataUrl,
      clients: this.wss ? this.wss.clients.size : 0,
    };
    this.cachedInfo = info;
    return info;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ----- internals -----

  private async _start(exposeOnLan: boolean, persistEnabled: boolean): Promise<PhoneMirrorInfo> {
    this.exposeOnLan = exposeOnLan;
    this.token = generateToken();

    const host = exposeOnLan ? '0.0.0.0' : '127.0.0.1';
    const basePort = DEFAULT_PORT;
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    server.on('clientError', (_err, socket) => {
      try { socket.destroy(); } catch (_) { /* noop */ }
    });

    const port = await listenWithProbe(server, host, basePort, PORT_PROBE_RANGE);
    this.server = server;
    this.port = port;

    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req as http.IncomingMessage, socket as any, head));
    wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    if (persistEnabled) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', true);
      SettingsManager.getInstance().set('phoneMirrorExposeOnLan', exposeOnLan);
    }

    const info = await this.snapshot();
    this.emitStatus(info);
    console.log(`[PhoneMirror] listening on ${host}:${port} (lan=${exposeOnLan})`);
    return info;
  }

  private async _teardown(): Promise<void> {
    const wss = this.wss;
    const server = this.server;
    this.wss = null;
    this.server = null;
    this.port = 0;
    this.token = '';
    this.livePartial = null;
    this.rateBuckets.clear();
    if (wss) {
      for (const c of wss.clients) {
        try { c.close(1001, 'shutting down'); } catch (_) { /* noop */ }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '30' });
      res.end('Too many requests');
      return;
    }
    const fullUrl = new URL(req.url || '/', 'http://localhost');
    const provided = fullUrl.searchParams.get('t');

    // Health endpoint — minimal info, never reveals token or DB paths.
    if (fullUrl.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, clients: this.wss ? this.wss.clients.size : 0 }));
      return;
    }

    if (fullUrl.pathname !== '/' && fullUrl.pathname !== '/index.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (!provided || !timingSafeEqualStr(provided, this.token)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Pairing token missing or invalid.');
      return;
    }

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; ');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(PHONE_MIRROR_HTML);
  }

  private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    let url: URL;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { socket.destroy(); return; }

    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const provided = url.searchParams.get('t') || '';
    if (!timingSafeEqualStr(provided, this.token)) {
      // Custom 4401 close code signals "auth failed" to the client (won't reconnect).
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const wss = this.wss;
    if (!wss) { socket.destroy(); return; }

    // Drop any client that doesn't complete handshake quickly — avoids slow-loris.
    let upgraded = false;
    const handshakeTimer = setTimeout(() => { if (!upgraded) socket.destroy(); }, HANDSHAKE_TIMEOUT_MS);
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      clearTimeout(handshakeTimer);
      wss.emit('connection', ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Send recent history immediately so a phone joining mid-session has context.
    try {
      ws.send(JSON.stringify({ type: 'history', messages: this.history.slice(-HISTORY_LIMIT) }));
      // Replay live partial too, so a late joiner sees the in-flight response.
      if (this.livePartial) {
        for (const t of this.livePartial.tokens) {
          ws.send(JSON.stringify({ type: 'token', streamId: this.livePartial.streamId, token: t }));
        }
      }
    } catch (_) { /* client may be gone already */ }

    // Keepalive heartbeat. Drop dead clients within ~45s.
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const ping = setInterval(() => {
      if (!alive) { try { ws.terminate(); } catch (_) {} return; }
      alive = false;
      try { ws.ping(); } catch (_) {}
    }, 15_000);

    ws.on('close', () => {
      clearInterval(ping);
      this.emitStatus(); // update client count
    });
    ws.on('error', () => { /* swallow — close fires next */ });

    // Phone is read-only: ignore any inbound frames except control frames.
    ws.on('message', () => { /* intentionally ignored */ });

    console.log(`[PhoneMirror] phone connected from ${req.socket.remoteAddress}`);
    this.emitStatus();
  }

  private broadcast(event: StreamEvent): void {
    const wss = this.wss;
    if (!wss) return;
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Backpressure guard: skip if buffered amount has run away (slow client).
      if ((client as any).bufferedAmount > 1_000_000) continue;
      try { client.send(payload); } catch (_) { /* noop */ }
    }
  }

  private recordHistory(msg: PersistedMessage): void {
    this.history.push(msg);
    if (this.history.length > HISTORY_LIMIT * 2) {
      this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
  }

  private rateAllow(ip: string): boolean {
    const now = Date.now();
    let bucket = this.rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.rateBuckets.set(ip, bucket);
    }
    bucket.count += 1;
    // Cheap LRU pruning so the map can't grow unbounded.
    if (this.rateBuckets.size > 256) {
      for (const [k, v] of this.rateBuckets) {
        if (v.resetAt < now) this.rateBuckets.delete(k);
      }
    }
    return bucket.count <= RATE_HTTP_LIMIT;
  }

  private disconnectAllClients(code: number, reason: string): void {
    if (!this.wss) return;
    for (const c of this.wss.clients) {
      try { c.close(code, reason); } catch (_) {}
    }
  }

  private async emitStatus(prebuilt?: PhoneMirrorInfo): Promise<void> {
    if (this.statusListeners.size === 0) return;
    const info = prebuilt || (await this.snapshot());
    for (const l of this.statusListeners) {
      try { l(info); } catch (_) { /* noop */ }
    }
  }
}

// ----- helpers -----

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still compare to keep timing roughly constant.
    const dummy = Buffer.alloc(ab.length || 1);
    crypto.timingSafeEqual(ab.length ? ab : dummy, ab.length ? dummy : ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Filter out interfaces a phone on the same WiFi will NEVER be able to reach:
// - utun*: VPN tunnels (Tailscale, system VPN, WireGuard) — not on the LAN
// - awdl*, llw*: Apple Wireless Direct Link / low-latency WLAN — peer-to-peer only
// - anpi*, ap*: Apple Network Privacy / hotspot interfaces
// - bridge*: Internet Sharing / Thunderbolt bridge — different subnet
// - vmnet*, vboxnet*, docker*: virtualization-only networks
// - veth*, br-*: Linux container networks
const VIRTUAL_IFACE_RE = /^(utun|awdl|llw|anpi|ap\d|bridge|vmnet|vboxnet|docker|veth|br-|gif|stf|tap)/i;

function isPrivateLanIPv4(ip: string): boolean {
  // RFC1918 — the only ranges a phone on the same Wi-Fi will share with the desktop.
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function rankLanIp(name: string, ip: string): number {
  // Lower score sorts earlier. We prefer:
  //   1. en0/en1 (Wi-Fi or Ethernet on macOS) over higher en* (often virtual).
  //   2. 192.168.x.x (home routers) over 10.x and 172.16-31.x.
  let score = 100;
  const m = name.match(/^en(\d+)$/i);
  if (m) score = parseInt(m[1], 10); // en0 -> 0, en1 -> 1, ...
  else if (/^eth\d+$|^enp/i.test(name)) score = 2;
  else if (/^wlan\d+|^wlp/i.test(name)) score = 1;
  if (ip.startsWith('192.168.')) score += 0;
  else if (ip.startsWith('10.')) score += 10;
  else score += 20; // 172.16-31.x
  return score;
}

function getLanIPs(): string[] {
  const candidates: { ip: string; name: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const a of list) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!isPrivateLanIPv4(a.address)) continue;
      candidates.push({ ip: a.address, name });
    }
  }
  candidates.sort((a, b) => rankLanIp(a.name, a.ip) - rankLanIp(b.name, b.ip));
  // De-dup while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c.ip)) continue;
    seen.add(c.ip);
    out.push(c.ip);
  }
  return out;
}

async function listenWithProbe(server: http.Server, host: string, basePort: number, range: number): Promise<number> {
  for (let i = 0; i < range; i++) {
    const port = basePort + i;
    const ok = await tryListen(server, host, port);
    if (ok) return port;
  }
  // Final attempt: ephemeral port chosen by OS.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind ephemeral port'));
    });
  });
}

function tryListen(server: http.Server, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => { server.removeListener('listening', onListening); resolve(false); };
    const onListening = () => { server.removeListener('error', onError); resolve(true); };
    server.once('error', onError);
    server.once('listening', onListening);
    try { server.listen(port, host); }
    catch (_) { resolve(false); }
  });
}

async function safeQr(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (_) {
    return null;
  }
}

// Avoid unused-symbol TS error for STATUS_LISTENERS_KEY; reserved for future external coordination.
void STATUS_LISTENERS_KEY;
// Reference Electron's `app` to keep the import live in case we later need userData paths.
void app;
