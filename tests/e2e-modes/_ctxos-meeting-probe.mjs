// Context OS FINAL VERIFICATION — Meeting/transcript mode through the REAL app.
// Seeds a meeting transcript via priorTurns, asks meeting questions. Verifies:
// current-meeting facts (Atlas/AWS/auth-migration), NO résumé/document leak, and
// NO cross-meeting leak (Orion/Azure must not appear). Uses a general mode +
// injected transcript so the WTA transcript path is exercised.

import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS: '1', NATIVELY_CONTEXT_OS_WTA: '1', NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1',
  NATIVELY_INTELLIGENCE_TRACE: '1', OLLAMA_URL: 'http://127.0.0.1:1',
};

const MEETING = [
  { speaker: 'interviewer', text: 'We are discussing Project Atlas.' },
  { speaker: 'user', text: 'The release deadline is September 30.' },
  { speaker: 'interviewer', text: 'We decided to deploy on AWS.' },
  { speaker: 'user', text: 'The current blocker is the authentication migration.' },
  { speaker: 'interviewer', text: 'The previous Project Orion meeting used Azure.' },
];

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});
const modeId = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'Meeting Verif', templateType: 'general' });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
});

const ask = async (q) => {
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000, priorTurns: MEETING });
  return (ans?.answer || ans?.streamedTokens || '');
};

const deadline = await ask('What is the release deadline?');
const cloud = await ask('Which cloud provider did we select?');
const blocker = await ask('What is the current blocker?');

const verdict = {
  deadline: { preview: deadline.slice(0, 140), says_sept30: /september 30|sept.*30|9\/30/i.test(deadline), leaks_profile: /natively|typescript|electron/i.test(deadline) },
  cloud: { preview: cloud.slice(0, 140), says_aws: /\baws\b|amazon web/i.test(cloud), leaks_azure: /azure/i.test(cloud), leaks_orion: /orion/i.test(cloud) },
  blocker: { preview: blocker.slice(0, 140), says_auth: /authentication|auth migration/i.test(blocker), leaks_profile: /natively|kubernetes/i.test(blocker) },
};
console.log('CTXOS_MEETING_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('CTXOS_MEETING_END');
await app.close().catch(() => {});
console.log('CLOSED');
