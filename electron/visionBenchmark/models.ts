import fs from 'node:fs';
import path from 'node:path';
import type { VisionBenchmarkModel } from './types';

const DEFINITIONS = [
  { label: 'Gemini 3.6 Flash', key: 'gemini-3.6-flash', env: 'NATIVELY_BENCHMARK_GEMINI_36_FLASH_MODEL' },
  { label: 'Gemini 3.1 Flash-Lite', key: 'gemini-3.1-flash-lite', env: 'NATIVELY_BENCHMARK_GEMINI_31_FLASH_LITE_MODEL' },
  { label: 'Gemini 3.5 Flash-Lite', key: 'gemini-3.5-flash-lite', env: 'NATIVELY_BENCHMARK_GEMINI_35_FLASH_LITE_MODEL' },
] as const;

const REPOSITORY_MODELS: Record<string, string> = {
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite',
};

export function resolveBenchmarkModels(repositoryRoot: string): VisionBenchmarkModel[] {
  let fileConfig: Record<string, { modelId?: string; enabled?: boolean }> = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'vision-benchmark.models.json'), 'utf8'));
  } catch { /* validated below */ }
  return DEFINITIONS.map((definition) => {
    const repository = REPOSITORY_MODELS[definition.key];
    const environment = process.env[definition.env]?.trim();
    const configured = fileConfig[definition.key]?.modelId?.trim();
    const modelId = repository || environment || configured || definition.key;
    const source = repository ? 'repository' : environment ? 'environment' : 'benchmark-config';
    return { label: definition.label, modelId, enabled: fileConfig[definition.key]?.enabled !== false, source };
  });
}

export function benchmarkModelEnvironmentNames(): string[] {
  return DEFINITIONS.map((definition) => definition.env);
}
