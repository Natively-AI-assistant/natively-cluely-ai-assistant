import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const distPath = path.resolve('dist');
const manifestPath = path.join(distPath, 'manifest.json');
const zipName = 'natively-companion-store.zip';
const zipPath = path.resolve(zipName);

console.log('--- Preparing Chrome Web Store Build ---');

if (!fs.existsSync(manifestPath)) {
  console.error(`Error: manifest.json not found at ${manifestPath}. Run 'npm run build' first.`);
  process.exit(1);
}

try {
  // Read the built manifest (keep the original text so we can restore it after
  // zipping — the Chrome Web Store build strips the `key`, but the local dev
  // `dist/` must keep its pinned key or Load-Unpacked gets a different ID).
  const originalManifestData = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(originalManifestData);
  const hadKey = 'key' in manifest;

  // Strip the key property for the store package (Google re-signs).
  if (hadKey) {
    delete manifest.key;
    console.log('✔ Removed "key" field from manifest.json for Chrome Web Store compatibility.');
  } else {
    console.log('ℹ No "key" field found in manifest.json.');
  }

  // Write the key-stripped manifest into dist/ just for the zip.
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Remove old zip if it exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Zip the contents of the dist directory, EXCLUDING dev-only artifacts:
  //   *.map        — sourcemaps (a debug aid; not needed in production and they
  //                  roughly double the upload size)
  //   *.LEGAL.txt  — empty esbuild legal-comment placeholders
  // so the store package ships only the runtime files the extension loads.
  console.log('Packing extension files (excluding sourcemaps + legal placeholders)...');
  execSync(`cd dist && zip -r "${zipPath}" . -x "*.map" "*.LEGAL.txt"`, { stdio: 'inherit' });

  // Restore the original (key-bearing) manifest so dist/ stays a valid dev build.
  if (hadKey) {
    fs.writeFileSync(manifestPath, originalManifestData, 'utf8');
    console.log('✔ Restored the pinned "key" in dist/manifest.json (dev build intact).');
  }

  console.log(`\n🎉 Success! Built and packaged extension into: ${zipName}`);
  console.log('You can now upload this ZIP file directly to the Chrome Web Store Developer Dashboard.');
} catch (err) {
  console.error('Failed to prepare store build:', err);
  process.exit(1);
}
