/**
 * Regression for a live production bug reported 2026-07-04: after asking
 * "what is my name" (a manual question), triggering Clarify/Recap/Follow-up
 * Questions all returned the canned identity fact ("You are Evin John.")
 * instead of doing their actual job. Separately, "what do i do" returned
 * generic assistant-capability text with zero profile grounding.
 *
 * Two independent pre-existing bugs, NOT caused by the profile-e2e campaign
 * (verified via `git diff` — neither touched file's affected logic was part
 * of that session's changes):
 *
 * 1. ClarifyLLM/RecapLLM/FollowUpLLM/FollowUpQuestionsLLM/BrainstormLLM all
 *    call `llmHelper.streamChat(contextBlob, ..., promptOverride)` with
 *    `ignoreKnowledgeMode` left at its default `false`. LLMHelper's knowledge-
 *    mode intercept then runs `classifyIntent()`/`processQuestion()` over the
 *    ENTIRE context blob — which embeds the prior manual question/answer
 *    verbatim (<user_question>what is my name</user_question>). Since the
 *    embedded text substring-matches an identity pattern, the whole action
 *    call gets short-circuited to the canned intro response, ignoring the
 *    prompt override and the actual clarify/recap/follow-up task.
 *
 * 2. `CANDIDATE_REF_REGEX` (isGenericKnowledgeQuestion's disqualifier) didn't
 *    include the bare word "i" — only "me/my/mine/myself" — so "what do I do"
 *    matched GENERIC_QUESTION_PATTERNS' 'what do ' entry and got treated as a
 *    generic-knowledge question with full identity/retrieval bypass.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Split a call's argument text on commas at depth 0 only, so nested calls,
// object/array literals and ternaries do not produce phantom arguments.
function splitTopLevelArgs(argText) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (let i = 0; i < argText.length; i++) {
    const ch = argText[i];
    if (quote) {
      cur += ch;
      if (ch === quote && argText[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe('Bug 1: internal action LLMs must not go through the knowledge-mode intent gate', () => {
  const sites = [
    { file: 'electron/llm/ClarifyLLM.ts', label: 'ClarifyLLM' },
    { file: 'electron/llm/RecapLLM.ts', label: 'RecapLLM' },
    { file: 'electron/llm/FollowUpLLM.ts', label: 'FollowUpLLM' },
    { file: 'electron/llm/FollowUpQuestionsLLM.ts', label: 'FollowUpQuestionsLLM' },
    { file: 'electron/llm/BrainstormLLM.ts', label: 'BrainstormLLM' },
  ];
  for (const { file, label } of sites) {
    test(`${label}: every streamChat() call passes ignoreKnowledgeMode=true`, () => {
      const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      const calls = [...src.matchAll(/\.streamChat\(([\s\S]*?)\);/g)];
      assert.ok(calls.length > 0, `${label} must call streamChat at least once`);
      for (const m of calls) {
        // The 5th positional arg (ignoreKnowledgeMode) must be `true`. We check
        // the raw call text ends with ", true)" before the closing paren (the
        // regex above already stripped the trailing ");").
        // Check the POSITION, not the tail. `ignoreKnowledgeMode` is streamChat's
        // 5th positional parameter; it used to be the last argument these call
        // sites passed, so `/,\s*true\s*$/` worked by accident. They now pass
        // skipModeInjection, scopes, signal, thinkingBudget and routeOptions
        // after it, and the tail check started failing on calls that were still
        // perfectly correct.
        //
        // Splitting on TOP-LEVEL commas (parens/brackets/braces/strings tracked)
        // is also stricter than what it replaces: the old form would have been
        // satisfied by any trailing `true` in any position, including an
        // unrelated boolean, while this one names the argument that matters.
        const args = splitTopLevelArgs(m[1]);
        assert.ok(
          args.length >= 5,
          `${label} streamChat call has too few arguments to carry ignoreKnowledgeMode: ${m[0].slice(0, 120)}`,
        );
        assert.equal(
          args[4],
          'true',
          `${label} streamChat call missing ignoreKnowledgeMode=true at arg 5: ${m[0].slice(0, 120)}`,
        );
      }
    });
  }
});

describe('Bug 2: "what do I do" / "what have I built" are candidate-directed, not generic knowledge', () => {
  let isGenericKnowledgeQuestion;
  test('load compiled IntentClassifier', async () => {
    ({ isGenericKnowledgeQuestion } = await import(
      pathToFileURL(path.resolve(repoRoot, 'dist-electron/premium/electron/knowledge/IntentClassifier.js')).href
    ));
  });

  const candidateDirected = [
    'what do i do',
    'what have i built',
    "what've i shipped",
    "what do you do for a living", // pre-existing "you" coverage must still hold
  ];
  for (const q of candidateDirected) {
    test(`"${q}" is NOT generic-knowledge`, () => {
      assert.equal(isGenericKnowledgeQuestion(q), false);
    });
  }

  const genuinelyGeneric = [
    'what is an api',
    'explain how a hashmap works',
    'write a function to reverse a string',
    'what is the difference between tcp and udp',
  ];
  for (const q of genuinelyGeneric) {
    test(`"${q}" is still correctly generic-knowledge`, () => {
      assert.equal(isGenericKnowledgeQuestion(q), true);
    });
  }
});
