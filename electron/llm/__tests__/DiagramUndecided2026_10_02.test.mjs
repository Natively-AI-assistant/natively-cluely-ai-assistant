// electron/llm/__tests__/DiagramUndecided2026_10_02.test.mjs
//
// A turn the four-language rules cannot place, in the main process.
//
// The shared modules leave such a turn UNDECIDED (not enabled, carrying the
// request it would be) and render a conditional contract for it; the model
// that answers decides, in the same generation. See
// src/lib/diagram/__tests__/diagramUndecided.test.mjs for the decision itself.
//
// Pinned here: what the main process does with one.
//   - It is not a diagram turn for anything that routes or remembers: the
//     planner keeps its route, the spoken question stays with the meeting
//     search, and the drawing is not marked as followed up.
//   - Its prompt carries the conditional contract exactly once and the
//     drawing it may be about, and KEEPS the persona it would have had
//     ('what_to_say' on the live surface): most such turns ask for nothing.
//   - Its answer is tidied like any other unless it holds a drawing.
//   - The privacy scope holds: a drawing that may not go to the provider is
//     not handed over, undecided or not.
//
// Needs `npm run build:electron` (dist-electron).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron/', p)).href;
const { buildSystemPromptV2 } = await import(dist('llm/promptSystemV2.js'));
const dps = await import(dist('llm/diagramPromptSignals.js'));
const scope = await import(dist('context-intelligence/policies/provider-scope-policy.js'));
const { prepareDirectAssistPrompt } = await import(dist('direct-assist/requestBuilder.js'));

const RU = 'flowchart LR\n  app[Приложение райдера] --> gw["API-шлюз"]\n  gw --> rides[Сервис поездок]\n  rides --> inv[(База велосипедов и станций)]\n  rides --> pay["Платёжный сервис"]\n  rides --> q[[Очередь событий]]\n  q --> notif[Уведомления]';
const DESIGN = { artifactId: 'design-1.v1', lineageId: 'design-1', version: 1, artifact: 'mermaid', view: 'architecture', type: 'flowchart', source: RU, foreground: true, updatedAt: Date.now() };
const EDIT = 'и ещё прицепи к платежам антифрод отдельным кубиком';
const FRESH = 'Para la mudanza de la oficina me vendría bien un Gantt con las tareas y las semanas, ¿te animas?';
const count = (text, needle) => text.split(needle).length - 1;
const turn = (question, extra = {}) => dps.resolveDiagramTurn({ question, userInstructions: null, activeDesign: null, mode: 'general', featureEnabled: true, ...extra });

describe('an undecided turn in the main process', () => {
  test('carries the conditional contract and the drawing, and is not enabled', () => {
    const t = turn(EDIT, { activeDesign: DESIGN });
    assert.equal(t.request.enabled, false);
    assert.equal(t.request.reason, 'undecided');
    assert.equal(t.signals.undecided, true);
    assert.equal(t.signals.operation, 'update');
    assert.match(t.turnBlock, /^<active_design view="architecture"/);
    assert.match(t.turnBlock, /for you to decide/);
    assert.ok(t.turnBlock.includes('Платёжный сервис'));
  });

  test('does not mark the drawing as followed up: the session is told the turn MAY be about it, and the answer says', () => {
    const calls = [];
    dps.registerActiveDesignToucher((followsUp, mayFollowUp) => calls.push([followsUp, mayFollowUp === true]));
    try {
      turn(EDIT, { activeDesign: DESIGN });
      turn('Добавь кэш перед базой велосипедов и станций.', { activeDesign: DESIGN });
      turn('Мне бы табличку: Постгрес против Монги.', { activeDesign: { ...DESIGN, foreground: false } });
      turn(EDIT, { activeDesign: DESIGN, speculative: true });
    } finally {
      dps.registerActiveDesignToucher(null);
    }
    // undecided and handed the drawing; decided follow-up; undecided with no drawing handed over; a prefetch says nothing.
    assert.deepEqual(calls, [[false, true], [true, false], [false, false]]);
  });

  test('routes nowhere: the planner keeps its route and the spoken question stays with the meeting search', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    try {
      assert.equal(dps.isDesignFollowUpTurn(EDIT, 'general_meeting_answer'), false);
      assert.equal(dps.visualTurnRoute(EDIT, 'coding_question_answer'), null);
      assert.equal(dps.visualTurnRoute(FRESH, 'general_meeting_answer'), null);
      assert.equal(dps.liveQuestionWantsADrawing(turn(EDIT, { activeDesign: DESIGN })), false);
      assert.equal(dps.liveQuestionWantsADrawing(turn(FRESH)), false);
    } finally {
      dps.registerActiveDesignProvider(null);
    }
  });

  test('the live persona stays "what_to_say", with the contract on it exactly once', () => {
    const t = turn(EDIT, { activeDesign: DESIGN });
    const prompt = buildSystemPromptV2({ mode: 'general', action: 'what_to_say', tier: 'cloud', surface: 'live', diagram: t.signals });
    assert.equal(count(prompt, '<diagram_contract>'), 1);
    assert.match(prompt, /<active_action name="what_to_say">/);
    assert.match(prompt, /could not tell from the words of this turn/);
    // A decided edit is told to change it; an undecided one is given the way out too.
    assert.match(prompt, /answer as you normally would/);
    const local = buildSystemPromptV2({ mode: 'general', action: 'what_to_say', tier: 'local', surface: 'live', diagram: t.signals });
    assert.equal(count(local, '<diagram_contract>'), 1);
    assert.ok(local.length < prompt.length);
  });

  test('the engine and the What-to-Answer fallback switch persona only for a decided turn', () => {
    const engine = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.match(engine, /const _liveDiagram = Boolean\(wtaDiagramTurn\?\.signals\) && wtaDiagramTurn\?\.signals\?\.undecided !== true;/);
    assert.match(engine, /\.\.\.\(_liveDiagram \? \{ action: 'answer' as const \} : \{\}\),\s*\n\s*\.\.\.\(wtaDiagramTurn\?\.signals \? \{ diagram: wtaDiagramTurn\.signals \} : \{\}\),/);
    const wta = fs.readFileSync(path.join(root, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');
    assert.match(wta, /diagramTurn\.signals\.undecided === true \? \{\} : \{ action: 'answer' as const \}/);
  });

  test('a prompt the composer did not build gets the same contract, once', () => {
    const t = turn(FRESH);
    const once = dps.withDiagramContract('BASE', t, { tier: 'cloud', surface: 'chat' });
    assert.equal(count(once, '<diagram_contract>'), 1);
    assert.match(once, /could not tell from its words whether one is being ASKED FOR/);
    assert.equal(dps.withDiagramContract(once, t), once);
  });

  test('the V3 composer is given the note and the drawing', () => {
    const v3 = dps.v3DiagramTurn(turn(EDIT, { activeDesign: DESIGN }));
    assert.match(v3.note, /MAY apply to this turn/);
    assert.match(v3.activeDesignBlock, /for you to decide/);
    const fresh = dps.v3DiagramTurn(turn(FRESH));
    assert.match(fresh.note, /MAY apply to this turn/);
    assert.equal(fresh.activeDesignBlock, undefined);
  });

  test('its answer is tidied like any other, unless it holds a drawing or a table', () => {
    const t = turn(EDIT, { activeDesign: DESIGN });
    assert.equal(dps.undecidedTurnAnsweredInWords(t, 'Антифрод лучше поставить перед платёжным сервисом.'), true);
    assert.equal(dps.undecidedTurnAnsweredInWords(t, 'Добавляю.\n\n```mermaid\nflowchart LR\n a --> b\n```\n'), false);
    assert.equal(dps.undecidedTurnAnsweredInWords(t, '| A | B |\n| --- | --- |\n| 1 | 2 |'), false);
    // A decided turn is never "answered in words" for this purpose, and a plain turn has no signals at all.
    assert.equal(dps.undecidedTurnAnsweredInWords(turn('Добавь кэш перед базой велосипедов и станций.', { activeDesign: DESIGN }), 'prose'), false);
    assert.equal(dps.undecidedTurnAnsweredInWords(turn('Во сколько завтра встреча?'), 'prose'), false);
    assert.equal(dps.undecidedTurnAnsweredInWords(null, 'prose'), false);
  });

  test('the user\'s standing "no diagrams" and the feature switch hold', () => {
    assert.equal(turn(FRESH, { userInstructions: 'No diagrams, ever.' }).signals, null);
    assert.equal(turn(FRESH, { featureEnabled: false }).signals, null);
    assert.equal(turn(EDIT, { activeDesign: DESIGN, featureEnabled: false }).turnBlock, '');
  });
});

describe('the privacy scope holds for an undecided turn', () => {
  const DENY = 'NATIVELY_DENY_PROVIDER_SCOPES';
  const withDenied = (fn) => {
    const before = process.env[DENY];
    process.env[DENY] = 'transcript';
    try { return fn(); } finally {
      if (before === undefined) delete process.env[DENY]; else process.env[DENY] = before;
      scope.registerOnDeviceModelProbe(null);
    }
  };

  test('transcript may not go to the provider: the drawing is not handed over, and nothing is undecided about it', () => withDenied(() => {
    const t = turn(EDIT, { activeDesign: DESIGN });
    assert.equal(t.turnBlock, '');
    assert.equal(t.signals, null);
  }));

  test('…a model on this device is handed it', () => withDenied(() => {
    scope.registerOnDeviceModelProbe(() => true);
    const t = turn(EDIT, { activeDesign: DESIGN });
    assert.equal(t.signals.undecided, true);
    assert.ok(t.turnBlock.includes('Платёжный сервис'));
  }));
});

describe('Direct Assist', () => {
  const base = { requestId: 'r1', source: 'typed', selection: { provider: 'gemini', model: 'gemini-2.5-flash' } };
  const history = [
    { role: 'user', content: 'Спроектируй сервис проката велосипедов.' },
    { role: 'assistant', content: `Вот схема.\n\n\`\`\`mermaid\n${RU}\n\`\`\`` },
  ];

  test('an undecided follow-up: the conditional contract and the drawing, together', () => {
    const prepared = prepareDirectAssistPrompt({ ...base, currentRequest: EDIT, history });
    assert.equal(count(prepared.systemPrompt, '<diagram_contract>'), 1);
    assert.match(prepared.systemPrompt, /could not tell from the words of this turn/);
    assert.equal(count(prepared.userPrompt, '<recent_transcript kind="active_design">'), 1);
    assert.match(prepared.userPrompt, /for you to decide/);
  });

  test('once the conversation has moved on, a turn that names nothing of the drawing is sent exactly as before', () => {
    const movedOn = [...history, ...['Обед в час.', 'Отчёт сдаём в пятницу.', 'Да, созвон перенесли.'].flatMap((text) => [{ role: 'user', content: 'ок' }, { role: 'assistant', content: text }])];
    const prepared = prepareDirectAssistPrompt({ ...base, currentRequest: 'Во сколько завтра встреча с командой?', history: movedOn });
    assert.equal(count(prepared.systemPrompt, '<diagram_contract>'), 0);
    assert.equal(count(prepared.userPrompt, '<recent_transcript kind="active_design">'), 0);
  });
});
