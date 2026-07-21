#!/usr/bin/env node
/**
 * Compiles the pure, unit-testable modules (extract.ts, the pure functions in
 * service-worker.ts) to ESM in dist-test/ so the `.test.mjs` suites can import
 * them with `node --test` — matching the main repo's "import compiled JS from a
 * dist dir" test convention.
 *
 * Readability is marked external here so we never pull the 80k browser bundle
 * into Node tests; the extract tests inject a fake Readability factory instead.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [
    path.join(rootDir, 'src', 'extract.ts'),
    path.join(rootDir, 'src', 'service-worker.ts'),
    // Smart Browser Context v2 pure modules (registry + classifier + extractors).
    path.join(rootDir, 'src', 'capture', 'registry', 'registry.ts'),
    path.join(rootDir, 'src', 'capture', 'classifier', 'signal-scorer.ts'),
    path.join(rootDir, 'src', 'capture', 'classifier', 'sensitive-page-detector.ts'),
    path.join(rootDir, 'src', 'capture', 'classifier', 'tab-classifier.ts'),
    path.join(rootDir, 'src', 'capture', 'permissions.ts'),
    path.join(rootDir, 'src', 'capture', 'extractors', 'index.ts'),
    path.join(rootDir, 'src', 'capture', 'smart-capture.ts'),
    path.join(rootDir, 'src', 'capture', 'page-signals.ts'),
  ],
  bundle: true,
  outdir: path.join(rootDir, 'dist-test'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // service-worker.ts references chrome.* at module top-level only inside event
  // handlers (not executed on import), and bundling keeps its pure exports usable.
  external: ['@mozilla/readability'],
  logLevel: 'warning',
});

console.log('[build-test] pure modules compiled to dist-test/');
