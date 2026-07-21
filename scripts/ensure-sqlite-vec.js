/**
 * Ensures all sqlite-vec platform packages are present in node_modules,
 * even when the current CPU doesn't match (e.g. building x64 release on arm64).
 * npm skips optional deps with non-matching "cpu" constraints, so we force-install them.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SQLITE_VEC_VERSION = '0.1.7-alpha.2';

const packages = [
  'sqlite-vec-darwin-arm64',
  'sqlite-vec-darwin-x64',
];

for (const pkg of packages) {
  const pkgDir = path.join(__dirname, '..', 'node_modules', pkg);
  if (fs.existsSync(pkgDir)) {
    console.log(`[ensure-sqlite-vec] ${pkg} already present, skipping.`);
    continue;
  }

  console.log(`[ensure-sqlite-vec] ${pkg} missing — fetching...`);
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
