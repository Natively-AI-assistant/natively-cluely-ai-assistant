// electron/llm/codeVerification/__tests__/WindowsInterpreter.test.mjs
//
// Regression tests for the Windows interpreter-resolution + process-kill fix.
//
// BUG: localLanguageAvailable('python') probed the bare command `python3`. POSIX
// installs expose `python3`, but the python.org Windows installer ships
// `python.exe` + the `py` launcher and creates NO `python3` command (on Windows
// the bare `python3` usually resolves to the Microsoft Store App Execution Alias
// that no-ops for non-interactive spawns). So Python code-verification was
// silently skipped on Windows even with Python installed. The runner also used
// `process.kill(-pid)` group-kill, which throws on Windows (no POSIX groups).
//
// These tests pin: (1) the platform-correct candidate list, (2) that the
// availability probe and the actual run agree on ONE interpreter, and (3) that
// real Python execution still works on this host (POSIX regression guard for the
// spawnOnce/killTree refactor).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  PYTHON_CANDIDATES,
  localLanguageAvailable,
  runCase,
} from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const isWin = process.platform === 'win32';
const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('Windows interpreter resolution (issue follow-up to #304 audit)', () => {
  test('candidate list is platform-correct', () => {
    if (isWin) {
      const cmds = PYTHON_CANDIDATES.map(([cmd]) => cmd);
      // Windows MUST try `python` and `py` — not just `python3`, which the
      // python.org installer does not provide.
      assert.ok(cmds.includes('python'), 'Windows must probe `python`');
      assert.ok(cmds.includes('py'), 'Windows must probe the `py` launcher');
      // `py` must carry the -3 selector so it launches Python 3, not 2.
      const py = PYTHON_CANDIDATES.find(([cmd]) => cmd === 'py');
      assert.ok(py && py[1].includes('-3'), '`py` must be invoked with -3');
    } else {
      // POSIX is unchanged: python3 only.
      assert.deepEqual(
        PYTHON_CANDIDATES.map(([cmd]) => cmd),
        ['python3'],
        'POSIX must probe exactly python3 (no behavior change)',
      );
    }
  });

  test('every candidate probe ends in --version (so the run strips it off)', () => {
    for (const [, args] of PYTHON_CANDIDATES) {
      assert.equal(args[args.length - 1], '--version', 'probe arg list must end with --version');
    }
  });

  // The run path strips the trailing `--version` and keeps any launcher selector
  // (e.g. `-3`). This proves probe and run stay consistent: whatever interpreter
  // the availability check found is exactly what executes the model code.
  test('availability and execution agree on this host', async () => {
    const available = await localLanguageAvailable('python');
    const r = await runCase('python', 'def f(x):\n    return x + 1', 'f', tc([41], 42));
    if (available) {
      // If we said Python is available, the run MUST actually work — never a
      // silent "no python interpreter available" mismatch.
      assert.equal(r.status, 'pass', `python reported available but run failed: ${r.error}`);
    } else {
      // If unavailable, the run must report an honest error, not crash.
      assert.equal(r.status, 'error', 'unavailable python must yield an honest error verdict');
    }
  });

  test('node remains spawned verbatim cross-platform (unchanged)', async () => {
    const haveJs = await localLanguageAvailable('javascript');
    if (!haveJs) { return; } // node should always be present here, but stay green if not
    const r = await runCase('javascript', 'function f(x){return x+1;}', 'f', tc([41], 42));
    assert.equal(r.status, 'pass', r.error);
  });
});
