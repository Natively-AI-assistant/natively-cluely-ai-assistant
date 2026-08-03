/**
 * Cross-platform replacement for the POSIX `VAR=value CMD` prefix form,
 * including `${VAR:-default}` fallbacks.
 *
 * Why this exists:
 *
 *   npm runs package scripts through `cmd.exe` on Windows. cmd has no inline
 *   env-var prefix — `FOO=1 node x.js` is parsed as a command literally named
 *   `FOO=1` — and no `${VAR:-default}` expansion, so the token reaches the
 *   program verbatim. That is why `test:e2e:parity` passed the literal string
 *   "${ELECTRON_APP_PORT:-5173}" to Playwright on Windows.
 *
 *   `cross-env` fixes the prefix half but has no fallback syntax, which is
 *   precisely what those scripts relied on.
 *
 * Usage:
 *
 *   node scripts/run-with-env.mjs [options] -- <command> [args]
 *
 *   --set KEY=VALUE              always set KEY to VALUE
 *   --default KEY=VALUE          set KEY to VALUE only when unset or empty
 *                                (the `${KEY:-VALUE}` equivalent)
 *   --default-tmpdir KEY=SUBDIR  set KEY to <os.tmpdir()>/SUBDIR only when
 *                                unset or empty (the `${TMPDIR:-/tmp}/x`
 *                                equivalent — TMPDIR is a POSIX-ism and /tmp
 *                                does not exist on Windows)
 *
 * The option syntax deliberately contains no `$`, `{`, `}` or `?`: those are
 * metacharacters to `/bin/sh` and would be expanded (differently, or not at
 * all) before this script ever ran. Everything here is inert on both shells.
 *
 * The exported helpers are pure and platform-parameterised so both platform
 * branches can be tested from either host — see scripts/__tests__/.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

/** Thrown for usage errors so callers (and tests) can distinguish them. */
export class UsageError extends Error {}

function splitAssignment(option, token) {
  const eq = token.indexOf('=');
  if (eq <= 0) throw new UsageError(`${option} expects KEY=VALUE, got: ${token}`);
  return [token.slice(0, eq), token.slice(eq + 1)];
}

/**
 * Apply `--set` / `--default` / `--default-tmpdir` assignments to a base
 * environment. Returns a new object; `baseEnv` is not mutated.
 *
 * `tmpdir` is injectable so the Windows and POSIX shapes are both testable
 * from either host.
 */
export function applyEnv(assignments, baseEnv = {}, tmpdir = os.tmpdir()) {
  const env = { ...baseEnv };

  for (let i = 0; i < assignments.length; i++) {
    const option = assignments[i];
    const token = assignments[++i];

    if (token === undefined) throw new UsageError(`${option} is missing its KEY=VALUE argument`);

    const [key, value] = splitAssignment(option, token);

    switch (option) {
      case '--set':
        env[key] = value;
        break;

      // `${KEY:-VALUE}` treats a set-but-empty variable as unset, which is
      // what `!env[key]` reproduces for every value except the string "0".
      // "0" is not a plausible value for the ports and directories this is
      // used for, and treating it as unset is the safer failure here.
      case '--default':
        if (!env[key]) env[key] = value;
        break;

      case '--default-tmpdir':
        if (!env[key]) env[key] = path.join(tmpdir, ...value.split('/').filter(Boolean));
        break;

      default:
        throw new UsageError(`Unknown option: ${option}`);
    }
  }

  return env;
}

/**
 * Resolve a command to something Node can spawn WITHOUT a shell.
 *
 * On Windows, node_modules/.bin entries are `.cmd` shims, and Node refuses to
 * spawn `.cmd`/`.bat` without `shell: true` (the CVE-2024-27980 mitigation).
 * Resolving the dependency's own JS entrypoint from its package.json `bin`
 * field sidesteps the shims entirely and behaves identically on macOS.
 *
 * A command that does not resolve to a local dependency is a hard error rather
 * than a PATH lookup. The obvious fallback — `spawnSync(name, args, { shell:
 * true })` — is NOT safe: with `shell: true` Node joins the arguments into a
 * single command line with no per-argument quoting, so any value containing a
 * space is split in two and cmd metacharacters (`&`, `|`, `^`, `>`) are
 * interpreted. Failing loudly beats silently mangling a path like
 * "C:\Program Files\...".
 */
export function resolveCommand(
  name,
  { execPath = process.execPath, paths = [repoRoot], resolve = require.resolve, load = require } = {}
) {
  if (name === 'node') return { file: execPath, args: [] };

  let manifestPath;
  try {
    manifestPath = resolve(`${name}/package.json`, { paths });
  } catch {
    throw new UsageError(
      `"${name}" is not a resolvable local dependency. run-with-env only launches ` +
        `binaries it can resolve from a package.json "bin" field, because a PATH ` +
        `fallback would require a shell and lose argument quoting on Windows.`
    );
  }

  const bin = load(manifestPath).bin;
  const relative = typeof bin === 'string' ? bin : bin && (bin[name] || Object.values(bin)[0]);

  if (!relative) {
    throw new UsageError(`"${name}" resolves but declares no "bin" entrypoint in its package.json.`);
  }

  return { file: execPath, args: [path.join(path.dirname(manifestPath), relative)] };
}

/**
 * Map a spawnSync result to the exit code `sh` would have produced.
 * Signal deaths become 128+N (130 for SIGINT, 137 for SIGKILL) so callers can
 * tell "operator cancelled" and "OOM-killed" apart from a real failure.
 */
export function exitCodeFor(result, signals = os.constants.signals) {
  if (result.error) return 1;
  if (result.status === null) return 128 + (signals[result.signal] ?? 0);
  return result.status;
}

function main(argv) {
  const separator = argv.indexOf('--');

  if (separator === -1) {
    throw new UsageError(
      'Usage: node scripts/run-with-env.mjs [--set|--default|--default-tmpdir KEY=VALUE ...] -- <command> [args]'
    );
  }

  const env = applyEnv(argv.slice(0, separator), process.env);
  const [command, ...commandArgs] = argv.slice(separator + 1);

  if (!command) throw new UsageError('No command given after "--".');

  const { file, args } = resolveCommand(command);
  const result = spawnSync(file, [...args, ...commandArgs], { stdio: 'inherit', env });

  if (result.error) {
    console.error(`[run-with-env] Failed to launch "${command}": ${result.error.message}`);
  } else if (result.status === null) {
    console.error(`[run-with-env] "${command}" terminated by signal ${result.signal || 'unknown'}`);
  }

  return exitCodeFor(result);
}

// Only run when invoked directly, so tests can import the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`[run-with-env] ${error.message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
