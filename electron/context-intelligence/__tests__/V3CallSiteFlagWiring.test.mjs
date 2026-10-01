// Every buildV3Prompt call site must pass the chat-history rollback flag.
//
// `multiTurnHistory` is read inside engine-bridge, but reading it only matters
// if the CALLER sends it. For a while only ipcHandlers did: the three
// IntelligenceEngine call sites left it undefined, so `=== false` was never
// true and the Settings toggle rolled back typed chat while live spoken answers
// kept the new behaviour with no way to revert.
//
// That is invisible in a unit test of the bridge — the bridge is correct. Only
// a sweep of the call sites can see it, which is what this is.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FILES = ['electron/ipcHandlers.ts', 'electron/IntelligenceEngine.ts'];

/** Each `buildV3Prompt({ … })` call with its brace-matched argument object. */
function callSites(src, file) {
  const out = [];
  const needle = 'buildV3Prompt({';
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    let depth = 0, j = i + needle.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ file, line: src.slice(0, i).split('\n').length, body: src.slice(i, j + 1) });
  }
  return out;
}

describe('buildV3Prompt call sites', () => {
  const sites = FILES.flatMap((f) => callSites(fs.readFileSync(path.join(REPO, f), 'utf8'), f));

  test('there are call sites to check — the sweep is not vacuous', () => {
    assert.ok(sites.length >= 4, `expected at least 4 call sites, found ${sites.length}`);
  });

  test('every one passes multiTurnHistory, so the rollback reaches every surface', () => {
    const missing = sites
      .filter((s) => !/multiTurnHistory\s*:/.test(s.body))
      .map((s) => `${s.file}:${s.line}`);
    assert.deepEqual(missing, [],
      'these buildV3Prompt call sites do not pass multiTurnHistory, so the chat-history ' +
      'toggle cannot roll their surface back:\n  ' + missing.join('\n  '));
  });
});
