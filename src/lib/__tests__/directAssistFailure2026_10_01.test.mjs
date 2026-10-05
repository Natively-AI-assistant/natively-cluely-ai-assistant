// What the overlay says when a provider fails (2026-10-01).
//
// It used to say "X didn't respond" for every cause, and when the whole answer
// failed it printed the internal code ("❌ AUTH_FAILED: …"). Both are gone:
// the cause is worded in plain language, no code or status number is shown,
// and every state has the same shape — a headline, the provider's own words,
// one row per provider that failed, and a way to fix it when there is one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_ASSIST_PHRASES,
  directAssistFailureReason,
  directAssistFailureText,
  directAssistNoticeView,
  CHAT_HINTS,
  CHAT_NOTES,
  chatNoteText,
} from '../directAssistFailure.mjs';

// The codes main can send (electron/direct-assist/types.ts), plus the ones the
// IPC handler and the overlay add around them.
const CODES = [
  'INVALID_REQUEST', 'NO_PROVIDER_CONFIGURED', 'MODEL_UNAVAILABLE', 'MODEL_DOES_NOT_SUPPORT_IMAGES',
  'SCREENSHOT_BLOCKED_BY_PRIVACY', 'TRANSCRIPT_BLOCKED_BY_PRIVACY', 'INVALID_ATTACHMENT',
  'CONTEXT_TOO_LARGE', 'AUTH_FAILED', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'CONNECT_TIMEOUT',
  'STREAM_IDLE_TIMEOUT', 'INCOMPLETE_STREAM', 'PROVIDER_ERROR', 'CANCELLED', 'INTERNAL_ERROR',
  'SKILL_NOT_FOUND', 'SKILL_DISABLED', 'DIRECT_ASSIST_REJECTED', 'DIRECT_ASSIST_UNAVAILABLE',
  // Answers Natively stopped itself (2026-10-04): the length limit, repetition.
  'OUTPUT_LIMIT', 'OUTPUT_REPETITION',
  'SOMETHING_NEW_FROM_A_LATER_BUILD',
];
const STATUSES = [undefined, 400, 401, 402, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504, 529, 418];
const RAW_CODE = /\b[A-Z]+(?:_[A-Z]+)+\b/;

// ── one provider's reason ───────────────────────────────────────────────────

test('each cause is worded as what happened', () => {
  const reason = (code, extra = {}) => directAssistFailureReason({ provider: 'OpenAI', code, ...extra });
  assert.equal(reason('AUTH_FAILED'), 'OpenAI rejected your key or sign-in');
  assert.equal(reason('RATE_LIMITED'), 'OpenAI is rate limiting requests');
  assert.equal(reason('QUOTA_EXHAUSTED'), 'OpenAI is out of credits');
  assert.equal(reason('MODEL_UNAVAILABLE'), "OpenAI doesn't have this model");
  assert.equal(reason('NO_PROVIDER_CONFIGURED'), "OpenAI isn't set up");
  assert.equal(reason('STREAM_IDLE_TIMEOUT'), 'OpenAI stopped responding');
  assert.equal(reason('INCOMPLETE_STREAM'), 'OpenAI returned an empty answer');
  assert.equal(reason('INCOMPLETE_STREAM', { partial: true }), 'OpenAI stopped before finishing');
  assert.equal(reason('PROVIDER_ERROR'), 'OpenAI failed');
});

test('a timeout says how long the provider was actually given', () => {
  const reason = (waitedMs) => directAssistFailureReason({ provider: 'Google', code: 'CONNECT_TIMEOUT', waitedMs });
  assert.equal(reason(35_000), "Google didn't respond in 35 s");
  assert.equal(reason(70_400), "Google didn't respond in 70 s");
  // No measurement, or one too short to be worth a number.
  assert.equal(reason(undefined), "Google didn't respond in time");
  assert.equal(reason(300), "Google didn't respond in time");
});

test('a generic provider error is worded from its status, in words', () => {
  const reason = (status) => directAssistFailureReason({ provider: 'Custom', code: 'PROVIDER_ERROR', status });
  assert.equal(reason(401), 'Custom rejected your key or sign-in');
  assert.equal(reason(403), 'Custom rejected your key or sign-in');
  assert.equal(reason(402), 'Custom is out of credits');
  assert.equal(reason(429), 'Custom is rate limiting requests');
  assert.equal(reason(404), "Custom doesn't have this model");
  assert.equal(reason(400), 'Custom rejected the request');
  assert.equal(reason(422), 'Custom rejected the request');
  assert.equal(reason(413), 'Custom rejected the request as too large');
  assert.equal(reason(408), "Custom didn't respond in time");
  assert.equal(reason(504), "Custom didn't respond in time");
  assert.equal(reason(503), 'Custom is overloaded');
  assert.equal(reason(529), 'Custom is overloaded');
  assert.equal(reason(500), 'Custom had a server error');
  assert.equal(reason(418), 'Custom failed');
});

test('a provider that could not be reached says so, instead of a bare "failed"', () => {
  // Offline, or a local server that is not running: the commonest failure.
  assert.equal(
    directAssistFailureReason({ provider: 'Ollama', code: 'PROVIDER_ERROR', unreachable: true }),
    "Ollama couldn't be reached",
  );
  // A named cause still wins.
  assert.equal(
    directAssistFailureReason({ provider: 'Ollama', code: 'CONNECT_TIMEOUT', unreachable: true }),
    "Ollama didn't respond in time",
  );
});

test('a specific code wins over the status beside it', () => {
  assert.equal(
    directAssistFailureReason({ provider: 'Groq', code: 'RATE_LIMITED', status: 503 }),
    'Groq is rate limiting requests',
  );
});

// ── a different provider answered ───────────────────────────────────────────

const HOP = { provider: 'OpenAI', code: 'AUTH_FAILED', status: 401, detail: 'Incorrect API key provided: …', next: 'Google' };

test('while the next provider is tried, the headline is an attempt and never an outcome', () => {
  assert.deepEqual(directAssistNoticeView({ fallbackNotice: { hops: [HOP] } }), {
    tone: 'trying',
    headline: 'Trying Google…',
    rows: [{ text: 'OpenAI rejected your key or sign-in', detail: 'Incorrect API key provided: …' }],
    fixable: true,
  });
});

test('once someone answered, the headline says who, and each provider that failed keeps its own row', () => {
  const hops = [
    HOP,
    { provider: 'Groq', code: 'CONNECT_TIMEOUT', waitedMs: 35_000, next: 'Google' },
  ];
  assert.deepEqual(directAssistNoticeView({ fallbackNotice: { hops, answeredBy: 'Google' }, ended: true }), {
    tone: 'answered',
    headline: 'Answered by Google',
    rows: [
      { text: 'OpenAI rejected your key or sign-in', detail: 'Incorrect API key provided: …' },
      { text: "Groq didn't respond in 35 s" },
    ],
    fixable: true,
  });
});

test('a fallback caused by something the user cannot fix offers no settings action', () => {
  const hops = [{ provider: 'OpenAI', code: 'RATE_LIMITED', next: 'Google' }];
  assert.equal(directAssistNoticeView({ fallbackNotice: { hops, answeredBy: 'Google' } }).fixable, false);
});

test('nothing to say gives no notice', () => {
  assert.equal(directAssistNoticeView({}), null);
  assert.equal(directAssistNoticeView({ fallbackNotice: { hops: [] } }), null);
  // A request that was cancelled after a switch: nobody answered, nothing
  // failed for good, and "trying" would describe something no longer happening.
  assert.equal(directAssistNoticeView({ fallbackNotice: { hops: [HOP] }, ended: true }), null);
});

// ── nobody answered ─────────────────────────────────────────────────────────

test('one provider failing is the headline, with its own words beneath and a way to fix it', () => {
  assert.deepEqual(
    directAssistNoticeView({
      failure: {
        provider: 'Anthropic', code: 'QUOTA_EXHAUSTED', status: 402,
        message: 'The selected provider has no available quota.',
        detail: 'Your credit balance is too low to access the Anthropic API.',
      },
      ended: true,
    }),
    {
      tone: 'failed',
      headline: 'Anthropic is out of credits',
      detail: 'Your credit balance is too low to access the Anthropic API.',
      rows: [],
      fixable: true,
    },
  );
});

test('when every provider failed, each one is listed with its own reason', () => {
  const view = directAssistNoticeView({
    failure: {
      provider: 'OpenAI', code: 'AUTH_FAILED', status: 401, message: 'x', detail: 'Incorrect API key provided.',
      attempts: [
        { provider: 'OpenAI', code: 'AUTH_FAILED', status: 401, detail: 'Incorrect API key provided.' },
        { provider: 'Google', code: 'PROVIDER_ERROR', status: 503, detail: 'The model is overloaded.' },
        { provider: 'Ollama', code: 'PROVIDER_ERROR', unreachable: true, detail: 'connect ECONNREFUSED 127.0.0.1:11434' },
      ],
    },
    ended: true,
  });
  assert.deepEqual(view, {
    tone: 'failed',
    headline: 'None of your providers could answer',
    rows: [
      { text: 'OpenAI rejected your key or sign-in', detail: 'Incorrect API key provided.' },
      { text: 'Google is overloaded', detail: 'The model is overloaded.' },
      { text: "Ollama couldn't be reached", detail: 'connect ECONNREFUSED 127.0.0.1:11434' },
    ],
    fixable: true,
  });
  // The first provider's words are on its row; repeating them under the
  // headline would say the same thing twice.
  assert.equal('detail' in view, false);
});

test('a request that never reached a provider shows the sentence main wrote', () => {
  const view = (failure) => directAssistNoticeView({ failure, ended: true });
  assert.equal(
    view({ provider: 'OpenAI', code: 'INVALID_ATTACHMENT', message: 'The image attachment could not be read.' }).headline,
    'The image attachment could not be read.',
  );
  assert.equal(view({ code: 'DIRECT_ASSIST_REJECTED', message: '' }).headline, "The request couldn't be completed.");
});

test('with no provider set up at all, the notice says so in plain words and offers the fix', () => {
  // The first-run case. Main's sentence for it is internal wording
  // ("No usable Direct Assist provider is configured."), and it is the one
  // failure where opening AI Providers is exactly what to do.
  assert.deepEqual(
    directAssistNoticeView({
      failure: { code: 'NO_PROVIDER_CONFIGURED', message: 'No usable Direct Assist provider is configured.' },
      ended: true,
    }),
    { tone: 'failed', headline: 'No AI provider is set up yet', rows: [], fixable: true },
  );
});

test('a problem on our side is not worded as every provider failing', () => {
  // An unreadable screenshot is thrown inside each provider attempt, so main
  // walks the whole ladder and reports an attempt per provider — all with the
  // same cause, none of them the provider's.
  const attempt = { code: 'INVALID_ATTACHMENT', detail: 'The image attachment could not be read.' };
  const view = directAssistNoticeView({
    failure: {
      provider: 'OpenAI',
      code: 'INVALID_ATTACHMENT',
      message: 'The image attachment could not be read.',
      detail: 'The image attachment could not be read.',
      attempts: [{ provider: 'OpenAI', ...attempt }, { provider: 'Google', ...attempt }],
    },
    ended: true,
  });
  assert.deepEqual(view, {
    tone: 'failed',
    headline: 'The image attachment could not be read.',
    rows: [],
    fixable: false,
  });
});

test('the same sentence is never shown twice, once as the headline and once as the words beneath it', () => {
  const view = directAssistNoticeView({
    failure: {
      provider: 'Ollama', code: 'PROVIDER_ERROR',
      message: 'Cloud providers are disabled in local-only mode.',
      detail: 'Cloud providers are disabled in local-only mode.',
    },
    ended: true,
  });
  // Here the sentence is ours and explains more than "Ollama failed" does, so
  // it is the headline.
  assert.deepEqual(view, {
    tone: 'failed',
    headline: 'Cloud providers are disabled in local-only mode.',
    rows: [],
    fixable: false,
  });
});

test('a fault inside the app is never blamed on the provider', () => {
  const view = directAssistNoticeView({
    failure: { provider: 'OpenAI', code: 'INTERNAL_ERROR', message: 'Natively lost track of this answer.' },
    ended: true,
  });
  assert.equal(view.headline, 'Natively lost track of this answer. Ask again.');
  assert.doesNotMatch(view.headline, /OpenAI/);
  assert.equal(view.fixable, false);
});

// ── an answer that broke off partway ────────────────────────────────────────

test('a cut-off answer says so, then why, then what failed before it', () => {
  assert.deepEqual(
    directAssistNoticeView({
      failure: { provider: 'Google', code: 'PROVIDER_ERROR', status: 503, message: 'x', partial: true, detail: 'The model is overloaded.' },
      fallbackNotice: { hops: [HOP] },
      ended: true,
    }),
    {
      tone: 'cutoff',
      headline: 'Answer cut off',
      rows: [
        { text: 'Google is overloaded', detail: 'The model is overloaded.' },
        { text: 'OpenAI rejected your key or sign-in', detail: 'Incorrect API key provided: …' },
      ],
      fixable: true,
    },
  );
});

test('a cut-off answer whose own provider stalled reads as stopping, not as returning nothing', () => {
  const view = directAssistNoticeView({
    failure: { provider: 'Groq', code: 'INCOMPLETE_STREAM', message: 'x', partial: true },
    ended: true,
  });
  assert.deepEqual(view.rows, [{ text: 'Groq stopped before finishing' }]);
  assert.equal(view.fixable, false);
});

// ── the plain sentence kept as the message text ─────────────────────────────

test('the failed message keeps one plain sentence as its text, for copy and for later context', () => {
  assert.equal(
    directAssistFailureText({ provider: 'Anthropic', code: 'QUOTA_EXHAUSTED', message: 'x', detail: 'provider words' }),
    'Anthropic is out of credits.',
  );
  assert.equal(
    directAssistFailureText({ provider: 'OpenAI', code: 'AUTH_FAILED', message: 'x', attempts: [{ provider: 'OpenAI', code: 'AUTH_FAILED' }, { provider: 'Google', code: 'PROVIDER_ERROR' }] }),
    'None of your providers could answer.',
  );
  // A sentence that already ends itself is not given a second full stop.
  assert.equal(
    directAssistFailureText({ code: 'INVALID_ATTACHMENT', message: 'The image attachment could not be read.' }),
    'The image attachment could not be read.',
  );
});

// ── nothing internal on screen ──────────────────────────────────────────────

test('no internal code and no status number ever reaches the screen', () => {
  const seen = [];
  const collectView = (view) => {
    if (!view) return;
    seen.push(view.headline);
    if (view.detail) seen.push(view.detail);
    for (const row of view.rows) seen.push(row.text);
  };
  for (const code of CODES) {
    for (const status of STATUSES) {
      for (const partial of [false, true]) {
        for (const provider of ['OpenAI', undefined]) {
          const failure = { provider, code, status, partial, waitedMs: 35_000, message: 'The request could not be read.' };
          collectView(directAssistNoticeView({ failure, ended: true }));
          seen.push(directAssistFailureText(failure));
          if (!provider) continue;
          seen.push(directAssistFailureReason(failure));
          collectView(directAssistNoticeView({ fallbackNotice: { hops: [{ ...failure, next: 'Google' }], answeredBy: 'Google' } }));
          collectView(directAssistNoticeView({ fallbackNotice: { hops: [{ ...failure, next: 'Google' }] } }));
          collectView(directAssistNoticeView({ failure: { ...failure, attempts: [failure, failure] }, ended: true }));
        }
      }
    }
  }
  assert.ok(seen.length > 1000);
  for (const text of seen) {
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, RAW_CODE, `"${text}" shows an internal code`);
    assert.doesNotMatch(text, /\bE[A-Z]{4,}\b/, `"${text}" shows a socket error code`);
    assert.doesNotMatch(text, /\bHTTP\b|\b[1-5]\d\d\b/, `"${text}" shows a status number`);
    assert.doesNotMatch(text, /❌/u, `"${text}" uses an emoji as an icon`);
  }
});

// ── translation ─────────────────────────────────────────────────────────────

test('whole sentences go through the translator, so a language can put the name where it belongs', () => {
  const asked = [];
  // A translator that moves the provider to the end, as Japanese would.
  const t = (text) => {
    asked.push(text);
    return text === '{provider} rejected your key or sign-in' ? 'key rejected by: {provider}'
      : text === 'Answered by {provider}' ? '{provider} answered'
      : text;
  };
  const view = directAssistNoticeView({ fallbackNotice: { hops: [HOP], answeredBy: 'Google' } }, t);
  assert.equal(view.headline, 'Google answered');
  assert.equal(view.rows[0].text, 'key rejected by: OpenAI');
  // Names and the provider's own words are never sent for translation.
  assert.ok(!asked.includes('OpenAI') && !asked.includes('Google') && !asked.includes(HOP.detail));
});

test('every sentence the module can ask the translator for is on its published list', () => {
  const asked = new Set();
  const t = (text) => { asked.add(text); return text; };
  for (const code of CODES) {
    for (const status of STATUSES) {
      for (const partial of [false, true]) {
        for (const unreachable of [false, true]) {
          for (const waitedMs of [undefined, 35_000]) {
            const failure = { provider: 'OpenAI', code, status, partial, unreachable, waitedMs, message: '' };
            directAssistNoticeView({ failure, ended: true }, t);
            directAssistNoticeView({ failure: { ...failure, provider: undefined }, ended: true }, t);
            directAssistNoticeView({ failure: { ...failure, attempts: [failure, failure] }, ended: true }, t);
            directAssistNoticeView({ fallbackNotice: { hops: [{ ...failure, next: 'Google' }] } }, t);
            directAssistNoticeView({ fallbackNotice: { hops: [{ ...failure, next: 'Google' }], answeredBy: 'Google' } }, t);
            directAssistFailureText(failure, t);
          }
        }
      }
    }
  }
  // The overlay's other answer paths (chatFailure.mjs) reach a few more: a
  // trial that ended, Natively's own plan, and the quiet line for a quick
  // action pressed twice.
  for (const code of ['TRIAL_ENDED', 'PLAN_LIMIT', 'PLAN_EXPIRED']) directAssistNoticeView({ failure: { code }, ended: true }, t);
  for (const hint of Object.values(CHAT_HINTS)) t(hint);
  // And the quiet notes about an answer (late, stopped, replaced, none yet).
  for (const kind of Object.keys(CHAT_NOTES)) chatNoteText({ kind, question: 'q' }, t);
  assert.deepEqual([...asked].sort(), [...DIRECT_ASSIST_PHRASES].sort());
});
