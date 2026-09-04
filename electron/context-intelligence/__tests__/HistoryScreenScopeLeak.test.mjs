// Denying the `screenshots` provider scope must also strip screen text from the
// rendered conversation history.
//
// THE LEAK. Screen descriptions are stored in the conversation ring and
// rendered into `convoSummary` as `[screen attached that turn] …`. That summary
// was dropped only when the TRANSCRIPT scope was denied, and declared only as
// `transcript` in packedDataScopes. So a user who turned OFF screenshots for
// their provider had the SCREEN_CONTEXT *evidence* correctly withheld by
// filterEvidenceByProviderScopes — and the same text delivered anyway inside
// the history line, on every turn, for as long as it stayed in the ring.
//
// filterEvidenceByProviderScopes only inspects EvidenceItems. Prose walks past
// it. The transcript drop in engine-bridge already exists for exactly this
// reason ("the one door the filter does not cover"); this is a second door.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-scopeleak-'));

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const store = await import(
  pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);
const { buildV3Prompt } = await import(
  pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(
  pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { DENY_PROVIDER_SCOPES_ENV } = await import(
  pathToFileURL(path.join(base, 'policies/provider-scope-policy.js')).href);

process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

const SECRET = 'orbit-router';
const turn = (sessionId, question, n, extra = {}) => buildV3Prompt({
  surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
  requestId: `leak-${n}`, requestSequence: n,
  scope: { userId: 'local', sessionId }, ...extra,
});

/** Turn 1 records a screen observation; turn 2 asks a follow-up about it. */
async function twoTurns(sid) {
  store.clearConversationState(sid);
  await turn(sid, 'What is wrong with this code?', 1, { hasScreenContext: true });
  store.recordAnswerSummary(sid, 'Line 14 fails because visited is a list.',
    `VS Code on graph.py; sidebar shows project ${SECRET} with 12 files.`);
  return turn(sid, 'What was the project name in that screenshot?', 2);
}

afterEach(() => { delete process.env[DENY_PROVIDER_SCOPES_ENV]; });

describe('history screen lines honour the screenshots scope', () => {
  test('with the scope ALLOWED the screen line is present — the control', async () => {
    delete process.env[DENY_PROVIDER_SCOPES_ENV];
    const t2 = await twoTurns('leak-allowed');
    assert.match(t2.user, new RegExp(SECRET),
      'control: without a denial the feature must still work, or this suite proves nothing');
    assert.match(t2.user, /screen attached that turn/);
  });

  test('with `screenshots` DENIED the screen text does not reach the prompt', async () => {
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await twoTurns('leak-denied');
    assert.ok(!new RegExp(SECRET).test(t2.user),
      'screen content left the device through the history line despite the scope being off');
    // A RENDERED line is `[screen attached that turn] <text>`. The no-evidence
    // copy also mentions the marker, but quoted and with no content after it —
    // so match on the bracket followed by real text, not on the phrase alone.
    // (Matching the phrase failed here on the INSTRUCTION, not on any leak.)
    assert.ok(!/\[screen attached that turn\]\s+\w/.test(t2.user),
      'a rendered screen line survived the denial');
  });

  test('the denial is REPORTED, not silent', async () => {
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await twoTurns('leak-reported');
    const withheld = [...(t2.withheldDataScopes ?? t2.withheldScopes ?? [])];
    assert.ok(withheld.includes('screenshots'),
      `a withheld scope must be observable, not an invisible drop — got ${JSON.stringify(withheld)}`);
  });

  test('denying TRANSCRIPT does not report screen content as sent', async () => {
    // The audit line's only job is answering "did screen content leave the
    // device this turn?". historyCarriesScreenText is set while RENDERING the
    // history, but the transcript-scope check afterwards can drop the whole
    // block — so without a guard the prompt contained nothing and the audit
    // said screenshots went out.
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'transcript';
    const t2 = await twoTurns('leak-transcript');
    const outbound = [...(t2.packedDataScopes ?? t2.outboundScopes ?? [])];
    assert.ok(!new RegExp(SECRET).test(t2.user), 'the history block is gone entirely');
    assert.ok(!outbound.includes('screenshots'),
      `nothing was sent, so screenshots must not be declared outbound — got ${JSON.stringify(outbound)}`);
  });

  test('denying screenshots does not take the rest of the history with it', async () => {
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await twoTurns('leak-partial');
    assert.match(t2.user, /What is wrong with this code\?/,
      'the conversation itself is transcript-scoped and must survive');
    assert.match(t2.user, /visited is a list/);
  });
});
