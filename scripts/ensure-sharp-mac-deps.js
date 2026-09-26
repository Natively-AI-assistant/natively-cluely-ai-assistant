#!/usr/bin/env node
/**
 * ensure-sharp-mac-deps.js — guarantee BOTH darwin arches of sharp (and its libvips
 * side-packages) are installed before a universal macOS pack.
 *
 * npm installs only the HOST arch's optional dependency, so building both mac slices
 * on one machine would otherwise ship the other slice without its native binding.
 *
 * The shared logic lives in scripts/lib/ensure-mac-optional-deps.cjs — the same core
 * backs scripts/ensure-napi-canvas-mac-deps.js, which exists because this exact class
 * of gap shipped an Intel build with no @napi-rs/canvas binding in v2.8.7.
 */

const path = require('node:path');
const { ensureMacOptionalDeps } = require('./lib/ensure-mac-optional-deps.cjs');

ensureMacOptionalDeps({
  label: 'ensure-sharp-mac-deps',
  rootDir: path.resolve(__dirname, '..'),
  lockKey: 'node_modules/sharp',
  required: [
    '@img/sharp-darwin-arm64',
    '@img/sharp-libvips-darwin-arm64',
    '@img/sharp-darwin-x64',
    '@img/sharp-libvips-darwin-x64',
  ],
  tmpPrefix: 'sharp-darwin-dep-',
});
