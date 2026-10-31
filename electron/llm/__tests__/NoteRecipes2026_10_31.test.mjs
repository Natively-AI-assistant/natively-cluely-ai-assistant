// Notepad recipes (2026-10-31): Granola's recipe list in Natively, offered as
// chips, under All recipes and through "/" in the notepad's Ask. Granola keeps
// its recipe prompts on its server, so each instruction is written from the
// shape of Granola's own answers on the same benchmark meetings.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
//
// Pure logic and source contracts; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'dist-electron/electron');
const R = await import(pathToFileURL(path.join(dist, 'llm/noteRecipes.js')).href);
const { buildWholeMeetingContext } = await import(pathToFileURL(path.join(dist, 'rag/wholeMeetingContext.js')).href);
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('Granola\'s built-ins and library recipes are all there, each with a description', () => {
    const labels = R.NOTE_RECIPES.map((r) => r.label);
    for (const l of ['Write tldr', 'Write follow up email', 'List my todos', 'Make notes shorter', 'Make notes longer', 'Affirm', 'Create help doc', 'Create tickets', 'Schedule follow up meeting', 'Help me decide', 'What did I miss', 'Make me sound smart', 'Suggest questions']) {
        assert.ok(labels.includes(l), l);
    }
    for (const r of R.NOTE_RECIPES) {
        assert.ok(r.description.length > 10, r.id);
        assert.ok(r.helper || r.instruction, `${r.id} runs something`);
    }
    assert.equal(new Set(R.NOTE_RECIPES.map((r) => r.id)).size, R.NOTE_RECIPES.length, 'ids unique');
});

test('live helpers only while live; notes rewrites only after the meeting', () => {
    const live = R.recipesFor('live').map((r) => r.id);
    const ended = R.recipesFor('ended').map((r) => r.id);
    assert.ok(live.includes('what-did-i-miss') && !ended.includes('what-did-i-miss'));
    assert.ok(ended.includes('notes-shorter') && !live.includes('notes-shorter'));
    assert.ok(live.includes('tldr') && ended.includes('tldr'));
});

test('"/" search ranks the label first, then words, then keywords and descriptions', () => {
    const list = R.recipesFor('ended');
    assert.equal(R.searchRecipes(list, 'wri')[0].label, 'Write tldr');
    assert.equal(R.searchRecipes(list, 'todo')[0].id, 'todos');
    assert.equal(R.searchRecipes(list, 'email')[0].id, 'follow-up-email');
    assert.ok(R.searchRecipes(list, 'linear').some((r) => r.id === 'tickets'), 'keyword');
    assert.equal(R.searchRecipes(list, 'zzz').length, 0);
    assert.equal(R.searchRecipes(list, '').length, list.length);
});

test('"/tldr in Spanish" runs the recipe it names with the rest as the user\'s addition', () => {
    const list = R.recipesFor('ended');
    assert.deepEqual(pick(R.parseSlashCommand(list, '/tldr in Spanish')), { id: 'tldr', extra: 'in Spanish' });
    assert.deepEqual(pick(R.parseSlashCommand(list, '/write follow up email to Samuel')), { id: 'follow-up-email', extra: 'to Samuel' });
    assert.deepEqual(pick(R.parseSlashCommand(list, '/help me decide hire or contract')), { id: 'help-me-decide', extra: 'hire or contract' });
    assert.equal(R.parseSlashCommand(list, '/wri'), null, 'a partial name names no recipe');
    assert.equal(R.parseSlashCommand(list, 'tldr'), null, 'no slash');
});
const pick = (x) => (x ? { id: x.recipe.id, extra: x.extra } : null);

test('the instructions carry the shapes of Granola\'s answers', () => {
    const by = (id) => R.noteRecipeById(id).instruction;
    assert.match(by('tldr'), /exactly two "- " bullets/);
    assert.match(by('todos'), /\*\*To do:\*\*/);
    assert.match(by('todos'), /\*\*Inferred:\*\*/);
    assert.match(by("todos"), /No deadline was promised\./);
    assert.match(by("todos"), /with no owner name/);
    assert.match(by("todos"), /a promise on a THEM line .* is that other person.s, never mine/);
    assert.match(by("todos"), /a ME line that hands work to someone else/);
    assert.match(by('follow-up-email'), /\*\*Subject:\*\*/);
    assert.match(by('follow-up-email'), /my first name/);
});

test('the system prompt signs as the user, keeps dates as said, and adds no preamble', () => {
    const sys = R.recipeSystemPrompt({ userName: 'Evin John', today: 'Saturday, October 31, 2026' });
    assert.match(sys, /Sign only an email or message the recipe asks for, as Evin; never sign a summary/);
    assert.match(sys, /whatever name the others call them by/);
    assert.match(sys, /never invent a year/);
    assert.match(sys, /No preamble/);
    assert.match(R.recipeSystemPrompt({ userName: null, today: "x" }), /\[Your name\]/);
    const user = R.recipeUserPrompt({ recipe: R.noteRecipeById('tldr'), extra: 'in Spanish', context: 'CTX' });
    assert.match(user, /^RECIPE: Write tldr\n/);
    assert.match(user, /The user added: "in Spanish"/);
    assert.match(user, /\n\nCTX$/);
});

test('a live recipe reads what the user typed and the transcript so far', () => {
    const ctx = R.liveRecipeContext([{ speaker: 'user', text: 'We can do $7.20.' }, { speaker: 'interviewer', text: 'Deal.' }], 'price: 7.20');
    assert.match(ctx, /^MY NOTES \(typed during the meeting\):\nprice: 7\.20/);
    assert.match(ctx, /ME: We can do \$7\.20\.\nTHEM: Deal\./);
    assert.equal(R.liveRecipeContext([], 'x'), null);
});

test('a long finished meeting still runs a recipe: notes plus the transcript\'s start', () => {
    const chunks = [0, 1, 2].map((i) => ({ text: `line ${i}`, speaker: 'THEM', startMs: i * 1000, tokenCount: 10 }));
    assert.equal(buildWholeMeetingContext({ chunks, budget: 15 }), null, 'Ask keeps falling back to retrieval');
    const cut = buildWholeMeetingContext({ chunks, budget: 15, overflow: 'cut', detailed: { overview: 'All of it.' } });
    assert.match(cut, /All of it\./);
    assert.match(cut, /line 0/);
    assert.doesNotMatch(cut, /line 1/);
    assert.match(cut, /its first part only/);
});

test('wiring: the ipc reads a finished meeting whole and a live one so far; the notepad has "/" and Ask after Stop', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const h = ipc.slice(ipc.indexOf("safeHandle('note-recipe:run'"));
    assert.match(h, /getMeetingRecipeContext\(meetingId, 30000\)/);
    assert.match(h, /getCurrentMeetingFullTranscript/);
    assert.match(read('electron/preload.ts'), /runNoteRecipe: \(input[\s\S]*?ipcRenderer\.invoke\('note-recipe:run', input\)/);
    const nw = read('src/components/NotesWindow.tsx');
    assert.match(nw, /const slashQuery = ask\.startsWith\('\/'\)/);
    // Enter runs "/…" as its recipe whether typed or sent by the keyboard hook (Windows types through the hook).
    assert.match(nw, /askSubmitRef\.current = \(\) => \{ if \(askTextRef\.current\.startsWith\('\/'\)\) runSlash\(\); else submitAsk\(askTextRef\.current\); \};/);
    assert.match(nw, /ask: \{ get: \(\) => askTextRef\.current, set: setAsk, submit: \(\) => askSubmitRef\.current\(\) \}/);
    assert.match(nw, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\); askSubmitRef\.current\(\); \}\}/);
    // After Stop the transcript closes, so Ask is never hidden behind it.
    assert.match(nw, /useEffect\(\(\) => \{ if \(phase !== 'live'\) setShowTranscript\(false\); \}, \[phase\]\);/);
    // A finished meeting's Ask settles once, even when another query replaced it (no complete event).
    assert.match(nw, /let finished = false;[\s\S]*?if \(finished\) return;/);
    // A live recipe reads only what was said.
    assert.match(h, /getCurrentMeetingFullTranscript\?\.\(\) \?\? \[\]\)\.filter\(\(l\) => isSpokenSavedLine\(l\)\)/);
    // A finished meeting that fits is asked whole, without waiting on embeddings.
    assert.match(read('electron/ipcHandlers.ts'), /const readsWhole = !!ragManager\?\.canReadWholeMeeting\(meetingId\);/);
    assert.match(nw, /const askBar = phase === 'live' \|\| \(phase === 'ended' && !!meetingId && !preview\);/);
    assert.match(nw, /if \(phase === 'ended' && meetingId\) \{ setAsk\(''\); askMeeting\(meetingId, question/);
});

test('the prompt carries a calendar, so a Date note is checked, not guessed', () => {
    const cal = R.calendarLine(new Date(2026, 9, 31), 10);
    assert.match(cal, /^Sat, Oct 31; Sun, Nov 1; Mon, Nov 2; Tue, Nov 3/);
    assert.match(cal, /Mon, Nov 9$/);
    assert.match(R.recipeSystemPrompt({ today: 'x', calendar: cal }), /CALENDAR \(weekday of each date from today on\): Sat, Oct 31/);
    assert.match(R.noteRecipeById('todos').instruction, /check against the CALENDAR, never from memory/);
    assert.match(R.noteRecipeById('tldr').instruction, /no signature/);
});
