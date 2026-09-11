// ALWAYS ANSWER (2026-09-07, owner's direction): no surface may end a turn in a
// canned "could not find / not enough context / repeat that" line when a model
// answer exists, and the retrieval stack must actually use the reranker the
// user selected. Source-level pins plus pure-function checks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(process.cwd());
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ie = src('electron/IntelligenceEngine.ts');
const ipc = src('electron/ipcHandlers.ts');
const dgp = src('electron/llm/documentGroundedPrompt.ts');
const planner = src('electron/llm/AnswerPlanner.ts');
const lep = src('electron/rag/providers/LocalEmbeddingProvider.ts');
const lr = src('electron/rag/LocalReranker.ts');
const { packGovernsGeneration } = require(path.join(root, 'dist-electron/electron/intelligence/context-os/refusalPolicy.js'));
const { createModeRetrievalPort } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/context-intelligence/retrieval/mode-retrieval-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/context-intelligence/orchestration/orchestrator.js')).href);

describe('no post-stream site replaces a streamed answer with a canned refusal', () => {
  test('IntelligenceEngine never assigns the canonical refusal to fullAnswer', () => {
    assert.ok(!/fullAnswer = 'I could not find that in the retrieved sections of the document\.'/.test(ie), 'engine still overwrites with the canonical refusal');
    assert.ok(ie.includes('doc_grounded_kept_original_over_refusal'));
  });
  test('ipcHandlers keeps the streamed answer when a regen does not improve', () => {
    assert.ok(!ipc.includes("I couldn't find that in the uploaded material"));
    assert.ok(ipc.includes('pi_doc_grounded_kept_original'));
  });
  test('the sentinel and misfire sites regenerate before any honest line', () => {
    assert.ok(ie.includes('regenerateUsableAnswer('), 'engine helper missing');
    assert.ok((ie.match(/this\.regenerateUsableAnswer\(\{/g) || []).length >= 2, 'both engine sites must call it');
    assert.ok(/misfire regeneration skipped/.test(ipc), 'manual misfire site must regenerate');
  });
});

describe('prompts never instruct the model to stop at "could not find"', () => {
  test('document-grounded system/user prompts ask for a note plus a general-knowledge answer', () => {
    assert.ok(!dgp.includes('say: "I could not find that in the retrieved sections of the document."'));
    assert.ok(!dgp.includes('say so clearly ("I could not find that in the retrieved sections")'));
    assert.ok(!/say exactly: "I could not find that in the retrieved sections of the document\."/.test(ie));
    assert.ok(/then STILL answer the question as helpfully as you can from general knowledge/.test(dgp));
  });
  test('the absent-fact planner template answers from general knowledge after the note', () => {
    const m = planner.match(/const DOCUMENT_ABSENT_FACT_TEMPLATE = `([^`]*)`/);
    assert.ok(m, 'template missing');
    assert.match(m[1], /general knowledge/);
    assert.doesNotMatch(m[1], /Do not provide a plausible estimate or use general knowledge/);
  });
});

describe('refusal packs never govern generation', () => {
  const AUTH = ['reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript', 'transcript_only', 'profile_only', 'profile_plus_transcript', 'general_mixed', 'ask_if_ambiguous', undefined, 'unknown_future_authority'];
  test('refuse_insufficient_evidence → govern:false for every authority, files or not', () => {
    for (const sourceAuthority of AUTH) for (const hasReferenceFiles of [true, false, undefined]) {
      assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority, hasReferenceFiles }), false, `${sourceAuthority}/${hasReferenceFiles}`);
    }
  });
  test('answering packs still govern', () => {
    for (const answerPolicy of ['answer', 'answer_with_uncertainty', 'ask_clarification']) {
      assert.equal(packGovernsGeneration({ answerPolicy, sourceAuthority: 'reference_files_only', hasReferenceFiles: true }), true, answerPolicy);
    }
  });
});

describe('attached screenshots outrank the bare-follow-up clarification', () => {
  test('manual gate checks imagePaths; live gate checks visual context', () => {
    assert.ok(ipc.includes('!imagePaths?.length && isBareFollowUp(message)'));
    assert.ok(ie.includes('fr.isClarification && fr.clarificationText && !isSpeculative && !_wtaHasVisualContext'));
  });
});

describe('the selected reranker runs on the V3 retrieval path', () => {
  const decision = decide({
    requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'seminar',
    scope: { userId: 'u', modeId: 'seminar' }, sessionId: 's', manualQuestion: 'How many hours is milestone 2?', hasAttachedDocuments: true,
  });
  const portFor = (rerankSurface) => {
    const calls = [];
    const port = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async (_m, _f, opts) => { calls.push(opts); return { chunks: [] }; } },
      modeInfo: { id: 'm' }, files: [{ id: 'f1', fileName: 'sow.txt', content: 'x' }],
      allowedSourceTypes: ['REFERENCE_FILE'], tokenBudget: 3600, userId: 'u', ...(rerankSurface ? { rerankSurface } : {}),
    });
    return { port, calls };
  };
  test('allowRerank is true and the surface budget is forwarded', async () => {
    const { port, calls } = portFor('manual');
    await port.retrieve({ decision });
    assert.ok(calls.length >= 1, 'retriever not called');
    assert.equal(calls[0].allowRerank, true);
    assert.equal(calls[0].rerankSurface, 'manual');
  });
  test('an unspecified surface defaults to the tighter live budget', async () => {
    const { port, calls } = portFor(undefined);
    await port.retrieve({ decision });
    assert.equal(calls[0].allowRerank, true);
    assert.equal(calls[0].rerankSurface, 'live');
  });
});

describe('local model loaders assign loadingPromise before acquiring the shared ONNX slot', () => {
  for (const [name, text] of [['LocalEmbeddingProvider', lep], ['LocalReranker', lr]]) {
    test(name, () => {
      const assign = text.indexOf('this.loadingPromise = (async () => {');
      const acquire = text.indexOf("await acquireOnnxSlot('normal')");
      assert.ok(assign >= 0 && acquire >= 0, 'expected markers missing');
      assert.ok(acquire > assign, `${name}: the slot is acquired before loadingPromise is assigned — concurrent callers leak a slot`);
    });
  }
});

describe('a bare "I can\'t help with that" is a misfire, so it regenerates', () => {
  const { detectAssistantVoiceMisfire } = require(path.join(root, 'dist-electron/electron/llm/ProfileOutputValidator.js'));
  test('whole-answer refusals are flagged', () => {
    for (const a of ["I'm sorry, but I can't help with that.", "I cannot help with that request.", "Sorry, I am unable to assist with this.", "I can't share that information."]) {
      assert.equal(detectAssistantVoiceMisfire(a).isMisfire, true, a);
    }
  });
  test('a real answer that mentions a refusal is not flagged', () => {
    for (const a of ["Refunds are handled by billing; I can't help with the payment itself, but here is the process: open Settings, then Billing, then Request refund.", "The vendor said they can't help with that, so we escalated to the account manager and got the credit applied."]) {
      assert.equal(detectAssistantVoiceMisfire(a).isMisfire, false, a);
    }
  });
});

describe('round 4: misattributed speakers and ambiguous problems still get an answer', () => {
  const llm = src('electron/LLMHelper.ts');
  const prompts = src('electron/llm/prompts.ts');
  test('the engine answers the latest utterance when no interviewer turn exists', () => {
    assert.ok(ie.includes("reason: 'question_from_any_speaker'"));
  });
  test('the governed prompt falls back to the user message instead of throwing', () => {
    assert.ok(/governedTurnQuestion = _cogEarly\.turnQuestion\?\.trim\(\) \|\| String\(message \|\| ''\)\.trim\(\)/.test(llm));
    assert.ok(/turnQuestion\?\.trim\(\)\s*\|\| String\(message \|\| ''\)\.trim\(\);\s*\n\s*if \(!governedQuestion\) throw/.test(llm));
  });
  test('prompts answer under a stated assumption instead of asking to repeat', () => {
    assert.ok(!prompts.includes('ask one concise clarification question and STOP'));
    assert.ok(!prompts.includes('Ambiguous ASR beats coding.'));
    assert.ok(prompts.includes('never ask the user to repeat or rephrase'));
    assert.ok(prompts.includes('Never stop at a clarification question and never ask the interviewer to repeat'));
  });
  test('the E2E ask hook listens to the engine\'s real event names', () => {
    assert.ok(ipc.includes("['recap_ready', 'recap']") && ipc.includes("['follow_up_questions', 'follow_up_questions_update']"));
  });
});

describe('composer permanent rules forbid asking to repeat and give the other party\'s requested value', () => {
  const composer = src('electron/context-intelligence/generation/prompt-composer.ts');
  test('both rules are in PERMANENT_RULES', () => {
    assert.ok(composer.includes('Never ask the user to repeat, rephrase or clarify.'));
    assert.ok(composer.includes('give that value plainly first'));
  });
});

describe('round 4b: no source-switch short-circuit, bounded query embedding, empty-hybrid floor', () => {
  const { clarificationShortCircuitEnabled } = require(path.join(root, 'dist-electron/electron/intelligence/context-os/refusalPolicy.js'));
  test('the clarification short-circuit is retired at every site', () => {
    assert.equal(clarificationShortCircuitEnabled(), false);
    assert.equal((ie.match(/clarificationShortCircuitEnabled\(\)/g) || []).length, 1, 'engine WTA gate');
    assert.equal((ipc.match(/clarificationShortCircuitEnabled\(\)/g) || []).length, 3, 'manual ×2 + phone mirror gates');
  });
  test('query embeddings have their own short budget', () => {
    const ep = src('electron/rag/EmbeddingPipeline.ts');
    assert.match(ep, /const QUERY_EMBED_TIMEOUT_MS = 3_000;/);
    const q = ep.slice(ep.indexOf('async getEmbeddingForQuery('), ep.indexOf('async getEmbeddingForQueryLocalOnly'));
    assert.ok(q.includes('QUERY_EMBED_TIMEOUT_MS') && !/[^_]EMBED_TIMEOUT_MS/.test(q.replace(/QUERY_EMBED_TIMEOUT_MS/g, '')), 'query path must use the query budget');
  });
  test('an empty hybrid result over a non-empty corpus falls to zero-threshold lexical', () => {
    assert.ok(src('electron/services/modes/ModeHybridRetriever.ts').includes("markH4HybridStage('empty_hybrid_floor'"));
  });
  test('negotiation persona shows the user their own number before the spoken line', () => {
    assert.ok(src('electron/llm/prompts.ts').includes('show the user that number first in one short clause'));
  });
});

describe('round 5: meeting/global chat and the strict reference policy still answer', () => {
  const ragPrompts = src('electron/rag/prompts.ts');
  const ragManager = src('electron/rag/RAGManager.ts');
  const composer = src('electron/context-intelligence/generation/prompt-composer.ts');
  test('meeting and global RAG prompts note the gap and answer from general knowledge', () => {
    assert.ok(!ragPrompts.includes('say "I didn\'t catch that in the meeting"'));
    assert.ok(!ragPrompts.includes('clearly say "I couldn\'t find any discussion about that in your meetings"'));
    assert.ok(ragPrompts.includes('never stop at "I didn\'t catch that"'));
    assert.ok(ragPrompts.includes('never stop at "I couldn\'t find that"'));
  });
  test('an empty global search goes to the model instead of yielding the fallback constant', () => {
    assert.ok(!/yield NO_GLOBAL_CONTEXT_FALLBACK;/.test(ragManager));
    assert.ok(ragManager.includes('No matching excerpts were found across the user'));
  });
  test('the strict "only answer from references" branches still produce a marked general-knowledge answer', () => {
    assert.ok(!composer.includes("do not answer from general knowledge as though it were sourced.'"));
    assert.ok(!composer.includes('do not answer it from general '));
    // Three strict branches; one of them splits the phrase across string concatenation.
    assert.ok((composer.match(/still answer the /g) || []).length >= 3);
  });
  test('tiny-model prompts never reply with only "Nothing actionable"', () => {
    assert.ok(src('electron/llm/tinyPrompts.ts').includes('never reply with only "Nothing actionable"'));
  });
});
