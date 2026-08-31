/**
 * Child-side ambient-authority removal, installed BEFORE the extension
 * entrypoint is loaded.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 * Defence in depth against a SLOPPY extension: one that forgets it never
 * declared `network.remote`, reaches for a raw socket, or shells out to a
 * binary it did not list. Those mistakes become loud, attributable errors
 * instead of silent capability use.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 * It is not a security boundary against a HOSTILE extension, and nothing here
 * should be described as one. Three concrete holes, none of them accidental:
 *
 *   1. A native addon (onnxruntime-node, better-sqlite3, anything with a
 *      `.node` binary) does its I/O from C++. It never passes through a
 *      JavaScript `require` hook or a patched global, so every shim below is
 *      invisible to it.
 *   2. An extension granted `process.spawn` runs a real binary. That binary
 *      inherits none of these restrictions.
 *   3. `Module._load` is patched, not frozen. Code that kept a reference to
 *      the original — or that reaches through `process.binding` — is not
 *      stopped by this.
 *
 * That is precisely why installing an extension requires a trust prompt that
 * lists every requested permission, and why nothing ships enabled.
 *
 * `fs` is deliberately NOT intercepted. Confining filesystem access in-process
 * cannot be made true (see hole 1), so pretending to would be worse than being
 * honest: the model directory is handed to the extension as a path, and
 * `filesystem.models` is enforced where it can be — at `ModelStore`, on the
 * paths Core itself resolves.
 */

import type { ExtensionPermission } from '../types';
import type { PermissionRequest } from '../PermissionBroker';

/** Asks the main process for a decision, and for proxied work, the result. */
export type BrokerCall = (request: PermissionRequest, payload?: unknown) => Promise<unknown>;

export interface SandboxOptions {
  granted: readonly ExtensionPermission[];
  /**
   * Binaries the main process authorised during the handshake. Enforcement at
   * call time is synchronous against this set, because Node's `spawn` is
   * synchronous and cannot await a round trip. The DECISION still came from the
   * broker in the main process; only the check is local.
   */
  preauthorizedBinaries: readonly string[];
  callBroker: BrokerCall;
  /** Injected so tests can sandbox a fake global object. */
  target?: Record<string, unknown>;
  /** Injected so tests do not have to patch the real module loader. */
  moduleLoader?: ModuleLoaderPatch;
}

export interface ModuleLoaderPatch {
  intercept(handler: (request: string) => { handled: true; value: unknown } | { handled: false }): void;
}

export interface SandboxReport {
  removedModules: string[];
  stubbedGlobals: string[];
  removedGlobals: string[];
}

/**
 * Modules that expose raw network access. Removed outright rather than shimmed:
 * a shim for `net.Socket` that cannot consult the broker synchronously would be
 * a shim that lies. An extension needing the network uses `fetch`, which IS
 * genuinely proxied through the main process.
 */
const BLOCKED_MODULES = [
  'net',
  'tls',
  'dgram',
  'http',
  'https',
  'http2',
  'inspector',
  'worker_threads',
  'cluster',
  'repl',
  'v8',
];

function normalizeModuleId(request: string): string {
  return request.startsWith('node:') ? request.slice('node:'.length) : request;
}

export function installSandbox(options: SandboxOptions): SandboxReport {
  const target = options.target ?? (globalThis as unknown as Record<string, unknown>);
  const granted = new Set<ExtensionPermission>(options.granted);
  const report: SandboxReport = { removedModules: [], stubbedGlobals: [], removedGlobals: [] };

  // ── Globals ────────────────────────────────────────────────────────────
  // `fetch` is replaced rather than removed: it is the ONE network path that
  // can be honestly mediated, because the main process performs the request
  // and hands back bytes. The child never holds a socket.
  target.fetch = createBrokeredFetch(options.callBroker);
  report.stubbedGlobals.push('fetch');

  for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource']) {
    if (name in target) {
      delete target[name];
      report.removedGlobals.push(name);
    }
  }

  // ── Modules ────────────────────────────────────────────────────────────
  const childProcessShim = createChildProcessShim(granted, options.preauthorizedBinaries);

  const handler = (request: string): { handled: true; value: unknown } | { handled: false } => {
    const id = normalizeModuleId(request);

    if (id === 'child_process') {
      return { handled: true, value: childProcessShim };
    }
    if (BLOCKED_MODULES.includes(id)) {
      throw new Error(
        `[natively] "${request}" is not available to extensions. ` +
        'Use the global fetch(), which is mediated by the permission broker.',
      );
    }
    return { handled: false };
  };

  if (options.moduleLoader) {
    options.moduleLoader.intercept(handler);
  } else {
    patchRealModuleLoader(handler);
  }
  report.removedModules.push(...BLOCKED_MODULES);

  return report;
}

/**
 * Patches `Module._load`, which is the single chokepoint every `require()`
 * goes through — including transitive requires from an extension's own
 * dependencies, which is the case that matters.
 */
function patchRealModuleLoader(
  handler: (request: string) => { handled: true; value: unknown } | { handled: false },
): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module') as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const original = Module._load.bind(Module);
  Module._load = function patched(request: string, parent: unknown, isMain: boolean): unknown {
    const result = handler(request);
    if (result.handled) return result.value;
    return original(request, parent, isMain);
  };
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

/** Statuses the Fetch spec requires to have a null body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

interface ProxiedResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
}

/**
 * The main process performs the request and returns the bytes. A denial comes
 * back as a rejected broker call, so an extension reaching an undeclared host
 * gets a clear error naming the host rather than a confusing network failure.
 */
export function createBrokeredFetch(callBroker: BrokerCall) {
  return async function brokeredFetch(input: unknown, init?: unknown): Promise<Response> {
    const url = typeof input === 'string'
      ? input
      : (input as { url?: string })?.url;

    if (typeof url !== 'string' || !url) {
      throw new TypeError('[natively] fetch() requires a URL string');
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError(`[natively] fetch() could not parse the URL ${JSON.stringify(url)}`);
    }

    const port = parsed.port
      ? Number(parsed.port)
      : (parsed.protocol === 'https:' ? 443 : 80);

    const raw = await callBroker(
      { kind: 'network.connect', host: parsed.hostname, port },
      { url, init: serializableInit(init) },
    );

    const proxied = raw as ProxiedResponse;
    // 204/205/304 (and the 1xx informational codes) MUST carry a null body:
    // the Response constructor throws otherwise, which would turn a perfectly
    // ordinary "no content" reply into an exception inside the extension.
    const body = NULL_BODY_STATUSES.has(proxied.status)
      ? null
      : Buffer.from(proxied.bodyBase64, 'base64');
    return new Response(body, {
      status: proxied.status,
      statusText: proxied.statusText,
      headers: proxied.headers,
    });
  };
}

/** Only plain, structured-cloneable request options survive the channel. */
function serializableInit(init: unknown): Record<string, unknown> | undefined {
  if (!init || typeof init !== 'object') return undefined;
  const source = init as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof source.method === 'string') out.method = source.method;
  if (typeof source.body === 'string') out.body = source.body;
  if (source.headers && typeof source.headers === 'object') {
    out.headers = { ...(source.headers as Record<string, unknown>) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// child_process
// ---------------------------------------------------------------------------

/**
 * Exposes `spawn` only, and only for a binary the main process authorised
 * during the handshake. Every other export throws, so an extension reaching for
 * `exec` (a shell, and therefore an allowlist bypass) fails loudly.
 */
/**
 * The real `child_process`, captured at module load — which is necessarily
 * BEFORE `installSandbox()` patches `Module._load`.
 *
 * This is not a micro-optimisation. Calling `require('child_process')` from
 * inside the shim goes through the very `Module._load` patch that returns the
 * shim, so `real.spawn` would be the shim's own `spawn` and an authorised spawn
 * would recurse until `RangeError: Maximum call stack size exceeded`. The
 * authorised path — the only path that is supposed to work — was the one that
 * could not. Both llama.cpp-backed reranker extensions depend on it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const REAL_CHILD_PROCESS = require('child_process') as {
  spawn: (c: string, a?: readonly string[], o?: unknown) => unknown;
};

export function createChildProcessShim(
  granted: ReadonlySet<ExtensionPermission>,
  preauthorizedBinaries: readonly string[],
) {
  const allowed = new Set(preauthorizedBinaries.map(normalizeBinary));

  const refuse = (name: string) => () => {
    throw new Error(
      `[natively] child_process.${name} is not available to extensions. ` +
      'Use spawn() with a binary declared in "allowedBinaries".',
    );
  };

  return {
    spawn(command: string, args?: readonly string[], options?: unknown): unknown {
      if (!granted.has('process.spawn')) {
        throw new Error('[natively] spawning a process requires the "process.spawn" permission');
      }
      if (!allowed.has(normalizeBinary(command))) {
        throw new Error(
          `[natively] binary ${JSON.stringify(command)} is not in this extension's "allowedBinaries"`,
        );
      }
      // Authorised: perform the real spawn here in the child, so stdio streams
      // and process lifetime behave exactly as the adapter expects. Routing the
      // streams through the main process would buy nothing — see the header.
      // REAL_CHILD_PROCESS, never require() — see its docstring.
      return REAL_CHILD_PROCESS.spawn(command, args, options);
    },
    exec: refuse('exec'),
    execSync: refuse('execSync'),
    execFile: refuse('execFile'),
    execFileSync: refuse('execFileSync'),
    spawnSync: refuse('spawnSync'),
    fork: refuse('fork'),
  };
}

/**
 * Basename, minus a Windows executable suffix, lowercased. Mirrors
 * `PermissionBroker`'s matching so an extension cannot be authorised by the
 * broker and then rejected here, or the reverse.
 */
function normalizeBinary(value: string): string {
  const base = value.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  return base.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}
