// scripts/e2e-sd-requirements-gate.js
//
// Electron e2e core matrix for SD Requirements grilling gate (ticket 13).
//
// Boots a REAL Electron binary against a throwaway userData dir (same pattern
// as benchmark-sd-grounding / e2e-thesis-real-path). Does NOT extend
// benchmark-sd-grounding — that harness is framework+tech quality, not a
// phase-gate state machine.
//
// Determinism (ticket 11): stubs streamChat with phase-aware canned text —
// never calls live Gemini.
// Fixtures (ticket 10): synthetic interviewer-role rows injected into
// SessionTracker via addTranscript; slot fill reads getContextWithInterim /
// getLastInterviewerTurn (production APIs).
//
// Dependency: electron/llm/sdRequirementsGate.ts + sdRequirementsLive.ts
// (production prepare stamps sdPhase onto SessionTracker working copy).
//
// Skip (exit 0): when dist-electron is missing (build not run).
//
// Run:
//   npm run build:electron
//   NATIVELY_E2E=1 ./node_modules/.bin/electron scripts/e2e-sd-requirements-gate.js
//
// Do NOT use ELECTRON_RUN_AS_NODE — DatabaseManager / app.getPath need real Electron.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const distGate = path.join(distRoot, 'llm', 'sdRequirementsGate.js');
const distLive = path.join(distRoot, 'llm', 'sdRequirementsLive.js');
const distSession = path.join(distRoot, 'SessionTracker.js');

function skip(msg) {
  console.log(`[req-gate-e2e] SKIP — ${msg}`);
  process.exit(0);
}

if (
  !fs.existsSync(distRoot) ||
  !fs.existsSync(distGate) ||
  !fs.existsSync(distLive) ||
  !fs.existsSync(distSession)
) {
  skip(
    `dist-electron missing required modules (need ${path.relative(repoRoot, distGate)}, ` +
      `${path.relative(repoRoot, distLive)}, and SessionTracker). Run: npm run build:electron`,
  );
}

// Must set before requiring electron.app for scripted runs.
process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';

const { app } = require('electron');
const {
  loadCoreMatrixFixtures,
  runMatrixScenario,
} = require('./lib/sd-requirements-gate-harness.js');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-req-gate-e2e-'));
app.setPath('userData', tmpUserData);

async function main() {
  await app.whenReady();

  const gate = require(distGate);
  const live = require(distLive);
  const sessionMod = require(distSession);
  const SessionTracker = sessionMod.SessionTracker || sessionMod.default;
  if (!SessionTracker) {
    throw new Error('SessionTracker not exported from dist — rebuild electron');
  }
  if (typeof live.prepareSdRequirementsForAnswerPlan !== 'function') {
    throw new Error('sdRequirementsLive.prepareSdRequirementsForAnswerPlan missing — rebuild electron');
  }

  const session = new SessionTracker();
  const fixtures = loadCoreMatrixFixtures();
  console.log(
    `[req-gate-e2e] NATIVELY_E2E=${process.env.NATIVELY_E2E} ` +
      `userData=${tmpUserData} scenarios=${fixtures.length} prepare=live`,
  );

  let failed = 0;
  for (const fixture of fixtures) {
    const result = await runMatrixScenario(gate, session, fixture, live);
    if (result.ok) {
      console.log(
        `PASS  ${result.id}  sdPhase=${result.sdPhase}  ` +
          `softRefuse=${result.softRefused}  (${(result.notes || []).join('; ')})`,
      );
    } else {
      failed += 1;
      console.log(`FAIL  ${result.id}  :: ${result.failures.join('; ')}`);
      if (result.spoken) {
        console.log(`      → ${String(result.spoken).slice(0, 220).replace(/\n/g, ' ')}`);
      }
    }
  }

  console.log(`\n[req-gate-e2e] ${fixtures.length - failed}/${fixtures.length} pass`);
  process.exitCode = failed === 0 ? 0 : 1;
}

function cleanup() {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

main()
  .catch((e) => {
    console.error('[req-gate-e2e] FATAL', e?.message || e);
    process.exitCode = 2;
  })
  .finally(() => {
    cleanup();
    try {
      const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
      app.exit(code);
    } catch {
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }
  });
