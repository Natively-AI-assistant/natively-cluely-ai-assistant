/**
 * Ensures all sqlite-vec platform packages are present in node_modules,
 * even when the current CPU doesn't match (e.g. building x64 release on arm64).
 * npm skips optional deps with non-matching "cpu" constraints, so we force-install them.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// The version comes from package-lock.json, never from a constant here. sqlite-vec
// pins its platform packages to its own exact version, so a platform package that
// drifts from the JS wrapper is a mismatch. A hardcoded '0.1.7-alpha.2' stayed
// behind when the lockfile moved to 0.1.9: the host arch got 0.1.9 from npm while
// the cross-arch packages fetched here stayed on the old build (found 2026-10-04,
// an Intel build made on Apple Silicon).
const lockfile = require('../package-lock.json');
const SQLITE_VEC_VERSION = lockfile?.packages?.['node_modules/sqlite-vec']?.version;
if (!SQLITE_VEC_VERSION) {
  throw new Error('[ensure-sqlite-vec] Could not read the sqlite-vec version from package-lock.json.');
}

/** Version of an installed package, or null when it is absent or unreadable. */
function installedVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version || null;
  } catch {
    return null;
  }
}

const packages = [
  'sqlite-vec-darwin-arm64',
  'sqlite-vec-darwin-x64',
  // Phase 5 (semantic-retrieval repair, 2026-08-13): Windows parity. The
  // header's reasoning — npm skips optional deps whose "cpu"/"os" constraints
  // don't match the build host — applies identically to a Windows artifact
  // built or CI'd from macOS. Without this, such a build silently degrades to
  // the O(n) JS cosine fallback (VectorStore logs "sqlite-vec not available")
  // instead of native vec0 search.
  'sqlite-vec-windows-x64',
];

for (const pkg of packages) {
  const pkgDir = path.join(__dirname, '..', 'node_modules', pkg);
  const present = installedVersion(pkgDir);
  if (present === SQLITE_VEC_VERSION) {
    console.log(`[ensure-sqlite-vec] ${pkg}@${present} already present, skipping.`);
    continue;
  }

  if (fs.existsSync(pkgDir)) {
    // Present but the wrong build (or a directory with no package.json): replace it,
    // or the pack ships an extension that does not match the sqlite-vec wrapper.
    console.log(
      `[ensure-sqlite-vec] ${pkg} is ${present || 'unreadable'}, lockfile wants ${SQLITE_VEC_VERSION} — replacing...`
    );
    fs.rmSync(pkgDir, { recursive: true, force: true });
  } else {
    console.log(`[ensure-sqlite-vec] ${pkg} missing — fetching...`);
  }
  try {
    // Use npm pack to download the tarball, then extract it into node_modules
    const tmpDir = os.tmpdir();
    const tarball = execSync(`npm pack ${pkg}@${SQLITE_VEC_VERSION} --pack-destination "${tmpDir}"`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
    }).trim();
    const tarPath = path.join(tmpDir, tarball);

    fs.mkdirSync(pkgDir, { recursive: true });
    execSync(`tar xzf "${tarPath}" --strip-components=1 -C "${pkgDir}"`, { stdio: 'inherit' });
    fs.unlinkSync(tarPath);

    console.log(`[ensure-sqlite-vec] ${pkg} installed successfully.`);
  } catch (e) {
    console.warn(`[ensure-sqlite-vec] Warning: could not install ${pkg}:`, e.message);
  }
}

// FAIL FAST on a darwin member missing from a darwin build. Until 2026-08-26 every
// failure here was a warning and the build degraded silently to the O(n) JS cosine
// fallback. The packed-arch family guard in scripts/ad-hoc-sign.js now makes a
// half-installed darwin pair FATAL — but only at afterPack, ~50 minutes in, after
// packing and Developer ID signing have already run. Surfacing it here costs seconds.
//
// Deliberately NOT fatal for sqlite-vec-windows-x64 on a mac host: the guard only
// inspects darwin members, a Windows artifact is not being produced by this run, and
// this fetch has a history of transient registry flakiness.
const stillMissing = packages.filter(
  (pkg) => installedVersion(path.join(__dirname, '..', 'node_modules', pkg)) !== SQLITE_VEC_VERSION
);
const fatalMissing = stillMissing.filter(
  (pkg) => pkg.startsWith('sqlite-vec-darwin-') && process.platform === 'darwin'
);
if (fatalMissing.length > 0) {
  throw new Error(
    `[ensure-sqlite-vec] Could not install ${fatalMissing.join(', ')} on a darwin host. ` +
      'A mac pack missing one of the darwin pair fails the Arch Guard at afterPack anyway — ' +
      'stopping now instead of ~50 minutes into a signed build.'
  );
}
if (stillMissing.length > 0) {
  console.warn(
    `[ensure-sqlite-vec] Still missing (non-fatal on this host): ${stillMissing.join(', ')}`
  );
}
