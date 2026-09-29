// electron/llm/__tests__/StreamFaultInjection2026_08_14.test.mjs
//
// The post-commit guard (trackCommit) and the runaway output cap (capOutput)
// only fire when a provider misbehaves, so neither could be observed in a real
// app run. The honest status was "confirmed not to break anything; not
// confirmed to work" — a bad place for a guard whose whole job is a rare
// failure. These switches make both provokable.
//
// The switches themselves are now product code, so they need the same scrutiny:
// a fault injector that could activate in a shipped build would be far worse
// than the bugs it exists to demonstrate.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../streamFaultInjection.ts');
const src = fs.readFileSync(SRC, 'utf8');
const llmSrc = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

const MOD = '../../../dist-electron/electron/llm/streamFaultInjection.js';

/** Re-import with a specific env so the module-level gate is re-evaluated. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn(await import(MOD));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('the switches are OFF unless explicitly requested', () => {
  test('no env vars -> both disabled', async () => {
    await withEnv(
      { NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS: undefined, NATIVELY_TEST_STREAM_OUTPUT_CHARS: undefined },
      (m) => {
        assert.equal(m.failStreamAfterChars(), null);
        assert.equal(m.testOutputCharCeiling(), null);
      },
    );
  });

  test('nonsensical values are rejected rather than obeyed', async () => {
    // `0` matters most: a zero-char fault would fire BEFORE any output, which
    // is the pre-commit case that already fails over correctly — obeying it
    // would demonstrate the wrong thing. A zero ceiling would truncate every
    // answer to nothing.
    for (const bad of ['0', '-5', 'lots', '', 'NaN']) {
      await withEnv(
        { NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS: bad, NATIVELY_TEST_STREAM_OUTPUT_CHARS: bad },
        (m) => {
          assert.equal(m.failStreamAfterChars(), null, `fail-after accepted ${JSON.stringify(bad)}`);
          assert.equal(m.testOutputCharCeiling(), null, `ceiling accepted ${JSON.stringify(bad)}`);
        },
      );
    }
  });

  test('valid values are honoured', async () => {
    await withEnv({ NATIVELY_TEST_FAIL_STREAM_AFTER_CHARS: '40' }, (m) => {
      assert.equal(m.failStreamAfterChars(), 40);
    });
    await withEnv({ NATIVELY_TEST_STREAM_OUTPUT_CHARS: '250' }, (m) => {
      assert.equal(m.testOutputCharCeiling(), 250);
    });
  });
});

describe('a packaged build ignores the switches entirely', () => {
  // The load-bearing safety property: a stray env var in a real user's shell
  // must never be able to break their answers.
  test('the gate consults app.isPackaged', () => {
    assert.match(src, /isPackaged/, 'the gate must consult app.isPackaged');
    assert.match(src, /return !app\.isPackaged/, 'a packaged build must disable injection');
  });

  test('every switch goes through the gate', () => {
    // A new switch added without the gate would be enabled in production.
    const exported = [...src.matchAll(/export function (\w+)\(/g)].map((m) => m[1]);
    assert.ok(exported.length >= 2, 'expected at least two switches');
    for (const fn of exported) {
      const start = src.indexOf(`export function ${fn}(`);
      const body = src.slice(start, src.indexOf('\n}', start));
      assert.match(
        body,
        /faultInjectionAllowed\(\)/,
        `${fn} does not consult faultInjectionAllowed() — it would be live in a packaged build`,
      );
    }
  });

  test('the gate resolves Electron lazily so pure-logic tests still load', () => {
    // A static `import { app } from 'electron'` would break every unit test
    // that imports this module outside an Electron main process.
    assert.doesNotMatch(src, /^import .*from 'electron'/m);
    assert.match(src, /require\('electron'\)/);
  });
});

describe('the fault is wired where the guard can see it', () => {
  test('the mid-stream fault throws from trackCommit, after the yield', () => {
    const start = llmSrc.indexOf('private async * trackCommit(');
    assert.ok(start > 0, 'could not locate trackCommit');
    const body = llmSrc.slice(start, llmSrc.indexOf('\n  private async * _streamChatInner', start));
    assert.match(body, /failStreamAfterChars\(\)/, 'trackCommit must consult the switch');
    const yieldIdx = body.indexOf('yield tok;');
    const throwIdx = body.indexOf('throw new InjectedStreamFault');
    assert.ok(yieldIdx > 0 && throwIdx > yieldIdx,
      'the fault must throw AFTER the yield — the point is a provider dying once output is already on screen');
  });

  test('both output-cap sites honour the test ceiling', () => {
    // There are two: the per-surface ceiling in _streamChatTracked and the
    // shared one in capOutput. A switch that only reached one would make the
    // other look bounded when it was not.
    const hits = (llmSrc.match(/testOutputCharCeiling\(\)/g) || []).length;
    assert.ok(hits >= 2, `expected both cap sites to consult the switch, found ${hits}`);
  });
});
