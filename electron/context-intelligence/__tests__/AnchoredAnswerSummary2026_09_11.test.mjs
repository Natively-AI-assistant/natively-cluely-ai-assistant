// An anchored answer write also moves the follow-up anchor (task 7b, issue
// #552 live-verification).
//
// Live run: voice `rag:query-live('when is the secrets rotation')` answered
// and was recorded via recordAnswerSummary — but the NEXT typed "expand on
// that" was rewritten as a FOLLOW_UP anchored to the PREVIOUS TYPED question
// (Jonas), because recordAnswerSummary appends the turn and sets
// previousAnswerSummary but never previousQuestion — only advance() does.
// `{ anchor: true }` fixes the live RAG write specifically: it is a turn that
// completed synchronously and is certainly the newest.
//
// Imports compiled output: run `npm run build:electron` first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (rel) => pathToFileURL(path.resolve(process.cwd(), `dist-electron/electron/${rel}`)).href;
const { recordAnswerSummary, getConversationState } =
  await import(dist('context-intelligence/question/conversation-state-store.js'));

describe('recordAnswerSummary({ anchor })', () => {
  test('an anchored write moves previousQuestion to the newly-answered question', () => {
    const sid = `anchor-test-${Math.random()}`;
    recordAnswerSummary(sid, 'A1', undefined, 'Q1');
    recordAnswerSummary(sid, 'A2', undefined, 'Q2', { anchor: true });
    const state = getConversationState(sid);
    assert.equal(state.previousQuestion, 'Q2');
    assert.equal(state.turns.length, 2);
  });

  test('without anchor, previousQuestion stays whatever it already was', () => {
    const sid = `no-anchor-test-${Math.random()}`;
    recordAnswerSummary(sid, 'A1', undefined, 'Q1');
    recordAnswerSummary(sid, 'A2', undefined, 'Q2');
    const state = getConversationState(sid);
    assert.equal(state.previousQuestion, 'Q1');
    assert.equal(state.turns.length, 2);
  });
});
