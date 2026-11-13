// F-BND-01 / F-BND-05 (live-pipeline forensics, 2026-11-13).
//
// The V3 profile collector fed the résumé / JD into every V3 answer in a
// profile-aware mode no matter what the user's Profile Intelligence switch
// said (F-BND-01), and it read the premium orchestrator's in-memory résumé
// with no Pro check, so after a licence or trial ended mid-session the only
// gate left was the mode template lock (F-BND-05).
//
// The collector now serves the résumé, JD and Cue Cards only with Pro/trial at
// read time. Owner decision 2026-11-14 (revising F-BND-01): the Profile
// Intelligence switch is NOT read. The mode decides (only Looking-for-work and
// Technical Interview hydrate the profile) and the switch is hidden under V3,
// so a stale OFF must not silently drop the résumé. The raw-text INDEX path
// sees every active document.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = path.resolve(process.cwd(), 'dist-electron/electron');
const { collectV3ProfileSources, collectProfileSourcesForIndex } = require(path.join(dist, 'services/knowledge/v3ProfileSources.js'));

const PRO_KEY = '__nativelyKnowledgeProAccessV1__';
const RESUME = { identity: { name: 'Jordan Rivera' }, experience: [{ role: 'Engineer', company: 'Northwind Freight' }] };
const JD = { title: 'Staff Engineer', company: 'Kestrel Labs' };

function orchestrator({ switchOn }) {
  const o = {
    activeResume: { id: 'r1', structured_data: RESUME, raw_text: 'Jordan Rivera, Engineer at Northwind Freight' },
    activeJD: { id: 'j1', structured_data: JD, raw_text: 'Staff Engineer at Kestrel Labs' },
    knowledgeModeActive: switchOn,
    isKnowledgeModeSwitchedOn() { return this.knowledgeModeActive; },
    // Mirrors premium KnowledgeOrchestrator.isKnowledgeMode: the injected Pro
    // check first, then the switch and a loaded document.
    isKnowledgeMode() {
      const check = globalThis[PRO_KEY];
      if (typeof check === 'function' && check() !== true) return false;
      return this.knowledgeModeActive && (this.activeResume !== null || this.activeJD !== null);
    },
  };
  return o;
}

afterEach(() => { delete globalThis[PRO_KEY]; });

describe('V3 profile hydration ignores the hidden Profile Intelligence switch (owner 2026-11-14)', () => {
  test('switch ON + Pro: résumé and JD are served', () => {
    globalThis[PRO_KEY] = () => true;
    const c = collectV3ProfileSources(orchestrator({ switchOn: true }));
    assert.deepEqual(c.docs.map((d) => d.kind).sort(), ['jd', 'resume']);
  });

  test('switch OFF + Pro: résumé and JD are still served (the mode decides)', () => {
    globalThis[PRO_KEY] = () => true;
    const c = collectV3ProfileSources(orchestrator({ switchOn: false }));
    assert.deepEqual(c.docs.filter((d) => d.kind === 'resume' || d.kind === 'jd').map((d) => d.kind).sort(), ['jd', 'resume']);
    assert.equal(c.counts.profileResume, 1);
    assert.equal(c.counts.profileJd, 1);
  });
});

describe('V3 profile hydration needs Pro at read time (F-BND-05)', () => {
  test('Pro lost mid-session: the in-memory résumé is not served', () => {
    globalThis[PRO_KEY] = () => false;
    const c = collectV3ProfileSources(orchestrator({ switchOn: true }));
    assert.equal(c.docs.length, 0, 'premium context lingered after Pro loss');
  });
});

describe('the raw-text index still sees the active documents', () => {
  test('index collection ignores the switch (switching off must not prune the index)', () => {
    globalThis[PRO_KEY] = () => true;
    const c = collectProfileSourcesForIndex(orchestrator({ switchOn: false }));
    assert.deepEqual(c.docs.map((d) => d.kind).sort(), ['jd', 'resume']);
  });
});

describe('the WTA profile snapshot and JIT fallback use the same read gate (F-BND-05)', async () => {
  const { readFileSync } = await import('node:fs');
  const ie = readFileSync(path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');
  test('snapshot facts are null when Pro says the profile may not be read', () => {
    assert.match(ie, /const \{ profileReadableForAnswers \} = require\('\.\/services\/knowledge\/v3ProfileSources'\);/);
    assert.doesNotMatch(ie.slice(ie.indexOf('const snapshotProfileReadable'), ie.indexOf('const snapshotProfileReadable') + 600), /isKnowledgeMode/);
    assert.match(ie, /const snapshotReadableKnowledge = snapshotProfileReadable \? snapshotKnowledge : null;/);
    assert.match(ie, /const snapshotProfileFacts = stripUnsupportedDerivedResumeFields\(\s*\(snapshotReadableKnowledge as any\)/);
    assert.match(ie, /const snapshotJobDescriptionFacts = \(snapshotReadableKnowledge as any\)/);
  });
  test('the manual-evidence JIT fallback is gated on it too', () => {
    assert.match(ie, /const orch = snapshotProfileReadable \? this\.llmHelper\.getKnowledgeOrchestrator\?\.\(\) : null;/);
  });
});
