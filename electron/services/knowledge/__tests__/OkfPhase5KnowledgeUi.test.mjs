/**
 * OKF Phase 5 (2026-07-01): Knowledge Pack UI wiring tests — IPC handlers,
 * preload exposure, and renderer type declarations. Source-assertion
 * pattern (no live app boot required).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const ipcHandlersSrc = read('electron/ipcHandlers.ts');
const preloadSrc = read('electron/preload.ts');
const electronDtsSrc = read('src/types/electron.d.ts');

test('ipcHandlers: registers knowledge:list-packs', () => {
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:list-packs'/);
});

test('ipcHandlers: registers knowledge:get-pack', () => {
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:get-pack'/);
});

test('ipcHandlers: registers knowledge:regenerate-pack', () => {
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:regenerate-pack'/);
});

test('ipcHandlers: registers knowledge:export-pack', () => {
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:export-pack'/);
});

test('ipcHandlers: all knowledge IPC handlers are gated behind their respective OKF flags', () => {
  const listIdx = ipcHandlersSrc.indexOf("safeHandle('knowledge:list-packs'");
  const listSlice = ipcHandlersSrc.slice(listIdx, listIdx + 600);
  assert.match(listSlice, /isOkfKnowledgeUiEnabled/);

  const getIdx = ipcHandlersSrc.indexOf("safeHandle('knowledge:get-pack'");
  const getSlice = ipcHandlersSrc.slice(getIdx, getIdx + 500);
  assert.match(getSlice, /isOkfKnowledgeUiEnabled/);

  const regenIdx = ipcHandlersSrc.indexOf("safeHandle('knowledge:regenerate-pack'");
  const regenSlice = ipcHandlersSrc.slice(regenIdx, regenIdx + 900);
  assert.match(regenSlice, /isOkfKnowledgeUiEnabled/);

  const exportIdx = ipcHandlersSrc.indexOf("safeHandle('knowledge:export-pack'");
  const exportSlice = ipcHandlersSrc.slice(exportIdx, exportIdx + 900);
  assert.match(exportSlice, /isOkfMarkdownExportEnabled/);
});

test('ipcHandlers: knowledge:regenerate-pack forces regeneration (bypasses the content-hash no-op check)', () => {
  const idx = ipcHandlersSrc.indexOf("safeHandle('knowledge:regenerate-pack'");
  const slice = ipcHandlersSrc.slice(idx, idx + 1500);
  assert.match(slice, /generateForFile\(\s*\{[\s\S]*?\},\s*true,?\s*\)/);
});

test('ipcHandlers: knowledge:export-pack requires okfMarkdownExport and uses a directory picker', () => {
  const idx = ipcHandlersSrc.indexOf("safeHandle('knowledge:export-pack'");
  const slice = ipcHandlersSrc.slice(idx, idx + 1500);
  assert.match(slice, /dialog\.showOpenDialog/);
  assert.match(slice, /openDirectory/);
});

test('preload: exposes knowledgeListPacks/knowledgeGetPack/knowledgeRegeneratePack/knowledgeExportPack', () => {
  assert.match(preloadSrc, /knowledgeListPacks: \(modeId: string\) => ipcRenderer\.invoke\('knowledge:list-packs', modeId\)/);
  assert.match(preloadSrc, /knowledgeGetPack: \(fileId: string\) => ipcRenderer\.invoke\('knowledge:get-pack', fileId\)/);
  assert.match(preloadSrc, /knowledgeRegeneratePack: \(params:/);
  assert.match(preloadSrc, /knowledgeExportPack: \(fileId: string\) => ipcRenderer\.invoke\('knowledge:export-pack', fileId\)/);
});

test('preload: declares TypeScript types for all 4 knowledge IPC methods', () => {
  assert.match(preloadSrc, /knowledgeListPacks: \(modeId: string\) => Promise</);
  assert.match(preloadSrc, /knowledgeGetPack: \(fileId: string\) => Promise</);
  assert.match(preloadSrc, /knowledgeRegeneratePack: \(params:/);
  assert.match(preloadSrc, /knowledgeExportPack: \(fileId: string\) => Promise</);
});

test('src/types/electron.d.ts: declares matching renderer types for the knowledge IPC surface', () => {
  assert.match(electronDtsSrc, /knowledgeListPacks: \(modeId: string\) => Promise</);
  assert.match(electronDtsSrc, /knowledgeGetPack: \(fileId: string\) => Promise</);
  assert.match(electronDtsSrc, /knowledgeRegeneratePack: \(params:/);
  assert.match(electronDtsSrc, /knowledgeExportPack: \(fileId: string\) => Promise</);
});

test('premium/src/ModesSettings.tsx: KnowledgePanel UI is gated behind okfKnowledgeUiEnabled state read from getIntelligenceFlags', () => {
  const src = read('premium/src/ModesSettings.tsx');
  assert.match(src, /getIntelligenceFlags\?\.\(\)/);
  assert.match(src, /f\.key === 'okfKnowledgeUi'/);
  assert.match(src, /okfKnowledgeUiEnabled && /);
});

test('premium/src/ModesSettings.tsx: defines a KnowledgePanel component with regenerate + export actions', () => {
  const src = read('premium/src/ModesSettings.tsx');
  assert.match(src, /const KnowledgePanel: React\.FC/);
  assert.match(src, /onRegenerate: \(\) => void/);
  assert.match(src, /onExport: \(\) => void/);
});
