import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { BUNDLED_LOCAL_EMBEDDING, bundledLocalEmbeddingFiles } from '../rag/bundledLocalEmbedding';

export type RequiredLocalAssetKind = 'model_file' | 'package_dir' | 'worker_file' | 'native_binary';

export interface RequiredLocalAsset {
  id: string;
  kind: RequiredLocalAssetKind;
  relativePath: string;
  description: string;
}

export interface LocalAssetResolution {
  id: string;
  ok: boolean;
  path?: string;
  checked: string[];
  message: string;
}

// The preflight checks the model LocalEmbeddingProvider actually loads. Derived
// from bundledLocalEmbedding.ts so a model swap cannot leave this list pointing
// at files nothing opens — which would report "assets ready" for an embedder
// that then fails to load. (Before 2026-09-22 this named MiniLM literally.)
const [EMBED_CONFIG, EMBED_TOKENIZER, EMBED_TOKENIZER_CONFIG, EMBED_ONNX] = bundledLocalEmbeddingFiles();
export const REQUIRED_MODEL_FILES: RequiredLocalAsset[] = [
  { id: 'local-embedding-config', kind: 'model_file', relativePath: EMBED_CONFIG, description: `${BUNDLED_LOCAL_EMBEDDING.label} embedding config` },
  { id: 'local-embedding-tokenizer', kind: 'model_file', relativePath: EMBED_TOKENIZER, description: `${BUNDLED_LOCAL_EMBEDDING.label} embedding tokenizer` },
  { id: 'local-embedding-tokenizer-config', kind: 'model_file', relativePath: EMBED_TOKENIZER_CONFIG, description: `${BUNDLED_LOCAL_EMBEDDING.label} embedding tokenizer config` },
  { id: 'local-embedding-onnx', kind: 'model_file', relativePath: EMBED_ONNX, description: `${BUNDLED_LOCAL_EMBEDDING.label} quantized ONNX model` },
];

/**
 * OPTIONAL model assets (review#9, 2026-08-24): the runtime degrades gracefully
 * without them, so their absence must never fail install, preflight, or a dev
 * checkout. Packaging still bundles them when present, and the RELEASE gate
 * (scripts/verify-packaged-local-assets.mjs) still requires them so shipped
 * builds are complete.
 */
export const OPTIONAL_MODEL_FILES: RequiredLocalAsset[] = [
  // Auto Answer V3 TurnPredictor: predict() returns null when this is missing
  // and the deterministic endpoint path is unaffected (spec V2 §38).
  { id: 'smart-turn-onnx', kind: 'model_file', relativePath: 'pipecat-ai/smart-turn-v3/smart-turn-v3.1-cpu.onnx', description: 'Smart Turn v3.1 int8 ONNX (audio end-of-turn) — optional' },
];

export function getAppPathSafe(): string {
  try { return app.getAppPath(); } catch { return process.cwd(); }
}

export function getResourcesPathSafe(): string {
  return process.resourcesPath || path.join(getAppPathSafe(), '..');
}

export function candidateModelRoots(): string[] {
  const candidates: string[] = [];
  if (process.env.NATIVELY_LOCAL_MODELS_PATH) candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
  candidates.push(path.join(getResourcesPathSafe(), 'models'));
  candidates.push(path.join(getResourcesPathSafe(), 'app.asar.unpacked', 'resources', 'models'));

  const appPath = getAppPathSafe();
  candidates.push(path.join(appPath, 'resources', 'models'));
  candidates.push(path.join(appPath, '..', 'resources', 'models'));
  candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
  candidates.push(path.join(process.cwd(), 'resources', 'models'));

  return [...new Set(candidates)];
}

export function resolvePackagedModelPath(relativeModelPath: string): string {
  const result = resolveLocalModelAsset(relativeModelPath);
  if (result.ok && result.path) return result.path;
  throw new Error(
    `[LocalModelAssets] Missing packaged model asset: ${relativeModelPath}. Checked: ${result.checked.join(', ')}`,
  );
}

export function resolveLocalModelAsset(relativeModelPath: string): LocalAssetResolution {
  const checked = candidateModelRoots().map(root => path.join(root, relativeModelPath));
  for (const candidate of checked) {
    try {
      if (fs.existsSync(candidate)) {
        return { id: relativeModelPath, ok: true, path: candidate, checked, message: 'found' };
      }
    } catch {
      // keep trying
    }
  }
  return {
    id: relativeModelPath,
    ok: false,
    checked,
    message: `Missing packaged model asset: ${relativeModelPath}`,
  };
}

export function resolveModelRootFor(modelRelativeDir: string): string {
  const marker = path.join(modelRelativeDir, 'tokenizer.json');
  const result = resolveLocalModelAsset(marker);
  if (result.ok && result.path) return path.dirname(result.path);
  return path.join(candidateModelRoots()[0] || path.join(process.cwd(), 'resources', 'models'), modelRelativeDir);
}

export function verifyRequiredModelAssets(): LocalAssetResolution[] {
  return REQUIRED_MODEL_FILES.map(asset => ({
    ...resolveLocalModelAsset(asset.relativePath),
    id: asset.id,
  }));
}

export async function canImportPackage(packageName: string): Promise<{ ok: boolean; message: string }> {
  try {
    await (new Function('name', 'return import(name)'))(packageName);
    return { ok: true, message: `${packageName} importable` };
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
}
