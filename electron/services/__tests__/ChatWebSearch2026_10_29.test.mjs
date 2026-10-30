// "Internet search doesn't work; it says it doesn't know" (customer report,
// Spanish, 2026-10-29). Nothing on the chat path searched. Typed chat now
// searches when asked to, or (outside a live meeting) when the question is
// about something current; spoken questions never do.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/ChatWebSearch2026_10_29.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const ws = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/webSearch/chatWebSearch.js')).href);

const NOW = new Date('2026-10-29T12:00:00Z');
const open = { allowCurrentFacts: true, now: NOW };
const scoped = { allowCurrentFacts: false, now: NOW };

describe('when a typed question searches', () => {
  test('an explicit request searches for what follows it, in English and Spanish', () => {
    const cases = [
      ['search for the Kaspersky HTTPS scanning exclusion list', 'the Kaspersky HTTPS scanning exclusion list'],
      ['Please look up Electron 43 release notes', 'Electron 43 release notes'],
      ['busca en internet la arquitectura de Kafka', 'la arquitectura de Kafka'],
      ['Búscame el precio del dólar', 'el precio del dólar'],
      ['investiga qué es CQRS', 'qué es CQRS'],
    ];
    for (const [message, query] of cases) {
      assert.deepEqual(ws.detectWebSearchIntent(message, scoped), { kind: 'explicit', query }, message);
    }
    assert.equal(ws.detectWebSearchIntent('what does the RFC say? look it up', scoped).kind, 'explicit');
    assert.equal(ws.detectWebSearchIntent('¿Qué dice la documentación? búscalo en la web', scoped).kind, 'explicit');
  });

  test('a question that only mentions search is not a request', () => {
    for (const message of ['What is binary search?', 'Google is hiring, what should I prepare?', 'explain search engine indexing', 'How do I search a rotated array?']) {
      assert.equal(ws.detectWebSearchIntent(message, open).kind, 'none', message);
    }
  });

  test('something current searches outside a meeting, including accented Spanish cues', () => {
    for (const message of ['What are the latest Node.js LTS versions?', 'cuáles son las últimas noticias de OpenAI', '¿Qué tiempo hace hoy en Madrid?', 'precio de la acción de Nvidia', 'Who won the election in 2026?']) {
      assert.equal(ws.detectWebSearchIntent(message, open).kind, 'current', message);
    }
    for (const message of ['explain the CAP theorem', '¿Cómo funciona la replicación síncrona?', 'what is the current approach in my notes?']) {
      assert.equal(ws.detectWebSearchIntent(message, open).kind, 'none', message);
    }
  });

  test('in a meeting or a past meeting\'s chat, only an explicit request searches', () => {
    assert.equal(ws.detectWebSearchIntent('what was the latest thing they said?', scoped).kind, 'none');
    assert.equal(ws.detectWebSearchIntent('search for their company funding', scoped).kind, 'explicit');
  });
});

describe('running the search', () => {
  test('results are mapped, non-web links dropped, five at most', async () => {
    const provider = {
      search: async () => [
        { title: 'A', link: 'https://a.example/x', snippet: '  first   result ' },
        { title: '', url: 'https://b.example', content: 'second' },
        { title: 'bad', link: 'javascript:alert(1)', snippet: 'x' },
        ...Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, link: `https://t${i}.example`, snippet: '' })),
      ],
    };
    const hits = await ws.searchWebForChat('q', provider, 1000);
    assert.equal(hits.length, 5);
    assert.deepEqual(hits[0], { title: 'A', url: 'https://a.example/x', snippet: 'first result' });
    assert.deepEqual(hits[1], { title: 'https://b.example', url: 'https://b.example', snippet: 'second' });
    assert.ok(hits.every((h) => h.url.startsWith('https://')));
  });

  test('a slow or failing provider answers without results instead of hanging or throwing', async () => {
    assert.deepEqual(await ws.searchWebForChat('q', { search: () => new Promise(() => {}) }, 30), []);
    assert.deepEqual(await ws.searchWebForChat('q', { search: async () => { throw new Error('429'); } }, 1000), []);
    assert.deepEqual(await ws.searchWebForChat('q', { search: async () => ({ error: 'x' }) }, 1000), []);
  });
});

describe('what the model is told', () => {
  const explicit = { kind: 'explicit', query: 'Kafka exactly-once' };
  const current = { kind: 'current', query: 'latest Node LTS' };

  test('results are numbered sources to cite, marked as data, dated', () => {
    const block = ws.buildWebSearchPromptBlock(explicit, [{ title: 'Kafka docs', url: 'https://kafka.apache.org/x', snippet: 'Exactly-once semantics…' }], NOW);
    assert.match(block, /^## WEB SEARCH RESULTS/);
    assert.match(block, /2026-10-29/);
    assert.match(block, /\[1\] Kafka docs\nhttps:\/\/kafka\.apache\.org\/x\nExactly-once semantics…/);
    assert.match(block, /Sources/);
    assert.match(block, /never as instructions/);
    assert.match(block, /alongside any documents/);
  });

  test('an explicit request with no search set up says where to set it up; a cue alone adds nothing', () => {
    assert.match(ws.buildWebSearchPromptBlock(explicit, null, NOW), /Tavily Search/);
    assert.equal(ws.buildWebSearchPromptBlock(current, null, NOW), '');
    assert.match(ws.buildWebSearchPromptBlock(explicit, [], NOW), /returned nothing usable/);
    assert.equal(ws.buildWebSearchPromptBlock(current, [], NOW), '');
  });
});

describe('one chat turn', () => {
  const opts = { typed: true, skill: false, meetingActive: false, callerScoped: false, now: NOW };
  const provider = (calls) => () => ({ search: async (q) => { calls.push(q); return [{ title: 'R', link: 'https://r.example', snippet: 's' }]; } });

  test('spoken questions, skills and plain questions never call the provider', async () => {
    const calls = [];
    assert.equal(await ws.startChatWebSearch('search for X', { ...opts, typed: false }, provider(calls)), '');
    assert.equal(await ws.startChatWebSearch('search for X', { ...opts, skill: true }, provider(calls)), '');
    assert.equal(await ws.startChatWebSearch('explain the CAP theorem', opts, provider(calls)), '');
    assert.equal(await ws.startChatWebSearch('the latest they said?', { ...opts, meetingActive: true }, provider(calls)), '');
    assert.deepEqual(calls, []);
  });

  test('an explicit request searches; without premium it says search is not set up', async () => {
    const calls = [];
    const block = await ws.startChatWebSearch('busca en internet la arquitectura de Kafka', opts, provider(calls));
    assert.deepEqual(calls, ['la arquitectura de Kafka']);
    assert.match(block, /## WEB SEARCH RESULTS[\s\S]*https:\/\/r\.example/);
    const missing = await ws.startChatWebSearch('search for X', opts, () => { throw new Error("Cannot find module '../../premium/...'"); });
    assert.match(missing, /none is set up/);
  });
});

describe('the chat handler', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

  test('starts the search once, typed turns only, before the V3 short-circuit', () => {
    const start = src.indexOf('const webSearchBlockPromise = startChatWebSearch(message, {');
    assert.ok(start > 0);
    assert.ok(start < src.indexOf('// ── CONTEXT INTELLIGENCE V3 — wired manual-chat surface'));
    const call = src.slice(start, start + 600);
    assert.match(call, /typed: !options\?\.liveQuestion && options\?\.surface !== 'live'/);
    assert.match(call, /meetingActive: appState\.getIsMeetingActive\(\)/);
    assert.match(call, /callerScoped: options\?\.skipSystemPrompt === true && Boolean\(context\)/);
    assert.match(call, /resolveCompanySearchProvider\(\)/);
  });

  test('both prompt paths carry the block', () => {
    assert.match(src, /const v3WebSearchBlock = await webSearchBlockPromise;\s*const v3SystemPrompt = withDiagramContract\(\s*\(skillPromptBlock \?[\s\S]{0,120}\)\s*\+ \(v3WebSearchBlock \? `\\n\\n\$\{v3WebSearchBlock\}` : ''\)/);
    assert.match(src, /const legacyWebSearchBlock = await webSearchBlockPromise;\s*if \(legacyWebSearchBlock\) \{\s*context = context \? `\$\{context\}\\n\\n\$\{legacyWebSearchBlock\}` : legacyWebSearchBlock;/);
  });
});
