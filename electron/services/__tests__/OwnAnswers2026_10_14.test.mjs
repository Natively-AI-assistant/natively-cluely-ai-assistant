// "Cue Cards" in Profile Intelligence (2026-10-14): the store, the drafting run and the wipe.
//
// What the user says about themselves that no résumé states ("biggest weakness", "why did you leave", a salary
// range). Natively drafts the ones a résumé can suggest when a résumé is saved; a meeting reads an answer only once
// the user wrote or approved it. The retrieval half is pinned in
// context-intelligence/__tests__/OwnAnswersInProfile2026_10_14.test.mjs.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (the database needs Electron's native ABI).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const root = process.cwd();
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const own = require(dist('services/knowledge/ownAnswers.js'));
const drafting = require(dist('services/knowledge/ownAnswersDrafting.js'));

describe('the questions', () => {
  test('what only the user knows is never drafted', () => {
    const byKey = Object.fromEntries(own.OWN_ANSWER_QUESTIONS.map((q) => [q.key, q]));
    for (const key of ['salary', 'relocation', 'notice', 'notes']) assert.equal(byKey[key].drafted, false, key);
    for (const key of ['weakness', 'strength', 'why_field', 'why_leaving', 'why_role', 'conflict', 'failure']) assert.equal(byKey[key].drafted, true, key);
    assert.equal(byKey.why_role.needsJob, true);
  });
  test('an answer is trimmed and cut at its limit; an unknown question holds nothing', () => {
    assert.equal(own.cleanOwnAnswer('weakness', '  I ask   late.\r\n\r\n\r\n\r\nNow I ask early.  '), 'I ask late.\n\nNow I ask early.');
    assert.equal(own.cleanOwnAnswer('weakness', 'x'.repeat(5000)).length, own.OWN_ANSWER_MAX_CHARS);
    assert.equal(own.cleanOwnAnswer('notes', 'x'.repeat(5000)).length, own.OWN_ANSWER_NOTES_MAX_CHARS);
    assert.equal(own.cleanOwnAnswer('favourite_colour', 'blue'), '');
    assert.equal(own.cleanOwnAnswer('weakness', null), '');
  });
});

describe('what a meeting may read', () => {
  test('only what the user wrote or approved: a draft is never served', () => {
    const served = own.servedOwnAnswers([
      { key: 'weakness', text: 'A draft Natively wrote.', status: 'draft' },
      { key: 'salary', text: 'Between 55 and 62 thousand.', status: 'saved' },
      { key: 'strength', text: '   ', status: 'saved' },
    ]);
    assert.deepEqual(served.map((a) => [a.key, a.label, a.text]), [['salary', 'Salary expectation', 'Between 55 and 62 thousand.']]);
  });
  test('each carries how its question is asked aloud: "Salary expectation" shares no word with "what are you looking for in base?"', () => {
    const [salary] = own.servedOwnAnswers([{ key: 'salary', text: 'A range.', status: 'saved' }]);
    assert.match(salary.askedAs, /\bbase\b/);
    assert.match(salary.askedAs, /\bpay\b/);
    for (const q of own.OWN_ANSWER_QUESTIONS) assert.ok(q.askedAs.trim().length > 0, q.key);
  });
  test('in the order of the questions, whatever order the rows came in', () => {
    const served = own.servedOwnAnswers([
      { key: 'notice', text: 'Two weeks.', status: 'saved' },
      { key: 'weakness', text: 'I ask late.', status: 'saved' },
    ]);
    assert.deepEqual(served.map((a) => a.key), ['weakness', 'notice']);
  });
});

describe('the drafting prompt and its reply', () => {
  test('which questions a run may fill: draftable, not answered by the user, the role only with a job loaded', () => {
    const rows = [{ key: 'weakness', text: 'Mine.', status: 'saved' }, { key: 'strength', text: 'A draft.', status: 'draft' }];
    assert.deepEqual(own.draftableOwnAnswerKeys(rows, false), ['strength', 'why_field', 'why_leaving', 'conflict', 'failure']);
    assert.deepEqual(own.draftableOwnAnswerKeys(rows, true), ['strength', 'why_field', 'why_leaving', 'why_role', 'conflict', 'failure']);
  });
  test('the prompt lists only the asked questions, forbids facts the résumé lacks, and carries the documents', () => {
    const prompt = own.ownAnswerDraftPrompt({ resumeText: 'Jordan Avery. FitPilot, sole developer.', jobText: 'Frontend Engineer, Brightwell.', keys: ['weakness', 'why_role'] });
    assert.match(prompt, /"weakness": Biggest weakness/);
    assert.match(prompt, /"why_role": Why this role/);
    assert.doesNotMatch(prompt, /"salary"|"strength"/);
    assert.match(prompt, /Never state a number, a date, an employer, a job title, a tool, a person or a named event that the résumé does not state/);
    assert.match(prompt, /RÉSUMÉ:\nJordan Avery/);
    assert.match(prompt, /JOB DESCRIPTION:\nFrontend Engineer/);
    assert.doesNotMatch(own.ownAnswerDraftPrompt({ resumeText: 'x', keys: ['weakness'] }), /JOB DESCRIPTION/);
  });
  test('the reply: only asked, draftable keys survive, fenced or not; anything unreadable is nothing', () => {
    const reply = '```json\n{"weakness": "  I ask late.  ", "salary": "90k", "strength": "Not asked.", "why_field": 7}\n```';
    assert.deepEqual(own.parseOwnAnswerDrafts(reply, ['weakness', 'why_field', 'salary']), { weakness: 'I ask late.' });
    assert.deepEqual(own.parseOwnAnswerDrafts('I could not do that.', ['weakness']), {});
    assert.deepEqual(own.parseOwnAnswerDrafts('{"weakness": ', ['weakness']), {});
    assert.deepEqual(own.parseOwnAnswerDrafts('["weakness"]', ['weakness']), {});
  });
});

describe('a drafting run', () => {
  const deps = (over = {}) => {
    const state = { prompts: [], stored: [], finished: [], rows: over.rows ?? [] };
    return {
      state,
      generate: async (prompt) => { state.prompts.push(prompt); return over.reply ?? '{"weakness":"I ask late.","strength":"I finish things.","why_role":"The team size suits me.","salary":"90k"}'; },
      resumeText: () => (over.resume ?? 'Jordan Avery. FitPilot, sole developer.'),
      jobText: () => (over.job ?? ''),
      listAnswers: () => state.rows,
      storeDrafts: (d) => { state.stored.push(d); return Object.keys(d); },
      onFinished: (written) => state.finished.push(written),
      ...(over.generate ? { generate: over.generate } : {}),
    };
  };
  test('one model call; salary is never asked for and never stored', async () => {
    const d = deps();
    const written = await drafting.draftOwnAnswers(d);
    assert.equal(d.state.prompts.length, 1);
    assert.doesNotMatch(d.state.prompts[0], /"salary"|"relocation"|"notice"/);
    assert.deepEqual(written.sort(), ['strength', 'weakness']);
    assert.equal('salary' in d.state.stored[0], false);
    assert.equal('why_role' in d.state.stored[0], false, 'no job loaded: the answer about the role is not drafted');
    assert.deepEqual(d.state.finished, [written]);
  });
  test('with a job loaded the answer about the role is drafted too', async () => {
    const d = deps({ job: 'Frontend Engineer, Brightwell.' });
    const written = await drafting.draftOwnAnswers(d);
    assert.ok(written.includes('why_role'));
  });
  test('onlyMissing: a box that already holds a draft is left alone', async () => {
    const d = deps({ job: 'Frontend Engineer.', rows: [{ key: 'weakness', text: 'An earlier draft.', status: 'draft' }] });
    await drafting.draftOwnAnswers(d, { onlyMissing: true });
    assert.doesNotMatch(d.state.prompts[0], /"weakness"/);
    assert.match(d.state.prompts[0], /"why_role"/);
  });
  test('no résumé: no call. A model failure or an unreadable reply: nothing stored, and the run still reports', async () => {
    const none = deps({ resume: '   ' });
    assert.deepEqual(await drafting.draftOwnAnswers(none), []);
    assert.equal(none.state.prompts.length, 0);
    const broken = deps({ generate: async () => { throw new Error('provider down'); } });
    assert.deepEqual(await drafting.draftOwnAnswers(broken), []);
    assert.deepEqual(broken.state.finished, [[]]);
    const junk = deps({ reply: 'Sorry, I cannot help with that.' });
    assert.deepEqual(await drafting.draftOwnAnswers(junk), []);
    assert.equal(junk.state.stored.length, 0);
    assert.equal(drafting.isDraftingOwnAnswers(), false);
  });
  test('runs are queued: the second starts after the first ends', async () => {
    const order = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = deps({ generate: async () => { order.push('first:start'); await gate; order.push('first:end'); return '{}'; } });
    const second = deps({ generate: async () => { order.push('second:start'); return '{}'; } });
    const a = drafting.draftOwnAnswers(first);
    const b = drafting.draftOwnAnswers(second);
    assert.equal(drafting.isDraftingOwnAnswers(), true);
    release();
    await Promise.all([a, b]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
  });
  test('a document\'s text: the raw text, else the structured extraction', () => {
    assert.equal(drafting.profileDocumentText({ raw_text: 'Raw résumé.', structured_data: { a: 1 } }), 'Raw résumé.');
    assert.equal(drafting.profileDocumentText({ raw_text: '  ', structured_data: { a: 1 } }), '{"a":1}');
    assert.equal(drafting.profileDocumentText(null), '');
  });
});

describe('the store (profile_own_answers) and what the profile collector serves', () => {
  const DB_PATH = dist('db/DatabaseManager.js');
  let dbMgr; let store; let tmp;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-answers-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch {}
    dbMgr = require(DB_PATH).DatabaseManager.getInstance();
    store = require(dist('services/knowledge/OwnAnswersStore.js'));
  });
  after(() => {
    try { dbMgr?.close?.(); } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });
  beforeEach(() => { if (dbMgr.isAvailable()) store.wipeOwnAnswers(); });

  test('the migration created the table', () => {
    if (!dbMgr.isAvailable()) return; // native binding not loadable in this env
    assert.ok(dbMgr.getDb().pragma('user_version', { simple: true }) >= 32);
    assert.ok(dbMgr.getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='profile_own_answers'`).get());
  });
  test('saving makes an answer the user\'s; saving an empty box removes it; an unknown question is refused', () => {
    if (!dbMgr.isAvailable()) return;
    assert.deepEqual(store.saveOwnAnswer('weakness', '  I ask late.  '), { ok: true, text: 'I ask late.' });
    assert.deepEqual(store.listOwnAnswers().map((r) => [r.key, r.text, r.status]), [['weakness', 'I ask late.', 'saved']]);
    assert.deepEqual(store.saveOwnAnswer('weakness', '   '), { ok: true, text: '' });
    assert.equal(store.listOwnAnswers().length, 0);
    assert.equal(store.saveOwnAnswer('favourite_colour', 'blue').ok, false);
  });
  test('a draft never replaces what the user wrote, and never fills a box Natively may not draft', () => {
    if (!dbMgr.isAvailable()) return;
    store.saveOwnAnswer('weakness', 'Mine.');
    const written = store.storeOwnAnswerDrafts({ weakness: 'A draft.', strength: 'A draft strength.', salary: '90k' });
    assert.deepEqual(written, ['strength']);
    const rows = Object.fromEntries(store.listOwnAnswers().map((r) => [r.key, r]));
    assert.equal(rows.weakness.text, 'Mine.');
    assert.equal(rows.strength.status, 'draft');
    assert.equal(rows.salary, undefined);
  });
  test('a later run replaces an earlier draft', () => {
    if (!dbMgr.isAvailable()) return;
    store.storeOwnAnswerDrafts({ strength: 'First draft.' });
    store.storeOwnAnswerDrafts({ strength: 'Second draft.' });
    assert.deepEqual(store.listOwnAnswers().map((r) => [r.text, r.status]), [['Second draft.', 'draft']]);
  });
  test('Use approves drafts as they stand: one, or all', () => {
    if (!dbMgr.isAvailable()) return;
    store.storeOwnAnswerDrafts({ strength: 'A.', conflict: 'B.', failure: 'C.' });
    assert.equal(store.useOwnAnswerDrafts(['strength']), 1);
    assert.equal(store.useOwnAnswerDrafts(['strength']), 0, 'already the user\'s');
    assert.equal(store.useOwnAnswerDrafts(), 2);
    assert.ok(store.listOwnAnswers().every((r) => r.status === 'saved'));
  });
  test('removing the résumé removes the drafts written from it and keeps what the user saved', () => {
    if (!dbMgr.isAvailable()) return;
    store.saveOwnAnswer('salary', 'Between 55 and 62 thousand.');
    store.storeOwnAnswerDrafts({ strength: 'A draft.' });
    store.deleteOwnAnswerDrafts();
    assert.deepEqual(store.listOwnAnswers().map((r) => r.key), ['salary']);
  });
  test('the collector serves saved answers as one fact document, and no draft', () => {
    if (!dbMgr.isAvailable()) return;
    const { collectV3ProfileSources } = require(dist('services/knowledge/v3ProfileSources.js'));
    const orchestrator = { activeResume: { id: 1, structured_data: { identity: { name: 'Jordan Avery' } }, raw_text: 'Jordan Avery. FitPilot.' } };
    store.storeOwnAnswerDrafts({ strength: 'A draft Natively wrote.' });
    const draftsOnly = collectV3ProfileSources(orchestrator);
    assert.equal(draftsOnly.counts.profileFact, 0);
    assert.equal(draftsOnly.docs.some((d) => d.kind === 'fact'), false);

    store.saveOwnAnswer('weakness', 'I ask late.');
    const collected = collectV3ProfileSources(orchestrator);
    const fact = collected.docs.find((d) => d.kind === 'fact');
    assert.ok(fact);
    assert.equal(collected.counts.profileFact, 1);
    assert.deepEqual(fact.structured.ownAnswers.map((a) => [a.key, a.label, a.text]), [['weakness', 'Biggest weakness', 'I ask late.']]);
    assert.match(fact.structured.ownAnswers[0].askedAs, /weakness/);
    assert.ok(collected.resolved.some((r) => r.role === 'profile_fact' && r.id === fact.sourceId));

    const before = fact.versionId;
    store.saveOwnAnswer('weakness', 'I ask late. Now I set a one-hour limit.');
    assert.notEqual(collectV3ProfileSources(orchestrator).docs.find((d) => d.kind === 'fact').versionId, before, 'an edit is a new version');

    assert.equal(collectV3ProfileSources(null).docs.length, 0, 'no knowledge engine: nothing is served');
  });
  test('the wipe removes everything', () => {
    if (!dbMgr.isAvailable()) return;
    store.saveOwnAnswer('salary', 'A range.');
    store.storeOwnAnswerDrafts({ strength: 'A draft.' });
    store.wipeOwnAnswers();
    assert.equal(store.listOwnAnswers().length, 0);
  });
});

describe('wiring', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  test('a saved résumé drafts the answers; a saved job description drafts only what is still empty', () => {
    assert.match(ipc, /ingestDocument\(resolvedPath, DocType\.RESUME\);[\s\S]{0,400}void kickOwnAnswerDrafts\(orchestrator\);/);
    assert.equal((ipc.match(/void kickOwnAnswerDrafts\(orchestrator, \{ onlyMissing: true \}\);/g) ?? []).length, 2, 'the file upload and the pasted job description');
  });
  test('deleting the résumé clears its drafts, and the trial wipe clears everything', () => {
    assert.match(ipc, /deleteProfileTransactional\(orchestrator, DocType\.RESUME, 'resume'\);[\s\S]{0,500}deleteOwnAnswerDrafts\(\)/);
    assert.match(ipc, /step\('own-answers', \(\) => [\s\S]{0,200}wipeOwnAnswers\(\)\)/);
  });
  test('writes are Pro-gated; every handler has its bridge', () => {
    for (const channel of ['profile:save-own-answer', 'profile:use-own-answer-drafts', 'profile:draft-own-answers']) {
      const at = ipc.indexOf(`safeHandle('${channel}'`);
      assert.ok(at > 0, channel);
      assert.match(ipc.slice(at, at + 260), /isProOrTrialActive\(\)/, channel);
      assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), channel);
    }
    assert.ok(preload.includes(`ipcRenderer.invoke('profile:get-own-answers')`));
    assert.ok(preload.includes(`ipcRenderer.on('profile:own-answers-updated'`));
  });
});
