// Company Intel must surface the dossier the JD upload already bought (2026-09-21).
//
// THREE DEFECTS THIS PINS, all of which had to hold at once to produce the
// symptom "I upload a JD and Company Intel still says Research Now":
//
//   1. doJdUpload re-fetched the profile and called setProfileData(data) but
//      dropped data.companyDossier on the floor. The ONLY reader of
//      companyDossier was a mount-time useEffect(..., []), so after an upload
//      the panel kept whatever it had at mount — null.
//   2. Nothing waited for the AOT pipeline. Ingest fires runForJD() fire-and-
//      forget, so profileUploadJD acks ~20-60s BEFORE company research finishes;
//      even a correct re-read at ack time would have found null. getProfileData
//      already publishes aotStatus.companyResearch ('pending'|'running'|'done'|
//      'failed') and nothing in the renderer read it.
//   3. The resulting CTA called profile:research-company, whose handler
//      hardcoded researchCompany(companyName, jdCtx, true) — forceRefresh, which
//      skips the 24h cache. So the user paid 14-20 Tavily credits a second time
//      for the dossier already sitting in company_dossiers.
//
// These are SOURCE-CONTRACT assertions: they read the shipped sources and check
// the wiring, because the alternative (booting the Electron renderer to drive a
// real JD upload) is not something a unit test can do. Comments are stripped
// before matching so this file's own prose cannot satisfy its own assertions.
//
// Run: node --test src/components/__tests__/CompanyResearchCtaWiring2026_09_21.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/**
 * Strip // and /* *\/ comments so prose describing the contract can never
 * satisfy the contract. Naive on purpose: it also blanks comment-like text
 * inside string literals, which is fine — nothing asserted here lives in one.
 */
function readStripped(relPath) {
  const raw = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  assert.ok(raw.length > 0, `${relPath} is empty — wrong path?`);
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The body of a top-level `const <name> = ...` arrow function, brace-matched. */
function arrowFnBody(source, name) {
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `could not find "const ${name} =" — was it renamed?`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `no body brace after "const ${name} ="`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unbalanced braces reading ${name}`);
}

describe('Defect 1 — a JD upload hydrates the Company Intel panel', () => {
  const src = readStripped('src/components/ProfileIntelligenceSettings.tsx');

  test('doJdUpload sets the company dossier, not just the profile data', () => {
    const body = arrowFnBody(src, 'doJdUpload');
    assert.match(
      body,
      /setProfileData\(/,
      'doJdUpload should still refresh profileData',
    );
    assert.match(
      body,
      /applyCompanyDossier\(|setCompanyDossier\(/,
      'doJdUpload re-fetches the profile after a successful upload and that payload ' +
      'carries companyDossier — it must be applied, or the panel keeps the stale ' +
      'mount-time value and shows the CTA for a dossier that already exists',
    );
  });

  test('the adopted-ingest poll hydrates it too', () => {
    // An upload that started before this panel mounted is finalised by the
    // adopt poll, not by doJdUpload — so it needs its own hydration or the
    // symptom survives for exactly that case.
    const idx = src.indexOf('const jdSettled');
    assert.notEqual(idx, -1, 'the adopted-ingest finaliser should still exist');
    const region = src.slice(idx, src.indexOf('if (resumeSettled)', idx));
    assert.ok(region.length > 0 && region.length < 3000, 'failed to scope the adopt-poll region');
    assert.match(
      region,
      /applyCompanyDossier\(|setCompanyDossier\(/,
      'the adopted-ingest branch refreshes profileData but must hydrate the ' +
      'dossier too, or a JD ingested just before mount keeps showing the CTA',
    );
  });
});

describe('Defect 2 — the renderer waits for the fire-and-forget AOT run', () => {
  const src = readStripped('src/components/ProfileIntelligenceSettings.tsx');

  test('something reads aotStatus.companyResearch', () => {
    assert.match(
      src,
      /aotStatus\s*\?\.\s*companyResearch|aotStatus\.companyResearch/,
      'getProfileData publishes aotStatus.companyResearch; without reading it the ' +
      'renderer has no way to learn the automatic research finished, because ingest ' +
      'never pushes an event',
    );
  });

  test('the CTA is not even offered while the automatic run is in flight', () => {
    // The plumbing above only closes the double-spend AFTER the dossier lands.
    // For the 20-60s the AOT run takes, companyDossier is legitimately null —
    // so without this the panel shows "Ready to research → Research Now", the
    // exact screen that trained the habit, and a click there fires a SECOND
    // query set concurrently with the run already spending.
    assert.match(
      src,
      /const aotResearching\s*=\s*profileData\?\.\s*aotStatus\?\.\s*companyResearch\s*===\s*'running'/,
      'a flag derived from aotStatus is needed to gate the empty state',
    );
    assert.match(
      src,
      /\{!companyDossier && !companyResearching && !aotResearching && companyName && \(/,
      'the "Research Now" empty state must be suppressed while AOT is researching',
    );
    assert.match(
      src,
      /\{\(companyResearching \|\| aotResearching\) && companyName && \(/,
      'the researching skeleton must cover the automatic run too, so the window ' +
      'reads as work-in-progress rather than as nothing having happened',
    );
  });

  test('it polls while the value is "running"', () => {
    assert.match(
      src,
      /companyResearch\s*(!==|===)\s*'running'/,
      "the poll must key off the 'running' state the pipeline sets synchronously " +
      'before its first await',
    );
    assert.match(src, /setTimeout\(/, 'polling needs a timer');
  });
});

describe('Defect 3 — the CTA no longer re-buys a cached dossier', () => {
  const handlers = readStripped('electron/ipcHandlers.ts');
  const preload = readStripped('electron/preload.ts');
  const src = readStripped('src/components/ProfileIntelligenceSettings.tsx');

  test('the IPC handler takes forceRefresh from the caller instead of hardcoding true', () => {
    const idx = handlers.indexOf("safeHandle('profile:research-company'");
    assert.notEqual(idx, -1, "profile:research-company handler not found");
    const region = handlers.slice(idx, idx + 4000);

    assert.doesNotMatch(
      region,
      /researchCompany\(\s*companyName\s*,\s*jdCtx\s*,\s*true\s*\)/,
      'hardcoding forceRefresh=true makes every CTA click skip the 24h cache and ' +
      're-spend 14-20 Tavily credits on a dossier the AOT run already saved',
    );
    assert.match(
      region,
      /researchCompany\(\s*companyName\s*,\s*jdCtx\s*,\s*forceRefresh\s*\)/,
      'the handler should pass the caller-supplied flag through',
    );
    assert.match(
      region,
      /forceRefresh\s*:\s*boolean\s*=\s*false/,
      'the default must be the cheap one: an omitted flag means "serve the cache"',
    );
  });

  test('preload forwards the second argument', () => {
    const idx = preload.indexOf('profileResearchCompany: (');
    assert.notEqual(idx, -1, 'profileResearchCompany bridge not found');
    const region = preload.slice(idx, idx + 400);
    assert.match(
      region,
      /forceRefresh/,
      'the bridge dropped the flag, so the renderer could never ask for a refresh',
    );
  });

  test('the "Research Now" CTA asks for the cache and only "Refresh" forces', () => {
    assert.match(
      src,
      /onClick=\{\(\)\s*=>\s*doCompanyResearch\(true\)\}/,
      'the Refresh pill must explicitly force',
    );
    assert.match(
      src,
      /onClick=\{\(\)\s*=>\s*doCompanyResearch\(false\)\}/,
      'the Research Now CTA must NOT force',
    );
    assert.doesNotMatch(
      src,
      /onClick=\{doCompanyResearch\}/,
      'passing the handler by reference hands React\'s MouseEvent to the first ' +
      'parameter — a truthy object — which would silently force-refresh on every ' +
      'click, exactly the bug being fixed',
    );
  });
});
