// intelligence-eval-real-ui/global-setup.ts
// Hard preconditions for the real UI eval. Fails loudly (never fabricates) when
// the key is missing or the app isn't built — exactly as the spec requires.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../');

export default async function globalSetup() {
  const key = process.env.NATIVELY_TEST_API_KEY?.trim();
  if (!key) {
    throw new Error(
      '\n[real-ui-eval] NATIVELY_TEST_API_KEY is not set.\n' +
      'This suite drives the REAL Natively UI + real API and will not run without a key.\n' +
      '  export NATIVELY_TEST_API_KEY="<your-test-key>"\n' +
      '  npm run eval:intelligence:ui\n'
    );
  }
  const mainJs = path.join(ROOT, 'dist-electron/electron/main.js');
  if (!fs.existsSync(mainJs)) {
    throw new Error('[real-ui-eval] dist-electron not built. Run `node scripts/build-electron.js` first.');
  }
  // Ensure result dirs exist.
  for (const d of ['screenshots', 'videos', 'traces', 'network']) {
    fs.mkdirSync(path.join(__dirname, 'results', d), { recursive: true });
  }
  console.log('[real-ui-eval] preconditions OK (key present: natively_sk_****, app built).');
}
