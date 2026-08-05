// OSS / skip-premium gate: original suite lives in DeterministicTimelineMath2026_07_05.premium-impl.mjs.
// Loads only when private premium build output exists under dist-electron/premium.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let root = __dirname;
for (let i = 0; i < 12; i++) {
  if (fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, 'electron'))) break;
  root = path.dirname(root);
}
const premiumDist = path.join(root, 'dist-electron', 'premium');
if (!fs.existsSync(premiumDist)) {
  test('skipped — dist-electron/premium absent (OSS / skip-premium)', { skip: true }, () => {});
} else {
  await import(pathToFileURL(path.join(__dirname, 'DeterministicTimelineMath2026_07_05.premium-impl.mjs')).href);
}
