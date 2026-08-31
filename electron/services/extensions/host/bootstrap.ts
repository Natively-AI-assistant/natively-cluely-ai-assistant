/**
 * The script Electron's `utilityProcess.fork` runs. One of these per enabled
 * extension; never the main process, never a renderer.
 *
 * Ordering is the whole point of this file:
 *
 *   1. Register the parentPort listener and announce `ready` FIRST. Until a
 *      listener exists, a message sent by the host is dropped with no error and
 *      no timeout — the exact failure `electron/rag/VectorStore.ts:1-24`
 *      documents from this project's previous worker protocol. Announcing
 *      readiness is what lets the host distinguish "still starting" from
 *      "died during module load", which `utilityProcess` otherwise reports
 *      only as an `exit` with a non-zero code.
 *   2. Install the sandbox on the `init` message, BEFORE the entrypoint is
 *      required. Loading first and stubbing after would hand the extension's
 *      own module-level code an unsandboxed environment.
 *   3. Only then require the entrypoint.
 *
 * This file must not import anything that reaches Electron's main-process APIs:
 * it runs in the child.
 */

import * as path from 'path';
import { pathToFileURL } from 'url';
import { installSandbox } from './sandbox';
import type { PermissionRequest } from '../PermissionBroker';
import type {
  ExtensionToHostMessage,
  HostToExtensionMessage,
  HostRequest,
} from '../ExtensionRpc';
import type {
  ExtensionContext,
  ExtensionLogger,
  RankedCandidate,
  RerankCandidate,
  Reranker,
} from '../types';

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

if (!parentPort) {
  // Running outside a utilityProcess. Fail loudly rather than sitting idle.
  throw new Error('[natively] extension bootstrap requires an Electron utilityProcess');
}

const port = parentPort;

function send(message: ExtensionToHostMessage): void {
  port.postMessage(message);
}

// ---------------------------------------------------------------------------
// Broker round trips (child -> host)
// ---------------------------------------------------------------------------

let nextBrokerId = 1;
const pendingBrokerCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

const callBroker = (request: PermissionRequest, payload?: unknown): Promise<unknown> => {
  const id = nextBrokerId++;
  return new Promise<unknown>((resolve, reject) => {
    pendingBrokerCalls.set(id, { resolve, reject });
    send({ direction: 'extension-to-host', id, body: { kind: 'broker', request, payload } });
  });
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function makeLogger(): ExtensionLogger {
  const emit = (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, ...args: unknown[]): void => {
      // Arguments are stringified here: an arbitrary object from the extension
      // may not be structured-cloneable, and a throw inside postMessage would
      // take down logging entirely.
      send({
        direction: 'extension-to-host',
        id: 0,
        body: { kind: 'log', level, message: String(message), args: args.map(safeString) },
      });
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

let reranker: Reranker | null = null;

async function handleInit(request: Extract<HostRequest['body'], { kind: 'init' }>): Promise<void> {
  // (2) Sandbox BEFORE the entrypoint is loaded.
  installSandbox({
    granted: request.granted,
    preauthorizedBinaries: request.preauthorizedBinaries,
    callBroker,
  });

  // (3) Now load. The path is computed at runtime on purpose: an extension's
  // entrypoint is not known at build time and must never be bundled into Core.
  //
  // Dynamic import() rather than require(): extensions are ordinarily ESM
  // (`"type": "module"`), and while Electron's Node can require() ESM, it
  // REFUSES a module containing top-level await. import() handles ESM and CJS
  // alike, and for CJS puts module.exports on `.default`, which the unwrapping
  // below already expects.
  const entrypoint = path.resolve(request.entrypoint);
  const loaded = await import(pathToFileURL(entrypoint).href) as { default?: unknown };
  // An ESM module whose default is itself a CJS namespace needs one more hop.
  let candidate: unknown = loaded?.default ?? loaded;
  if (candidate && typeof candidate === 'object' && 'default' in (candidate as object)) {
    candidate = (candidate as { default: unknown }).default;
  }

  const instance = typeof candidate === 'function'
    ? new (candidate as new () => Reranker)()
    : (candidate as Reranker);

  assertReranker(instance);

  const context: ExtensionContext = {
    extensionId: request.context.extensionId,
    modelDir: request.context.modelDir,
    logger: makeLogger(),
    config: Object.freeze({ ...request.context.config }),
  };

  await instance.init(context);
  reranker = instance;
}

function assertReranker(value: unknown): asserts value is Reranker {
  const r = value as Partial<Reranker> | null;
  if (!r || typeof r.init !== 'function' || typeof r.rerank !== 'function' || typeof r.dispose !== 'function') {
    throw new Error(
      '[natively] the extension entrypoint must export a Reranker with init(), rerank() and dispose()',
    );
  }
}

async function handleRerank(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<RankedCandidate[]> {
  if (!reranker) throw new Error('[natively] rerank() called before init()');
  // The host owns the real deadline and will fail the call regardless; this
  // signal only gives a cooperative extension the chance to stop early.
  const controller = new AbortController();
  return reranker.rerank(query, candidates, { topK, signal: controller.signal });
}

// ---------------------------------------------------------------------------
// (1) Listener first, then announce readiness.
// ---------------------------------------------------------------------------

port.on('message', (event) => {
  void handleMessage(event.data as HostToExtensionMessage);
});

async function handleMessage(message: HostToExtensionMessage): Promise<void> {
  if (!message || typeof message !== 'object') return;

  if (message.direction === 'host-to-extension' && message.body.kind === 'broker') {
    const pending = pendingBrokerCalls.get(message.id);
    if (!pending) return; // Unmatched reply: discard, never apply to another call.
    pendingBrokerCalls.delete(message.id);
    if (message.body.ok) pending.resolve(message.body.result);
    else pending.reject(new Error(message.body.reason));
    return;
  }

  const request = message as HostRequest;
  if (request.direction !== 'host-to-extension') return;

  try {
    switch (request.body.kind) {
      case 'init':
        await handleInit(request.body);
        send({ direction: 'extension-to-host', id: request.id, body: { kind: 'init', ok: true } });
        return;

      case 'rerank': {
        const ranked = await handleRerank(request.body.query, request.body.candidates, request.body.topK);
        send({ direction: 'extension-to-host', id: request.id, body: { kind: 'rerank', ok: true, ranked } });
        return;
      }

      case 'dispose':
        if (reranker) await reranker.dispose();
        reranker = null;
        send({ direction: 'extension-to-host', id: request.id, body: { kind: 'dispose', ok: true } });
        return;

      default:
        throw new Error(`[natively] unknown request kind ${JSON.stringify(request.body)}`);
    }
  } catch (error) {
    send({
      direction: 'extension-to-host',
      id: request.id,
      body: {
        kind: 'error',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }
}

send({ direction: 'extension-to-host', id: 0, body: { kind: 'ready' } });
