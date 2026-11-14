/**
 * Small talk gets no answer drafted before the judge rules on it
 * (pipeline forensics 2026-11-13, F-LAT-08: P2-s04 spent four answer-sized
 * calls on "How are you doing today, did you find the place okay?").
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { isOnlySmallTalk } = await import(pathToFileURL(path.join(dist, 'llm/smallTalk.js')).href);

describe('isOnlySmallTalk', () => {
    for (const t of [
        'How are you doing today, did you find the place okay?',
        'Hi everyone, good morning.',
        'Can you hear me okay?',
        'Can everyone see my screen?',
        'Okay. Shall we get started?',
        'Am I on mute?',
        'Is that better?',
        'Thanks for joining. How is your day going?',
        'Are you ready?',
    ]) test(`small talk: ${t}`, () => assert.equal(isOnlySmallTalk(t), true));

    for (const t of [
        'Can you hear me? Great, tell me about your last project.',
        'How are you handling retries in the payment service?',
        'How are you going to shard this table?',
        'Did you find the bug in the cache layer?',
        'Can you see why this query is slow?',
        'Are you ready to walk me through the design?',
        'What port does the Orion ingest gateway listen on?',
        'Welcome. So, why did you choose Postgres over Mongo?',
        '',
    ]) test(`not small talk: ${t || '(empty)'}`, () => assert.equal(isOnlySmallTalk(t), false));

    test('no real ask in the judge eval sets reads as small talk', () => {
        const dir = path.resolve(__dirname, '../../../premium/electron/autoAnswer/__tests__/judge-eval');
        const hits = [];
        for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            for (const c of (Array.isArray(data) ? data : data.cases ?? [])) {
                if (c.expect === 'ask' && isOnlySmallTalk(c.text)) hits.push(`${f}: ${c.text.slice(0, 80)}`);
            }
        }
        assert.deepEqual(hits, []);
    });
});

describe('engine', () => {
    async function makeEngine() {
        const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
        const { SessionTracker } = require(path.join(dist, 'SessionTracker.js'));
        const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, new SessionTracker());
        engine.lastTriggerTime = 0;
        let calls = 0;
        engine.whatToAnswerLLM = { async *generateStream() { calls += 1; yield 'Doing well, thanks.'; } };
        return { engine, calls: () => calls };
    }

    test('the Auto Answer prefetch does not draft a greeting', async () => {
        const { engine, calls } = await makeEngine();
        engine.prefetchAutoAnswer('1-q1', 'How are you doing today, did you find the place okay?');
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(engine.getActiveMode(), 'idle');
        assert.equal(calls(), 0);
    });

    test('a real ask is still prefetched (unchanged)', async () => {
        const { engine } = await makeEngine();
        engine.prefetchAutoAnswer('1-q1', 'What port does the Orion ingest gateway listen on?');
        assert.equal(engine.getActiveMode(), 'what_to_say');
    });
});
