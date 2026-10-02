#!/usr/bin/env node
// Renders packaging/homebrew/Casks/natively.rb from a published GitHub Release.
//
//   node scripts/render-homebrew-cask.mjs                    # latest release
//   node scripts/render-homebrew-cask.mjs --tag V2.9.0       # a specific tag
//   node scripts/render-homebrew-cask.mjs --check            # verify, write nothing
//
// The cask pins a sha256 per architecture, so it MUST be regenerated from the
// real release assets every time a version ships — a stale hash makes
// `brew install --cask natively` fail with a checksum mismatch. The DMGs are
// ~1 GB each and are streamed through the hash, never written to disk.
//
// WHY A SCRIPT AND NOT A HAND-EDITED .rb: the checked-in cask is this script's
// output. CI (.github/workflows/homebrew-cask-sync.yml) runs the same command,
// so the file a human regenerates locally and the file CI publishes to the tap
// are produced by one code path. Run with --check to prove the committed cask
// still matches its release.
//
// Cross-platform: pure Node (global fetch + node:crypto). No shell, no `gh`,
// no Homebrew — it runs identically on macOS, Windows and Linux CI. The cask it
// produces is macOS-only; generating it is not.
//
// See docs/homebrew-cask.md for the publish steps.

import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, createRequire } from 'node:url';

// The on-disk app identity + DMG file name are disguised at build time
// (productName, sourced from scripts/disguise-name.cjs). The cask's public
// `name` stays "Natively" (the brand), but the `app` bundle and the DMG asset
// name must match the disguised on-disk identity.
const require = createRequire(import.meta.url);
const APP_NAME = require('./disguise-name.cjs').darwin;

const REPO = 'Natively-AI-assistant/natively-cluely-ai-assistant';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASK_PATH = path.join(REPO_ROOT, 'packaging', 'homebrew', 'Casks', 'natively.rb');

// Minimum macOS the shipped app supports. Kept in step with the README's
// "Requires macOS 12+" line; Apple Speech needs macOS 26 but is optional, so it
// is NOT the floor.
const MIN_MACOS = 'monterey';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
const CHECK_ONLY = process.argv.includes('--check');

function ghHeaders() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'natively-cask-renderer' };
  // Optional: lifts the 60/hr unauthenticated rate limit in CI.
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function fetchRelease(tag) {
  const url = tag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

async function sha256OfUrl(url) {
  const res = await fetch(url, { headers: { ...ghHeaders(), accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Download ${res.status} for ${url}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes === 0) throw new Error(`Empty download for ${url}`);
  return { sha256: hash.digest('hex'), bytes };
}

// The release ships two DMGs whose names differ only by the arm64 infix:
//   Natively-<version>-arm64.dmg   (Apple Silicon)
//   Natively-<version>.dmg         (Intel)
// That is exactly the shape a cask `arch` stanza interpolates. The cask declares
// only `arch arm: "-arm64"` — an unset intel arch interpolates to the empty
// string, which is the Intel asset's name, and rubocop's
// Cask/EmptyConditionalArgument rejects spelling `intel: ""` out.
const ARCHES = [
  { key: 'arm', suffix: '-arm64' },
  { key: 'intel', suffix: '' },
];

function renderCask({ tag, version, sha }) {
  return `cask "natively" do
  arch arm: "-arm64"

  version "${version}"
  sha256 arm:   "${sha.arm}",
         intel: "${sha.intel}"

  url "https://github.com/${REPO}/releases/download/${tag.replace(version, '#{version}')}/${APP_NAME}-#{version}#{arch}.dmg",
      verified: "github.com/${REPO}/"
  name "Natively"
  desc "AI meeting assistant, interview copilot, and note taker"
  homepage "https://natively.software/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :${MIN_MACOS}

  app "${APP_NAME}.app"

  # Paths are derived from package.json "name" (natively), NOT the "Natively"
  # product name, because that is what Electron's app.getName() returns and
  # therefore what app.getPath('userData'|'logs'|'cache') resolves to. The
  # preference domain uses build.appId instead. Verified against a real install.
  zap trash: [
    "~/Library/Application Support/natively",
    "~/Library/Caches/natively",
    "~/Library/Caches/natively-updater",
    "~/Library/Logs/natively",
    "~/Library/Preferences/com.apple.corespeechd.plist",
    "~/Library/Saved Application State/com.apple.corespeechd.savedState",
    # Legacy bundle id (pre-corespeechd rename) — clean up upgrades from old releases.
    "~/Library/Preferences/com.electron.meeting-notes.plist",
    "~/Library/Saved Application State/com.electron.meeting-notes.savedState",
  ]
end
`;
}

async function main() {
  const release = await fetchRelease(arg('--tag'));
  const tag = release.tag_name;
  // Tags have shipped as both "v2.8.1" and "V2.8.8"; the version is the numeric
  // part either way. The url stanza keeps whatever case the tag actually used —
  // see docs/homebrew-cask.md, the download path is case-sensitive.
  const version = tag.replace(/^[vV]/, '');
  if (!/^\d+(\.\d+)+$/.test(version)) {
    throw new Error(`Tag ${tag} does not parse to a numeric version (got "${version}")`);
  }

  const sha = {};
  for (const { key, suffix } of ARCHES) {
    const name = `${APP_NAME}-${version}${suffix}.dmg`;
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) {
      throw new Error(
        `Release ${tag} has no asset named ${name}. Assets: ${release.assets.map((a) => a.name).join(', ') || '(none)'}`,
      );
    }
    process.stderr.write(`hashing ${name} (${(asset.size / 1e9).toFixed(2)} GB)... `);
    const { sha256 } = await sha256OfUrl(asset.browser_download_url);
    process.stderr.write(`${sha256}\n`);
    sha[key] = sha256;
  }

  const rendered = renderCask({ tag, version, sha });

  if (CHECK_ONLY) {
    if (!existsSync(CASK_PATH)) throw new Error(`--check: ${CASK_PATH} does not exist`);
    const current = readFileSync(CASK_PATH, 'utf8');
    if (current !== rendered) {
      process.stderr.write(`\nCask is STALE against release ${tag}.\nRegenerate: node scripts/render-homebrew-cask.mjs --tag ${tag}\n`);
      process.exit(1);
    }
    process.stderr.write(`\nCask matches release ${tag}.\n`);
    return;
  }

  writeFileSync(CASK_PATH, rendered);
  process.stderr.write(`\nWrote ${path.relative(REPO_ROOT, CASK_PATH)} for ${tag}.\n`);
}

main().catch((err) => {
  process.stderr.write(`\nrender-homebrew-cask: ${err.message}\n`);
  process.exit(1);
});
