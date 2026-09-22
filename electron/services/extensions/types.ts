/**
 * Public extension API surface — Natively Core, API version "1".
 *
 * Core defines INTERFACES ONLY. Nothing in this file is model-specific, no
 * extension is named here, and Core never imports from an extension. This is
 * the entire surface a third-party extension compiles against.
 *
 * The extension system exists so that a third party can ship a model adapter
 * — together with that model's own licence obligations — without those
 * obligations attaching to Natively Core. Core distributes no model weights
 * and downloads none without an explicit user action.
 */

/** The only manifest apiVersion this build of Core can load. */
export const EXTENSION_API_VERSION = '1';

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * The closed set of permissions an extension may request.
 *
 * Declared as a `const` tuple so the union below is DERIVED from it. There is
 * no second list to keep in sync: adding a permission here is the only way to
 * make one grantable, and `PermissionBroker` denies anything it cannot find in
 * this tuple. "Undeclared is denied" is therefore structural, not a check
 * someone has to remember to write.
 *
 * - `filesystem.models`    read/write, confined to the extension's OWN model dir
 * - `filesystem.workspace` read-only, user-granted per session
 * - `network.localhost`    loopback only
 * - `network.remote`       requires a non-empty host allowlist in the manifest
 * - `process.spawn`        declared binaries only
 */
export const EXTENSION_PERMISSIONS = [
  'filesystem.models',
  'filesystem.workspace',
  'network.localhost',
  'network.remote',
  'process.spawn',
] as const;

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];

/**
 * Permissions that force a warning dialog at install time because granting
 * them widens the blast radius beyond the extension's own sandbox.
 */
export const HIGH_RISK_PERMISSIONS: readonly ExtensionPermission[] = [
  'network.remote',
  'filesystem.workspace',
];

export function isExtensionPermission(value: unknown): value is ExtensionPermission {
  return typeof value === 'string'
    && (EXTENSION_PERMISSIONS as readonly string[]).includes(value);
}

export function isHighRiskPermission(value: ExtensionPermission): boolean {
  return HIGH_RISK_PERMISSIONS.includes(value);
}

// ---------------------------------------------------------------------------
// Extension context — the ONLY ambient authority an extension receives
// ---------------------------------------------------------------------------

export interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Handed to an extension's `init()`. Deliberately four fields.
 *
 * There is no `fs`, no `net`, no `process`, and no handle that transitively
 * reaches them. An extension that wants the filesystem or the network asks the
 * broker over RPC (Phase 2) and is answered according to its granted
 * permissions. `ExtensionContextSurfaceGuard.test.mjs` pins this shape so the
 * surface cannot grow by accident.
 */
export interface ExtensionContext {
  /** The extension's own id, as declared in its manifest. */
  readonly extensionId: string;
  /** Absolute path to this extension's private model directory. */
  readonly modelDir: string;
  /** Namespaced logger; writes go to Core's log, never straight to a file. */
  readonly logger: ExtensionLogger;
  /** User-set configuration for this extension. Plain data only. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** The exact set of keys `ExtensionContext` is allowed to carry. */
export const EXTENSION_CONTEXT_KEYS: readonly string[] = [
  'extensionId',
  'modelDir',
  'logger',
  'config',
];

// ---------------------------------------------------------------------------
// Reranker capability
// ---------------------------------------------------------------------------

export interface RerankCandidate {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RankedCandidate {
  id: string;
  score: number;
  rank: number;
}

export interface RerankOptions {
  topK: number;
  signal: AbortSignal;
}

export interface Reranker {
  readonly id: string;
  readonly name: string;
  init(ctx: ExtensionContext): Promise<void>;
  rerank(
    query: string,
    candidates: RerankCandidate[],
    opts: RerankOptions,
  ): Promise<RankedCandidate[]>;
  dispose(): Promise<void>;
}

/**
 * Capability kinds an extension can declare. `reranker` is the only one Core
 * can route to today; the union exists so the manifest schema rejects a type
 * this build cannot host, instead of loading it and failing later.
 */
export const EXTENSION_TYPES = ['reranker'] as const;
export type ExtensionType = (typeof EXTENSION_TYPES)[number];
