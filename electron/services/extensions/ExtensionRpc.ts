/**
 * Typed request/response protocol over the extension host channel.
 *
 * Phase 1 defines the WIRE CONTRACT; Phase 2 attaches it to a utilityProcess.
 * Keeping the protocol in its own module means both sides compile against one
 * definition and a mismatch is a type error rather than a message that is
 * silently dropped.
 *
 * Design rules, learned from this repo's earlier worker protocols:
 *
 *  - Every request carries an `id`, and every reply echoes it. A reply that
 *    cannot be matched to a pending request is discarded and logged, never
 *    applied to whatever happens to be in flight.
 *  - Every request has a deadline owned by the CALLER. A host that never
 *    replies must fail the call, not hang it — a timer on the host side alone
 *    cannot interrupt a child wedged in a synchronous native call.
 *  - Both directions are modelled. The extension calls back into the broker
 *    for filesystem, network and spawn, because it has no ambient access.
 */

import type { PermissionRequest } from './PermissionBroker';
import type { ExtensionPermission, RankedCandidate, RerankCandidate } from './types';

/** Default per-call deadline for `rerank`. */
export const DEFAULT_RERANK_TIMEOUT_MS = 10_000;
/** Deadline for `init`, which may load a model from cold disk. */
export const DEFAULT_INIT_TIMEOUT_MS = 60_000;
/** Deadline for `dispose` before the host is hard-killed. */
export const DEFAULT_DISPOSE_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Host -> extension
// ---------------------------------------------------------------------------

export interface HostInitRequest {
  kind: 'init';
  context: {
    extensionId: string;
    modelDir: string;
    config: Record<string, unknown>;
  };
  /** Absolute path to the entrypoint, resolved and existence-checked by the host. */
  entrypoint: string;
  /**
   * Sent so the child can install its sandbox BEFORE loading the entrypoint.
   * The child re-deriving these from a manifest it read itself would let a
   * tampered on-disk manifest widen its own grant; the host is the authority.
   */
  granted: ExtensionPermission[];
  /**
   * Binaries the broker authorised during the handshake. Node's `spawn` is
   * synchronous and cannot await a round trip, so the child enforces against
   * this pre-authorised set at call time. The decision is still the broker's.
   */
  preauthorizedBinaries: string[];
}

export interface HostRerankRequest {
  kind: 'rerank';
  query: string;
  candidates: RerankCandidate[];
  topK: number;
}

export interface HostDisposeRequest {
  kind: 'dispose';
}

/**
 * Tells the child to abandon the rerank with this id.
 *
 * Fire-and-forget: the host has already failed the call by the time it sends
 * one, and it expects no reply. Without it the child's AbortSignal could never
 * fire, so an extension that dutifully polls `opts.signal.aborted` would keep
 * working on a result nobody will read — an in-flight llama-server request, or
 * an ONNX batch loop — while the next rerank starts alongside it.
 */
export interface HostCancelRequest { kind: 'cancel'; cancelId: number }

export type HostRequestBody =
  | HostInitRequest | HostRerankRequest | HostDisposeRequest | HostCancelRequest;

export interface HostRequest {
  direction: 'host-to-extension';
  id: number;
  body: HostRequestBody;
}

export type ExtensionReplyBody =
  | { kind: 'init'; ok: true }
  | { kind: 'rerank'; ok: true; ranked: RankedCandidate[] }
  | { kind: 'dispose'; ok: true }
  | { kind: 'error'; ok: false; message: string; stack?: string };

export interface ExtensionReply {
  direction: 'extension-to-host';
  id: number;
  body: ExtensionReplyBody;
}

// ---------------------------------------------------------------------------
// Extension -> host (broker-mediated capability calls)
// ---------------------------------------------------------------------------

/**
 * The extension asks the host to perform an operation on its behalf. The host
 * runs it past `PermissionBroker` first; a denial comes back as a `BrokerReply`
 * with `ok:false`, which the extension-side shim turns into a rejected promise.
 */
export interface BrokerRequest {
  direction: 'extension-to-host';
  id: number;
  body: { kind: 'broker'; request: PermissionRequest; payload?: unknown };
}

export type BrokerReplyBody =
  | { kind: 'broker'; ok: true; result: unknown }
  | { kind: 'broker'; ok: false; denied: boolean; reason: string };

export interface BrokerReply {
  direction: 'host-to-extension';
  id: number;
  body: BrokerReplyBody;
}

/** A log line forwarded from the extension. Never written straight to a file. */
export interface ExtensionLogMessage {
  direction: 'extension-to-host';
  id: 0;
  body: {
    kind: 'log';
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    args: unknown[];
  };
}

/** Sent once when the entrypoint has loaded and the extension is ready. */
export interface ExtensionReadyMessage {
  direction: 'extension-to-host';
  id: 0;
  body: { kind: 'ready' };
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

export type HostToExtensionMessage = HostRequest | BrokerReply;

export type ExtensionToHostMessage =
  | ExtensionReply
  | BrokerRequest
  | ExtensionLogMessage
  | ExtensionReadyMessage;

export function isExtensionToHostMessage(value: unknown): value is ExtensionToHostMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<ExtensionToHostMessage>;
  if (m.direction !== 'extension-to-host') return false;
  if (typeof m.id !== 'number') return false;
  const body = (m as { body?: { kind?: unknown } }).body;
  return typeof body === 'object' && body !== null && typeof body.kind === 'string';
}

/** Thrown when a call exceeds its deadline. Distinguishable from an extension error. */
export class ExtensionTimeoutError extends Error {
  constructor(public readonly extensionId: string, public readonly operation: string, public readonly ms: number) {
    super(`extension "${extensionId}" did not answer ${operation} within ${ms}ms`);
    this.name = 'ExtensionTimeoutError';
  }
}
