import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// Native modules built against the system Node ABI instead of Electron's cause
// a startup crash with NODE_MODULE_VERSION mismatch on require(). Common trigger:
// `npm rebuild` (skips postinstall), `npm install --ignore-scripts`, or a system
// Node upgrade after a previous successful build. In dev, recover automatically.
const GUARDED_MODULES = ['better-sqlite3', 'keytar'];

interface AbiMismatch {
  module: string;
  expected: string;
  actual: string;
}

function probeAbi(moduleName: string): AbiMismatch | null {
  try {
    require(moduleName);
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (err?.code !== 'ERR_DLOPEN_FAILED' || !/NODE_MODULE_VERSION/.test(msg)) {
      throw err;
    }
    const expected = msg.match(/This version of Node\.js requires\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1];
    const actual = msg.match(/compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1];
    return {
      module: moduleName,
      expected: expected ?? String(process.versions.modules),
      actual: actual ?? 'unknown',
    };
  }
}

function findRepoRoot(): string {
  let current = __dirname;
  while (current !== path.dirname(current)) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg?.name === 'natively') return current;
      } catch {
        // fall through
      }
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function findElectronRebuildBin(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, 'node_modules', '.bin', 'electron-rebuild'),
    path.join(repoRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function ensureNativeModuleAbi(): void {
  const mismatches: AbiMismatch[] = [];
  for (const name of GUARDED_MODULES) {
    const result = probeAbi(name);
    if (result) mismatches.push(result);
  }
  if (mismatches.length === 0) return;

  const summary = mismatches
    .map((m) => `  - ${m.module}: built for ABI v${m.actual}, Electron expects v${m.expected}`)
    .join('\n');
  console.error('\n[NativeModuleGuard] Native module ABI mismatch:');
  console.error(summary);

  if (app.isPackaged) {
    console.error(
      '[NativeModuleGuard] Packaged build — cannot rebuild at runtime. ' +
        'The release pipeline shipped the wrong .node binaries.'
    );
    app.exit(1);
    return;
  }

  console.warn('[NativeModuleGuard] Dev mode — rebuilding native modules against Electron…');

  const repoRoot = findRepoRoot();
  const rebuildBin = findElectronRebuildBin(repoRoot);
  if (!rebuildBin) {
    console.error(
      '[NativeModuleGuard] electron-rebuild not found in node_modules. ' +
        'Run: npm install, then: npx electron-rebuild -f -w better-sqlite3,keytar'
    );
    app.exit(1);
    return;
  }

  // electron-rebuild must use system node (not the Electron binary we're running
  // inside) to spawn node-gyp correctly. Strip ELECTRON_RUN_AS_NODE so the
  // shebang on the .bin script picks up system node from PATH.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const result = spawnSync(rebuildBin, ['-f', '-w', GUARDED_MODULES.join(',')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });

  if (result.status !== 0) {
    console.error(
      `[NativeModuleGuard] electron-rebuild exited with code ${result.status}. ` +
        'Manual recovery: npx electron-rebuild -f -w better-sqlite3,keytar'
    );
    app.exit(1);
    return;
  }

  console.warn('[NativeModuleGuard] Rebuild complete — relaunching Electron.');
  app.relaunch();
  app.exit(0);
}
