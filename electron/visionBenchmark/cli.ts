#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_BENCHMARK_QUESTION, type BenchmarkPromptKind, type BenchmarkResolution, type BenchmarkThinking, type VisionBenchmarkConfig } from './types';
import { resolveBenchmarkModels } from './models';
import { VisionBenchmarkRunner } from './runner';
import { exportBenchmarkSession } from './report';

const repositoryRoot = path.resolve(__dirname, '../../..');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), override: false, quiet: true });

function args(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=', 2);
    if (inline !== undefined) parsed[rawKey] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) parsed[rawKey] = argv[++i];
    else parsed[rawKey] = true;
  }
  return parsed;
}
function number(value: string | boolean | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}
function milliseconds(value?: number): string {
  return value === undefined ? 'n/a' : `${value.toFixed(1)}ms`;
}

async function pickImage(): Promise<string> {
  if (!process.versions.electron) throw new Error('--image is required when the CLI is not running under Electron.');
  const { app, dialog } = require('electron');
  await app.whenReady();
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Screenshots', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled || !result.filePaths[0]) throw new Error('Screenshot selection was cancelled.');
  return result.filePaths[0];
}

async function main(): Promise<void> {
  const parsed = args(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write('Usage: npm run benchmark:vision -- --image /absolute/screenshot.png [--models ids] [--mode technical-interview] [--runs 10] [--warmups 2]\n');
    return;
  }
  const imagePath = parsed.image ? path.resolve(String(parsed.image)) : await pickImage();
  if (!fs.existsSync(imagePath)) throw new Error('Selected screenshot does not exist.');
  const models = resolveBenchmarkModels(repositoryRoot);
  const requested = parsed.models ? String(parsed.models).split(',').map((v) => v.trim()) : models.filter((m) => m.enabled).map((m) => m.modelId);
  const config: VisionBenchmarkConfig = {
    imagePath, modelIds: requested,
    promptKind: String(parsed.prompt || (parsed.mode ? 'production-mode' : 'general-vision')) as BenchmarkPromptKind,
    mode: String(parsed.mode || 'general'), question: String(parsed.question || DEFAULT_BENCHMARK_QUESTION),
    measuredRuns: number(parsed.runs, 10), warmupRuns: number(parsed.warmups, 2),
    thinking: String(parsed.thinking || 'minimal') as BenchmarkThinking,
    resolution: String(parsed.resolution || 'high') as BenchmarkResolution,
    temperature: number(parsed.temperature, 0), maxOutputTokens: number(parsed['max-output-tokens'], 4096),
    execution: String(parsed.execution || 'sequential') as 'sequential' | 'parallel',
    connection: String(parsed.connection || 'warm') as 'warm' | 'fresh-client',
    randomizeModelOrder: parsed['randomize-order'] !== 'false',
    timeoutMs: number(parsed.timeout, 120000), interRunDelayMs: number(parsed.delay, 0),
    includeScreenshotInExport: parsed['include-screenshot'] === true,
    outputRoot: parsed.output ? path.resolve(String(parsed.output)) : undefined,
  };
  const apiKey = (process.env.GEMINI_API_KEY_1 || '').trim();
  const runner = new VisionBenchmarkRunner({ apiKey });
  let completed = 0;
  const session = await runner.run(config, models, {
    onRunStarted: ({ model, runNumber, warmup }) => process.stdout.write(`${warmup ? 'Warm-up' : 'Run'} ${runNumber}: ${model.label}\n`),
    onRunCompleted: (run) => {
      completed++;
      process.stdout.write(`  ${run.success ? 'ok' : `failed (${run.error?.code})`} request-TTFT=${milliseconds(run.requestTtftMs)}\n`);
    },
  });
  const output = await exportBenchmarkSession(session, repositoryRoot);
  process.stdout.write(`Completed ${completed} attempts. Report: ${output}\n`);
  for (const stat of session.statistics) {
    process.stdout.write(`${stat.model.label} [${stat.model.modelId}]: success ${(stat.successRate * 100).toFixed(1)}%, median TTFT ${milliseconds(stat.metrics.requestTtftMs.median)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Vision benchmark failed: ${String(error?.message || error).replace(/\b(?:AIza[\\w-]{20,}|sk-[\\w-]{16,})\b/g, '[REDACTED]')}\n`);
  process.exitCode = 1;
});
