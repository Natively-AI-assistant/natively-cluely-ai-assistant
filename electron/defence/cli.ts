import 'dotenv/config';
import { loadDefenceConfig } from './config';
import { DefenceServer } from './server';

async function main(): Promise<void> {
  const server = new DefenceServer(loadDefenceConfig()); const info = await server.listen();
  console.log('[Defence Copilot] running'); for (const url of info.urls) console.log(`  ${url}`); console.log('  Desktop setup: /admin');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error('[Defence Copilot] startup failed:', error instanceof Error ? error.message : error); process.exitCode = 1; });
