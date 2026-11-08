// "About you" moved into Profile Intelligence › Cue Cards (2026-11-01) and is
// Pro or trial only: the meeting notes read the bio only with access, and the
// save handler refuses it without. A free user's saved text is kept, not read.
//
// Pure module plus source wiring checks; no Electron, no licence, no platform
// branches (LicenseManager / CredentialsManager hide the macOS / Windows
// storage), so the same assertions hold on both.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const dist = (rel) => pathToFileURL(path.resolve(root, 'dist-electron/electron', rel)).href;
const read = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');

const { bioForNotes } = await import(dist('services/proAccess.js'));

describe('About you is Pro only', () => {
  test('notes read the bio with Pro or a trial, one line, at most 600 characters', () => {
    assert.equal(bioForNotes('  Head of Product\n at Acme.  ', true), 'Head of Product at Acme.');
    assert.equal(bioForNotes('x'.repeat(700), true).length, 600);
  });

  test('without access the notes read nothing, even with a saved bio', () => {
    assert.equal(bioForNotes('Head of Product at Acme.', false), '');
  });

  test('non-text settings values are ignored', () => {
    assert.equal(bioForNotes(undefined, true), '');
    assert.equal(bioForNotes(42, true), '');
  });

  test('MeetingPersistence gates the bio through bioAllowed()', () => {
    const src = read('electron/MeetingPersistence.ts');
    assert.match(src, /bioForNotes\(sm\.get\('userBio'\), this\.bioAllowed\(\)\)/);
    assert.match(src, /protected bioAllowed\(\): boolean \{\s*return isProOrTrialActive\(\);/);
  });

  test('the save handler refuses without Pro; get stays open', () => {
    const src = read('electron/ipcHandlers.ts');
    const set = src.slice(src.indexOf("safeHandle('user-bio-set'"), src.indexOf("safeHandle('user-bio-set'") + 700);
    assert.match(set, /if \(clean && !isProOrTrialActive\(\)\) return \{ success: false, error: 'pro_required' \}/, 'refuses text without Pro, lets anyone clear');
    const get = src.slice(src.indexOf("safeHandle('user-bio-get'"), src.indexOf("safeHandle('user-bio-get'") + 200);
    assert.doesNotMatch(get, /isProOrTrialActive/);
  });

  test('the box lives in Cue Cards, not Settings › Intelligence', () => {
    assert.match(read('src/components/OwnAnswersSection.tsx'), /<AboutYouCard hasAccess=\{hasAccess\} \/>/);
    assert.doesNotMatch(read('src/components/settings/IntelligenceSettings.tsx'), /AboutYou/);
    assert.equal(fs.existsSync(path.resolve(root, 'src/components/settings/AboutYouSettings.tsx')), false);
  });
});

// The real reader: MeetingPersistence.profileForNotes over a real
// SettingsManager (temp userData), through to the line the notes prompt reads.
describe('MeetingPersistence.profileForNotes, end to end', async () => {
  const os = await import('node:os');
  const { default: Module, createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'about-you-notes-'));
  const BIO = 'Head of Product at Acme Robotics. I care most about ship dates.';
  const smPath = path.resolve(root, 'dist-electron/electron/services/SettingsManager.js');
  const origLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') return { app: { getPath: () => dir, isPackaged: false, getAppPath: () => dir, isReady: () => true, on: () => {}, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {}, on: () => {} } };
    return origLoad.apply(this, arguments);
  };
  let sm, MeetingPersistence, ctx;
  try {
    delete globalThis.__nativelySettingsManagerV1__;
    sm = req(smPath).SettingsManager.getInstance();
    ({ MeetingPersistence } = req(path.resolve(root, 'dist-electron/electron/MeetingPersistence.js')));
    ctx = req(path.resolve(root, 'dist-electron/electron/services/meeting/meetingNotesContext.js'));
  } finally {
    Module._load = origLoad;
  }
  const read = (allowed) => MeetingPersistence.prototype.profileForNotes.call({ llmHelper: undefined, bioAllowed: () => allowed });

  test('a fresh install (no licence, no trial): not Pro, and live answers get no bio', () => {
    sm.set('userBio', BIO);
    const prev = Module._load;
    Module._load = function patched(request) {
      if (request === 'electron') return { app: { getPath: () => dir, isPackaged: false, getAppPath: () => dir, isReady: () => true, on: () => {}, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {}, on: () => {} } };
      return prev.apply(this, arguments);
    };
    try {
      const access = req(path.resolve(root, 'dist-electron/electron/services/proAccess.js'));
      assert.equal(access.isProOrTrialActive(), false);
      assert.equal(access.userBioForAnswers(), '');
    } finally {
      Module._load = prev;
    }
  });

  test('Pro or trial: the bio reaches the notes prompt line', () => {
    sm.set('userBio', BIO);
    sm.set('providerDataScopes', undefined);
    const profile = read(true);
    assert.equal(profile?.bio, BIO);
    const block = ctx.formatMeetingPeopleBlock(ctx.buildMeetingPeopleContext({ profile }));
    assert.match(block, /About the user, in their own words: Head of Product at Acme Robotics/);
  });

  test('free: nothing is read, though the text stays saved', () => {
    sm.set('userBio', BIO);
    assert.equal(read(false), undefined);
    assert.equal(sm.get('userBio'), BIO);
  });

  test('"Profile and history" or post-call summary scope off: nothing is read, even with Pro', () => {
    sm.set('userBio', BIO);
    sm.set('providerDataScopes', { profile_history: false });
    assert.equal(read(true), undefined);
    sm.set('providerDataScopes', { post_call_summary: false });
    assert.equal(read(true), undefined);
    sm.set('providerDataScopes', undefined);
  });
});
