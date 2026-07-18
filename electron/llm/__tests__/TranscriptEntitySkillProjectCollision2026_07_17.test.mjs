// electron/llm/__tests__/TranscriptEntitySkillProjectCollision2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17) fix: extractTranscriptEntities mis-tagged a
// TECH/SKILL name as a `project` entity, which sessionFollowupResolver's bare-pronoun
// substitution ("it"/"that"/"there") then spliced into a LATER, completely unrelated
// question — producing garbled prompts like "what did you own Kafka?" (real question:
// "what did you own there?") and "we'll cover RocksDB in the next round" (real
// question: "we'll cover that in the next round"). Live-proven on a real 30-minute
// judged benchmark run (run-008.json/traces2/harness-script-a-press-A4.txt,
// A5.txt, A13.txt, A18.txt) — this corrupted `answerPlan.question`, which
// WhatToAnswerLLM.ts feeds directly into retrieval queries (document/RAG/mode-context
// search), not just a cosmetic trace field.
//
// Two independent root causes, both in extractTranscriptEntities:
//  1. `t.match(SKILL_RE)` (no `g` flag) only ever captured the FIRST skill mention per
//     turn — "a streaming Kafka and Flink pipeline" (after an earlier "legacy Hadoop
//     batch job" in the same turn) tagged ONLY Hadoop as a skill, leaving Kafka
//     untagged and vulnerable to the project rules below.
//  2. The "cued proper noun" rule's trigger-word list includes bare prepositions like
//     "on" and "to" — "a streaming system ON Kafka" matched the cue and mis-tagged
//     Kafka as a `project`, and a CamelCase tech name like RocksDB matched the
//     CamelCase project rule directly (RocksDB isn't in KNOWN_SKILLS).
//
// Fix: collect ALL skill mentions in a turn (not just the first) into a `skillTokens`
// set, and exclude ANY matched skill token (not just the static KNOWN_SKILLS list)
// from the CamelCase/cued/short-answer project rules.
//
// FOLLOW-UP FINDING (same day, run-009): the exact same downstream splicing
// mechanism also fires for CamelCase proper nouns that are neither a skill NOR a
// person's name — a platform brand ("1.4k GitHub stars") or a compliance-standard
// acronym ("SOC 2 / FedRAMP requirement") both matched the bare CamelCase project
// rule directly (they're not skills, so the isSkillToken exclusion above didn't
// help) and got spliced into a later unrelated question the same way. Added a
// narrow KNOWN_NON_PROJECT_PROPER_NOUNS allowlist (GitHub, FedRAMP, etc.) folded
// into the same isSkillToken exclusion check.
//
// SECOND FOLLOW-UP FINDING (same day, run-014): "use X"/"using X" — kept in the
// cued-noun trigger list as an "unambiguous project-adoption cue" by the FIRST
// fix — turned out to be ambiguous too: "using Envoy and Istio for the mesh
// layer" is a TOOL LIST, not "adopted a project called Envoy". Detects the
// "and <CapitalizedWord>" continuation immediately after a cued match (a real
// project-adoption statement doesn't continue this way) and skips the cue when
// present. Also extended KNOWN_NON_PROJECT_PROPER_NOUNS with common non-
// CamelCase infra tool names (Envoy, Istio, Grafana, etc.) as defense-in-depth
// for standalone (non-list) mentions.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/TranscriptEntitySkillProjectCollision2026_07_17.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { extractTranscriptEntities, resolveLiveFollowup } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

describe('extractTranscriptEntities: a second/later skill mention in the same turn is not lost', () => {
  test('Kafka (second SKILL_RE match after Hadoop) is tagged as a skill, not dropped', () => {
    const text = 'I was tech lead on the merchant settlement reconciliation pipeline at Stripe, '
      + 'replacing a legacy Hadoop batch job with a streaming Kafka and Flink pipeline.';
    const entities = extractTranscriptEntities(text, 'user');
    const skills = entities.filter((e) => e.kind === 'skill').map((e) => e.value.toLowerCase());
    assert.ok(skills.includes('hadoop'), 'Hadoop (first match) still tagged as skill');
    assert.ok(skills.includes('kafka'), 'Kafka (second match) must ALSO be tagged as skill, not silently dropped');
  });

  test('a tech name mentioned via a bare preposition ("on Kafka") is never tagged as a project', () => {
    const text = 'We rebuilt a legacy Hadoop batch pipeline into a streaming system on Kafka and Flink '
      + 'that processes 4.2 billion ledger entries a day.';
    const entities = extractTranscriptEntities(text, 'user');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('Kafka'), `Kafka must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
    const skills = entities.filter((e) => e.kind === 'skill').map((e) => e.value.toLowerCase());
    assert.ok(skills.includes('kafka'), 'Kafka must be tagged as a skill instead');
  });

  test('a CamelCase-shaped tech name (RocksDB) is never tagged as a project', () => {
    // RocksDB isn't in SKILL_RE (not every tech name can be enumerated there), but it
    // IS in KNOWN_SKILLS specifically so the CamelCase project rule excludes it — the
    // fix only needs to guarantee it's not mis-recalled as a "project" later; it's not
    // required to also appear as a `skill` entity for this particular token.
    const text = 'You re-architected that with a sharded RocksDB store — what throughput improvement did that get you?';
    const entities = extractTranscriptEntities(text, 'interviewer');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('RocksDB'), `RocksDB must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
  });

  test('a genuine project name (not a known skill) is still correctly tagged', () => {
    const text = 'Tell me about Tinroof, the open-source project you mentioned.';
    const entities = extractTranscriptEntities(text, 'interviewer');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(projects.includes('Tinroof'), `a real project name must still be captured (got: ${JSON.stringify(projects)})`);
  });

  test('a genuine CamelCase project name is still tagged (not swallowed by the skill exclusion)', () => {
    const text = 'PillarStream is the system I want to work on next.';
    const entities = extractTranscriptEntities(text, 'user');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(projects.includes('PillarStream'), `a real CamelCase project must still be captured (got: ${JSON.stringify(projects)})`);
  });
});

describe('Skeptic-pass finding (2026-07-17): bare "to"/"on" cues mis-tag person/company names as projects', () => {
  test('a person\'s name after bare "to" ("reported to Priya") is NOT tagged as a project', () => {
    const text = 'I reported to Priya throughout that engagement, and escalated to Priya whenever blockers came up.';
    const entities = extractTranscriptEntities(text, 'user');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('Priya'), `a person's name must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
  });

  test('"use X" / "using X" / "back to X" cues are still preserved (genuine project-adoption cues)', () => {
    const useText = 'Actually use TalentScope.';
    const usingText = 'I built it using Tinroof under the hood.';
    const backToText = 'Actually back to Natively.';
    for (const [text, expected] of [[useText, 'TalentScope'], [usingText, 'Tinroof'], [backToText, 'Natively']]) {
      const entities = extractTranscriptEntities(text, 'user');
      const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
      assert.ok(projects.includes(expected), `"${text}" must still tag ${expected} as a project (got: ${JSON.stringify(projects)})`);
    }
  });

  test('end-to-end: a later "that project" follow-up does not resolve to a mis-tagged person name', () => {
    const turns = [
      { role: 'interviewer', text: 'Tell me about your last team.', t: 60 },
      { role: 'user', text: 'I reported to Priya throughout that engagement, and escalated to Priya whenever blockers came up.', t: 120 },
      { role: 'interviewer', text: 'What was the hardest part of that project?', t: 180 },
    ];
    const result = resolveLiveFollowup({
      turns,
      latestQuestion: 'What was the hardest part of that project?',
      mode: 'technical-interview',
      surface: 'what_to_answer',
    });
    if (result.resolvedQuestion) {
      assert.ok(
        !/\bpriya\b/i.test(result.resolvedQuestion),
        `resolved question must never splice in a person's name for "that project": got "${result.resolvedQuestion}"`,
      );
    }
  });
});

describe('End-to-end regression: the exact live-reproduced garbled-question bug (run-008)', () => {
  const MIN = 60;

  test('a later bare-pronoun follow-up ("what did you own there?") is NOT corrupted with a skill name', () => {
    // Mirrors the real script-a session: A2's answer mentions Kafka/Flink (tech
    // stack), then A4 asks a generic follow-up with the pronoun "there" that must
    // resolve to the COMPANY/ROLE context, never to a stray tech-name substitution.
    const priorAnswerTurn = 'We rebuilt a legacy Hadoop batch pipeline into a streaming system on Kafka '
      + 'and Flink that processes 4.2 billion ledger entries a day.';
    const turns = [
      { role: 'interviewer', text: 'Walk me through your most recent role.', t: 1 * MIN },
      { role: 'user', text: priorAnswerTurn, t: 2 * MIN },
      { role: 'interviewer', text: 'Before Stripe, you were at Datadog — what did you own there?', t: 3 * MIN },
    ];
    const result = resolveLiveFollowup({
      turns,
      latestQuestion: 'Before Stripe, you were at Datadog — what did you own there?',
      mode: 'technical-interview',
      surface: 'what_to_answer',
    });
    if (result.resolvedQuestion) {
      assert.ok(
        !/\bkafka\b/i.test(result.resolvedQuestion),
        `resolved question must never splice in "Kafka" for the pronoun "there": got "${result.resolvedQuestion}"`,
      );
    }
  });

  test('a follow-up referencing "that migration" after a RocksDB-mentioning turn is not corrupted', () => {
    const turns = [
      { role: 'interviewer', text: 'You re-architected that with a sharded RocksDB store — what throughput improvement did that get you?', t: 5 * MIN },
      { role: 'user', text: 'We went from 1.1 million to 8.4 million points per second.', t: 6 * MIN },
      { role: 'interviewer', text: 'Going back to your most recent role — you mentioned replacing a legacy Hadoop batch job with a streaming pipeline. What made that migration challenging?', t: 25 * MIN },
    ];
    const result = resolveLiveFollowup({
      turns,
      latestQuestion: 'Going back to your most recent role — you mentioned replacing a legacy Hadoop batch job with a streaming pipeline. What made that migration challenging?',
      mode: 'technical-interview',
      surface: 'what_to_answer',
    });
    if (result.resolvedQuestion) {
      assert.ok(
        !/\brocksdb\b/i.test(result.resolvedQuestion),
        `resolved question must never splice in "RocksDB" for the pronoun "that": got "${result.resolvedQuestion}"`,
      );
    }
  });
});

describe('Follow-up finding (2026-07-17, run-009): non-skill CamelCase proper nouns (GitHub, FedRAMP) are the same bug class', () => {
  const LOCAL_MIN = 60;

  test('a platform brand name mentioned via CamelCase ("1.4k GitHub stars") is not tagged as a project', () => {
    const text = 'Tinroof is a pure-Go implementation of the Raft consensus algorithm with a built-in linearizable KV store, about 1.4k GitHub stars.';
    const entities = extractTranscriptEntities(text, 'user');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('GitHub'), `GitHub must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
  });

  test('a compliance-standard acronym ("SOC 2 / FedRAMP requirement") is not tagged as a project', () => {
    const text = "Good. Let's talk about the JD's SOC 2 / FedRAMP requirement — any experience there?";
    const entities = extractTranscriptEntities(text, 'interviewer');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('FedRAMP'), `FedRAMP must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
  });

  test('end-to-end: a later "that migration" follow-up does not resolve to GitHub', () => {
    const turns = [
      { role: 'interviewer', text: 'Tell me about your open-source work.', t: 8 * LOCAL_MIN },
      { role: 'user', text: 'Tinroof is a pure-Go implementation of the Raft consensus algorithm, about 1.4k GitHub stars.', t: 9 * LOCAL_MIN },
      { role: 'interviewer', text: 'Going back to what you said earlier about your most recent role — you mentioned replacing a legacy Hadoop batch job with a streaming pipeline. What made that migration challenging?', t: 25 * LOCAL_MIN },
    ];
    const result = resolveLiveFollowup({
      turns,
      latestQuestion: 'Going back to what you said earlier about your most recent role — you mentioned replacing a legacy Hadoop batch job with a streaming pipeline. What made that migration challenging?',
      mode: 'technical-interview',
      surface: 'what_to_answer',
    });
    if (result.resolvedQuestion) {
      assert.ok(
        !/\bgithub\b/i.test(result.resolvedQuestion),
        `resolved question must never splice in "GitHub" for the pronoun "that": got "${result.resolvedQuestion}"`,
      );
    }
  });
});

describe('Follow-up finding (2026-07-17, run-014): "using X and Y" tool-listing is not a project-adoption cue', () => {
  const LOCAL_MIN = 60;

  test('the first item in a "using X and Y" tool list is NOT tagged as a project', () => {
    const text = "I've operated 1.2k-node clusters in production, using Envoy and Istio for the mesh layer.";
    const entities = extractTranscriptEntities(text, 'user');
    const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
    assert.ok(!projects.includes('Envoy'), `Envoy (first item in a tool list) must never be tagged as a project (got projects: ${JSON.stringify(projects)})`);
  });

  test('"use X." / "using X under the hood." (a genuine SINGLE project-adoption statement, no list) is still tagged', () => {
    const useText = 'Actually use TalentScope.';
    const usingText = 'I built it using Tinroof under the hood.';
    for (const [text, expected] of [[useText, 'TalentScope'], [usingText, 'Tinroof']]) {
      const entities = extractTranscriptEntities(text, 'user');
      const projects = entities.filter((e) => e.kind === 'project').map((e) => e.value);
      assert.ok(projects.includes(expected), `"${text}" must still tag ${expected} as a project (got: ${JSON.stringify(projects)})`);
    }
  });

  test('end-to-end: a later "we\'ll cover that" follow-up does not resolve to Envoy', () => {
    const turns = [
      { role: 'interviewer', text: "Let's talk Kubernetes — what scale have you operated it at?", t: 20 * LOCAL_MIN },
      { role: 'user', text: "I've operated 1.2k-node clusters in production, using Envoy and Istio for the mesh layer.", t: 21 * LOCAL_MIN },
      { role: 'interviewer', text: "Good question, we'll cover that in the next round. Before we close — is there anything about your background we haven't covered?", t: 30 * LOCAL_MIN },
    ];
    const result = resolveLiveFollowup({
      turns,
      latestQuestion: "Good question, we'll cover that in the next round. Before we close — is there anything about your background we haven't covered?",
      mode: 'technical-interview',
      surface: 'what_to_answer',
    });
    if (result.resolvedQuestion) {
      assert.ok(
        !/\benvoy\b/i.test(result.resolvedQuestion),
        `resolved question must never splice in "Envoy" for the pronoun "that": got "${result.resolvedQuestion}"`,
      );
    }
  });
});
