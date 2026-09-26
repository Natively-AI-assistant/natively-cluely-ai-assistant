import { _electron as electron } from '@playwright/test';
const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NATIVELY_E2E:'1', NATIVELY_API_URL:'http://localhost:3000', NODE_ENV:'development', NATIVELY_DEV_BYPASS_SCREEN_TCC:'1', NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test' },
  timeout: 60000,
});
const win = await app.firstWindow({ timeout: 30000 });
await win.waitForLoadState('domcontentloaded').catch(()=>{});

// Invoke IPC through the MAIN process (ipcMain handlers) — stable across renderer nav.
const M = (channel, ...args) => app.evaluate(async ({ ipcMain }, { channel, args }) => {
  // Find the registered handler and call it with a synthetic event.
  const handlers = ipcMain._invokeHandlers || ipcMain._events;
  // Electron stores invoke handlers privately; use a real BrowserWindow webContents to invoke.
  return null;
}, { channel, args });

// Simpler: drive via the renderer bridge but re-acquire the window each call and
// tolerate nav by retry.
const R = async (ch, ...a) => {
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const w = app.windows()[0] || await app.firstWindow();
      return await w.evaluate(async ({ch,a}) => {
        const api = window.electronAPI || window.api;
        return await api.e2eInvoke(ch, ...a);
      }, {ch,a});
    } catch (e) {
      if (attempt===2) throw e;
      await new Promise(r=>setTimeout(r, 1500));
    }
  }
};

console.log('windows at start:', app.windows().length);
console.log('pro:', JSON.stringify(await R('__e2e__:enable-pro')));
const created = await R('__e2e__:noop-create-mode') // placeholder
  .catch(()=>null);
const mk = await (async()=>{
  const w = app.windows()[0];
  return await w.evaluate(async () => {
    const api = window.electronAPI || window.api;
    const c = await api.modesCreate({ name: 'E2E Backend Probe', templateType: 'technical-interview' });
    if (c?.mode?.id){ await api.modesUpdate(c.mode.id, { customContext:'Give concise senior backend answers; lead with the decision then the tradeoff. Under 4 sentences.' }); await api.modesSetActive(c.mode.id);}
    return c?.mode?.id || JSON.stringify(c);
  });
})();
console.log('mode:', mk);
const started = Date.now();
const ans = await R('__e2e__:ask', { question:'Difference between optimistic and pessimistic locking, and when to use each?', timeoutMs: 70000 });
console.log('ASK latency_ms:', Date.now()-started);
console.log('ASK result:', JSON.stringify({ success:ans?.success, discarded:ans?.discarded, timedOut:ans?.timedOut, len:(ans?.answer||'').length, streamedLen:(ans?.streamedTokens||'').length }));
console.log('ANSWER:', (ans?.answer||ans?.streamedTokens||'(none)').slice(0,500));
await app.close();
console.log('CLOSED');
