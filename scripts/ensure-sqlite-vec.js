/**
 * Ensures sqlite-vec platform packages are present in node_modules,
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

// Linux x64 native vec extension — optional; JS cosine fallback remains acceptable for v1.
if (os.platform() === 'linux' && os.arch() === 'x64') {
  packages.push('sqlite-vec-linux-x64');
}

for (const pkg of packages) {
  const pkgDir = path.join(__dirname, '..', 'node_modules', pkg);
  if (fs.existsSync(pkgDir)) {
    console.log(`[ensure-sqlite-vec] ${pkg} already present, skipping.`);
    continue;
  }

  console.log(`[ensure-sqlite-vec] ${pkg} missing — fetching...`);
  try {
    const tarball = execSync(`npm pack ${pkg}@${SQLITE_VEC_VERSION} --pack-destination /tmp`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
    }).trim();
    const tarPath = path.join('/tmp', tarball);

    fs.mkdirSync(pkgDir, { recursive: true });
    execSync(`tar xzf "${tarPath}" --strip-components=1 -C "${pkgDir}"`, { stdio: 'inherit' });
    fs.unlinkSync(tarPath);

    console.log(`[ensure-sqlite-vec] ${pkg} installed successfully.`);
  } catch (e) {
    if (pkg.startsWith('sqlite-vec-linux')) {
      console.warn(
        `[ensure-sqlite-vec] ${pkg} unavailable — meeting search will use JS cosine fallback (PRD Q3).`,
        e.message
      );
    } else {
      console.warn(`[ensure-sqlite-vec] Warning: could not install ${pkg}:`, e.message);
    }
  }
}

if (os.platform() === 'linux') {
  console.log('[ensure-sqlite-vec] Linux: native vec0 optional; VectorStore JS fallback is acceptable for v1.');
}
