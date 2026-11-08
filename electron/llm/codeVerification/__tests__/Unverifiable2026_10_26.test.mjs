// electron/llm/codeVerification/__tests__/Unverifiable2026_10_26.test.mjs
//
// BUG: every non-pass run drove the one-shot correction, including runs that
// say nothing about the code. A compile that timed out on a slow Windows
// machine, or Windows' Go refusing to build ("GOCACHE is not defined"), sent a
// CORRECT answer back to the model to be "fixed" and showed the user
// "Corrected: the previous code failed to run". Such runs are now marked
// `unverifiable`: with no real failure the answer is left unverified (no badge,
// no correction). Go also builds then runs, so the build gets its own budget
// and a shared cache, and the program keeps the standard run timeout.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyCodingAnswer } from '../../../../dist-electron/electron/llm/codeVerification/verifyCodingAnswer.js';
import { runCase, localLanguageAvailable, isCodeCompileError, compiledRunTimeoutMs } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });
const answer = (code, entry, lang, cases) =>
  `## Code\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n<verification_spec>\n{"entry":"${entry}","language":"${lang}","cases":${cases}}\n</verification_spec>`;
const unverifiable = (t, error = 'compile timed out after 30000ms') => ({ case: t, status: 'error', stdout: '', error, ms: 1, unverifiable: true });

describe('verifyCodingAnswer: an unverifiable run is never grounds for a correction', () => {
  test('every run unverifiable → skipped as unverifiable, the corrector is never called', async () => {
    let corrections = 0;
    const events = [];
    const out = await verifyCodingAnswer({
      answer: answer('int add(int a, int b) { return a + b; }', 'add', 'cpp', '[{"input":[2,3],"expected":5},{"input":[1,1],"expected":2}]'),
      runCase: async (_l, _c, _e, t) => unverifiable(t),
      languageAvailable: async () => true,
      correct: async () => { corrections++; return ''; },
      onEvent: (n, p) => events.push([n, p]),
    });
    assert.equal(corrections, 0);
    assert.equal(out.corrected, undefined);
    assert.equal(out.verdict.passed, false);
    assert.equal(out.verdict.skipped, true);
    assert.equal(out.verdict.skipReason, 'unverifiable');
    assert.equal(out.verdict.firstFailure, undefined);
    assert.deepEqual(events.find(([n]) => n === 'code_verify_skipped')?.[1], { reason: 'unverifiable', language: 'cpp' });
  });

  test('after the first unverifiable run the remaining cases are not run (same code, same toolchain)', async () => {
    let calls = 0;
    const out = await verifyCodingAnswer({
      answer: answer('int add(int a, int b) { return a + b; }', 'add', 'cpp', '[{"input":[2,3],"expected":5},{"input":[1,1],"expected":2},{"input":[0,0],"expected":0}]'),
      runCase: async (_l, _c, _e, t) => { calls++; return unverifiable(t); },
      languageAvailable: async () => true,
    });
    assert.equal(calls, 1);
    assert.equal(out.verdict.skipReason, 'unverifiable');
  });

  test('a real failure before an unverifiable run still drives the correction, from the real failure', async () => {
    let prompt = '';
    const out = await verifyCodingAnswer({
      answer: answer('int add(int a, int b) { return a - b; }', 'add', 'cpp', '[{"input":[1,1],"expected":2},{"input":[2,3],"expected":5}]'),
      runCase: async (_l, _c, _e, t) => t.expected === 5
        ? unverifiable(t)
        : { case: t, status: 'fail', stdout: '', actual: 0, error: 'expected 2, got 0', ms: 1 },
      languageAvailable: async () => true,
      correct: async (p) => { prompt = p; return ''; },
    });
    assert.equal(out.verdict.skipped, false);
    assert.equal(out.verdict.firstFailure.status, 'fail');
    assert.match(prompt, /it returned 0 but the correct output is 2/);
  });

  test('a plain error (the code crashed or did not compile) still drives the correction', async () => {
    let corrections = 0;
    await verifyCodingAnswer({
      answer: answer('int add(int a, int b) { return a + b }', 'add', 'cpp', '[{"input":[2,3],"expected":5}]'),
      runCase: async (_l, _c, _e, t) => ({ case: t, status: 'error', stdout: '', error: 'compile error: main.cpp:3: expected ;', ms: 1 }),
      languageAvailable: async () => true,
      correct: async () => { corrections++; return ''; },
    });
    assert.equal(corrections, 1);
  });
});

// A stand-in toolchain first on PATH. The sandbox env takes PATH at spawn time.
// POSIX only: spawn() without a shell cannot launch a .cmd stand-in on Windows.
const posix = process.platform !== 'win32';
const withFakeTool = async (name, script, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-fake-tool-'));
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  try { return await fn(); } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Real compiler/linker output, as each toolchain prints it.
describe('isCodeCompileError: the code\'s fault only when the compiler points into it, or the linker misses a symbol', () => {
  const codes = [
    ['main.cpp', '/var/folders/x/T/natively-verify-a1/main.cpp:3:28: error: expected \';\' after return statement'],
    ['main.cpp', 'C:\\Users\\Ana Lee\\AppData\\Local\\Temp\\natively-verify-a1\\main.cpp:3:28: error: expected \';\' before \'}\' token'],
    ['main.cpp', 'C:/msys64/ucrt64/bin/../lib/gcc/x86_64-w64-mingw32/14.2.0/../../../../x86_64-w64-mingw32/bin/ld.exe: C:\\Users\\x\\AppData\\Local\\Temp\\ccA1.o:main.cpp:(.text+0x15): undefined reference to `helper(int)\''],
    ['main.cpp', '/usr/bin/ld: /tmp/ccA1.o: in function `Solution::f(int)\':\nmain.cpp:(.text+0x15): undefined reference to `Solution::MOD\''],
    ['main.cpp', 'Undefined symbols for architecture arm64:\n  "Solution::MOD", referenced from:\n      Solution::f(int) in main-268c15.o\nld: symbol(s) not found for architecture arm64'],
    ['main.cpp', 'ld.lld: error: undefined symbol: helper(int)\n>>> referenced by /tmp/main-1a2b.o'],
    ['main.cpp', 'duplicate symbol \'_helper\' in:\n    /tmp/main-1.o'],
    ['main.go', '# command-line-arguments\n./main.go:4:6: undefined: x'],
    ['main.go', '# command-line-arguments\n.\\main.go:4:6: syntax error: unexpected newline'],
    ['Main.java', '/tmp/natively-verify-a1/Main.java:3: error: \';\' expected'],
  ];
  const toolchains = [
    ['main.go', 'build cache is required, but could not be located: GOCACHE is not defined and %LocalAppData% is not defined'],
    ['main.go', 'open C:\\Users\\x\\AppData\\Local\\Temp\\natively-verify-a1\\main.go: The process cannot access the file because it is being used by another process.'],
    ['main.cpp', 'g++: fatal error: cannot execute \'cc1plus\': CreateProcess: No such file or directory'],
    ['main.cpp', 'clang++: error: no such file or directory: \'/tmp/natively-verify-a1/main.cpp\''],
    ['Main.java', 'error: file not found: Main.java'],
    ['main.cpp', ''],
  ];
  for (const [src, err] of codes) test(`code: ${err.split('\n').pop().slice(0, 70)}`, () => assert.equal(isCodeCompileError(err, src), true));
  for (const [src, err] of toolchains) test(`toolchain: ${err.slice(0, 70) || '(no output)'}`, () => assert.equal(isCodeCompileError(err, src), false));
});

describe('compiledRunTimeoutMs', () => {
  test('Windows allows for antivirus scanning a new executable; elsewhere the standard 3s', () => {
    assert.equal(compiledRunTimeoutMs('win32'), 10000);
    assert.equal(compiledRunTimeoutMs('darwin'), 3000);
    assert.equal(compiledRunTimeoutMs('linux'), 3000);
  });
});

describe('runners: a toolchain that fails on its own is unverifiable, not a compile error', () => {
  test('go that cannot build for its own reasons (Windows: no GOCACHE / %LocalAppData%)', { skip: posix ? false : 'POSIX stand-in' }, async () => {
    const r = await withFakeTool('go', 'echo "build cache is required, but could not be located: GOCACHE is not defined and %LocalAppData% is not defined" >&2; exit 1', () =>
      runCase('go', 'func add(a, b int) int { return a+b }', 'add', tc([2, 3], 5)));
    assert.equal(r.status, 'error');
    assert.equal(r.unverifiable, true, r.error);
    assert.match(r.error, /^go build failed: build cache is required/);
  });

  test('go build is pointed at the shared cache under the temp dir', { skip: posix ? false : 'POSIX stand-in' }, async () => {
    const out = path.join(os.tmpdir(), `natively-gocache-probe-${process.pid}`);
    try {
      await withFakeTool('go', `printf %s "$GOCACHE" > "${out}"; exit 1`, () =>
        runCase('go', 'func add(a, b int) int { return a+b }', 'add', tc([2, 3], 5)));
      assert.equal(fs.readFileSync(out, 'utf8'), path.join(os.tmpdir(), 'natively-verify-gocache'));
    } finally { fs.rmSync(out, { force: true }); }
  });

  test('g++ that fails without naming the source file', { skip: posix ? false : 'POSIX stand-in' }, async () => {
    const r = await withFakeTool('g++', 'echo "g++: fatal error: cannot execute cc1plus" >&2; exit 1', () =>
      runCase('cpp', 'class Solution{public:int f(int x){return x;}};', 'f', tc([1], 1)));
    assert.equal(r.unverifiable, true, r.error);
  });

  test('g++ pointing into the source file is the code\'s compile error, as before', { skip: posix ? false : 'POSIX stand-in' }, async () => {
    const r = await withFakeTool('g++', 'echo "main.cpp:1:40: error: expected \';\'" >&2; exit 1', () =>
      runCase('cpp', 'class Solution{public:int f(int x){return x;}};', 'f', tc([1], 1)));
    assert.equal(r.unverifiable, undefined, r.error);
    assert.match(r.error, /^compile error: main\.cpp:1:40: error/);
  });
});

describe('Go: build, then run the binary (real toolchain, gated)', async () => {
  const have = await localLanguageAvailable('go');
  const maybe = (n, f) => test(n, { skip: have ? false : 'go unavailable' }, f);

  maybe('a correct answer passes', async () => {
    const r = await runCase('go', 'func add(a, b int) int { return a+b }', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('a compile error in the code is the code\'s fault (drives a correction)', async () => {
    const r = await runCase('go', 'func f(x int) int { return x', 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.equal(r.unverifiable, undefined, r.error);
    assert.match(r.error, /^compile error: .*main\.go/s);
  });
  maybe('an infinite loop is killed by the standard run timeout, and is the code\'s fault', async () => {
    const r = await runCase('go', 'func f(x int) int { for { }; return x }', 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.equal(r.unverifiable, undefined);
    assert.match(r.error, new RegExp(`^timed out after ${compiledRunTimeoutMs()}ms`));
  });
});

describe('C++: a link error in the code is the code\'s fault (real toolchain, gated)', async () => {
  const have = await localLanguageAvailable('cpp');
  const maybe = (n, f) => test(n, { skip: have ? false : 'g++ unavailable' }, f);
  maybe('a function declared but never defined', async () => {
    const r = await runCase('cpp', 'int helper(int); class Solution{public:int f(int x){return helper(x);}};', 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.equal(r.unverifiable, undefined, r.error);
    assert.match(r.error, /^compile error: /);
  });
});
