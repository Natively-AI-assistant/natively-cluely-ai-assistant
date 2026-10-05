// Older speech comes back for a long or multi-part question (2026-10-04, E12).
//
// Measured in the real app (General, Team Meet, Call Center): a meeting of 20+
// lines, then "remind me what the project codename is, when we are launching,
// and who owns it?" — the port admitted ONE window, the one holding the
// question itself. Replayed offline through chunkLiveTranscript + Bm25Index:
// that window scored 1.00 against the question it contains, the windows
// holding the codename and the owner 0.15–0.16, under the 0.2 relative floor;
// "launching" did not match "launch" at all (0.00–0.04). So nothing said
// earlier was admitted, and the answer said "I'll confirm the codename".
//
// A question is not evidence for its own answer, and it must not be the
// yardstick the real evidence is measured against either.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createLiveTranscriptRetrievalPort, stemSpeechToken } =
  await import(pathToFileURL(path.join(base, 'retrieval/live-transcript-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const WORDS = 'the team reviewed rota staffing calendar vendor budget quarter backlog tooling migration dashboard alerting cadence onboarding handover review cycle forecast capacity rollout policy audit release report meeting notes agenda workstream priorities estimate risk dependency survey feedback archive template checklist process baseline target summary update draft schedule'.split(' ');
function filler(i) { let s = (i * 2654435761) >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; return Array.from({ length: 24 }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' '); }
const QUESTION = 'Sorry, remind me what the project codename is, when we are launching, and who owns it?';
const meeting = (n) => {
  const facts = { 1: 'For the record, the project codename is ATLASVINE.', [Math.floor(n / 2)]: 'Quick note, the launch target moved to the ninth of November.', [n - 3]: 'And Maya Ortholan owns the rollout.' };
  const segs = Array.from({ length: n }, (_, i) => ({ speaker: i % 2 ? 'other' : 'user', text: facts[i] ?? filler(i), timestamp: 1_700_000_000_000 + i * 6000, final: true }));
  segs.push({ speaker: 'interviewer', text: QUESTION, timestamp: 1_700_000_000_000 + n * 6000, final: true });
  return segs;
};
const decision = (q) => decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'team-meet', scope: { userId: 'local', sessionId: 's1' }, sessionId: 's1', transcriptQuestion: q });
const ask = async (n, q = QUESTION) => { const port = createLiveTranscriptRetrievalPort({ segments: meeting(n), userId: 'local', sessionId: 's1' }); const r = await port.retrieve({ decision: decision(q) }); return r.evidence.map((e) => e.content).join('\n---\n'); };

describe('a long question does not crowd out what was said earlier', () => {
  for (const n of [20, 80, 160]) {
    test(`${n}-line meeting: the codename, the launch date and the owner all come back`, async () => {
      const text = await ask(n);
      assert.ok(text.includes('ATLASVINE'), 'the codename, said at line 1');
      assert.ok(text.includes('ninth of November'), 'the launch date, said mid-meeting ("launching" must match "launch")');
      assert.ok(text.includes('Maya Ortholan'), 'the owner, said near the end');
    });
  }
  test('the question itself is never handed back as evidence', async () => {
    const text = await ask(80);
    assert.ok(!text.includes('remind me what the project codename is'), 'a question is not evidence for its own answer');
  });
  test('a meeting that is ONLY the question yields nothing', async () => {
    const port = createLiveTranscriptRetrievalPort({ segments: [{ speaker: 'interviewer', text: QUESTION, final: true }], userId: 'local', sessionId: 's1' });
    const r = await port.retrieve({ decision: decision(QUESTION) });
    assert.equal(r.evidence.length, 0);
  });
  test('the cleaned question (fillers stripped) still matches its own spoken line', async () => {
    const spoken = 'So um, remind me what the project codename is, when we are launching, and who owns it?';
    const segs = meeting(40); segs[segs.length - 1].text = spoken;
    const port = createLiveTranscriptRetrievalPort({ segments: segs, userId: 'local', sessionId: 's1' });
    const r = await port.retrieve({ decision: decision(spoken) });
    const text = r.evidence.map((e) => e.content).join('\n');
    assert.ok(text.includes('ATLASVINE') && !/remind me what the project codename/.test(text));
  });
});

describe('stemSpeechToken', () => {
  test('word forms of speech meet', () => {
    assert.equal(stemSpeechToken('launching'), stemSpeechToken('launch'));
    assert.equal(stemSpeechToken('launched'), stemSpeechToken('launch'));
    assert.equal(stemSpeechToken('owns'), stemSpeechToken('own'));
    assert.equal(stemSpeechToken('policies'), stemSpeechToken('policy'));
  });
  test('short words and identifiers are left alone', () => {
    assert.equal(stemSpeechToken('is'), 'is');
    assert.equal(stemSpeechToken('gas'), 'gas');
    assert.equal(stemSpeechToken('v2'), 'v2');
    assert.equal(stemSpeechToken('class'), 'class');
  });
});
