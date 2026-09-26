#!/usr/bin/env node
/**
 * ensure-napi-canvas-mac-deps.js — guarantee BOTH darwin arches of @napi-rs/canvas
 * are installed before a universal macOS pack.
 *
 * @napi-rs/canvas arrives transitively (pdf-parse → pdfjs-dist) and resolves its
 * native binding per arch. npm installs only the HOST arch, so building both mac
 * slices on one machine ships the Intel app without its binding.
 *
 * REAL IMPACT (v2.8.7, found 2026-08-26): the shipped x64 DMG contained only
 * @napi-rs/canvas-darwin-arm64. The app launched fine — canvas is loaded lazily via
 * `await import()` from SafeDocumentTextExtractor — but on every Intel Mac,
 * `require('pdf-parse')` failed with:
 *     Warning: Cannot load "@napi-rs/canvas" package: "Failed to load native binding".
 *     Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.
 *     Error: DOMMatrix is not defined
 * i.e. PDF text extraction was silently broken for all Intel users while arm64 was fine.
 *
 * Mirrors scripts/ensure-sharp-mac-deps.js and scripts/ensure-sqlite-vec.js; the
 * shared logic lives in scripts/lib/ensure-mac-optional-deps.cjs.
 */

const path = require('node:path');
const { ensureMacOptionalDeps } = require('./lib/ensure-mac-optional-deps.cjs');

ensureMacOptionalDeps({
  label: 'ensure-napi-canvas-mac-deps',
  rootDir: path.resolve(__dirname, '..'),
  lockKey: 'node_modules/@napi-rs/canvas',
  required: ['@napi-rs/canvas-darwin-arm64', '@napi-rs/canvas-darwin-x64'],
  tmpPrefix: 'napi-canvas-darwin-dep-',
});
