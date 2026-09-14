// Behavioural tests for the window-swap motion state machine
// (src/lib/windowTransitions.ts) — the RENDERER half of the launcher ↔ meeting
// overlay swap.
//
// Why these exist alongside the source-contract pins in
// electron/services/__tests__/WindowsMeetingSwapChoreography2026_08_26.test.mjs:
// those assert that the WIRING exists (the cue is sent, the hide is deferred,
// the durations match across files). They cannot catch a state machine that is
// wired correctly and still lands on the wrong attribute, because they never
// run one. Every defect below is of that shape — the cues all arrive, in the
// order the main process sends them, and the launcher still ends up unanimated.
//
// The module only ever touches document.documentElement's attributes and
// window timers, so a hand-rolled DOM stub is enough and there is no jsdom
// dependency. Cues are delivered exactly the way the preload bridge delivers
// them: one callback per channel, invoked with a phase string.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM/window stub ─────────────────────────────────────────────────
//
// Timers are VIRTUAL. Real ones would make these tests slow and flaky, and the
// thing under test is ordering-at-a-deadline, which a controllable clock
// expresses directly.
function makeEnv(windowKind) {
  const attrs = new Map([['data-platform', 'win32'], ['data-window', windowKind]]);
  let now = 0;
  let seq = 0;
  const timers = new Map();

  const root = {
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    // windowTransitions reads offsetWidth to force a style recalc so an arm and
    // a play landing in one task cannot be coalesced. Just has to be readable.
    offsetWidth: 0,
  };

  const listeners = {};
  const api = {
    onOverlayTransition: (cb) => { listeners.overlay = cb; },
    onLauncherTransition: (cb) => { listeners.launcher = cb; },
    onSessionReset: (cb) => { listeners.sessionReset = cb; },
  };

  const win = {
    electronAPI: api,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: now + (ms || 0) });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
  };

  return {
    root,
    listeners,
    document: { documentElement: root },
    window: win,
    // Advance the virtual clock, firing due timers in deadline order.
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = t.at;
        t.fn();
      }
      now = target;
    },
    attr: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
}

// The module reads the globals `document` and `window` at call time, so install
// the stub, import fresh, and restore. A cache-busting query keeps each test's
// module state independent.
async function loadModule(env) {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = env.document;
  globalThis.window = env.window;
  try {
    return await import(`../windowTransitions.ts?t=${Math.random()}`);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
}

async function installLauncher() {
  const env = makeEnv('launcher');
  const mod = await loadModule(env);
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = env.document;
  globalThis.window = env.window;
  try {
    mod.installLauncherRecede();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
  const send = (phase) => {
    const p = globalThis.window;
    const d = globalThis.document;
    globalThis.window = env.window;
    globalThis.document = env.document;
    try { env.listeners.launcher(phase); } finally { globalThis.window = p; globalThis.document = d; }
  };
  const tick = (ms) => {
    const p = globalThis.window;
    const d = globalThis.document;
    globalThis.window = env.window;
    globalThis.document = env.document;
    try { env.tick(ms); } finally { globalThis.window = p; globalThis.document = d; }
  };
  return { env, send, tick, attr: () => env.attr('data-launcher-transition') };
}

async function installOverlay(kind = 'overlay') {
  const env = makeEnv(kind);
  const mod = await loadModule(env);
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = env.document;
  globalThis.window = env.window;
  try {
    mod.installOverlayEntrance();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
  const send = (phase) => {
    const p = globalThis.window;
    const d = globalThis.document;
    globalThis.window = env.window;
    globalThis.document = env.document;
    try { env.listeners.overlay(phase); } finally { globalThis.window = p; globalThis.document = d; }
  };
  const tick = (ms) => {
    const p = globalThis.window;
    const d = globalThis.document;
    globalThis.window = env.window;
    globalThis.document = env.document;
    try { env.tick(ms); } finally { globalThis.window = p; globalThis.document = d; }
  };
  return { env, send, tick, attr: () => env.attr('data-overlay-enter') };
}

// ── The happy path, both directions ─────────────────────────────────────────

test('launcher: the Stop-meeting arrival arms then enters, and settles at rest', async () => {
  const l = await installLauncher();
  assert.equal(l.attr(), null, 'the launcher starts at rest');

  // switchToLauncher sends 'restore' (top of the function), then 'arm' behind
  // the shield, then 'enter' when the shield lifts 60ms later.
  l.send('restore');
  l.send('arm');
  assert.equal(l.attr(), 'arriving', 'armed behind the shield = the pre-entrance position');

  l.send('enter');
  assert.equal(l.attr(), 'entering', 'the entrance plays the instant the shield lifts');

  // The attribute must be REMOVED, not parked at "entering": a lingering
  // transform on body keeps it a containing block for every position:fixed
  // descendant for the rest of the session.
  l.tick(400);
  assert.equal(l.attr(), null, 'the entrance tears itself down after it finishes');
});

test('overlay: the Stop-meeting departure leaves, then rests once hidden', async () => {
  const o = await installOverlay();
  o.send('exit');
  assert.equal(o.attr(), 'leaving', 'the exit plays on top of the rising launcher');

  // 'rest' is sent by the main process only after the windows are hidden.
  o.send('rest');
  assert.equal(o.attr(), null, 'the group snaps back to rest so the next show is not blank');
});

// ── The failure that source greps cannot see ────────────────────────────────

test('launcher: a late restore from the previous swap must not defeat the entrance', async () => {
  // THE RACE. hideLauncherAfterOverlayHandoff() sends 'restore' after its
  // deferred hide, up to LAUNCHER_RECEDE_MS late. On a fast Stop→Start→Stop
  // that stale cue can land AFTER the next switchToLauncher has already armed
  // the arrival. Both directions share one attribute, so an unguarded restore
  // strips 'arriving' — and enter() then early-returns on its own guard,
  // leaving the launcher visible with no animation at all.
  //
  // Silent by construction: nothing throws, every cue was sent in the order the
  // main process sends it, and the only symptom is that the polish disappears
  // on exactly the cadence it was built for.
  const l = await installLauncher();

  l.send('arm');
  assert.equal(l.attr(), 'arriving');

  l.send('restore'); // ← the stale cue arriving late
  assert.equal(
    l.attr(),
    'arriving',
    'a late restore must not clobber an armed entrance — it is two swaps stale by then',
  );

  l.send('enter');
  assert.equal(l.attr(), 'entering', 'the entrance must still play');
});

test('launcher: a late restore must not interrupt an entrance already in flight', async () => {
  const l = await installLauncher();
  l.send('arm');
  l.send('enter');
  assert.equal(l.attr(), 'entering');

  l.send('restore');
  assert.equal(l.attr(), 'entering', 'an in-flight entrance owns the attribute');

  l.tick(400);
  assert.equal(l.attr(), null, 'and it still tears down on its own timer');
});

test('launcher: restore still works for the case it exists for', async () => {
  // The guard above must not have broken the recede's own restore, which is the
  // reason this cue exists: the recede ends at opacity 0 and a launcher shown
  // while still receded presents a blank frame.
  const l = await installLauncher();
  l.send('recede');
  assert.equal(l.attr(), 'receding');
  l.send('restore');
  assert.equal(l.attr(), null, 'a restore against a recede must still snap to rest');
});

// ── Watchdogs: correctness backstops, not niceties ──────────────────────────

test('launcher: a dropped enter cue cannot strand the launcher invisible', async () => {
  // 'arriving' is opacity 0. If the enter never arrives the user is looking at
  // a shown-but-invisible launcher with nothing else on screen, so this is a
  // correctness backstop.
  const l = await installLauncher();
  l.send('arm');
  assert.equal(l.attr(), 'arriving');

  l.tick(200); // past PLAY_WATCHDOG_MS
  assert.notEqual(l.attr(), 'arriving', 'the watchdog must play a dropped entrance');
  l.tick(400);
  assert.equal(l.attr(), null, 'and it converges on rest');
});

test('overlay: a dropped rest cue cannot leave the group parked invisible', async () => {
  const o = await installOverlay();
  o.send('exit');
  assert.equal(o.attr(), 'leaving');

  o.tick(1000); // past EXIT_SELF_HEAL_MS
  assert.equal(o.attr(), null, 'the exit self-heal must return the group to rest');
});

// ── Direction handoff: Start landing inside a Stop, and vice versa ──────────

test('overlay: a Start inside the previous Stop exit hands over cleanly', async () => {
  const o = await installOverlay();
  o.send('exit');                 // Stop begins
  assert.equal(o.attr(), 'leaving');

  o.send('arm');                  // Start, inside the 260ms exit window
  assert.equal(o.attr(), 'armed', 'the entrance takes the attribute over from the exit');

  // The exit's self-heal must not survive to strip the armed state — that would
  // drop the overlay to rest (opacity 1) while it is still behind the shield,
  // and the entrance would never play.
  o.tick(1000);
  assert.notEqual(o.attr(), 'leaving');

  const o2 = await installOverlay();
  o2.send('exit');
  o2.send('arm');
  o2.send('play');
  assert.equal(o2.attr(), 'entering', 'and the handed-over entrance still plays');
});

test('overlay: a stray rest against an entrance is ignored', async () => {
  const o = await installOverlay();
  o.send('arm');
  o.send('play');
  assert.equal(o.attr(), 'entering');
  o.send('rest');
  assert.equal(o.attr(), 'entering', 'rest only ever unwinds a leaving state');
});

// ── The whole group moves as one ────────────────────────────────────────────

test('the pill and toggle run the same exit as the shell', async () => {
  // Three HWNDs, one object. They receive the same cue on the same channel and
  // must land on the same attribute — the CSS then gives them the one timeline.
  for (const kind of ['overlay', 'overlay-pill', 'overlay-toggle']) {
    const o = await installOverlay(kind);
    o.send('exit');
    assert.equal(o.attr(), 'leaving', `${kind} must join the exit`);
  }
});

// ── Platform gate ───────────────────────────────────────────────────────────

test('nothing installs off Windows', async () => {
  const env = makeEnv('launcher');
  env.root.setAttribute('data-platform', 'darwin');
  const mod = await loadModule(env);

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = env.document;
  globalThis.window = env.window;
  try {
    mod.installLauncherRecede();
    mod.installOverlayEntrance();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }

  assert.equal(
    env.listeners.launcher,
    undefined,
    'macOS must not subscribe to the swap cues — it has no opacity shield to arm an invisible state behind.',
  );
  assert.equal(env.listeners.overlay, undefined, 'same for the overlay group.');
});
