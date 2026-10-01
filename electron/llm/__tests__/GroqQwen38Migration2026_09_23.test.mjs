// electron/llm/__tests__/GroqQwen38Migration2026_09_23.test.mjs
//
// Groq shut `qwen/qwen3.6-27b` down on 2026-09-14 (free and developer tiers)
// and named `qwen/qwen3.8-27b` as the replacement
// (console.groq.com/docs/deprecations). 3.8 has the same shape: text + image
// input, 16,384 max completion tokens, preview tier, `reasoning_effort:'none'`
// to switch thinking off (console.groq.com/docs/model/qwen/qwen3.8-27b).
//
// What it cost while the app still pointed at 3.6: every fresh process paid a
// doomed round trip to the dead id before the known-gone memo kicked in; every
// Groq text answer then ran on gpt-oss-120b (reasoning before its first token);
// and Groq vision had NO model — groqSupportsImages matched only /qwen3\.6/.
//
// The 2026-08-23 migration's lesson was that the Groq default lives in many
// hand-written places (routing, baselines, the default-model repair, the
// picker, labels), and a site that is missed keeps serving the dead id. This
// pins every one of them to GROQ_PRIMARY_MODEL so the NEXT retirement is a
// one-line change that this file turns red until it is finished.
//
// Platform: pure constants and source text — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/GroqQwen38Migration2026_09_23.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');
const load = (rel) => import(pathToFileURL(path.resolve(repoRoot, rel)).href);

const gm = await load('dist-electron/electron/llm/groqModels.js');
const { getModelCapabilities } = await load('dist-electron/electron/llm/modelCapabilities.js');
const PRIMARY = gm.GROQ_PRIMARY_MODEL;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

describe('the live Groq id', () => {
  test('is the named successor, and the old one is retired', () => {
    assert.equal(PRIMARY, 'qwen/qwen3.8-27b');
    assert.equal(gm.GROQ_VISION_MODEL, PRIMARY, 'text and vision still share one id');
    assert.equal(gm.isRetiredModelId('qwen/qwen3.6-27b'), true);
    assert.equal(gm.isRetiredModelId(PRIMARY), false);
  });

  test('THE VISION FAILURE: the new id is recognised as image-capable', () => {
    assert.equal(gm.groqSupportsImages(PRIMARY), true);
    assert.equal(getModelCapabilities(PRIMARY, false).supportsImages, true);
    assert.equal(getModelCapabilities(PRIMARY, false).tier, 'cloud');
  });

  test('text-only Groq models still do not claim images', () => {
    for (const id of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3-32b']) {
      assert.equal(gm.groqSupportsImages(id), false, id);
    }
  });

  test('thinking stays off on the new id', () => {
    assert.deepEqual(gm.groqReasoningParams(PRIMARY), { reasoning_effort: 'none' });
  });
});

describe('every hand-written default site names the live id (drift guard)', () => {
  const sites = [
    ['routing default', 'electron/llm/ProviderRouter.ts', new RegExp(`model: '${esc(PRIMARY)}',`)],
    ['per-provider default', 'electron/llm/ProviderRouter.ts', new RegExp(`'groq': '${esc(PRIMARY)}',`)],
    ['vision baseline', 'electron/services/ModelVersionManager.ts', new RegExp(`\\[ModelFamily\\.GROQ_LLAMA\\]: '${esc(PRIMARY)}',`)],
    ['text baseline', 'electron/services/ModelVersionManager.ts', new RegExp(`\\[TextModelFamily\\.GROQ\\]: '${esc(PRIMARY)}',`)],
    ['default-model repair', 'electron/ipcHandlers.ts', new RegExp(`modelAvailable\\('${esc(PRIMARY)}'\\) \\? '${esc(PRIMARY)}'`)],
    ['picker, first Groq entry', 'src/utils/modelUtils.ts', new RegExp(`ids: \\['${esc(PRIMARY)}',`)],
    ['auto-assigned defaults', 'electron/services/CredentialsManager.ts', new RegExp(`'${esc(PRIMARY)}',`)],
    // No 'Help text' site: Setup & Help was rewritten (2026-09-25) to name no
    // provider default models — the stale ids it carried were why it drifted — so
    // there is no hand-written default left there to guard.
    ['Hindsight sidecar default', 'scripts/hindsight-llm-config.mjs', new RegExp(`'groq/${esc(PRIMARY)}'`)],
  ];
  for (const [name, file, re] of sites) {
    test(`${name} (${file})`, () => assert.match(src(file), re));
  }

  test('no live routing/baseline site still names the retired id', () => {
    for (const file of ['electron/llm/ProviderRouter.ts', 'electron/services/ModelVersionManager.ts', 'src/utils/modelUtils.ts', 'scripts/hindsight-llm-config.mjs']) {
      assert.doesNotMatch(src(file), /'(groq\/)?qwen\/qwen3\.6-27b'/, file);
    }
  });

  test('the retired id stays auto-assigned, so a user sitting on it is still promoted off', () => {
    assert.match(src('electron/services/CredentialsManager.ts'), /'qwen\/qwen3\.6-27b',\s*\n\s*'qwen\/qwen3\.8-27b',/);
  });

  test('both display-name maps know the new id (no raw slug in the UI)', () => {
    assert.match(src('src/components/ui/ModelSelector.tsx'), /model === 'qwen\/qwen3\.8-27b'\) return 'Groq Qwen 3\.8'/);
    assert.match(src('src/components/NativelyInterface.tsx'), /m === 'qwen\/qwen3\.8-27b'\) return 'Groq Qwen 3\.8'/);
  });
});
