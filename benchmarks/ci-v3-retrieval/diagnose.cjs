/**
 * Why did THIS question fail? — per-question decision trace.
 *
 * golden-live reports that 14 questions have the wrong answerability. It does not
 * say at which stage the turn went wrong, and the stages fail in ways that look
 * identical from outside: a question with zero evidence may have retrieved
 * nothing, retrieved something the mode forbids, retrieved something whose source
 * type is not authoritative for the claim, or retrieved something that passed all
 * of those and then failed term matching.
 *
 * Guessing between those cost a wrong diagnosis once already ("too strict claim
 * support" for a question whose candidate never reached claim support at all).
 * This prints each stage's input and output for a named question set.
 *
 * Usage:
 *   NATIVELY_TEST_USERDATA=<dir> NATIVELY_INTERNAL=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/diagnose.cjs A-03 A-06
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { boot, REPO_ROOT, DIST } = require('./bootstrap.cjs');
const { ingestCorpus } = require('./ingest.cjs');
const { MODE_FOR_SOURCE, docsForGroup, groupForQuestion, buildRegistry, scopeForQuestion } = require('./corpus.cjs');

process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = '1';
process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL =
  process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL ?? '0';

const d = (rel) => require(path.join(DIST, rel));
const IDS = process.argv.slice(2).filter((a) => /^[A-J]-\d+$/.test(a));

(async () => {
  const b = await boot({ verbose: false });
  const { decide, orchestrate, evidenceSupportsClaim } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { createLegacyRetrievalPort } = d('electron/context-intelligence/retrieval/legacy-retrieval-port.js');
  const { ModesManager } = d('electron/services/ModesManager.js');
  const mm = ModesManager.getInstance();

  const groups = {};
  for (const group of ['base', 'versioned']) {
    const { mode, ingested } = await ingestCorpus(b, docsForGroup(group), {
      modeName: `CIv3 Diag ${group}`, verbose: false,
    });
    const indexed = ingested.filter((i) => i.file);
    const registry = buildRegistry(indexed);
    const files = mm.getReferenceFiles(mode.id);
    const rawRetrieve = async (query, opts) => {
      const res = await mm.retrieveHybridRaw(mode, files, {
        query, topK: opts.topK, tokenBudget: 3600, allowRerank: false,
      });
      return (res?.chunks ?? []).map((c) => ({
        sourceId: c.sourceId, fileName: c.fileName, text: c.text,
        chunkIndex: c.chunkIndex, score: c.score, ftsScore: c.ftsScore, vectorScore: c.vectorScore,
      }));
    };
    groups[group] = {
      registry, rawRetrieve,
      port: createLegacyRetrievalPort({ registry, retrieve: rawRetrieve }),
      registryRef: registry,
    };
  }

  const bank = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions;

  for (const q of bank.filter((x) => IDS.includes(x.id))) {
    const group = groupForQuestion(q.id);
    const { port, registry, rawRetrieve } = groups[group];
    const raw = MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    resolveModePolicy(modeId);

    const req = {
      requestId: `diag-${q.id}`, requestSequence: 1, surface: 'manual-chat',
      modeId, scope: scopeForQuestion(q), sessionId: 's', manualQuestion: q.question,
    };
    const decision = decide(req);
    const result = await orchestrate(req, port);

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${q.id} [${group}/${modeId}]  ${q.question}`);
    console.log(`expected ${q.expectedAnswerability}  ACTUAL ${result.answerability}`);
    console.log(`path ${decision.retrievalPlan.path}  shouldRetrieve=${decision.retrievalPlan.shouldRetrieve}`);
    console.log(`authorized sourceTypes: ${JSON.stringify(decision.retrievalPlan.sourceTypes)}`);
    console.log('claimRequirements:');
    for (const c of decision.claimRequirements) {
      console.log(`   ${c.claimType}  authority=${c.authority}  subject=${JSON.stringify(c.subject ?? null)}`);
    }

    // Stage 1 — what the legacy retriever actually returned, unfiltered.
    if (decision.retrievalPlan.shouldRetrieve) {
      const cands = await rawRetrieve(
        decision.retrievalPlan.queries[0] ?? decision.resolvedQuestion,
        { topK: decision.retrievalPlan.maximumCandidates },
      );
      console.log(`\nraw candidates (${cands.length}):`);
      for (const c of cands.slice(0, 8)) {
        console.log(`   ${(c.fileName || '?').padEnd(34)} type=${registry.sourceTypes.get(c.sourceId)}`
          + `  score=${(c.score ?? 0).toFixed(3)}  "${c.text.replace(/\s+/g, ' ').slice(0, 70)}"`);
      }
    }

    // Stage 2 — what survived scope/version/authority.
    const att = result.trace.retrievalAttempts[0];
    console.log(`\nafter adapter: admitted=${att?.admittedAfterScopeFilter ?? 0}`
      + ` rejected=${att?.rejectedByScopeFilter ?? 0}`);
    const byReason = {};
    for (const r of att?.rejections ?? []) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    if (Object.keys(byReason).length) console.log(`   reasons: ${JSON.stringify(byReason)}`);
    console.log(`accepted evidence: ${result.evidence.length}`);

    // Stage 3 — per-claim term matching on what did survive.
    for (const e of result.evidence) {
      console.log(`   ${(e.documentTitle || '?').padEnd(30)} acceptedFor=${JSON.stringify(e.acceptedFor)}`);
      for (const c of decision.claimRequirements) {
        const subject = c.subject ?? decision.resolvedQuestion;
        const ok = evidenceSupportsClaim(e, c.claimType, subject);
        console.log(`      supports ${c.claimType}? ${ok ? 'YES' : 'no '}  subject="${String(subject).slice(0, 54)}"`);
      }
      console.log(`      text: "${e.content.replace(/\s+/g, ' ').slice(0, 100)}"`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('DIAGNOSE FAILED:', e.stack || e.message); process.exit(1); });
