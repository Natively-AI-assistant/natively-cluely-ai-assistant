// Phase 6 Slice 1 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 1 — Stable turn and stream lifecycle"): the pre-required
// regression test named in that slice's plan — "a superseded attempt's
// addAssistantMessage call is REJECTED (both stores unmodified) when a
// newer attempt for the same sender has already committed." Call Graphs
// §10c said this test could not even be written without a join key; it can
// only be written now that electron/llm/turnIdentity.ts's (TurnId,
// AttemptId) identity exists — written FIRST, before any of the 13
// ipcHandlers.ts guard sites are touched, per the slice's own ordering.
//
// SessionTracker is a SINGLE shared instance across every conversational
// surface (Phase 9 surface-isolation precedent, see
// SessionTrackerSurfaceIsolation2026_07_14.test.mjs) — so attempt
// supersession is tracked PER SURFACE (mirroring lastAssistantMessageBySurface),
// not globally: a newer attempt committing on one surface must never cause a
// legitimate, un-superseded write on a DIFFERENT surface to be rejected.
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { SessionTracker } = await import(pathToFileURL(path.join(distDir, 'SessionTracker.js')).href);

function freshTracker() {
  return new SessionTracker();
}

describe('SessionTracker attempt-identity supersession (Phase 6 Slice 1)', () => {
  test('a stale (older) attempt is REJECTED once a newer attempt for the same surface has already committed', () => {
    const s = freshTracker();
    const accepted = s.addAssistantMessage(
      'The newer attempt commits first — this is the accepted, current answer.',
      undefined,
      'manual_chat',
      { turnId: 't1', attemptId: 2 },
    );
    assert.equal(accepted, true);

    const rejected = s.addAssistantMessage(
      'The older, now-superseded attempt arrives late and must be rejected.',
      undefined,
      'manual_chat',
      { turnId: 't1', attemptId: 1 },
    );
    assert.equal(rejected, false, 'a stale attempt (attemptId 1) arriving after attemptId 2 already committed must be rejected');

    // Both stores unmodified by the rejected write.
    assert.equal(
      s.getLastAssistantMessage('manual_chat'),
      'The newer attempt commits first — this is the accepted, current answer.',
    );
    assert.equal(s.getAssistantResponseHistory('manual_chat').length, 1);
  });

  test('a genuinely newer attempt after a commit is ACCEPTED', () => {
    const s = freshTracker();
    s.addAssistantMessage('First committed attempt for this turn.', undefined, 'manual_chat', { turnId: 't1', attemptId: 5 });
    const accepted = s.addAssistantMessage(
      'A real regen/repair attempt for the same turn, minted after the first.',
      undefined,
      'manual_chat',
      { turnId: 't1', attemptId: 6 },
    );
    assert.equal(accepted, true);
    assert.equal(s.getLastAssistantMessage('manual_chat'), 'A real regen/repair attempt for the same turn, minted after the first.');
    assert.equal(s.getAssistantResponseHistory('manual_chat').length, 2);
  });

  test('no-identity (legacy) calls are completely unaffected — always accepted, exactly as before', () => {
    const s = freshTracker();
    const first = s.addAssistantMessage('A legacy call with no identity argument at all.');
    const second = s.addAssistantMessage('A second legacy call, still with no identity argument.');
    assert.notEqual(first, false);
    assert.notEqual(second, false);
    assert.equal(s.getLastAssistantMessage(), 'A second legacy call, still with no identity argument.');
    assert.equal(s.getAssistantResponseHistory().length, 2);
  });

  test('supersession tracking is PER SURFACE — a newer commit on one surface never rejects an un-superseded write on a different surface', () => {
    const s = freshTracker();
    s.addAssistantMessage('A WTA suggestion with a high attemptId.', undefined, 'what_to_answer', { turnId: 'wta-1', attemptId: 10 });

    const manualAccepted = s.addAssistantMessage(
      'A manual-chat answer with a LOWER attemptId than the WTA write above, but on its own, untouched surface.',
      undefined,
      'manual_chat',
      { turnId: 'mc-1', attemptId: 3 },
    );
    assert.equal(manualAccepted, true, 'manual_chat has never had a commit of its own, so attemptId 3 is not stale for THIS surface');
    assert.equal(
      s.getLastAssistantMessage('manual_chat'),
      'A manual-chat answer with a LOWER attemptId than the WTA write above, but on its own, untouched surface.',
    );
  });

  test('a write with identity but the SAME attemptId as the current commit is accepted (idempotent re-delivery, not a stale supersede)', () => {
    const s = freshTracker();
    s.addAssistantMessage('Original commit for this attempt.', undefined, 'manual_chat', { turnId: 't1', attemptId: 4 });
    const again = s.addAssistantMessage('A duplicate delivery of the SAME attempt (e.g. a retried IPC ack).', undefined, 'manual_chat', { turnId: 't1', attemptId: 4 });
    assert.equal(again, true, 'the current attempt re-delivering is not "stale" — only a strictly OLDER attemptId is rejected');
  });
});
