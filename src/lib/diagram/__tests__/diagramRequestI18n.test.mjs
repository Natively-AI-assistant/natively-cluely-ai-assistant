// Requests in Spanish, Russian, Chinese and Japanese (diagramRequestI18n.mjs).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiagramRequest } from '../diagramRequest.mjs';
import { resolveOtherLanguageRequest, detectRequestLanguage } from '../diagramRequestI18n.mjs';
import { diagramPromptSignals, renderDiagramContract, renderDiagramTurnBlock } from '../diagramContract.mjs';
import { checkDiagramSource } from '../diagramPolicy.mjs';
import { CASES, DESIGN, CHART } from '../../../../tests/diagram/i18n-cases.mjs';

const CONTEXT = {
  none: {},
  arch: { activeDesign: DESIGN },
  bg: { activeDesign: { ...DESIGN, foreground: false } },
  chart: { activeDesign: CHART },
  code: { answerType: 'coding_question_answer' },
};
const ask = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...extra });
const outcome = (x) => (!x.enabled ? 'off' : x.parentArtifactId ? `${x.operation}:P` : `${x.view}${x.layout ? `/${x.layout}` : ''}`);

describe('which language a turn is in', () => {
  test('kana is Japanese, Han without kana is Chinese, Cyrillic is Russian, Spanish by its letters or its small words', () => {
    assert.equal(detectRequestLanguage('アーキテクチャ図を描いて'), 'ja');
    assert.equal(detectRequestLanguage('構成図を描いてください'), 'ja');
    assert.equal(detectRequestLanguage('画一个系统架构图'), 'zh');
    assert.equal(detectRequestLanguage('Нарисуй схему'), 'ru');
    assert.equal(detectRequestLanguage('Diseña un acortador de URLs'), 'es');
    assert.equal(detectRequestLanguage('dibuja el flujo de la app'), 'es');
    assert.equal(detectRequestLanguage('Draw the login flow'), null);
    assert.equal(detectRequestLanguage('Design a URL shortener for LA'), null);
    assert.equal(detectRequestLanguage(''), null);
    assert.equal(detectRequestLanguage(null), null);
  });
});

describe('what an independent read found (tests/diagram/i18n-review-2026-10-02.mjs)', async () => {
  const { REVIEW_CASES, CONTEXTS, meets } = await import('../../../../tests/diagram/i18n-review-2026-10-02.mjs');
  for (const [want, ctx, question] of REVIEW_CASES) {
    test(`${want} [${ctx}] ${question}`, () => {
      const activeDesign = CONTEXTS[ctx];
      const x = resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...(activeDesign ? { activeDesign: { ...activeDesign } } : {}) });
      assert.ok(meets(want, x), `${question} → ${x.enabled ? `${x.operation}/${x.view}/${x.basis}${x.parentArtifactId ? '/P' : ''}${x.parentFamily ? `/of-${x.parentFamily}` : ''}` : `off (${x.reason})`}`);
    });
  }

  test('the chart as a table carries what the contract needs to copy its numbers', () => {
    for (const question of ['Muestra este gráfico como tabla', 'Покажи этот график в виде таблицы', '把这个图表转成表格', 'このグラフを表にしてください']) {
      const x = resolveDiagramRequest({ question, featureEnabled: true, activeDesign: { ...CONTEXTS.chart } });
      assert.deepEqual([x.view, x.operation, x.parentArtifactId, x.parentFamily, x.attachActiveDesign], ['matrix', 'create', CONTEXTS.chart.artifactId, 'chart', true], question);
    }
  });

  test('another shape of the same chart is an edit of it, as in English', () => {
    for (const question of ['Muestra este gráfico como gráfico de barras', 'Покажи этот график как столбчатую диаграмму', '把这个图表改成柱状图', 'このグラフを棒グラフにしてください']) {
      const x = resolveDiagramRequest({ question, featureEnabled: true, activeDesign: { ...CONTEXTS.chart } });
      assert.deepEqual([x.view, x.operation, x.parentArtifactId], ['chart', 'update', CONTEXTS.chart.artifactId], question);
    }
  });

  test('"it" is the drawing only as the object of the request, never a stray pronoun', () => {
    const ask = (question) => resolveDiagramRequest({ question, featureEnabled: true, activeDesign: { ...CONTEXTS.arch } });
    // A fresh drawing of another subject, with a pronoun that is about something else.
    for (const question of [
      'Hazme un diagrama de flujo del proceso de contratación, eso es urgente',
      'Нарисуй блок-схему процесса найма, это срочно',
      '把这个招聘流程画成流程图',
      '採用プロセスのフローチャートを描いて、これは急ぎです',
      'Dibuja un diagrama de flujo de esto que te cuento: llega el pedido, se cobra y se envía',
    ]) {
      const x = ask(question);
      assert.deepEqual([x.enabled, x.view, x.parentArtifactId], [true, 'flowchart', undefined], question);
    }
    // The drawing on the table, as the thing to show another way.
    for (const question of ['Muéstralo como diagrama de secuencia', 'Покажи это как диаграмму последовательности', '把它画成时序图', 'これをシーケンス図にしてください', 'Muestra este diseño como diagrama de secuencia']) {
      const x = ask(question);
      assert.deepEqual([x.enabled, x.view, x.parentArtifactId], [true, 'sequence', CONTEXTS.arch.artifactId], question);
    }
  });

  test('an edit that cites what someone said is an edit; a question about what was said is not a follow-up', () => {
    const ask = (question) => resolveDiagramRequest({ question, featureEnabled: true, activeDesign: { ...CONTEXTS.arch } });
    for (const question of ['Añade la caché que mencionó Ana', 'Pon la base de datos que acordamos', 'Добавь очередь, о которой говорил Иван']) {
      const x = ask(question);
      assert.deepEqual([x.enabled, x.operation], [true, 'update'], question);
    }
    assert.equal(ask('¿Qué dijo Pedro sobre el servicio de pedidos?').enabled, false);
  });

  test('"suma" adds numbers; "súmale" adds a part', () => {
    const ask = (question) => resolveDiagramRequest({ question, featureEnabled: true, activeDesign: { ...CONTEXTS.arch } });
    const sum = ask('Suma los costes de la base de datos y la caché');
    assert.ok(!(sum.enabled && sum.operation === 'update'));
    assert.equal(ask('Súmale una caché delante de la base de datos').operation, 'update');
  });

  test('English is not read as Spanish for a word the two share', () => {
    assert.equal(detectRequestLanguage('Resume the gantt work and eliminate the blockers'), null);
    assert.equal(detectRequestLanguage('Can you explicate the cola wars timeline issue for me'), null);
    assert.equal(detectRequestLanguage('Dibuja la arquitectura'), 'es');
    assert.equal(detectRequestLanguage('quita la cola'), 'es');
    assert.equal(detectRequestLanguage('elimina el servicio de pagos'), 'es');
  });
});

describe('every case in tests/diagram/i18n-cases.mjs', () => {
  const sections = [...new Set(CASES.map((c) => c[3]))];
  for (const section of sections) {
    const cases = CASES.filter((c) => c[3] === section);
    test(`${section} (${cases.length})`, () => {
      const wrong = [];
      for (const [want, ctx, q] of cases) {
        const got = outcome(ask(q, CONTEXT[ctx]));
        const ok = want === 'off' ? got === 'off' : want === 'on' ? got !== 'off' : got === want;
        if (!ok) wrong.push(`${q} → ${got}, wanted ${want}`);
      }
      assert.deepEqual(wrong, []);
    });
  }
});

describe('the English rules decide first, and are not changed by this', () => {
  test('an English sentence is never read by the other-language rules', () => {
    for (const q of ['Draw the login flow', 'Design a URL shortener', 'Add a cache in front of the order service', 'Can everyone hear me okay?', 'We need a table for six at eight.', 'No diagram please, just explain.']) {
      assert.equal(resolveOtherLanguageRequest({ question: q, activeDesign: DESIGN }), null, q);
    }
  });

  test('with the feature off, nothing is read at all', () => {
    assert.equal(resolveDiagramRequest({ question: 'Dibuja la arquitectura', featureEnabled: false, mode: 'general' }).enabled, false);
    assert.equal(resolveDiagramRequest({ question: '画一个系统架构图', featureEnabled: false, mode: 'general' }).reason, 'feature_off');
  });

  test('a request says which language it was read in; an English one does not', () => {
    assert.equal(ask('Dibuja la arquitectura').language, 'es');
    assert.equal(ask('Нарисуй архитектуру сервиса').language, 'ru');
    assert.equal(ask('画一个系统架构图').language, 'zh');
    assert.equal(ask('アーキテクチャ図を描いて').language, 'ja');
    assert.equal(ask('Draw the architecture').language, undefined);
  });
});

describe('what a non-English request turns into', () => {
  test('a design ask is an architecture, proposed, with no parent', () => {
    for (const q of ['Diseña un acortador de URLs', 'Спроектируй сервис сокращения ссылок', '设计一个短链接系统', 'URL短縮サービスを設計して']) {
      const out = ask(q, { mode: 'technical-interview' });
      assert.deepEqual([out.enabled, out.view, out.operation, out.reason, out.parentArtifactId, out.basis], [true, 'architecture', 'create', 'design_ask', undefined, 'proposed-design'], q);
    }
  });

  test('it gets the same contract an English request gets', () => {
    const english = renderDiagramContract(diagramPromptSignals(ask('Draw a sequence diagram of the login'), { question: 'x', maxExamples: 0 }), { tier: 'cloud' });
    for (const q of ['Dibuja un diagrama de secuencia del inicio de sesión', '帮我画一个登录的时序图', 'ログインのシーケンス図を描いて']) {
      const out = ask(q);
      assert.equal(out.view, 'sequence', q);
      assert.equal(renderDiagramContract(diagramPromptSignals(out, { question: 'x', maxExamples: 0 }), { tier: 'cloud' }), english, q);
    }
  });

  test('swimlanes and a chart kind are carried through', () => {
    assert.equal(ask('画一个泳道图').layout, 'lanes');
    assert.equal(ask('Dibuja el proceso con carriles por equipo').layout, 'lanes');
    assert.equal(ask('Muéstrame un gráfico de barras de las ventas por mes').chartIntent, 'trend');
    assert.equal(ask('用饼图展示预算分配').chartIntent, 'breakdown');
  });

  test('a calculation asked for in another language is not told an input is missing', () => {
    // Which inputs a sentence states is read in English only; calling one
    // "missing" here would have the model ask for a number it was just given.
    const out = ask('Muéstrame una gráfica de la proyección de ingresos con 10000 al 5% mensual durante 12 meses');
    assert.equal(out.enabled, true);
    assert.equal(out.missingInput, undefined);
  });

  test('a follow-up carries the design, and an explanation does not redraw', () => {
    const update = ask('Añade una caché delante del servicio de pedidos', { activeDesign: DESIGN });
    assert.deepEqual([update.operation, update.attachActiveDesign, update.parentArtifactId, update.followUp], ['update', true, 'd.v1', 'weak']);
    assert.match(renderDiagramTurnBlock(update, DESIGN), /<active_design view="architecture"/);
    const explain = ask('为什么需要队列？', { activeDesign: DESIGN });
    assert.deepEqual([explain.operation, explain.output], ['explain', 'text-only']);
    const named = ask('Добавь кэш на схему', { activeDesign: { ...DESIGN, foreground: false } });
    assert.equal(named.followUp, 'strong');
  });

  test('the drawing\'s own labels are evidence, in any script', () => {
    // No design word from the lexicon: only the label says it is about the drawing.
    assert.equal(ask('Убери Очередь уведомлений', { activeDesign: DESIGN }).operation, 'update');
    assert.equal(ask('把订单数据库拆成两个', { activeDesign: DESIGN }).operation, 'update');
    assert.equal(ask('¿Por qué el Servicio de Pedidos habla directo con todo?', { activeDesign: DESIGN }).operation, 'explain');
  });

  test('"no diagram" anywhere in the turn holds for all of it', () => {
    for (const q of ['Dibuja la arquitectura. No, mejor sin diagrama.', '画一个架构图。算了，不要画图。', 'Нарисуй схему. Хотя нет, без схемы.', '構成図を描いて。やっぱり図はいらない。']) {
      assert.equal(ask(q).enabled, false, q);
    }
  });

  test('speech-to-text: no punctuation, no accents, full-width marks', () => {
    for (const q of ['puedes dibujar un diagrama de secuencia del login', 'disena un acortador de urls', 'нарисуй пожалуйста схему логина', '帮我画个登录流程图', 'ログインの流れを図にして', '画一个ＥＲ图！', 'アーキテクチャ図を描いてください？']) {
      assert.equal(ask(q).enabled, true, q);
    }
  });

  test('labels in these scripts pass the source policy', () => {
    for (const source of [
      'flowchart LR\n    gw["API-шлюз"] --> svc["Сервис заказов"]\n    svc --> q["Очередь уведомлений"]',
      'flowchart LR\n    gw["API 网关"] --> svc["订单服务"]\n    svc --> db[("订单数据库")]',
      'sequenceDiagram\n    participant U as ユーザー\n    participant A as 認証サービス\n    U->>A: ログイン要求\n    A-->>U: トークン',
      'flowchart TD\n    a["Inicio de sesión"] --> b{"¿Credenciales válidas?"}\n    b -->|"sí"| c["Emitir token"]\n    b -->|"no"| d["Mostrar error"]',
    ]) {
      assert.equal(checkDiagramSource(source).ok, true, source.slice(0, 40));
    }
  });

  test('nothing here can be made slow', () => {
    const design = { ...DESIGN };
    for (const q of ['Dibuja ' + 'el flujo '.repeat(400), '画'.repeat(2400), 'нарисуй '.repeat(300), 'を描いて'.repeat(600), 'el la '.repeat(400) + 'dibuja', '把'.repeat(1200) + '换成' + '图'.repeat(1000), 'por favor, '.repeat(250) + 'dibuja un diagrama', '用' + '图'.repeat(2300) + '表示', '図'.repeat(2400), 'схему '.repeat(400), 'un diagrama de '.repeat(160), 'añade ' + 'la cola, '.repeat(280), '加'.repeat(2400), 'なぜ'.repeat(1200)]) {
      const started = performance.now();
      resolveOtherLanguageRequest({ question: q, activeDesign: design });
      resolveOtherLanguageRequest({ question: q });
      assert.ok(performance.now() - started < 300, `${q.slice(0, 12)}… took ${Math.round(performance.now() - started)} ms`);
    }
  });
});

// ── the held-out measurement (2026-10-02) ───────────────────────────────────
// 388 sentences in the four languages by an independent reviewer who had not
// read the rules, frozen before they were run (SHA-256 7efd84c5…4220):
// 193 of 196 "must not" lines right (1.5% wrong) and 158 of 192 "must" lines
// right (17.7% missed; Chinese follow-ups 6 of 14). Its misses — and what the
// reviewer found afterwards, above all 書いて "write" being read as "draw" —
// drove a second pass. Now regression data.
describe('the four-language held-out sentences, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-2026-10-02.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  // The view the reviewer expected, where the rules deliberately differ.
  const OTHER_VIEW = new Map([
    ['Визуализируй квартальную выручку: 10, 14, 13 и 19 миллионов', '"visualise" names no kind of visual; a chart is one reading (the reviewer called this a judgement call)'],
  ]);

  for (const lang of ['es', 'ru', 'zh', 'ja']) {
    for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
      const rows = ROWS.filter((row) => row.lang === lang && row.expect === expect);
      test(`${lang} ${expect} (${rows.length})`, () => {
        const wrong = [];
        for (const row of rows) {
          const out = run(row);
          if (!right(row, out)) wrong.push(`${row.id} ${row.q} → ${out.enabled ? `${out.operation}/${out.view}` : 'off'}`);
          else if (row.expect === 'claim' && row.op && out.operation !== row.op) wrong.push(`${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
          else if (row.expect === 'draw' && row.view && out.view !== row.view && !OTHER_VIEW.has(row.q)) wrong.push(`${row.id} ${row.q} → ${out.view}, wanted ${row.view}`);
        }
        assert.deepEqual(wrong, []);
      });
    }
  }

  test('every one that drew or was claimed was read by these rules, not the English ones', () => {
    for (const row of ROWS) {
      const out = run(row);
      if (out.enabled) assert.equal(out.language, row.lang, row.q);
    }
  });
});

// ── the second held-out measurement (2026-10-02) ────────────────────────────
// 424 more sentences by another reviewer, frozen before the rules were run
// (SHA-256 de24e799…4267), measured on the rules as they stood after the first
// measurement's fixes: 205 of 212 "must not" lines right (3.3% wrong) and 171
// of 200 "must" lines right (14.5% missed); with the drawing's labels quoted,
// 5.2% and 9.5%. No line that must not be claimed would have redrawn a
// diagram. What it found: labels written without quotes were not read at all;
// in Chinese "我在上一家公司设计了计费系统" (I designed the billing system at my
// last company) drew a diagram; in Japanese a て-form in the middle of a
// past-tense sentence read as a request. Now regression data.
describe('the second four-language held-out set, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-2-2026-10-02.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  const KNOWN = new Map([
    ['Diseña un sistema de riego para el jardín de la oficina.', 'drawn: what is designed is a "sistema" (the reviewer marked this borderline and called the label arguable)'],
    ['Спроектируй систему полива для сада возле офиса.', 'drawn: the same sentence in Russian'],
    ['给办公室的花园设计一套灌溉系统。', 'drawn: the same sentence in Chinese'],
    ['オフィスの庭の散水システムを設計して。', 'drawn: the same sentence in Japanese'],
    ['土曜にテニスコートを予約したんだけど、一緒に行かない？', 'claimed: two words of one label ("court", "booking") in a question; answered in words with the design attached, never redrawn'],
  ]);

  for (const lang of ['es', 'ru', 'zh', 'ja']) {
    for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
      const rows = ROWS.filter((row) => row.lang === lang && row.expect === expect);
      test(`${lang} ${expect} (${rows.length})`, () => {
        const wrong = [];
        for (const row of rows) {
          const out = run(row);
          if (!right(row, out) && !KNOWN.has(row.q)) wrong.push(`${row.id} ${row.q} → ${out.enabled ? `${out.operation}/${out.view}` : 'off'}`);
          else if (right(row, out) && row.expect === 'claim' && row.op && out.operation !== row.op) wrong.push(`${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
        }
        assert.deepEqual(wrong, []);
      });
    }
  }

  test('no line that must not be claimed redraws a diagram', () => {
    const redraws = ROWS.filter((row) => row.expect === 'noclaim').filter((row) => { const out = run(row); return out.operation === 'update' && Boolean(out.parentArtifactId); }).map((row) => row.q);
    assert.deepEqual(redraws, []);
  });

  test('the exceptions are still exceptions', () => {
    for (const row of ROWS) if (KNOWN.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
  });
});

describe('what the second four-language measurement found', () => {
  const quoted = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    app["Aplicación móvil"] --> res["Servicio de Reservas"]\n    res --> cal[("Base de datos del calendario")]\n    res --> fac["Servicio de Facturas"]' };
  const unquoted = { ...quoted, source: 'flowchart LR\n    app[Aplicación móvil] --> res[Servicio de Reservas]\n    res --> cal[(Base de datos del calendario)]\n    res --> fac[Servicio de Facturas]' };

  test('labels are read with or without quotes', () => {
    for (const design of [quoted, unquoted]) {
      // The calendar is on the diagram, so an edit of its database stays on it…
      assert.equal(ask('Agregá una réplica de lectura a la base de datos del calendario.', { activeDesign: design }).operation, 'update');
      assert.equal(ask('Si se cae la base de datos del calendario, ¿qué pasa con las reservas?', { activeDesign: design }).operation, 'explain');
      // …and a label said whole is evidence by itself.
      assert.equal(ask('¿Por qué el Servicio de Reservas habla con todo?', { activeDesign: design }).operation, 'explain');
    }
  });

  test('one word shared with a longer label is not evidence, and never redraws', () => {
    for (const q of ['Cambia la factura de marzo.', '¿Por qué llegó tarde la factura del proveedor?', 'Añade la reunión al calendario.', '¿Qué pasa si el restaurante nos cancela la reserva?']) {
      assert.equal(Boolean(ask(q, { activeDesign: quoted }).parentArtifactId), false, q);
    }
    const ja = { artifactId: 'j.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    a["予約サービス"] --> b[("カレンダーのデータベース")]\n    a --> c["請求書と会費サービス"]' };
    for (const q of ['木曜の打ち合わせを私のカレンダーから消して', '来週のカレンダー、空いている日はありますか？', '仕入先からの請求書はどうしてこんなに遅れたんですか？']) {
      assert.equal(Boolean(ask(q, { activeDesign: ja }).parentArtifactId), false, q);
    }
    assert.equal(ask('カレンダーのデータベースに読み取りレプリカを足してください。', { activeDesign: ja }).operation, 'update');
    assert.equal(ask('請求書と会費サービスを二つに分けて。', { activeDesign: ja }).operation, 'update');
  });

  test('what happened is not a request: the past in Chinese and Japanese', () => {
    for (const q of ['我在上一家公司从零设计了计费系统。', '我以前设计过一个计费系统', '他们去年设计了一个新的支付系统', '佐藤さんが昨日、比較表を作ってお客様に送りました。', 'グラフを作って部長に見せたら怒られました', '引き続きコスト削減を図ってください。']) {
      assert.equal(ask(q, { mode: 'looking-for-work' }).enabled, false, q);
    }
    assert.equal(ask('帮我设计一个计费系统').view, 'architecture');
    assert.equal(ask('比較表を作ってください').view, 'matrix');
  });

  test('a long run of katakana is decided in milliseconds', () => {
    for (const q of ['ア'.repeat(2400), 'システム'.repeat(600), 'ー'.repeat(2400), `${'カ'.repeat(2390)}を設計して`]) {
      resolveOtherLanguageRequest({ question: q });
      const started = performance.now();
      resolveOtherLanguageRequest({ question: q });
      assert.ok(performance.now() - started < 100, `${q.slice(0, 6)}… took ${Math.round(performance.now() - started)} ms`);
    }
  });
});

// The third independent set (2026-10-02, 220 sentences, a veterinary clinic),
// written after an independent read of the rules had been acted on. Frozen
// result: 5 of 88 "must not" wrong (5.7%, one of which would have drawn), 35
// of 132 "must" missed (26.5%). The rules as they stood BEFORE that read,
// on the same sentences: 12 of 88 (13.6%, two would have drawn) and 36 of 132
// (27.3%). Its real defects were then fixed — verb forms ("me lo ponés",
// "necesitaría", "можно …?", "换成", 麻烦来一个), questions with no asking
// word in front, labels said shortened, an edit that adds a part named with an
// everyday word, questions about what was said — which is not measured.
// Now regression data.
describe('the third four-language held-out set, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-3-2026-10-02.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  const KNOWN = new Map([
    ['ru-A04', 'missed (borderline): "покажи, как устроен конвейер" names no kind of visual'],
  ]);

  test('the file is the one that was measured', async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const file = fileURLToPath(new URL('../../../../tests/diagram/i18n-heldout-3-2026-10-02.mjs', import.meta.url));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), 'c577228f52be67f1caaadff04d6da7d2542f84b4ca916771354ae9ac40079815');
    assert.equal(ROWS.length, 220);
  });

  for (const lang of ['es', 'ru', 'zh', 'ja']) {
    for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
      const rows = ROWS.filter((row) => row.lang === lang && row.expect === expect);
      test(`${lang} ${expect} (${rows.length})`, () => {
        const wrong = [];
        for (const row of rows) {
          const out = run(row);
          if (!right(row, out) && !KNOWN.has(row.id)) wrong.push(`${row.id} ${row.q} → ${out.enabled ? `${out.operation}/${out.view}` : 'off'}`);
          else if (right(row, out) && row.expect === 'claim' && row.op && out.operation !== row.op) wrong.push(`${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
          else if (right(row, out) && (row.expect === 'draw' || row.expect === 'claim') && row.view && out.view !== row.view) wrong.push(`${row.id} ${row.q} → ${out.view}, wanted ${row.view}`);
        }
        assert.deepEqual(wrong, []);
      });
    }
  }

  test('the known misses are still misses (a rule that starts meeting one should say so here)', () => {
    for (const [id] of KNOWN) {
      const row = ROWS.find((r) => r.id === id);
      assert.ok(row, id);
      assert.equal(right(row, run(row)), false, `${id} is now met: take it off the list`);
    }
  });

  test('no "must not" row draws or redraws', () => {
    const drawn = ROWS.filter((row) => (row.expect === 'nodraw' || row.expect === 'noclaim')).filter((row) => { const out = run(row); return out.enabled && out.operation !== 'explain'; });
    assert.deepEqual(drawn.map((row) => row.id), []);
  });
});

// ── three things left as found by the independent read (2026-10-02) ─────────
describe('a Spanish verb first, then who does it and what to, states what something does', async () => {
  const { FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-3-2026-10-02.mjs');
  const on = (q, ctx = 'arch_es_fg') => ask(q, { mode: 'team-meet', activeDesign: { ...FIXTURES[ctx] } });

  test('it is not an edit of the design in focus', () => {
    for (const q of ['Usa el cliente la API actualmente', 'usa el portal la pasarela de api o va directo', 'Añade el servicio la cabecera de autenticación']) {
      const out = on(q);
      assert.ok(!(out.enabled && out.operation === 'update'), `${q} → ${outcome(out)}`);
    }
  });

  test('asked with its mark, it is a question about the design', () => {
    const out = on('¿Usa el portal la pasarela de API?');
    assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, 'explain', true]);
  });

  test('the imperative is still an edit: one object, then a preposition or a measure', () => {
    for (const q of ['Usa el servicio de colas para los pedidos', 'usa la cola para los pedidos', 'usa una cola para los pedidos', 'mueve la cola un paso a la derecha', 'cambia la pasarela por un balanceador', 'añade la caché entre la pasarela y el servicio de citas']) {
      const out = on(q);
      assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, 'update', true], q);
    }
  });
});

describe('a Russian compound names the label it abbreviates', async () => {
  const { FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-3-2026-10-02.mjs');
  const on = (q, ctx = 'arch_ru_fg') => ask(q, { mode: 'team-meet', activeDesign: { ...FIXTURES[ctx] } });

  test('"медкарт" is the "База медицинских карт"', () => {
    for (const [q, operation] of [
      ['зачем аптеке доступ к базе медкарт', 'explain'],
      ['а медкарты где хранятся', 'explain'],
      ['добавь кэш перед медкартами', 'update'],
      ['ещё нужна база документов для рентгеновских снимков, добавь её рядом с медкартами', 'update'],
    ]) {
      const out = on(q);
      assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, operation, true], q);
    }
  });

  test('a word that only shares its first letters is not', () => {
    for (const q of ['медсестра сегодня не вышла, кто её заменит', 'медкомиссия назначена на вторник', 'медицинская страховка у нас до какого числа', 'надо купить карту памяти', 'техподдержка ответила клиенту?']) {
      const out = on(q);
      assert.ok(!out.enabled, `${q} → ${outcome(out)}`);
    }
  });

  test('out of focus the compound alone does not bring the design back', () => {
    assert.ok(!on('медкарты пациента потеряли в регистратуре, что делать', 'arch_ru_bg').enabled);
  });
});

describe('a lane of a swimlane diagram is one of its parts', () => {
  const lanes = (titles, steps) => ({
    artifactId: 'l.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true,
    source: `flowchart LR\n${titles.map((t, i) => `    subgraph ${t}\n        n${i}["${steps[i]}"]\n    end`).join('\n')}\n    n0 --> n1\n    n1 --> n2`,
  });
  const DIAGRAMS = {
    es: lanes(['Cliente', 'Soporte', 'Finanzas'], ['Pide el reembolso', 'Revisa la solicitud', 'Aprueba el pago']),
    ru: lanes(['Клиент', 'Поддержка', 'Финансы'], ['Запрос возврата', 'Проверка заявки', 'Одобрение выплаты']),
    zh: lanes(['客户', '客服', '财务'], ['申请退款', '审核申请', '批准付款']),
    ja: lanes(['顧客', 'サポート', '経理'], ['返金を依頼', '申請を確認', '支払いを承認']),
  };
  const on = (lang, q) => ask(q, { mode: 'team-meet', activeDesign: { ...DIAGRAMS[lang] } });

  test('called a lane, it is asked about or changed', () => {
    for (const [lang, q, operation] of [
      ['es', '¿qué hace el carril de Soporte?', 'explain'],
      ['es', 'añade un paso de pago en el carril de Finanzas', 'update'],
      ['ru', 'что делает дорожка поддержки?', 'explain'],
      ['ru', 'добавь шаг выплаты в дорожку финансов', 'update'],
      ['zh', '财务泳道是做什么的？', 'explain'],
      ['zh', '在客服泳道加一个回访步骤', 'update'],
      ['ja', '経理のレーンは何をしていますか', 'explain'],
      ['ja', 'サポートのレーンに確認ステップを追加して', 'update'],
    ]) {
      const out = on(lang, q);
      assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, operation, true], q);
    }
  });

  test('the department of that name, in everyday talk, is not the lane', () => {
    for (const [lang, q] of [
      ['es', '¿quién está en finanzas esta semana?'],
      ['es', 'en mi carril de la autopista había un atasco'],
      ['ru', 'кто сегодня в поддержке?'],
      ['zh', '财务这周谁值班？'],
      ['ja', '経理は今週誰がいますか'],
    ]) {
      const out = on(lang, q);
      assert.ok(!out.enabled, `${q} → ${outcome(out)}`);
    }
  });
});

// ── the fourth four-language measurement (2026-10-02) ───────────────────────
// 220 sentences written blind (a grocery-delivery domain). On the rules as
// they stood: 1 of 88 must-not rows wrong (it drew), 38 of 132 must rows
// missed. What follows is that set as regression data, and the rules the
// misses were for — each with the sentence it must NOT catch.
describe('the fourth four-language held-out set, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-4-2026-10-02.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q, featureEnabled: true, mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  const KNOWN = new Map([
    ['es-C04', 'missed: "lo del almacén … un pedido nuevo" names two parts by one word of each; in Spanish one word of a longer label is not evidence'],
  ]);

  test('the file is the one that was measured', async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const file = fileURLToPath(new URL('../../../../tests/diagram/i18n-heldout-4-2026-10-02.mjs', import.meta.url));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), 'c75d043eb1c0f3faaede529c5680100eecde929c446382bee2806e735ae2fb16');
    assert.equal(ROWS.length, 220);
  });

  for (const lang of ['es', 'ru', 'zh', 'ja']) {
    for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
      const rows = ROWS.filter((row) => row.lang === lang && row.expect === expect);
      test(`${lang} ${expect} (${rows.length})`, () => {
        const wrong = [];
        for (const row of rows) {
          const out = run(row);
          if (!right(row, out) && !KNOWN.has(row.id)) wrong.push(`${row.id} ${row.q} → ${out.enabled ? `${out.operation}/${out.view}` : 'off'}`);
          else if (right(row, out) && row.expect === 'claim' && row.op && out.operation !== row.op) wrong.push(`${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
          else if (right(row, out) && (row.expect === 'draw' || row.expect === 'claim') && row.view && out.view !== row.view) wrong.push(`${row.id} ${row.q} → ${out.view}, wanted ${row.view}`);
        }
        assert.deepEqual(wrong, []);
      });
    }
  }

  test('the known miss is still a miss (a rule that starts meeting it should say so here)', () => {
    for (const [id] of KNOWN) {
      const row = ROWS.find((r) => r.id === id);
      assert.ok(row, id);
      assert.equal(right(row, run(row)), false, `${id} is now met: take it off the list`);
    }
  });
});

describe('what the fourth four-language measurement found', async () => {
  const { FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-4-2026-10-02.mjs');
  const on = (q, ctx) => ask(q, { mode: 'team-meet', ...(ctx ? { activeDesign: { ...FIXTURES[ctx] } } : {}) });
  const expectAll = (rows) => {
    for (const [want, q, ctx] of rows) {
      const out = on(q, ctx);
      if (want === 'off') assert.ok(!out.enabled, `${q} → ${outcome(out)}`);
      else if (want === 'create') assert.deepEqual([out.enabled, out.operation], [true, 'create'], q);
      else assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, want, true], q);
    }
  };

  test('a request that starts late in a spoken sentence — and what is only told or described', () => {
    expectAll([
      ['create', 'oye después de la demo y con todo lo que vimos hoy me podés armar un diagrama de secuencia del login'],
      ['create', 'no me lo cuentes con palabras mostrámelo en un esquema cómo viaja un mensaje'],
      ['create', 'che armame un diagrama de flujo de cómo se aprueba una solicitud de vacaciones'],
      ['create', 'armemos un árbol de decisión para ver si nos conviene alquilar o comprar'],
      ['create', 'я запутался в этих статусах так что покажи диаграмму состояний заказа'],
      ['create', 'слушай а накидай-ка блок-схему как у нас проходит согласование отпуска'],
      ['create', 'сведи в табличку три тарифа чтобы было видно чем они отличаются'],
      ['create', '产品上线从一月到六月的关键节点 用时间轴给我理一下'],
      ['off', 'el informe de ayer muestra un gráfico de barras con las ventas'],
      ['off', 'le pedí a Juan que me arme un diagrama de flujo del proceso'],
      ['off', 'Ana me dijo que me hagas un diagrama pero no hace falta'],
      ['off', 'no sé si puedes ver el diagrama desde ahí'],
      ['off', 'en la reunión de ayer armamos un árbol de decisión y quedó bien'],
      ['off', 'начальник попросил сделай диаграмму к пятнице а я не успел'],
      ['off', 'он вчера сказал покажи график работы на следующую неделю'],
      ['off', 'ну давай схему метро посмотрим как доехать'],
      ['off', '我上一份工作主要负责画原型图和写需求文档'],
    ]);
  });

  test('what a part of the drawing should do is a change to it — only of the drawing', () => {
    expectAll([
      ['update', 'que pagos también mande un evento a la cola cuando se confirma el cobro', 'arch_es_fg'],
      ['update', 'mejor que la app no pase por el gateway para ver el catálogo, que vaya contra una CDN', 'arch_es_fg'],
      ['update', 'пусть платёжный сервис тоже пишет в очередь когда оплата прошла', 'arch_ru_fg'],
      ['update', '支付成功之后也让支付服务往队列里发一条消息', 'arch_zh_fg'],
      ['update', '決済が通ったら決済サービスからもキューにイベントを流すようにして', 'arch_ja_fg'],
      ['off', 'que la reunión pase al martes por favor', 'arch_es_fg'],
      ['off', 'que pagos mande el informe mañana', 'arch_es_fg'],
      ['off', 'пусть Маша тоже напишет клиенту завтра', 'arch_ru_fg'],
      ['off', '让客服也给顾客发一条消息', 'arch_zh_fg'],
      ['off', '让我先看一下数据库的配置', 'arch_zh_fg'],
      ['off', '明日までに資料を送るようにしてください', 'arch_ja_fg'],
    ]);
  });

  test('whether it holds up is asked of the design in focus', () => {
    expectAll([
      ['explain', 'esto aguanta el Black Friday o se nos cae por la base de datos', 'arch_es_fg'],
      ['explain', 'а это выдержит распродажу', 'arch_ru_fg'],
      ['explain', '高峰期这里面哪一块最容易成为瓶颈', 'arch_zh_fg'],
      ['explain', 'これ年末のセールに耐えられますか データベースで詰まりませんか', 'arch_ja_fg'],
      ['off', 'esto aguanta, la silla es nueva', 'arch_es_bg'],
      ['off', 'рубль опять упадёт на этой неделе', 'arch_ru_fg'],
    ]);
  });

  test('a verb of change after where it goes; a chart changed by its marks', () => {
    expectAll([
      ['update', 'después del reembolso agregá un paso para mandarle un cupón de disculpa', 'flow_es_fg'],
      ['update', 'после возврата денег добавь шаг отправить клиенту промокод с извинениями', 'flow_ru_fg'],
      ['update', 'cámbiale el nombre a la cola y ponle Kafka', 'arch_es_fg'],
      ['update', 'ordená las barras de mayor a menor', 'chart_es_fg'],
      ['update', 'отсортируй столбцы по убыванию', 'chart_ru_fg'],
      ['update', '把柱子按从高到低排一下', 'chart_zh_fg'],
      ['update', '棒を多い順に並べ替えて', 'chart_ja_fg'],
      ['off', 'после обеда добавь меня в календарь', 'flow_ru_fg'],
      ['off', 'после созвона добавь шаг в презентацию для клиента', 'flow_ru_fg'],
      ['off', 'después del almuerzo agrega una barra de chocolate al pedido', 'flow_es_fg'],
    ]);
  });

  test('parts named by what is distinctive in them, steps by their words, categories of one character', () => {
    expectAll([
      ['explain', '拣货那边是怎么知道有新订单的', 'arch_zh_fg'],
      ['explain', '倉庫のほうは新しい注文が来たことをどうやって知るんですか', 'arch_ja_fg'],
      ['explain', '要是顾客一直不回复接不接受替换 那怎么办', 'flow_zh_fg'],
      ['explain', '夕方が昼よりこんなに多いのはなぜですか', 'chart_ja_fg'],
      ['explain', '回到刚才那张架构图 骑手出发的时候是谁通知用户的', 'arch_zh_bg'],
      ['explain', 'volviendo al diagrama de antes, quién le avisa al cliente cuando sale el repartidor', 'arch_es_bg'],
      ['off', '订单的消息你看到了吗', 'arch_zh_fg'],
      ['off', '顾客今天接受采访了吗', 'flow_zh_fg'],
      ['off', '倉庫に注文した段ボールが届きました', 'arch_ja_fg'],
      ['off', '昼も夜も眠いですね', 'chart_ja_fg'],
      ['off', '我还是觉得今天太冷了', 'arch_zh_fg'],
    ]);
  });

  test('the same data as a table is a table of the chart on the table', () => {
    for (const [q, ctx] of [['同样的数据给我换成表格 列出时段和订单数', 'chart_zh_fg'], ['同じ内容を表にしてもらえますか 時間帯と注文数で', 'chart_ja_fg'], ['покажи это же таблицей интервалы и количество заказов', 'chart_ru_fg']]) {
      const out = on(q, ctx);
      assert.deepEqual([out.enabled, out.operation, out.view, Boolean(out.parentArtifactId)], [true, 'create', 'matrix', true], q);
    }
  });
});

// ── the fifth four-language measurement (2026-10-02) ────────────────────────
// 220 more blind sentences (a bike-share domain), written to be harder:
// regional speech (Colombian, Chilean, Kansai), nicknames for parts ("платёжка",
// "锁控"), edits in the vocabulary of drawing ("обведи рамкой", "点線にして"),
// requests split over two sentences. On the rules as they stood after the
// fixes that followed the fourth measurement: 8 of 88 must-not rows wrong
// (five drew), 50 of 132 must rows missed. The same sentences on the rules
// before those fixes: the same 8 wrong, 60 missed.
//
// The eight wrong ones were then fixed (below), and so was "not a chart — a
// table", which met two of the misses. The other forty-eight were NOT
// chased: three blind sets in a row missed 26%, 29% and 38%, and fixing the
// misses of one set recovered ten rows on the next. They are listed here so
// that nothing meets or loses one of them without saying so.
describe('the fifth four-language held-out set, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-5-2026-10-02.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q, featureEnabled: true, mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  const MISSED = 'es-A04 es-A05 es-A07 es-A09 es-C06 es-C07 es-D07 es-F01 ru-A03 ru-A07 ru-A08 ru-C01 ru-C03 ru-C05 ru-C06 ru-C07 ru-D03 ru-D04 ru-D05 ru-D06 ru-D07 ru-D08 ru-D09 ru-F02 zh-A03 zh-A05 zh-A10 zh-C02 zh-C05 zh-D02 zh-D03 zh-D08 zh-D09 zh-F02 zh-G02 ja-A05 ja-A10 ja-C03 ja-C05 ja-C07 ja-C08 ja-D02 ja-D03 ja-D05 ja-D07 ja-F01 ja-G01 ja-G02'.split(' ');

  test('the file is the one that was measured', async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const file = fileURLToPath(new URL('../../../../tests/diagram/i18n-heldout-5-2026-10-02.mjs', import.meta.url));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), '4c33937db6019eaf06cc4cb1a019e84b22ed806f92370317c38de4307fa5c3ba');
    assert.equal(ROWS.length, 220);
  });

  test('no must-not row draws, redraws or is attached (88)', () => {
    const wrong = ROWS.filter((row) => (row.expect === 'nodraw' || row.expect === 'noclaim') && !right(row, run(row))).map((row) => `${row.id} ${row.q}`);
    assert.deepEqual(wrong, []);
  });

  test('the must rows that are missed are exactly the forty-eight listed (132)', () => {
    const missed = ROWS.filter((row) => (row.expect === 'draw' || row.expect === 'claim') && !right(row, run(row))).map((row) => row.id);
    assert.deepEqual(missed, MISSED);
  });

  // Attached, or drawn, but as the wrong thing. Listed for the same reason.
  test('and seven more are met with the wrong operation or kind of drawing', () => {
    const SHAPE = ['es-A10', 'es-D08', 'es-D09', 'ru-A06', 'zh-A06', 'zh-D05', 'ja-A07'];
    const off = ROWS.filter((row) => {
      const out = run(row);
      if (!(row.expect === 'draw' || row.expect === 'claim') || !right(row, out)) return false;
      return (row.expect === 'claim' && row.op && out.operation !== row.op) || (row.view && out.view !== row.view);
    }).map((row) => row.id);
    assert.deepEqual(off, SHAPE);
  });
});

// "Show the chart as a table comes back as a chart", said the way people say
// it: by turning the chart down. "グラフじゃなくて表で見たい" drew a new chart
// (the first visual named won), and "不要图表，换成表格" drew nothing ("no
// chart" was read as "no drawing").
describe('a visual turned down is not the one asked for', async () => {
  const { FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-5-2026-10-02.mjs');
  const on = (q, ctx) => ask(q, { mode: 'team-meet', ...(ctx ? { activeDesign: { ...FIXTURES[ctx] } } : {}) });

  test('with the chart in focus, the table is of the chart', () => {
    for (const [q, ctx] of [
      ['グラフやなくて表で見たいわ、同じ数字で', 'chart_ja_fg'],
      ['グラフじゃなくて表で見たいです', 'chart_ja_fg'],
      ['グラフではなく表にしてください', 'chart_ja_fg'],
      ['这个别用图了，给我列成表格吧', 'chart_zh_fg'],
      ['不要图表，换成表格', 'chart_zh_fg'],
      ['А можно те же цифры таблицей, без столбиков?', 'chart_ru_fg'],
      ['no quiero el gráfico, pásamelo a una tabla', 'chart_es_fg'],
    ]) {
      const out = on(q, ctx);
      assert.deepEqual([out.enabled, out.operation, out.view, Boolean(out.parentArtifactId)], [true, 'create', 'matrix', true], q);
    }
  });

  test('with nothing on the table, the other visual is drawn', () => {
    for (const [q, view] of [
      ['図じゃなくて表にしてください、3つのプランの違いを', 'matrix'],
      ['en vez de un diagrama hazme una tabla comparativa de los tres planes', 'matrix'],
      ['вместо диаграммы сделай сравнительную таблицу трёх тарифов', 'matrix'],
      ['不要表格，给我画一个流程图', 'flowchart'],
    ]) {
      const out = on(q);
      assert.deepEqual([out.enabled, out.operation, out.view], [true, 'create', view], q);
    }
  });

  test('turned down with nothing asked instead, it is still "no drawing"', () => {
    for (const [q, ctx] of [
      ['図じゃなくて言葉で説明してください'],
      ['不要图表，直接说结论'],
      ['no quiero un diagrama, explícamelo con palabras'],
      ['не надо диаграмм, объясни словами'],
      ['グラフはいらないです、数字だけ教えてください', 'chart_ja_fg'],
      ['这个不用了，谢谢', 'chart_zh_fg'],
    ]) {
      const out = on(q, ctx);
      assert.ok(!out.enabled, `${q} → ${outcome(out)}`);
    }
  });
});

describe('what the fifth four-language measurement found: told is not asked', async () => {
  const { FIXTURES } = await import('../../../../tests/diagram/i18n-heldout-5-2026-10-02.mjs');
  const on = (q, ctx) => ask(q, { mode: 'team-meet', ...(ctx ? { activeDesign: { ...FIXTURES[ctx] } } : {}) });

  test('quoted as said, asked of the speaker, the speaker\'s own plan, a word that only looks like one', () => {
    for (const [q, ctx] of [
      ['我妈让我给她画个去医院的路线，她不会用导航'],
      ['老板叫我画一个架构图，我还没画'],
      ['回头我自己用Excel做个柱状图发群里，你们不用管', 'chart_zh_fg'],
      ['お客さんに「図で説明して」って言われたんですけど、電話口じゃ無理ですよね。'],
      ['グラフは来週の資料を作るときに私のほうでまとめて作りますので、今日は数字だけ確認させてください。'],
      ['図々しいお願いで恐縮ですが、納期を一週間だけ延ばしていただけないでしょうか。', 'arch_ja_fg'],
      ['Олег в начале созвона называл цифру по списанию за прошлый год — сколько там было?', 'flow_ru_fg'],
      ['网关那个项目的负责人是不是换人了？', 'arch_zh_fg'],
      ['骑行次数多了膝盖会不会受不了啊，我最近天天骑车上班', 'chart_zh_fg'],
    ]) {
      const out = on(q, ctx);
      assert.ok(!out.enabled, `${q} → ${outcome(out)}`);
    }
  });

  test('the same forms, asked, are still requests', () => {
    for (const q of [
      '図で説明してください',
      '図で説明してと言われたので、ログインの流れを図にしてください',
      'グラフにまとめてください、月別の売上を',
      '売上の推移を表でまとめてもらえますか',
      '帮我画个去医院的路线图',
      '请给我画一个登录流程图',
      '你帮我做个柱状图，把这几个月的销量放进去',
      '我想要一个柱状图看看每周的订单',
    ]) {
      const out = on(q);
      assert.deepEqual([out.enabled, out.operation], [true, 'create'], q);
    }
    for (const [q, ctx] of [['сколько шагов до списания велосипеда?', 'flow_ru_fg'], ['周五为什么比周六低这么多？', 'chart_zh_fg'], ['网关后面为什么要加一个队列', 'arch_zh_fg']]) {
      const out = on(q, ctx);
      assert.deepEqual([out.enabled, out.operation, Boolean(out.parentArtifactId)], [true, 'explain', true], q);
    }
  });
});

