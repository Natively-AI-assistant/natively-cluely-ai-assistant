// electron/services/__tests__/PhoneMirrorAutoAnswer2026_11_05.test.mjs
//
// Customer report (2026-11-05): with the phone paired by QR code, "when you
// provide answers it only displays on the laptop screen, not on the mobile
// device". Only the button IPC handlers published to the phone, and only once
// their call returned:
//  - Auto Answer (the engine answering on its own) never reached the phone;
//  - every answer reached it only when finished, while the overlay streamed it;
//  - negotiation coaching cards, corrected code and Direct Assist never did.
//
// main.ts now wires the engine's own events to the phone
// (phoneMirrorLiveAnswers.wireLiveAnswersToPhone), streamed and labelled like
// the button they answer. A button's IPC handler runs its engine call as a
// press (startPhonePress) and publishes its own copy only when that press's
// answer did not reach the phone that way.
// ipcHandlers mirrors Direct Assist (mirrorDirectAssistToPhone). Several
// answers can stream at once, so the service keeps one live stream per id.
//
// Pinned against the REAL service over a real socket, same electron stub and
// 4123-4134 port guard as the other PhoneMirror tests. Platform-agnostic
// (loopback ws, main-process wiring); same on macOS and Windows.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;
const http = require('node:http');

const dist = (f) => path.resolve(repoRoot, 'dist-electron/electron/services', f);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-auto-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
const originalListen = http.Server.prototype.listen;
let svc;
let live;
let port = 0;
let token = '';
let engine;
let mirror;

before(async () => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  http.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number' && args[0] >= 4123 && args[0] < 4135) {
      process.nextTick(() => this.emit('error', Object.assign(new Error('taken (test)'), { code: 'EADDRINUSE' })));
      return this;
    }
    return originalListen.apply(this, args);
  };
  svc = (await import(pathToFileURL(dist('PhoneMirrorService.js')).href)).PhoneMirrorService.getInstance();
  live = require(dist('phoneMirrorLiveAnswers.js'));
});

after(async () => {
  mirror?.dispose();
  if (svc?.isRunning()) await svc.stop({ persist: false });
  Module._load = originalLoad;
  http.Server.prototype.listen = originalListen;
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  mirror?.dispose();
  if (svc.isRunning()) await svc.stop({ persist: false });
  svc.setAnswerRenderer(null);
  svc.history = [];
  svc.liveStreams.clear();
  svc.publishMeetingState(false);
  const info = await svc.start({ exposeOnLan: false, persist: false });
  port = info.port;
  token = info.token;
  engine = new EventEmitter();
  mirror = live.wireLiveAnswersToPhone(engine, () => svc);
});

async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await settle(30);
  return { ws, frames, of: (t) => frames.filter((f) => f.type === t) };
}

/**
 * What a button's IPC handler does (ipcHandlers.ts): run the engine call as a
 * press, then publish the returned text only when the press's own answer did
 * not reach the phone as it streamed.
 */
async function press(label, engineRun, returned) {
  const p = live.startPhonePress();
  const text = await p.run(async () => { await engineRun?.(); return returned; });
  if (text && !p.answeredOnPhone) svc.publishAssistantMessage('ipc-' + Math.random(), text, label);
  return p;
}
const gate = () => { let open; const shut = new Promise((r) => { open = r; }); return { shut, open }; };

/** What the phone ends up showing: finished answers (done + assistant), by text. */
const shown = (phone) => [
  ...phone.of('done').filter((f) => f.content).map((f) => ({ label: f.label || '', content: f.content })),
  ...phone.of('assistant').map((f) => ({ label: f.label || '', content: f.content })),
];

describe('Auto Answer reaches the phone, as it is written', () => {
  test('tokens stream under the What to Answer label, then one finished answer', async () => {
    const phone = await connectPhone();
    engine.emit('suggested_answer_token', 'Tell them ', 'q', 0.9, 7);
    engine.emit('suggested_answer_token', 'about the cache.', 'q', 0.9, 7);
    await settle(30);
    const tokens = phone.of('token');
    assert.equal(tokens.length, 2, 'streamed, not only at the end');
    assert.ok(tokens.every((t) => t.streamId === 'wta-7' && t.label === 'What to Answer'));
    engine.emit('suggested_answer', 'Tell them about the cache.', 'q', 0.9, 7);
    await settle(30);
    assert.deepEqual(shown(phone), [{ label: 'What to Answer', content: 'Tell them about the cache.' }]);
    phone.ws.close();
  });

  test('a manual press: its copy is not published, the streamed answer shows once', async () => {
    const phone = await connectPhone();
    const p = await press('What to Answer', () => {
      engine.emit('suggested_answer_token', 'Say you led it.', 'q', 0.9, 10);
      engine.emit('suggested_answer', 'Say you led it.', 'q', 0.9, 10);
    }, 'Say you led it.');
    await settle(30);
    assert.equal(p.answeredOnPhone, true);
    assert.deepEqual(shown(phone), [{ label: 'What to Answer', content: 'Say you led it.' }]);
    phone.ws.close();
  });

  test('a copy whose text differs from what streamed is not published either', async () => {
    const phone = await connectPhone();
    await press('What to Answer', () => {
      engine.emit('suggested_answer', 'Pressed words.', 'q', 0.9, 11);
    }, 'Pressed words. (retried, trimmed, anything)');
    await settle(30);
    assert.deepEqual(shown(phone), [{ label: 'What to Answer', content: 'Pressed words.' }]);
    phone.ws.close();
  });

  test('the same answer pressed twice still shows twice', async () => {
    const phone = await connectPhone();
    for (const gen of [12, 13]) {
      await press('What to Answer', () => engine.emit('suggested_answer', 'Same words.', 'q', 0.9, gen), 'Same words.');
    }
    await settle(30);
    assert.equal(shown(phone).length, 2);
    phone.ws.close();
  });

  test('without an answer event, the handler copy is the phone\'s only one', async () => {
    const phone = await connectPhone();
    const p = await press('What to Answer', null, 'Only from the handler.');
    await settle(30);
    assert.equal(p.answeredOnPhone, false);
    assert.deepEqual(shown(phone), [{ label: 'What to Answer', content: 'Only from the handler.' }]);
    phone.ws.close();
  });

  test('an Auto Answer finishing DURING a press whose own answer never streamed: both show', async () => {
    const phone = await connectPhone();
    const g = gate();
    const pressing = press('What to Answer', () => g.shut, 'Only from the handler.');
    // Auto Answer: the engine on its own, outside any press, same label.
    engine.emit('suggested_answer_token', 'Auto words.', 'q', 0.9, 20);
    engine.emit('suggested_answer', 'Auto words.', 'q', 0.9, 20);
    g.open();
    const p = await pressing;
    await settle(30);
    assert.equal(p.answeredOnPhone, false, 'the Auto Answer is not this press\'s answer');
    assert.deepEqual(shown(phone).map((m) => m.content).sort(), ['Auto words.', 'Only from the handler.']);
    phone.ws.close();
  });

  test('an Auto Answer finishing during a press that streamed: each shows once', async () => {
    const phone = await connectPhone();
    const g = gate();
    const pressing = press('What to Answer', async () => {
      await g.shut;
      engine.emit('suggested_answer', 'Pressed words.', 'q', 0.9, 22);
    }, 'Pressed words.');
    engine.emit('suggested_answer', 'Auto words.', 'q', 0.9, 21);
    g.open();
    await pressing;
    await settle(30);
    assert.deepEqual(shown(phone).map((m) => m.content).sort(), ['Auto words.', 'Pressed words.']);
    phone.ws.close();
  });

  test('two overlapping presses: each knows only its own answer', async () => {
    const phone = await connectPhone();
    const g1 = gate();
    const g2 = gate();
    const first = press('What to Answer', async () => { await g1.shut; engine.emit('suggested_answer', 'First.', 'q', 0.9, 23); }, 'First!');
    // The second press's answer never streams (the first overtook it, say).
    const second = press('What to Answer', async () => { await g2.shut; }, 'Second, handler only.');
    g1.open();
    await first;
    g2.open();
    const [p1, p2] = [await first, await second];
    await settle(30);
    assert.equal(p1.answeredOnPhone, true);
    assert.equal(p2.answeredOnPhone, false);
    assert.deepEqual(shown(phone).map((m) => m.content), ['First.', 'Second, handler only.']);
    phone.ws.close();
  });

  test('an answer finished from a timer or a .then started inside the press still counts', async () => {
    const phone = await connectPhone();
    const p = await press('Recap', () => new Promise((resolve) => {
      setTimeout(() => Promise.resolve().then(() => { engine.emit('recap', 'Later recap.'); resolve(); }), 5);
    }), 'Later recap.');
    await settle(30);
    assert.equal(p.answeredOnPhone, true);
    assert.equal(shown(phone).length, 1);
    phone.ws.close();
  });

  test('a superseded answer is discarded on the phone, by its generation', async () => {
    const phone = await connectPhone();
    engine.emit('suggested_answer_token', 'old ', 'q', 0.9, 20);
    engine.emit('suggested_answer_token', 'new ', 'q', 0.9, 21);
    engine.emit('suggested_answer_discard', 'superseded', 20);
    await settle(30);
    assert.deepEqual(phone.of('discard').map((f) => f.streamId), ['wta-20']);
    assert.deepEqual(svc.liveStreamIds(), ['wta-21'], 'the newer answer keeps streaming');
    phone.ws.close();
  });

  test('a phone joining mid-stream gets every answer streaming, with its label', async () => {
    engine.emit('suggested_answer_token', 'Auto part ', 'q', 0.9, 30);
    engine.emit('recap_token', 'Recap part ');
    const phone = await connectPhone();
    const replay = phone.of('token');
    assert.equal(replay.length, 2);
    assert.deepEqual(replay.map((t) => [t.token, t.label]), [['Auto part ', 'What to Answer'], ['Recap part ', 'Recap']]);
    phone.ws.close();
  });
});

describe('answers that overlap stream side by side', () => {
  test('an Auto Answer and a Recap interleaved both finish with their own text', async () => {
    const phone = await connectPhone();
    engine.emit('suggested_answer_token', 'A1 ', 'q', 0.9, 40);
    engine.emit('recap_token', 'R1 ');
    engine.emit('suggested_answer_token', 'A2', 'q', 0.9, 40);
    engine.emit('recap_token', 'R2');
    engine.emit('recap', 'R1 R2');
    engine.emit('suggested_answer', 'A1 A2', 'q', 0.9, 40);
    await settle(30);
    const done = phone.of('done');
    assert.deepEqual(done.map((d) => [d.label, d.content]).sort(), [['Recap', 'R1 R2'], ['What to Answer', 'A1 A2']]);
    assert.equal(svc.liveStreamIds().length, 0);
    phone.ws.close();
  });

  test('history keeps the label of a streamed answer', async () => {
    engine.emit('clarify_token', 'Do you mean ');
    engine.emit('clarify', 'Do you mean the API?');
    const phone = await connectPhone();
    const [h] = phone.of('history');
    const m = h.messages.find((x) => x.role === 'assistant');
    assert.equal(m.label, 'Clarify');
    phone.ws.close();
  });
});

describe('every button streams under its own label, and its IPC copy is dropped', () => {
  const cases = [
    ['Code Hint', () => { engine.emit('suggested_answer_token', 'hint', 'Code Hint', 1); engine.emit('suggested_answer', 'hint', 'Code Hint', 1); }, 'hint'],
    ['Brainstorm', () => { engine.emit('suggested_answer_token', 'ideas', 'Brainstorming Approaches', 1); engine.emit('suggested_answer', 'ideas', 'Brainstorming Approaches', 1); }, 'ideas'],
    ['Follow Up', () => { engine.emit('refined_answer_token', 'short', 'shorten'); engine.emit('refined_answer', 'short', 'shorten'); }, 'short'],
    ['Recap', () => { engine.emit('recap_token', 'sum'); engine.emit('recap', 'sum'); }, 'sum'],
    ['Clarify', () => { engine.emit('clarify_token', 'which?'); engine.emit('clarify', 'which?'); }, 'which?'],
    ['Follow-Up Questions', () => { engine.emit('follow_up_questions_token', '1. Why?'); engine.emit('follow_up_questions_update', '1. Why?'); }, '1. Why?'],
    ['What did I miss?', () => { engine.emit('live_helper_token', 'you missed', 'catch_me_up'); engine.emit('live_helper', 'you missed', 'catch_me_up'); }, 'you missed'],
    ['Define', () => { engine.emit('live_helper_token', 'means', 'define'); engine.emit('live_helper', 'means', 'define'); }, 'means'],
    ['My button', () => { engine.emit('custom_button_token', 'custom', 'My button'); engine.emit('custom_button', 'custom', 'My button'); }, 'custom'],
  ];
  for (const [label, run, text] of cases) {
    test(label, async () => {
      const phone = await connectPhone();
      await press(label, run, text);
      await settle(30);
      assert.ok(phone.of('token').every((t) => t.label === label), 'tokens carry the label');
      assert.deepEqual(shown(phone), [{ label, content: text }]);
      phone.ws.close();
    });
  }

  // The handler's copy need not match what streamed (whitespace, a stripped
  // sentinel, a retried answer): the overlay shows the streamed answer, so the
  // copy of a press that streamed is not published, whatever its text.
  for (const [label, run, text] of cases) {
    test(`${label}: a handler copy that differs from what streamed is not published`, async () => {
      const phone = await connectPhone();
      await press(label, run, `${text}\n\n(edited)`);
      await settle(30);
      assert.deepEqual(shown(phone), [{ label, content: text }]);
      phone.ws.close();
    });
  }

  test('a failed Recap ends its stream with the reason', async () => {
    const phone = await connectPhone();
    engine.emit('recap_token', 'partial ');
    engine.emit('error', new Error('No recap came back. Try again.'), 'recap');
    await settle(30);
    const [err] = phone.of('error');
    assert.match(err.message, /No recap came back/);
    assert.equal(svc.liveStreamIds().length, 0);
    phone.ws.close();
  });

  // The engine reports these failures under their own modes (runCodeHint /
  // runBrainstorm catch blocks), not 'what_to_say'.
  for (const [label, question, mode] of [['Code Hint', 'Code Hint', 'code_hint'], ['Brainstorm', 'Brainstorming Approaches', 'brainstorm']]) {
    test(`a failed ${label} ends its stream with the reason`, async () => {
      const phone = await connectPhone();
      await press(label, () => {
        engine.emit('suggested_answer_token', 'partial ', question, 1);
        engine.emit('error', new Error('The model timed out.'), mode);
      }, null);
      await settle(30);
      const errs = phone.of('error');
      assert.equal(errs.length, 1);
      assert.match(errs[0].message, /timed out/);
      assert.equal(errs[0].streamId, phone.of('token')[0].streamId);
      assert.equal(phone.of('discard').length, 0, 'ended by its error, not dropped');
      assert.equal(svc.liveStreamIds().length, 0);
      phone.ws.close();
    });
  }
});

// The overlay keeps such a row as written (discardEmptyPlaceholder drops only
// an empty one), so the phone finishes the card with what it had.
describe('an answer that ends with no final and no error (overtaken, cancelled)', () => {
  test('a press: its card is finished as written when the call returns', async () => {
    const phone = await connectPhone();
    // runRecap returns its partial text when overtaken: no second copy of it.
    const p = await press('Recap', () => { engine.emit('recap_token', 'half a '); }, 'half a ');
    await settle(30);
    const [t] = phone.of('token');
    assert.deepEqual(phone.of('done').map((d) => [d.streamId, d.content]), [[t.streamId, 'half a ']]);
    assert.equal(phone.of('discard').length, 0);
    assert.equal(phone.of('assistant').length, 0, 'the handler copy is not published');
    assert.equal(svc.liveStreamIds().length, 0);
    assert.equal(p.answeredOnPhone, true);
    phone.ws.close();
  });

  test('What to Answer: a press\'s open row is dropped (the overlay hands it to the newer generation)', async () => {
    const phone = await connectPhone();
    const p = await press('What to Answer', () => { engine.emit('suggested_answer_token', 'half ', 'q', 0.9, 60); }, null);
    await settle(30);
    assert.deepEqual(phone.of('discard').map((f) => f.streamId), ['wta-60']);
    assert.equal(phone.of('done').length, 0);
    assert.equal(p.answeredOnPhone, false);
    phone.ws.close();
  });

  test('an empty one goes', async () => {
    const phone = await connectPhone();
    await press('Recap', () => { engine.emit('recap_token', '  '); }, null);
    await settle(30);
    assert.equal(phone.of('discard').length, 1);
    assert.equal(phone.of('done').length, 0);
    phone.ws.close();
  });

  test('pressed again mid-answer: the second press writes its own card, never into the first', async () => {
    const phone = await connectPhone();
    const g = gate();
    const first = press('Recap', async () => { engine.emit('recap_token', 'old half '); await g.shut; }, null);
    const second = await press('Recap', () => {
      engine.emit('recap_token', 'new ');
      engine.emit('recap', 'new recap');
    }, 'new recap');
    g.open();
    const p1 = await first;
    await settle(30);
    const ids = [...new Set(phone.of('token').map((t) => t.streamId))];
    assert.equal(ids.length, 2, 'two cards');
    assert.deepEqual(phone.of('done').map((d) => [d.streamId, d.content]), [[ids[1], 'new recap'], [ids[0], 'old half ']]);
    assert.equal(phone.of('discard').length, 0);
    assert.equal(p1.answeredOnPhone && second.answeredOnPhone, true);
    phone.ws.close();
  });

  test('after a new meeting, the next answer is not swallowed by an old card', async () => {
    const phone = await connectPhone();
    await press('Recap', () => { engine.emit('recap_token', 'old half '); }, null);
    svc.publishMeetingState(true);
    const p = await press('Recap', () => {
      engine.emit('recap_token', 'fresh ');
      engine.emit('recap', 'fresh recap');
    }, 'fresh recap');
    await settle(30);
    assert.equal(p.answeredOnPhone, true);
    assert.deepEqual(shown(phone).at(-1), { label: 'Recap', content: 'fresh recap' });
    assert.ok(phone.of('token').some((t) => t.token === 'fresh '), 'its words streamed');
    svc.publishMeetingState(false);
    phone.ws.close();
  });

  describe('an answer the engine started itself (no press)', () => {
    const rewire = () => {
      mirror.dispose();
      mirror = live.wireLiveAnswersToPhone(engine, () => svc, { idleStaleMs: 40 });
    };

    test('left open: finished as written once the engine is idle and no word comes for a while', async () => {
      rewire();
      const phone = await connectPhone();
      engine.emit('recap_token', 'planner half ');
      engine.emit('mode_changed', 'idle');
      await settle(10);
      assert.equal(svc.liveStreamIds().length, 1, 'not at once');
      await settle(80);
      assert.equal(svc.liveStreamIds().length, 0);
      assert.deepEqual(shown(phone), [{ label: 'Recap', content: 'planner half ' }]);
      assert.equal(phone.of('discard').length, 0);
      phone.ws.close();
    });

    test('a run that goes idle just before its last event keeps its card', async () => {
      rewire();
      const phone = await connectPhone();
      engine.emit('recap_token', 'All ');
      engine.emit('mode_changed', 'idle');
      engine.emit('recap', 'All done.');
      await settle(80);
      assert.equal(phone.of('discard').length, 0);
      assert.deepEqual(shown(phone), [{ label: 'Recap', content: 'All done.' }]);
      phone.ws.close();
    });

    test('an overtaken run going idle does not drop the newer answer still being written', async () => {
      rewire();
      const phone = await connectPhone();
      engine.emit('clarify_token', 'old ');      // overtaken, never finishes
      engine.emit('recap_token', 'new ');        // the run that overtook it
      engine.emit('mode_changed', 'idle');       // the overtaken run stopping
      await settle(20);
      engine.emit('recap_token', 'more ');
      await settle(40);
      engine.emit('recap_token', 'words');
      await settle(40);
      engine.emit('recap', 'new more words');
      await settle(30);
      const clarifyId = phone.of('token').find((t) => t.label === 'Clarify').streamId;
      assert.deepEqual(phone.of('done').map((d) => [d.streamId, d.content]).slice(0, 1), [[clarifyId, 'old ']], 'the overtaken one ended as written');
      assert.equal(phone.of('discard').length, 0);
      assert.equal(new Set(phone.of('token').filter((t) => t.label === 'Recap').map((t) => t.streamId)).size, 1, 'one Recap card throughout');
      assert.deepEqual(shown(phone).at(-1), { label: 'Recap', content: 'new more words' });
      phone.ws.close();
    });

    // Work a press started in the background still carries its context; once
    // the press returned, what it writes is engine-started (the press can no
    // longer end it), so the idle sweep ends it.
    test('a background part writing after its press returned is not tied to the press', async () => {
      rewire();
      const phone = await connectPhone();
      let late;
      const p = await press('Recap', () => {
        late = new Promise((r) => setTimeout(() => { engine.emit('recap_token', 'late '); r(); }, 5));
      }, null);
      await late;
      engine.emit('mode_changed', 'idle');
      await settle(80);
      assert.equal(p.answeredOnPhone, false, 'written after the press returned');
      assert.equal(svc.liveStreamIds().length, 0, 'not left open');
      assert.deepEqual(shown(phone), [{ label: 'Recap', content: 'late ' }]);
      phone.ws.close();
    });

    test('a press\'s answer is left to its press, whatever the engine mode', async () => {
      rewire();
      const phone = await connectPhone();
      const g = gate();
      const pressing = press('Recap', async () => {
        engine.emit('recap_token', 'pressed ');
        engine.emit('mode_changed', 'idle');
        await g.shut;
        engine.emit('recap', 'pressed recap');
      }, 'pressed recap');
      await settle(80);
      assert.equal(phone.of('discard').length + phone.of('done').length, 0, 'still open');
      g.open();
      await pressing;
      await settle(30);
      assert.deepEqual(shown(phone), [{ label: 'Recap', content: 'pressed recap' }]);
      phone.ws.close();
    });
  });
});

describe('coaching cards and corrected code', () => {
  test('a negotiation coaching card reaches the phone as text, resolving What to Answer', async () => {
    const phone = await connectPhone();
    engine.emit('negotiation_coaching', {
      tacticalNote: 'Anchor high; stay quiet after.', exactScript: 'I was expecting closer to 150.',
      phase: 'counter', theirOffer: 120000, yourTarget: 150000, currency: 'USD', showSilenceTimer: true,
    });
    await settle(30);
    const [a] = phone.of('assistant');
    assert.equal(a.label, 'What to Answer');
    assert.match(a.content, /\*\*Say:\*\* I was expecting closer to 150\./);
    assert.match(a.content, /Anchor high/);
    assert.match(a.content, /Their offer: USD 120,000 · Your target: USD 150,000/);
    phone.ws.close();
  });

  test('a corrected code answer reaches the phone with its note', async () => {
    const phone = await connectPhone();
    engine.emit('code_correction', { question: 'q', answer: '```js\nfix()\n```', note: 'The first version failed 2 of 5 tests.', reVerified: true });
    await settle(30);
    const [a] = phone.of('assistant');
    assert.equal(a.label, 'Corrected code');
    assert.match(a.content, /failed 2 of 5 tests\. The fix passed its tests\./);
    assert.match(a.content, /fix\(\)/);
    phone.ws.close();
  });

  test('malformed payloads send nothing', async () => {
    const phone = await connectPhone();
    engine.emit('negotiation_coaching', null);
    engine.emit('code_correction', { answer: '' });
    await settle(30);
    assert.equal(phone.of('assistant').length, 0);
    phone.ws.close();
  });
});

describe('Direct Assist reaches the phone', () => {
  test('a typed question: the question, then its answer streaming under it', async () => {
    const phone = await connectPhone();
    const send = live.mirrorDirectAssistToPhone(() => svc, { requestId: 'r1', source: 'typed', currentRequest: 'What is CAP?' });
    send({ type: 'start', requestId: 'r1', sequence: 0 });
    send({ type: 'delta', requestId: 'r1', sequence: 1, text: 'Consistency, ' });
    send({ type: 'provider_switch', requestId: 'r1', sequence: 0 });
    send({ type: 'delta', requestId: 'r1', sequence: 2, text: 'availability…' });
    send({ type: 'done', requestId: 'r1', sequence: 3, fullText: 'Consistency, availability…' });
    await settle(30);
    const [u] = phone.of('user');
    assert.equal(u.content, 'What is CAP?');
    assert.equal(u.awaiting, true);
    assert.equal(phone.of('token').length, 2);
    const [d] = phone.of('done');
    assert.equal(d.streamId, 'da-r1');
    assert.equal(d.content, 'Consistency, availability…');
    assert.equal(d.label, undefined, 'a typed answer needs no label, its question is above it');
    phone.ws.close();
  });

  test('What to Say (spoken) answers under the What to Answer label', async () => {
    const phone = await connectPhone();
    const send = live.mirrorDirectAssistToPhone(() => svc, { requestId: 'r2', source: 'stt', currentRequest: 'heard question' });
    send({ type: 'start' });
    send({ type: 'delta', text: 'Say this.' });
    send({ type: 'done', fullText: 'Say this.' });
    await settle(30);
    assert.equal(phone.of('user').length, 0);
    assert.equal(phone.of('token')[0].label, 'What to Answer');
    assert.equal(phone.of('done')[0].label, 'What to Answer');
    phone.ws.close();
  });

  test('a cancelled request is discarded, a failed one says why', async () => {
    const phone = await connectPhone();
    const a = live.mirrorDirectAssistToPhone(() => svc, { requestId: 'r3', source: 'stt' });
    a({ type: 'start' }); a({ type: 'delta', text: 'x' }); a({ type: 'cancel' });
    a({ type: 'delta', text: 'late' });
    const b = live.mirrorDirectAssistToPhone(() => svc, { requestId: 'r4', source: 'stt' });
    b({ type: 'start' }); b({ type: 'error', error: { message: 'No provider.' } });
    await settle(30);
    assert.deepEqual(phone.of('discard').map((f) => f.streamId), ['da-r3']);
    assert.deepEqual(phone.of('error').map((f) => [f.streamId, f.message]), [['da-r4', 'No provider.']]);
    assert.equal(phone.of('token').length, 1, 'nothing after the end');
    phone.ws.close();
  });

  test('a Direct request retires the legacy answers still streaming, like the overlay', async () => {
    const phone = await connectPhone();
    const gw = gate();
    const gh = gate();
    // Both pressed and still being written when the Direct request starts.
    const pw = press('What to Answer', async () => {
      engine.emit('suggested_answer_token', 'legacy ', 'q', 0.9, 50);
      await gw.shut;
      engine.emit('suggested_answer_token', 'more', 'q', 0.9, 50);
      engine.emit('suggested_answer', 'legacy more', 'q', 0.9, 50);
    }, 'legacy more');
    const ph = press('Code Hint', async () => {
      engine.emit('suggested_answer_token', 'hint ', 'Code Hint', 1);
      await gh.shut;
      engine.emit('suggested_answer_token', 'more', 'Code Hint', 1);
      engine.emit('suggested_answer', 'hint done', 'Code Hint', 1);
    }, 'hint done');
    live.supersedeLegacyPhoneAnswers();
    gw.open();
    gh.open();
    // They finish inside their presses; the handlers' copies are hidden too.
    const [w, h] = [await pw, await ph];
    assert.equal(w.answeredOnPhone && h.answeredOnPhone, true);
    // A NEW generation afterwards shows normally.
    engine.emit('suggested_answer', 'fresh', 'q', 0.9, 51);
    await settle(30);
    assert.deepEqual(phone.of('discard').map((f) => f.streamId).sort(), [phone.of('token').find((t) => t.label === 'Code Hint').streamId, 'wta-50'].sort());
    assert.equal(phone.of('token').filter((t) => t.token === 'more').length, 0, 'nothing more of a retired answer is sent');
    assert.deepEqual(shown(phone), [{ label: 'What to Answer', content: 'fresh' }]);
    phone.ws.close();
  });

  // The retirement belongs to the answers in flight, not to the button: the
  // overlay shows the next Code Hint press (handleCodeHint lifts its tombstone).
  for (const [how, end] of [
    ['fails', () => engine.emit('error', new Error('No hint came back.'), 'code_hint')],
    ['is overtaken', () => {}],
  ]) {
    test(`a retired Code Hint that ${how} does not hide the next Code Hint`, async () => {
      const phone = await connectPhone();
      const g = gate();
      const first = press('Code Hint', async () => {
        engine.emit('suggested_answer_token', 'old ', 'Code Hint', 1);
        await g.shut;
        end();
      }, null);
      live.supersedeLegacyPhoneAnswers();
      g.open();
      await first;
      const next = await press('Code Hint', () => {
        engine.emit('suggested_answer_token', 'new hint', 'Code Hint', 1);
        engine.emit('suggested_answer', 'new hint', 'Code Hint', 1);
      }, 'new hint');
      await settle(30);
      assert.equal(phone.of('error').length, 0, 'the retired card is gone already: no error card for it');
      assert.equal(phone.of('discard').length, 1, 'discarded once, when retired');
      assert.equal(next.answeredOnPhone, true);
      assert.deepEqual(shown(phone), [{ label: 'Code Hint', content: 'new hint' }]);
      phone.ws.close();
    });
  }
});

describe('mirror only', () => {
  test('a sink that throws never breaks the engine event', () => {
    const e = new EventEmitter();
    const throwing = new Proxy({}, { get: () => () => { throw new Error('boom'); } });
    const m = live.wireLiveAnswersToPhone(e, () => throwing);
    assert.doesNotThrow(() => {
      e.emit('suggested_answer_token', 'x', 'q', 1, 1);
      e.emit('suggested_answer', 'x', 'q', 1, 1);
      e.emit('recap_token', 'x');
      e.emit('negotiation_coaching', { exactScript: 'x' });
    });
    m.dispose();
    const send = live.mirrorDirectAssistToPhone(() => throwing, { requestId: 'z', source: 'typed', currentRequest: 'q' });
    assert.doesNotThrow(() => { send({ type: 'start' }); send({ type: 'delta', text: 'x' }); send({ type: 'done' }); });
  });

  test('dispose stops mirroring', async () => {
    const phone = await connectPhone();
    mirror.dispose();
    engine.emit('suggested_answer', 'after dispose', 'q', 0.9, 60);
    await settle(30);
    assert.equal(shown(phone).length, 0);
    phone.ws.close();
  });

  test('more answers than the phone keeps live: the oldest is dropped there, and its late words are not sent', async () => {
    const phone = await connectPhone();
    for (let i = 0; i < 9; i++) svc.publishToken('s' + i, 'w' + i + ' ', { label: 'Recap' });
    await settle(30);
    assert.deepEqual(phone.of('discard').map((f) => f.streamId), ['s0']);
    svc.publishToken('s0', 'late', { label: 'Recap' });
    svc.publishDone('s0', 'w0 late', { label: 'Recap' });
    await settle(30);
    assert.equal(phone.of('token').filter((t) => t.streamId === 's0').length, 1, 'only its word from before');
    assert.equal(phone.of('done').filter((d) => d.streamId === 's0').length, 0);
    assert.equal(svc.liveStreamIds().length, 8);
    assert.ok(!svc.liveStreamIds().includes('s0'), 'not restarted mid-answer');
    phone.ws.close();
  });

  test('a new meeting drops every live stream', async () => {
    engine.emit('suggested_answer_token', 'a', 'q', 0.9, 70);
    engine.emit('recap_token', 'b');
    assert.equal(svc.liveStreamIds().length, 2);
    svc.publishMeetingState(true);
    assert.equal(svc.liveStreamIds().length, 0);
    svc.publishMeetingState(false);
  });
});

describe('wiring', () => {
  test('main.ts wires the engine events to the phone once', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
    const calls = src.match(/wireLiveAnswersToPhone\(this\.intelligenceManager, \(\) => PhoneMirrorService\.getInstance\(\)\)/g) || [];
    assert.equal(calls.length, 1);
    const setup = src.slice(src.indexOf('private setupIntelligenceEvents(): void {'));
    assert.ok(setup.indexOf('wireLiveAnswersToPhone(') < setup.indexOf("this.intelligenceManager.on('suggested_answer',"), 'inside setupIntelligenceEvents');
  });

  test('ipcHandlers mirrors every Direct Assist event it sends, and retires legacy answers', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    const start = src.indexOf('const sendDirectAssistEventAndMirror');
    assert.ok(start > 0);
    const loopEnd = src.indexOf("return { accepted: true, requestId: request.requestId };", start);
    const loop = src.slice(start, loopEnd);
    assert.equal((loop.match(/sendDirectAssistEvent\(event\.sender/g) || []).length, 0, 'no unmirrored send in the stream loop');
    assert.equal((loop.match(/sendDirectAssistEventAndMirror\(event\.sender/g) || []).length, 4);
    assert.match(src.slice(start - 900, start), /supersedeLegacyPhoneAnswers\(\);/);
  });

  test('every button handler runs its engine call as a press and publishes only an unanswered one', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    const runs = ['runWhatShouldISay(', 'runClarify(', 'runCodeHint(', 'runBrainstorm(', 'runFollowUp(', 'runRecap(', 'runFollowUpQuestions(', 'runLiveHelper(', 'runCustomButton('];
    for (const run of runs) {
      const wrapped = new RegExp(`await phonePress\\.run\\(\\(\\) => (?:intelligenceManager|appState\\.getIntelligenceManager\\(\\))\\.${run.replace('(', '\\(')}`);
      assert.match(src, wrapped, `${run} runs as a press`);
    }
    assert.equal((src.match(/const phonePress = startPhonePress\(\);/g) || []).length, 9);
    assert.equal((src.match(/await phonePress\.run\(\(\) => /g) || []).length, 10, 'What to Answer\'s retry runs as the same press');
    assert.equal((src.match(/if \(!phonePress\.answeredOnPhone\) PhoneMirrorService\.getInstance\(\)\.publishAssistantMessage\(/g) || []).length, 9);
    // Every button copy is guarded: the only unguarded ones left are Assist and the manual Answer, which no engine event mirrors.
    const unguarded = (src.match(/^\s*PhoneMirrorService\.getInstance\(\)\.publishAssistantMessage\(\n\s*crypto\.randomUUID\(\),\n\s*\w+,\n\s*'([^']+)'/gm) || []).map((m) => m.match(/'([^']+)'/)[1]);
    assert.deepEqual(unguarded.sort(), ['Answer', 'Assist']);
    // A copy carries the same label as the streamed answer: both from the mirror's own.
    const labels = [...src.matchAll(/if \(!phonePress\.answeredOnPhone\) PhoneMirrorService\.getInstance\(\)\.publishAssistantMessage\(([\s\S]*?)\);/g)]
      .map((m) => m[1].split(',').map((a) => a.trim()).filter(Boolean).pop());
    assert.deepEqual(labels.sort(), [
      'PHONE_LABELS.brainstorm', 'PHONE_LABELS.clarify', 'PHONE_LABELS.codeHint', 'PHONE_LABELS.followUp',
      'PHONE_LABELS.followUpQuestions', 'PHONE_LABELS.recap', 'PHONE_LABELS.whatToAnswer', 'button.name', 'liveHelperLabel(action)',
    ]);
  });

  test('the engine names the generation it discards', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');
    const emits = src.match(/emit\('suggested_answer_discard', [^)]*\)/g) || [];
    assert.ok(emits.length >= 5);
    for (const e of emits) assert.match(e, /, (generationId|finished\.generationId)\)$/, e);
  });
});
