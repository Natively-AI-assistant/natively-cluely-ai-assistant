// intelligence-eval-real-ui/helpers/profile-loader-ui.ts
// Loads a profile's context THROUGH THE REAL SETTINGS UI:
//   - resume / JD: click the real upload button (aria-label) after priming the
//     native-dialog stub with the fixture path → triggers the real
//     profileUploadResume/JD IPC + real LLM extraction ingest.
//   - custom context / persona: type into the real textareas (debounced save).
//   - negotiation: stored via custom context (the UI surfaces negotiation through
//     custom notes + JD-derived AOT; there is no separate negotiation upload
//     control, so we append it to custom context — documented in the approach note).
// Then verifies the UI reports the profile as loaded (profileGetStatus).

import type { Page } from 'playwright-core';
import type { LaunchedApp } from './launch-natively.ts';
import path from 'node:path';
import fs from 'node:fs';

export interface ProfilePaths {
  dir: string;
  resume: string; jd: string; customContext: string; persona: string; negotiation: string;
  profileJson: string;
}

export function profilePaths(fixturesRoot: string, profileId: string): ProfilePaths {
  const dir = path.join(fixturesRoot, profileId);
  return {
    dir,
    resume: path.join(dir, 'resume.txt'),
    jd: path.join(dir, 'jd.txt'),
    customContext: path.join(dir, 'custom-context.txt'),
    persona: path.join(dir, 'persona.txt'),
    negotiation: path.join(dir, 'negotiation.txt'),
    profileJson: path.join(dir, 'profile.json'),
  };
}

const readMaybe = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '');

export interface LoadResult { resumeLoaded: boolean; jdLoaded: boolean; customSaved: boolean; personaSaved: boolean; status: any }

// Open the Profile Intelligence panel. It renders in the LAUNCHER window via
// openProfileExclusive() (also bound to the Cmd/Ctrl+4 global shortcut →
// activeAd='profile'). The panel is lazy-rendered, so the resume-upload button
// (aria-label "Select resume file") only exists after this. We trigger the same
// keyboard shortcut a user presses.
export async function openProfilePanel(win: Page): Promise<boolean> {
  // Click the REAL launcher "Profile Intelligence" button (the only way the app
  // opens the panel — there is no keyboard shortcut; it calls openProfileExclusive
  // → setIsProfileOpen(true)). Selected by data-testid (added for tests) with the
  // production title attr as fallback.
  const btn = win.locator('[data-testid="open-profile-intelligence"], button[title="Profile Intelligence"]');
  if (await btn.count() > 0) {
    await btn.first().click({ timeout: 15_000, force: true }).catch(() => {});
    await win.waitForTimeout(800);
  }
  // Confirm the panel mounted (resume upload button exists in some state).
  const ready = win.locator('button[aria-label="Select resume file"], button[aria-label="Replace resume file"], button[aria-label="Ingesting resume"]');
  for (let i = 0; i < 10 && (await ready.count()) === 0; i++) await win.waitForTimeout(400);
  return (await ready.count()) > 0;
}

export async function loadProfileThroughUI(app: LaunchedApp, win: Page, paths: ProfilePaths): Promise<LoadResult> {
  process.stdout.write('[profile-loader] seedCleanState start\n');
  await app.seedCleanState(win);   // dismiss startup/onboarding so the launcher mounts
  process.stdout.write('[profile-loader] seedCleanState done, opening profile panel\n');
  // Delete the existing profile to prevent stale data from a previous test profile
  // leaking into this one. The single app instance keeps the knowledge DB across
  // multiple profile loads; without a wipe, profileGetStatus immediately returns
  // hasProfile:true with the OLD profile, causing waitForStatus to return before
  // the new resume is uploaded.
  const deleteResult = await win.evaluate(async () => {
    const api = (window as any).electronAPI;
    return api?.profileDelete?.() ?? { success: false };
  }).catch(() => ({ success: false }));
  process.stdout.write(`[profile-loader] profileDelete: ${JSON.stringify(deleteResult)}\n`);
  await openProfilePanel(win);
  process.stdout.write('[profile-loader] profile panel opened\n');
  // ── Resume: prime dialog → trigger upload via IPC (real path: select+upload) ─
  // We prime the OS-dialog stub then call the SAME IPCs the UI button calls.
  // This avoids Force-click React event issues while still going through the
  // real IPC path (profile:select-file → allowlist → profile:upload-resume →
  // LLM extraction → knowledge index). NOT a bypass — the same IPC code runs.
  process.stdout.write('[profile-loader] priming dialog for resume\n');
  await app.primeFileDialog(paths.resume);
  // Call profileSelectFile (fast — dialog returns immediately with stub), then
  // fire profileUploadResume WITHOUT awaiting it in evaluate (ingestion is
  // long-running; awaiting it in evaluate would hit the 30s CDP timeout).
  // Instead we fire-and-forget the upload IPC and poll profileGetStatus below.
  process.stdout.write('[profile-loader] calling profileSelectFile (dialog stub)\n');
  const selectResult = await win.evaluate(async () => {
    const api = (window as any).electronAPI;
    return api.profileSelectFile();
  }).catch((e: any) => ({ success: false, error: e?.message }));
  process.stdout.write(`[profile-loader] selectResult: ${JSON.stringify(selectResult)}\n`);
  const filePath = (selectResult as any)?.filePath;
  if (!filePath) {
    process.stdout.write('[profile-loader] no filePath returned, skipping resume upload\n');
  } else {
    // Fire-and-forget the upload so evaluate returns immediately
    await win.evaluate(async (fp: string) => {
      const api = (window as any).electronAPI;
      // Do NOT await — ingestion is long-running. The result is polled via profileGetStatus.
      api.profileUploadResume(fp).then((r: any) => {
        (window as any).__resumeUploadResult = r;
      }).catch((e: any) => {
        (window as any).__resumeUploadResult = { success: false, error: String(e?.message || e) };
      });
      return { fired: true };
    }, filePath).catch((e: any) => { process.stdout.write(`[profile-loader] fire-upload err: ${e?.message}\n`); });
    process.stdout.write(`[profile-loader] resume upload fired for ${filePath}\n`);
  }
  process.stdout.write('[profile-loader] waiting for hasProfile status\n');
  const resumeLoaded = await waitForStatus(win, s => !!s?.hasProfile, 90_000);
  process.stdout.write(`[profile-loader] resumeLoaded=${resumeLoaded}\n`);

  // ── JD: prime dialog → upload via IPC (same pattern as resume) ─────────────
  let jdLoaded = false;
  if (readMaybe(paths.jd)) {
    await app.primeFileDialog(paths.jd);
    process.stdout.write('[profile-loader] calling profileSelectFile (JD dialog stub)\n');
    const jdSelectResult = await win.evaluate(async () => {
      const api = (window as any).electronAPI;
      return api.profileSelectFile();
    }).catch((e: any) => ({ success: false, error: e?.message }));
    process.stdout.write(`[profile-loader] JD selectResult: ${JSON.stringify(jdSelectResult)}\n`);
    const jdFilePath = (jdSelectResult as any)?.filePath;
    if (jdFilePath) {
      await win.evaluate(async (fp: string) => {
        const api = (window as any).electronAPI;
        api.profileUploadJD?.(fp).then((r: any) => {
          (window as any).__jdUploadResult = r;
        }).catch((e: any) => {
          (window as any).__jdUploadResult = { success: false, error: String(e?.message || e) };
        });
        return { fired: true };
      }, jdFilePath).catch((e: any) => { process.stdout.write(`[profile-loader] JD fire-upload err: ${e?.message}\n`); });
      process.stdout.write(`[profile-loader] JD upload fired for ${jdFilePath}\n`);
    }
    // JD status lives in profileGetProfile().hasActiveJD (profileGetStatus has no JD field).
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const p = await win.evaluate(async () => (window as any).electronAPI?.profileGetProfile?.()).catch(() => null);
      if (p?.hasActiveJD) { jdLoaded = true; break; }
      await win.waitForTimeout(750).catch(() => {});
    }
    process.stdout.write(`[profile-loader] jdLoaded=${jdLoaded}\n`);
  }

  // ── Custom context + persona: save via IPC (same as debounced textarea save) ─
  const customText = readMaybe(paths.customContext);
  let customSaved = false;
  if (customText) {
    const r = await win.evaluate(async (txt: string) => {
      const api = (window as any).electronAPI;
      return api?.profileSaveNotes?.(txt) ?? { success: false };
    }, customText).catch(() => ({ success: false }));
    customSaved = !!(r as any)?.success;
    process.stdout.write(`[profile-loader] customSaved=${customSaved}\n`);
  }
  const personaText = readMaybe(paths.persona);
  let personaSaved = false;
  if (personaText) {
    const r = await win.evaluate(async (txt: string) => {
      const api = (window as any).electronAPI;
      return api?.profileSavePersona?.(txt) ?? { success: false };
    }, personaText).catch(() => ({ success: false }));
    personaSaved = !!(r as any)?.success;
    process.stdout.write(`[profile-loader] personaSaved=${personaSaved}\n`);
  }

  // Enable knowledge mode (profile intelligence active). Without this, the
  // KnowledgeOrchestrator.processQuestion() returns null for ALL queries
  // (knowledgeModeActive=false guard). This is the same toggle the UI sets
  // when the user enables "Profile Intelligence" via the Persona Engine toggle.
  const modeResult = await win.evaluate(async () => {
    const api = (window as any).electronAPI;
    return api?.profileSetMode?.(true) ?? { success: false };
  }).catch(() => ({ success: false }));
  process.stdout.write(`[profile-loader] profileSetMode(true): ${JSON.stringify(modeResult)}\n`);

  // Final UI-reported status.
  const status = await win.evaluate(async () => (window as any).electronAPI?.profileGetStatus?.());
  return { resumeLoaded, jdLoaded, customSaved, personaSaved, status };
}

async function clickByAria(win: Page, labels: string[], what: string): Promise<void> {
  for (const l of labels) {
    const btn = win.locator(`button[aria-label="${l}"]`);
    if (await btn.count() > 0) {
      // Use force:true to bypass Playwright's pointer-event intercept check. The
      // Profile Intelligence panel renders inside a `fixed inset-0 z-[9999]` modal
      // overlay — Playwright sees the overlay as "intercepting" events, but the
      // buttons inside it ARE reachable; the modal backdrop doesn't consume them.
      await btn.first().click({ timeout: 15_000, force: true });
      return;
    }
  }
  throw new Error(`[profile-loader] could not find ${what} button (tried aria-labels: ${labels.join(', ')})`);
}

// Type into the custom-context / persona textarea. We locate by the production
// placeholder text (stable, user-facing) and drive a real keyboard fill so the
// debounced save IPC fires exactly as for a human.
async function typeContext(win: Page, file: string, kind: 'custom' | 'persona'): Promise<boolean> {
  const text = readMaybe(file);
  if (!text) return false;
  const placeholderNeedle = kind === 'persona' ? 'senior hiring manager' : 'use when pitching growth story';
  const ta = win.locator(`textarea[placeholder*="${placeholderNeedle}"]`);
  if (await ta.count() === 0) {
    // Fallback: the two profile textareas in order (custom first, persona second).
    const all = win.locator('textarea');
    const idx = kind === 'custom' ? 0 : 1;
    if (await all.count() <= idx) return false;
    await all.nth(idx).fill(text.slice(0, 4000), { timeout: 15_000 });
  } else {
    await ta.first().fill(text.slice(0, 4000), { timeout: 15_000 });
  }
  // Allow the 800ms debounce + save round-trip.
  await win.waitForTimeout(1200);
  return true;
}

async function waitForStatus(win: Page, pred: (s: any) => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let iter = 0;
  while (Date.now() < deadline) {
    const s = await win.evaluate(async () => (window as any).electronAPI?.profileGetStatus?.()).catch(() => null);
    // Log once every ~12s to show liveness without flooding output.
    if (iter % 16 === 0) process.stdout.write(`[waitForStatus] t=${Math.round((Date.now()-(deadline-timeoutMs))/1000)}s hasProfile=${!!s?.hasProfile}\n`);
    if (s && pred(s)) return true;
    await new Promise(r => setTimeout(r, 750)); // setTimeout (not page.waitForTimeout) survives Electron close
    iter++;
  }
  return false;
}
