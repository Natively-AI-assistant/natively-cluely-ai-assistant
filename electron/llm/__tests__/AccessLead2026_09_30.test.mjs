// Access-lead strip (2026-09-30) — see electron/llm/accessLead.ts. Cases are the
// real Team Meet / Recruiting / Call Center replies from the fix5 dev run.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAccessLead } from '../../../dist-electron/electron/llm/accessLead.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = fs.readFileSync(path.join(HERE, '..', '..', 'IntelligenceEngine.ts'), 'utf8');

describe('removed: a notes/records sentence before the question that moves things', () => {
  test('DTEAM-006', () => {
    const r = stripAccessLead("I don't have the Monday notes in front of me, so I can't confirm that freeze. Can we check what we actually agreed before we treat the onboarding screens as locked? If it was a freeze, I'll hold to it.", 'team-meet');
    assert.equal(r.stripped, true);
    assert.equal(r.text, "Can we check what we actually agreed before we treat the onboarding screens as locked? If it was a freeze, I'll hold to it.");
  });
  test('DTEAM-027', () => {
    const r = stripAccessLead("I can't confirm it from my notes, so I don't want to say we did. Let's check last week's notes and settle it today before anyone builds on it.", 'team-meet');
    assert.equal(r.stripped, true);
    assert.match(r.text, /^Let's check last week's notes/);
  });
  test('the [[GIST]] chip stays', () => {
    const r = stripAccessLead("I don't have that in front of me, so I'd rather not guess at where we landed. Let me pull up the notes from that discussion and confirm the decision today.\n\n[[GIST]] confirm the decision", 'team-meet');
    assert.equal(r.stripped, true);
    assert.match(r.text, /\[\[GIST\]\] confirm the decision$/);
  });
  test('Recruiting: DREC-035', () => {
    const r = stripAccessLead("I don't have a confirmed range in front of me, so I don't want to give you a number I can't stand behind. What I can do is go back to the hiring team and get the band for this level.", 'recruiting');
    assert.equal(r.stripped, true);
  });
});

describe('kept', () => {
  test('the sentence carries the reply\'s own commitment (DREC-031)', () => {
    const a = "I don't have the reporting line in front of me, so I'll confirm who the role reports to with the hiring manager and come back to you. What I can say now is that it's a hands-on role.";
    assert.equal(stripAccessLead(a, 'recruiting').stripped, false);
  });
  test('a status or policy sentence, not access (DTEAM-001, DCC-036)', () => {
    assert.equal(stripAccessLead("I don't have a confirmed status on the Android crash yet. Let me check the latest crash reports and get back to you.", 'team-meet').stripped, false);
    assert.equal(stripAccessLead("I can't confirm a credit yet, and I don't want to promise one. Once we know whether this is on our side, I'll come back to you. Are all the cameras down?", 'team-meet').stripped, false);
  });
  test('nothing that moves the conversation follows', () => {
    assert.equal(stripAccessLead("I don't have the notes in front of me. The release went out on time last quarter.", 'team-meet').stripped, false);
    assert.equal(stripAccessLead("I don't have the notes in front of me. Can we check?", 'team-meet').stripped, false);
  });
  test('other modes are untouched', () => {
    const a = "I don't have the policy in front of me, so I won't guess. What I'd check is whether it can be resolved on this call.";
    for (const m of ['call-center', 'sales', 'general', 'looking-for-work', 'seminar', null]) assert.equal(stripAccessLead(a, m).stripped, false, String(m));
  });
});

test('wired after the planning-preamble strip on the hotkey path, with the turn\'s mode', () => {
  const pre = ENGINE.indexOf("console.warn('[IntelligenceEngine] planning-preamble guard skipped:'");
  const al = ENGINE.indexOf('const al = stripAccessLead(fullAnswer, requestSnapshot.modeId);');
  const steer = ENGINE.indexOf('// STEERING-TAIL STRIP');
  assert.ok(pre > 0 && al > pre && steer > al);
});
