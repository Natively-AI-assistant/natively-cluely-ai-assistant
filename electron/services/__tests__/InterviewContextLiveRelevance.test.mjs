// electron/services/__tests__/InterviewContextLiveRelevance.test.mjs
//
// Regression for a live-answer failure: with several interview documents,
// every routed answer carried the whole context block because
// selectInterviewContextExcerpt only ranked chunks when a document EXCEEDED
// its budget. The model drowned and answered specific technical questions
// with a generic candidate presentation.
//
// Contract under test:
//  - relevance-first mode selects the chunks that match the current question
//    (deep in the professional doc) and stays far below the full dump;
//  - the identity anchor (document head) remains for broad profile answers;
//  - strict project drill-ins omit anchors and categories with no term hit;
//  - strict drill-ins lead with the strongest decision chunk and exclude a
//    weaker postmortem that merely repeats the project name;
//  - non-strict no term hits → short head slice, never the whole document;
//  - legacy mode (no options) preserves the old fits-then-complete behavior;
//  - LLMHelper routes live answers through relevance-first with the extracted
//    question (source contract on the compiled output).
//
// Run: npm run build:electron && node --test electron/services/__tests__/InterviewContextLiveRelevance.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptModPath = path.resolve(__dirname, '../../../dist-electron/electron/services/interviewContextPrompt.js');
const { buildInterviewContextPrompt, selectInterviewContextExcerpt } =
  await import(pathToFileURL(promptModPath).href);

const paragraph = (label, sentences = 6) =>
  Array.from({ length: sentences }, (_, i) =>
    `${label} detail sentence ${i + 1} covering routine responsibilities and generic accomplishments.`).join(' ');

const filler = (label, paragraphs) =>
  Array.from({ length: paragraphs }, (_, i) => paragraph(`${label} ${i + 1}`)).join('\n\n');

const EVIDENCE_GATE_CHUNK = [
  'Atlas Verify project — architecture decisions.',
  'I used a deterministic evidence gate in the Atlas Verify pipeline so every claim',
  'must carry verifiable source evidence before the LLM may cite it. The evidence gate',
  'rejects unsourced claims deterministically, which keeps hallucinated citations out',
  'of the final report and makes the pipeline auditable end to end.',
].join(' ');

const CENTRAL_DECISION_SENTINEL = 'CENTRAL_DECISION_SENTINEL';
const COMPETING_POSTMORTEM_SENTINEL = 'COMPETING_POSTMORTEM_SENTINEL';
const STRICT_CENTRAL_DECISION_CHUNK = [
  CENTRAL_DECISION_SENTINEL,
  'No projeto Atlas Verify, a decisão central foi implementar o evidence gate como código determinístico.',
  'Uma evidência só chega ao relatório quando o trecho exato pode ser localizado nos documentos reais.',
  'Esse mecanismo evita que citações fabricadas ou evidência alucinada cheguem ao resultado final.',
].join(' ');
const STRICT_COMPETING_POSTMORTEM_CHUNK = [
  COMPETING_POSTMORTEM_SENTINEL,
  'O projeto Atlas Verify teve alto recall e baixa precision na primeira avaliação.',
  'No Atlas Verify, fatos processuais fora do escopo foram marcados como unsupported.',
  'Mantivemos snapshots de antes e depois e distinguimos no evidence found de out of expected scope.',
].join(' ');

const buildState = () => ({
  version: 2,
  enabled: true,
  entries: {
    personal: {
      kind: 'personal',
      content: `Casey Morgan. Software engineer based in Testland.\n\n${filler('Personal hobby', 6)}`,
      fileName: 'personal-profile.md',
    },
    professional: {
      kind: 'professional',
      content: `Casey Morgan — professional profile. Senior software engineer.\n\n${filler('Prior role', 8)}\n\n${EVIDENCE_GATE_CHUNK}\n\n${filler('Additional experience', 8)}`,
      fileName: 'professional-profile.md',
    },
    company: {
      kind: 'company',
      content: `Target company overview and role description.\n\n${filler('Company culture', 8)}`,
      fileName: 'company-role.md',
    },
  },
  companyDocuments: [],
});

const QUESTION = 'Could you explain why you used a deterministic evidence gate in the Atlas Verify project?';

describe('relevance-first interview-context selection (live answers)', () => {
  test('live bundle includes the evidence-gate chunk and stays far below the full dump', () => {
    const state = buildState();
    const totalSource = Object.values(state.entries).reduce((sum, entry) => sum + entry.content.length, 0);
    assert.ok(totalSource > 15_000, `fixture must be a realistic multi-doc profile (got ${totalSource})`);

    const live = buildInterviewContextPrompt(state, QUESTION, 12_000, {
      relevanceFirst: true,
      perCategoryExcerptCap: 3_500,
    });
    assert.ok(live, 'live bundle must build');
    assert.match(live.contextBlock, /deterministic evidence gate/i, 'the chunk answering the question must be selected');
    assert.match(live.contextBlock, /rejects unsourced claims deterministically/i, 'the full evidence-gate rationale must survive selection');
    assert.ok(
      live.promptChars < totalSource * 0.6,
      `live prompt must not be a whole-document dump (prompt ${live.promptChars} vs source ${totalSource})`,
    );
  });

  test('identity anchor from the document head is always present', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, QUESTION, 12_000, { relevanceFirst: true });
    assert.match(live.contextBlock, /professional profile\. Senior software engineer/i);
  });

  test('a match in chunk zero beyond the identity anchor is not truncated away', () => {
    const content = `${'Introductory profile context. '.repeat(24)}\n\nTARGET evidence appears after the identity anchor.`;
    const excerpt = selectInterviewContextExcerpt(content, 'Where is the TARGET evidence?', 1_000, true);

    assert.match(excerpt, /TARGET evidence/i);
    assert.ok(excerpt.length <= 1_000);
  });

  test('forced relevance never falls back to a full document for an unsupported script', () => {
    const content = `${'Long unrelated profile paragraph. '.repeat(180)}\n\nPRIVATE_TAIL_SENTINEL`;
    const nonStrict = selectInterviewContextExcerpt(content, '現在の会社について教えてください', 12_000, true);
    const strict = selectInterviewContextExcerpt(content, '現在の会社について教えてください', 12_000, true, true);

    assert.ok(nonStrict.length < content.length);
    assert.doesNotMatch(nonStrict, /PRIVATE_TAIL_SENTINEL/);
    assert.equal(strict, '');
  });

  test('strict project drill-in includes only matching evidence and no generic intro anchors', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, QUESTION, 12_000, {
      relevanceFirst: true,
      perCategoryExcerptCap: 3_500,
      strictRelevance: true,
    });
    assert.ok(live, 'matching project evidence must still build a bundle');
    assert.match(live.contextBlock, /deterministic evidence gate/i);
    assert.match(live.contextBlock, /rejects unsourced claims deterministically/i);
    assert.doesNotMatch(live.contextBlock, /Personal hobby/i, 'unmatched personal context must be excluded');
    assert.doesNotMatch(live.contextBlock, /professional profile\. Senior software engineer/i, 'generic profile head must not anchor a drill-in');
    assert.doesNotMatch(live.contextBlock, /Target company overview/i, 'generic company head must not anchor a drill-in');
    assert.deepEqual(live.includedKinds, ['professional']);
  });

  test('strict relevance puts the central decision first and drops a project-name-only precision/recall postmortem', () => {
    const question = 'No projeto Atlas Verify, por que eu implementei um evidence gate determinístico e qual problema ele evita? Responda primeiro em inglês e depois traduza para PT-BR. Use apenas informações presentes nos meus documentos.';
    const content = [
      // The competitor deliberately appears first in source order and repeats
      // the project name. Ranking must still prefer the direct decision below.
      STRICT_COMPETING_POSTMORTEM_CHUNK,
      paragraph('Unrelated separator', 8),
      STRICT_CENTRAL_DECISION_CHUNK,
    ].join('\n\n');

    const excerpt = selectInterviewContextExcerpt(content, question, 3_500, true, true);
    assert.ok(
      excerpt.startsWith(CENTRAL_DECISION_SENTINEL),
      `strongest decision evidence must lead the excerpt, got: ${excerpt.slice(0, 180)}`,
    );
    assert.match(excerpt, /trecho exato pode ser localizado nos documentos reais/i);
    assert.match(excerpt, /evita que citações fabricadas/i);
    assert.doesNotMatch(
      excerpt,
      new RegExp(COMPETING_POSTMORTEM_SENTINEL),
      'a lower-relevance postmortem must not enter only because it repeats the project name',
    );
  });

  test('local interview policy requires all clauses and central decisions before metrics or postmortems', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, QUESTION, 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
    });
    assert.ok(live);
    assert.match(live.systemInstruction, /Answer every explicit clause/i);
    assert.match(live.systemInstruction, /central decision, invariant, reason, or mechanism/i);
    assert.match(live.systemInstruction, /Metrics, evaluations, postmortems/i);
    assert.match(live.systemInstruction, /must never replace the requested decision or the problem it prevents/i);
  });

  test('typed route category filter excludes personal and company even when they contain matching terms', () => {
    const state = buildState();
    state.entries.personal.content += `\n\n${EVIDENCE_GATE_CHUNK}`;
    state.entries.company.content += `\n\n${EVIDENCE_GATE_CHUNK}`;
    const live = buildInterviewContextPrompt(state, QUESTION, 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
      allowedKinds: ['professional'],
    });
    assert.ok(live);
    assert.deepEqual(live.includedKinds, ['professional']);
    assert.doesNotMatch(live.contextBlock, /category="personal"/);
    assert.doesNotMatch(live.contextBlock, /category="company"/);
    assert.match(live.contextBlock, /category="professional"/);
  });

  test('strict relevance returns no bundle when no document supports the drill-in', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, 'Explain the zxqv orbital compiler decision.', 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
    });
    assert.equal(live, null, 'unsupported project question must not fall back to a profile presentation');
  });

  test('strict profile facts include only chunks with a real query match, never an unmatched professional head', () => {
    const state = buildState();
    state.entries.personal.content = [
      '## Apresentação pessoal',
      '- Meu nome é Casey Morgan.',
      '- Sou formado em Engenharia de Software pela Riverton University.',
      '- Gosto de melhoria contínua e produtos confiáveis.',
    ].join('\n\n');
    state.entries.professional.content = [
      'GENERIC_PROFESSIONAL_HEAD Senior product engineer focused on reliable delivery.',
      filler('Unrelated professional presentation', 10),
    ].join('\n\n');

    const live = buildInterviewContextPrompt(state, 'Sou formado em que?', 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
      factRelevance: true,
      allowedKinds: ['personal', 'professional'],
    });

    assert.ok(live, 'the matching personal fact must build a bundle');
    assert.match(live.contextBlock, /formado em Engenharia de Software/i);
    assert.doesNotMatch(live.contextBlock, /Meu nome é Casey Morgan/i);
    assert.doesNotMatch(live.contextBlock, /melhoria contínua/i);
    assert.doesNotMatch(live.contextBlock, /GENERIC_PROFESSIONAL_HEAD/);
    assert.deepEqual(live.includedKinds, ['personal']);
  });

  test('Portuguese study/graduate variants recover the education fact without a generic introduction', () => {
    const state = buildState();
    state.entries.personal.content = [
      '## Apresentação pessoal',
      'Meu nome é Casey Morgan e gosto de construir produtos confiáveis.',
      '## Formação',
      'Sou formado em Engenharia de Software pela Riverton University.',
    ].join('\n');
    state.entries.professional.content = 'GENERIC_PROFESSIONAL_HEAD Senior product engineer focused on reliable delivery.';

    for (const question of ['Onde eu estudei?', 'Onde você se formou?']) {
      const live = buildInterviewContextPrompt(state, question, 12_000, {
        relevanceFirst: true,
        strictRelevance: true,
        factRelevance: true,
        allowedKinds: ['personal', 'professional'],
      });

      assert.ok(live, `${question}: the matching education fact must build a bundle`);
      assert.match(live.contextBlock, /Engenharia de Software pela Riverton University/i, question);
      assert.doesNotMatch(live.contextBlock, /Meu nome é Casey Morgan/i, question);
      assert.doesNotMatch(live.contextBlock, /GENERIC_PROFESSIONAL_HEAD/i, question);
      assert.deepEqual(live.includedKinds, ['personal'], question);
    }
  });

  test('PT-BR atomic fact vocabulary retrieves the requested property only', () => {
    const state = buildState();
    state.entries.personal.content = [
      '## Formação',
      'Sou formado em Engenharia de Software pela Riverton University.',
      '## Localização',
      'Moro em Lakeport, Testland.',
    ].join('\n');
    state.entries.professional.content = [
      '## Resumo',
      'Trabalho com produtos digitais confiáveis.',
      '## Cargo atual',
      'Atuo como Staff Software Engineer na Northstar Labs.',
      '## Experiência',
      'Tenho 8 anos de experiência profissional.',
    ].join('\n');

    const cases = [
      ['Qual curso eu fiz?', /Engenharia de Software pela Riverton University/i, /Lakeport|Staff Software Engineer|8 anos/i],
      ['Qual é a minha graduação?', /Engenharia de Software pela Riverton University/i, /Lakeport|Staff Software Engineer|8 anos/i],
      ['Qual faculdade?', /Engenharia de Software pela Riverton University/i, /Lakeport|Staff Software Engineer|8 anos/i],
      ['Qual é a minha localização atual?', /Lakeport, Testland/i, /Engenharia de Software|Staff Software Engineer|8 anos/i],
      ['Qual é o meu cargo atual?', /Staff Software Engineer na Northstar Labs/i, /Engenharia de Software|Lakeport|8 anos/i],
      ['Em qual empresa eu trabalho atualmente?', /Staff Software Engineer na Northstar Labs/i, /Engenharia de Software|Lakeport|8 anos|produtos digitais/i],
      ['Quantos anos de experiência eu tenho?', /8 anos de experiência profissional/i, /Engenharia de Software|Lakeport|Staff Software Engineer/i],
    ];

    for (const [question, expected, forbidden] of cases) {
      const live = buildInterviewContextPrompt(state, question, 12_000, {
        relevanceFirst: true,
        strictRelevance: true,
        factRelevance: true,
        allowedKinds: ['personal', 'professional'],
      });

      assert.ok(live, `${question}: expected a matching atomic fact`);
      assert.match(live.contextBlock, expected, question);
      assert.doesNotMatch(live.contextBlock, forbidden, question);
    }
  });

  test('generic recency modifier does not pull an unrelated current-role passage', () => {
    const state = buildState();
    state.entries.personal.content = [
      '## Formação',
      'Sou formado em Engenharia de Software pela Riverton University.',
    ].join('\n');
    state.entries.professional.content = [
      '## Cargo atual',
      'Atuo como Staff Software Engineer na Northstar Labs.',
    ].join('\n');

    const live = buildInterviewContextPrompt(state, 'Qual é a minha formação atual?', 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
      factRelevance: true,
      allowedKinds: ['personal', 'professional'],
    });

    assert.ok(live);
    assert.deepEqual(live.includedKinds, ['personal']);
    assert.match(live.contextBlock, /Engenharia de Software pela Riverton University/i);
    assert.doesNotMatch(live.contextBlock, /Cargo atual|Staff Software Engineer|Northstar Labs/i);
  });

  test('document inventory uses active-file metadata and includes no profile content fallback', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, 'Vc tem os doc carregado do meu perfil?', 12_000, {
      relevanceFirst: true,
      strictRelevance: true,
      documentInventoryScope: 'profile',
      allowedKinds: ['personal', 'professional'],
    });

    assert.ok(live, 'active personal/professional metadata must build an inventory bundle');
    assert.deepEqual(live.includedKinds, ['personal', 'professional']);
    assert.match(live.contextBlock, /document_inventory scope="profile"/);
    assert.match(live.contextBlock, /profile_document category="personal"[^>]+status="loaded"[^>]+file_name="personal-profile\.md"/);
    assert.match(live.contextBlock, /profile_document category="professional"[^>]+status="loaded"[^>]+file_name="professional-profile\.md"/);
    assert.doesNotMatch(live.contextBlock, /Casey Morgan|Prior role|Personal hobby/);
    assert.doesNotMatch(live.contextBlock, /category="company"/);
    assert.match(live.systemInstruction, /Do not ask the user to upload it again/i);
    assert.match(live.systemInstruction, /do not summarize unrelated profile content/i);
  });

  test('company inventory explicitly represents saved-but-not-selected as none', () => {
    const state = buildState();
    state.entries.company = null;
    state.activeCompanyDocumentId = null;
    state.companyDocuments = [{
      id: 'company-saved',
      label: 'Saved Company',
      sourceType: 'file',
      fileName: 'saved-company.md',
      content: 'INACTIVE_COMPANY_CONTENT must never be cited.',
      charCount: 46,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }];

    const live = buildInterviewContextPrompt(state, 'Qual documento de empresa está selecionado agora?', 12_000, {
      documentInventoryScope: 'company',
      // The normal profile_fact layer projection does not include company;
      // explicit company-selection intent is authoritative metadata instead.
      allowedKinds: ['personal', 'professional'],
    });

    assert.ok(live);
    assert.deepEqual(live.includedKinds, []);
    assert.match(live.contextBlock, /company_document_selection status="none" saved_document_count="1"/);
    assert.doesNotMatch(live.contextBlock, /INACTIVE_COMPANY_CONTENT|saved-company\.md/);
    assert.match(live.systemInstruction, /status="none" means no company document is selected/i);
  });

  test('company inventory includes content only for the selected document', () => {
    const state = buildState();
    state.activeCompanyDocumentId = 'company-active';
    state.companyDocuments = [{
      id: 'company-active',
      label: 'Active Company',
      sourceType: 'file',
      fileName: 'active-company.md',
      content: state.entries.company.content,
      charCount: state.entries.company.content.length,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }];

    const live = buildInterviewContextPrompt(state, 'Which company document is selected? Cite three facts.', 12_000, {
      documentInventoryScope: 'company',
      perCategoryExcerptCap: 4_000,
    });

    assert.ok(live);
    assert.deepEqual(live.includedKinds, ['company']);
    assert.match(live.contextBlock, /company_document_selection status="selected"/);
    assert.match(live.contextBlock, /label="Active Company"/);
    assert.match(live.contextBlock, /Target company overview and role description/i);
  });

  test('no term hits → short head slice, never the full document', () => {
    const content = filler('Unrelated section', 20);
    const excerpt = selectInterviewContextExcerpt(content, 'xylophone quantum blockchain?', 10_000, true);
    assert.ok(excerpt.length <= 2_400, `expected head slice, got ${excerpt.length} chars`);
    assert.ok(excerpt.length > 0, 'head slice must not be empty');
  });

  test('legacy mode (no options) keeps fits-then-complete behavior', () => {
    const state = buildState();
    const legacy = buildInterviewContextPrompt(state, QUESTION, 36_000);
    assert.ok(legacy, 'legacy bundle must build');
    const totalSource = Object.values(state.entries).reduce((sum, entry) => sum + entry.content.length, 0);
    assert.ok(
      legacy.promptChars > totalSource * 0.9,
      `legacy manual-chat behavior must remain byte-compatible-ish (prompt ${legacy.promptChars} vs source ${totalSource})`,
    );
  });

  test('relevance selection with a broad self-intro question still anchors on the head', () => {
    const state = buildState();
    const live = buildInterviewContextPrompt(state, 'Tell me about yourself and your background.', 12_000, {
      relevanceFirst: true,
    });
    assert.ok(live, 'broad question must still produce a bundle');
    assert.ok(live.promptChars < 13_000, `broad question must respect the live cap (got ${live.promptChars})`);
  });
});

describe('LLMHelper live routing (source contract on compiled output)', () => {
  const llmSrc = fs.readFileSync(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'), 'utf8');

  test('live answers use relevance-first selection with the extracted question', () => {
    assert.match(llmSrc, /relevanceFirst:\s*true/, 'live path must request relevance-first selection');
    assert.match(llmSrc, /live_relevance_first/, 'attach log must distinguish the live mode');
    assert.match(llmSrc, /currentQuestion/, 'route options must thread the extracted question');
    assert.match(llmSrc, /12_000|12000/, 'live path must apply the tight overall cap');
    assert.match(llmSrc, /project_followup_answer[\s\S]{0,160}strictRelevance|strictRelevance[\s\S]{0,160}project_followup_answer/, 'project follow-ups must opt into strict evidence selection');
    assert.match(llmSrc, /profile_fact_answer[\s\S]{0,180}strictRelevance|strictRelevance[\s\S]{0,180}profile_fact_answer/, 'profile facts must opt into strict evidence selection');
    assert.match(llmSrc, /retrievalQuestionText/, 'retrieval must use its dedicated antecedent-aware query');
    assert.match(llmSrc, /documentInventoryScope/, 'document inventory must use authoritative metadata context');
    assert.match(llmSrc, /localInterviewContextKindsForRoute/, 'live path must project route layers onto local document categories');
    assert.match(llmSrc, /allowedKinds/, 'only route-selected local document categories may enter the prompt');
  });

  test('WTA threads the extracted question into route options', () => {
    const wtaSrc = fs.readFileSync(path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js'), 'utf8');
    assert.match(wtaSrc, /currentQuestion:\s*answerPlan/, 'WTA must pass answerPlan.question as currentQuestion');
  });
});
