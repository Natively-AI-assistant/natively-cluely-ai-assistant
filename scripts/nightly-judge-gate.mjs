#!/usr/bin/env node
/**
 * The Auto Answer judge regression check, run nightly on a developer machine
 * (2026-09-27). GitHub Actions cannot run it while pushes are refused, so it
 * runs here, against production, with the Natively key from the main
 * checkout's .env (read at run time, never copied into the schedule).
 *
 *   node scripts/nightly-judge-gate.mjs              # run now
 *   node scripts/nightly-judge-gate.mjs --install    # every night at 03:30 (macOS launchd)
 *   node scripts/nightly-judge-gate.mjs --uninstall
 *
 * Each run: move THIS worktree (a dedicated, detached one) to local `main`,
 * check out premium from the local submodule, build dist-electron, run
 * judgeEvalGate.mjs (3 passes, one call in flight), and log the result. A
 * regression (exit 1) or a failed run (exit 2) raises a notification.
 *
 * Why its own worktree: the build writes dist-electron, and the main checkout's
 * dist is what every running dev app loads. node_modules is shared by link.
 *
 * Scheduling is macOS-only for now (launchd; a Mac asleep at 03:30 runs it on
 * wake). The run itself is plain Node and works on Windows; --install there
 * refuses rather than pretending, see installSchedule().
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'software.natively.judge-gate';
const RUNS = '3';
const KEEP_LOGS = 30;

function git(args, cwd = WT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The main checkout: the parent of the shared git dir. */
function mainCheckout() {
  return path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

function logDir() {
  const dir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Logs', 'Natively', 'judge-gate')
    : path.join(os.homedir(), '.natively', 'judge-gate');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The key from the main checkout's .env. Values there are double-quoted. */
function nativelyKey(shared) {
  if (process.env.NATIVELY_API_KEY) return process.env.NATIVELY_API_KEY;
  const env = path.join(shared, '.env');
  if (!fs.existsSync(env)) return null;
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('NATIVELY_API_KEY='));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null : null;
}

function notify(title, message) {
  try {
    switch (process.platform) {
      case 'darwin':
        execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
        return;
      default:
        // No notifier wired on other platforms: the log is the record.
        return;
    }
  } catch { /* a notification must never fail the run */ }
}

function prepareWorktree(shared, log) {
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error(`${WT} has local changes; it must stay a clean, dedicated worktree`);
  }
  git(['checkout', '--detach', '--quiet', 'main']);
  git(['submodule', 'update', '--init', '--quiet', 'premium']);
  const nm = path.join(WT, 'node_modules');
  if (!fs.existsSync(nm)) {
    // A junction on Windows needs no admin rights; a symlink elsewhere.
    fs.symlinkSync(path.join(shared, 'node_modules'), nm, process.platform === 'win32' ? 'junction' : 'dir');
  }
  log(`worktree at main ${git(['rev-parse', '--short', 'HEAD'])}`);
  const build = spawnSync(process.execPath, [path.join(WT, 'scripts', 'build-electron.js')], { cwd: WT, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`build-electron failed:\n${(build.stderr || build.stdout || '').slice(-2000)}`);
  log('dist-electron built');
}

function run() {
  const dir = logDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.log`);
  const lines = [];
  const log = (s) => { lines.push(s); fs.appendFileSync(file, s + '\n'); };
  let code = 2;
  let sha = null;
  try {
    const shared = mainCheckout();
    prepareWorktree(shared, log);
    sha = git(['rev-parse', '--short', 'HEAD']);
    const key = nativelyKey(shared);
    if (!key) throw new Error(`no NATIVELY_API_KEY in ${path.join(shared, '.env')}`);
    const gate = spawnSync(process.execPath, [path.join(WT, 'electron', 'intelligence', 'autoAnswer', '__tests__', 'judgeEvalGate.mjs')], {
      cwd: WT,
      env: { ...process.env, NATIVELY_API_KEY: key, JUDGE_EVAL_PROVIDER: 'natively', JUDGE_GATE_RUNS: RUNS },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    log((gate.stdout || '') + (gate.stderr || ''));
    code = gate.status ?? 2;
  } catch (e) {
    log(`run failed: ${e?.message ?? e}`);
    code = 2;
  }
  const verdict = code === 0 ? 'ok' : code === 1 ? 'REGRESSED' : 'RUN FAILED';
  log(`result: ${verdict} (exit ${code})`);
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ at: new Date().toISOString(), sha, code, verdict, log: file }, null, 2));
  if (code !== 0) {
    const detail = lines.join('\n').split('\n').find((l) => /REGRESSED|errored|failed/.test(l)) ?? 'see the log';
    notify(`Auto Answer judge: ${verdict}`, `${detail.trim().slice(0, 180)} (${path.basename(file)})`);
  }
  // Keep the last KEEP_LOGS runs.
  const logs = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort();
  for (const old of logs.slice(0, Math.max(0, logs.length - KEEP_LOGS))) fs.rmSync(path.join(dir, old), { force: true });
  process.exitCode = code;
}

function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function installSchedule() {
  switch (process.platform) {
    case 'darwin': {
      const dir = logDir();
      const script = fileURLToPath(import.meta.url);
      // process.execPath is the RESOLVED binary (Homebrew: Cellar/node/<version>/bin/node),
      // which the next `brew upgrade node` deletes. Prefer a stable link to the same node.
      const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find((p) => {
        try { return fs.realpathSync(p) === fs.realpathSync(process.execPath); } catch { return false; }
      }) ?? process.execPath;
      const pathEnv = [path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(node)}</string><string>${esc(script)}</string></array>
  <key>WorkingDirectory</key><string>${esc(WT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(pathEnv)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${esc(path.join(dir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(dir, 'launchd.err.log'))}</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
</dict>
</plist>
`;
      fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
      fs.writeFileSync(plistPath(), plist);
      const domain = `gui/${process.getuid()}`;
      try { execFileSync('launchctl', ['bootout', domain, plistPath()], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
      execFileSync('launchctl', ['bootstrap', domain, plistPath()]);
      console.log(`scheduled: ${LABEL} every night at 03:30 (${plistPath()}); logs in ${dir}`);
      return;
    }
    case 'win32':
      // Task Scheduler (schtasks) would be the equivalent. Not built: nobody
      // runs this on Windows yet, and a half-tested scheduler is worse than none.
      throw new Error('--install is macOS-only for now; on Windows run `node scripts/nightly-judge-gate.mjs` from Task Scheduler');
    default:
      throw new Error(`--install is not supported on ${process.platform}`);
  }
}

function uninstallSchedule() {
  if (process.platform !== 'darwin') throw new Error(`--uninstall is macOS-only (${process.platform})`);
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath()], { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.rmSync(plistPath(), { force: true });
  console.log(`unscheduled: ${LABEL}`);
}

if (process.argv.includes('--install')) installSchedule();
else if (process.argv.includes('--uninstall')) uninstallSchedule();
else run();
