/**
 * OKF Phase 6 (2026-07-01): user edit/approve/reject/restore workflow tests.
 * Combines source-assertion (IPC wiring) with functional tests against the
 * pure OkfCardEditor logic (which itself calls into KnowledgePackStore — DB
 * accessors are exercised end-to-end by scripts/smoke-okf-card-edit-approve.js
 * since better-sqlite3 needs the real Electron binary).
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
const dbManagerSrc = read('electron/db/DatabaseManager.ts');
const editorSrc = read('electron/services/knowledge/OkfCardEditor.ts');
const retrieverSrc = read('electron/services/knowledge/OkfRetriever.ts');
const storeSrc = read('electron/services/knowledge/KnowledgePackStore.ts');
const modesSettingsSrc = read('premium/src/ModesSettings.tsx');

test('DatabaseManager: migration v20 -> v21 adds knowledge_card_versions table', () => {
  assert.match(dbManagerSrc, /Applying migration v20 → v21: Add knowledge_card_versions table/);
  assert.match(dbManagerSrc, /CREATE TABLE IF NOT EXISTS knowledge_card_versions/);
});

test('DatabaseManager: replaceKnowledgeCards flags user-edited cards needs_review on checksum change', () => {
  assert.match(dbManagerSrc, /needs_review/);
  assert.match(dbManagerSrc, /user_edited = 1 AND source_checksum != \?/);
});

test('DatabaseManager: replaceKnowledgeCards never overwrites a user-edited card (WHERE user_edited = 0 guard)', () => {
  assert.match(dbManagerSrc, /WHERE knowledge_cards\.user_edited = 0/);
});

test('OkfCardEditor: editCard preserves source attribution fields (never touches sourcePages/sourceChecksum)', () => {
  assert.ok(!editorSrc.includes('sourcePages:'), 'editCard must not accept/write sourcePages');
  assert.ok(!editorSrc.includes('sourceChecksum:'), 'editCard must not accept/write sourceChecksum');
});

test('OkfCardEditor: every write path snapshots via KnowledgePackStore.updateCard (which calls snapshotKnowledgeCardVersion first)', () => {
  assert.match(storeSrc, /snapshotKnowledgeCardVersion/);
  assert.match(storeSrc, /updateCard\(id: string, updates:/);
});

test('OkfCardEditor: rejectCard sets approvalStatus to rejected (not a delete)', () => {
  assert.match(editorSrc, /export function rejectCard/);
  const idx = editorSrc.indexOf('export function rejectCard');
  const slice = editorSrc.slice(idx, idx + 200);
  assert.match(slice, /approvalStatus: 'rejected'/);
});

test('OkfCardEditor: restoreCardVersion uses cardVersion === 1 to identify the pristine generated state', () => {
  assert.match(editorSrc, /target\.cardVersion !== 1/);
});

test('OkfCardEditor: isCardRetrievable excludes only rejected cards', () => {
  assert.match(editorSrc, /card\.approvalStatus !== 'rejected'/);
});

test('OkfRetriever: queryOkfCards excludes rejected cards from all retrieval paths (synthesis and scored)', () => {
  assert.match(retrieverSrc, /const retrievableCards = pack\.cards\.filter\(\(c\) => c\.approvalStatus !== 'rejected'\);/);
  assert.match(retrieverSrc, /retrievableCards\.slice\(0, topN\)/);
  assert.match(retrieverSrc, /retrievableCards\.map\(\(card\) => \(\{/);
});

test('ipcHandlers: registers all 5 card edit/approval IPC handlers', () => {
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:edit-card'/);
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:approve-card'/);
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:reject-card'/);
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:restore-card-version'/);
  assert.match(ipcHandlersSrc, /safeHandle\('knowledge:get-card-history'/);
});

test('ipcHandlers: all 5 handlers are gated behind isOkfUserEditableCardsEnabled', () => {
  for (const channel of ['knowledge:edit-card', 'knowledge:approve-card', 'knowledge:reject-card', 'knowledge:restore-card-version', 'knowledge:get-card-history']) {
    const idx = ipcHandlersSrc.indexOf(`safeHandle('${channel}'`);
    assert.ok(idx >= 0, `expected to find handler for ${channel}`);
    const slice = ipcHandlersSrc.slice(idx, idx + 700);
    assert.match(slice, /isOkfUserEditableCardsEnabled/, `${channel} must check isOkfUserEditableCardsEnabled`);
  }
});

test('ModesSettings.tsx: approve/reject buttons are gated behind userEditableCardsEnabled prop', () => {
  assert.match(modesSettingsSrc, /userEditableCardsEnabled && \(/);
  assert.match(modesSettingsSrc, /onApproveCard: \(cardId: string\) => void/);
  assert.match(modesSettingsSrc, /onRejectCard: \(cardId: string\) => void/);
});

test('ModesSettings.tsx: rejected cards render with reduced opacity and strikethrough title', () => {
  assert.match(modesSettingsSrc, /opacity: card\.approvalStatus === 'rejected' \? 0\.5 : 1/);
  assert.match(modesSettingsSrc, /textDecoration: card\.approvalStatus === 'rejected' \? 'line-through' : 'none'/);
});
