/**
 * First-question CPU on the answer path is paid at meeting start, not between
 * the judge and the first token (pipeline forensics 2026-11-13, F-LAT-01), and
 * the diagram resolver no longer joins the whole meeting on every turn (F-LAT-02).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const w = await import(pathToFileURL(path.join(dist, 'llm/answerPathWarmup.js')).href);

describe('scheduleAnswerPathWarmup', () => {
    test('runs every step once, one per slice, and only once per process', () => {
        w.resetAnswerPathWarmupForTests();
        const ran = []; const queue = [];
        const schedule = (fn, ms) => queue.push({ fn, ms });
        const steps = ['a', 'b', 'c'].map((name) => ({ name, run: () => ran.push(name) }));
        assert.equal(w.scheduleAnswerPathWarmup({ steps, schedule, delayMs: 1500, gapMs: 40 }), true);
        assert.deepEqual(ran, [], 'nothing runs synchronously at meeting start');
        assert.equal(queue[0].ms, 1500);
        while (queue.length) { const { fn } = queue.shift(); const before = ran.length; fn(); assert.ok(ran.length - before <= 1, 'one step per slice'); }
        assert.deepEqual(ran, ['a', 'b', 'c']);
        assert.equal(w.scheduleAnswerPathWarmup({ steps, schedule }), false, 'a second meeting does not warm again');
        assert.equal(queue.length, 0);
    });

    test('a step that throws does not stop the rest', () => {
        w.resetAnswerPathWarmupForTests();
        const ran = []; const queue = [];
        const steps = [{ name: 'x', run: () => { throw new Error('boom'); } }, { name: 'y', run: () => ran.push('y') }];
        w.scheduleAnswerPathWarmup({ steps, schedule: (fn) => queue.push(fn) });
        while (queue.length) queue.shift()();
        assert.deepEqual(ran, ['y']);
    });

    test('the default steps all run cleanly against the real modules', () => {
        for (const step of w.defaultWarmSteps()) assert.doesNotThrow(() => step.run(), step.name);
    });

    test('the engine schedules it when a meeting conversation begins', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
        const start = src.indexOf('public beginMeetingConversation(');
        const body = src.slice(start, src.indexOf('\n    }\n', start));
        assert.match(body, /scheduleAnswerPathWarmup\(\)/);
    });
});

describe('diagram resolver reads the meeting only for a chart (F-LAT-02)', () => {
    test('material given as a function is not called for an ordinary question, and is for a chart', async () => {
        const dr = await import(pathToFileURL(path.resolve(__dirname, '../../../src/lib/diagram/diagramRequest.mjs')).href);
        let reads = 0;
        const material = () => { reads += 1; return 'We have 12,000 users today, growing 8% a month.'; };
        dr.resolveDiagramRequest({ question: 'What is the name of the Orion programme manager?', answerType: 'general_answer', featureEnabled: true, material });
        assert.equal(reads, 0, 'an ordinary question never joins the meeting');
        const chart = dr.resolveDiagramRequest({ question: 'Can you chart the user growth forecast for the next 12 months?', answerType: 'general_answer', featureEnabled: true, material });
        assert.equal(chart.view, 'chart');
        assert.equal(reads, 1, 'a chart reads it once');
    });

    test('a string material still works (unchanged callers)', async () => {
        const dr = await import(pathToFileURL(path.resolve(__dirname, '../../../src/lib/diagram/diagramRequest.mjs')).href);
        const a = dr.resolveDiagramRequest({ question: 'Can you chart the user growth forecast for the next 12 months?', featureEnabled: true, material: 'We have 12,000 users today, growing 8% a month.' });
        const b = dr.resolveDiagramRequest({ question: 'Can you chart the user growth forecast for the next 12 months?', featureEnabled: true, material: () => 'We have 12,000 users today, growing 8% a month.' });
        assert.deepEqual(b, a);
    });
});
