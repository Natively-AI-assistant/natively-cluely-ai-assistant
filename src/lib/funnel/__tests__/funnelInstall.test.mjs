// Registering an install (funnelInstall.mjs): the solver that must not hold the
// thread, and the registrar that must not loop, lose an event, or work while
// telemetry is off. Hashing is real; clock, sleeping, yielding and fetch are fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  solvePow, createInstallRegistrar,
  INSTALL_MAX_BITS, INSTALL_SLICE_MS, INSTALL_RETRY_MS, INSTALL_MAX_ATTEMPTS,
} from '../funnelInstall.mjs';
import { powInput, leadingZeroBits } from '../funnelPow.mjs';

const sha256 = (input) => createHash('sha256').update(input).digest();
/**
 * Real hashing that gives up after `limit` hashes. A solver that should have
 * stopped and did not would otherwise grind for minutes, or for ever: this
 * turns that into a test that fails at once.
 */
const boundedSha256 = (limit, why) => { let n = 0; return (input) => { if (++n > limit) throw new Error(`${why}: still hashing after ${limit} hashes`); return sha256(input); }; };
const INSTALL = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const http = (status, body = {}) => ({ ok: false, status, json: async () => body });

/** A clock that moves one millisecond every time it is read, and counts yields. */
function ticking() {
  const c = { t: 1_000_000, yields: 0, sleeps: [], hashesSinceYield: 0, worstRun: 0 };
  c.now = () => ++c.t;
  c.yieldFn = async () => { c.yields++; };
  c.sleep = async (ms) => { c.sleeps.push(ms); };
  return c;
}

// ── The solver ───────────────────────────────────────────────────────────────

test('the solver finds a solution the puzzle accepts', async () => {
  const c = ticking();
  for (const bits of [1, 8, 12]) {
    const r = await solvePow({ challenge: 'fic1.test.sig', bits, sha256, now: c.now, yieldFn: c.yieldFn, sleep: c.sleep });
    assert.ok(leadingZeroBits(sha256(powInput('fic1.test.sig', r.solution))) >= bits);
    assert.match(r.solution, /^(0|[1-9][0-9]*)$/);
    assert.equal(r.hashes, Number(r.solution) + 1);
  }
});

test('the solver gives the thread back: between two yields it hashes a bounded amount', async () => {
  // Timing a slice with a real clock is at the mercy of whatever else the
  // machine is doing. What the solver controls is how much WORK it does before
  // it looks at the clock again, so that is what is measured: with a clock that
  // moves one millisecond per look, a slice of N ms may hash at most N looks'
  // worth, plus the batch in progress.
  const c = ticking();
  let sinceYield = 0;
  let worst = 0;
  const counting = (input) => { sinceYield++; return sha256(input); };
  const r = await solvePow({
    challenge: 'fic1.slices.sig', bits: 15, sha256: counting, now: c.now, sleep: c.sleep,
    yieldFn: async () => { worst = Math.max(worst, sinceYield); sinceYield = 0; c.yields++; },
  });
  assert.ok(r.hashes > 5000 && c.yields > 3, `${r.hashes} hashes, ${c.yields} yields`);
  assert.ok(worst <= (INSTALL_SLICE_MS + 1) * 128, `${worst} hashes in one slice`);
  // One look at the clock per 128 hashes: about 0.1 ms of work on a fast
  // machine and well under a millisecond on a slow one, so a slice overruns
  // its budget by at most that.
  assert.ok(INSTALL_SLICE_MS <= 16, 'a slice is shorter than a frame');
});

test('with a clock that moves, it yields many times over a long solve', async () => {
  const c = ticking();
  const r = await solvePow({ challenge: 'fic1.long.sig', bits: 14, sha256, now: c.now, yieldFn: c.yieldFn, sleep: c.sleep, sliceMs: 2 });
  assert.ok(r.hashes > 2000);
  assert.ok(c.yields >= Math.floor(r.hashes / 128 / 2) - 1, `${c.yields} yields for ${r.hashes} hashes`);
});

test('turning telemetry off stops the solver for good', async () => {
  const c = ticking();
  let enabled = true;
  const r = await solvePow({
    challenge: 'fic1.abort.sig', bits: 40, sha256: boundedSha256(50_000, 'the solver did not stop'), now: c.now, sliceMs: 1,
    yieldFn: async () => { c.yields++; if (c.yields === 3) enabled = false; },
    sleep: c.sleep, shouldAbort: () => !enabled,
  });
  assert.equal(r, null);
  assert.equal(c.yields, 3, 'it stopped at the first yield after the switch went off');
});

test('a meeting makes the solver wait, not work, and it carries on afterwards', async () => {
  const c = ticking();
  let meeting = false;
  let waits = 0;
  const r = await solvePow({
    challenge: 'fic1.pause.sig', bits: 13, sha256, now: c.now, sliceMs: 1,
    yieldFn: async () => { c.yields++; if (c.yields === 2) meeting = true; },
    sleep: async (ms) => { waits++; assert.equal(ms, 2000); if (waits === 3) meeting = false; },
    shouldPause: () => meeting,
  });
  assert.equal(waits, 3, 'it slept while the meeting ran');
  assert.ok(r && leadingZeroBits(sha256(powInput('fic1.pause.sig', r.solution))) >= 13, 'and finished the same puzzle afterwards');
});

// ── The registrar ────────────────────────────────────────────────────────────

function harness(over = {}) {
  const c = ticking();
  const h = { c, tokens: {}, calls: [], enabled: true, meeting: false, difficulty: 8, challenges: 0 };
  h.respond = async (url, body) => {
    if (url.endsWith('/challenge')) { h.challenges++; return ok({ ok: true, challenge: `fic1.c${h.challenges}.sig`, difficulty: h.difficulty }); }
    const good = leadingZeroBits(sha256(powInput(body.challenge, body.solution))) >= h.difficulty;
    return good ? ok({ ok: true, install_token: `fit1.token-for-${body.challenge}` }) : http(422, { ok: false, error: 'solution_wrong' });
  };
  h.r = createInstallRegistrar({
    fetchImpl: async (url, init) => { const body = JSON.parse(init.body); h.calls.push({ url, body, headers: init.headers }); return h.respond(url, body); },
    challengeEndpoint: 'https://x.test/v1/telemetry/challenge',
    registerEndpoint: 'https://x.test/v1/telemetry/register',
    sha256, now: c.now, yieldFn: c.yieldFn, sleep: c.sleep,
    isEnabled: () => h.enabled,
    shouldPause: () => h.meeting,
    loadToken: (id) => h.tokens[id],
    saveToken: (id, t) => { h.tokens[id] = t; },
    clearToken: (id) => { delete h.tokens[id]; },
    ...over,
  });
  return h;
}

test('an install with no token asks for a challenge, solves it, and keeps the token', async () => {
  const h = harness();
  const r = await h.r.ensureToken(INSTALL);
  assert.equal(r.token, 'fit1.token-for-fic1.c1.sig');
  assert.equal(h.tokens[INSTALL], r.token);
  assert.deepEqual(h.calls.map((c) => c.url.split('/').pop()), ['challenge', 'register']);
  assert.deepEqual(h.calls[0].body, { install_id: INSTALL }, 'the challenge request names the install and nothing else');
  assert.deepEqual(Object.keys(h.calls[1].body).sort(), ['challenge', 'solution']);
  assert.deepEqual(h.calls[0].headers, { 'Content-Type': 'application/json' }, 'no key, no trial token, no device id');
});

test('an install that already has a token does no work and makes no request', async () => {
  const h = harness();
  h.tokens[INSTALL] = 'fit1.kept';
  assert.deepEqual(await h.r.ensureToken(INSTALL), { token: 'fit1.kept' });
  assert.equal(h.calls.length, 0);
});

test('with telemetry off, or during a meeting, nothing is asked of the server', async () => {
  const off = harness();
  off.enabled = false;
  assert.deepEqual(await off.r.ensureToken(INSTALL), { skipped: 'disabled' });
  const busy = harness();
  busy.meeting = true;
  assert.deepEqual(await busy.r.ensureToken(INSTALL), { skipped: 'paused' });
  assert.equal(off.calls.length + busy.calls.length, 0);
});

test('two callers at once share one registration', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.r.ensureToken(INSTALL), h.r.ensureToken(INSTALL)]);
  assert.equal(a.token, b.token);
  assert.equal(h.challenges, 1);
});

test('a puzzle harder than this app will take on is not attempted; it waits for the price to fall', async () => {
  let tooHard = true;
  const h = harness({ sha256: (input) => { if (tooHard) throw new Error('a puzzle that is too hard must not be hashed at all'); return sha256(input); } });
  h.difficulty = INSTALL_MAX_BITS + 1;
  assert.deepEqual(await h.r.ensureToken(INSTALL), { failed: 'too_hard' });
  assert.equal(h.calls.length, 1, 'no hashing, no register call');
  assert.deepEqual(await h.r.ensureToken(INSTALL), { skipped: 'waiting' });
  h.c.t += INSTALL_RETRY_MS.limited + 1;
  h.difficulty = 8;
  tooHard = false;
  assert.ok((await h.r.ensureToken(INSTALL)).token);
});

test('an address that has asked too often waits hours, not seconds', async () => {
  const h = harness();
  h.respond = async () => http(429, { ok: false, error: 'challenge_limit' });
  assert.deepEqual(await h.r.ensureToken(INSTALL), { failed: 'challenge_limit' });
  h.c.t += INSTALL_RETRY_MS.network + 1;
  assert.deepEqual(await h.r.ensureToken(INSTALL), { skipped: 'waiting' });
});

test('an unreachable server is tried again later, and never throws', async () => {
  const h = harness();
  h.respond = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  assert.deepEqual(await h.r.ensureToken(INSTALL), { failed: 'network' });
  assert.deepEqual(await h.r.ensureToken(INSTALL), { skipped: 'waiting' });
});

test('a refused solution asks for a fresh challenge next time, and the tries per launch are bounded', async () => {
  const h = harness();
  const real = h.respond;
  h.respond = async (url, body) => (url.endsWith('/register') ? http(422, { ok: false, error: 'challenge_expired' }) : real(url, body));
  for (let i = 1; i <= INSTALL_MAX_ATTEMPTS; i++) {
    assert.deepEqual(await h.r.ensureToken(INSTALL), { failed: 'register_challenge_expired' });
    h.c.t += INSTALL_RETRY_MS.refused + 1;
  }
  assert.equal(h.challenges, INSTALL_MAX_ATTEMPTS, 'each try used a new challenge');
  assert.deepEqual(await h.r.ensureToken(INSTALL), { skipped: 'attempts' }, 'a registration loop would be a CPU loop');
  assert.equal(h.challenges, INSTALL_MAX_ATTEMPTS);
});

test('a token the server refuses is forgotten, and the install registers again', async () => {
  const h = harness();
  h.tokens[INSTALL] = 'fit1.from-an-old-server-key';
  h.r.invalidate(INSTALL);
  assert.equal(h.tokens[INSTALL], undefined);
  const r = await h.r.ensureToken(INSTALL);
  assert.ok(r.token && r.token !== 'fit1.from-an-old-server-key');
});

test('telemetry turned off mid-solve: the solve stops and no token is asked for', async () => {
  const h = harness();
  h.difficulty = 22;
  let yields = 0;
  const r = createInstallRegistrar({
    fetchImpl: async (url, init) => { const body = JSON.parse(init.body); h.calls.push({ url }); return h.respond(url, body); },
    challengeEndpoint: 'https://x.test/challenge', registerEndpoint: 'https://x.test/register',
    sha256: boundedSha256(50_000, 'the solve did not stop when telemetry was turned off'), now: h.c.now, sleep: h.c.sleep,
    yieldFn: async () => { if (++yields === 2) h.enabled = false; },
    isEnabled: () => h.enabled, loadToken: () => undefined, saveToken: () => { throw new Error('must not be reached'); }, clearToken: () => {},
  });
  assert.deepEqual(await r.ensureToken(INSTALL), { skipped: 'aborted' });
  assert.deepEqual(h.calls.map((c) => c.url.split('/').pop()), ['challenge'], 'the register call was never made');
});

test('the same code runs on both platforms: nothing here reads the platform', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../funnelInstall.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/process\.platform|worker_threads|new Worker/.test(code));
});
