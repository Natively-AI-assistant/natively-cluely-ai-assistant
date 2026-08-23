import { _electron as electron } from '@playwright/test';
const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: {
    ...process.env,
    NATIVELY_E2E: '1',
    NATIVELY_API_URL: 'http://localhost:3000',
    NODE_ENV: 'development',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  },
  timeout: 60000,
});
console.log('APP LAUNCHED');
const win = await app.firstWindow({ timeout: 30000 });
console.log('FIRST WINDOW title:', await win.title().catch(()=>'(no title)'));
const evalOk = await app.evaluate(async () => 'main-evaluate-ok').catch(e => 'evaluate-failed: ' + e.message);
console.log('MAIN EVAL:', evalOk);
// exercise an E2E IPC through the renderer bridge
const proRes = await win.evaluate(async () => {
  const api = (window).electronAPI || (window).api;
  if (!api?.e2eInvoke) return 'no-e2eInvoke-bridge';
  try { return await api.e2eInvoke('__e2e__:enable-pro'); } catch(e){ return 'invoke-failed:'+e.message; }
}).catch(e => 'renderer-eval-failed: ' + e.message);
console.log('E2E enable-pro:', JSON.stringify(proRes));
await app.close();
console.log('CLOSED CLEANLY');
