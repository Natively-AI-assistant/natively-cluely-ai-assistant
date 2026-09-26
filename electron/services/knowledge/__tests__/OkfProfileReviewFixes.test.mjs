/**
 * OKF Profile Intelligence — code-review fixes (2026-07-02).
 * Locks in the isolation hardening from the code-reviewer pass:
 *   HIGH   — the manual-path guard fails CLOSED when active-mode state is unknown
 *            (null manualActiveMode): profile retrieval is blocked, not leaked.
 *   MEDIUM — the reserved '__profile_okf__' mode cannot be activated.
 *   MEDIUM — KnowledgeManager.getPacksForMode('__profile_okf__') returns [] so the
 *            document pack channel can't surface profile packs.
 *
 * Mix of source-assertion (for the ipcHandlers guard, which needs no DB) and
 * real-module tests (for ModesManager/KnowledgeManager).
 * Requires: npm run build:electron.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const isElectronRuntime = Boolean(process.versions?.electron) || process.env.ELECTRON_RUN_AS_NODE === '1';
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-profile-review-'));
}
async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}
const guard = { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST };

test('HIGH: manual-path guard fails CLOSED when active-mode state is unknown (null)', () => {
  // The ipcHandlers guard must block profile retrieval when manualActiveMode is
  // null (getActiveModeInfo threw) — we cannot rule out a doc-grounded mode.
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  // The fail-closed variable exists and treats null mode as doc-grounded.
  assert.match(src, /const docGroundedOrUnknown = manualActiveMode == null/,
    'docGroundedOrUnknown treats null mode as doc-grounded');
  assert.match(src, /!isCodingChat && answerPlan\.profileContextPolicy !== 'forbidden' && !docGroundedOrUnknown/,
    'the retrieval guard consumes the fail-closed variable');
  // The retriever call passes the REAL doc-grounded state (gate 4 is live, not dead).
  assert.match(src, /documentGroundedActive: manualActiveMode\?\.documentGroundedCustomModeActive === true/,
    'documentGroundedActive is the real state, not a hardcoded false');
  // The old dead-code hardcode is gone.
  assert.doesNotMatch(src, /documentGroundedActive: false,\n\s*hasExplicitPlan: true/,
    'no hardcoded documentGroundedActive: false remains');
});

test('WIRING: manual path prepends the OKF block and gates on coding/forbidden', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  // Block is PREPENDED (profile evidence first, then existing context).
  assert.match(src, /context = context \? `\$\{profileEvidence\.block\}\\n\\n\$\{context\}` : profileEvidence\.block/,
    'OKF block is prepended to context');
  // Only applied when allowed AND non-empty.
  assert.match(src, /if \(profileEvidence\.allowed && profileEvidence\.block\)/, 'gated on allowed + non-empty block');
  // Coding chat is excluded (isCodingChat in the guard).
  assert.match(src, /!isCodingChat &&/, 'coding excluded from profile retrieval');
});

test('WIRING: both trial-wipe paths carry the profile OKF PII backstop', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const backstops = src.match(/ProfilePackBuilder.*getInstance\(\)\.deleteAllProfilePacks\(\)/g) || [];
  // trial:end-byok + trial:wipe-profile-data both have a backstop (2 occurrences).
  assert.ok(backstops.length >= 2, `both trial-wipe paths call deleteAllProfilePacks (found ${backstops.length})`);
});

test('MEDIUM: reserved profile mode cannot be activated via ModesManager.setActiveMode', guard, async () => {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ModesManager } = await load('services/ModesManager.js');
  const mgr = ModesManager.getInstance();
  // Activate a real mode first (general is always seeded).
  mgr.ensureSeeded?.();
  const before = mgr.getActiveMode();
  mgr.setActiveMode('__profile_okf__'); // must be refused
  const after = mgr.getActiveMode();
  assert.ok(!after || after.id !== '__profile_okf__', 'reserved mode never becomes active');
  // Active mode is unchanged (the refusal is a no-op, not a clear).
  assert.equal(after?.id, before?.id, 'active mode unchanged by the refused activation');
});

test('MEDIUM: getPacksForMode blocks the reserved profile mode (document channel isolation)', guard, async () => {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { KnowledgeManager } = await load('services/knowledge/KnowledgeManager.js');
  const packs = KnowledgeManager.getInstance().getPacksForMode('__profile_okf__');
  assert.deepEqual(packs, [], 'no profile packs surface through the document KnowledgeManager path');
});

test('MEDIUM: reserved profile mode is filtered from ModesManager.getModes()', guard, async () => {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ModesManager } = await load('services/ModesManager.js');
  const modes = ModesManager.getInstance().getModes();
  assert.ok(!modes.some((m) => m.id === '__profile_okf__'), 'reserved mode not in list');
});
