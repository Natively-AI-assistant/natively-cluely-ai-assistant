// electron/services/__tests__/SessionContext2026_10_24.test.mjs
//
// Session context (launcher "Resume & JD"): the resume/JD block added to every
// live answer's system prompt. Pure builders are exercised from the compiled
// module; the LLMHelper wiring is pinned at source level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const mod = require(path.resolve(repoRoot, 'dist-electron/electron/services/SessionContext.js'));

const state = (over = {}) => ({
  enabled: true,
  resumeText: '',
  resumeFileName: '',
  jdText: '',
  jdFileName: '',
  ...over,
});

test('empty when disabled or when nothing is loaded', () => {
  assert.equal(mod.buildSessionContextBlock(state()), '');
  assert.equal(mod.buildSessionContextBlock(state({ enabled: false, resumeText: 'Jane, SWE' })), '');
});

test('resume and JD go in the grounding tags with their rules', () => {
  const block = mod.buildSessionContextBlock(state({ resumeText: 'Jane Doe — 5 yrs Go', jdText: 'Senior Go engineer' }));
  assert.match(block, /<candidate_profile source="user_resume">\nJane Doe — 5 yrs Go\n<\/candidate_profile>/);
  assert.match(block, /<target_job source="user_jd">\nSenior Go engineer\n<\/target_job>/);
  assert.match(block, /first person/);
  assert.match(block, /never invent/);
  assert.match(block, /Tailor answers to the role/);
});

test('JD alone has no candidate rules', () => {
  const block = mod.buildSessionContextBlock(state({ jdText: 'PM role' }));
  assert.doesNotMatch(block, /candidate_profile/);
  assert.match(block, /<target_job/);
});

test('text is normalized and capped per kind', () => {
  const long = 'x'.repeat(mod.SESSION_RESUME_MAX_CHARS + 500);
  assert.equal(mod.normalizeSessionText(long, 'resume').length, mod.SESSION_RESUME_MAX_CHARS);
  assert.equal(mod.normalizeSessionText(long, 'jd').length, mod.SESSION_JD_MAX_CHARS);
  assert.equal(mod.normalizeSessionText('a\r\nb   \n\n\n\nc  ', 'jd'), 'a\nb\n\nc');
  assert.equal(mod.normalizeSessionText(42, 'jd'), '');
});

test('not added twice when a candidate profile is already in the prompt', () => {
  const block = mod.buildSessionContextBlock(state({ resumeText: 'Jane' }));
  assert.equal(mod.withSessionContext('You are helpful.', block), `You are helpful.${block}`);
  const premium = 'Base\n<candidate_profile>premium</candidate_profile>';
  assert.equal(mod.withSessionContext(premium, block), premium);
  assert.equal(mod.withSessionContext('Base', ''), 'Base');
});

test('LLMHelper adds the block before the language suffix, read live', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');
  assert.match(
    src,
    /private injectLanguageInstruction\(systemPrompt: string\): string \{[\s\S]*?return `\$\{withSessionContext\(systemPrompt, getSessionContextBlock\(\)\)\}\$\{this\.buildLanguageInstructionSuffix\(\)\}`;/,
  );
  const ctx = fs.readFileSync(path.join(repoRoot, 'electron/services/SessionContext.ts'), 'utf8');
  assert.doesNotMatch(ctx, /let cached/, 'a module-level cache goes stale across esbuild bundles');
});

test('session context IPC is not Pro-gated', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const start = src.indexOf("safeHandle('session-context:get'");
  const end = src.indexOf("safeHandle('session-context:set-enabled'");
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(src.slice(start, end + 400), /isProOrTrialActive/);
});
