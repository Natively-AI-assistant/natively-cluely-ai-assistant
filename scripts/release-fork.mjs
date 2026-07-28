#!/usr/bin/env node
/**
 * Publish a fork release to bhargavap21/natively-cluely-ai-assistant.
 *
 * Expects artifacts from `npm run app:build:fork` in release/ (or dist/).
 *
 * Usage:
 *   npm run release:fork
 *   NATIVELY_SKIP_FORK_RELEASE=1 npm run release:fork   # dry-run: list files only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const OWNER = 'bhargavap21';
const REPO = 'natively-cluely-ai-assistant';

function fail(msg, code = 1) {
  console.error(`[release-fork] ${msg}`);
  process.exit(code);
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (!pkg.version) fail('package.json missing version');
  return String(pkg.version);
}

function findArtifacts() {
  const dirs = [path.join(repoRoot, 'release'), path.join(repoRoot, 'dist')];
  const patterns = [/\.dmg$/i, /\.zip$/i, /latest-mac\.yml$/i, /\.blockmap$/i];
  const found = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (patterns.some((re) => re.test(name))) {
        found.push(path.join(dir, name));
      }
    }
  }
  // Prefer release/ over dist/ duplicates by basename
  const byBase = new Map();
  for (const file of found) {
    byBase.set(path.basename(file), file);
  }
  return [...byBase.values()].sort();
}

function main() {
  const version = readVersion();
  const tag = `v${version}`;
  const artifacts = findArtifacts();
  if (!artifacts.length) {
    fail('No .dmg/.zip artifacts found in release/ or dist/. Run `npm run app:build:fork` first.');
  }

  console.log(`[release-fork] version ${version} → ${OWNER}/${REPO} tag ${tag}`);
  for (const f of artifacts) {
    const mb = (fs.statSync(f).size / (1024 * 1024)).toFixed(1);
    console.log(`  - ${path.basename(f)} (${mb} MB)`);
  }

  if (process.env.NATIVELY_SKIP_FORK_RELEASE === '1') {
    console.log('[release-fork] NATIVELY_SKIP_FORK_RELEASE=1 — not uploading');
    return;
  }

  const title = `Natively ${version} (fork)`;
  const notes = [
    `Fork release for collaborators on \`${OWNER}/${REPO}\`.`,
    '',
    '## Install (macOS Apple Silicon)',
    '1. Download **`Natively-*-arm64.dmg`** (Apple Silicon) or **`Natively-*.dmg`** (Intel)',
    '2. Open the DMG and drag **Natively** into Applications',
    '3. **First launch:** Finder → Applications → right-click **Natively** → **Open** → Open',
    '   (Gatekeeper blocks double-click on unsigned collaborator builds.)',
    '',
    'If you still see “can’t be opened”, clear quarantine in Terminal:',
    '```',
    'xattr -cr /Applications/Natively.app',
    'open /Applications/Natively.app',
    '```',
    '',
    'Auto-update checks this fork\'s GitHub Releases.',
  ].join('\n');

  // Create or reuse draftless release, then upload assets.
  try {
    execFileSync(
      'gh',
      [
        'release',
        'view',
        tag,
        '--repo',
        `${OWNER}/${REPO}`,
      ],
      { stdio: 'pipe' },
    );
    console.log(`[release-fork] release ${tag} already exists — uploading/replacing assets`);
  } catch {
    execFileSync(
      'gh',
      [
        'release',
        'create',
        tag,
        ...artifacts,
        '--repo',
        `${OWNER}/${REPO}`,
        '--title',
        title,
        '--notes',
        notes,
      ],
      { stdio: 'inherit', cwd: repoRoot },
    );
    console.log(`[release-fork] created https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
    return;
  }

  execFileSync(
    'gh',
    [
      'release',
      'upload',
      tag,
      ...artifacts,
      '--repo',
      `${OWNER}/${REPO}`,
      '--clobber',
    ],
    { stdio: 'inherit', cwd: repoRoot },
  );
  console.log(`[release-fork] updated https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
}

main();
