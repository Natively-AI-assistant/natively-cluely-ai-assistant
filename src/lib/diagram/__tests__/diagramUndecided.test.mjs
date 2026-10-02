// A turn the rules cannot place, said in Spanish, Russian, Chinese or Japanese.
//
// Five blind sets showed the four-language rules do not converge: about a
// third of real requests on unseen sentences went unrecognised (see
// docs/diagrams/README.md). Such a turn is now left UNDECIDED where a drawing
// is plausibly in play, and the model that answers is asked to say which it
// is, in the same generation.
//
// What is pinned here is everything that is NOT the model's judgement:
//   - which turns are handed over, and which never are;
//   - that an undecided turn is not a diagram turn for anything that routes,
//     validates or remembers one (`enabled` stays false);
//   - that the conditional contract is the decided contract, word for word,
//     under a condition — so the two cannot drift apart;
//   - that nothing the rules already decide changes.
//
// The model's judgement itself is measured live, on a blind set (README).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveDiagramRequest } from '../diagramRequest.mjs';
import { undecidedOtherLanguageTurn, saysNoDrawing, answerNamesParts } from '../diagramRequestI18n.mjs';
import { diagramPromptSignals, renderDiagramContract, renderDiagramTurnBlock, renderDiagramTurnNote, DIAGRAM_CONTRACT_OPEN } from '../diagramContract.mjs';
import { answerIsAbout, createActiveDesignState } from '../activeDesign.mjs';

const ARCH = {
  es: 'flowchart LR\n  app[App del ciclista] --> gw["Pasarela de API"]\n  gw --> viajes[Servicio de viajes]\n  viajes --> inv[(Inventario de bicis y estaciones)]\n  viajes --> pagos["Servicio de pagos"]\n  viajes --> cola[[Cola de eventos]]\n  cola --> notif[Notificaciones]',
  ru: 'flowchart LR\n  app[Приложение райдера] --> gw["API-шлюз"]\n  gw --> rides[Сервис поездок]\n  rides --> inv[(База велосипедов и станций)]\n  rides --> pay["Платёжный сервис"]\n  rides --> q[[Очередь событий]]\n  q --> notif[Уведомления]',
  zh: 'flowchart LR\n  app[骑行App] --> gw["API网关"]\n  gw --> ride[骑行服务]\n  ride --> inv[(车辆与站点库存库)]\n  ride --> pay["支付服务"]\n  ride --> mq[[事件队列]]\n  mq --> notif[消息通知]',
  ja: 'flowchart LR\n  app[ライダーアプリ] --> gw["APIゲートウェイ"]\n  gw --> ride[ライドサービス]\n  ride --> inv[(車両・ステーション在庫DB)]\n  ride --> pay["決済サービス"]\n  ride --> q[[イベントキュー]]\n  q --> notif[通知サービス]',
};
const design = (lang, foreground = true) => ({ artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground, source: ARCH[lang] });
const CHART = { artifactId: 'chart-1.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: JSON.stringify({ v: 1, type: 'bar', title: '每日骑行次数', x: { label: '日期', values: ['周一至周四', '周五', '周六', '周日'] }, y: { label: '日均骑行次数' }, series: [{ name: '骑行次数', values: [820, 760, 1310, 990], status: 'illustrative' }] }) };
const ask = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...extra });

describe('an undecided turn is not a diagram turn', () => {
  const x = ask('и ещё прицепи к платежам антифрод отдельным кубиком', { activeDesign: design('ru') });

  test('it stays disabled, with nothing a router or a validator reads', () => {
    assert.equal(x.enabled, false);
    assert.equal(x.operation, 'none');
    assert.equal(x.output, 'text-only');
    assert.equal(x.reason, 'undecided');
    assert.equal(x.parentArtifactId, undefined);
    assert.equal(x.followUp, undefined);
    assert.equal(x.explicit, false);
  });

  test('it carries the request it would be, and hands over the drawing', () => {
    assert.equal(x.undecided.enabled, true);
    assert.equal(x.undecided.operation, 'update');
    assert.equal(x.undecided.view, 'architecture');
    assert.equal(x.undecided.parentArtifactId, 'design-1.v1');
    assert.equal(x.attachActiveDesign, true);
    assert.equal(x.language, 'ru');
  });

  test('with the feature off there is nothing undecided', () => {
    const off = resolveDiagramRequest({ question: 'и ещё прицепи к платежам антифрод отдельным кубиком', activeDesign: design('ru'), featureEnabled: false });
    assert.equal(off.enabled, false);
    assert.equal(off.undecided, undefined);
  });
});

describe('which turns are handed to the model', () => {
  // The rules place none of these (each was a miss on the fifth blind set).
  const FRESH = [
    ['parce, hágame un favor y me pinta ahí cómo va el flujo de aprobación de un crédito, desde que el cliente lo pide hasta que se desembolsa', 'flowchart'],
    ['Para la mudanza de la oficina me vendría bien un Gantt con las tareas y las semanas, ¿te animas?', 'gantt'],
    ['Мне бы табличку: Постгрес против Монги — транзакции, масштабирование, стоимость поддержки.', 'matrix'],
    ['покажи это картинкой а то на словах я запутался как у нас еда едет от ресторана до двери клиента', 'flowchart'],
    ['近六个月日活 折线图 来一个', 'chart'],
    ['把这学期的教学安排按时间线排一下，开学、期中、期末、答辩', 'timeline'],
    ['新卒採用のスケジュール、ガントチャートでざっくり引いてみて', 'gantt'],
  ];
  for (const [q, view] of FRESH) {
    test(`a drawing mentioned, with nothing on the table: ${q.slice(0, 40)}…`, () => {
      const x = ask(q);
      assert.equal(x.enabled, false);
      assert.ok(x.undecided, 'handed over');
      assert.equal(x.undecided.operation, 'create');
      assert.equal(x.undecided.view, view);
      assert.equal(x.attachActiveDesign, false);
    });
  }

  const FOLLOW = [
    ['es', 'el servicio de pagos ese, ¿es nuestro o es un proveedor externo tipo Stripe?'],
    ['ru', 'Сервис поездок и платёжный сервис обведи рамкой и подпиши «ядро».'],
    ['zh', '锁控和骑行服务之间那条线上标一下“MQTT”'],
    ['ja', 'ドライバーさんの分が抜けてるわ。回収トラック用のアプリを足して、プランナーから指示が飛ぶようにして。'],
  ];
  for (const [lang, q] of FOLLOW) {
    test(`the drawing in focus (${lang}): any turn the rules cannot place`, () => {
      const x = ask(q, { activeDesign: design(lang) });
      assert.equal(x.enabled, false);
      assert.equal(x.undecided.operation, 'update');
      assert.equal(x.undecided.attachActiveDesign, true);
      assert.equal(x.undecided.away, undefined);
    });
  }

  test('in focus, a turn about anything else is handed over too: the model says it is not about it', () => {
    for (const [lang, q] of [['es', '¿A qué hora es la reunión con los de pagos mañana?'], ['es', '¿Quién maneja la furgoneta el martes, Raúl o Dani?'], ['ru', 'Во сколько завтра встреча с командой?']]) {
      assert.equal(ask(q, { activeDesign: design(lang) }).reason, 'undecided', q);
    }
  });

  // A model asked in Spanish or Japanese labels its drawing in English as
  // often as not. A turn about it then shares no word with it, so no shared
  // word is asked for while it is in focus (seen in the real engine: the
  // rename below was answered in prose while a gate on shared words stood).
  test('in focus, a drawing labelled in English and a turn in another language', () => {
    const english = { artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n  api["API Gateway"] --> order["Order Service"]\n  order --> pay["Payment Service"]\n  order --> odb[("Order DB")]' };
    for (const q of ['決済のところは外部のやつ使うから、名前を「外部決済」に変えといて', 'y el proveedor de pagos ese, ¿es nuestro o es de fuera?', 'и ещё прицепи к платежам антифрод отдельным кубиком']) {
      const x = ask(q, { activeDesign: english });
      assert.equal(x.reason, 'undecided', q);
      assert.equal(x.attachActiveDesign, true, q);
    }
  });

  test('out of focus, only a turn that names the drawing or one of its parts', () => {
    const named = ask('А управление поездками — сервис поездок держит соединение или опрашивает по расписанию?', { activeDesign: design('ru', false) });
    assert.equal(named.reason, 'undecided');
    assert.equal(named.undecided.away, true);
    const other = ask('Во сколько завтра встреча с командой?', { activeDesign: design('ru', false) });
    assert.equal(other.undecided, undefined);
    assert.notEqual(other.reason, 'undecided');
  });

  test('another kind of drawing named while one is in focus: asked for of the one on the table only when the sentence points at it', () => {
    const fresh = ask('esto mismo me vendria bien tenerlo como diagrama de secuencia, no?', { activeDesign: design('es') });
    assert.equal(fresh.enabled, false);
    assert.equal(fresh.undecided.operation, 'create');
    assert.equal(fresh.undecided.view, 'sequence');
    assert.equal(fresh.undecided.parentArtifactId, undefined);
    assert.equal(fresh.attachActiveDesign, false);
  });

  test('a chart in focus', () => {
    const x = ask('标题改成“工作日与周末骑行对比”，纵轴单位写清楚是“次”', { activeDesign: CHART });
    assert.equal(x.undecided.view, 'chart');
    assert.equal(x.undecided.operation, 'update');
  });
});

describe('which turns are never handed over', () => {
  test('English: the English rules are the whole decision', () => {
    for (const q of ['What time is the meeting with the payments team tomorrow?', 'Is this a remote role?', 'Thanks, that makes sense.', 'My manager wants me to draw the flow by Friday.']) {
      const x = ask(q, { activeDesign: { artifactId: 'd.v1', view: 'architecture', foreground: true, source: 'flowchart LR\n a["Payment Service"] --> b[["Event Queue"]]' } });
      assert.equal(x.undecided, undefined, q);
      assert.equal(undecidedOtherLanguageTurn({ question: q }), null, q);
    }
  });

  test('a coding turn', () => {
    const x = ask('dibuja no, mejor escribe la función que recorre la cola', { activeDesign: design('es'), answerType: 'coding_question_answer' });
    assert.equal(x.undecided, undefined);
  });

  test('a turn that says no drawing is wanted', () => {
    for (const [lang, q] of [['es', 'explícame el flujo de pagos sin diagrama, solo con palabras'], ['ru', 'объясни как работает очередь, только без схем'], ['zh', '讲一下支付服务，不要画图'], ['ja', '決済サービスの流れを説明して、図はいらない']]) {
      const x = ask(q, { activeDesign: design(lang) });
      assert.equal(x.undecided, undefined, q);
    }
  });

  test('the user\'s standing "no diagrams", in English or in their own language', () => {
    const q = 'Para la mudanza de la oficina me vendría bien un Gantt con las tareas y las semanas, ¿te animas?';
    assert.ok(ask(q).undecided);
    assert.equal(ask(q, { userInstructions: 'Never draw diagrams. Keep answers short.' }).undecided, undefined);
    assert.equal(ask(q, { userInstructions: 'Responde siempre sin diagramas.' }).undecided, undefined);
    assert.equal(saysNoDrawing('Всегда отвечай без схем'), true);
    assert.equal(saysNoDrawing('Be brief.'), false);
  });

  test('a turn with nothing in it to decide on', () => {
    for (const [lang, q] of [['es', 'Vale.'], ['es', 'ok, gracias'], ['ru', 'Ага.'], ['zh', '好的'], ['ja', 'はい']]) {
      assert.equal(ask(q, { activeDesign: design(lang) }).undecided, undefined, q);
    }
  });

  test('a question about a KIND of drawing: asked to decide, a model illustrates it', () => {
    for (const q of ['¿Para qué sirve un diagrama entidad-relación?', '¿Cuál es la diferencia entre un diagrama de clases y uno de objetos?', 'Чем диаграмма классов отличается от диаграммы объектов?', '类图和对象图有什么区别？', 'ER图到底是干什么用的？', 'クラス図とオブジェクト図の違いは何ですか？', 'ER図は何のために使うんですか？']) {
      assert.equal(ask(q).undecided, undefined, q);
    }
  });

  test('…but a verb that draws beside the same words still asks (decided by the rules)', () => {
    const x = ask('画个图解释一下什么是三次握手');
    assert.equal(x.enabled, true);
  });

  test('nothing in play: no drawing on the table and none mentioned', () => {
    for (const q of ['¿Qué hora es en Madrid ahora?', 'Новая модель телефона вышла, а по сути то же самое, только камера другая.', '这个模型训练了三天，效果还是不太行', '明日の会議は十時からです']) {
      assert.equal(ask(q).undecided, undefined, q);
    }
  });
});

describe('every real request the rules miss on the blind sets is handed over', async () => {
  for (const n of [3, 4, 5]) {
    const { ROWS, FIXTURES } = await import(`../../../../tests/diagram/i18n-heldout-${n}-2026-10-02.mjs`);
    test(`set ${n}: a must row is decided by the rules or left undecided, never dropped`, () => {
      const dropped = [];
      let undecided = 0;
      for (const row of ROWS) {
        if (row.expect !== 'draw' && row.expect !== 'claim') continue;
        const x = resolveDiagramRequest({ question: row.q, featureEnabled: true, mode: row.mode, ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}) });
        if (x.enabled) continue;
        if (x.undecided) undecided += 1;
        else dropped.push(row.id);
      }
      // (Set 3: one sentence names no visual and has nothing on the table.)
      assert.deepEqual(dropped, n === 3 ? ['ru-A04'] : []);
      if (n === 5) assert.equal(undecided, 48);
    });
  }
});

// The sixth blind set: 220 sentences written by an author who had read neither
// the rules nor the contract, frozen by hash before anything was run on them,
// then run ONCE through the rules and through DeepSeek (docs/diagrams/README.md
// has the figures). Pinned here: what the rules alone do with it. The rows
// they get wrong are listed, not fixed: after five rounds of fixing rows, the
// finding is that the next unseen set brings as many.
describe('the sixth four-language blind set, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-6-2026-10-02.mjs');
  const resolve = (row) => resolveDiagramRequest({ question: row.q, featureEnabled: true, mode: row.mode, ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}) });

  test('the file is the one that was frozen before it was run', () => {
    const file = fileURLToPath(new URL('../../../../tests/diagram/i18n-heldout-6-2026-10-02.mjs', import.meta.url));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), '087adf8b863223c64c557d7d279ea7eaa29eb93a153089b2e054909cc103ac22');
    assert.equal(ROWS.length, 220);
  });

  // Ordinary talk the rules attach or draw (2 of them would draw): the model
  // is not asked about these — the rules were sure, and wrong.
  const WRONGLY_DECIDED = ['es-E05', 'ru-E01', 'zh-E03', 'zh-E05', 'zh-F04', 'ja-B03', 'ja-G03'];
  // A change to the drawing read as a request for a new one.
  const NOT_ATTACHED = ['zh-D02', 'ja-D09'];
  // Decided as the wrong thing: the kind of drawing (5), an edit read as a
  // question (3), a question read as an edit (1).
  const WRONG_SHAPE = ['es-A01', 'es-D08', 'ru-A01', 'ru-A08', 'ru-D03', 'zh-A01', 'zh-A07', 'zh-D08', 'ja-F01'];

  test('must-not: seven rows wrongly decided by the rules, the rest untouched or handed to the model', () => {
    const wrong = ROWS.filter((row) => (row.expect === 'nodraw' || row.expect === 'noclaim') && resolve(row).enabled).map((row) => row.id);
    assert.deepEqual(wrong.sort(), [...WRONGLY_DECIDED].sort());
  });

  test('must: every row is decided by the rules or handed to the model; none is dropped', () => {
    const dropped = [];
    const notAttached = [];
    const wrongShape = [];
    let decided = 0;
    let undecided = 0;
    for (const row of ROWS) {
      if (row.expect !== 'draw' && row.expect !== 'claim') continue;
      const x = resolve(row);
      if (!x.enabled) {
        if (x.undecided) undecided += 1;
        else dropped.push(row.id);
        continue;
      }
      if (row.expect === 'claim' && !x.parentArtifactId) { notAttached.push(row.id); continue; }
      decided += 1;
      if ((row.expect === 'claim' && row.op && x.operation !== row.op) || (row.view && x.view !== row.view)) wrongShape.push(row.id);
    }
    // When the set was run blind, five more were dropped (a visual named in
    // words the hand-over gate did not know: "cajitas con flechas",
    // "столбики", "майнд-карту", "列个表"; and Spanish with no accent and one
    // article, not recognised as Spanish). The gate was widened afterwards.
    assert.deepEqual(dropped, []);
    assert.deepEqual(notAttached.sort(), [...NOT_ATTACHED].sort());
    assert.deepEqual(wrongShape.sort(), [...WRONG_SHAPE].sort());
    assert.equal(decided, 89);
    assert.equal(undecided, 41);
  });
});

describe('the conditional contract is the decided contract, under a condition', () => {
  const inner = (text) => text.replace(/^<diagram_contract>\n/, '').replace(/\n<\/diagram_contract>$/, '');
  const followUp = ask('и ещё прицепи к платежам антифрод отдельным кубиком', { activeDesign: design('ru') });
  const signals = diagramPromptSignals(followUp, { question: 'x' });

  test('signals: bounded, marked, and with no reference example for a Mermaid kind', () => {
    assert.deepEqual(signals, { view: 'architecture', operation: 'update', output: 'text-and-diagram', basis: 'proposed-design', withCode: false, hasParent: true, depth: 'brief', exampleIds: [], undecided: true });
  });

  test('a decided request is untouched by any of this', () => {
    const decided = ask('Agrégale una caché entre la pasarela y el servicio de viajes.', { activeDesign: design('es') });
    assert.equal(decided.enabled, true);
    const s = diagramPromptSignals(decided, { question: 'x' });
    assert.equal(s.undecided, undefined);
    assert.doesNotMatch(renderDiagramContract(s), /could not tell/);
  });

  for (const tier of ['cloud', 'local']) {
    test(`a turn that may be about the drawing (${tier}): the change body and the question body, word for word`, () => {
      const text = renderDiagramContract(signals, { tier, surface: 'live' });
      const decided = { ...signals };
      delete decided.undecided;
      const change = inner(renderDiagramContract({ ...decided, operation: 'update' }, { tier, surface: 'live' })).split('\nIf the turn is plainly about something else')[0];
      const question = inner(renderDiagramContract({ ...decided, operation: 'explain', output: 'text-only' }, { tier, surface: 'live' })).split('\nIf the turn is plainly about something else')[0];
      assert.ok(text.includes(change), 'the update body');
      assert.ok(text.includes(question), 'the explain body');
      assert.equal(text.split(DIAGRAM_CONTRACT_OPEN).length - 1, 1);
      // The third way out, and no reasoning aloud.
      assert.match(text, /answer as you normally would/);
      assert.match(text, tier === 'cloud' ? /take nothing from the drawing/ : /say nothing of the drawing or its parts/);
      assert.match(text, /never write out/i);
    });
  }

  test('a drawing that may be asked for: the create body, word for word, and the ways it is not asked for', () => {
    const fresh = ask('Para la mudanza de la oficina me vendría bien un Gantt con las tareas y las semanas, ¿te animas?');
    const s = diagramPromptSignals(fresh, { question: 'x' });
    assert.equal(s.undecided, true);
    assert.equal(s.hasParent, false);
    const text = renderDiagramContract(s, { tier: 'cloud', surface: 'live' });
    const decided = { ...s };
    delete decided.undecided;
    assert.ok(text.includes(inner(renderDiagramContract(decided, { tier: 'cloud', surface: 'live' }))));
    assert.match(text, /Do not volunteer one/);
    assert.match(text, /asked of the speaker by somebody else/);
    assert.match(text, /ought to exist some day/);
    assert.match(text, /WHETHER to make one/);
    assert.match(text, /never invent a subject/);
    assert.ok(renderDiagramContract(s, { tier: 'local' }).length < text.length / 2);
  });

  test('a chart keeps its reference example (the notation is JSON); a Mermaid kind carries none', () => {
    const chart = diagramPromptSignals(ask('近六个月日活 折线图 来一个'), { question: 'x', maxExamples: 1 });
    assert.equal(chart.undecided, true);
    assert.equal(chart.exampleIds.length, 1);
    const gantt = diagramPromptSignals(ask('新卒採用のスケジュール、ガントチャートでざっくり引いてみて'), { question: 'x', maxExamples: 1 });
    assert.deepEqual(gantt.exampleIds, []);
  });

  test('the conversation has moved on: said so, and only then', () => {
    const away = diagramPromptSignals(ask('А управление поездками — сервис поездок держит соединение или опрашивает по расписанию?', { activeDesign: design('ru', false) }), { question: 'x' });
    assert.equal(away.away, true);
    assert.match(renderDiagramContract(away), /has moved on since it was drawn/);
    assert.doesNotMatch(renderDiagramContract(signals), /has moved on since it was drawn/);
  });

  test('static: the same signals give the same text, and nothing of the turn is in it', () => {
    const a = renderDiagramContract(signals);
    const b = renderDiagramContract(diagramPromptSignals(ask('锁控和骑行服务之间那条线上标一下“MQTT”', { activeDesign: design('zh') }), { question: 'y' }));
    assert.equal(a, b);
    assert.doesNotMatch(a, /антифрод|MQTT/);
  });

  test('the drawing is handed over without "do not redraw it"', () => {
    const block = renderDiagramTurnBlock(followUp, design('ru'));
    assert.match(block, /^<active_design view="architecture" version="1">/);
    assert.match(block, /here only in case this turn asks to change it or asks about it: whether it does is for you to decide/);
    assert.match(block, /answer as if this block were not here, and use nothing from it/);
    assert.doesNotMatch(block, /Do not redraw it/);
    assert.ok(block.includes('Платёжный сервис'));
  });

  test('a chart is handed over with the values the app computed', () => {
    const x = ask('金曜だけ低いのはどうしてですか？', { activeDesign: { ...CHART, source: CHART.source.replace('周五', '金曜').replace('周六', '土曜') } });
    if (x.undecided) assert.match(renderDiagramTurnBlock(x, { ...CHART, source: CHART.source.replace('周五', '金曜').replace('周六', '土曜') }), /Values \(what the app computed/);
  });

  test('the turn note says MAY', () => {
    assert.match(renderDiagramTurnNote(signals), /MAY apply to this turn/);
    assert.doesNotMatch(renderDiagramTurnNote({ ...signals, undecided: undefined }), /MAY apply/);
  });

  test('a request that is neither enabled nor undecided has no signals, as before', () => {
    assert.equal(diagramPromptSignals(ask('¿Qué hora es en Madrid ahora?'), { question: 'x' }), null);
    assert.equal(renderDiagramTurnBlock(ask('¿Qué hora es en Madrid ahora?', { activeDesign: design('es', false) }), design('es', false)), '');
  });
});

describe('a drawing labelled in another language stays in focus through an answer about it', () => {
  const CASES = [
    ['ru', 'Платёжный сервис вызывается синхронно из сервиса поездок, а очередь событий нужна для уведомлений.', 'Встреча с платёжной командой завтра в десять, я уточню в календаре.'],
    ['zh', '支付服务是骑行服务同步调用的，事件队列只用来发通知。', '明天上午十点开会，我看一下日历。'],
    ['ja', '通知サービスはイベントキューからイベントを受け取ってライダーに届けます。', '明日の会議は十時からです。カレンダーを確認します。'],
  ];
  for (const [lang, about, other] of CASES) {
    test(`${lang}: two of its parts named is about it; an answer about tomorrow's meeting is not`, () => {
      assert.equal(answerIsAbout(about, ARCH[lang]), true);
      assert.equal(answerNamesParts(about, ARCH[lang]), true);
      assert.equal(answerIsAbout(other, ARCH[lang]), false);
    });
  }

  test('one of its parts alone, or a word two labels share, is not enough', () => {
    assert.equal(answerIsAbout('Сервис работает хорошо, очередь в магазине была длинная.', ARCH.ru), false);
    assert.equal(answerIsAbout('支付服务明天要续费。', ARCH.zh), false);
  });

  test('an English drawing is read exactly as before', () => {
    const source = 'flowchart LR\n a["Payment Service"] --> b[["Event Queue"]]\n b --> c["Notification Worker"]';
    assert.equal(answerNamesParts('The payment service writes to the event queue.', source), false);
    assert.equal(answerIsAbout('The payment service writes to the event queue.', source), true);
  });

  // A drawing labelled in English, discussed in Spanish: the answer to a
  // question about it names none of its parts as written. An undecided turn
  // therefore keeps the drawing in focus through ONE answer nobody can place
  // — so the edit that follows the question reaches it — and not through two.
  test('an undecided turn: the drawing stays in focus through one answer that cannot be placed, not two', () => {
    const english = 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]\n    worker --> sms["SMS Provider"]';
    const state = createActiveDesignState();
    state.observeAnswer(`Aquí está.\n\n\`\`\`mermaid\n${english}\n\`\`\`\n`);
    state.untouch();
    state.consider();
    state.observeAnswer('Es de fuera: lo trato como un proveedor externo detrás de una interfaz propia.');
    assert.equal(state.get().foreground, true, 'one answer that names nothing');
    state.untouch();
    state.consider();
    state.observeAnswer('Quedamos mañana a las diez.');
    assert.equal(state.get().foreground, false, 'a second one in a row');
  });

  test('…a turn that was NOT handed the drawing gets no such grace, and a code answer never does', () => {
    const english = 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]';
    const plain = createActiveDesignState();
    plain.observeAnswer(`Here.\n\n\`\`\`mermaid\n${english}\n\`\`\`\n`);
    plain.untouch();
    plain.observeAnswer('Quedamos mañana a las diez.');
    assert.equal(plain.get().foreground, false);
    const code = createActiveDesignState();
    code.observeAnswer(`Here.\n\n\`\`\`mermaid\n${english}\n\`\`\`\n`);
    code.untouch();
    code.consider();
    code.observeAnswer('Así:\n\n```python\nprint(1)\n```\n');
    assert.equal(code.get().foreground, false);
  });

  test('…and an answer that is about it, or a redraw, gives the grace back', () => {
    const state = createActiveDesignState();
    state.observeAnswer(`Вот схема.\n\n\`\`\`mermaid\n${ARCH.ru}\n\`\`\`\n`);
    state.untouch(); state.consider();
    state.observeAnswer('Не знаю, уточню.');
    assert.equal(state.get().foreground, true);
    state.untouch(); state.consider();
    state.observeAnswer('Платёжный сервис вызывается синхронно из сервиса поездок, а очередь событий нужна для уведомлений.');
    assert.equal(state.get().foreground, true);
    state.untouch(); state.consider();
    state.observeAnswer('Не знаю, уточню.');
    assert.equal(state.get().foreground, true, 'spared again after an answer about it');
    state.untouch(); state.consider();
    state.observeAnswer('Встреча завтра в десять.');
    assert.equal(state.get().foreground, false);
  });

  test('the session keeps it in focus through such an answer, and lets it go after one that is not', () => {
    const state = createActiveDesignState();
    state.observeAnswer(`Вот схема.\n\n\`\`\`mermaid\n${ARCH.ru}\n\`\`\`\n`);
    assert.equal(state.get().foreground, true);
    state.untouch();
    state.observeAnswer('Платёжный сервис вызывается синхронно из сервиса поездок, а очередь событий нужна для уведомлений.');
    assert.equal(state.get().foreground, true);
    state.untouch();
    state.observeAnswer('Встреча завтра в десять.');
    assert.equal(state.get().foreground, false);
  });
});
