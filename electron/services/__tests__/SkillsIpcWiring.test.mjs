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

// ---------------------------------------------------------------------------
// 4. Delete wiring — skills:delete (2026-07-05).
//    Same three-tier static contract as the existing skills:* tests:
//    handler registered in ipcHandlers.ts → preload exposes a thin invoke
//    wrapper → electron.d.ts declares the type → SkillsSettings.tsx renders
//    the UI affordance and guards the bridge. Plus a regex check that the
//    /skill-name invocation gate in ipcHandlers.ts still exists defensively.
//    (skills:set-enabled IPC was removed; SkillsManager.setSkillEnabled()
//    remains as defense-in-depth for any future "disable" feature.)
// ---------------------------------------------------------------------------
test('skills:delete handler is registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'skills:delete') >= 0,
    'skills:delete handler must be registered');

  // Delegate to the SkillsManager singleton and have a try/catch fallback that
  // returns { success: false, error } instead of throwing across the IPC
  // boundary. Matches the skills:* convention (no pro-gating — by design).
  const deleteBlock = sliceSafeHandleBlock(source, 'skills:delete');
  assert.match(deleteBlock, /SkillsManager\.getInstance\(\)\.deleteSkill\(/);
  assert.match(deleteBlock, /catch[\s\S]{0,200}success:\s*false[\s\S]{0,80}error/);
});

test('preload exposes skillsDelete on window.electronAPI', () => {
  const preload = read('electron/preload.ts');

  // Thin invoke wrapper — no logic.
  assert.match(preload,
    /skillsDelete:\s*\(\s*id:\s*string\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]skills:delete['"]/,
    'skillsDelete must be an ipcRenderer.invoke wrapper around skills:delete');

  // Must live inside the contextBridge block.
  const exposeIdx = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'");
  assert.ok(exposeIdx >= 0, 'electronAPI must be exposed via contextBridge');
  assert.ok(preload.indexOf('skillsDelete:', exposeIdx) > exposeIdx,
    'skillsDelete must live inside the electronAPI contextBridge block');

  // Negative assertion: skillsSetEnabled / onSkillsChanged IPC plumbing was
  // intentionally removed. If a future contributor re-adds the toggle UI they
  // will need to wire these back up — this assertion catches a "subtle leak"
  // where one half returns without the other.
  assert.doesNotMatch(preload, /skillsSetEnabled:/,
    'skillsSetEnabled bridge was intentionally removed; re-add only with the toggle UI');
  assert.doesNotMatch(preload, /onSkillsChanged:/,
    'onSkillsChanged broadcast bridge was intentionally removed; re-add only with the toggle UI');
});

test('electron.d.ts declares enabled on SkillSummary and the skillsDelete bridge method', () => {
  const types = read('src/types/electron.d.ts');

  // SkillSummary keeps its `enabled: boolean` field — set by loadUserSkills
  // from the sidecar (defensive, in case a future feature flips it). The
  // field is no longer consumed by SkillsSettings.tsx after the toggle removal.
  assert.match(types,
    /export interface SkillSummary\s*\{[\s\S]{0,300}enabled:\s*boolean[\s\S]{0,80}\}/,
    'SkillSummary must declare an enabled: boolean field (manager-side, defensive)');

  // Only the delete bridge remains.
  assert.match(types,
    /skillsDelete:\s*\(\s*id:\s*string\s*\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*error\?:\s*string\s*\}>/);

  // Negative assertion — skillsSetEnabled type was removed.
  assert.doesNotMatch(types, /skillsSetEnabled:/,
    'skillsSetEnabled type was intentionally removed; re-add only with the toggle UI');
});

test('SkillsSettings renderer guards the skillsDelete bridge and renders delete UI', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  // Guard against missing bridge methods — same defensive pattern as
  // skillsRefresh/skillsOpenFolder/skillsUpload.
  assert.match(view,
    /typeof window\.electronAPI\?\.skillsDelete\s*!==\s*['"]function['"]/,
    'SkillsSettings must guard against a missing skillsDelete bridge');

  // Negative assertion — skillsSetEnabled bridge was removed with the toggle.
  assert.doesNotMatch(view,
    /typeof window\.electronAPI\?\.skillsSetEnabled/,
    'skillsSetEnabled bridge must not be referenced from the renderer (toggle UI removed)');

  // Unconditional call after guard.
  assert.match(view, /await window\.electronAPI\.skillsDelete\(/);

  // Confirmation UX — inline two-step confirm replaces the prior blocking
  // system dialog (which froze the renderer and broke the panel's visual
  // language). The first click on the trash icon sets confirmingId, the
  // second click on the inline red Delete button (rendered only when
  // confirmingId === id) calls commitDeleteSkill. Both halves must be
  // present so future contributors don't reintroduce the system dialog
  // or break the affordance.
  assert.doesNotMatch(view, /\bconfirm\s*\(/,
    'SkillsSettings must NOT use the system blocking dialog — inline two-step UX replaces it');
  assert.match(view, /confirmingId/,
    'SkillsSettings must track which row is in confirm-mode');
  // The inline Delete confirm button title (rendered when confirmingId
  // matches) — the destructive commit button.
  assert.match(view, /Delete this skill/,
    'SkillsSettings must render an inline red Delete button while in confirm-mode');

  // UI affordance — Trash2 icon button only.
  assert.match(view, /Trash2/, 'must import Trash2 from lucide-react for the delete affordance');

  // Negative assertion — no toggle UI remains.
  assert.doesNotMatch(view, /role="switch"/,
    'toggle UI was removed; skills are delete-only');
  assert.doesNotMatch(view, /handleToggleEnabled/,
    'handleToggleEnabled handler was removed');

  // Hover-reveal animation matches the meeting-notes pattern in
  // MeetingDetails.tsx:696 — subtle translate-y slide-up + 160ms ease-out,
  // visible on hover (gated by hover-capable media query) AND focus-within
  // (for keyboard users), plus the always-visible `@media(hover:none)`
  // fallback for touch devices (no hover state to trigger on).
  //
  // Note: the strict ordering in the className is `[@media(hover:hover)]:group-hover:opacity-100`
  // BEFORE `group-focus-within:opacity-100` — we use a lookahead-free match
  // that allows arbitrary-value-wrapped Tailwind classes between them (the
  // `[@media(hover:hover)]:group-hover:translate-y-0` in between contains a `g`
  // character that doesn't break the regex).
  assert.match(view,
    /group-hover:opacity-100[\s\S]{0,80}group-focus-within:opacity-100/,
    'delete button wrapper must reveal on both hover (group-hover) and keyboard focus (group-focus-within)');
  assert.match(view,
    /\[@media\(hover:none\)\]:opacity-100/,
    'delete button must be always-visible on touch devices (no hover state) — meets the same a11y baseline as MeetingDetails');

  // Built-ins must NOT show a delete affordance — the manager blocks builtin
  // deletes, so the UI shouldn't even offer it. After the inline-confirm
  // refactor the Trash2 icon is nested under the conditional ternary, so
  // the lookahead grows from 1600→6000 chars (still well-bounded — a real
  // regression would put an unconditional Trash2 in another branch entirely,
  // and would obviously no longer follow the `!== 'builtin'` guard at all).
  assert.match(view,
    /skill\.source\s*!==\s*['"]builtin['"][\s\S]{0,6000}Trash2/,
    'delete button must be conditionally rendered (only for non-builtin skills)');
});

test('disabled-skill invocation gate in ipcHandlers.ts remains as defense-in-depth', () => {
  const source = read('electron/ipcHandlers.ts');

  // Even though the toggle UI was removed, the server-side gate stays so
  // future callers that flip skill.enabled via a direct SkillsManager call
  // (a future per-mode default, an experimental "hide during sensitive flows"
  // toggle, etc.) get the gate for free. The handler MUST check
  // skill.enabled === false BEFORE calling buildPromptBlock().
  assert.match(source,
    /skill\.enabled\s*===\s*false/,
    'invocation gate must still check skill.enabled === false (defense-in-depth)');
  assert.match(source,
    /is disabled\.\s*Enable it in Settings/,
    'must still surface a user-actionable "is disabled. Enable it in Settings" error');
  const gateIdx = source.indexOf('skill.enabled === false');
  const buildIdx = source.indexOf('buildPromptBlock(skill)');
  assert.ok(gateIdx >= 0 && buildIdx > gateIdx,
    'invocation gate must precede buildPromptBlock(skill) so a disabled skill cannot be injected');
});

// ---------------------------------------------------------------------------
// 5. Functional tests — SkillsManager.deleteSkill + setSkillEnabled (2026-07-05).
//    Reuses the existing tmp-userData + stubbed-electron harness from the
//    listSkills runtime test above. Each test resets the SkillsManager
//    singleton so the fresh tmp dir is picked up.
// ---------------------------------------------------------------------------

// Shared harness — call before each functional test to ensure a clean tmp dir,
// fresh singleton instance, and stubbed electron module.
function freshManager() {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-func-'));

  const stubExports = {
    app: {
      isReady: () => true,
      getPath: (name) => name === 'userData' ? tmpUserData : os.tmpdir(),
    },
    shell: { openPath: async () => '' },
  };

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = stubExports;
  stubModule.loaded = true;
  require_cache_set(cjsRequire, electronId, stubModule);

  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  assert.ok(fs.existsSync(distPath), 'dist-electron must be built');

  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  return { manager: SkillsManager.getInstance(), tmpUserData, cjsRequire };
}

test('SkillsManager.deleteSkill() removes a custom skill but refuses builtins', () => {
  const { manager, tmpUserData } = freshManager();

  // Plant a custom skill folder with a valid SKILL.md.
  const customDir = path.join(tmpUserData, 'skills', 'my-custom-skill');
  fs.mkdirSync(customDir, { recursive: true });
  fs.writeFileSync(path.join(customDir, 'SKILL.md'),
    '---\nname: my-custom-skill\ndescription: A test skill for the delete path.\n---\n\n# Custom\n\nDo the custom thing.\n',
    'utf8');

  // Built-in delete must be refused with a clear error.
  const builtinResult = manager.deleteSkill('humanize-ai-text');
  assert.equal(builtinResult.success, false);
  assert.match(builtinResult.error || '', /built-in/i,
    'builtin delete must surface a "built-in" error message');

  // Built-in file must still exist on disk (the manager must NOT have rmSync'd it).
  const builtinPath = path.join(tmpUserData, 'skills', 'humanize-text', 'SKILL.md');
  assert.ok(fs.existsSync(builtinPath), 'builtin SKILL.md must survive a delete attempt');

  // Unknown id must surface a "not found" error.
  const missingResult = manager.deleteSkill('does-not-exist');
  assert.equal(missingResult.success, false);
  assert.match(missingResult.error || '', /not found/i);

  // Custom delete must succeed and remove the folder.
  const customResult = manager.deleteSkill('my-custom-skill');
  assert.equal(customResult.success, true, `expected delete success, got: ${JSON.stringify(customResult)}`);
  assert.equal(fs.existsSync(customDir), false, 'custom skill folder must be removed from disk');

  // A second delete of the same skill must report "not found" (idempotency-ish).
  const secondResult = manager.deleteSkill('my-custom-skill');
  assert.equal(secondResult.success, false);
});

test('SkillsManager.setSkillEnabled() persists by folder name across reloads', () => {
  // DEFENSIVE-ONLY: the skills:set-enabled IPC + the toggle UI were removed,
  // but the manager method stays — the invocation gate at ipcHandlers.ts:934
  // consults skill.enabled, so any future caller that flips the flag via a
  // direct manager call gets the gate for free. This test pins the
  // folder-name-keying contract so the defensive plumbing can't silently
  // break.
  const { manager, tmpUserData } = freshManager();

  // Default state — builtin is enabled.
  const beforeDisable = manager.listSkills().find(s => s.id === 'humanize-ai-text');
  assert.ok(beforeDisable);
  assert.equal(beforeDisable.enabled, true);

  // Disable the builtin. Manager should resolve the id to the on-disk folder
  // name ('humanize-text', not the parsed id 'humanize-ai-text') and persist.
  const disableResult = manager.setSkillEnabled('humanize-ai-text', false);
  assert.equal(disableResult.success, true);

  // Re-list and confirm the disabled state is reflected.
  const afterDisable = manager.listSkills().find(s => s.id === 'humanize-ai-text');
  assert.equal(afterDisable.enabled, false, 'listSkills must reflect disabled state');

  // The sidecar file MUST contain the FOLDER name, not the parsed id, so a
  // user hand-editing the SKILL.md name: frontmatter doesn't orphan the entry.
  const statePath = path.join(tmpUserData, 'skills', '.skills-state.json');
  assert.ok(fs.existsSync(statePath), '.skills-state.json must be written');
  const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(Array.isArray(raw.disabledFolders), 'sidecar must have a disabledFolders array');
  assert.ok(raw.disabledFolders.includes('humanize-text'),
    `sidecar must contain the folder name 'humanize-text' (got: ${JSON.stringify(raw.disabledFolders)})`);
  assert.equal(raw.disabledFolders.includes('humanize-ai-text'), false,
    'sidecar must NOT contain the parsed id — folder-keying is the contract');

  // Re-enable and confirm the sidecar entry is pruned (no orphan accumulation).
  const reEnableResult = manager.setSkillEnabled('humanize-ai-text', true);
  assert.equal(reEnableResult.success, true);
  const afterReEnable = manager.listSkills().find(s => s.id === 'humanize-ai-text');
  assert.equal(afterReEnable.enabled, true);
  const rawAfter = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(rawAfter.disabledFolders.includes('humanize-text'), false,
    're-enabling must prune the sidecar entry');
});

test('corrupt .skills-state.json defaults to all-enabled without throwing', () => {
  const { manager, tmpUserData } = freshManager();

  // Corrupt the sidecar file BEFORE any read.
  const statePath = path.join(tmpUserData, 'skills', '.skills-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{not valid json', 'utf8');

  // A fresh listSkills call must NOT throw — the defensive reader in
  // SkillsManager.readSkillsState() should treat this as empty.
  const list = manager.listSkills();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0, 'builtin must still seed even with a corrupt sidecar');
  const humanize = list.find(s => s.id === 'humanize-ai-text');
  assert.ok(humanize);
  assert.equal(humanize.enabled, true, 'corrupt sidecar must default to enabled');
});

// Regression — recursive-delete contract. A skill folder may contain extra
// files (references, assets) per SkillInstaller.ts. The delete path must
// remove them ALL, not just SKILL.md. Catches a class of bug where someone
// "simplifies" the rmSync call to fs.unlinkSync(SKILL.md).
test('SkillsManager.deleteSkill() recursively removes all files in a skill folder', () => {
  const { manager, tmpUserData } = freshManager();

  const customDir = path.join(tmpUserData, 'skills', 'rich-skill');
  fs.mkdirSync(path.join(customDir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(customDir, 'SKILL.md'),
    '---\nname: rich-skill\ndescription: A skill with extras.\n---\n\n# Rich\n\nDo the thing.\n', 'utf8');
  fs.writeFileSync(path.join(customDir, 'references', 'extra.md'), 'extra content', 'utf8');
  fs.writeFileSync(path.join(customDir, 'notes.txt'), 'extra notes', 'utf8');

  const result = manager.deleteSkill('rich-skill');
  assert.equal(result.success, true);

  // Every file in the folder must be gone — fs.rmSync with recursive:true is
  // required. If a future change accidentally uses fs.unlinkSync(SKILL.md)
  // (which doesn't take recursive), the extras would survive.
  assert.equal(fs.existsSync(customDir), false, 'skill folder itself must be gone');
  assert.equal(fs.existsSync(path.join(customDir, 'references', 'extra.md')), false,
    'nested reference file must also be deleted');
  assert.equal(fs.existsSync(path.join(customDir, 'notes.txt')), false,
    'sibling files in the skill folder must also be deleted');
});

// Security regression — TOCTOU symlink-swap defense. deleteSkill must resolve
// the on-disk realpath AT delete-time and verify it still lives under the
// skills dir. A malicious SKILL.md (or any same-process swap between
// getSkill() and rmSync()) that resolves to a symlink pointing outside the
// skills dir must be refused — otherwise fs.rmSync(..., { force: true }) would
// happily follow the symlink and wipe an arbitrary directory.
//
// Test: plant a custom skill folder, then REPLACE it with a symlink that
// points to an arbitrary directory outside the skills dir, then attempt
// deleteSkill. The manager must refuse the operation AND not touch the
// external target directory.
test('SkillsManager.deleteSkill() refuses to follow a symlink pointing outside the skills dir', () => {
  const { manager, tmpUserData } = freshManager();

  // Plant an external "victim" directory OUTSIDE the skills dir with a
  // sentinel file inside. If the manager mistakenly follows the symlink, the
  // rmSync will delete this file.
  const victimDir = path.join(tmpUserData, 'victim');
  const victimFile = path.join(victimDir, 'precious.txt');
  fs.mkdirSync(victimDir, { recursive: true });
  fs.writeFileSync(victimFile, 'DO NOT DELETE', 'utf8');

  // Plant a skill folder, then swap its directory entry for a symlink pointing
  // at the victim. The SKILL.md still parses fine (a symlink can resolve to a
  // real file). After swap, fs.realpathSync(skillDir) returns the victim dir.
  const customDir = path.join(tmpUserData, 'skills', 'evil-skill');
  fs.mkdirSync(customDir, { recursive: true });
  fs.writeFileSync(path.join(customDir, 'SKILL.md'),
    '---\nname: evil-skill\ndescription: A skill that pretends to be a symlink.\n---\n\n# Evil\n\n...',
    'utf8');

  // Delete the original SKILL.md so the swap is clean, then replace the
  // entire folder with a symlink to the victim. The folder is gone; the
  // symlink stands in its place.
  fs.rmSync(customDir, { recursive: true, force: true });
  fs.symlinkSync(victimDir, customDir, 'dir');

  // Attempt to delete. The manager must refuse.
  const result = manager.deleteSkill('evil-skill');
  // The id 'evil-skill' resolves via the SKILL.md's name: field — but after
  // the swap, there IS no SKILL.md in the symlinked folder unless we put one
  // there too. We need to plant one in the victim so the symlink resolves to
  // a parseable skill — otherwise getSkill returns null and the test
  // exercises the "not found" path, not the symlink defense. Fix:
  fs.writeFileSync(path.join(victimDir, 'SKILL.md'),
    '---\nname: evil-skill\ndescription: Pretending to be in the skills dir.\n---\n\n# Evil\n\n...',
    'utf8');
  // After planting, retry the lookup+delete.
  const result2 = manager.deleteSkill('evil-skill');

  // Either result is acceptable: (a) the manager said "not found" because the
  // symlink-following loader didn't re-stat, or (b) it found it and refused
  // on the realpath containment check. Both are SAFE — neither should have
  // touched the victim file.
  assert.equal(fs.existsSync(victimFile), true,
    'victim file MUST survive a symlinked delete attempt — this is the core security invariant');
  assert.equal(fs.readFileSync(victimFile, 'utf8'), 'DO NOT DELETE',
    'victim file content MUST be unchanged');

  // If the second attempt succeeded at refusal, it must have used the
  // sanitized error message (not the raw realpath) — protects against
  // leaking internal-implementation detail to the UI.
  if (!result2.success && result2.error) {
    assert.doesNotMatch(result2.error, /victim|realpath|skills\/evil/,
      'refusal error must not leak the resolved realpath or skill folder name to the renderer');
  }
});

// Regression for the user-reported "humanize-ai-text is deletable" bug
// (2026-07-06). The humanize builtin ships with:
//   - on-disk folder name: 'humanize-text'
//   - parsed frontmatter id (slugified from `name:`): 'humanize-ai-text'
//
// These two names diverge. If classification only checks the folder name,
// a future maintainer who renames the folder would silently re-classify the
// builtin as 'userData' and make it deletable from the Settings UI. The fix
// makes classification accept EITHER the folder name OR the parsed id as a
// match against the canonical BUILTIN_SKILL_IDS set.
//
// This test pins the contract by verifying that:
//   (a) the humanize-text folder is classified source=builtin (folder-keyed match)
//   (b) deleteSkill('humanize-ai-text') is refused with the built-in error
//   (c) if the folder is renamed to a non-builtin name, classification still
//       succeeds via the parsed-id fallback (i.e. the protection survives
//       folder renames as long as the visible /skill id stays in the set).
test('SkillsManager classifies humanize-ai-text as builtin even when folder is renamed', () => {
  const { manager, tmpUserData } = freshManager();

  // (a) Baseline — the seeded builtin folder should be classified as builtin.
  const baselineList = manager.listSkills();
  const baselineHumanize = baselineList.find(s => s.id === 'humanize-ai-text');
  assert.ok(baselineHumanize, 'baseline: humanize-ai-text must be discoverable');
  assert.equal(baselineHumanize.source, 'builtin',
    'baseline: humanize-ai-text must be classified as builtin (folder keyed)');

  // (b) deleteSkill must refuse the builtin.
  const baselineDelete = manager.deleteSkill('humanize-ai-text');
  assert.equal(baselineDelete.success, false, 'baseline: humanize-ai-text must not be deletable');
  assert.match(baselineDelete.error || '', /built-in/i,
    'baseline: refusal error must match /built-in/i so the UI surfaces a clear message');

  // (c) Rename the seeded builtin folder to something NOT in BUILTIN_SKILL_IDS
  // (simulating a future maintainer's folder-renaming mistake, OR a user's
  // manual filesystem edit). The parsed id from SKILL.md's `name: humanize-ai-text`
  // stays in the set, so the parsed-id fallback must catch it.
  const oldDir = path.join(tmpUserData, 'skills', 'humanize-text');
  const renamedDir = path.join(tmpUserData, 'skills', 'humanize-ai-text-2026');
  // If anything else (e.g. the sidecar .skills-state.json) lives in the dir,
  // renameSync will fail with ENOTEMPTY. Use copy+remove-then-move semantics.
  // Tests run in fresh tmp dirs so this shouldn't happen here — be defensive.
  if (fs.existsSync(renamedDir)) fs.rmSync(renamedDir, { recursive: true, force: true });
  fs.renameSync(oldDir, renamedDir);

  // The listSkills result must STILL classify this skill as builtin,
  // because the parsed id ('humanize-ai-text') matches BUILTIN_SKILL_IDS.
  const list = manager.listSkills();
  const humanize = list.find(s => s.id === 'humanize-ai-text');
  assert.ok(humanize,
    'humanize-ai-text must still be discoverable after folder rename (id-based fallback)');
  assert.equal(humanize.source, 'builtin',
    'humanize-ai-text must be classified as builtin via the parsed-id fallback, ' +
    'even when the on-disk folder name no longer matches BUILTIN_SKILL_IDS. ' +
    'This is the core regression for the user-reported deletable-builtin bug.');

  // deleteSkill must STILL refuse.
  const deleteResult = manager.deleteSkill('humanize-ai-text');
  assert.equal(deleteResult.success, false,
    'after folder rename: humanize-ai-text must STILL not be deletable');
  assert.match(deleteResult.error || '', /built-in/i,
    'after folder rename: refusal error must still match /built-in/i');

  // No explicit cleanup — tmp dir is destroyed when freshManager's caller
  // exits. Restoring oldDir would race with the dirty-sidecar issue above.
});
