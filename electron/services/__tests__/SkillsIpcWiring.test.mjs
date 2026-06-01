// Regression test for the skills IPC bridge defect (2026-05-26).
//
// The original bug: `SkillsManager` existed, but there was no preload exposure,
// no `ipcMain.handle` registration, and no type contract. The renderer's optional
// chaining (`window.electronAPI?.skillsRefresh?.()`) made the missing methods
// resolve silently to `undefined`, so the Settings → Skills panel rendered empty
// and the "Open Folder" button was inert. This test prevents recurrence by
// asserting the full three-tier wiring (types / preload / handlers) AND that
// `SkillsManager.listSkills()` returns the built-in `humanize-ai-text` skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ---------------------------------------------------------------------------
// 1. Static wiring invariants — full three-tier contract
// ---------------------------------------------------------------------------
test('skills:list and skills:open-folder handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'skills:list') >= 0, 'skills:list handler must be registered');
  assert.ok(findSafeHandle(source, 'skills:open-folder') >= 0, 'skills:open-folder handler must be registered');

  // SkillsManager must be imported (handlers reference it).
  assert.match(source, /import\s*\{\s*SkillsManager\s*\}\s*from\s*['"]\.\/services\/SkillsManager['"]/);

  // Both handlers delegate to the singleton and have try/catch fallbacks so
  // a thrown error never reaches the renderer as a rejection (renderer would
  // otherwise show a generic IPC error).
  const listBlock = sliceSafeHandleBlock(source, 'skills:list');
  assert.match(listBlock, /SkillsManager\.getInstance\(\)\.listSkills\(\)/);
  assert.match(listBlock, /catch[\s\S]{0,200}return \[\]/);

  const openBlock = sliceSafeHandleBlock(source, 'skills:open-folder');
  assert.match(openBlock, /SkillsManager\.getInstance\(\)\.openSkillsFolder\(\)/);
  assert.match(openBlock, /catch[\s\S]{0,300}success:\s*false[\s\S]{0,120}path:\s*['"]['"]/);
});

test('preload exposes skillsRefresh / skillsOpenFolder on window.electronAPI', () => {
  const preload = read('electron/preload.ts');

  // Per Electron security guidance, expose narrow wrappers — never the raw
  // ipcRenderer. Both methods are thin `ipcRenderer.invoke(...)` calls.
  assert.match(preload, /skillsRefresh:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:list['"]\)/);
  assert.match(preload, /skillsOpenFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:open-folder['"]\)/);

  // Confirm they are inside the contextBridge.exposeInMainWorld('electronAPI', {...}) block.
  const exposeIdx = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'");
  assert.ok(exposeIdx >= 0, 'electronAPI must be exposed via contextBridge');
  assert.ok(preload.indexOf('skillsRefresh:', exposeIdx) > exposeIdx,
    'skillsRefresh must live inside the electronAPI contextBridge block');
});

test('electron.d.ts declares SkillSummary and the two skills methods', () => {
  const types = read('src/types/electron.d.ts');

  assert.match(types, /export interface SkillSummary\s*\{[\s\S]{0,200}id:\s*string;[\s\S]{0,200}source:\s*['"]builtin['"]\s*\|\s*['"]userData['"]/);
  assert.match(types, /skillsRefresh:\s*\(\)\s*=>\s*Promise<SkillSummary\[\]>/);
  assert.match(types, /skillsOpenFolder:\s*\(\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*path:\s*string;\s*error\?:\s*string\s*\}>/);
});

test('SkillsSettings renderer guards against a missing bridge instead of silent optional-chain', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  // The exact regression we are protecting against: a silent `?.skillsRefresh?.()`
  // (and the symmetric `?.skillsOpenFolder?.()`) that resolves to undefined.
  // The fix replaces both with explicit guards.
  assert.match(view, /typeof window\.electronAPI\?\.skillsRefresh\s*!==\s*['"]function['"]/);
  assert.match(view, /typeof window\.electronAPI\?\.skillsOpenFolder\s*!==\s*['"]function['"]/);
  assert.match(view, /Skills IPC bridge not detected/);

  // After each guard, the call is unconditional (no optional chain on the method).
  assert.match(view, /await window\.electronAPI\.skillsRefresh\(\)/);
  assert.match(view, /await window\.electronAPI\.skillsOpenFolder\(\)/);
});

// ---------------------------------------------------------------------------
// 2. Generalised wiring invariant — every electronAPI.* method consumed by the
//    renderer that maps to an ipcRenderer.invoke channel must have a matching
//    ipcMain.handle registration. This is exactly the class of bug we just
//    fixed; without this check, the next missing preload binding regresses
//    silently again.
// ---------------------------------------------------------------------------
test('every preload ipcRenderer.invoke channel has a matching ipcMain.handle registration', () => {
  const preload = read('electron/preload.ts');
  const handlers = read('electron/ipcHandlers.ts');

  // Capture every invoke('channel-name'...) string literal in preload.
  const invokeRe = /ipcRenderer\.invoke\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;
  const channels = new Set();
  let m;
  while ((m = invokeRe.exec(preload)) !== null) channels.add(m[1]);

  assert.ok(channels.size > 50, `expected many invoke channels, found ${channels.size}`);
  assert.ok(channels.has('skills:list'), 'sanity: skills:list should appear in preload');
  assert.ok(channels.has('skills:open-folder'), 'sanity: skills:open-folder should appear in preload');

  // A handler counts if it's registered via ipcMain.handle OR via any local
  // wrapper that internally calls ipcMain.handle. We scan the full electron/
  // tree (not just ipcHandlers.ts) because subsystems like KeybindManager
  // and the stealth-tap shim register their own channels.
  const registered = new Set();
  const handleRe = /(?:ipcMain\.handle|safeHandle|registerStealthHandler|registerHandler)\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let mm;
        while ((mm = handleRe.exec(text)) !== null) registered.add(mm[1]);
      }
    }
  };
  walk(path.join(root, 'electron'));

  // Known-stale invokes: channels exposed in preload that have no handler.
  // These are pre-existing issues unrelated to the skills fix — fail loudly
  // if a NEW one appears, but don't block on the existing backlog.
  const KNOWN_STALE = new Set([
    // toggleAdvancedSettings → 'toggle-advanced-settings' is exposed in preload
    // (electron/preload.ts:937) but no handler registers the channel. Renderer
    // invokes silently reject — pre-existing tech debt, separate cleanup.
    'toggle-advanced-settings',
    // M5 cleanup of stealth-tap:permission-granted / request-permission /
    // is-active was completed alongside this commit — entries removed here.
  ]);

  const missing = [...channels].filter(ch => !registered.has(ch) && !KNOWN_STALE.has(ch)).sort();
  assert.deepStrictEqual(missing, [],
    `Every preload invoke channel must have a matching handler. Missing: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. Runtime behaviour — SkillsManager.listSkills() seeds and returns the
//    built-in humanize-ai-text skill. Uses the built `dist-electron` bundle
//    and a stubbed `electron` module so `app.getPath('userData')` and
//    `app.isReady()` work without a real Electron host.
// ---------------------------------------------------------------------------
test('SkillsManager.listSkills() returns the builtin humanize-ai-text skill', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-test-'));

  // Stub `electron` module before SkillsManager is loaded. Inject directly
  // into Node's CJS cache so the bundled `require("electron")` resolves to
  // our shim. We give a fully-resolved id ('electron') because that is what
  // esbuild produced in the bundle.
  const stubExports = {
    app: {
      isReady: () => true,
      getPath: (name) => {
        if (name === 'userData') return tmpUserData;
        return os.tmpdir();
      },
    },
    shell: {
      openPath: async () => '', // empty string = success per Electron contract
    },
  };

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = stubExports;
  stubModule.loaded = true;
  // Prime both the global cache and a project-local require cache so that
  // the bundled SkillsManager.js resolves our stub.
  require_cache_set(cjsRequire, electronId, stubModule);

  // The dist bundle of SkillsManager is committed/built by `npm test`'s
  // pre-step. Use the bundled CJS so we don't need ts-node.
  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  assert.ok(fs.existsSync(distPath), 'dist-electron must be built (npm test runs build:electron first)');

  // Clear any prior load so the require picks up the stubbed electron module.
  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);

  // Reset the static singleton so each test run starts fresh.
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  const manager = SkillsManager.getInstance();
  const list = manager.listSkills();

  assert.ok(Array.isArray(list), 'listSkills() must return an array');
  // The directory id (BUILTIN_SKILLS[0].id = 'humanize-text') and the
  // displayed skill id (slugify(frontmatter.name) = 'humanize-ai-text')
  // are intentionally different — the disk slot is named for the legacy
  // built-in but the parsed frontmatter rebrands it.
  const humanize = list.find(s => s.id === 'humanize-ai-text');
  assert.ok(humanize, `expected humanize-ai-text skill in: ${list.map(s => s.id).join(', ')}`);
  assert.equal(humanize.source, 'builtin');
  assert.equal(humanize.name, 'humanize-ai-text');
  assert.ok(humanize.description.length > 20, 'description should be non-trivial');

  // Verify the seeded file lives under userData/skills/humanize-text/SKILL.md.
  const skillFile = path.join(tmpUserData, 'skills', 'humanize-text', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), 'SKILL.md must be seeded on disk');
  const bytes = fs.statSync(skillFile).size;
  assert.ok(bytes > 1000 && bytes < 100 * 1024,
    `seeded SKILL.md (${bytes} bytes) must be under the 100KB cap so it is not skipped`);

  // openSkillsFolder() must always return an object with a `path` field — the
  // renderer relies on `result?.path` to update the displayed folder string
  // even on shell.openPath failure.
  return manager.openSkillsFolder().then(result => {
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.path, 'string');
    assert.ok(result.path.length > 0, 'path must always be populated');
  });
});

// Helper — Node's CJS require.cache is read-write but the typing in ESM is
// awkward. Extracted for clarity.
function require_cache_set(req, id, mod) {
  req.cache[id] = mod;
  // Also alias the absolute-resolved id in case esbuild rewrote it.
  try {
    const resolved = req.resolve(id);
    req.cache[resolved] = mod;
  } catch {
    /* electron isn't resolvable on disk in this env — the bare id stub is enough */
  }
}
