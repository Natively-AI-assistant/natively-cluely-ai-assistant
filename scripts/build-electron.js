#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-electron');

const entryPoints = [];

// Function to recursively find all .ts files in a directory
const findTs = (dir) => {
  const results = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) results.push(...findTs(full));
    else if (f.name.endsWith('.ts') && !f.name.endsWith('.d.ts')) results.push(full);
  }
  return results;
};

const electronDir = path.resolve(rootDir, 'electron');
if (fs.existsSync(electronDir)) {
  entryPoints.push(...findTs(electronDir).map(f => path.relative(rootDir, f)));
}

// Also include premium electron files if they exist
const premiumDir = path.resolve(rootDir, 'premium/electron');
if (fs.existsSync(premiumDir)) {
  entryPoints.push(...findTs(premiumDir).map(f => path.relative(rootDir, f)));
}

const start = Date.now();

build({
  entryPoints,
  bundle: true,           // resolve all static + dynamic imports so postProcessor
                         // is inlined and the path rewrite works (vs bundle:false
                         // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir,       // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs',          // Electron loads package.json main as CommonJS in this repo
                          // (package.json has no "type": "module").
  external: [
    'electron',
    'better-sqlite3',
    'keytar',
    'sqlite-vec',
    '@vectorize-io/hindsight-client',
    // Heavy native ESM modules with `import.meta.url`-dependent init. Keeping
    // them external lets Node's loader give them a real `import.meta.url`,
    // which the bundled version can't (esbuild's CJS target sets
    // `import_meta = {}`). pdfjs-dist's legacy build runs a canvas/DOMMatrix
    // polyfill block at module-init that uses
    // `createRequire(import.meta.url)` to load `@napi-rs/canvas`; the
    // bundled version breaks this and `new DOMMatrix()` then throws
    // "DOMMatrix is not a constructor" at line 15620 (`const SCALE_MATRIX
    // = new DOMMatrix();`). The bundling also breaks pdf-parse@2.x's
    // fake-worker bootstrap (workerSrc resolves to a non-existent
    // dist-electron/electron/pdf.worker.mjs). Externalizing keeps them
    // loadable from node_modules at runtime, where the real polyfill chain
    // works and our pinPdfjsWorkerSrcOnce() helper can resolve the real
    // worker file.
    'pdfjs-dist',
    'pdf-parse',
    'mammoth',
  ],
  sourcemap: true,
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  // EVAL-ONLY DNS fix, injected at the very top of every output bundle (runs
  // BEFORE esbuild's deferred __esm module initializers — a top-level statement
  // inside main.ts gets wrapped in a lazy init that never ran at process start).
  // Under the real-UI eval's rapid app-relaunch load, macOS getaddrinfo returns
  // spurious ENOTFOUND for api.natively.software (a Railway CNAME), failing the
  // app's fetch() to /v1/pro/verify and /v1/chat and corrupting the eval — even
  // though `dig`/dns.resolve4 resolve it fine. We reroute dns.lookup for that one
  // host to dns.resolve4 (direct DNS query, no getaddrinfo cache). Gated on
  // NATIVELY_UI_EVAL='1' and idempotent (__nativelyDnsPinned guard), so it is a
  // strict no-op in production and across the multiple bundles that carry it.
  banner: {
    js: `try{if(process.env.NATIVELY_UI_EVAL==='1'&&!globalThis.__nativelyDnsPinned){globalThis.__nativelyDnsPinned=1;var __dns=require('dns');var __ol=__dns.lookup.bind(__dns);__dns.lookup=function(h,o,cb){if(typeof o==='function'){cb=o;o={};}if(h==='api.natively.software'){return __dns.resolve4(h,function(e,a){if(e||!a||!a.length)return __ol(h,o,cb);if(o&&o.all)return cb(null,[{address:a[0],family:4}]);return cb(null,a[0],4);});}return __ol(h,o,cb);};console.log('[eval] dns.lookup→resolve4 pinned for api.natively.software');}}catch(__e){try{console.warn('[eval] dns pin banner failed:',__e&&__e.message);}catch(_){}}`,
  },
  logLevel: 'warning',
}).then(() => {
  console.log(`[build-electron] Done in ${Date.now() - start}ms`);
}).catch((err) => {
  console.error('[build-electron] Build failed:', err.message);
  process.exit(1);
});
