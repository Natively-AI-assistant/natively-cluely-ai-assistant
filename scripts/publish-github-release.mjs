#!/usr/bin/env node
// scripts/publish-github-release.mjs
//
// Publish (or audit, or repair) the auto-update payload of a GitHub release so
// electron-updater can do DIFFERENTIAL downloads instead of re-fetching ~1 GB.
//
// WHY THIS EXISTS (2026-09-22):
//   Measured on a 100 Mbps plan: the V2.8.8 updater ZIP (988 MB) downloads at
//   ~5.5 MB/s through Electron's net stack, so every update is a ~3-minute full
//   download. electron-builder already emits `<artifact>.blockmap` next to every
//   updater artifact, and electron-updater already tries a differential download
//   first — but the GitHub release is assembled by hand and V2.8.8 shipped with NO
//   .blockmap assets, so every client silently fell back to the full file.
//
// HOW electron-updater USES BLOCKMAPS (electron-updater 6.8.x, verified in source):
//   - It fetches `<new file url>.blockmap` from the NEW release, and the OLD
//     blockmap from a URL derived by replacing every occurrence of the new version
//     with the old version in the new file's URL path — and that path includes the
//     release TAG. So the new tag must turn into the old tag by that substitution:
//     V2.8.8 -> V2.9.0 works, v2.9.0 -> V2.8.8 does NOT (GitHub tags are
//     case-sensitive: /download/v2.8.8/ is a 404). A 404 is not an error the user
//     sees — it is a silent full download. `checkTagDerivation` enforces this.
//   - Blockmaps are resolved by URL convention; they are NOT listed in latest*.yml.
//     Never hand-edit the manifest to add them.
//   - macOS: diffs against the `update.zip` the updater cached after its PREVIOUS
//     completed download, so the first in-app update after a DMG install is always
//     full. Windows: the NSIS installer copies itself into the updater cache at
//     install time, so Windows can diff from the first update onward.
//
// MODES
//   publish (default)  Upload the updater set from release/ to an EXISTING release:
//                      every file in the manifest + its .blockmap (+ the macOS DMGs),
//                      with latest*.yml uploaded LAST so a client never reads a
//                      manifest that points at files not uploaded yet.
//   --verify-remote    Audit a published release: manifest files, blockmaps, sizes,
//                      and whether the previous release's blockmaps are reachable.
//   --backfill         Generate + upload blockmaps for a release that shipped
//                      without them (downloads each updater file, ~1 GB each).
//
// USAGE
//   node scripts/publish-github-release.mjs --platform mac --dry-run
//   node scripts/publish-github-release.mjs --platform win --tag V2.9.0
//   node scripts/publish-github-release.mjs --platform mac --verify-remote --tag V2.9.0
//   node scripts/publish-github-release.mjs --platform win --backfill --tag V2.8.8
//
// --platform is REQUIRED (mac|win): the Windows set is built on a Windows machine
// and the macOS set on a Mac, and each is uploaded from where it was built. There
// is deliberately no default from process.platform.
//
// Pure Node + the `gh` CLI (spawned with an argument array, no shell), so it runs
// the same on macOS and Windows.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── pure helpers (unit-tested in scripts/__tests__/publish-github-release.test.mjs) ──

/** Normalise the --platform flag. Exhaustive: anything else is an error, never a guess. */
export function normalizePlatform(value) {
  switch (value) {
    case 'mac':
    case 'darwin':
      return 'darwin';
    case 'win':
    case 'win32':
      return 'win32';
    default:
      throw new Error(`--platform must be "mac" or "win" (got ${JSON.stringify(value)})`);
  }
}

/** The channel manifest electron-updater reads for the `latest` channel. */
export function manifestName(platform) {
  switch (platform) {
    case 'darwin':
      return 'latest-mac.yml';
    case 'win32':
      return 'latest.yml'; // Windows uses the channel name with no platform suffix
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export const blockmapName = (file) => `${file}.blockmap`;

/** `files:` entries of a latest*.yml, in order. */
export function parseManifestFiles(text) {
  const out = [];
  const re = /- url: (\S+)\s*\n\s*sha512: (\S+)\s*\n\s*size: (\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ url: m[1], sha512: m[2], size: Number(m[3]) });
  return out;
}

export function parseManifestVersion(text) {
  const m = /^version: (\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** Installers that are NOT in the manifest but belong on the release page. */
export function extraInstallerNames(platform, productName, version) {
  switch (platform) {
    case 'darwin':
      return [`${productName}-${version}.dmg`, `${productName}-${version}-arm64.dmg`];
    case 'win32':
      return []; // the NSIS installer IS the updater file, so it is already in latest.yml
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Mirror of electron-updater's Provider.getBlockMapFiles old-URL derivation:
 * replace every occurrence of the new version in the path with the old version.
 */
export function deriveOldPath(newPath, newVersion, oldVersion) {
  return newPath.split(newVersion).join(oldVersion);
}

/**
 * Would a client on `oldTag`/`oldVersion` find the old blockmap when updating to
 * `newTag`/`newVersion`? Only if the derived tag IS the old tag.
 */
export function checkTagDerivation({ newTag, newVersion, oldTag, oldVersion }) {
  const derivedTag = deriveOldPath(newTag, newVersion, oldVersion);
  return { ok: derivedTag === oldTag, derivedTag };
}

/** Sum of a blockmap's chunk sizes === the byte length of the file it describes. */
export function blockmapCoveredSize(gzippedBuffer) {
  const json = JSON.parse(zlib.gunzipSync(gzippedBuffer).toString('utf8'));
  if (!json || !Array.isArray(json.files)) throw new Error('not a blockmap (no files[])');
  let total = 0;
  for (const f of json.files) for (const s of f.sizes) total += s;
  return total;
}

/**
 * Decide what to upload. `disk` maps file name -> { size, blockmapCovers? }.
 * Returns the ordered upload list (manifest LAST) plus every problem found;
 * a non-empty `problems` means do not upload anything.
 */
export function planUpload({ platform, manifestText, disk, productName, version }) {
  const problems = [];
  const manifest = manifestName(platform);
  const files = parseManifestFiles(manifestText);
  const manifestVersion = parseManifestVersion(manifestText);

  if (manifestVersion !== version) {
    problems.push(`${manifest} is for version ${manifestVersion}, not ${version}`);
  }
  if (files.length === 0) problems.push(`${manifest} lists no files`);

  const payload = [];
  for (const f of files) {
    const onDisk = disk[f.url];
    if (!onDisk) {
      problems.push(`${f.url} is in ${manifest} but not on disk`);
      continue;
    }
    if (onDisk.size !== f.size) {
      problems.push(`${f.url}: ${manifest} says ${f.size} bytes, disk has ${onDisk.size} — stale manifest`);
    }
    const bm = disk[blockmapName(f.url)];
    if (!bm) {
      problems.push(`${blockmapName(f.url)} missing — without it every client does a FULL download`);
    } else if (bm.blockmapCovers !== onDisk.size) {
      problems.push(
        `${blockmapName(f.url)} describes ${bm.blockmapCovers} bytes but ${f.url} is ${onDisk.size} — it belongs to a different build`
      );
    }
    payload.push(f.url, blockmapName(f.url));
  }

  // The installers are what NEW users download from the release page — a release
  // without them is broken even though the updater would still work.
  const extras = extraInstallerNames(platform, productName, version);
  for (const n of extras) if (!disk[n]) problems.push(`${n} missing — the release page would have no installer`);
  return { uploads: [...payload, ...extras.filter((n) => disk[n]), manifest], problems, files };
}

// ── side-effecting shell ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { platform: null, tag: null, version: null, outDir: 'release', dryRun: false, mode: 'publish', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') o.platform = argv[++i];
    else if (a === '--tag') o.tag = argv[++i];
    else if (a === '--version') o.version = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--verify-remote') o.mode = 'verify';
    else if (a === '--backfill') o.mode = 'backfill';
    else if (a === '--force') o.force = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return o;
}

function gh(args, { inherit = false, allowFail = false } = {}) {
  const r = spawnSync('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run gh (${r.error.message}) — install the GitHub CLI and run "gh auth login"`);
  if (r.status !== 0 && !allowFail) {
    throw new Error(`gh ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || '').trim()}`);
  }
  return r;
}

function repoSlug(pkg) {
  const pub = [].concat(pkg.build?.publish || []).find((p) => p.provider === 'github');
  if (!pub) throw new Error('package.json build.publish has no github provider');
  return `${pub.owner}/${pub.repo}`;
}

function releaseAssets(repo, tag) {
  const r = gh(['release', 'view', tag, '--repo', repo, '--json', 'assets,isDraft,tagName'], { allowFail: true });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout);
  return { isDraft: j.isDraft, assets: new Map(j.assets.map((a) => [a.name, a.size])) };
}

/** `V2.8.8` / `v2.0` / `2.1.0` -> [2, 8, 8]; null when the tag is not a plain version. */
export function tagVersionParts(tag) {
  const m = /^[vV]?(\d+(?:\.\d+)*)$/.exec(tag);
  return m ? m[1].split('.').map(Number) : null;
}

function compareParts(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The release a client upgrading TO `version` is most likely on: the highest-versioned
 * published (non-draft, non-prerelease) release BELOW it. By version, not by date or
 * list order — auditing an OLD tag must not compare it against a NEWER release.
 */
export function pickPreviousTag(releases, version) {
  const target = tagVersionParts(version);
  if (!target) throw new Error(`not a plain version: ${version}`);
  let best = null;
  for (const r of releases) {
    if (r.isDraft || r.isPrerelease) continue;
    const parts = tagVersionParts(r.tagName);
    if (!parts || compareParts(parts, target) >= 0) continue;
    if (!best || compareParts(parts, best.parts) > 0) best = { tag: r.tagName, parts };
  }
  return best ? best.tag : null;
}

function previousRelease(repo, version) {
  const r = gh(['release', 'list', '--repo', repo, '--limit', '100', '--json', 'tagName,isDraft,isPrerelease']);
  return pickPreviousTag(JSON.parse(r.stdout), version);
}

function downloadAssetText(repo, tag, name) {
  const r = gh(['release', 'download', tag, '--repo', repo, '--pattern', name, '--output', '-'], { allowFail: true });
  return r.status === 0 ? r.stdout : null;
}

function loadAppBuilder() {
  const require = createRequire(import.meta.url);
  const p = require.resolve('app-builder-lib/out/util/appBuilder', { paths: [repoRoot] });
  return require(p);
}

/** Same `app-builder blockmap` call electron-builder makes; returns {size, sha512}. */
async function generateBlockmap(input, output) {
  const { executeAppBuilderAsJson } = loadAppBuilder();
  return executeAppBuilderAsJson(['blockmap', '--input', input, '--output', output]);
}

/** Report whether clients on the previous release can diff against `tag`. */
function reportDiffEligibility({ repo, platform, tag, version, files }) {
  const prevTag = previousRelease(repo, version);
  if (!prevTag) {
    console.log('[release] no previous published release — nothing to diff against yet');
    return { tagOk: true, blockmapsOk: true };
  }
  const prev = releaseAssets(repo, prevTag);
  const prevManifest = downloadAssetText(repo, prevTag, manifestName(platform));
  const prevVersion = prevManifest ? parseManifestVersion(prevManifest) : null;
  if (!prev || !prevVersion) {
    console.warn(`[release] could not read ${manifestName(platform)} of previous release ${prevTag}`);
    return { tagOk: true, blockmapsOk: false };
  }
  const d = checkTagDerivation({ newTag: tag, newVersion: version, oldTag: prevTag, oldVersion: prevVersion });
  if (!d.ok) {
    console.error(
      `[release] ✗ tag "${tag}" derives old tag "${d.derivedTag}", but the previous release is "${prevTag}". ` +
        `electron-updater would 404 on every old blockmap and fall back to a FULL download. Use tag "${deriveOldPath(prevTag, prevVersion, version)}".`
    );
    return { tagOk: false, blockmapsOk: false };
  }
  let allOk = true;
  for (const f of files) {
    const oldBm = blockmapName(deriveOldPath(f.url, version, prevVersion));
    if (prev.assets.has(oldBm)) {
      console.log(`[release] ✓ ${prevTag} has ${oldBm} — ${prevVersion} → ${version} can diff`);
    } else {
      allOk = false;
      console.warn(
        `[release] ! ${prevTag} lacks ${oldBm} — clients on ${prevVersion} will download ${f.url} in FULL ` +
          `(fix: node scripts/publish-github-release.mjs --platform ${platform === 'darwin' ? 'mac' : 'win'} --backfill --tag ${prevTag})`
      );
    }
  }
  return { tagOk: true, blockmapsOk: allOk };
}

async function publish(o, ctx) {
  const { repo, platform, version, productName } = ctx;
  const outDir = path.resolve(repoRoot, o.outDir);
  const manifest = manifestName(platform);
  const manifestPath = path.join(outDir, manifest);
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — build first`);
  const manifestText = fs.readFileSync(manifestPath, 'utf8');

  const disk = {};
  for (const name of fs.readdirSync(outDir)) {
    const p = path.join(outDir, name);
    if (!fs.statSync(p).isFile()) continue;
    disk[name] = { size: fs.statSync(p).size };
    if (name.endsWith('.blockmap')) {
      try {
        disk[name].blockmapCovers = blockmapCoveredSize(fs.readFileSync(p));
      } catch (e) {
        disk[name].blockmapCovers = -1;
      }
    }
  }

  const plan = planUpload({ platform, manifestText, disk, productName, version });
  console.log(`[release] ${repo} ${o.tag} (${platform}) — upload order:`);
  for (const n of plan.uploads) console.log(`    ${n}  (${disk[n] ? (disk[n].size / 1e6).toFixed(1) + ' MB' : 'MISSING'})`);
  if (plan.problems.length) {
    for (const p of plan.problems) console.error(`[release] ✗ ${p}`);
    throw new Error('refusing to upload an incomplete updater set');
  }

  const rel = releaseAssets(repo, o.tag);
  if (!rel && o.dryRun) {
    console.warn(`[release] release ${o.tag} does not exist yet — create it as a draft before the real run`);
  } else if (!rel) {
    throw new Error(
      `release ${o.tag} does not exist. Create it as a DRAFT first (electron-updater ignores drafts, so nothing ` +
        `is served until every file is up): gh release create ${o.tag} --repo ${repo} --draft --title "Natively v${version}"`
    );
  }
  // A tag that breaks derivation is a hard stop; a missing OLD blockmap is only a warning
  // (it costs clients on the old version one full download, it does not break this release).
  const eligibility = reportDiffEligibility({ repo, platform, tag: o.tag, version, files: plan.files });
  if (!eligibility.tagOk && !o.force) {
    throw new Error('tag naming breaks differential updates (pass --force to upload anyway)');
  }
  if (o.dryRun) {
    console.log('[release] --dry-run: nothing uploaded');
    return;
  }

  // Payload first, manifest last: a client polling mid-upload must never read a
  // latest*.yml whose files are not there yet.
  const payload = plan.uploads.filter((n) => n !== manifest).map((n) => path.join(outDir, n));
  gh(['release', 'upload', o.tag, '--repo', repo, '--clobber', ...payload], { inherit: true });
  gh(['release', 'upload', o.tag, '--repo', repo, '--clobber', manifestPath], { inherit: true });
  console.log(`[release] uploaded ${plan.uploads.length} file(s)${rel.isDraft ? ' — release is still a DRAFT; publish it when both platforms are up' : ''}`);
  await verifyRemote(o, ctx);
}

async function verifyRemote(o, ctx) {
  const { repo, platform } = ctx;
  const manifest = manifestName(platform);
  const rel = releaseAssets(repo, o.tag);
  if (!rel) throw new Error(`release ${o.tag} not found in ${repo}`);
  const text = downloadAssetText(repo, o.tag, manifest);
  if (!text) throw new Error(`${o.tag} has no ${manifest} asset`);
  const version = parseManifestVersion(text);
  const files = parseManifestFiles(text);
  let bad = 0;
  for (const f of files) {
    const size = rel.assets.get(f.url);
    if (size === undefined) {
      bad++;
      console.error(`[verify] ✗ ${f.url} is in ${manifest} but not on the release`);
    } else if (size !== f.size) {
      bad++;
      console.error(`[verify] ✗ ${f.url}: release asset ${size} bytes, ${manifest} says ${f.size}`);
    } else {
      console.log(`[verify] ✓ ${f.url} (${(size / 1e6).toFixed(1)} MB)`);
    }
    const bm = blockmapName(f.url);
    if (rel.assets.has(bm)) console.log(`[verify] ✓ ${bm}`);
    else {
      bad++;
      console.error(`[verify] ✗ ${bm} missing — every client downloads ${f.url} in FULL`);
    }
  }
  reportDiffEligibility({ repo, platform, tag: o.tag, version, files });
  if (bad) throw new Error(`${bad} problem(s) on ${o.tag}`);
  console.log(`[verify] ${o.tag} ${manifest}: updater set complete ✅`);
}

async function backfill(o, ctx) {
  const { repo, platform } = ctx;
  const manifest = manifestName(platform);
  const rel = releaseAssets(repo, o.tag);
  if (!rel) throw new Error(`release ${o.tag} not found in ${repo}`);
  const text = downloadAssetText(repo, o.tag, manifest);
  if (!text) throw new Error(`${o.tag} has no ${manifest} asset`);
  const files = parseManifestFiles(text).filter((f) => !rel.assets.has(blockmapName(f.url)));
  if (files.length === 0) {
    console.log(`[backfill] ${o.tag}: every ${manifest} file already has a blockmap`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-blockmap-'));
  try {
    for (const f of files) {
      console.log(`[backfill] ${f.url}: downloading ${(f.size / 1e6).toFixed(0)} MB from ${o.tag}…`);
      gh(['release', 'download', o.tag, '--repo', repo, '--pattern', f.url, '--dir', tmp, '--clobber'], { inherit: true });
      const file = path.join(tmp, f.url);
      const out = path.join(tmp, blockmapName(f.url));
      const info = await generateBlockmap(file, out);
      // The blockmap must describe the exact bytes the updater validates against.
      if (info.size !== f.size || info.sha512 !== f.sha512) {
        throw new Error(`${f.url}: downloaded bytes do not match ${manifest} (size ${info.size}/${f.size}) — not uploading`);
      }
      if (blockmapCoveredSize(fs.readFileSync(out)) !== f.size) throw new Error(`${out}: blockmap does not cover the file`);
      console.log(`[backfill] ${blockmapName(f.url)} generated (${fs.statSync(out).size} bytes, sha512 matches ${manifest})`);
      fs.rmSync(file, { force: true });
      if (o.dryRun) console.log(`[backfill] --dry-run: not uploading ${blockmapName(f.url)}`);
      else gh(['release', 'upload', o.tag, '--repo', repo, '--clobber', out], { inherit: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!o.dryRun) await verifyRemote(o, ctx);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const platform = normalizePlatform(o.platform);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = o.version || pkg.version;
  const productName = pkg.build?.productName || pkg.productName || 'Natively';
  const repo = repoSlug(pkg);
  if (!o.tag) {
    if (o.mode !== 'publish') throw new Error('--tag is required with --verify-remote / --backfill');
    o.tag = `V${version}`; // matches the V2.8.8 release; checkTagDerivation guards the choice
  }
  const ctx = { repo, platform, version, productName };
  if (o.mode === 'verify') await verifyRemote(o, ctx);
  else if (o.mode === 'backfill') await backfill(o, ctx);
  else await publish(o, ctx);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[release]', err && err.message ? err.message : err);
    process.exit(1);
  });
}
