import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { redactSecrets } from './core';
import type { ModelStatistics, VisionBenchmarkRun, VisionBenchmarkSession } from './types';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
function csv(rows: unknown[][]): string { return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n'; }
function fixed(value?: number): string { return value === undefined ? '' : value.toFixed(2); }
function git(repositoryRoot: string, args: string[]): string {
  try { return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; }
}
function packageVersion(repositoryRoot: string): string {
  try { return require(path.join(repositoryRoot, 'package.json')).version ?? 'unknown'; } catch { return 'unknown'; }
}
function row(stat: ModelStatistics): unknown[] {
  return [
    stat.model.label, stat.model.modelId, stat.successRate, fixed(stat.metrics.requestTtftMs.median),
    fixed(stat.metrics.requestTtftMs.p75), fixed(stat.metrics.requestTtftMs.p95),
    fixed(stat.metrics.endToEndTtftMs.median), fixed(stat.metrics.totalResponseLatencyMs.median),
    fixed(stat.metrics.outputTokensPerSecond.median), fixed(stat.averageInputTokens),
    fixed(stat.averageVisibleOutputTokens), fixed(stat.averageReasoningTokens),
    fixed(stat.averageSubmittedImageBytes), fixed(stat.averageManualQuality), fixed(stat.balancedScore),
  ];
}

export async function exportBenchmarkSession(
  session: VisionBenchmarkSession,
  repositoryRoot: string,
  outputRoot = session.config.outputRoot || path.join(repositoryRoot, 'benchmark-results'),
): Promise<string> {
  const stamp = session.initiatedAtIso.replace(/[:.]/g, '-');
  const directory = path.join(outputRoot, `${stamp}-${session.id}`);
  const responses = path.join(directory, 'responses');
  const traces = path.join(directory, 'traces');
  await fs.mkdir(responses, { recursive: true });
  await fs.mkdir(traces, { recursive: true });
  const environment = {
    applicationVersion: packageVersion(repositoryRoot), os: `${os.platform()} ${os.release()}`,
    architecture: os.arch(), nodeVersion: process.version,
    electronVersion: process.versions.electron ?? 'not-running-under-electron',
    gitBranch: git(repositoryRoot, ['branch', '--show-current']),
    gitCommit: git(repositoryRoot, ['rev-parse', 'HEAD']),
    timestamp: session.initiatedAtIso,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    endpoint: 'Google Gemini Developer API v1alpha',
  };
  const safeSession = redactSecrets({
    ...session,
    config: { ...session.config, imagePath: path.basename(session.config.imagePath), outputRoot: undefined },
    exportPath: undefined,
  });
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(safeSession, null, 2));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(redactSecrets({
    ...session.config, imagePath: path.basename(session.config.imagePath),
    models: session.models, promptHash: session.prompt.promptHash, promptBuilder: session.prompt.builder,
  }), null, 2));
  await fs.writeFile(path.join(directory, 'environment.json'), JSON.stringify(environment, null, 2));

  const summaryHeader = [
    'Model', 'Actual model ID', 'Success rate', 'Median request TTFT', 'P75 request TTFT',
    'P95 request TTFT', 'Median end-to-end TTFT', 'Median total latency',
    'Median output tokens/s', 'Average input tokens', 'Average visible output tokens',
    'Average reasoning tokens', 'Average submitted image bytes', 'Average manual quality', 'Balanced score',
  ];
  await fs.writeFile(path.join(directory, 'summary.csv'), csv([summaryHeader, ...session.statistics.map(row)]));
  const runHeader = [
    'id', 'model', 'modelId', 'run', 'warmup', 'executionOrder', 'success', 'error',
    'providerEventMs', 'reasoningMs', 'requestTtftMs', 'endToEndTtftMs',
    'totalResponseMs', 'endToEndMs', 'tokensPerSecond', 'charactersPerSecond',
    'inputTokens', 'visibleOutputTokens', 'reasoningTokens', 'submittedImageBytes',
  ];
  const runRows = session.runs.map((run) => [
    run.id, run.model.label, run.model.modelId, run.runNumber, run.warmup, run.executionOrder,
    run.success, run.error?.code, fixed(run.providerEventLatencyMs), fixed(run.reasoningLatencyMs),
    fixed(run.requestTtftMs), fixed(run.endToEndTtftMs), fixed(run.totalResponseLatencyMs),
    fixed(run.endToEndLatencyMs), fixed(run.outputTokensPerSecond), fixed(run.outputCharactersPerSecond),
    run.usage.inputTokens, run.usage.visibleOutputTokens, run.usage.reasoningTokens, run.image.submittedBytes,
  ]);
  await fs.writeFile(path.join(directory, 'runs.csv'), csv([runHeader, ...runRows]));

  const summary = [
    '# Vision Model Benchmark',
    '',
    `Session: \`${session.id}\`  `,
    `Status: **${session.status}**  `,
    `Prompt: \`${session.prompt.builder}\` (\`${session.prompt.promptHash}\`)  `,
    `Balanced score: latency 45%, quality 45%, reliability 10%.`,
    '',
    `| ${summaryHeader.slice(0, 8).join(' | ')} |`,
    `| ${summaryHeader.slice(0, 8).map(() => '---').join(' | ')} |`,
    ...session.statistics.map((stat) => `| ${row(stat).slice(0, 8).join(' | ')} |`),
    '',
    'Warm-up runs are excluded from all statistics. Percentiles use linear interpolation between closest ranks (R-7).',
  ].join('\n');
  await fs.writeFile(path.join(directory, 'summary.md'), summary);

  for (const run of session.runs) {
    const name = `${slug(run.model.label)}-${run.warmup ? 'warmup' : 'run'}-${String(run.runNumber).padStart(2, '0')}`;
    await fs.writeFile(path.join(responses, `${name}.md`), run.response);
    await fs.writeFile(path.join(traces, `${name}.json`), JSON.stringify(redactSecrets(run.trace), null, 2));
  }
  if (session.config.includeScreenshotInExport) {
    await fs.copyFile(session.config.imagePath, path.join(directory, `screenshot${path.extname(session.config.imagePath).toLowerCase()}`));
  }
  session.exportPath = directory;
  return directory;
}
