// F-BND-01 / F-BND-05 (live-pipeline forensics, 2026-11-13).
//
// The V3 profile collector fed the résumé / JD into every V3 answer in a
// profile-aware mode no matter what the user's Profile Intelligence switch
// said (F-BND-01), and it read the premium orchestrator's in-memory résumé
// with no Pro check, so after a licence or trial ended mid-session the only
// gate left was the mode template lock (F-BND-05).
//
// The collector now asks the orchestrator's own `isKnowledgeMode()` (switch on
// AND Pro/trial AND a document loaded) before serving the résumé or JD, and
// serves Cue Cards only with Pro and when the user has not switched Profile
// Intelligence off. The raw-text INDEX path still sees every active document:
// switching off must not delete or re-embed the index.
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

describe('V3 profile hydration honours the Profile Intelligence switch (F-BND-01)', () => {
  test('switch ON + Pro: résumé and JD are served', () => {
    globalThis[PRO_KEY] = () => true;
    const c = collectV3ProfileSources(orchestrator({ switchOn: true }));
    assert.deepEqual(c.docs.map((d) => d.kind).sort(), ['jd', 'resume']);
  });

  test('switch OFF: no résumé or JD reaches V3', () => {
    globalThis[PRO_KEY] = () => true;
    const c = collectV3ProfileSources(orchestrator({ switchOn: false }));
    assert.equal(c.docs.filter((d) => d.kind === 'resume' || d.kind === 'jd').length, 0,
      'the résumé / JD was served with Profile Intelligence switched off');
    assert.equal(c.counts.profileResume, 0);
    assert.equal(c.counts.profileJd, 0);
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
  test('snapshot facts are null when the orchestrator says the profile may not be read', () => {
    assert.match(ie, /const snapshotReadableKnowledge = snapshotProfileReadable \? snapshotKnowledge : null;/);
    assert.match(ie, /const snapshotProfileFacts = stripUnsupportedDerivedResumeFields\(\s*\(snapshotReadableKnowledge as any\)/);
    assert.match(ie, /const snapshotJobDescriptionFacts = \(snapshotReadableKnowledge as any\)/);
  });
  test('the manual-evidence JIT fallback is gated on it too', () => {
    assert.match(ie, /const orch = snapshotProfileReadable \? this\.llmHelper\.getKnowledgeOrchestrator\?\.\(\) : null;/);
  });
});
