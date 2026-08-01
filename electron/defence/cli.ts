import 'dotenv/config';
import { loadDefenceConfig } from './config';
import { createDefenceRuntime, DefenceServer } from './server';

async function main(): Promise<void> {
  const config = loadDefenceConfig(); const runtime = createDefenceRuntime(); const adminConfig = config.publicMode === 'companion-only' ? { ...config, host: '127.0.0.1' } : config; const admin = new DefenceServer(adminConfig, 'full', runtime); const adminInfo = await admin.listen();
  const servers = [admin];
  console.log('[Defence Copilot] admin running'); for (const url of adminInfo.urls) console.log(`  ${url}/admin`);
  if (config.publicMode === 'companion-only') {
    const companionConfig = { ...config, host: config.companionHost, port: config.companionPort };
    const companion = new DefenceServer(companionConfig, 'companion', runtime); const companionInfo = await companion.listen(); servers.push(companion);
    console.log('[Defence Copilot] companion-only running'); for (const url of companionInfo.urls) console.log(`  ${url}`);
  } else console.log('  Companion: /');
  const stop = async () => { await Promise.all(servers.map(server => server.close())); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error('[Defence Copilot] startup failed:', error instanceof Error ? error.message : error); process.exitCode = 1; });
