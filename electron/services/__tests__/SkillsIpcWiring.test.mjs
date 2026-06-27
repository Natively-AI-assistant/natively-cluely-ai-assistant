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

// ---------------------------------------------------------------------------
// Step-3 wiring — skill upload pipeline. Verifies the two new IPC channels
// (skills:upload, skills:reap-stages), the preload bridge, the type
// declarations, the renderer guards, and the lazy-loaded references to
// SkillValidator / SkillUploader / SkillInstaller.
// ---------------------------------------------------------------------------
test('skills:upload and skills:reap-stages handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'skills:upload') >= 0,
    'skills:upload handler must be registered (step 3 of the upload flow)');
  assert.ok(findSafeHandle(source, 'skills:reap-stages') >= 0,
    'skills:reap-stages handler must be registered (startup hygiene sweep)');

  // Step 3 imports the SkillValidator at the top of the file for
  // DEFAULT_BUILTIN_SKILL_IDS and the SkillUploadPayload type.
  assert.match(source,
    /import\s*\{\s*DEFAULT_BUILTIN_SKILL_IDS,\s*type\s+SkillUploadPayload\s*\}\s*from\s*['"]\.\/services\/skills\/SkillValidator['"]/,
    'ipcHandlers.ts must import DEFAULT_BUILTIN_SKILL_IDS and SkillUploadPayload from SkillValidator');

  // The handlers lazily require the upload pipeline modules — this matches
  // the existing modes:* handler pattern (see ipcHandlers.ts:7262).
  assert.match(source, /require\(['"]\.\/services\/skills\/SkillUploader['"]\)/,
    'skills:upload handler must lazy-load SkillUploader');
  assert.match(source, /require\(['"]\.\/services\/skills\/SkillInstaller['"]\)/,
    'skills:reap-stages handler and startup hook must lazy-load SkillInstaller');

  // The upload handler must pass the standard set of options — existingIds
  // (seeded from SkillsManager.listSkills()), builtinIds, skillsRoot under
  // userData, and stagingRoot in os.tmpdir(). autoInstall must be honored.
  const uploadBlock = sliceSafeHandleBlock(source, 'skills:upload');
  assert.match(uploadBlock, /existingIds/);
  assert.match(uploadBlock, /builtinIds:\s*DEFAULT_BUILTIN_SKILL_IDS/);
  assert.match(uploadBlock, /skillsRoot:\s*path\.join\(app\.getPath\(['"]userData['"]\),\s*['"]skills['"]\)/);
  assert.match(uploadBlock, /stagingRoot:\s*os\.tmpdir\(\)/);
  assert.match(uploadBlock, /autoInstall:\s*opts\?\.autoInstall\s*\?\?\s*false/);

  // The upload handler must have a try/catch fallback so a thrown error
  // never reaches the renderer as a rejection — failures come back as
  // { stage: 'failed', errors: [...] }.
  assert.match(uploadBlock, /catch[\s\S]{0,300}stage:\s*['"]failed['"]/);
  assert.match(uploadBlock, /code:\s*['"]ipc_failed['"]/);

  // A startup one-shot reap must be invoked outside the handler (best-effort
  // cleanup of leftover natively-skill-upload-* dirs in os.tmpdir()).
  // Match against the function body — it's not a safeHandle but it must
  // exist somewhere in initializeIpcHandlers.
  assert.match(source,
    /reapStaleUploadStages\(\s*\{\s*stagingRoot:\s*os\.tmpdir\(\)\s*\}\s*\)/,
    'a one-shot reapStaleUploadStages call must run at startup (best-effort cleanup)');
});

test('preload exposes skillsUpload and skillsPreview on window.electronAPI', () => {
  const preload = read('electron/preload.ts');

  // Both methods must be thin ipcRenderer.invoke calls — no logic.
  assert.match(preload,
    /skillsUpload:\s*\(\s*payload:\s*SkillUploadPayload[\s\S]{0,200}ipcRenderer\.invoke\(\s*['"]skills:upload['"]/,
    'skillsUpload must be an ipcRenderer.invoke wrapper around skills:upload');
  assert.match(preload,
    /skillsPreview:\s*\(\s*payload:\s*SkillUploadPayload[\s\S]{0,160}ipcRenderer\.invoke\(\s*['"]skills:upload['"]/,
    'skillsPreview must invoke skills:upload with autoInstall:false');

  // Both methods must live inside the contextBridge.exposeInMainWorld block.
  const exposeIdx = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'");
  assert.ok(exposeIdx >= 0, 'electronAPI must be exposed via contextBridge');
  assert.ok(preload.indexOf('skillsUpload:', exposeIdx) > exposeIdx,
    'skillsUpload must live inside the electronAPI contextBridge block');
  assert.ok(preload.indexOf('skillsPreview:', exposeIdx) > exposeIdx,
    'skillsPreview must live inside the electronAPI contextBridge block');

  // The SkillUploadPayload type must be imported at the top of preload.ts so
  // the IPC contract is type-checked at preload-build time.
  assert.match(preload,
    /import\s+type\s*\{\s*SkillUploadPayload\s*\}\s+from\s+['"]\.\/services\/skills\/SkillValidator['"]/,
    'preload.ts must import type SkillUploadPayload from SkillValidator');
});

test('electron.d.ts declares the skill upload types and bridge methods', () => {
  const types = read('src/types/electron.d.ts');

  // Skill upload payload + outcome type mirrors must exist on the renderer's
  // ambient type surface (matches SkillValidator.ts and SkillUploader.ts).
  assert.match(types, /export\s+type\s+SkillValidationField/);
  assert.match(types, /export\s+interface\s+SkillValidationError/);
  assert.match(types, /export\s+interface\s+SkillUploadFile/);
  assert.match(types, /export\s+interface\s+SkillUploadPreview/);
  assert.match(types, /export\s+type\s+SkillUploadPayload/);
  assert.match(types, /export\s+type\s+UploadSkillOutcome/);

  // The new bridge methods must be declared on ElectronAPI.
  assert.match(types,
    /skillsUpload:\s*\([\s\S]{0,200}SkillUploadPayload[\s\S]{0,200}UploadSkillOutcome/);
  assert.match(types, /skillsPreview:\s*\(payload:\s*SkillUploadPayload\)\s*=>\s*Promise<UploadSkillOutcome>/);
});

test('SkillsSettings renderer guards upload bridge methods and exposes the upload UI', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  // Guards — must match the existing skillsRefresh/skillsOpenFolder pattern.
  // The renderer uses `skillsUpload` directly (autoInstall:false then
  // autoInstall:true) rather than `skillsPreview` (which is just sugar for
  // the validate-only call), so the upload method is the one we guard.
  assert.match(view,
    /typeof window\.electronAPI\?\.skillsUpload\s*!==\s*['"]function['"]/,
    'SkillsSettings must guard against a missing skillsUpload bridge (silent-fail prevention)');

  // The Skills IPC bridge not detected message is the canonical error
  // (locked in by the original regression test for skillsRefresh).
  assert.match(view, /Skills IPC bridge not detected/);

  // Calls must be unconditional after the guard (no optional chain on the
  // method itself) — this is the exact regression we protect against.
  assert.match(view, /await window\.electronAPI\.skillsUpload\(/);

  // UI affordances — drag-and-drop zone, .md file picker, preview card,
  // compact "Installed skills" list section.
  // Folder uploads were removed in favour of the Advanced "open skills
  // folder" escape hatch; only single-file (.md) uploads are in the
  // in-flow UI now.
  assert.match(view, /onDrop=/, 'upload card must be a drop target');
  assert.match(view, /<input[\s\S]{0,200}type="file"[\s\S]{0,200}accept="\.md/,
    'must include a .md file picker');
  assert.match(view, /Install/, 'preview card must have an Install button');
  assert.match(view, /Cancel/, 'preview card must have a Cancel button');
  assert.match(view, /Installed skills/,
    'list section must be labeled "Installed skills"');
  // Advanced section still exposes the manual folder option.
  assert.match(view, /Advanced: open skills folder/,
    'Advanced escape hatch must remain so users can add folders via OS file explorer');
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
