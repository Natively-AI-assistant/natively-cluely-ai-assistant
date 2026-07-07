import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { ProviderStatusRegistry } from './ProviderStatusRegistry';
import type { ProviderHealth, ProviderKind, ProviderStatus } from './providerStatus';
import { canImportPackage, verifyRequiredModelAssets } from './LocalFallbackAssets';
import { OllamaManager } from './OllamaManager';

export interface LocalFallbackPreflightCheck {
  id: string;
  ok: boolean;
  health: ProviderHealth;
  durationMs: number;
  message: string;
  recoverable: boolean;
}

export interface LocalFallbackPreflightResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checks: LocalFallbackPreflightCheck[];
}

let latestResult: LocalFallbackPreflightResult | null = null;
let inFlight: Promise<LocalFallbackPreflightResult> | null = null;

function statusFor(id: string, kind: ProviderKind, health: ProviderHealth, message: string, details?: Record<string, unknown>): ProviderStatus {
  // No Natively provider is required for the app to start. The packaged local
  // fallback stack is only required for *core* intelligence features when no
  // cloud key is configured. requiredForCoreFallback: true marks providers
  // that degrade the user experience when absent; requiredForStartup stays
  // false everywhere so the renderer diagnostic UI can correctly say
  // "optional / installed / missing" rather than "blocked startup".
  return {
    id,
    kind,
    health,
    requiredForStartup: false,
    requiredForCoreFallback: true,
    message,
    recoverable: health !== 'missing_required_asset',
    details,
  };
}

async function timedCheck(
  id: string,
  fn: () => Promise<{ ok: boolean; message: string; health?: ProviderHealth; recoverable?: boolean }> | { ok: boolean; message: string; health?: ProviderHealth; recoverable?: boolean },
): Promise<LocalFallbackPreflightCheck> {
  const start = performance.now();
  try {
    const result = await fn();
    return {
      id,
      ok: result.ok,
      health: result.health || (result.ok ? 'ready' : 'missing_required_asset'),
      durationMs: Math.round(performance.now() - start),
      message: result.message,
      recoverable: result.recoverable ?? result.ok,
    };
  } catch (err: any) {
    return {
      id,
      ok: false,
      health: 'missing_required_asset',
      durationMs: Math.round(performance.now() - start),
      message: err?.message || String(err),
      recoverable: false,
    };
  }
}

export function getLatestLocalFallbackPreflight(): LocalFallbackPreflightResult | null {
  return latestResult ? { ...latestResult, checks: latestResult.checks.map(c => ({ ...c })) } : null;
}

/**
 * True when running inside the packaged `.app` / Windows installer. In dev
 * (`electron .` from the repo) `app.isPackaged === false`, so unpacked
 * checks would falsely report missing natives even though they live under
 * the repo's `node_modules/`.
 */
export function isPackagedSafe(): boolean {
  try {
    const { app } = require('electron') as typeof import('electron');
    return Boolean(app?.isPackaged);
  } catch {
    return false;
  }
}

function getAppPathSafe(): string {
  try {
    const { app } = require('electron') as typeof import('electron');
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

function candidateNativeModulePaths(): string[] {
  const candidates: string[] = [];
  const arch = process.arch;
  const platform = process.platform;
  const map: Record<string, Record<string, string>> = {
    win32: { x64: 'index.win32-x64-msvc.node', ia32: 'index.win32-ia32-msvc.node', arm64: 'index.win32-arm64-msvc.node' },
    darwin: { x64: 'index.darwin-x64.node', arm64: 'index.darwin-arm64.node' },
    linux: { x64: 'index.linux-x64-gnu.node', arm64: 'index.linux-arm64-gnu.node' },
  };
  const binary = map[platform]?.[arch];
  if (!binary) return candidates;
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'native-module', binary));
  }
  const appPath = getAppPathSafe();
  if (appPath) {
    candidates.push(path.join(appPath, 'native-module', binary));
    candidates.push(path.join(appPath, '..', 'native-module', binary));
  }
  return candidates;
}

function tryRequireNativeModule(): { ok: boolean; message: string } {
  if (!isPackagedSafe()) {
    // In dev (`electron .` from the repo), the native module lives under
    // the repo's native-module/. The packaged check below is meaningless
    // for dev users; the runtime loader handles dev resolution separately.
    return { ok: true, message: 'Dev mode: native module probe skipped (loaded at runtime by nativeModuleLoader)' };
  }
  for (const p of candidateNativeModulePaths()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(p);
      if (typeof mod?.getHardwareId === 'function') {
        const hwid = mod.getHardwareId();
        if (typeof hwid === 'string' && hwid.length > 0) {
          return { ok: true, message: `Native audio module loaded (${path.basename(p)})` };
        }
        return { ok: false, message: `Native audio module returned empty hardware id from ${p}` };
      }
    } catch (e: any) {
      // try next candidate
    }
  }
  return { ok: false, message: 'Native audio module not found in any packaged or dev path' };
}

function checkNativeModuleUnpacked(): { ok: boolean; message: string } {
  if (!isPackagedSafe()) {
    return { ok: true, message: 'Dev mode: native module unpacked check skipped' };
  }
  if (!process.resourcesPath) {
    return { ok: false, message: 'Cannot validate packaged path: process.resourcesPath is undefined' };
  }
  const candidates = candidateNativeModulePaths();
  if (candidates.length === 0) return { ok: false, message: 'No native module candidates for this platform' };
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return { ok: true, message: `Found ${path.basename(p)}` };
  }
  return { ok: false, message: `Native module binary missing under resources/app.asar.unpacked/native-module/` };
}

function checkUnpackedNativeDir(rel: string): { ok: boolean; message: string } {
  if (!isPackagedSafe()) {
    return { ok: true, message: `Dev mode: skipping unpacked check (${rel})` };
  }
  // process.resourcesPath is normally set in packaged builds, but the
  // preflight must not crash if it's missing — treat as missing instead.
  if (!process.resourcesPath) {
    return { ok: false, message: `Cannot validate packaged path: process.resourcesPath is undefined (rel=${rel})` };
  }
  const full = path.join(process.resourcesPath, 'app.asar.unpacked', rel);
  if (fs.existsSync(full)) return { ok: true, message: `Found app.asar.unpacked/${rel}` };
  return { ok: false, message: `Missing app.asar.unpacked/${rel}` };
}

export async function runLocalFallbackPreflight(options: { ollamaSelected?: boolean } = {}): Promise<LocalFallbackPreflightResult> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const startedAt = new Date().toISOString();
    console.log('[LocalFallbackPreflight] started');
    const checks: LocalFallbackPreflightCheck[] = [];

    // 1. ONNX / Transformers.js runtime imports.
    checks.push(await timedCheck('@huggingface/transformers import', () => canImportPackage('@huggingface/transformers')));
    checks.push(await timedCheck('onnxruntime-common import', () => canImportPackage('onnxruntime-common')));
    checks.push(await timedCheck('onnxruntime-node import', () => canImportPackage('onnxruntime-node')));

    // 2. Required bundled model assets. In dev the models live under the repo's
    // resources/models/ and resolveModelPath() finds them; in packaged builds
    // they live under process.resourcesPath/models. Either is fine.
    const assetResults = verifyRequiredModelAssets();
    for (const asset of assetResults) {
      checks.push({
        id: `asset:${asset.id}`,
        ok: asset.ok,
        health: asset.ok ? 'ready' : 'missing_required_asset',
        durationMs: 0,
        message: asset.ok ? `Found ${asset.path}` : asset.message,
        recoverable: asset.ok,
      });
    }

    // 2b. Reranker model (smart-retrieval Phase 1). The verifier lists the
    // required reranker files (tokenizer.json + q8 onnx) but the runtime check
    // here covers the resolver-level guarantees (model can be found via the
    // standard candidate-search and the q8 onnx file is non-empty).
    checks.push(await timedCheck('reranker model assets', async () => {
      // In dev the bundled models are under the repo, not packaged resources.
      if (!isPackagedSafe()) {
        return { ok: true, message: 'Dev mode: reranker model is resolved at runtime from resources/models' };
      }
      const fsCheck = await import('fs');
      const pathCheck = await import('path');
      const rerankerCandidates: string[] = [];
      if (process.env.NATIVELY_LOCAL_MODELS_PATH) rerankerCandidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
      if (process.resourcesPath) rerankerCandidates.push(pathCheck.default.join(process.resourcesPath, 'models'));
      let appPath = '';
      try {
        const { app } = require('electron') as typeof import('electron');
        appPath = app.getAppPath();
      } catch { /* ignore */ }
      if (appPath) {
        rerankerCandidates.push(pathCheck.default.join(appPath, 'resources', 'models'));
        rerankerCandidates.push(pathCheck.default.join(appPath, '..', 'resources', 'models'));
      }
      for (const root of rerankerCandidates) {
        const tok = pathCheck.default.join(root, 'Xenova', 'bge-reranker-base', 'tokenizer.json');
        const onnx = pathCheck.default.join(root, 'Xenova', 'bge-reranker-base', 'onnx', 'model_quantized.onnx');
        try {
          if (fsCheck.existsSync(tok) && fsCheck.existsSync(onnx) && fsCheck.statSync(onnx).size > 0) {
            return { ok: true, message: `Found ${onnx}` };
          }
        } catch { /* keep trying */ }
      }
      return { ok: false, message: 'Xenova/bge-reranker-base model files missing from packaged resources/models/' };
    }));

    // 3. Packaged native binaries (Rust audio module, sqlite-vec, sharp, better-sqlite3, keytar).
    checks.push(await timedCheck('rust native audio module', async () => checkNativeModuleUnpacked()));
    checks.push(await timedCheck('rust native audio module loadable', async () => tryRequireNativeModule()));
    checks.push(await timedCheck('better-sqlite3 native', async () => checkUnpackedNativeDir('node_modules/better-sqlite3/build/Release/better_sqlite3.node')));
    checks.push(await timedCheck('sharp darwin-arm64 native', async () => checkUnpackedNativeDir('node_modules/@img/sharp-darwin-arm64/lib')));
    checks.push(await timedCheck('sharp darwin-x64 native', async () => checkUnpackedNativeDir('node_modules/@img/sharp-darwin-x64/lib')));
    checks.push(await timedCheck('sqlite-vec darwin-arm64 dylib', async () => checkUnpackedNativeDir('node_modules/sqlite-vec-darwin-arm64/vec0.dylib')));
    checks.push(await timedCheck('sqlite-vec darwin-x64 dylib', async () => checkUnpackedNativeDir('node_modules/sqlite-vec-darwin-x64/vec0.dylib')));

    // 4. Ollama optional path.
    if (options.ollamaSelected) {
      const status = await OllamaManager.getInstance().probe();
      checks.push({
        id: 'ollama probe',
        ok: status.health === 'ready',
        health: status.health,
        durationMs: 0,
        message: status.message,
        recoverable: true,
      });
    } else {
      checks.push({
        id: 'ollama skipped',
        ok: true,
        health: 'ready',
        durationMs: 0,
        message: 'Ollama not selected; external provider was not started',
        recoverable: true,
      });
    }

    // Publish provider statuses for the local fallback stack.
    const importOk = checks.filter(c => c.id.includes('import')).every(c => c.ok);
    const minilmOk = checks.filter(c => c.id.includes('minilm')).every(c => c.ok);
    const mobilebertOk = checks.filter(c => c.id.includes('mobilebert')).every(c => c.ok);
    const rerankerOk = checks.filter(c => c.id === 'reranker model assets').every(c => c.ok);
    const nativeOk = checks.filter(c => c.id.startsWith('rust native') || c.id.includes('better-sqlite3') || c.id.startsWith('sharp ') || c.id.startsWith('sqlite-vec ')).every(c => c.ok);

    const localEmbeddingOk = importOk && minilmOk && nativeOk;
    const intentOk = importOk && mobilebertOk;

    ProviderStatusRegistry.getInstance().setStatus(statusFor(
      'local-embedding',
      'packaged_local',
      localEmbeddingOk ? 'ready' : 'missing_required_asset',
      localEmbeddingOk
        ? 'Packaged local embedding fallback assets are ready'
        : 'Natively local embedding fallback assets are missing or corrupted. Please reinstall Natively.',
      {
        checks: checks.filter(c => c.id.includes('minilm') || c.id.includes('import') || c.id.startsWith('rust') || c.id.includes('sharp') || c.id.includes('sqlite-vec') || c.id.includes('better-sqlite3')),
      },
    ));

    ProviderStatusRegistry.getInstance().setStatus(statusFor(
      'intent-classifier',
      'packaged_local',
      intentOk ? 'ready' : 'missing_required_asset',
      intentOk
        ? 'Packaged zero-shot intent classifier assets are ready'
        : 'Natively local classifier assets are missing or corrupted. Please reinstall Natively.',
      { checks: checks.filter(c => c.id.includes('mobilebert') || c.id.includes('import')) },
    ));

    ProviderStatusRegistry.getInstance().setStatus(statusFor(
      'local-reranker',
      'packaged_local',
      rerankerOk ? 'ready' : 'missing_required_asset',
      rerankerOk
        ? 'Packaged BGE reranker (q8) is ready for offline smart-retrieval'
        : 'Natively packaged BGE reranker model is missing. Please reinstall Natively.',
      { checks: checks.filter(c => c.id === 'reranker model assets') },
    ));

    ProviderStatusRegistry.getInstance().setStatus(statusFor(
      'native-audio',
      'packaged_local',
      nativeOk ? 'ready' : 'missing_required_asset',
      nativeOk
        ? 'Packaged native audio + DB + image processing assets are ready'
        : 'Natively packaged native assets are missing. Please reinstall Natively.',
      { checks: checks.filter(c => c.id.startsWith('rust') || c.id.includes('sharp') || c.id.includes('sqlite-vec') || c.id.includes('better-sqlite3')) },
    ));

    const ok = checks.every(c => c.ok || c.id === 'ollama probe');
    const result: LocalFallbackPreflightResult = {
      ok,
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
    };
    latestResult = result;

    if (ok) {
      console.log('[LocalFallbackPreflight] passed', { checks: checks.length });
    } else {
      const failed = checks.filter(c => !c.ok).map(c => ({ id: c.id, message: c.message }));
      console.error('[LocalFallbackPreflight] failed', { failed });
    }

    return result;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

export { ProviderStatusRegistry } from './ProviderStatusRegistry';
