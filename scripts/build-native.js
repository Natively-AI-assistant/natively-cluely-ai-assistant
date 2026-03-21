const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nativeModulePath = path.join(__dirname, '..', 'native-module');
const buildAllMacTargets = process.env.NATIVELY_BUILD_ALL_MAC_ARCHES === '1';

function verifyArtifacts(expectedArtifacts) {
  const missing = expectedArtifacts.filter((file) => !fs.existsSync(path.join(nativeModulePath, file)));

  if (missing.length > 0) {
    throw new Error(`Missing native artifacts after build: ${missing.join(', ')}`);
  }

  console.log('Verified native artifacts:');
  for (const file of expectedArtifacts) {
    console.log(`- ${file}`);
  }
}

function runCommand(command) {
  console.log(`> ${command}`);
  execSync(command, { stdio: 'inherit', cwd: nativeModulePath });
}

if (os.platform() === 'darwin') {
  const macTargets = buildAllMacTargets
    ? ['x86_64-apple-darwin', 'aarch64-apple-darwin']
    : [os.arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'];

  console.log(
    buildAllMacTargets
      ? 'Building for macOS (darwin) for both x64 and arm64...'
      : `Building for macOS (darwin) for current architecture only: ${macTargets[0]}`
  );

  const artifactMap = {
    'x86_64-apple-darwin': 'index.darwin-x64.node',
    'aarch64-apple-darwin': 'index.darwin-arm64.node',
  };

  for (const target of macTargets) {
    try {
      runCommand(`rustup target add ${target}`);
    } catch (err) {
      console.warn(`Warning: Could not configure rust target ${target}. Continuing anyway.`);
    }

    console.log(`\n--- Building for ${target} ---`);
    runCommand(`npx napi build --platform --target ${target} --release`);
  }

  verifyArtifacts(macTargets.map((target) => artifactMap[target]));
  
} else {
  console.log(`Building for current platform: ${os.platform()}`);
  runCommand('npx napi build --platform --release');

  const artifactMap = {
    win32: {
      x64: ['index.win32-x64-msvc.node'],
      ia32: ['index.win32-ia32-msvc.node'],
      arm64: ['index.win32-arm64-msvc.node'],
    },
    linux: {
      x64: ['index.linux-x64-gnu.node'],
      arm64: ['index.linux-arm64-gnu.node'],
      arm: ['index.linux-arm-gnueabihf.node'],
    },
  };

  const expectedArtifacts = artifactMap[os.platform()]?.[os.arch()];
  if (expectedArtifacts) {
    verifyArtifacts(expectedArtifacts);
  }
}
