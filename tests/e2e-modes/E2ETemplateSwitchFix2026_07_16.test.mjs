import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');
const MODES_PATH = path.join(repoRoot, 'dist-electron/electron/services/ModesManager.js');
const CMEC_PATH = path.join(repoRoot, 'dist-electron/electron/llm/customModeExecutionContract.js');
const CTXOS_PATH = path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js');

let DatabaseManager, ModesManager, dbMgr, mgr, buildCustomModeExecutionContract, buildTurnContractForSurface;

describe('E2E: Technical Interview template-switch scenario reproduces user-reported failure PRE-fix; passes POST-fix', () => {
  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ti-template-switch-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[MODES_PATH]; } catch {}
    try { delete require.cache[CMEC_PATH]; } catch {}
    try { delete require.cache[CTXOS_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    ModesManager = require(MODES_PATH).ModesManager;
    ({ buildCustomModeExecutionContract } = require(CMEC_PATH));
    ({ buildTurnContractForSurface } = require(CTXOS_PATH));
    dbMgr = DatabaseManager.getInstance();
    mgr = ModesManager.getInstance();
  });
  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[MODES_PATH]; } catch {}
    try { delete require.cache[CMEC_PATH]; } catch {}
    try { delete require.cache[CTXOS_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
  });

  test('user-reported flow: create General, switch to Technical Interview, ask about most recent project', () => {
    if (!dbMgr.isAvailable()) return;

    // 1. User creates a new mode as General (the most common path).
    const created = mgr.createMode({ name: 'My interview mode', templateType: 'general' });

    // 2. User then changes its templateType to technical-interview via the
    //    renderer dropdown — exactly the action that previously left the
    //    sourceContract stale.
    mgr.updateMode(created.id, { templateType: 'technical-interview' });

    // 3. The user then asks "Walk me through your most recent project." —
    //    a profile question, with a resume loaded.
    const persistedAuthority = mgr.getOrMigrateSourceContract(created.id).sourceAuthority;
    const legacyContract = buildCustomModeExecutionContract({
      question: 'Walk me through your most recent project.',
      streamRoute: 'manual_chat_stream',
      modeId: created.id,
      modeUniqueId: created.id,
      answerType: 'experience_recap',
      isCustomMode: false,
      isDocGroundedCustomModeActive: false,
      hasReferenceFiles: false,
      hasCustomPrompt: false,
      hasLiveTranscript: false,
      hasProfileFacts: true,
      hasMeetingRag: false,
      hasLongTermMemory: false,
      persistedSourceAuthority: persistedAuthority,
    });
    const kernelContract = buildTurnContractForSurface({
      surface: 'manual_chat',
      question: 'Walk me through your most recent project.',
      activeModeId: created.id,
      activeModeName: 'Technical Interview',
      sourceAuthority: persistedAuthority,
      answerType: 'experience_recap',
      plannerVoicePerspective: 'first_person_candidate',
      hasReferenceFiles: false,
      hasProfileFacts: true,
      hasLiveTranscript: false,
    });

    // POST-FIX: Technical Interview = profile_only, profile_resume granted.
    assert.equal(persistedAuthority, 'profile_only',
      'PER-TEMPLATE SEED MISMATCH (PRE-FIX REGRESSION): expected profile_only, got ' + persistedAuthority);
    assert.equal(legacyContract.sourceAuthority, 'profile_only',
      'LEGACY CONTRACT must mirror the persisted profile_only authority');
    assert.ok(legacyContract.allowedSources.includes('profile_resume'),
      'LEGACY CONTRACT must allow profile_resume for a profile_only Technical Interview');
    assert.equal(kernelContract.sourceOwner, 'profile',
      'KERNEL CONTRACT must resolve sourceOwner=profile for profile_only');
    assert.ok(kernelContract.allowedSources.some(s => s.sourceKind === 'profile_resume'),
      'KERNEL CONTRACT must grant profile_resume evidence');

    // And the failure modes the user reported are GONE:
    assert.ok(!legacyContract.forbiddenSources.includes('profile_resume'),
      'POST-FIX: profile_resume is NO LONGER forbidden for Technical Interview');
    assert.ok(!legacyContract.forbiddenSources.includes('profile_jd'),
      'POST-FIX: profile_jd is NO LONGER forbidden for Technical Interview');
  });
});
