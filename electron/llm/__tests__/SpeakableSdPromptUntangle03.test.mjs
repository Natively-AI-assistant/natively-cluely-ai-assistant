/**
 * Ticket 03 — Untangle TI so SYSTEM DESIGN ≠ DSA RESPONSE CONTRACT.
 * Asserts exported prompt constants (no Electron runtime).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const prompts = await import(pathToFileURL(promptsPath).href);

const {
  SHARED_CODING_RULES,
  MODE_TECHNICAL_INTERVIEW_PROMPT,
} = prompts;

describe('03 speakable SD — SHARED_CODING_RULES untangle', () => {
  test('applicability list no longer lumps SYSTEM DESIGN with DSA contract', () => {
    const guidelines = SHARED_CODING_RULES.match(/<coding_guidelines>[\s\S]*?<\/coding_guidelines>/)?.[0] ?? '';
    assert.ok(guidelines, 'coding_guidelines block present');
    // Old bug: "CODING, DSA, ALGORITHM, SQL, DEBUGGING, or SYSTEM DESIGN question"
    assert.doesNotMatch(
      guidelines,
      /CODING,\s*DSA,\s*ALGORITHM,\s*SQL,\s*DEBUGGING,\s*or\s*SYSTEM DESIGN/i,
      'must not list SYSTEM DESIGN in the DSA applicability lump',
    );
    assert.match(
      guidelines,
      /CODING,\s*DSA,\s*ALGORITHM,\s*SQL,\s*or\s*DEBUGGING/i,
      'coding types still listed',
    );
    assert.match(
      guidelines,
      /SYSTEM DESIGN questions do NOT use this contract/i,
      'explicit SD carve-out',
    );
  });

  test('SHARED_CODING_RULES still injects the six-heading CODING / DSA RESPONSE CONTRACT', () => {
    assert.match(SHARED_CODING_RULES, /CODING \/ DSA RESPONSE CONTRACT/);
    for (const h of [
      '## Approach',
      '## Technique / Data Structure / Algorithm Used',
      '## Code',
      '## Dry Run',
      '## Complexity',
      '## Interviewer Follow-up Points',
    ]) {
      assert.ok(SHARED_CODING_RULES.includes(h), `missing ${h}`);
    }
  });
});

describe('03 speakable SD — TI Delivery Framework path', () => {
  test('TI keeps <system_design> Delivery Framework and speakable bans', () => {
    const sd = MODE_TECHNICAL_INTERVIEW_PROMPT.match(/<system_design>[\s\S]*?<\/system_design>/)?.[0] ?? '';
    assert.ok(sd, '<system_design> block present');
    assert.match(sd, /Delivery Framework/);
    assert.match(sd, /Requirements\s*→\s*Core Entities/);
    assert.match(sd, /ONE Delivery Framework slice|one Delivery Framework slice/i);
    assert.match(sd, /NEVER emit DSA scaffolds|no DSA/i);
    assert.match(sd, /## Approach/);
    assert.match(sd, /## Code/);
    assert.match(sd, /impl-language|python/i);
    assert.match(sd, /```text|```ascii/);
  });

  test('TI output_contract SYSTEM DESIGN line is Delivery Framework, not DSA headings', () => {
    const contract = MODE_TECHNICAL_INTERVIEW_PROMPT.match(/<output_contract>[\s\S]*?<\/output_contract>/)?.[0] ?? '';
    assert.match(contract, /SYSTEM DESIGN:.*Delivery Framework/i);
    assert.match(contract, /No DSA/);
    // CODE ANSWER still points at the six-heading contract
    assert.match(contract, /CODE ANSWER:.*CODING \/ DSA RESPONSE CONTRACT/i);
  });

  test('TI still includes SHARED_CODING_RULES for coding/DSA turns', () => {
    assert.ok(MODE_TECHNICAL_INTERVIEW_PROMPT.includes('CODING / DSA RESPONSE CONTRACT'));
    assert.ok(MODE_TECHNICAL_INTERVIEW_PROMPT.includes('<coding_questions>'));
    assert.match(
      MODE_TECHNICAL_INTERVIEW_PROMPT,
      /<coding_questions>[\s\S]*?six `## ` markdown headings[\s\S]*?<\/coding_questions>/,
    );
  });
});
