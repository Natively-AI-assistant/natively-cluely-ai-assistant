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
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
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

  // Copy static assets. popup.html is verbatim; the manifest gets one DEV-ONLY
  // transform: the broad host patterns move from optional to REQUIRED for the
  // unpacked build. Chrome auto-grants required host permissions on an unpacked
  // load (no store review, no per-site prompts), so the desktop Cmd/Ctrl+Shift+Y
  // hotkey captures ANY site out of the box during development. The Web Store
  // package strips these back to loopback-only (scripts/build-store.js), keeping
  // the shipped privacy model: optional grants, per-site or one-click all-sites.
  const DEV_BROAD_HOSTS = ['https://*/*', 'http://*/*'];
  {
    const manifestSrc = path.join(srcDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestSrc, 'utf8'));
    manifest.host_permissions = [
      ...(manifest.host_permissions ?? []),
      ...DEV_BROAD_HOSTS.filter((h) => !(manifest.host_permissions ?? []).includes(h)),
    ];
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  await cp(path.join(srcDir, 'popup.html'), path.join(outDir, 'popup.html'));

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
