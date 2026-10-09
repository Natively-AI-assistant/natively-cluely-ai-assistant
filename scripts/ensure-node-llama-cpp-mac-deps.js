#!/usr/bin/env node
/**
 * ensure-node-llama-cpp-mac-deps.js — guarantee BOTH darwin llama.cpp runtimes are
 * installed before a universal macOS pack.
 *
 * node-llama-cpp ships its prebuilt runtime as one optional package per OS and CPU:
 * @node-llama-cpp/mac-arm64-metal for Apple Silicon, @node-llama-cpp/mac-x64 for
 * Intel. mac-x64 declares `cpu: ["x64"]`, so on an Apple-Silicon build host (the
 * release runner, and every developer Mac here) npm never installs it, and
 * electron-builder packs whatever is on disk. The Intel app then ships with no
 * runtime at all.
 *
 * WHAT THAT BREAKS: every GGUF reranker and embedder on every Intel Mac. The
 * workers call getLlama({ build: 'never' }), so there is no compile fallback: the
 * model downloads, and then cannot be activated. Found 2026-10-09 by inspection
 * (node_modules held only mac-arm64-metal and nothing fetched the other), when
 * scripts/verify-packaged-local-assets.mjs gained a runtime check. Not observed
 * on a physical Intel Mac.
 *
 * Deliberately NOT in `postinstall`, unlike the sharp and canvas steps: the Intel
 * runtime is about 29 MB and only a packaged build needs it. It runs in
 * `app:build`, `app:build:signed` and release-macos.yml.
 *
 * Mirrors scripts/ensure-sharp-mac-deps.js and scripts/ensure-napi-canvas-mac-deps.js;
 * the shared logic lives in scripts/lib/ensure-mac-optional-deps.cjs. Windows
 * builds resolve their own runtime through npm and skip this step.
 */

const path = require('node:path');
const { ensureMacOptionalDeps } = require('./lib/ensure-mac-optional-deps.cjs');

ensureMacOptionalDeps({
  label: 'ensure-node-llama-cpp-mac-deps',
  rootDir: path.resolve(__dirname, '..'),
  lockKey: 'node_modules/node-llama-cpp',
  required: ['@node-llama-cpp/mac-arm64-metal', '@node-llama-cpp/mac-x64'],
  tmpPrefix: 'node-llama-cpp-darwin-dep-',
});
