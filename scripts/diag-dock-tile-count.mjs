#!/usr/bin/env node
/**
 * Feedback loop: after npm start settles, count macOS dock-relevant ASNs for
 * the dev Electron/Natively app. Expect exactly 1 Foreground tile.
 *
 * Usage:
 *   node scripts/diag-dock-tile-count.mjs            # assume app already up
 *   node scripts/diag-dock-tile-count.mjs --start    # kill leftovers, npm start, then count
 *
 * Exit 0 = green (1 tile). Exit 1 = red (user symptom: multiple Electron dock apps).
 */
import { spawn, spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const wantStart = process.argv.includes('--start');
const settleMs = Number(process.env.DOCK_DIAG_SETTLE_MS || 8000);
const readyTimeoutMs = Number(process.env.DOCK_DIAG_READY_MS || 120000);

function listDockHits() {
  const out = execSync('lsappinfo list', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const blocks = out.split(/\n(?=\s*\d+\))/);
  const hits = [];
  for (const b of blocks) {
    const nameM = b.match(/^\s*\d+\)\s+"([^"]+)"\s+ASN/);
    const name = nameM?.[1] || '';
    const bundlePath = b.match(/bundle path="([^"]+)"/)?.[1] || '';
    const type = b.match(/type="([^"]+)"/)?.[1] || '';
    const pid = b.match(/pid = (\d+)/)?.[1] || '';
    const bid = b.match(/bundleID="([^"]+)"/)?.[1] || '';

    const isDevElectronBundle =
      bundlePath.includes('/natively-cluely-ai-assistant/node_modules/electron/dist/Electron.app') ||
      /\/electron\/dist\/Electron\.app$/.test(bundlePath);
    const isMainName = name === 'Electron' || name === 'Natively';

    // Dock-visible candidates: non-BackgroundOnly ASNs for our Electron.app
    // (or literally named Electron/Natively). Helpers never get their own dock tile.
    if (!(isDevElectronBundle || isMainName)) continue;
    if (type === 'BackgroundOnly') continue;
    if (name.startsWith('Electron Helper')) continue;
    hits.push({ name, type, pid, bid, bundlePath: bundlePath || '(null)' });
  }
  // Dedup by pid+name
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.pid}|${h.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function killLeftovers() {
  spawnSync('pkill', ['-f', 'natively-cluely-ai-assistant/node_modules/.bin/electron'], { stdio: 'ignore' });
  spawnSync('pkill', ['-f', 'natively-cluely-ai-assistant/node_modules/electron/dist/Electron.app'], {
    stdio: 'ignore',
  });
  spawnSync('pkill', ['-f', 'vite --port 5180'], { stdio: 'ignore' });
  // Give WindowServer a beat to drop dock tiles
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}

function waitReady(logPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(logPath)) {
      const text = fs.readFileSync(logPath, 'utf8');
      if (text.includes('App is ready')) return true;
      if (/exit_code:/.test(text) && !text.includes('App is ready')) {
        throw new Error('npm start exited before App is ready');
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Timed out waiting for App is ready (${timeoutMs}ms)`);
}

function samplePeak(durationMs, intervalMs = 250) {
  let peak = 0;
  let peakHits = [];
  const timeline = [];
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const hits = listDockHits();
    timeline.push({ t: Date.now(), count: hits.length, names: hits.map((h) => h.name) });
    if (hits.length > peak) {
      peak = hits.length;
      peakHits = hits;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
  return { peak, peakHits, timeline, final: listDockHits() };
}

async function main() {
  let child = null;
  const logPath = path.join(repoRoot, '.scratch/diag-dock-tile-count.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  try {
    let result;
    if (wantStart) {
      killLeftovers();
      fs.writeFileSync(logPath, '');
      const out = fs.openSync(logPath, 'a');
      child = spawn('npm', ['start'], {
        cwd: repoRoot,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', out, out],
        detached: true,
      });
      console.log(`[diag-dock] started npm start pid=${child.pid}`);

      // Poll dock tiles through the whole boot — user symptom is "2 apps start",
      // which may be a transient peak even if settle ends at 1.
      const bootPoller = { peak: 0, peakHits: [], samples: [] };
      const bootStart = Date.now();
      while (Date.now() - bootStart < readyTimeoutMs) {
        const hits = listDockHits();
        bootPoller.samples.push({ t: Date.now() - bootStart, count: hits.length, names: hits.map((h) => `${h.name}/${h.type}`) });
        if (hits.length > bootPoller.peak) {
          bootPoller.peak = hits.length;
          bootPoller.peakHits = hits;
        }
        if (fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes('App is ready')) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      if (!fs.existsSync(logPath) || !fs.readFileSync(logPath, 'utf8').includes('App is ready')) {
        throw new Error('Timed out / never saw App is ready');
      }
      console.log(`[diag-dock] App is ready — settling ${settleMs}ms (continue polling)`);
      result = samplePeak(settleMs, 200);
      if (bootPoller.peak > result.peak) {
        result.peak = bootPoller.peak;
        result.peakHits = bootPoller.peakHits;
      }
      result.bootSamples = bootPoller.samples.filter((s) => s.count > 0);
    } else {
      console.log('[diag-dock] --start not set; sampling currently running ASNs');
      result = { peak: 0, peakHits: [], final: listDockHits(), bootSamples: [] };
      result.peak = result.final.length;
      result.peakHits = result.final;
    }

    const hits = result.final;
    console.log('[diag-dock] final dock-relevant ASNs:');
    for (const h of hits) {
      console.log(`  - name=${h.name} type=${h.type} pid=${h.pid} bid=${h.bid}`);
      console.log(`    path=${h.bundlePath}`);
    }
    console.log(`[diag-dock] final_count=${hits.length} peak_count=${result.peak} (expect peak<=1 and final==1)`);
    if (result.bootSamples?.length) {
      console.log('[diag-dock] non-zero boot samples:');
      for (const s of result.bootSamples.slice(-20)) {
        console.log(`  t=${s.t}ms count=${s.count} names=${s.names.join(',')}`);
      }
    }
    if (result.peakHits?.length) {
      console.log('[diag-dock] peak ASNs:');
      for (const h of result.peakHits) {
        console.log(`  - name=${h.name} type=${h.type} pid=${h.pid}`);
      }
    }

    // RED on user's symptom: more than one tile at any point during start, or settled != 1
    if (result.peak <= 1 && hits.length === 1) {
      console.log('[diag-dock] GREEN — single dock tile throughout start');
      process.exitCode = 0;
    } else {
      console.log(
        `[diag-dock] RED — peak=${result.peak} final=${hits.length} (user symptom: 2 Electron apps on npm start)`,
      );
      process.exitCode = 1;
    }
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch {
          /* ignore */
        }
      }
      killLeftovers();
    }
  }
}

main().catch((err) => {
  console.error('[diag-dock] FATAL', err);
  process.exit(2);
});
