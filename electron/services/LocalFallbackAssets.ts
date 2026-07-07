import fs from 'fs';
import path from 'path';
import { app } from 'electron';

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

export const REQUIRED_MODEL_FILES: RequiredLocalAsset[] = [
  { id: 'minilm-config', kind: 'model_file', relativePath: 'Xenova/all-MiniLM-L6-v2/config.json', description: 'MiniLM embedding config' },
  { id: 'minilm-tokenizer', kind: 'model_file', relativePath: 'Xenova/all-MiniLM-L6-v2/tokenizer.json', description: 'MiniLM embedding tokenizer' },
  { id: 'minilm-tokenizer-config', kind: 'model_file', relativePath: 'Xenova/all-MiniLM-L6-v2/tokenizer_config.json', description: 'MiniLM embedding tokenizer config' },
  { id: 'minilm-onnx', kind: 'model_file', relativePath: 'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx', description: 'MiniLM quantized ONNX model' },
  { id: 'mobilebert-config', kind: 'model_file', relativePath: 'Xenova/mobilebert-uncased-mnli/config.json', description: 'MobileBERT classifier config' },
  { id: 'mobilebert-tokenizer', kind: 'model_file', relativePath: 'Xenova/mobilebert-uncased-mnli/tokenizer.json', description: 'MobileBERT classifier tokenizer' },
  { id: 'mobilebert-tokenizer-config', kind: 'model_file', relativePath: 'Xenova/mobilebert-uncased-mnli/tokenizer_config.json', description: 'MobileBERT classifier tokenizer config' },
  { id: 'mobilebert-onnx', kind: 'model_file', relativePath: 'Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx', description: 'MobileBERT quantized ONNX model' },
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
