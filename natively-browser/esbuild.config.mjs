#!/usr/bin/env node
/**
 * esbuild bundler for the Natively companion browser extension (MV3).
 *
 * Mirrors the repo's electron toolchain (scripts/build-electron.js): plain
 * esbuild, transpile + bundle, no webpack/vite. Each MV3 surface is its own
 * entry point because Chrome loads them independently:
 *   - service-worker.ts  → background service worker (module)
 *   - content-script.ts  → injected into the page via chrome.scripting
 *   - popup.ts           → the action popup script
 *
 * @mozilla/readability (MIT, AGPL-compatible) is bundled into content-script.
 * Static assets (manifest.json, popup.html, icons) are copied verbatim to dist/.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(rootDir, 'src');
const outDir = path.join(rootDir, 'dist');

const entryPoints = [
  path.join(srcDir, 'service-worker.ts'),
  path.join(srcDir, 'content-script.ts'),
  path.join(srcDir, 'popup.ts'),
];

async function run() {
  const start = Date.now();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints,
    bundle: true,
    outdir: outDir,
    platform: 'browser',
    target: 'chrome114',
    format: 'esm',
    sourcemap: true,
    legalComments: 'linked', // keep MIT/Readability license attributions
    loader: { '.ts': 'ts' },
    logLevel: 'warning',
  });

  // Copy static assets verbatim.
  for (const asset of ['manifest.json', 'popup.html']) {
    await cp(path.join(srcDir, asset), path.join(outDir, asset)).catch(async () => {
      // manifest lives at package root, popup.html in src — try root fallback.
      const alt = path.join(rootDir, asset);
      if (existsSync(alt)) await cp(alt, path.join(outDir, asset));
    });
  }

  // Icons directory is optional.
  const iconsDir = path.join(rootDir, 'icons');
  if (existsSync(iconsDir)) {
    await cp(iconsDir, path.join(outDir, 'icons'), { recursive: true });
  }

  console.log(`[build] extension bundled to dist/ in ${Date.now() - start}ms`);
}

run().catch((err) => {
  console.error('[build] failed:', err.message);
  process.exit(1);
});
