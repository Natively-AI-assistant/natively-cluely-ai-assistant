// electron/llm/codeVerification/localRunner.ts
//
// Sandboxed LOCAL execution of model-generated code (Python/JS). Model code is
// UNTRUSTED, so each case runs in a short-lived subprocess with hard limits:
//   - fresh OS process (never eval/vm in-process — those share Electron's heap)
//   - 3s wall-clock timeout -> SIGKILL (catches infinite loops)
//   - scrubbed env (no API keys; only the test case + minimal PATH), stdin closed
//   - throwaway temp dir as cwd; temp file deleted after
//   - stdout/stderr capped (~256KB) -> kill (catches runaway prints)
//   - global concurrency semaphore (max 2) so verification can't storm the box
//   - per-language interpreter availability is detected once and cached
//   - windowsHide on every spawn: the app has no console, so Windows would
//     otherwise open a console window for each compiler and program run
//
// Mirrors the spawn-with-timeout pattern already used by CodexCliService.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestCase, RunResult, VerifyLanguage } from './types';
import { buildDriver, parseDriverResult, TC_ENV, isLocallyRunnable, isValidEntry, type DriverHints } from './drivers';
import { buildCppProgram } from './cppDriver';
import { buildJavaProgram } from './javaDriver';
import { buildGoProgram } from './goDriver';
import { buildSqlScript, parseSqlRows } from './sqlRunner';
import type { SqlSpec } from './types';
import { valuesEqual, renderValue, compareResultSet } from './judge';

const TIMEOUT_MS = 3000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CONCURRENCY = 2;

const isWin = process.platform === 'win32';

// Kill the child AND any grandchildren it spawned. Best-effort, never throws.
//   POSIX: the child is spawned `detached` so it leads its own process group;
//          a negative-pid SIGKILL reaps the whole group (parent + double-forked
//          grandchildren) past the timeout bound.
//   Windows: there is no POSIX process group, so `process.kill(-pid)` throws.
//          `taskkill /T` walks and force-kills the child's entire process tree;
//          the spawn is fire-and-forget (we don't await the reaper). A direct
//          `child.kill()` is the fallback if taskkill can't be launched.
const killTree = (child: ReturnType<typeof spawn>): void => {
  const pid = child.pid;
  if (isWin) {
    if (pid) {
      try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref?.(); } catch { /* noop */ }
    }
    try { child.kill(); } catch { /* noop */ }
    return;
  }
  try { if (pid) process.kill(-pid, 'SIGKILL'); } catch { /* group gone */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
};

// ── tiny async semaphore ──────────────────────────────────────────────────────
let active = 0;
const waiters: Array<() => void> = [];
const acquire = (): Promise<void> => active < MAX_CONCURRENCY
  ? (active++, Promise.resolve())
  : new Promise<void>(res => waiters.push(() => { active++; res(); }));
const release = (): void => { active--; const next = waiters.shift(); if (next) next(); };

// ── interpreter availability (detected once, cached) ──────────────────────────
// The first launch of a toolchain can be slow on Windows (antivirus scans it, a
// cold disk), so the probe waits longer there. A probe that runs out of time
// answers "not available" for now WITHOUT caching it: the child keeps running
// for up to PROBE_GIVE_UP_MS and a late clean exit caches "available", so the
// next answer is checked. Only a definite answer (spawn error, exit code) is
// cached; a child that never exits is killed and probed again next time.
export const interpreterProbeTimeoutMs = (platform: NodeJS.Platform = process.platform): number =>
  platform === 'win32' ? 10000 : 2000;
const PROBE_GIVE_UP_MS = 30000;

// `versionArgs` defaults to ['--version']; some tools differ (Go uses `version`).
export const createInterpreterProbe = (timeoutMs = interpreterProbeTimeoutMs(), giveUpMs = PROBE_GIVE_UP_MS) => {
  const cache = new Map<string, boolean>();
  const inflight = new Map<string, Promise<boolean>>();
  return (cmd: string, versionArgs: string[] = ['--version']): Promise<boolean> => {
    const cached = cache.get(cmd);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = inflight.get(cmd);
    if (pending) return pending;
    // Settled once: after a give-up the killed child still emits exit (or
    // error), and that must not cache "no" or drop a newer probe's entry.
    let finished = false;
    let probe: Promise<boolean> | undefined;
    const settled = new Promise<boolean>(resolve => {
      let answered = false;
      let waitTimer: NodeJS.Timeout | undefined;
      let giveUpTimer: NodeJS.Timeout | undefined;
      const answer = (ok: boolean) => { if (!answered) { answered = true; resolve(ok); } };
      const finish = (ok: boolean | undefined) => {
        if (finished) return;
        finished = true;
        clearTimeout(waitTimer); clearTimeout(giveUpTimer);
        if (ok !== undefined) cache.set(cmd, ok);
        if (probe && inflight.get(cmd) === probe) inflight.delete(cmd);
        answer(ok ?? false);
      };
      try {
        const child = spawn(cmd, versionArgs, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
        child.on('error', () => finish(false));
        child.on('exit', code => finish(code === 0));
        waitTimer = setTimeout(() => answer(false), timeoutMs);
        waitTimer.unref?.();
        giveUpTimer = setTimeout(() => { finish(undefined); killTree(child); }, giveUpMs);
        giveUpTimer.unref?.();
      } catch { finish(false); }
    });
    probe = settled;
    if (!finished) inflight.set(cmd, probe);
    return probe;
  };
};
const isInterpreterAvailable = createInterpreterProbe();

// Python interpreter name differs by platform. POSIX installs expose `python3`;
// the python.org Windows installer ships `python.exe` plus the `py` launcher and
// does NOT create a `python3` command (the bare `python3` on Windows usually
// resolves to the Microsoft Store App Execution Alias, which no-ops for
// non-interactive spawns). The first candidate in this order that works is
// cached, so the availability check and the actual run use the SAME interpreter.
export const PYTHON_CANDIDATES: ReadonlyArray<readonly [string, string[]]> = isWin
  ? [['python', ['--version']], ['py', ['-3', '--version']], ['python3', ['--version']]]
  : [['python3', ['--version']]];

// The candidates are probed together, so a hung one costs one probe timeout
// rather than one per candidate (30s on Windows); the list order still decides
// which interpreter is used. "None found" is not cached: a candidate whose probe
// ran out of time may answer later, and the probe cache keeps a repeat cheap.
export const createPythonResolver = (
  probe: (cmd: string, versionArgs: string[]) => Promise<boolean>,
  candidates: ReadonlyArray<readonly [string, string[]]> = PYTHON_CANDIDATES,
) => {
  let resolved: string[] | undefined;
  return async (): Promise<string[] | null> => {
    if (resolved) return resolved;
    const answers = candidates.map(([cmd, versionArgs]) => probe(cmd, versionArgs));
    for (const [i, [cmd, versionArgs]] of candidates.entries()) {
      if (await answers[i]) {
        // Drop the trailing `--version` probe flag; keep launcher selectors like `-3`.
        resolved = [cmd, ...versionArgs.slice(0, -1)];
        return resolved;
      }
    }
    return null;
  };
};
const resolvePythonCmd = createPythonResolver(isInterpreterAvailable);

export const localLanguageAvailable = async (language: VerifyLanguage): Promise<boolean> => {
  // SQL is verified via sqlite3 but is NOT in LOCAL_LANGUAGES (it doesn't use the
  // entry(args) path); the orchestrator routes it separately and checks this.
  if (language === 'sql') return isInterpreterAvailable('sqlite3');
  if (!isLocallyRunnable(language)) return false;
  if (language === 'cpp') return isInterpreterAvailable('g++');
  if (language === 'java') return (await isInterpreterAvailable('javac')) && isInterpreterAvailable('java');
  if (language === 'go') return isInterpreterAvailable('go', ['version']);
  if (language === 'python') return (await resolvePythonCmd()) !== null;
  return isInterpreterAvailable('node');
};

interface RawRun { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; oversized: boolean; ms: number; }

/**
 * Minimal, scrubbed environment: keep only PATH, and point every per-user and
 * temp dir at the throwaway `cwd`, so no secret/API key the main process holds
 * reaches model code and nothing it writes outlives the run.
 *   POSIX: HOME + TMPDIR.
 *   Windows: tools read USERPROFILE / LOCALAPPDATA / APPDATA and TEMP / TMP
 *          instead (Go puts its build cache in %LocalAppData% and refuses to
 *          build without it).
 */
export const sandboxEnv = (cwd: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: cwd,
  TMPDIR: cwd,
  ...(platform === 'win32'
    ? { USERPROFILE: cwd, LOCALAPPDATA: cwd, APPDATA: cwd, TEMP: cwd, TMP: cwd }
    : {}),
});

// Spawn the interpreter (`argv` = [cmd, ...prefixArgs]) on `scriptPath`, feeding
// the case via the TC env var.
const spawnOnce = (argv: string[], scriptPath: string, cwd: string, tcJson: string): Promise<RawRun> =>
  new Promise<RawRun>(resolve => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let oversized = false;
    let settled = false;

    const env: NodeJS.ProcessEnv = {
      ...sandboxEnv(cwd),
      [TC_ENV]: tcJson,
      // Python: don't write .pyc, force UTF-8; Node: cap old-space modestly.
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      NODE_OPTIONS: '--max-old-space-size=128',
    };

    const [cmd, ...prefixArgs] = argv;
    let child: ReturnType<typeof spawn>;
    try {
      // POSIX: detached:true puts the child in its OWN process group so we can
      // kill the WHOLE group (parent + any grandchildren the model code forked)
      // on timeout/oversize — a plain child.kill() would orphan a double-forked
      // grandchild past the 3s bound. On Windows there is no process group;
      // killTree() uses `taskkill /T` to walk the tree instead, so detaching
      // would only orphan the child from our handle without helping.
      child = spawn(cmd, [...prefixArgs, scriptPath], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWin, windowsHide: true });
    } catch (e: any) {
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }

    const finish = (extra: Partial<RawRun>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Reap the whole process group unconditionally — even on a NORMAL exit the
      // model code may have spawned a detached grandchild that would otherwise
      // outlive the parent past the 3s bound. Idempotent (parent already gone).
      killTree(child);
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    timer.unref?.();

    const cap = (buf: string, chunk: Buffer): string => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(child); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', (e) => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

/** Run ONE case for a (language, code, entry). Never throws. */
export const runCase = async (
  language: VerifyLanguage,
  code: string,
  entry: string,
  tc: TestCase,
  hints?: DriverHints,
): Promise<RunResult> => {
  // Compiled paths: build a per-case program, compile, run. (C++/Java derive
  // list/tree from the signature, so they ignore the dynamic-language hints.)
  if (language === 'cpp') return runCppCase(code, entry, tc);
  if (language === 'java') return runJavaCase(code, entry, tc);
  if (language === 'go') return runGoCase(code, entry, tc);

  const driver = buildDriver(language, code, entry, hints);
  if (!driver || !driver.localCmd) {
    return unverifiable(tc, `no local driver for ${language}`);
  }

  // Resolve the interpreter argv. `node` is the same everywhere; Python's command
  // is platform-dependent (python3 on POSIX, python/py on Windows) and is probed
  // and cached by resolvePythonCmd so the run uses the SAME interpreter the
  // availability check found.
  let argv: string[];
  if (driver.localCmd === 'python3') {
    const py = await resolvePythonCmd();
    if (!py) return unverifiable(tc, 'no python interpreter available');
    argv = py;
  } else {
    argv = [driver.localCmd];
  }

  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const scriptPath = path.join(tmpDir, `main.${driver.ext}`);
    fs.writeFileSync(scriptPath, driver.source, { encoding: 'utf8' });

    const tcJson = JSON.stringify(tc.input ?? []);
    const raw = await spawnOnce(argv, scriptPath, tmpDir, tcJson);

    if (raw.timedOut) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: raw.ms };
    if (raw.oversized) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: 'output limit exceeded', ms: raw.ms };

    const parsed = parseDriverResult(raw.stdout);
    if (!parsed.found) {
      // No sentinel result => a compile/runtime error (or entry-not-found).
      const errText = trunc(raw.stderr) || `exited with code ${raw.code ?? 'unknown'}`;
      return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: errText, ms: raw.ms };
    }

    // Smoke case has no expected value — running without error IS the pass.
    if (tc.source === 'smoke') {
      return { case: tc, status: 'pass', stdout: trunc(raw.stdout), actual: parsed.value, ms: raw.ms };
    }

    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(raw.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: raw.ms,
    };
  } catch (e: any) {
    return unverifiable(tc, String(e?.message || e).slice(0, 200));
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

const trunc = (s: string, max = 2000): string => (s.length > max ? s.slice(0, max) + '…' : s);

/** An `error` that says nothing about the code (see RunResult.unverifiable). */
const unverifiable = (tc: TestCase, error: string, ms = 0): RunResult =>
  ({ case: tc, status: 'error', stdout: '', error, ms, unverifiable: true });

// Linker diagnostics name the object file, not the source: GNU ld / MinGW
// "undefined reference to", Apple ld "Undefined symbols for architecture" and
// "symbol(s) not found", LLVM lld "undefined symbol:", plus duplicate symbols.
const LINK_ERROR = /undefined reference to|undefined symbols? for architecture|undefined symbol:|symbol\(s\) not found|duplicate symbol|multiple definition of/i;

/**
 * Whether a failed compile is the CODE's fault: the compiler points at a line
 * of the source file (`main.cpp:12:5`, `./main.go:4:6`, `.\main.go:4:6`,
 * `Main.java:3: error`) or the linker reports a missing/duplicate symbol. A
 * failure that does neither is the toolchain's own (no cache dir, broken
 * install, unwritable temp, a file locked by antivirus even if its path is in
 * the message); blaming the code for it would send a correct answer to be
 * "fixed".
 */
export const isCodeCompileError = (stderr: string, srcName: string): boolean =>
  new RegExp(`${srcName.replace(/\./g, '\\.')}:\\d+`).test(stderr) || LINK_ERROR.test(stderr);

const compileFailure = (tc: TestCase, comp: RawRun, srcName: string, tool: string): RunResult => {
  const detail = trunc(comp.stderr, 400) || `${tool} failed`;
  return isCodeCompileError(comp.stderr, srcName)
    ? { case: tc, status: 'error', stdout: '', error: `compile error: ${detail}`, ms: comp.ms }
    : unverifiable(tc, `${tool} failed: ${detail}`, comp.ms);
};

/**
 * Run budget for a freshly compiled program (C++/Go binary, the JVM for Java).
 * Windows gets 10s: antivirus scans a new, unsigned executable on its first
 * launch, and a run timeout counts against the code (it is how an infinite
 * loop is caught), so a scan must not look like one. Elsewhere TIMEOUT_MS.
 */
export const compiledRunTimeoutMs = (platform: NodeJS.Platform = process.platform): number =>
  platform === 'win32' ? 10000 : TIMEOUT_MS;

// Generic spawn of an arbitrary command (no TC env; used for g++/javac compile,
// the compiled binary, go run, and sqlite3). Same limits as spawnOnce: timeout,
// output cap, group kill, scrubbed env. `stdinPath`, when given, is opened and
// piped to the child's stdin (used to feed the SQL script to sqlite3).
// `extraEnv` adds tool settings (never secrets) on top of the sandbox env.
const spawnCmd = (
  cmd: string, args: string[], cwd: string, timeoutMs: number, stdinPath?: string, extraEnv?: NodeJS.ProcessEnv,
): Promise<RawRun> =>
  new Promise<RawRun>(resolve => {
    const start = Date.now();
    let stdout = '', stderr = '', timedOut = false, oversized = false, settled = false;
    const env = { ...sandboxEnv(cwd), ...extraEnv };
    let stdinFd: number | undefined;
    if (stdinPath) { try { stdinFd = fs.openSync(stdinPath, 'r'); } catch { /* fall back to ignore */ } }
    let child: ReturnType<typeof spawn>;
    try {
      // detached only on POSIX (own process group for negative-pid group-kill);
      // on Windows killTree() walks the tree via taskkill instead. See spawnOnce.
      child = spawn(cmd, args, { cwd, env, stdio: [stdinFd ?? 'ignore', 'pipe', 'pipe'], detached: !isWin, windowsHide: true });
    } catch (e: any) {
      if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* noop */ } }
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }
    if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* child owns it now */ } }
    const finish = (extra: Partial<RawRun>) => {
      if (settled) return; settled = true; clearTimeout(timer);
      killTree(child); // reap any detached grandchild even on normal exit (idempotent)
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    timer.unref?.();
    const cap = (buf: string, chunk: Buffer): string => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(child); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', e => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

// Compile time can exceed the run budget for C++; give the compiler its own,
// larger window (still bounded) and the binary the standard TIMEOUT_MS. 30s,
// not 10s: MinGW g++ on a slow Windows machine (antivirus scanning each new
// file) takes 7-10s for one case. Verification runs in the background, so a
// slow compile only delays the badge, and a timeout is unverifiable, not wrong.
const CPP_COMPILE_TIMEOUT_MS = 30000;

/** Run ONE C++ case: build per-case program → g++ compile → run binary. */
const runCppCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  // Validate entry as a plain identifier BEFORE it reaches any RegExp/template
  // (parseCppSignature interpolates it into a RegExp). Mirrors the Python/JS
  // buildDriver guard so a malformed entry is a clean per-case skip, never a
  // throw that aborts the whole batch and never an injection channel.
  if (!isValidEntry(entry)) {
    return unverifiable(tc, 'invalid_entry');
  }
  const program = buildCppProgram(code, entry, tc);
  if (program === null) {
    // Signature/args not safely representable → skip (never a false verdict).
    return unverifiable(tc, 'cpp_signature_unsupported');
  }
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'main.cpp');
    const binPath = path.join(tmpDir, 'a.out');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });

    const comp = await spawnCmd('g++', ['-std=c++17', '-O0', '-w', srcPath, '-o', binPath], tmpDir, CPP_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return unverifiable(tc, `compile timed out after ${CPP_COMPILE_TIMEOUT_MS}ms`, comp.ms);
    if (comp.code !== 0 || !fs.existsSync(binPath)) return compileFailure(tc, comp, 'main.cpp', 'g++');

    const runMs = compiledRunTimeoutMs();
    const run = await spawnCmd(binPath, [], tmpDir, runMs);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${runMs}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };

    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return unverifiable(tc, String(e?.message || e).slice(0, 200));
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

// javac is slow to start; give compile a larger (bounded) window than run.
const JAVA_COMPILE_TIMEOUT_MS = 20000;

/** Run ONE Java case: build Main.java → javac → java Main. Never throws. */
const runJavaCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  if (!isValidEntry(entry)) return unverifiable(tc, 'invalid_entry');
  const program = buildJavaProgram(code, entry, tc);
  if (program === null) return unverifiable(tc, 'java_signature_unsupported');
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'Main.java');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });

    const comp = await spawnCmd('javac', ['-d', tmpDir, srcPath], tmpDir, JAVA_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return unverifiable(tc, `compile timed out after ${JAVA_COMPILE_TIMEOUT_MS}ms`, comp.ms);
    if (comp.code !== 0 || !fs.existsSync(path.join(tmpDir, 'Main.class'))) return compileFailure(tc, comp, 'Main.java', 'javac');

    const runMs = compiledRunTimeoutMs();
    const run = await spawnCmd('java', ['-cp', tmpDir, 'Main'], tmpDir, runMs);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${runMs}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };

    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return unverifiable(tc, String(e?.message || e).slice(0, 200));
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

const SQL_TIMEOUT_MS = 4000;

/**
 * Run a SQL answer: schema + seeds + the model's SELECT in `sqlite3 -safe -bail
 * :memory:`, judge the result set. Never throws. Safety: `-safe` blocks
 * ATTACH/.read/.output/extension-load/all fs dot-commands; `-bail` makes any
 * sqlite error stop with a non-zero exit → we return `error` (skip), NOT `fail`.
 * A `fail` is produced ONLY when the query ran cleanly and the rows differ from
 * expected — so a MySQL-dialect-only query (errors on sqlite) is never a false
 * fail. Non-SELECT queries are rejected upstream by buildSqlScript → skip.
 */
export const runSqlCase = async (query: string, spec: SqlSpec): Promise<RunResult> => {
  const tc: TestCase = { input: [], expected: spec.expected, source: 'problem' };
  const script = buildSqlScript(query, spec.schema, spec.seeds || []);
  if (script === null) {
    return { case: tc, status: 'error', stdout: '', error: 'sql_not_verifiable', ms: 0 };
  }
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const scriptPath = path.join(tmpDir, 'script.sql');
    fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });

    const run = await spawnCmd('sqlite3', ['-safe', '-bail', ':memory:'], tmpDir, SQL_TIMEOUT_MS, scriptPath);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${SQL_TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    // Any sqlite error (-bail → non-zero exit, e.g. MySQL-only constructs, bad
    // column) is an HONEST "couldn't verify", never a wrong-answer verdict.
    if (run.code !== 0) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `sql error: ${trunc(run.stderr, 300) || `exit ${run.code}`}`, ms: run.ms };
    }
    const parsed = parseSqlRows(run.stdout);
    if (!parsed.found || !parsed.rows) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'sql result not parseable', ms: run.ms };
    }
    const ok = compareResultSet(parsed.rows, spec.expected, spec.ordered === true);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.rows,
      error: ok ? undefined : `expected ${renderValue(spec.expected)}, got ${renderValue(parsed.rows)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return unverifiable(tc, String(e?.message || e).slice(0, 200));
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

// Go builds, then runs the binary like C++, so a cold toolchain and a slow
// program are told apart: the build gets its own generous window, the program
// compiledRunTimeoutMs(). The build cache is SHARED across runs (Go's cache is
// content-addressed and safe for concurrent builds), so only the first build on
// a machine compiles the standard library from cold. 60s covers that first
// build on a slow Windows machine; verification is in the background, and a
// build timeout is unverifiable, never "the code is wrong".
const GO_BUILD_TIMEOUT_MS = 60000;
const goBuildEnv = (): NodeJS.ProcessEnv => ({ GOCACHE: path.join(os.tmpdir(), 'natively-verify-gocache') });

/** Run ONE Go case: build main.go → run the binary. Never throws. */
const runGoCase = async (code: string, entry: string, tc: TestCase): Promise<RunResult> => {
  if (!isValidEntry(entry)) return unverifiable(tc, 'invalid_entry');
  const program = buildGoProgram(code, entry, tc);
  if (program === null) return unverifiable(tc, 'go_signature_unsupported');
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'main.go');
    const binPath = path.join(tmpDir, isWin ? 'main.exe' : 'main');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });

    const comp = await spawnCmd('go', ['build', '-o', binPath, srcPath], tmpDir, GO_BUILD_TIMEOUT_MS, undefined, goBuildEnv());
    if (comp.timedOut) return unverifiable(tc, `go build timed out after ${GO_BUILD_TIMEOUT_MS}ms`, comp.ms);
    if (comp.code !== 0 || !fs.existsSync(binPath)) return compileFailure(tc, comp, 'main.go', 'go build');

    const runMs = compiledRunTimeoutMs();
    const run = await spawnCmd(binPath, [], tmpDir, runMs);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${runMs}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) {
      return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc,
      status: ok ? 'pass' : 'fail',
      stdout: trunc(run.stdout),
      actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`,
      ms: run.ms,
    };
  } catch (e: any) {
    return unverifiable(tc, String(e?.message || e).slice(0, 200));
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};
