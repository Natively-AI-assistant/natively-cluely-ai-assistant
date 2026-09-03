/**
 * Spawns and supervises one utilityProcess per enabled extension.
 *
 * Phase 1 provides the host INTERFACE and the supervision policy; Phase 2
 * attaches the actual `utilityProcess`. The policy is a pure state machine
 * here on purpose — crash counting and auto-disable are exactly the logic that
 * is impossible to test once it is entangled with a real child process.
 *
 * Placement is deliberate. An extension runs in its own utilityProcess — never
 * in the main process, never in a renderer — so a crash takes down the child
 * and nothing else. `electron/rag/VectorStore.ts:1-24` records why this project
 * moved AWAY from a bespoke worker_threads message protocol and recommends
 * exactly this: offload the whole call to a utilityProcess rather than
 * hand-splitting a protocol across a thread boundary.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionManifest } from './ExtensionManifest';
import type { PermissionBroker } from './PermissionBroker';
import type { ExtensionLogger, RankedCandidate, RerankCandidate } from './types';
import {
  DEFAULT_DISPOSE_TIMEOUT_MS,
  DEFAULT_INIT_TIMEOUT_MS,
  DEFAULT_RERANK_TIMEOUT_MS,
  ExtensionTimeoutError,
  isExtensionToHostMessage,
  type BrokerReply,
  type BrokerReplyBody,
  type BrokerRequest,
  type ExtensionReplyBody,
  type HostRequest,
  type HostRequestBody,
} from './ExtensionRpc';

/** Crashes within one session before an extension is disabled automatically. */
export const CRASH_LIMIT_PER_SESSION = 3;

export interface ExtensionHostTimeouts {
  initMs: number;
  rerankMs: number;
  disposeMs: number;
}

export const DEFAULT_TIMEOUTS: ExtensionHostTimeouts = {
  initMs: DEFAULT_INIT_TIMEOUT_MS,
  rerankMs: DEFAULT_RERANK_TIMEOUT_MS,
  disposeMs: DEFAULT_DISPOSE_TIMEOUT_MS,
};

export interface ExtensionHostOptions {
  manifest: ExtensionManifest;
  /** Unpacked extension payload directory. */
  extensionDir: string;
  /** This extension's private model directory. */
  modelDir: string;
  broker: PermissionBroker;
  config: Record<string, unknown>;
  timeouts?: Partial<ExtensionHostTimeouts>;
  logger?: ExtensionLogger;
  /**
   * Replaces `utilityProcess.fork`. Production leaves this unset; tests inject
   * a fake child so supervision — deadlines, unmatched replies, exit-rejects-
   * pending — is verifiable without spawning a real process.
   */
  forkOverride?: () => UtilityChild;
  /**
   * Called when the child exits without `stop()` having been requested. The
   * manager feeds this to `CrashSupervisor`, which decides restart vs disable.
   */
  onCrash?: (exitCode: number) => void;
}

/**
 * The live handle onto one running extension. `rerank` rejects rather than
 * hanging when the child does not answer inside its deadline.
 */
export interface ExtensionHost {
  readonly extensionId: string;
  start(): Promise<void>;
  rerank(query: string, candidates: RerankCandidate[], topK: number, signal: AbortSignal): Promise<RankedCandidate[]>;
  /** Graceful dispose, then a hard kill if the child does not exit in time. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supervision policy
// ---------------------------------------------------------------------------

export type SupervisorVerdict =
  | { action: 'restart'; crashes: number }
  | { action: 'disable'; crashes: number; reason: string };

/**
 * Counts crashes for one extension within a session and decides whether to
 * restart it or disable it. Pure — no timers, no process handles — so both
 * branches are exercisable in a unit test.
 *
 * The counter is per SESSION and deliberately not persisted: an extension that
 * crashed three times because a model file was mid-download should get a clean
 * slate on the next launch, and a genuinely broken one will spend its three
 * again immediately.
 */
export class CrashSupervisor {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number = CRASH_LIMIT_PER_SESSION) {}

  recordCrash(extensionId: string): SupervisorVerdict {
    const crashes = (this.counts.get(extensionId) ?? 0) + 1;
    this.counts.set(extensionId, crashes);

    if (crashes >= this.limit) {
      return {
        action: 'disable',
        crashes,
        reason: `extension "${extensionId}" crashed ${crashes} times this session and has been disabled`,
      };
    }
    return { action: 'restart', crashes };
  }

  crashes(extensionId: string): number {
    return this.counts.get(extensionId) ?? 0;
  }

  /** Called after a clean run so transient crashes do not accumulate forever. */
  clear(extensionId: string): void {
    this.counts.delete(extensionId);
  }
}

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
  return new UtilityProcessExtensionHost(options);
}

// ---------------------------------------------------------------------------
// utilityProcess implementation
// ---------------------------------------------------------------------------

/**
 * The slice of Electron's `UtilityProcess` this host uses. Structural, so a
 * test can drive a fake child without an Electron main process.
 */
export interface UtilityChild {
  pid?: number;
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'spawn', listener: () => void): void;
  on(event: 'error', listener: (type: string, location: string, report: string) => void): void;
}

interface PendingCall {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  operation: string;
}

/**
 * One extension, one utilityProcess.
 *
 * Two supervision rules, both learned from this project's earlier worker
 * protocols:
 *
 *  - **Every deadline is owned by the host.** `utilityProcess` emits no generic
 *    error event; a throw during module load in the child surfaces ONLY as an
 *    `exit` with a non-zero code. A child that wedges inside a synchronous
 *    native call emits nothing at all. So a timer on the host is the only thing
 *    that can fail a call, and each pending call carries its own.
 *  - **Exit rejects everything in flight.** A call whose child died must fail,
 *    not hang until some outer timeout notices.
 */
/**
 * Headers a redirect must NOT carry across an origin boundary. This is the set
 * undici drops in its own redirect handler; the brokered fetch below follows
 * redirects by hand (it has to re-run the allowedHosts check on every hop), so
 * it has to drop them explicitly or an extension's credential for host A gets
 * forwarded to host B.
 */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * Build the RequestInit for the NEXT hop of a hand-followed redirect, applying
 * the two Fetch-spec rules the runtime would have applied for us:
 *
 *  - 303 (and 301/302 on a POST) becomes a GET with no body;
 *  - a cross-origin hop drops the credential headers.
 */
function followRedirectInit(
  init: RequestInit,
  from: URL,
  to: URL,
  status: number,
): RequestInit {
  const next: RequestInit = { ...init };
  const method = (init.method ?? 'GET').toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    next.method = 'GET';
    delete next.body;
  }
  if (from.origin !== to.origin) {
    const headers = new Headers((init.headers as HeadersInit | undefined) ?? undefined);
    for (const name of CREDENTIAL_HEADERS) headers.delete(name);
    next.headers = headers;
  }
  return next;
}

class UtilityProcessExtensionHost implements ExtensionHost {
  readonly extensionId: string;

  private readonly options: ExtensionHostOptions;
  private readonly timeouts: ExtensionHostTimeouts;
  private child: UtilityChild | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private ready: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private stopped = false;

  constructor(options: ExtensionHostOptions) {
    this.options = options;
    this.extensionId = options.manifest.id;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(options.timeouts ?? {}) };
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.stopped = false;

    const entrypoint = this.resolveEntrypoint();

    // Ask the broker up front which declared binaries may be spawned. Node's
    // `spawn` is synchronous in the child and cannot await a round trip, so the
    // decision is made here, in the main process, and the child enforces
    // against the answer.
    const preauthorizedBinaries = this.preauthorizeBinaries();

    const child = this.fork();
    this.child = child;

    child.on('message', (message) => this.onMessage(message));
    child.on('exit', (code) => this.onExit(code));
    child.on('error', (type, location) => {
      this.failAll(new Error(`extension "${this.extensionId}" hit a fatal V8 error (${type} at ${location})`));
    });

    // The child announces readiness only after its parentPort listener is
    // attached. Without this handshake, an init sent too early is dropped
    // silently and the call hangs until its deadline for no visible reason.
    await this.awaitReady();

    await this.request(
      {
        kind: 'init',
        context: {
          extensionId: this.extensionId,
          modelDir: this.options.modelDir,
          config: this.options.config,
        },
        entrypoint,
        granted: [...this.options.manifest.permissions],
        preauthorizedBinaries,
      },
      this.timeouts.initMs,
      'init',
    );
  }

  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topK: number,
    signal: AbortSignal,
  ): Promise<RankedCandidate[]> {
    if (!this.child) throw new Error(`extension "${this.extensionId}" is not running`);
    if (signal.aborted) throw new Error(`rerank aborted before it started`);

    const reply = await this.request(
      { kind: 'rerank', query, candidates, topK },
      this.timeouts.rerankMs,
      'rerank',
      signal,
    );
    if (reply.kind !== 'rerank') {
      throw new Error(`extension "${this.extensionId}" answered rerank with "${reply.kind}"`);
    }
    return reply.ranked;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;

    // Graceful dispose, bounded. A child that will not answer must not be able
    // to hold up app shutdown.
    try {
      await this.request({ kind: 'dispose' }, this.timeouts.disposeMs, 'dispose');
    } catch {
      // Expected when the child is already gone or wedged.
    }

    try {
      child.kill();
    } catch {
      // Already dead.
    }
    this.child = null;
    this.failAll(new Error(`extension "${this.extensionId}" was stopped`));
  }

  // ── internals ──────────────────────────────────────────────────────────

  private fork(): UtilityChild {
    if (this.options.forkOverride) return this.options.forkOverride();

    // Required lazily so this module can be loaded (and unit-tested) outside an
    // Electron main process.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { utilityProcess } = require('electron') as {
      utilityProcess: { fork(modulePath: string, args?: string[], options?: Record<string, unknown>): UtilityChild };
    };

    return utilityProcess.fork(bootstrapPath(), [], {
      serviceName: `Natively Extension (${this.extensionId})`,
      // Inherited so the child's stdout/stderr land in the app log alongside
      // everything else; the extension's own logging goes over RPC.
      stdio: 'inherit',
      cwd: this.options.extensionDir,
    });
  }

  private resolveEntrypoint(): string {
    const resolved = path.resolve(this.options.extensionDir, this.options.manifest.entrypoint);
    // The entrypoint is manifest-supplied, so confirm it stays inside the
    // extension's own directory before handing it to the child to require.
    const rel = path.relative(path.resolve(this.options.extensionDir), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `extension "${this.extensionId}" declares an entrypoint outside its own directory`,
      );
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`extension "${this.extensionId}" entrypoint not found: ${resolved}`);
    }
    return resolved;
  }

  private preauthorizeBinaries(): string[] {
    const declared = this.options.manifest.allowedBinaries ?? [];
    const grant = {
      extensionId: this.extensionId,
      granted: this.options.manifest.permissions,
      modelDir: this.options.modelDir,
      allowedHosts: this.options.manifest.allowedHosts,
      allowedBinaries: declared,
    };
    return declared.filter(
      (binary) => this.options.broker.decide(grant, { kind: 'process.spawn', binary }).allowed,
    );
  }

  private awaitReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ready = null;
        reject(new ExtensionTimeoutError(this.extensionId, 'startup', this.timeouts.initMs));
      }, this.timeouts.initMs);
      this.ready = { resolve, reject, timer };
    });
  }

  private request(
    body: HostRequestBody,
    timeoutMs: number,
    operation: string,
    signal?: AbortSignal,
  ): Promise<ExtensionReplyBody> {
    const child = this.child;
    if (!child) return Promise.reject(new Error(`extension "${this.extensionId}" is not running`));

    const id = this.nextId++;
    return new Promise<ExtensionReplyBody>((resolve, reject) => {
      // Tell the CHILD to stop too. Failing the call here only frees the host;
      // without this the extension keeps working past the deadline — an
      // in-flight llama-server request, or an ONNX batch loop — and the next
      // rerank starts alongside it.
      const cancelChild = (): void => {
        try {
          child.postMessage({
            direction: 'host-to-extension',
            id: -id,                    // negative: cannot collide with a real request id
            body: { kind: 'cancel', cancelId: id },
          });
        } catch { /* the child is gone; there is nothing left to cancel */ }
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        cancelChild();
        reject(new ExtensionTimeoutError(this.extensionId, operation, timeoutMs));
      }, timeoutMs);

      const onAbort = (): void => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        cancelChild();
        reject(new Error(`${operation} aborted`));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        resolve: ((value: ExtensionReplyBody) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(value);
        }) as never,
        reject: (error: Error) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(error);
        },
        timer,
        operation,
      });

      child.postMessage({ direction: 'host-to-extension', id, body } satisfies HostRequest);
    });
  }

  private onMessage(raw: unknown): void {
    if (!isExtensionToHostMessage(raw)) return;

    const body = raw.body;

    if (body.kind === 'ready') {
      const ready = this.ready;
      this.ready = null;
      if (ready) {
        clearTimeout(ready.timer);
        ready.resolve();
      }
      return;
    }

    if (body.kind === 'log') {
      this.options.logger?.[body.level]?.(`[${this.extensionId}] ${body.message}`, ...body.args);
      return;
    }

    if (body.kind === 'broker') {
      void this.handleBrokerRequest(raw.id, (raw as BrokerRequest).body);
      return;
    }

    const pending = this.pending.get(raw.id);
    // An unmatched reply is discarded, never applied to whatever call happens
    // to be in flight.
    if (!pending) return;
    this.pending.delete(raw.id);
    clearTimeout(pending.timer);

    if (body.kind === 'error') {
      pending.reject(new Error(`extension "${this.extensionId}": ${body.message}`));
      return;
    }
    (pending.resolve as (v: ExtensionReplyBody) => void)(body as ExtensionReplyBody);
  }

  private async handleBrokerRequest(id: number, body: BrokerRequest['body']): Promise<void> {
    const grant = {
      extensionId: this.extensionId,
      granted: this.options.manifest.permissions,
      modelDir: this.options.modelDir,
      allowedHosts: this.options.manifest.allowedHosts,
      allowedBinaries: this.options.manifest.allowedBinaries,
    };

    const decision = this.options.broker.decide(grant, body.request);
    if (!decision.allowed) {
      // Every denial is logged: an extension quietly reaching for a capability
      // it never declared is a bug its author needs to see.
      this.options.logger?.warn(
        `[${this.extensionId}] denied ${body.request.kind}: ${decision.reason}`,
      );
      this.reply(id, { kind: 'broker', ok: false, denied: true, reason: decision.reason });
      return;
    }

    try {
      const result = await this.performBrokeredWork(body);
      this.reply(id, { kind: 'broker', ok: true, result });
    } catch (error) {
      this.reply(id, {
        kind: 'broker',
        ok: false,
        denied: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Work the MAIN process performs on the extension's behalf once the broker
   * has allowed it. Only `fetch` is genuinely proxied — `process.spawn` and the
   * filesystem kinds are decision-only, see `host/sandbox.ts` for why proxying
   * those would buy nothing.
   *
   * The child never holds a socket, but that alone does NOT make the approved
   * host binding. Two ways it used to slip:
   *
   *   1. The broker decides on `body.request.host`, while the fetch used
   *      `body.payload.url` — a separate field the child also controls. A child
   *      could ask about an allowed host and pass a URL for another.
   *   2. `fetch` follows redirects by default, so an allowed host answering 302
   *      could hand the request to one that was never checked.
   *
   * Both are closed below: the URL's own host must match what was approved, and
   * redirects are followed manually with the broker re-consulted per hop.
   */
  private async performBrokeredWork(body: BrokerRequest['body']): Promise<unknown> {
    if (body.request.kind !== 'network.connect') return { allowed: true };

    const payload = body.payload as { url?: string; init?: Record<string, unknown> } | undefined;
    if (!payload?.url) throw new Error('network request carried no URL');

    const grant = {
      extensionId: this.extensionId,
      granted: this.options.manifest.permissions,
      modelDir: this.options.modelDir,
      allowedHosts: this.options.manifest.allowedHosts,
      allowedBinaries: this.options.manifest.allowedBinaries,
    };

    /** Re-decide for a concrete URL, so the approval always matches what is fetched. */
    const approve = (raw: string): URL => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`network request carried an unparseable URL`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`network request used an unsupported protocol ${url.protocol}`);
      }
      const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
      const decision = this.options.broker.decide(grant, { kind: 'network.connect', host: url.hostname, port });
      if (!decision.allowed) {
        this.options.logger?.warn(`[${this.extensionId}] denied network.connect to ${url.hostname}: ${decision.reason}`);
        throw new Error(`network request to ${url.hostname} is not allowed: ${decision.reason}`);
      }
      return url;
    };

    let current = approve(payload.url);
    let init: RequestInit = { ...(payload.init as RequestInit | undefined) };
    let response: Response;
    // Bounded: a redirect loop must not spin the main process.
    for (let hop = 0; ; hop++) {
      if (hop > 5) throw new Error('too many redirects');
      response = await fetch(current.toString(), { ...init, redirect: 'manual' });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      // Resolve relative Locations against the current URL, then re-approve.
      const next = approve(new URL(location, current).toString());
      // Following a redirect BY HAND means re-implementing the two things the
      // runtime's own redirect handling does for free. Replaying `init`
      // verbatim (as this loop used to) forwards the extension's Authorization
      // / Cookie headers to the redirect target — and because a manifest may
      // list several allowedHosts, that target can be a DIFFERENT host than the
      // one the credential belongs to.
      init = followRedirectInit(init, current, next, response.status);
      current = next;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      bodyBase64: buffer.toString('base64'),
    };
  }

  private reply(id: number, body: BrokerReplyBody): void {
    this.child?.postMessage({ direction: 'host-to-extension', id, body } satisfies BrokerReply);
  }

  private onExit(code: number): void {
    this.child = null;
    const ready = this.ready;
    if (ready) {
      this.ready = null;
      clearTimeout(ready.timer);
      ready.reject(new Error(`extension "${this.extensionId}" exited during startup (code ${code})`));
    }
    this.failAll(new Error(`extension "${this.extensionId}" exited (code ${code})`));
    if (!this.stopped) this.options.onCrash?.(code);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of [...this.pending.entries()]) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

/**
 * Resolved relative to this module so it works in development and packaged
 * alike. Both files are emitted side by side under
 * `dist-electron/electron/services/extensions/`.
 */
export function bootstrapPath(): string {
  return path.join(__dirname, 'host', 'bootstrap.js');
}
