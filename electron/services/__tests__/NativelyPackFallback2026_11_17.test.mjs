// 2026-11-17 (Evin). One app, two Natively keys: the server keeps packs and
// monthly/yearly plans on separate keys, and the app holds both. Every pack a
// customer buys lands on their one pack key. The pack is used FIRST (Evin,
// 2026-11-18): a live held pack is the key in use, whatever the plan has left,
// until the PACK's own time is over, or until it runs out of something the plan
// still has (AI, voice, knowledge, research). Then the plan's key is back.
//
// The controller is pure (every dependency injected), so these tests are the
// behaviour macOS and Windows both get: nothing in it, or in its wiring, branches
// on the operating system. Physical runs on both are still owed for the voice
// pipeline rebuild and the Settings row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createNativelyPackFallback, decideKeySlot, familyOf, choosePackOrPlan, usedUp, researchGoesToPlan, UNKNOWN_PACK_END_HOLD_MS, RETRY_MS, WATCH_MS, END_GRACE_MS, PACK_TAKEN_MESSAGE,
} from '../packs/nativelyPackFallback.ts';
import { createPackMeetingClock, TICK_INTERVAL_MS } from '../packs/PackMeetingClock.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', '..', rel), 'utf8');

const MAIN = 'natively_sk_' + 'm'.repeat(40);
const PACK = 'natively_sk_' + 'p'.repeat(40);
const NOW = Date.parse('2026-11-17T12:00:00Z');
const REFILL = '2026-12-01T00:00:00.000Z';
const PACK_END = '2026-11-22T12:00:00.000Z';  // Heavy: 5 days from purchase
const SPACING = 21_000;                        // plan-limit events closer than 20 s share one look

const quota = (ai, voice) => ({ ai: { remaining: ai }, voice: { remaining: voice } });
const maxUsage = { ok: true, plan: 'max', billing_period: 'monthly', quota: quota(100, 100) };
const maxAiOut = { ...maxUsage, quota: quota(0, 100) };
const maxVoiceOut = { ...maxUsage, quota: quota(100, 0) };
const planEnded = { ok: false, error: 'subscription_inactive', status: 403 };
const heavyUsage = { ok: true, plan: 'pack_heavy', billing_period: 'pack', pack: { ended: false, ends_at: PACK_END }, quota: quota(100, 100) };
const heavy = (over) => ({ ...heavyUsage, ...over });

function world(over = {}) {
  let now = over.now ?? NOW;
  const store = { main: 'main' in over ? over.main : MAIN, pack: 'pack' in over ? over.pack : PACK, until: over.until };
  const usage = { [MAIN]: maxAiOut, [PACK]: heavyUsage, ...(over.usage || {}) };
  const resyncs = [];
  const notes = [];
  const timers = [];
  const fetched = [];
  const fb = createNativelyPackFallback({
    getMainKey: () => store.main,
    getPackKey: () => store.pack,
    getInUseUntil: () => store.until,
    setInUseUntil: (iso) => { store.until = iso || undefined; },
    fetchUsage: async (key) => {
      fetched.push(key);
      const u = usage[key];
      if (u === 'throw') throw new Error('offline');
      return u ?? { ok: false, error: 'invalid_key', status: 401 };
    },
    resync: async (reason) => { resyncs.push(reason); if (over.resyncGate) await over.resyncGate(reason); },
    notify: (s) => notes.push(s),
    isPlaceholderKey: (k) => k === '__trial__',
    now: () => now,
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    log: { log() {}, warn() {} },
  });
  const live = () => timers.filter((t) => t.live);
  return { fb, store, usage, resyncs, notes, timers, live, fetched, advance: (ms) => { now += ms; } };
}

// The server's real meter shapes (natively-api lib/resourceUsage.js): knowledge
// is two halves, research counts runs beside dollars, limit null = unmetered.
const full = (over = {}) => ({
  ai: { limit: 100, remaining: 100 },
  voice: { limit: 100, remaining: 100 },
  knowledge: { embedding: { limit: 100, remaining: 100 }, reranker: { limit: 100, remaining: 100 } },
  research: { limit: 1, remaining: 0.5, runs_limit: 10, runs_remaining: 5 },
  ...over,
});
const plan = (q) => ({ ok: true, plan: 'standard', billing_period: 'monthly', quota: q });
const pack = (q) => ({ ok: true, plan: 'pack_heavy', billing_period: 'pack', pack: { ended: false, ends_at: PACK_END }, quota: q });
const researchOut = { limit: 1, remaining: 0, runs_limit: 10, runs_remaining: 0 };
const knowledgeOut = { embedding: { limit: 100, remaining: 0 }, reranker: { limit: 100, remaining: 100 } };

test('Evin 11-18: a live pack is used first; it stops only for something the plan can still answer', () => {
  const c = (m, p, inUse = false) => choosePackOrPlan({ mainUsage: m, packUsage: p, packInUse: inUse });
  assert.deepEqual([...usedUp(plan(full({ research: researchOut })))], ['research']);
  assert.deepEqual([...usedUp(plan(full({ knowledge: knowledgeOut })))], ['knowledge']);
  assert.deepEqual([...usedUp(plan(full({ knowledge: { embedding: { limit: 100, remaining: 100 }, reranker: { limit: 5, remaining: 0 } } })))], ['knowledge'], 'either half out');
  // a healthy plan does not keep the pack waiting
  assert.equal(c(plan(full()), pack(full())), 'pack');
  // the plan's answer is not even needed while the pack has everything
  assert.equal(c(null, pack(full())), 'pack', 'plan offline, pack fine');
  assert.equal(c({ ok: false, status: 503 }, pack(full())), 'pack');
  // the pack's research runs out: the pack stays in use (research goes to the plan on its own)
  assert.equal(c(plan(full()), pack(full({ research: researchOut })), true), 'pack');
  assert.equal(researchGoesToPlan(pack(full({ research: researchOut })), plan(full())), true);
  // knowledge has no such route: the plan answers
  assert.equal(c(plan(full()), pack(full({ knowledge: knowledgeOut }))), 'plan');
  assert.equal(c(plan(full()), pack(full({ ai: { limit: 100, remaining: 0 } })), true), 'plan');
  // research stays on the pack (refused there) for a plan without research (limit 0) or with none left
  const noResearch = { limit: 0, remaining: 0, runs_limit: 0, runs_remaining: 0 };
  assert.equal(researchGoesToPlan(pack(full({ research: researchOut })), plan(full({ research: noResearch }))), false);
  assert.equal(researchGoesToPlan(pack(full({ research: researchOut })), plan(full({ research: researchOut }))), false);
  // a plan without knowledge (limit 0) gets no hand-back for knowledge either
  assert.equal(c(plan(full({ knowledge: { embedding: { limit: 0, remaining: 0 }, reranker: { limit: 0, remaining: 0 } } })), pack(full({ knowledge: knowledgeOut })), true), 'pack');
  // unmetered on the plan counts as "has it"
  assert.equal(researchGoesToPlan(pack(full({ research: researchOut })), plan(full({ research: { limit: null, remaining: null, runs_limit: null, runs_remaining: null } }))), true);
  // the pack still has research: it does its own research
  assert.equal(researchGoesToPlan(pack(full()), plan(full())), false);
  assert.equal(researchGoesToPlan(pack(full({ research: researchOut })), null), false, 'no answer about the plan');
  // stable: the same answer whether or not the pack is in use (no flip-flop)
  const m = plan(full()), p = pack(full({ knowledge: knowledgeOut }));
  assert.equal(c(m, p, false), c(m, p, true));
  // an ended plan has nothing: the pack serves even with its research spent
  assert.equal(c(planEnded, pack(full({ research: researchOut }))), 'pack');
  // a pack partly spent and no answer about the plan: keep what is in use
  assert.equal(c(null, pack(full({ knowledge: knowledgeOut }))), 'unknown');
});

test('research and knowledge refusals ask the pack switch to look now; only Natively\'s own, never on a trial', () => {
  const emb = read('electron/rag/providers/NativelyEmbeddingProvider.ts');
  assert.match(emb, /if \(res\.status === 429 && this\.apiKey !== TRIAL_SENTINEL_KEY\) \{[\s\S]{0,200}nudgeNativelyPackFallback/);
  const rr = read('electron/services/reranking/OpenRouterReranker.ts');
  assert.match(rr, /res\.status === 429 && this\.options\.providerId === 'natively' && attempt === 0\) \{[\s\S]{0,200}nudgeNativelyPackFallback\('reranker_quota_exceeded'\)/);
  // every research path (company research, chat web search) goes through the one resolver
  const res = read('electron/services/resolveCompanySearchProvider.ts');
  assert.match(res, /if \(nativelyKey !== TRIAL_SENTINEL_KEY[\s\S]{0,400}if \(provider\.quotaExhausted\) \{[\s\S]{0,200}nudgeNativelyPackFallback\('search_quota_exceeded'\)/);
  // not the shared plan-limit event: the trial end listens to that
  const fb = read('electron/services/packs/nativelyPackFallback.ts');
  assert.match(fb, /export function nudgeNativelyPackFallback\(code: string\): void \{\s*try \{ void currentNativelyPackFallback\(\)\?\.onPlanLimit\(\{ code, onTrial: false \}\)/);
});

test('Evin 11-18: the pack stays in use; research uses the plan\'s research once the pack\'s runs are spent', async () => {
  const w = world({ usage: { [MAIN]: plan(full()), [PACK]: pack(full()) } });
  await w.fb.start();
  assert.equal(w.store.until, PACK_END);
  assert.equal(w.fb.researchKey(), null, 'the pack does its own research while it has runs');
  w.usage[PACK] = pack(full({ research: researchOut }));   // its last run is spent
  w.advance(SPACING);
  await w.fb.onPlanLimit({ code: 'search_quota_exceeded', onTrial: false });
  assert.equal(w.store.until, PACK_END, 'the pack stays in use');
  assert.equal(w.resyncs.length, 1, 'nothing re-pointed');
  assert.equal(w.fb.researchKey(), MAIN, 'research goes to the plan');
  w.usage[MAIN] = plan(full({ research: researchOut }));   // the plan's research runs out too
  w.advance(SPACING);
  await w.fb.onPlanLimit({ code: 'search_quota_exceeded', onTrial: false });
  assert.equal(w.fb.researchKey(), null);
  w.usage[MAIN] = plan(full());
  w.advance(SPACING);
  await w.fb.onPlanLimit({ code: 'search_quota_exceeded', onTrial: false });
  assert.equal(w.fb.researchKey(), MAIN);
  w.store.main = 'natively_sk_' + 'z'.repeat(40);           // a key changed since the last look
  assert.equal(w.fb.researchKey(), null, 'no stale answer');
  // not in use: the key in use is the plan's anyway
  const off = world({ usage: { [MAIN]: plan(full()), [PACK]: pack(full({ pack: { ended: true } })) } });
  await off.fb.start();
  assert.equal(off.fb.researchKey(), null);
});

test('company research asks the pack switch which key to use', () => {
  const src = read('electron/services/resolveCompanySearchProvider.ts');
  assert.match(src, /researchKey = currentNativelyPackFallback\(\)\?\.researchKey\(\) \?\? null;/);
  assert.match(src, /const nativelyKey = researchKey \?\? cm\.getNativelyApiKey\(\);/);
});

test('what is used up, and which key serves', () => {
  assert.deepEqual([...usedUp(maxAiOut)], ['ai']);
  assert.deepEqual([...usedUp(maxVoiceOut)], ['voice']);
  assert.equal(usedUp({ ok: false }), null);
  const c = (mainUsage, packUsage, packInUse = false) => choosePackOrPlan({ mainUsage, packUsage, packInUse });
  assert.equal(c(maxUsage, heavyUsage), 'pack', 'pack first, plan fine');
  assert.equal(c(maxAiOut, heavyUsage), 'pack', 'plan AI used up');
  assert.equal(c(planEnded, heavyUsage), 'pack', 'plan cancelled / expired / payment failed');
  assert.equal(c(maxUsage, heavyUsage, true), 'pack', 'in use: spent first, even after the refill');
  assert.equal(c(maxUsage, heavy({ quota: quota(0, 100) }), true), 'plan', 'the pack ran out of AI the plan has');
  assert.equal(c(maxAiOut, heavy({ quota: quota(0, 100) }), true), 'pack', 'both out of AI: the pack still has voice');
  assert.equal(c(maxVoiceOut, heavy({ quota: quota(0, 100) })), 'plan', 'never refuse AI the plan has for a pack with none');
  assert.equal(c(maxAiOut, heavy({ pack: { ended: true } })), 'plan', 'an ended pack');
  assert.equal(c(maxAiOut, planEnded), 'plan', 'a refused pack key');
  assert.equal(c(maxAiOut, null), 'unknown', 'no answer about the pack');
  assert.equal(c(null, heavyUsage, true), 'pack', 'no answer about the plan: the pack has everything');
  assert.equal(c(null, heavy({ quota: quota(0, 100) }), true), 'unknown', 'pack out of AI, plan unknown');
  assert.equal(familyOf({ plan: 'pack_light' }), 'pack');
  assert.equal(familyOf({ plan: 'max', billing_period: 'yearly' }), 'subscription');
  assert.equal(familyOf({}), null);
});

test('where a pasted key goes: one pack key per customer', () => {
  const d = (newUsage, mainUsage, extra = {}) => decideKeySlot({ newKey: 'NEW', mainKey: MAIN, packKey: undefined, newUsage, mainUsage, ...extra });
  assert.equal(d(heavyUsage, maxUsage), 'pack', 'a pack beside a live plan is held');
  assert.equal(d(maxUsage, heavyUsage), 'swap', 'a plan over a live pack holds the pack');
  assert.equal(d(maxUsage, heavy({ pack: { ended: true } })), 'main', 'an ended pack is simply replaced');
  assert.equal(d(maxUsage, maxUsage), 'main', 'plan over plan: replaced, as before');
  assert.equal(d(heavyUsage, heavyUsage), 'pack_taken', 'a second pack key over a live saved pack: refused');
  assert.equal(d(heavyUsage, heavy({ pack: { ended: true } })), 'main', 'a new pack over an ended one');
  assert.equal(d(heavyUsage, maxUsage, { packKey: PACK, packUsage: heavyUsage }), 'pack_taken', 'a second pack key beside a live held one: refused');
  assert.equal(d(heavyUsage, maxUsage, { packKey: PACK, packUsage: null }), 'pack_taken', 'no answer about the held pack: kept, never thrown away');
  assert.equal(d(heavyUsage, maxUsage, { packKey: PACK, packUsage: heavy({ pack: { ended: true } }) }), 'pack', 'the held pack is over: the new one replaces it');
  assert.equal(d(maxUsage, maxUsage, { packKey: PACK, packUsage: heavyUsage }), 'main', 'a plan key is not a second pack');
  assert.equal(d({ ok: false }, maxUsage), 'main', 'a refused key: the save reports it, as before');
  assert.equal(d(heavyUsage, { ok: false }), 'main', 'a saved key that no longer works is replaced');
  assert.equal(decideKeySlot({ newKey: PACK, mainKey: MAIN, packKey: PACK, newUsage: null, mainUsage: null }), 'same');
  assert.equal(decideKeySlot({ newKey: 'NEW', mainKey: undefined, newUsage: heavyUsage, mainUsage: null }), 'main', 'no saved key');
  assert.equal(decideKeySlot({ newKey: 'NEW', mainKey: '__trial__', mainIsPlaceholder: true, newUsage: heavyUsage, mainUsage: null }), 'main', 'a trial is not a plan');
  assert.match(PACK_TAKEN_MESSAGE, /remove the current pack first/);
});

test('slotForSave asks the server about every key involved', async () => {
  const w = world({ pack: undefined, usage: { NEWPACK: heavyUsage } });
  assert.equal(await w.fb.slotForSave('NEWPACK'), 'pack');
  assert.deepEqual(w.fetched.sort(), [MAIN, 'NEWPACK'].sort());
  const held = world({ usage: { NEWPACK: heavyUsage } });
  assert.equal(await held.fb.slotForSave('NEWPACK'), 'pack_taken');
  assert.ok(held.fetched.includes(PACK), 'the held pack is asked about');
  const t = world({ main: '__trial__', pack: undefined });
  assert.equal(await t.fb.slotForSave(PACK), 'main');
  assert.equal(t.fetched.length, 0, 'a trial never asks');
});

test('pack first: in use at startup and on a plan-limit refusal, until the pack\'s own end', async () => {
  const healthy = world({ usage: { [MAIN]: maxUsage } });
  await healthy.fb.start();
  assert.equal(healthy.store.until, PACK_END, 'a healthy plan does not keep the pack waiting');
  assert.deepEqual(healthy.resyncs, ['pack first (startup)']);
  assert.deepEqual(healthy.notes.map((n) => [n.inUse, n.until, n.reason]), [[true, PACK_END, 'pack_first']]);

  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(w.store.until, PACK_END);
  assert.deepEqual(w.resyncs, ['pack first (ai_quota_exceeded)']);
  assert.equal(w.live().length, 1, 'a timer for the end');
  assert.ok(w.live()[0].ms <= 6 * 3600_000, 'long waits re-arm, never overflow setTimeout');
  w.advance(SPACING);
  await w.fb.onPlanLimit({ code: 'transcription_quota_exceeded', onTrial: false });
  assert.equal(w.resyncs.length, 1, 'a second refusal while in use changes nothing');

  // a pack key pasted (or a plan key saved beside a pack): in use at once
  const pasted = world({ usage: { [MAIN]: maxUsage } });
  await pasted.fb.check('pack key held');
  assert.equal(pasted.store.until, PACK_END);
  const saved = world({ usage: { [MAIN]: maxUsage } });
  await saved.fb.check('plan key saved beside a pack');
  assert.equal(saved.store.until, PACK_END);
});

test('two refusals at once switch once', async () => {
  const w = world();
  await Promise.all([
    w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false }),
    w.fb.onPlanLimit({ code: 'transcription_quota_exceeded', onTrial: false }),
  ]);
  assert.equal(w.resyncs.length, 1);
});

test('nothing switches for a trial, no held pack, a trial key or a dead pack', async () => {
  for (const [over, limit] of [
    [{}, { code: 'ai_quota_exceeded', onTrial: true }],
    [{ pack: undefined }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ main: '__trial__' }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ usage: { [PACK]: planEnded } }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ usage: { [PACK]: heavy({ pack: { ended: true } }) } }, { code: 'ai_quota_exceeded', onTrial: false }],
  ]) {
    const w = world(over);
    await w.fb.onPlanLimit(limit);
    assert.equal(w.store.until, undefined, JSON.stringify(over));
    assert.equal(w.resyncs.length, 0);
  }
});

test('the plan ended (cancelled, expired, payment failed): the pack is in use, at startup too', async () => {
  const w = world({ usage: { [MAIN]: planEnded } });
  await w.fb.start();
  assert.equal(w.store.until, PACK_END);
  assert.deepEqual(w.notes.map((n) => n.reason), ['plan_ended']);
  assert.match(w.resyncs[0], /^plan ended \(subscription_inactive\)$/);

  // mid-meeting: the pack clock reports the saved key refused
  const m = world({ usage: { [MAIN]: planEnded } });
  await m.fb.check('pack_ended');
  assert.equal(m.store.until, PACK_END, 'not in use yet, so both keys are asked');

  // a held pack that stopped early is looked at again every WATCH_MS
  const watch = world({ usage: { [MAIN]: maxUsage, [PACK]: heavy({ quota: quota(0, 100) }) } });
  await watch.fb.start();
  assert.equal(watch.store.until, undefined, 'its AI is spent and the plan has AI');
  assert.equal(watch.live().length, 1);
  assert.equal(watch.live()[0].ms, WATCH_MS);
  watch.usage[MAIN] = planEnded;
  watch.advance(WATCH_MS);
  await watch.live()[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(watch.store.until, PACK_END, 'the watch finds the ended plan');
});

test('the pack runs past the plan\'s refill: still the pack until its own end', async () => {
  const late = '2026-12-05T00:00:00.000Z';
  const w = world({ usage: { [PACK]: heavy({ pack: { ended: false, ends_at: late } }) } });
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(w.store.until, late);
  w.usage[MAIN] = maxUsage;                  // the plan refills
  w.advance(Date.parse(REFILL) - NOW + 1);
  await w.fb.check('timer');
  assert.equal(w.store.until, late, 'the pack is spent first: it expires, the plan does not');
  assert.equal(w.resyncs.length, 1);
});

test('the pack runs out of something the plan has again: back to the plan at once', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.usage[MAIN] = maxUsage;                              // refilled on Dec 1
  w.usage[PACK] = heavy({ quota: quota(0, 100) });       // the pack's AI ran out on Dec 2
  w.advance(SPACING);
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });  // the refusal is on the pack key
  assert.equal(w.store.until, undefined);
  assert.equal(w.resyncs.at(-1), 'plan key back: pack used up what the plan still has');

  // no ping-pong: the plan's voice is out, the pack's AI is out
  const p = world({ usage: { [MAIN]: maxVoiceOut, [PACK]: heavy({ quota: quota(0, 100) }) } });
  await p.fb.onPlanLimit({ code: 'transcription_quota_exceeded', onTrial: false });
  assert.equal(p.store.until, undefined, 'the plan keeps its AI');
  assert.equal(p.resyncs.length, 0);

  // both out of AI: the pack stays (it still has voice)
  const b = world();
  await b.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  b.usage[PACK] = heavy({ quota: quota(0, 100) });
  b.advance(SPACING);
  await b.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(b.store.until, PACK_END);
  assert.equal(b.resyncs.length, 1);
});

test('no answer from the server at the pack\'s end: the pack stays in use, asked again later', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.usage[PACK] = 'throw';
  w.usage[MAIN] = 'throw';
  w.advance(Date.parse(PACK_END) - NOW + 1);
  await w.fb.check('timer');
  assert.equal(Date.parse(w.store.until), Date.parse(PACK_END) + 1 + RETRY_MS, 'kept for another look');
  assert.equal(w.resyncs.length, 1, 'extending the time re-points nothing: the voice pipeline is not rebuilt');
  assert.ok(!w.resyncs.some((r) => r.startsWith('plan key back')), 'never the used-up plan on a blip');
  assert.equal(w.live().at(-1).ms, RETRY_MS);
  // the outage goes on: still no re-sync on each 15-minute look
  w.advance(RETRY_MS);
  await w.fb.check('timer');
  assert.equal(w.resyncs.length, 1);
});

test('this clock runs ahead of the server: past the use-by but not ended there, asked again in a minute', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.advance(Date.parse(PACK_END) - NOW + 2000);   // 2 s past ends_at here; the server still says live
  await w.fb.check('timer');
  const now = Date.parse(PACK_END) + 2000;
  assert.equal(Date.parse(w.store.until), now + END_GRACE_MS, 'not a 24-hour hold');
  assert.equal(w.resyncs.length, 1);
  w.usage[PACK] = planEnded;                       // a minute later the server has ended it
  w.advance(END_GRACE_MS);
  await w.fb.check('timer');
  assert.equal(w.store.until, undefined);
  assert.equal(w.resyncs.at(-1), 'plan key back: pack time over');
});

test('a restart after the stored time passed re-points the consumers if the pack stays in use', async () => {
  const w = world({ until: '2026-11-17T11:00:00.000Z' });   // an hour before NOW: CredentialsManager gave out the plan's key
  await w.fb.start();
  assert.equal(w.store.until, PACK_END);
  assert.equal(w.resyncs.length, 1, 'the consumers started on the plan key and are moved back to the pack');
});

test('a key changed while the server was being asked: the new keys are asked about, not the old answers used', async () => {
  const NEWPACK = 'natively_sk_' + 'n'.repeat(40);
  const w = world({ usage: { [NEWPACK]: heavy({ pack: { ended: false, ends_at: '2026-11-25T00:00:00.000Z' } }) } });
  const p = w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.store.pack = NEWPACK;                 // pasted while the server was being asked about the old pack
  await p;
  assert.equal(w.store.until, '2026-11-25T00:00:00.000Z', 'the NEW pack\'s end, from a fresh look');
  assert.ok(w.fetched.includes(NEWPACK));
});

test('a held pack that is over is looked at rarely, and a new pack on its key is noticed', async () => {
  const w = world({ usage: { [MAIN]: maxUsage, [PACK]: heavy({ pack: { ended: true } }) } });
  await w.fb.start();
  assert.equal(w.live().length, 1);
  assert.equal(w.live()[0].ms, 6 * 3600_000, 'every 6 hours, not every 30 minutes');
  assert.equal(w.store.until, undefined);
  // a new pack lands on the same key (packs stack): the slow look finds it
  w.usage[PACK] = heavyUsage;
  w.advance(6 * 3600_000);
  await w.live()[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.store.until, PACK_END, 'used first again');
  // Plans & Billing reading the held pack live asks for a look at once
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /if \(opts\?\.which === 'pack' && data\?\.pack && !data\.pack\.ended\) \{[\s\S]{0,400}if \(fb && st\?\.held && !st\.inUse && !st\.stoppedEarly\) void fb\.check\('held pack live again'\)/);
});

test('review 11-18: the plan ends while the pack is in use: announced once, so Pro moves to the pack key', async () => {
  const w = world({ usage: { [MAIN]: maxUsage } });
  await w.fb.start();
  assert.deepEqual(w.resyncs, ['pack first (startup)']);
  // looked at while in use, at least every WATCH_MS
  assert.ok(w.live()[0].ms <= WATCH_MS, 'in use: still looks every 30 minutes');
  w.usage[MAIN] = planEnded;
  w.advance(WATCH_MS);
  await w.fb.check('timer');
  assert.equal(w.resyncs.at(-1), 'plan ended (subscription_inactive)', 'announced: the Pro gate keys on "plan ended"');
  assert.equal(w.notes.at(-1).reason, 'plan_ended');
  const n = w.resyncs.length;
  w.advance(WATCH_MS);
  await w.fb.check('timer');
  assert.equal(w.resyncs.length, n, 'once, not on every look');
  // the licence re-check losing Pro while a pack is in use asks for that look
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /onLost: async \(\) => \{[\s\S]{0,900}if \(fb\?\.state\(\)\.inUse\) \{[\s\S]{0,120}await fb\.check\('licence lost'\);/);
});

test('review 11-18: a key change during a look is looked at again, not absorbed', async () => {
  const NEWPACK = 'natively_sk_' + 'q'.repeat(40);
  let release;
  const gate = new Promise((r) => { release = r; });
  let gated = 0;
  const w = world({
    usage: { [MAIN]: maxUsage, [NEWPACK]: heavy({ pack: { ended: false, ends_at: '2026-11-25T00:00:00.000Z' } }) },
    // the first look's resync is slow (the voice pipeline rebuilding): it is past the key comparison
    resyncGate: () => (gated++ === 0 ? gate : undefined),
  });
  const first = w.fb.start();
  while (w.resyncs.length === 0) await new Promise((r) => setImmediate(r));
  w.store.pack = NEWPACK;          // pasted now
  w.store.until = undefined;       // CredentialsManager clears the time on a key change
  const second = w.fb.check('pack key held');
  release();
  await Promise.all([first, second]);
  assert.equal(w.store.until, '2026-11-25T00:00:00.000Z', 'the new pack is in use with its own end');
  assert.ok(w.fetched.includes(NEWPACK), 'the new key was asked about');
});

test('review 11-18: a pack over before any meeting still stands the Pro features down', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /await recheckProNow\(\);[\s\S]{0,300}standDownIfNoPro\('pack over, plan key back'\);/);
});

test('state says when a live pack stopped early (for the Settings line)', async () => {
  const w = world({ usage: { [MAIN]: maxUsage, [PACK]: heavy({ quota: quota(0, 100) }) } });
  await w.fb.start();
  assert.equal(w.fb.state().stoppedEarly, true);
  const over = world({ usage: { [MAIN]: maxUsage, [PACK]: heavy({ pack: { ended: true } }) } });
  await over.fb.start();
  assert.equal(over.fb.state().stoppedEarly, false, 'an ended pack is not "used again"');
  const fresh = world({ usage: { [MAIN]: maxUsage } });
  assert.equal(fresh.fb.state().stoppedEarly, false, 'not looked at yet');
});

test('an unknown pack end: held a day with no date shown, then the real end', async () => {
  const w = world({ usage: { [PACK]: heavy({ pack: { ended: false } }) } });
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(Date.parse(w.store.until), NOW + UNKNOWN_PACK_END_HOLD_MS);
  assert.equal(w.notes.at(-1).inUse, true);
  assert.equal(w.notes.at(-1).until, null, 'no made-up date for the Settings note');
  w.usage[PACK] = heavyUsage;                // now the server names the use-by
  w.advance(UNKNOWN_PACK_END_HOLD_MS - 1000);
  await w.fb.check('timer');
  assert.equal(w.store.until, PACK_END, 'kept, now to the real end');
  assert.equal(w.fb.state().until, PACK_END);
});

test('back to the plan\'s key: pack time over, pack ended, pack key removed', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.usage[PACK] = planEnded;                 // past its use-by
  w.advance(Date.parse(PACK_END) - NOW + 1);
  await w.fb.check('timer');
  assert.equal(w.store.until, undefined);
  assert.deepEqual(w.resyncs, ['pack first (ai_quota_exceeded)', 'plan key back: pack time over']);
  assert.equal(w.notes.at(-1).inUse, false);

  const e = world();
  await e.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  await e.fb.check('pack_ended');
  assert.equal(e.store.until, undefined, 'the pack clock says the pack ended');

  const r = world({ until: PACK_END, pack: undefined });
  await r.fb.check('remove');
  assert.equal(r.resyncs.at(-1), 'plan key back: pack key removed');
});

test('live test 11-18: the pack key refused mid-session (hours used elsewhere, refund): back to the plan on the refusal', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.ok(w.store.until, 'pack in use');
  w.usage[PACK] = planEnded;                 // 403 subscription_inactive, before its use-by
  w.advance(30_000);                         // past the event spacing
  await w.fb.onPlanLimit({ code: 'subscription_inactive', onTrial: false });
  assert.equal(w.store.until, undefined, 'the refusal itself brings the plan key back');
  assert.equal(w.resyncs.at(-1), 'plan key back: pack time over');

  const llm = read('electron/LLMHelper.ts');
  assert.match(llm, /if \(\(status === 401 \|\| status === 403\) && !onTrial\) \{\n(?:\s*\/\/[^\n]*\n)*?\s*try \{\n\s*\(require\('\.\/services\/packs\/nativelyPackFallback'\)[^\n]*\n\s*\.nudgeNativelyPackFallback\(/,
    'an AI answer refused with 401/403 nudges the pack switch, on the stream and JSON paths alike');
  assert.equal((llm.match(/this\.noteNativelyPlanLimit\(response\.status/g) || []).length, 2, 'both Natively paths go through it');
});

test('after a restart: a still-good pack stays in use; a refused one ends; an outage changes nothing', async () => {
  const keep = world({ until: PACK_END });
  await keep.fb.start();
  assert.equal(keep.store.until, PACK_END);
  assert.equal(keep.resyncs.length, 0);
  assert.equal(keep.live().length, 1);

  const refused = world({ until: PACK_END, usage: { [PACK]: planEnded } });
  await refused.fb.start();
  assert.equal(refused.store.until, undefined);

  for (const flaky of [{ ok: false, error: 'network_error' }, { ok: false, error: 'rate_limited', status: 429 }, 'throw']) {
    const w = world({ until: PACK_END, usage: { [PACK]: flaky } });
    await w.fb.start();
    assert.equal(w.store.until, PACK_END, JSON.stringify(flaky));
    assert.equal(w.resyncs.length, 0);
  }
});

test('the pack clock follows a key change mid-meeting: plan time unbilled, pack time billed to the pack', async () => {
  let key = MAIN;
  let now = 1_000_000;
  const sent = [];
  const timers = [];
  const clock = createPackMeetingClock({
    getApiKey: () => key,
    postTick: async (k, body) => {
      sent.push({ key: k, ...body });
      return k === PACK
        ? { status: 200, body: { ok: true, metered: true, pack: { ended: false } } }
        : { status: 200, body: { ok: true, metered: false } };
    },
    now: () => now,
    every: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    newMeetingId: (() => { let i = 0; return () => `mtg_${++i}`; })(),
    onPackEnded: () => {},
    log: { log() {}, warn() {} },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  const tick = async () => { now += TICK_INTERVAL_MS; for (const t of timers) if (t.live) t.fn(); await settle(); await settle(); };

  clock.meetingStarted();
  await tick();                          // the plan's key: the server says "not a pack"
  assert.deepEqual(sent.map((s) => s.key), [MAIN]);
  await tick();
  assert.equal(sent.length, 1, 'a plan key is not metered after the first answer');

  key = PACK;                            // the plan ran out; the pack takes over
  clock.keyChanged();
  await tick();
  assert.equal(sent.at(-1).key, PACK, w(sent));
  assert.equal(sent.at(-1).seconds, 60);
  assert.notEqual(sent.at(-1).meeting_id, sent[0].meeting_id, 'a new meeting record on the pack');

  key = MAIN;                            // refilled mid-meeting
  clock.keyChanged();
  const before = sent.filter((s) => s.key === PACK).length;
  await tick(); await tick();
  assert.equal(sent.filter((s) => s.key === PACK).length, before, 'no pack time after the plan is back');

  await clock.meetingEnded();
  key = PACK;
  clock.keyChanged();
  assert.equal(timers.filter((t) => t.live).length, 0, 'no meeting, nothing to start');
});
const w = (x) => JSON.stringify(x);

test('wiring: one key in use for everything, chosen in one place', () => {
  const cm = read('electron/services/CredentialsManager.ts');
  assert.match(cm, /public getNativelyApiKey\(now: number = Date\.now\(\)\): string \| undefined \{\n\s+return this\.isNativelyPackInUse\(now\) \? this\.credentials\.nativelyPackApiKey : this\.credentials\.nativelyApiKey;/);
  assert.match(cm, /nativelyPackApiKey\?: string;/);

  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /onNativelyPlanLimit\(\(limit\) => \{ void packFallback\.onPlanLimit\(limit\); \}\);/);
  assert.match(ipc, /const slot = await packFallback\.slotForSave\(pastedKey\);/);
  assert.match(ipc, /const routed = await routePastedNativelyKey\(cm, apiKey\);[^\n]*\n\s+if \(routed\.done\) return routed\.done;\n\s+apiKey = routed\.apiKey;/);
  assert.match(ipc, /packMeetingClockIfStarted\(\)\?\.keyChanged\(\);/);
  assert.match(ipc, /await appState\.reconfigureSttProvider\(\);/);
  assert.match(ipc, /\(family === 'pack' \? cm\.getNativelyPackApiKey\(\) : undefined\) \?\? cm\.getMainNativelyApiKey\(\);\n\s+if \(!key\) return \{ ok: false, error: 'no_key' \};\n\s+const res = await fetch\(`\$\{NATIVELY_API_BASE\}\/v1\/upgrade-link`/, 'plan purchases signed with the saved key, packs with the pack key');
  assert.match(ipc, /if \(slot === 'pack_taken'\) \{/);
  assert.match(ipc, /const \{ recheckProNow \} = require\('\.\/services\/packs\/packClockWiring'\)/);
  assert.match(read('src/components/settings/NativelyApiSettings.tsx'), /onBuy=\{\(url: string\) => openExternal\(url, 'pack'\)\}/);
  assert.match(cm, /if \(\(trimmed \|\| undefined\) !== this\.credentials\.nativelyPackApiKey\) this\.credentials\.nativelyPackInUseUntil = undefined;/);
  assert.match(ipc, /safeHandle\('get-natively-pack-key'/);
  assert.match(ipc, /safeHandle\('remove-natively-pack-key'/);
  // the pack key itself never crosses to the renderer, only its last four
  assert.match(ipc, /last4: pack \? pack\.slice\(-4\) : null,/);

  const stt = read('electron/audio/NativelyProSTT.ts');
  assert.match(stt, /msg\.error === 'transcription_quota_exceeded' && this\.apiKey !== TRIAL_SENTINEL_KEY\) \{\n\s+emitNativelyPlanLimit\(\{ code: 'transcription_quota_exceeded', onTrial: false \}\);/);

  const wiring = read('electron/services/packs/packClockWiring.ts');
  assert.match(wiring, /currentNativelyPackFallback\(\)\?\.check\('pack_ended'\)/);
  assert.match(wiring, /Symbol\.for\('natively\.packMeetingClock'\)/);

  const panel = read('src/components/settings/NativelyApiSettings.tsx');
  assert.match(panel, /getNativelyUsage\(force, 'main'\)/);
  assert.match(panel, /data-held-pack/);
});

test('review 2026-11-17: Pro moves to the pack key only without Pro or once the plan ended; teardown never wiped', () => {
  const ipc = readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8');
  assert.match(ipc, /if \(!licencePremiumForWindows\(\) \|\| reason\.startsWith\('plan ended'\)\)/,
    'a Pro/Max plan licence stays on the plan key while a pack tops it up');
  assert.match(ipc, /const definiteNo = !result\s*\|\| \(!result\.success && !result\.skipped && \(result\.keyRejected/,
    'an offline or 5xx activation never re-checks Pro against the old pack key');
  const wiring = readFileSync(new URL('../packs/packClockWiring.ts', import.meta.url), 'utf8');
  assert.match(wiring, /if \(onProLost\) proLostHolder\[PRO_LOST_KEY\] = onProLost;/,
    'a caller without a teardown never replaces main.ts\'s');
  assert.match(wiring, /await currentNativelyPackFallback\(\)\?\.check\('pack_ended'\);\s*\} catch[^}]*\}\s*await recheckPro\(info\.reason, proLost\(\)\)/,
    'the key in use settles before Pro is re-checked');
});

test('pack first wiring: a Pro plan keeps its own Pro, a saved plan key re-checks, the AI client gets the key in use', async () => {
  // a healthy Pro/Max/Ultra plan never reads as "plan ended", so its licence stays on its own key
  const w = world({ usage: { [MAIN]: maxUsage } });
  await w.fb.start();
  assert.ok(!w.resyncs[0].startsWith('plan ended'), w.resyncs[0]);
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /if \(apiKey && !keyRejection && cm\.getNativelyPackApiKey\(\)\) void packFallback\.check\('plan key saved beside a pack'\);/);
  assert.match(ipc, /llmHelper\.setNativelyKey\(cm\.getNativelyApiKey\(\) \|\| null\);/,
    'a plan key saved while the pack is in use does not move AI off the pack');
});

test('fix 11-18: a plan licence lost while a pack is in use: the pack takes Pro over before anything is switched off', async () => {
  const { recheckLicence } = await import('../proAccess.ts');
  // recheckLicence waits for onLost, so the caller's own stand-down runs after the pack took over
  const order = [];
  await recheckLicence(
    { isPremium: () => true, isPremiumAsync: async () => false },
    { stillAllowed: () => false, onLost: async () => { await new Promise((r) => setTimeout(r, 5)); order.push('onLost done'); } },
  );
  order.push('recheck returned');
  assert.deepEqual(order, ['onLost done', 'recheck returned']);

  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /if \(fb\?\.state\(\)\.inUse\) \{\n\s+packTakingOverPro = true;\n\s+try \{ await fb\.check\('licence lost'\); \} finally \{ packTakingOverPro = false; \}\n\s+if \(isProOrTrialActive\(\)\) \{[\s\S]{0,200}?tell\(licencePremiumForWindows\(\)\);\n\s+return;/,
    'the pack is asked first; Pro back means nothing is switched off');
  // the teardown (knowledge mode off, Pro mode cleared) comes after that early return
  const onLost = ipc.slice(ipc.indexOf('onLost: async () => {'), ipc.indexOf('onRestored: () => tell('));
  assert.ok(onLost.indexOf("await fb.check('licence lost')") < onLost.indexOf('orchestrator.setKnowledgeMode(false)'));
  assert.ok(onLost.indexOf("await fb.check('licence lost')") < onLost.indexOf('clearActiveModeOnLicenseLoss()'));
  assert.match(ipc, /const standDownIfNoPro = \(reason: string\): boolean => \{\n\s+try \{\n\s+if \(packTakingOverPro\) return false;/,
    'the 30-second Pro watch does not stand things down while the pack takes over');
});

test('fix 11-18: removing the pack key takes the pack\'s Pro with it, unless the key left has Pro', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const handler = ipc.slice(ipc.indexOf("safeHandle('remove-natively-pack-key'"), ipc.indexOf('// ── Free Trial IPC'));
  assert.match(handler, /if \(wasInUse\) await resyncNativelyKeyInUse\('pack key removed'\);\n\s+await dropRemovedPackPro\(cm\);/,
    'checked whether or not the pack was in use (a pack that stopped early still gave Pro)');
  const fn = ipc.slice(ipc.indexOf('const dropRemovedPackPro = async'), ipc.indexOf("safeHandle('remove-natively-pack-key'"));
  assert.match(fn, /if \(!licenceIsPack\(\)\) return;/, 'a plan, lifetime or Dodo licence is never touched');
  assert.match(fn, /await lm\.activateWithApiKey\(left\)/, 'Pro moves to the key left when it includes Pro');
  assert.match(fn, /if \(!moved && licenceIsPack\(\)\) \{\n\s+await lm\.deactivate\(\);[\s\S]{0,120}standDownIfNoPro\('pack key removed'\);/,
    'otherwise the pack\'s licence goes and the Pro features stand down');
});
