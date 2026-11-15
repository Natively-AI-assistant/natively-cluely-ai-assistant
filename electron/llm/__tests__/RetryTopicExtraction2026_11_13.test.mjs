// The canned retry line must name the topic in whole words (pipeline forensics
// 2026-11-13, F-ACC-02).
//
// The outage replay (P2/O2-s16g) showed "I couldn't generate an answer about
// es udp give up compared just now." Two causes in extractRetryTopic:
//   1. the scaffold alternation listed " do" before " does" with no word
//      boundary, so "What does UDP…" lost "What do" and kept "es UDP…";
//   2. a blind 5-word cut ("the retention window for raw" lost "spans").

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { buildGracefulRetry } = await import(pathToFileURL(path.join(distRoot, 'llm/manualProfileIntelligence.js')).href);

/** The topic the line names, or '' for the generic line. */
function topicOf(q) {
    const out = buildGracefulRetry(q);
    const m = out.match(/about (.+?) just now\.|answer about (.+?) didn't come through|came back for (.+?) this time\./);
    return m ? (m[1] || m[2] || m[3]) : '';
}

describe('retry-line topic is whole words', () => {
    test('"What does …" keeps the whole first word (the s16g line)', () => {
        const t = topicOf('What does UDP give up compared to TCP?');
        assert.ok(!/^es\b/.test(t), `topic starts mid-word: "${t}"`);
        assert.doesNotMatch(buildGracefulRetry('What does UDP give up compared to TCP?'), /\bes udp\b/);
        assert.ok(t === '' || /^udp\b/.test(t), `got "${t}"`);
    });

    test('longest scaffold wins for every auxiliary (does/do, were/was, is)', () => {
        for (const [q, starts] of [
            ['How does consistent hashing handle a node joining?', /^consistent hashing\b/],
            ['Why were the shards rebalanced last week?', /^the shards\b/],
            ['What is the retention window for raw spans?', /^the retention window\b/],
            ['Where did the incident start?', /^the incident\b/],
        ]) {
            const t = topicOf(q);
            assert.match(t, starts, `${q} → "${t}"`);
        }
    });

    test('scaffold words only match as whole words ("however", "talking", "whose")', () => {
        assert.ok(!/^ever\b/.test(topicOf('However the cache gets invalidated across regions')));
        assert.ok(!/^ing\b/.test(topicOf('talking points for the quarterly roadmap')));
    });

    test('a cut never ends on a dangling connector and keeps the noun when it fits', () => {
        const t = topicOf('What is the retention window for raw spans?');
        assert.equal(t, 'the retention window for raw spans');
        const long = topicOf('Explain the cost of moving data to the cold tier');
        assert.doesNotMatch(long, /\b(for|of|to|the|a|an|and|or|in|on|with|during|compared)$/, `"${long}"`);
        assert.match(long, /^the cost of moving data/);
    });

    test('existing behaviour kept', () => {
        assert.match(buildGracefulRetry('can you walk me through the database design?'), /database design/);
        assert.doesNotMatch(buildGracefulRetry('what salary are you expecting for this role?'), /salary/i);
        assert.equal(topicOf('what do you think about microservices here'), '');
    });
});
