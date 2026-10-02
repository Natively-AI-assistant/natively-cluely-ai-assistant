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
    ['es-C09', 'missed (borderline): "y esto aguanta la campaña…" names nothing of the drawing but "esto"'],
    ['ru-A04', 'missed (borderline): "покажи, как устроен конвейер" names no kind of visual'],
    ['ru-C03', 'missed: "к базе медкарт" abbreviates the label "База медицинских карт"; one word of it is not evidence'],
    ['ru-C09', 'missed (borderline): "а оно вообще выдержит…" names nothing of the drawing but "оно"'],
    ['ru-D06', 'missed: the same abbreviation ("рядом с медкартами")'],
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
