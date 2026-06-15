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
  // Read and parse manifest.json
  const manifestData = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestData);

  // Strip the key property if it exists
  if ('key' in manifest) {
    delete manifest.key;
    console.log('✔ Removed "key" field from manifest.json for Chrome Web Store compatibility.');
  } else {
    console.log('ℹ No "key" field found in manifest.json.');
  }

  // Write it back to dist/manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✔ Saved updated manifest.json to dist/.');

  // Remove old zip if it exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Zip the contents of the dist directory
  console.log('Packing extension files...');
  execSync(`cd dist && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  console.log(`\n🎉 Success! Built and packaged extension into: ${zipName}`);
  console.log('You can now upload this ZIP file directly to the Chrome Web Store Developer Dashboard.');
} catch (err) {
  console.error('Failed to prepare store build:', err);
  process.exit(1);
}
