// electron/services/__tests__/DiagramPhoneAndSession2026_10_01.test.mjs
//
// Diagrams outside the overlay: the Phone Mirror, export, and what the shared
// session tracker remembers.
//
// PHONE. The main process has no DOM, so it cannot draw Mermaid. It asks an app
// window to, and re-checks what comes back before the phone sees it
// (PhoneDiagramBroker). Pinned here: only the window that was asked may answer,
// only for a pending request, only with an inert SVG; a late, replayed or
// unsafe result is dropped; and the phone only ever receives an <img> data URL.
//
// EXPORT. The handler writes bytes a renderer produced, so the payload is
// validated in the main process: a safe SVG, a real PNG, bounded Mermaid text,
// and a file name that is legal on macOS and Windows alike.
//
// SESSION. One active design shared by every route that records an answer;
// cleared with the session; a repair replaces only the exact broken source.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;
const { PhoneDiagramBroker, PHONE_DIAGRAM_TIMEOUT_MS, PHONE_DIAGRAM_CACHE_MAX, phoneDiagramDataUrl } = await import(dist('services/diagram/PhoneDiagramBroker.js'));
const { renderPhoneAnswer, setPhoneDiagramProvider } = await import(dist('services/phoneMirrorMarkdown.js'));
const { PHONE_MIRROR_HTML } = await import(dist('services/phoneMirrorClient.js'));
const { safeDiagramFileStem, uniqueDiagramFileName, diagramExportBytes } = await import(dist('services/diagram/diagramExport.js'));
const { SessionTracker } = await import(dist('SessionTracker.js'));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M0 0L10 10"/><text>Queue</text></svg>';
const SOURCE = 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]';
const fence = (src, tag = 'mermaid') => '```' + tag + '\n' + src + '\n```';

function harness() {
  const sent = [];
  const settled = [];
  const timers = [];
  let now = 1000;
  const broker = new PhoneDiagramBroker({
    pickTarget: () => ({ id: 7, send: (channel, payload) => sent.push({ channel, payload }) }),
    onSettled: (key, dataUrl) => settled.push({ key, dataUrl }),
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
  });
  return { broker, sent, settled, timers, advance: (ms) => { now += ms; } };
}

describe('PhoneDiagramBroker', () => {
  test('asks an app window once per diagram, and caches what it draws', () => {
    const h = harness();
    const key = h.broker.key(SOURCE);
    h.broker.request(key, SOURCE);
    h.broker.request(key, SOURCE);
    assert.equal(h.sent.length, 1, 'a second request while pending is not sent');
    assert.equal(h.sent[0].channel, 'diagram:render-request');
    assert.deepEqual(Object.keys(h.sent[0].payload).sort(), ['key', 'requestId', 'source']);
    assert.equal(h.broker.lookup(key), undefined);

    assert.equal(h.broker.receive(7, { requestId: h.sent[0].payload.requestId, key, ok: true, svg: SVG }), true);
    assert.equal(h.broker.lookup(key), phoneDiagramDataUrl(SVG));
    assert.deepEqual(h.settled, [{ key, dataUrl: phoneDiagramDataUrl(SVG) }]);
    assert.equal(h.timers[0].cleared, true);
    h.broker.request(key, SOURCE);
    assert.equal(h.sent.length, 1, 'a drawn diagram is never asked for again');
  });

  test('only the window that was asked may answer', () => {
    const h = harness();
    const key = h.broker.key(SOURCE);
    h.broker.request(key, SOURCE);
    const { requestId } = h.sent[0].payload;
    assert.equal(h.broker.receive(99, { requestId, key, ok: true, svg: SVG }), false);
    assert.equal(h.broker.lookup(key), undefined);
    assert.equal(h.settled.length, 0, 'the pending request is still open for the real window');
    assert.equal(h.broker.receive(7, { requestId, key, ok: true, svg: SVG }), true);
  });

  test('an unknown, replayed or mismatched result is dropped', () => {
    const h = harness();
    const key = h.broker.key(SOURCE);
    h.broker.request(key, SOURCE);
    const { requestId } = h.sent[0].payload;
    assert.equal(h.broker.receive(7, { requestId: 'pd-999', key, ok: true, svg: SVG }), false);
    assert.equal(h.broker.receive(7, { requestId, key: 'other-key', ok: true, svg: SVG }), false);
    assert.equal(h.broker.receive(7, null), false);
    assert.equal(h.broker.receive(7, { requestId, key, ok: true, svg: SVG }), true);
    assert.equal(h.broker.receive(7, { requestId, key, ok: true, svg: SVG.replace('Queue', 'Replayed') }), false, 'a replay cannot overwrite the drawing');
    assert.ok(decodeURIComponent(h.broker.lookup(key)).includes('Queue'));
  });

  test('an unsafe or oversized SVG is refused and the diagram is marked failed', () => {
    for (const bad of [
      SVG.replace('<path', '<script>alert(1)</script><path'),
      SVG.replace('<text>', '<foreignObject><div>x</div></foreignObject><text>'),
      SVG.replace('<path', '<image href="https://example.com/x.png"/><path'),
      '<div>not svg</div>',
      '<svg>' + 'x'.repeat(500_000) + '</svg>',
      42,
    ]) {
      const h = harness();
      const key = h.broker.key(SOURCE);
      h.broker.request(key, SOURCE);
      assert.equal(h.broker.receive(7, { requestId: h.sent[0].payload.requestId, key, ok: true, svg: bad }), false);
      assert.equal(h.broker.lookup(key), undefined);
      assert.equal(h.broker.failed(key), true);
      assert.deepEqual(h.settled, [{ key, dataUrl: null }]);
    }
  });

  test('a window that reports failure, and a window that never answers, both settle as failed', () => {
    const a = harness();
    const key = a.broker.key(SOURCE);
    a.broker.request(key, SOURCE);
    a.broker.receive(7, { requestId: a.sent[0].payload.requestId, key, ok: false });
    assert.equal(a.broker.failed(key), true);

    const b = harness();
    b.broker.request(key, SOURCE);
    assert.equal(b.timers[0].ms, PHONE_DIAGRAM_TIMEOUT_MS);
    b.timers[0].fn();
    assert.equal(b.broker.failed(key), true);
    assert.deepEqual(b.settled, [{ key, dataUrl: null }]);
    // The late answer after the timeout is not accepted.
    assert.equal(b.broker.receive(7, { requestId: b.sent[0].payload.requestId, key, ok: true, svg: SVG }), false);
  });

  test('a failed diagram is not retried until the failure window passes', () => {
    const h = harness();
    const key = h.broker.key(SOURCE);
    h.broker.request(key, SOURCE);
    h.broker.receive(7, { requestId: h.sent[0].payload.requestId, key, ok: false });
    h.broker.request(key, SOURCE);
    assert.equal(h.sent.length, 1);
    h.advance(61_000);
    h.broker.request(key, SOURCE);
    assert.equal(h.sent.length, 2);
  });

  // Found in review: this used to leave the diagram pending for ever, so the
  // phone showed "Drawing diagram…" and never the source.
  test('no window to draw with: the diagram fails, and the phone shows its source', () => {
    const settled = [];
    const broker = new PhoneDiagramBroker({ pickTarget: () => null, onSettled: (k, d) => settled.push([k, d]) });
    const key = broker.key(SOURCE);
    broker.request(key, SOURCE);
    assert.deepEqual(settled, [[key, null]]);
    assert.equal(broker.failed(key), true);
    setPhoneDiagramProvider({ enabled: () => true, lookup: (k) => broker.lookup(k), failed: (k) => broker.failed(k), request: (k, src) => broker.request(k, src) });
    try {
      const { html } = renderPhoneAnswer(fence(SOURCE));
      assert.match(html, /class="diagram is-failed"/);
      assert.doesNotMatch(html, /Drawing diagram/);
    } finally {
      setPhoneDiagramProvider(null);
    }
  });

  test('a diagram that fails on the spot is never announced as "drawing"', () => {
    const fresh = 'flowchart LR\n    fresh["Fresh node"] --> other["Other node"]';
    const broker = new PhoneDiagramBroker({ pickTarget: () => null, onSettled: () => undefined });
    setPhoneDiagramProvider({ enabled: () => true, lookup: (k) => broker.lookup(k), failed: (k) => broker.failed(k), request: (k, src) => broker.request(k, src) });
    try {
      const { html } = renderPhoneAnswer(fence(fresh));
      assert.match(html, /class="diagram is-failed"/);
      assert.match(html, /<details class="diagram-source" open>/);
      assert.doesNotMatch(html, /Drawing diagram/);
    } finally {
      setPhoneDiagramProvider(null);
    }
  });

  test('a window that does not answer: the other window is asked, then it fails', () => {
    const sent = [];
    const settled = [];
    const timers = [];
    const asked = [];
    const broker = new PhoneDiagramBroker({
      pickTarget: (tried = []) => {
        asked.push([...tried]);
        const id = [7, 9].find((candidate) => !tried.includes(candidate));
        return id === undefined ? null : { id, send: (channel, payload) => sent.push({ id, channel, payload }) };
      },
      onSettled: (key, dataUrl) => settled.push({ key, dataUrl }),
      setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
      clearTimer: (t) => { t.cleared = true; },
    });
    const key = broker.key(SOURCE);
    broker.request(key, SOURCE);
    assert.deepEqual(sent.map((m) => m.id), [7]);
    timers[0].fn(); // the launcher never answered
    assert.deepEqual(sent.map((m) => m.id), [7, 9], 'the overlay is asked next');
    assert.equal(settled.length, 0);
    // A late answer from the first window is not accepted for the second request.
    assert.equal(broker.receive(7, { requestId: sent[1].payload.requestId, key, ok: true, svg: SVG }), false);
    assert.equal(broker.receive(9, { requestId: sent[1].payload.requestId, key, ok: true, svg: SVG }), true);
    assert.equal(settled.length, 1);
    assert.ok(broker.lookup(key));

    const other = 'flowchart LR\n    lonely["Lonely"] --> gone["Gone"]';
    const otherKey = broker.key(other);
    broker.request(otherKey, other);
    timers[2].fn();
    timers[3].fn(); // neither window answered
    assert.equal(broker.failed(otherKey), true);
    assert.equal(sent.length, 4, 'two windows, and no third try');
  });

  test('the cache is bounded', () => {
    const h = harness();
    for (let i = 0; i < PHONE_DIAGRAM_CACHE_MAX + 5; i += 1) {
      const src = `${SOURCE}\n    n${i} --> worker`;
      const key = h.broker.key(src);
      h.broker.request(key, src);
      h.broker.receive(7, { requestId: h.sent[h.sent.length - 1].payload.requestId, key, ok: true, svg: SVG });
    }
    assert.equal(h.broker.lookup(h.broker.key(`${SOURCE}\n    n0 --> worker`)), undefined, 'the oldest drawing was evicted');
    assert.ok(h.broker.lookup(h.broker.key(`${SOURCE}\n    n${PHONE_DIAGRAM_CACHE_MAX + 4} --> worker`)));
  });
});

describe('phone answer rendering', () => {
  const requests = [];
  let images = new Map();
  let failed = new Set();
  let enabled = true;
  beforeEach(() => {
    requests.length = 0;
    images = new Map();
    failed = new Set();
    enabled = true;
    setPhoneDiagramProvider({
      enabled: () => enabled,
      lookup: (key) => images.get(key),
      failed: (key) => failed.has(key),
      request: (key, source) => requests.push({ key, source }),
    });
  });
  const answer = `I'd queue every send.\n\n${fence(SOURCE)}\n\nThe worker owns delivery.`;

  test('a complete diagram not yet drawn: a pending figure, the source underneath, and ONE render request', () => {
    const { html } = renderPhoneAnswer(answer);
    assert.match(html, /<figure class="diagram is-pending" data-diagram="[a-z0-9-]+" data-label="Diagram">/);
    assert.match(html, /Drawing diagram…/);
    assert.match(html, /<details class="diagram-source"><summary>Mermaid source<\/summary><div class="codeblock" data-lang="mermaid">/);
    assert.ok(html.includes('producer[&quot;Producer Service&quot;] --&gt; queue'), 'the source is escaped as text');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].source, SOURCE);
    assert.ok(html.includes('The worker owns delivery.'));
  });

  test('once drawn, the picture is an <img> with a data URL — never inline SVG', () => {
    const first = renderPhoneAnswer(answer);
    const key = /data-diagram="([^"]+)"/.exec(first.html)[1];
    images.set(key, phoneDiagramDataUrl(SVG));
    requests.length = 0;
    const { html } = renderPhoneAnswer(answer);
    assert.match(html, /<figure class="diagram is-ready"/);
    assert.match(html, /<img class="diagram-img" alt="Diagram" src="data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    assert.ok(!/<svg[\s>]/.test(html), 'no SVG markup is ever placed in the page');
    assert.equal(requests.length, 0);
  });

  test('a provider that returns anything but an SVG data URL is ignored', () => {
    const first = renderPhoneAnswer(answer);
    const key = /data-diagram="([^"]+)"/.exec(first.html)[1];
    for (const bogus of ['javascript:alert(1)', 'https://example.com/x.svg', 'data:text/html,<script>1</script>', '"><script>alert(1)</script>']) {
      images.set(key, bogus);
      const { html } = renderPhoneAnswer(answer);
      assert.ok(!html.includes('<img class="diagram-img"'), bogus);
      assert.ok(!html.includes('<script>'), bogus);
    }
  });

  test('a diagram that could not be drawn says so and opens its source', () => {
    const first = renderPhoneAnswer(answer);
    failed.add(/data-diagram="([^"]+)"/.exec(first.html)[1]);
    const { html } = renderPhoneAnswer(answer);
    assert.match(html, /<figure class="diagram is-failed"/);
    assert.match(html, /could not be drawn here/);
    assert.match(html, /<details class="diagram-source" open>/);
  });

  test('while the block is still streaming nothing is requested', () => {
    const partial = `I'd queue every send.\n\n\`\`\`mermaid\nflowchart LR\n    producer["Producer Service"] --> que`;
    const { html } = renderPhoneAnswer(partial, { streaming: true });
    assert.match(html, /Generating diagram…/);
    assert.ok(!html.includes('data-diagram='));
    assert.equal(requests.length, 0);
    // The closing fence half-arrived is still not complete.
    renderPhoneAnswer(`Lead.\n\n\`\`\`mermaid\n${SOURCE}\n\`\``, { streaming: true });
    assert.equal(requests.length, 0);
    renderPhoneAnswer(`Lead.\n\n${fence(SOURCE)}\nMore prose still stre`, { streaming: true });
    assert.equal(requests.length, 1, 'requested as soon as the block is complete, while prose still streams');
  });

  test('a policy-rejected block is explained, never requested', () => {
    const { html } = renderPhoneAnswer(`Lead.\n\n${fence('flowchart LR\n    a["<script>alert(1)</script>"] --> b')}`);
    assert.match(html, /<figure class="diagram is-failed">/);
    assert.match(html, /contains HTML, which is not allowed/);
    assert.equal(requests.length, 0);
    assert.ok(!html.includes('<script>alert'));
  });

  test('"mermaid source" stays a code block; ordinary code is untouched', () => {
    const sourceOnly = renderPhoneAnswer(fence(SOURCE, 'mermaid source'));
    assert.ok(!sourceOnly.html.includes('<figure'));
    assert.match(sourceOnly.html, /<div class="codeblock" data-lang="mermaid">/);
    const code = renderPhoneAnswer(fence('print(1)', 'python'));
    assert.match(code.html, /^<div class="codeblock" data-lang="python">/);
    assert.equal(requests.length, 0);
  });

  test('switched off, or with no provider, a Mermaid block is the code block it always was', () => {
    enabled = false;
    const off = renderPhoneAnswer(answer).html;
    assert.ok(!off.includes('<figure'));
    assert.match(off, /<div class="codeblock" data-lang="mermaid">/);
    setPhoneDiagramProvider(null);
    assert.equal(renderPhoneAnswer(answer).html, off);
    assert.equal(requests.length, 0);
  });

  test('the phone page handles the diagram event, sets pictures only as image sources, and stays inside its template rules', () => {
    assert.match(PHONE_MIRROR_HTML, /case 'diagram': onDiagram\(ev\); break;/);
    const onDiagram = PHONE_MIRROR_HTML.slice(PHONE_MIRROR_HTML.indexOf('function applyDiagrams'), PHONE_MIRROR_HTML.indexOf('function enhanceCode'));
    assert.match(onDiagram, /ev\.src\.indexOf\('data:image\/svg\+xml;charset=utf-8,'\) === 0/);
    assert.match(onDiagram, /img\.src = src;/);
    assert.ok(!/innerHTML/.test(onDiagram), 'no markup is injected for a diagram');
    assert.match(PHONE_MIRROR_HTML, /enhanceCode\(body\);\s*applyDiagrams\(body\);/);
  });
});

describe('export payload validation', () => {
  test('file names are legal on macOS and Windows', () => {
    assert.equal(safeDiagramFileStem('sequence-diagram'), 'sequence-diagram');
    assert.equal(safeDiagramFileStem('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
    assert.equal(safeDiagramFileStem('..'), 'diagram');
    assert.equal(safeDiagramFileStem('name. '), 'name');
    assert.equal(safeDiagramFileStem('CON'), 'diagram-CON');
    assert.equal(safeDiagramFileStem('lpt1'), 'diagram-lpt1');
    // Found in review: a device name is reserved with any extension.
    for (const name of ['con.v2', 'NUL.txt', 'LPT1.final', 'COM0', 'CONIN$', 'conout$', 'aux.backup.2', 'COM\u00b9']) {
      assert.match(safeDiagramFileStem(name), /^diagram-/, name);
    }
    assert.equal(safeDiagramFileStem('console'), 'console');
    assert.equal(safeDiagramFileStem('contract.v2'), 'contract.v2');
    // No hidden file on macOS, no trailing dot or space for Windows to drop.
    assert.equal(safeDiagramFileStem('.env'), 'env');
    assert.equal(safeDiagramFileStem(' ..hidden. '), 'hidden');
    assert.doesNotMatch(safeDiagramFileStem(`${'x'.repeat(59)}. tail`), /[. ]$/);
    assert.equal(safeDiagramFileStem(''), 'diagram');
    assert.equal(safeDiagramFileStem(undefined), 'diagram');
    assert.ok(safeDiagramFileStem('x'.repeat(300)).length <= 60);
  });

  test('a silent save never reuses a name that exists', () => {
    const taken = new Set(['a.svg']);
    assert.equal(uniqueDiagramFileName('a', 'svg', (n) => taken.has(n)), 'a (2).svg');
    assert.equal(uniqueDiagramFileName('b', 'svg', (n) => taken.has(n)), 'b.svg');
    // Hundreds of copies: the old loop gave up and returned a name that existed.
    const many = new Set(['a.svg', ...Array.from({ length: 600 }, (_v, i) => `a (${i + 2}).svg`)]);
    const name = uniqueDiagramFileName('a', 'svg', (n) => many.has(n), () => 1_700_000_000_000);
    assert.equal(many.has(name), false);
    assert.match(name, /^a [a-z0-9]+\.svg$/);
  });

  test('SVG: only an inert drawing is written', () => {
    assert.ok(diagramExportBytes('svg', SVG));
    assert.equal(diagramExportBytes('svg', SVG.replace('<path', '<script>1</script><path')), null);
    assert.equal(diagramExportBytes('svg', '<html></html>'), null);
  });

  test('PNG: base64 of a real PNG, bounded', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    assert.deepEqual(diagramExportBytes('png', png.toString('base64')), png);
    assert.equal(diagramExportBytes('png', Buffer.from('GIF89a..........').toString('base64')), null);
    assert.equal(diagramExportBytes('png', 'not base64 !!'), null);
    assert.equal(diagramExportBytes('png', ''), null);
  });

  test('Mermaid source: bounded text, normalised newline at the end', () => {
    assert.equal(diagramExportBytes('mmd', 'flowchart LR\r\n  a --> b').toString('utf8'), 'flowchart LR\n  a --> b\n');
    assert.equal(diagramExportBytes('mmd', 'x'.repeat(20_000)), null);
  });

  test('unknown formats and non-strings are refused', () => {
    assert.equal(diagramExportBytes('exe', SVG), null);
    assert.equal(diagramExportBytes('svg', { toString: () => SVG }), null);
    assert.equal(diagramExportBytes(undefined, undefined), null);
  });
});

describe('SessionTracker: the design on the table', () => {
  const V1 = SOURCE;
  const V2 = SOURCE + '\n    worker --> dlq["Dead-Letter Queue"]';
  const answer = (lead, src) => `${lead}\n\n${fence(src)}\n\nExplanation of the design follows here.`;

  test('one design, whichever surface recorded the answer', () => {
    const s = new SessionTracker();
    assert.equal(s.getActiveDesign(), null);
    s.addAssistantMessage(answer('From typed chat.', V1), undefined, 'manual_chat');
    assert.equal(s.getActiveDesign().source, V1);
    s.addAssistantMessage(answer('From What to Answer.', V2), undefined, 'what_to_answer');
    const d = s.getActiveDesign();
    assert.equal(d.source, V2);
    assert.equal(d.version, 2);
    assert.equal(d.parentArtifactId, 'design-1.v1');
  });

  test('an answer that was not stored never becomes the design', () => {
    const s = new SessionTracker();
    s.addAssistantMessage(answer('Blocked by policy.', V1), { policy: 'do_not_store' }, 'what_to_answer');
    assert.equal(s.getActiveDesign(), null);
  });

  test('cleared by a mode switch, a reset and an explicit clear', () => {
    const s = new SessionTracker();
    s.addAssistantMessage(answer('One.', V1), undefined, 'what_to_answer');
    s.clearSessionContext();
    assert.equal(s.getActiveDesign(), null);
    s.addAssistantMessage(answer('Two.', V1), undefined, 'what_to_answer');
    s.reset();
    assert.equal(s.getActiveDesign(), null);
    s.addAssistantMessage(answer('Three.', V1), undefined, 'what_to_answer');
    s.clearActiveDesign();
    assert.equal(s.getActiveDesign(), null);
  });

  test('a repair replaces the exact broken source everywhere it was recorded, and nothing else', () => {
    const s = new SessionTracker();
    const broken = 'flowchart LR\n    producer["Producer Service" --> queue[Notification Queue';
    const other = answer('An earlier, unrelated answer.', V1);
    s.addAssistantMessage(other, undefined, 'what_to_answer');
    s.logUsage('assist', 'Design one', other);
    const bad = answer('The broken one.', broken);
    s.addAssistantMessage(bad, undefined, 'what_to_answer');
    s.logUsage('assist', 'Design two', bad);

    assert.equal(s.applyDiagramRepair('flowchart LR\n    not --> recorded', V2), false, 'an unknown source changes nothing');
    assert.equal(s.applyDiagramRepair(broken, V2), true);
    assert.ok(s.getLastAssistantMessage().includes(fence(V2)));
    assert.ok(!s.getLastAssistantMessage().includes('queue[Notification Queue'));
    const usage = s.getFullUsage();
    assert.equal(usage[0].answer, other, 'the other answer is untouched');
    assert.ok(usage[1].answer.includes(fence(V2)));
    assert.ok(usage[1].answer.startsWith('The broken one.'), 'the prose of the repaired answer is kept');
  });
});
