// electron/intelligence/__tests__/RefusalWordingBySourceOwner2026_08_12.test.mjs
//
// A refusal must not lie about WHERE it looked. The 2026-08-11 fix added the
// `sourceOwner` parameter for exactly that reason, but special-cased only
// 'profile' — so a transcript-owned or mixed-owned refusal still told the user
// "not directly mentioned in the uploaded material" in modes with zero uploaded
// files (code review 2026-08-12). SourceAuthorityKernel issues 'transcript' and
// 'mixed' owners as readily as 'profile', and packGovernsGeneration lets a
// bounded transcript authority reach the user, so both wordings ship.
//
// Every stem must keep the "not directly mentioned" opening: the doc-grounded
// repair sniffer (ipcHandlers REFUSAL_SNIFF_RE) keys on that phrase to tell a
// refusal from an answer, and a stem it cannot recognize would be re-repaired.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
const { buildInsufficientPropertyAnswer } = co;

// Mirrors ipcHandlers.ts REFUSAL_SNIFF_RE.
const REFUSAL_SNIFF_RE = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|^I could not find\b|^this is not directly mentioned/i;

const UPLOADED_CLAIM_RE = /uploaded material/i;

describe('refusal wording names the universe that was actually searched', () => {
  test('a profile-owned refusal says profile material', () => {
    const line = buildInsufficientPropertyAnswer({ property: 'phase_or_stage', sourceOwner: 'profile' });
    assert.match(line, /profile material/i);
    assert.doesNotMatch(line, UPLOADED_CLAIM_RE);
  });

  test('a transcript-owned refusal does NOT claim uploaded material', () => {
    const line = buildInsufficientPropertyAnswer({ property: 'phase_or_stage', sourceOwner: 'transcript' });
    assert.doesNotMatch(line, UPLOADED_CLAIM_RE,
      `a transcript_only mode has no uploaded files, got: ${line}`);
    assert.match(line, /conversation/i);
  });

  test('a mixed-owned refusal does NOT claim uploaded material', () => {
    const line = buildInsufficientPropertyAnswer({ property: 'phase_or_stage', sourceOwner: 'mixed' });
    assert.doesNotMatch(line, UPLOADED_CLAIM_RE,
      `a profile_plus_transcript mode may have zero uploaded files, got: ${line}`);
  });

  test('an absent or unknown owner keeps the historical wording', () => {
    assert.match(buildInsufficientPropertyAnswer({ property: 'phase_or_stage' }), UPLOADED_CLAIM_RE);
    assert.match(
      buildInsufficientPropertyAnswer({ property: 'phase_or_stage', sourceOwner: 'reference_files' }),
      UPLOADED_CLAIM_RE,
    );
  });

  test('every owner stays recognizable to the refusal sniffer', () => {
    for (const sourceOwner of ['profile', 'transcript', 'mixed', 'reference_files', undefined]) {
      const line = buildInsufficientPropertyAnswer({ property: 'phase_or_stage', sourceOwner });
      assert.match(line, REFUSAL_SNIFF_RE, `sniffer would miss the ${sourceOwner} refusal: ${line}`);
    }
  });

  test('the near-miss note and funding rider still attach to every stem', () => {
    const withNote = buildInsufficientPropertyAnswer({
      property: 'phase_or_stage', sourceOwner: 'transcript', nearMissNote: 'It does cover the timeline.',
    });
    assert.match(withNote, /It does cover the timeline\./);

    const funding = buildInsufficientPropertyAnswer({ property: 'funding_source', sourceOwner: 'mixed' });
    assert.match(funding, /collaboration is not the same as funding/i);
  });
});
