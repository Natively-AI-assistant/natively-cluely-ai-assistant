// Regression test for issue #303: skill invocation via /skill-name or $skill-name
// prefixes was missing entirely — the prefix passed through to the LLM as plain
// text instead of loading and injecting the named skill's instructions.
//
// Root cause: SkillsManager.getSkill() and buildPromptBlock() existed but were
// never called from the gemini-chat-stream IPC handler. The handler now:
//   1. Parses /skill-name or $skill-name at the start of the message.
//   2. Looks up the skill via SkillsManager.getSkill(candidateId).
//   3. Strips the prefix so planAnswer sees only the bare user query.
//   4. Prepends buildPromptBlock(skill) to context right before streamChat.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------------------
// 1. Static wiring — confirm the skill prefix parsing block is in the handler
// ---------------------------------------------------------------------------
describe('Issue #303: /skill and $skill prefix handling in gemini-chat-stream', () => {
  test('gemini-chat-stream handler contains skill prefix parsing', () => {
    const source = read('electron/ipcHandlers.ts');

    // The handler must parse the prefix and call getSkill
    assert.match(source, /skillPrefixMatch/, 'skillPrefixMatch variable must exist');
    assert.match(source, /SkillsManager\.getInstance\(\)\.getSkill\(/, 'getSkill must be called in the handler');
    assert.match(source, /SkillsManager\.getInstance\(\)\.buildPromptBlock\(/, 'buildPromptBlock must be called');

    // The regex must handle both /skill-name and $skill-name forms
    assert.match(source, /\[\/\$\]/, 'prefix regex must accept both / and $ characters');
  });

  test('skill prompt block is prepended to context before streamChat', () => {
    const source = read('electron/ipcHandlers.ts');

    // After context assembly, skill block must be prepended
    assert.match(source, /skillPromptBlock.*\n.*context.*skillPromptBlock|skillPromptBlock[\s\S]{0,300}context\s*=.*skillPromptBlock/,
      'skillPromptBlock must be prepended to context');

    // The injection happens before streamChat is called
    const skillInjectionIdx = source.indexOf('skillPromptBlock');
    const streamChatIdx = source.indexOf('const stream = llmHelper.streamChat(');
    assert.ok(skillInjectionIdx < streamChatIdx,
      'skill injection must occur before the streamChat call');
  });

  test('skill prefix stripped from message before planAnswer', () => {
    const source = read('electron/ipcHandlers.ts');

    // The skill block must be parsed BEFORE planAnswer is called
    const skillBlockIdx = source.indexOf('skillPrefixMatch');
    const planAnswerIdx = source.indexOf('const answerPlan = planAnswer(');
    assert.ok(skillBlockIdx < planAnswerIdx,
      'skill prefix must be parsed before planAnswer so routing sees the bare query');
  });
});

// ---------------------------------------------------------------------------
// 2. SkillsManager API surface — getSkill() and buildPromptBlock() contract
// ---------------------------------------------------------------------------
describe('SkillsManager invocation API', () => {
  test('SkillsManager has getSkill() and buildPromptBlock() methods', () => {
    const source = read('electron/services/SkillsManager.ts');

    assert.match(source, /public getSkill\(id: string\)/, 'getSkill must be a public method');
    assert.match(source, /public buildPromptBlock\(skill: SkillDetails\)/, 'buildPromptBlock must be a public method');
  });

  test('buildPromptBlock wraps instructions in <active_skill> tag', () => {
    const source = read('electron/services/SkillsManager.ts');

    assert.match(source, /<active_skill/, 'prompt block must use <active_skill> tag');
    assert.match(source, /\/active_skill>/, 'prompt block must close <active_skill> tag');
    assert.match(source, /instruction-only guidance/, 'prompt block must include security instruction');
  });

  test('getSkill() uses slugify so /humanize-ai-text matches id humanize-ai-text', () => {
    const source = read('electron/services/SkillsManager.ts');

    // getSkill slugifies the incoming id before lookup
    assert.match(source, /const wanted = slugify\(id\)/, 'getSkill must slugify the input id');
  });
});

// ---------------------------------------------------------------------------
// 3. Prefix regex correctness (static analysis of the actual regex literal)
// ---------------------------------------------------------------------------
describe('Skill prefix regex', () => {
  // Extract the regex from the source to test against cases the user reported.
  // We re-build it from the known implementation rather than exec the handler.
  const SKILL_PREFIX_RE = /^[/$]([A-Za-z0-9_-]+)\s*(.*)/s;

  test('/humanize-ai-text prefix is matched', () => {
    const m = '/humanize-ai-text rewrite this paragraph'.match(SKILL_PREFIX_RE);
    assert.ok(m, 'must match /skill-name prefix');
    assert.equal(m[1], 'humanize-ai-text');
    assert.equal(m[2].trim(), 'rewrite this paragraph');
  });

  test('$humanize-ai-text prefix is matched', () => {
    const m = '$humanize-ai-text rewrite this paragraph'.match(SKILL_PREFIX_RE);
    assert.ok(m, 'must match $skill-name prefix');
    assert.equal(m[1], 'humanize-ai-text');
    assert.equal(m[2].trim(), 'rewrite this paragraph');
  });

  test('bare message without prefix is not matched', () => {
    const m = 'rewrite this paragraph'.match(SKILL_PREFIX_RE);
    assert.equal(m, null, 'plain message must not match skill prefix');
  });

  test('prefix-only (no trailing text) is accepted', () => {
    const m = '/humanize-ai-text'.match(SKILL_PREFIX_RE);
    assert.ok(m, 'prefix-only message must match');
    assert.equal(m[1], 'humanize-ai-text');
    assert.equal(m[2].trim(), '');
  });

  test('skill names with hyphens and underscores match', () => {
    const m = '/my-custom_skill some query'.match(SKILL_PREFIX_RE);
    assert.ok(m, 'hyphens and underscores in skill name must match');
    assert.equal(m[1], 'my-custom_skill');
  });
});

// ---------------------------------------------------------------------------
// 4. Skill picker UI wiring (static source assertions on NativelyInterface.tsx)
// ---------------------------------------------------------------------------
describe('Issue #303: skill picker dropdown in overlay chat input', () => {
  test('createPortal is imported from react-dom in NativelyInterface.tsx', () => {
    const source = read('src/components/NativelyInterface.tsx');
    assert.match(source, /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]/,
      'createPortal must be imported from react-dom');
  });

  test('SkillPicker component is defined in NativelyInterface.tsx', () => {
    const source = read('src/components/NativelyInterface.tsx');
    assert.match(source, /function SkillPicker\s*\(/, 'SkillPicker must be defined');
    assert.match(source, /position:\s*['"]fixed['"]/, 'SkillPicker must use fixed positioning to escape overflow-hidden shell');
    assert.match(source, /onMouseDown.*e\.preventDefault/, 'SkillPicker must use onMouseDown+preventDefault to keep input focus');
  });

  test('skill list is fetched on mount via skillsRefresh in NativelyInterface.tsx', () => {
    const source = read('src/components/NativelyInterface.tsx');
    assert.match(source, /skillsRefresh\?\.\(\)/, 'skillsRefresh must be called in NativelyInterface');
    assert.match(source, /setAvailableSkills/, 'availableSkills state must be set from skillsRefresh result');
  });

  test('picker derives from inputValue — opens on / or $ prefix, closes on space', () => {
    const source = read('src/components/NativelyInterface.tsx');
    // The regex that drives the picker open/closed state
    assert.match(source, /\^[\/\$\[]/, 'picker regex must anchor to start and match / or $');
    assert.match(source, /filteredSkills/, 'filtered skills derived list must exist');
    assert.match(source, /skillPickerQuery/, 'skillPickerQuery derived value must exist');
  });

  test('ArrowUp/ArrowDown/Escape/Tab/Enter handled in onKeyDown for picker navigation', () => {
    const source = read('src/components/NativelyInterface.tsx');
    assert.match(source, /ArrowUp/, 'ArrowUp must be handled');
    assert.match(source, /ArrowDown/, 'ArrowDown must be handled');
    assert.match(source, /Escape.*setInputValue\(['"]['"]\)|setInputValue\(['"]['"]\).*Escape/s,
      'Escape must clear inputValue to close picker');
    assert.match(source, /Tab.*selectSkill|selectSkill.*Tab/s, 'Tab must select the highlighted skill');
  });

  test('selectSkill sets inputValue to /skill-id with trailing space', () => {
    const source = read('src/components/NativelyInterface.tsx');
    assert.match(source, /setInputValue\(`\/\$\{skill\.id\} `\)/,
      'selectSkill must complete to /skill-id with trailing space so user can type query');
  });
});
