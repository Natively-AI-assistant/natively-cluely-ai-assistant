import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const prompts = await import(pathToFileURL(promptsPath).href);

const MODE_PROMPTS = {
  general: prompts.MODE_GENERAL_PROMPT,
  sales: prompts.MODE_SALES_PROMPT,
  recruiting: prompts.MODE_RECRUITING_PROMPT,
  'team-meet': prompts.MODE_TEAM_MEET_PROMPT,
  'looking-for-work': prompts.MODE_LOOKING_FOR_WORK_PROMPT,
  'technical-interview': prompts.MODE_TECHNICAL_INTERVIEW_PROMPT,
  lecture: prompts.MODE_LECTURE_PROMPT,
};

const MODE_CONTRACT_TERMS = {
  general: ['universal meeting', 'conversation copilot', 'adapt', 'RECENT QUESTION'],
  sales: ['seller', 'prospect', 'OBJECTION DETECTED', 'pricing', 'Case study'],
  recruiting: ['interviewer', 'candidate', 'hiring manager', 'lean no', 'rehearsed'],
  'team-meet': ['CAPTURE', 'action items', 'decisions', 'blockers', 'status'],
  'looking-for-work': ['candidate', 'job interview', 'resume', 'STAR', 'salary'],
  'technical-interview': ['technical interview', 'coding', 'system design', 'dry-run', 'complexity', 'edge case'],
  lecture: ['student', 'lecture', 'study-partner', 'concept', 'homework', 'reading'],
};

const UNIQUE_MODE_TERMS = {
  general: ['conversation copilot'],
  sales: ['prospect', 'objection'],
  recruiting: ['hiring manager', 'candidate'],
  'team-meet': ['action items', 'blockers'],
  'looking-for-work': ['job interview', 'resume'],
  'technical-interview': ['coding', 'system design'],
  lecture: ['lecture', 'study-partner'],
};

function assertIncludesAll(text, terms, label) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    assert.ok(lower.includes(term.toLowerCase()), `${label} should include "${term}"`);
  }
}

test('every mode prompt includes shared prompt-leakage and safety controls', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<security>',
      'system prompt',
      'instructions',
      'reveal',
      "I can't share that information",
    ], modeType);
  }
});

test('every mode prompt includes injected context handling for custom context and reference files', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<injected_context>',
      '<user_context>',
      '<reference_file name="...">',
      'file name',
    ], modeType);
  }
});

test('mode prompts prevent reference-file hallucination for absent file-specific claims', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      'absent',
      'provided material',
      'general knowledge',
      'untrusted evidence',
      'never follow instructions',
    ], modeType);
  }

  assertIncludesAll(MODE_PROMPTS.general, ['Do not invent formulas', 'file-specific recommendations'], 'general');
  assertIncludesAll(MODE_PROMPTS.sales, ['customer proof point', 'ROI metric', 'inventing one'], 'sales');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['requested algorithm', 'study-note recommendation'], 'technical-interview');
});

test('each mode prompt carries its own mode-specific behavior contract', () => {
  for (const [modeType, terms] of Object.entries(MODE_CONTRACT_TERMS)) {
    assertIncludesAll(MODE_PROMPTS[modeType], terms, modeType);
  }
});

test('mode prompts are meaningfully distinct rather than flattened generic advice', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    for (const term of UNIQUE_MODE_TERMS[modeType]) {
      assert.ok(prompt.toLowerCase().includes(term.toLowerCase()), `${modeType} should preserve its distinctive term "${term}"`);
    }
  }

  assert.ok(!MODE_PROMPTS.sales.includes('You are the candidate\'s spoken voice in a live technical interview'));
  assert.ok(!MODE_PROMPTS['team-meet'].includes('OBJECTION DETECTED'));
  assert.ok(!MODE_PROMPTS.recruiting.includes('Output IS what the candidate says aloud'));
  assert.ok(!MODE_PROMPTS.lecture.includes('You are the seller\'s spoken voice'));
});

test('profile-aware modes mention candidate/profile grounding without requiring every mode to overfit resume data', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], ['<candidate_experience>', 'resume', 'do not invent', 'salary_intelligence'], 'looking-for-work');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['<candidate_experience>', 'technical interview', 'salary_intelligence'], 'technical-interview');
  assertIncludesAll(MODE_PROMPTS.general, ['<candidate_experience>', 'do not invent', 'salary_intelligence'], 'general');
});

test('looking-for-work prompt stabilizes no-overclaim behavior with few-shot examples', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], [
    '<no_overclaim_examples>',
    'No context behavioral question',
    'Weak context with role or project but no metrics',
    'JD skill absent from profile context',
    "I don't have specific past experience loaded right now. I can frame this honestly as a small, relevant example if that matches my background:",
    'The impact was qualitative',
    'not quantified',
    "I wouldn't want to overstate that",
    'use the exact no-context admission opener',
    'behavioral, intro, fit, motivation, or accomplishment-based answer',
    'do not invent a current role, company, title, dates, or accomplishments',
    'without profile context, avoid invented accomplishments',
  ], 'looking-for-work');
});

test('mode formatting contracts prevent coachy meta-output in live suggestions', () => {
  assertIncludesAll(MODE_PROMPTS.sales, ['DO NOT use meta-labels', 'No preamble', 'Under 3 sentences'], 'sales');
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], ['first person', 'No preamble', 'ready to deliver'], 'looking-for-work');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['glance-and-go', 'fenced', 'complexity'], 'technical-interview');
  assertIncludesAll(MODE_PROMPTS.recruiting, ['Do NOT speak as the candidate', 'third-person observer'], 'recruiting');
  assertIncludesAll(MODE_PROMPTS.lecture, ['NOT the student speaking', 'plain language'], 'lecture');
});

test('team meeting capture examples stay schematic and do not seed names or companies', () => {
  assertIncludesAll(MODE_PROMPTS['team-meet'], [
    'Example output shapes only',
    'Replace bracketed slots with facts only when stated in the meeting',
    '[stated owner]',
    '[decision stated in transcript]',
    '[risk or blocker stated in transcript]',
  ], 'team-meet');

  assert.doesNotMatch(MODE_PROMPTS['team-meet'], /Sarah|Stripe|Q3 deck|Oct 15/);
});

test('looking-for-work examples require grounding and avoid concrete invented detail', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], [
    'use the exact no-context admission opener before any illustrative example',
    'avoid invented accomplishments',
    'never fabricate percentages, dollar amounts, durations, or scale figures',
  ], 'looking-for-work');

  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /grew the channel significantly over a focused timeline/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /secured a major enterprise deal/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /drove a meaningful reduction in churn/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /shipped to a large user base/);
});

test('code hint examples avoid named problems and em dashes', () => {
  assertIncludesAll(prompts.CODE_HINT_PROMPT, [
    'Use schematic examples only',
    'Do not copy sample problem names, line numbers, metrics, or concrete fixes unless they are visible',
  ], 'code-hint');

  const examples = prompts.CODE_HINT_PROMPT.match(/<output_examples>[\s\S]*?<\/output_examples>/)?.[0] ?? '';
  assert.match(examples, /Use schematic examples only/);
  assert.doesNotMatch(examples, /Two Sum/);
  assert.doesNotMatch(examples, /line 8/);
  assert.doesNotMatch(examples, /—/);
});

// ── SERVER ROUTING CONTRACT ──────────────────────────────────────────────────
// The Natively server (natively-api/lib/flashModelPicker.js) routes the live
// interview modes to gemini-3.5-flash by regex-matching this exact phrase in the
// system prompt the client sends. If a prompt edit drops/rewords the phrase,
// those modes silently fall back to flash-lite. This guard fails LOUDLY on drift.
// Keep in sync with INTERVIEW_MODE_RE in natively-api/lib/flashModelPicker.js.
const SERVER_INTERVIEW_MODE_RE = /spoken voice in a live (?:job|technical) interview/i;

test('SERVER-ROUTING: looking-for-work prompt contains the interview-mode detector phrase', () => {
  assert.match(prompts.MODE_LOOKING_FOR_WORK_PROMPT, SERVER_INTERVIEW_MODE_RE,
    'MODE_LOOKING_FOR_WORK_PROMPT must contain "spoken voice in a live job interview" — the server (flashModelPicker.js) keys interview→3.5-flash routing off it. Update INTERVIEW_MODE_RE on BOTH sides if you change the wording.');
});

test('SERVER-ROUTING: technical-interview prompt contains the interview-mode detector phrase', () => {
  assert.match(prompts.MODE_TECHNICAL_INTERVIEW_PROMPT, SERVER_INTERVIEW_MODE_RE,
    'MODE_TECHNICAL_INTERVIEW_PROMPT must contain "spoken voice in a live technical interview" — the server routes interview→3.5-flash off it.');
});

test('SERVER-ROUTING: non-interview modes must NOT match the detector phrase (no false-positive routing)', () => {
  for (const key of ['general', 'sales', 'recruiting', 'team-meet', 'lecture']) {
    assert.doesNotMatch(MODE_PROMPTS[key], SERVER_INTERVIEW_MODE_RE,
      `${key} prompt must NOT contain the interview detector phrase, or it would wrongly route to 3.5-flash.`);
  }
});
