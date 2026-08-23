import { spawn } from 'node:child_process';
import path from 'node:path';

if (process.env.NATIVELY_RUN_LIVE_BENCHMARKS !== 'true') {
  process.stderr.write('Live vision benchmarks are disabled. Set NATIVELY_RUN_LIVE_BENCHMARKS=true to opt in.\n');
  process.exit(1);
}

const cli = path.resolve('dist-electron/electron/visionBenchmark/cli.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
