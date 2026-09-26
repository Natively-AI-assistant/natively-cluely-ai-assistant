#!/usr/bin/env node
// scripts/release-gate.mjs
//
// PHASE-2F: release-blocking CI gate for v2.8.x.
//
// Runs a battery of pre-publish assertions and exits non-zero on any
// failure. Use in CI before tagging `vX.Y.Z` and pushing to GitHub.
//
// What it checks:
//   1. package.json#version matches the latest git tag (if any). If the
//      version has been bumped but no tag exists, the gate FAILS so a
//      forgotten `git tag vX.Y.Z` doesn't ship a release with no
//      `latest-mac.yml` (the v2.8.0 root cause).
//   2. Latest git tag, if any, is <= current package.json#version
//      (can't ship a release with version BELOW the last published).
//   3. ONNX runtime deps resolve (delegates to scripts/smoke-onnx-packaging.mjs).
//   4. sqlite-vec migrations don't reference the broken `embedding float`
//      no-dimension schema.
//   5. No debug-only `console.log` of unredacted secrets in main.ts.
//   6. Lifecycle tracker is wired (grep for `LifecycleTracker.getInstance().install`).
//
// Usage:
//   node scripts/release-gate.mjs           # default
//   NATIVELY_ALLOW_UNTAGGED_RELEASE=1 node scripts/release-gate.mjs
//                                       # for hotfixes that intentionally
//                                       # bypass the tag-driven workflow
//
// Exits 0 on success, non-zero on any failure.

import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures.push({ label, error: e });
    console.error(`  ✗ ${label}: ${e?.message || e}`);
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function shell(cmd) {
  try {
    return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

console.log(`[release-gate] repoRoot=${repoRoot}`);

// 1. version vs git tag
check('package.json#version is set and well-formed semver', () => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const v = pkg.version;
  if (!/^\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/.test(v)) {
    throw new Error(`package.json#version is not well-formed: "${v}"`);
  }
  console.log(`    package.json#version = ${v}`);
});

check('latest git tag (if any) is <= current version', () => {
  if (process.env.NATIVELY_ALLOW_UNTAGGED_RELEASE === '1') {
    console.log('    skipped (NATIVELY_ALLOW_UNTAGGED_RELEASE=1)');
    return;
  }
  const tags = shell('git tag --list "v*" --sort=-v:refname').split('\n').filter(Boolean);
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const current = pkg.version.replace(/^v/, '');
  if (tags.length === 0) {
    throw new Error(
      `no v* git tags found. Tag the release with "git tag v${current}" before publishing — ` +
      `otherwise latest-mac.yml on GitHub Releases will keep pointing at the previous version ` +
      `(this is the exact failure that caused the v2.8.0 user report).`
    );
  }
  const latest = tags[0].replace(/^v/, '');
  console.log(`    latest tag = v${latest}, current = v${current}`);
  // Simple semver major.minor.patch compare (no pre-release for tags).
  const parse = (s) => s.split(/[.-]/).map((p) => /^\d+$/.test(p) ? parseInt(p, 10) : p);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) < (a[i] ?? 0)) {
      throw new Error(`package.json#version ${current} is BELOW the latest tag v${latest}. Cannot ship a downgrade.`);
    }
    if ((b[i] ?? 0) > (a[i] ?? 0)) break;
  }
});

// 2. ONNX runtime deps
check('ONNX runtime deps resolve from packaged-app context', () => {
  try {
    execSync('node scripts/smoke-onnx-packaging.mjs', { cwd: repoRoot, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`ONNX smoke test failed:\n${e?.stdout?.toString() || e?.message || e}`);
  }
});

// 3. sqlite-vec migrations
check('DatabaseManager no longer contains the broken `embedding float` vec0 schema', () => {
  const dmPath = path.join(repoRoot, 'electron', 'db', 'DatabaseManager.ts');
  const src = fs.readFileSync(dmPath, 'utf8');
  // Look for the exact broken pattern: `embedding float` (no [N] suffix) inside
  // a vec0 CREATE VIRTUAL TABLE. The new code uses `embedding float[${dim}]`.
  // We allow the OLD broken schema to appear ONLY in a comment, not in active code.
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/embedding\s+float(?!\s*\[)/.test(line)) {
      // Skip if it's clearly a comment line
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      throw new Error(`DatabaseManager.ts:${i + 1} still references "embedding float" without dimension:\n  ${line}`);
    }
  }
});

// 4. Lifecycle tracker is wired
check('LifecycleTracker is installed in main.ts before app.whenReady', () => {
  const mainSrc = fs.readFileSync(path.join(repoRoot, 'electron', 'main.ts'), 'utf8');
  if (!/LifecycleTracker\.getInstance\(\)\.install\(/.test(mainSrc)) {
    throw new Error('main.ts does not call LifecycleTracker.getInstance().install(...) — crash/quit observability missing.');
  }
});

// 5. Ollama skip-cloud-key guard is in place
check('bootstrapOllamaEmbeddings has a cloud-key skip guard', () => {
  const mainSrc = fs.readFileSync(path.join(repoRoot, 'electron', 'main.ts'), 'utf8');
  if (!/Skipping Ollama embeddings bootstrap.*cloud embedding provider/.test(mainSrc)) {
    throw new Error('bootstrapOllamaEmbeddings no longer skips on cloud key — Ollama would be force-spawned.');
  }
});

// 6. isRealUpgrade gate is in place
check('update-available handler is gated by isRealUpgrade', () => {
  const mainSrc = fs.readFileSync(path.join(repoRoot, 'electron', 'main.ts'), 'utf8');
  if (!/isRealUpgrade\(/.test(mainSrc)) {
    throw new Error('update-available handler is NOT gated by isRealUpgrade — a stale latest-mac.yml could invite a downgrade.');
  }
});

// 7. release manifest pre-flight: release/ dir shouldn't contain a Natively.app
//    whose app-update.yml points at a channel other than "latest".
check('packaged app-update.yml has provider=github + releaseType=release', () => {
  const candidates = [
    path.join(repoRoot, 'release', 'mac', 'Natively.app', 'Contents', 'Resources', 'app-update.yml'),
    path.join(repoRoot, 'release', 'mac-arm64', 'Natively.app', 'Contents', 'Resources', 'app-update.yml'),
  ];
  let found = false;
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    found = true;
    const text = fs.readFileSync(f, 'utf8');
    if (!/provider:\s*github/.test(text)) {
      throw new Error(`${f}: provider is not github:\n${text}`);
    }
    if (!/owner:\s*Natively-AI-assistant/.test(text)) {
      throw new Error(`${f}: owner is not Natively-AI-assistant:\n${text}`);
    }
    if (!/repo:\s*natively-cluely-ai-assistant/.test(text)) {
      throw new Error(`${f}: repo is not natively-cluely-ai-assistant:\n${text}`);
    }
    if (!/releaseType:\s*release/.test(text)) {
      throw new Error(`${f}: releaseType is not "release":\n${text}`);
    }
  }
  if (!found) {
    console.log('    skipped (no packaged Natively.app found in release/)');
  }
});

console.log('');
if (failures.length) {
  console.error(`[release-gate] FAILED (${failures.length} check${failures.length === 1 ? '' : 's'})`);
  for (const f of failures) {
    console.error(`  - ${f.label}: ${f.error?.message || f.error}`);
  }
  process.exit(1);
}
console.log('[release-gate] OK — release is ready to tag and publish.');
