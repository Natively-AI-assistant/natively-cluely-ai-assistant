export const INSTALL_MAX_BITS: number;
export const INSTALL_SLICE_MS: number;
export const INSTALL_RETRY_MS: Readonly<{ network: number; refused: number; limited: number }>;
export const INSTALL_MAX_ATTEMPTS: number;

export function solvePow(o: {
  challenge: string;
  bits: number;
  sha256: (input: string) => ArrayLike<number>;
  now: () => number;
  yieldFn: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  shouldAbort?: () => boolean;
  shouldPause?: () => boolean;
  sliceMs?: number;
  pauseMs?: number;
}): Promise<{ solution: string; hashes: number } | null>;

export type InstallTokenResult = { token: string } | { skipped: string } | { failed: string };

export interface InstallRegistrarDeps {
  fetchImpl: typeof fetch;
  challengeEndpoint: string;
  registerEndpoint: string;
  sha256: (input: string) => ArrayLike<number>;
  now: () => number;
  yieldFn: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  isEnabled: () => boolean;
  shouldPause?: () => boolean;
  loadToken: (installId: string) => string | undefined;
  saveToken: (installId: string, token: string) => void;
  clearToken: (installId: string) => void;
  maxBits?: number;
  log?: { warn: (...args: unknown[]) => void };
}

export interface InstallRegistrar {
  ensureToken(installId: string): Promise<InstallTokenResult>;
  invalidate(installId: string): void;
  stats(): { registered: number; attempts: number; hashes: number; failed: Record<string, number> };
}

export function createInstallRegistrar(deps: InstallRegistrarDeps): InstallRegistrar;
