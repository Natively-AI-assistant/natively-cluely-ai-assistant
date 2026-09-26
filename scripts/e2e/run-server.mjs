// scripts/e2e/run-server.mjs
// Resilient launcher for the E2E natively-api backend: forces MiniMax-M3 primary,
// enables local-test auth, binds an isolated port, and AUTO-RESTARTS if the
// server exits (the server has a graceful-shutdown-on-signal path that can be
// tripped during a multi-profile round when Electron instances come and go).
// Fully detached from the parent shell's signals so job-control can't kill it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, '../../natively-api');
const PORT = process.env.E2E_SERVER_PORT || '3111';

let restarts = 0;
function start() {
  const child = spawn('node', ['server.js'], {
    cwd: apiDir,
    env: {
      ...process.env,
      NATIVELY_FORCE_PRIMARY_GEN: 'minimax',
      NATIVELY_LOCAL_TEST_AUTH: '1',
      NATIVELY_LOCAL_TEST_TOKEN: 'local-test-e2e-token',
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      PORT,
    },
    stdio: 'inherit',
    detached: false,
  });
  child.on('exit', (code, sig) => {
    restarts++;
    console.error(`[run-server] server exited code=${code} sig=${sig} — restart #${restarts} in 1s`);
    if (restarts < 200) setTimeout(start, 1000);
    else { console.error('[run-server] too many restarts, giving up'); process.exit(1); }
  });
}
// Ignore the signals that would otherwise be delivered by shell job control when
// sibling processes exit, so the supervisor itself survives the whole round.
process.on('SIGHUP', () => {});
start();
console.log(`[run-server] supervising natively-api on :${PORT} (MiniMax forced, local-test auth)`);
