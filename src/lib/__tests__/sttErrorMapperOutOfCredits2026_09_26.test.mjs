// An account with no credits left is not "a quota for this period".
//
// OpenAIStreamingSTT reports OpenAI's insufficient_quota as
// "insufficient_quota: You have no credits remaining. Add credits…" (live,
// 2026-09-26). Before this case, the message either fell through to the
// generic "STT Provider Error" (OpenAI's own text never says "quota"), or
// matched the generic quota case, which says the limit resets "for this period".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeSttError } from '../sttErrorMapper.ts';

test('OpenAI out of credits reads as Out of Credits, in the quota category', () => {
  const c = categorizeSttError('insufficient_quota: You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.');
  assert.equal(c.title, 'Out of Credits');
  assert.equal(c.category, 'quota');
  assert.doesNotMatch(c.body, /for this period/);
});

test('a per-period transcription quota still reads as a limit reached', () => {
  const c = categorizeSttError('transcription_quota_exceeded');
  assert.equal(c.title, 'Transcription Limit Reached');
});
