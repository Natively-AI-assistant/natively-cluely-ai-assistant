import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadDefenceConfig } from './config';
import { ProjectIndexer } from './projectIndexer';

async function main(): Promise<void> {
  const config = loadDefenceConfig(); const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'defence-index-smoke-'));
  try { const result = await new ProjectIndexer(config.projectSourcePath, tempRoot).index(true); console.log(JSON.stringify({ status: result.failedTotal === 0 ? 'SUCCESS' : 'FAILED', ...result }, null, 2)); }
  finally { await fs.promises.rm(tempRoot, { recursive: true, force: true }); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAILED', error: error instanceof Error ? error.message : 'unknown' })); process.exitCode = 1; });
