// Account and key failures across the live STT providers (2026-11-01).
//
// After the ElevenLabs quota report (ElevenLabsQuotaError2026_11_01) an audit
// of the other providers found the same shape everywhere: a provider stops on
// a verdict about the key or account but main counts it as one retryable
// error, so the overlay shows "reconnecting" for the rest of the meeting; or
// the reason never reaches main at all. Each case below goes provider error
// -> main's classifier (sttErrorClassifier.mjs) -> overlay copy
// (sttErrorMapper.ts), the path the user actually sees.
//
// Shared code with no platform branch: the same path runs on macOS and Windows.
//
// Run (after `npm run build:electron`):
//   node --test electron/audio/__tests__/SttProviderTerminalErrors2026_11_01.test.mjs
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (file) => require(path.join(REPO, 'dist-electron/electron/audio', file));
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// RestSTT posts to api.groq.com; route it to a local stand-in (as RestSttRateLimit does).
let serverPort = 0;
const realHttpsRequest = https.request;
https.request = function (opts, ...rest) {
    if (opts && typeof opts === 'object' && (opts.host === 'api.groq.com' || opts.hostname === 'api.groq.com')) {
        const local = { ...opts, host: '127.0.0.1', hostname: '127.0.0.1', port: serverPort, protocol: 'http:', agent: undefined, lookup: undefined };
        local.createConnection = () => net.connect(serverPort, '127.0.0.1');
        return http.request(local, ...rest);
    }
    return realHttpsRequest.call(this, opts, ...rest);
};

const { classifySttError, describeSttError, restAccountVerdict } = await import(path.join(REPO, 'electron/audio/sttErrorClassifier.mjs'));
const { categorizeSttError } = await import(path.join(REPO, 'src/lib/sttErrorMapper.ts'));
const { nativelyProServerError } = dist('NativelyProSTT.js');
const { deepgramEventError } = dist('DeepgramStreamingSTT.js');
const { deepgramHandshakeVerdict } = dist('deepgramHandshakeProbe.js');
const { sonioxServerError, sonioxCloseAction } = dist('SonioxStreamingSTT.js');
const { NvidiaNimStreamingSTT, nvidiaNimStreamError } = dist('NvidiaNimStreamingSTT.js');
const { qwenEventError } = dist('QwenRealtimeSTT.js');
const { openAiHandshakeVerdict } = dist('OpenAIStreamingSTT.js');
const { RestSTT } = dist('RestSTT.js');

/** What main decides and what the overlay says, for one provider error. */
const seen = (err) => {
    const verdict = classifySttError(err);
    return { kind: verdict.kind, title: categorizeSttError(verdict.errorMessage).title, message: verdict.errorMessage };
};
const axiosError = (status, data, statusText = '') =>
    Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, statusText, data } });

let restoreConsole = () => {};
before(() => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    restoreConsole = () => Object.assign(console, saved);
});
after(() => restoreConsole());

describe("main's classifier", () => {
    test('reads the axios body: OpenAI 429 insufficient_quota is out of credits, not a rate limit', () => {
        const err = axiosError(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } });
        assert.deepEqual(seen(err), {
            kind: 'quota',
            title: 'Out of Credits',
            message: '429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)',
        });
    });

    test('a plain 429 rate limit stays retryable', () => {
        const err = axiosError(429, { error: { message: 'Rate limit reached for model `whisper-large-v3-turbo` on requests per minute (RPM)', type: 'requests', code: 'rate_limit_exceeded' } });
        const s = seen(err);
        assert.equal(s.kind, 'retry');
        assert.equal(s.title, 'Rate Limited');
        // A per-minute "quota" on a 429 is still a rate limit.
        assert.equal(classifySttError(axiosError(429, { error: { message: 'Quota exceeded for requests per minute' } })).kind, 'retry');
    });

    test('402 is out of credits, 401 and 403 are final', () => {
        assert.equal(classifySttError(axiosError(402, { error: 'Payment Required' })).kind, 'quota');
        assert.equal(seen(axiosError(401, { error: { message: 'Invalid API Key', code: 'invalid_api_key' } })).title, 'Authentication Failed');
        assert.equal(classifySttError(axiosError(401, { error: { message: 'Invalid API Key' } })).kind, 'auth');
        const forbidden = seen(axiosError(403, undefined, 'Forbidden'));
        assert.equal(forbidden.kind, 'auth');
        assert.equal(forbidden.title, 'Access Denied');
    });

    test('a provider that has stopped (terminal) ends as failed; quota keeps its stand-in branch', () => {
        assert.equal(classifySttError(Object.assign(new Error('gave up'), { terminal: true })).kind, 'auth');
        assert.equal(classifySttError(Object.assign(new Error('quota_exceeded: no more'), { terminal: true })).kind, 'quota');
    });

    test('what did not change: idle timeout, network drops, Google quota wording, local model', () => {
        assert.equal(classifySttError(Object.assign(new Error('Audio Timeout Error'), { code: 11 })).kind, 'idle');
        const reset = classifySttError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        assert.equal(reset.kind, 'retry');
        assert.equal(reset.errorMessage, 'socket hang up (ECONNRESET)');
        assert.equal(classifySttError(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded for quota metric')).kind, 'quota');
        assert.equal(classifySttError(Object.assign(new Error('x'), { code: 'local_stt_unavailable' })).kind, 'local_unavailable');
        assert.equal(classifySttError(new Error('Soniox: 503 - try again')).kind, 'retry');
    });

    test('httpStatus without an axios response leads the message (overlay rules key on it)', () => {
        assert.equal(describeSttError(Object.assign(new Error('Soniox: no'), { httpStatus: 403 })).errorMessage, '403 Soniox: no');
        assert.equal(describeSttError(Object.assign(new Error('402 already'), { httpStatus: 402 })).errorMessage, '402 already');
    });
});

describe('Natively Pro relay', () => {
    test('account verdicts are terminal, keep their code and the relay text, and get their own copy', () => {
        const cases = [
            ['trial_expired', 'Trial Expired'],
            ['subscription_inactive', 'Subscription Inactive'],
            ['account_suspended', 'Account Suspended'],
            ['auth_required', 'Sign In Required'],
        ];
        for (const [code, title] of cases) {
            const err = nativelyProServerError({ error: code, message: 'Renew at natively.software/api' }, true);
            assert.equal(err.code, code);
            assert.equal(err.terminal, true);
            assert.equal(err.message, `${code}: Renew at natively.software/api`);
            assert.deepEqual([seen(err).kind, seen(err).title], ['auth', title], code);
        }
        const quota = nativelyProServerError({ error: 'transcription_quota_exceeded' }, true);
        assert.deepEqual([seen(quota).kind, seen(quota).title], ['quota', 'Transcription Limit Reached']);
        assert.equal(nativelyProServerError({ error: 'upstream_error' }, false).terminal, false);
    });

    test('the relay token carve-out is never terminal', () => {
        const src = read('electron/audio/NativelyProSTT.ts');
        assert.match(src, /const relayTokenRejected = msg\.error === 'invalid_key_format' && this\.isOnRelayTarget\(connectUrl\);/);
        assert.match(src, /const fatal = NativelyProSTT\.FATAL_SERVER_ERRORS\.has\(String\(msg\.error\)\) && !relayTokenRejected;/);
        assert.match(src, /this\.emit\('error', nativelyProServerError\(msg, fatal\)\);/);
        assert.ok(!/this\.emit\('error', new Error\(msg\.error\)\)/.test(src));
    });
});

describe('Deepgram', () => {
    test('the SDK error event never reaches the overlay as "[object Event]"', () => {
        // Node's built-in WebSocket hands the SDK an ErrorEvent, not an Error.
        const event = { type: 'error', message: 'Received network error or non-101 status code.', toString: () => '[object ErrorEvent]' };
        assert.equal(deepgramEventError(event).message, 'Deepgram: Received network error or non-101 status code.');
        assert.equal(deepgramEventError({ type: 'error', toString: () => '[object Event]' }).message, 'Deepgram connection error (error)');
        assert.equal(deepgramEventError({ event: {}, message: 'Unable to parse `data` as JSON.', error: new Error('bad') }).message, 'Deepgram: Unable to parse `data` as JSON.');
        const real = new Error('kept');
        assert.equal(deepgramEventError(real), real);
    });

    test('a refused handshake is diagnosed: 401 key, 402 credits, 403 scope; anything else retries', () => {
        const key = deepgramHandshakeVerdict({ status: 401, body: '{"err_code":"INVALID_AUTH","err_msg":"Invalid credentials."}' });
        assert.equal(key.terminal, true);
        assert.equal(key.httpStatus, 401);
        assert.deepEqual([seen(key).kind, seen(key).title], ['auth', 'Authentication Failed']);
        assert.match(key.message, /Invalid credentials\./);
        const credits = deepgramHandshakeVerdict({ status: 402, body: '{"err_msg":"Insufficient balance"}' });
        assert.deepEqual([seen(credits).kind, seen(credits).title], ['quota', 'Out of Credits']);
        const scope = deepgramHandshakeVerdict({ status: 403, body: 'nope' });
        assert.deepEqual([seen(scope).kind, seen(scope).title], ['auth', 'Access Denied']);
        for (const r of [null, { status: 101, body: '' }, { status: 400, body: '' }, { status: 500, body: '' }, { status: 429, body: '' }]) {
            assert.equal(deepgramHandshakeVerdict(r), null, JSON.stringify(r));
        }
    });

    test('wiring: probe once when a socket never opened; latch off after the last attempt', () => {
        const src = read('electron/audio/DeepgramStreamingSTT.ts');
        assert.match(src, /this\.emit\('error', deepgramEventError\(err\)\);/);
        assert.match(src, /if \(!opened && this\.shouldReconnect && !this\.handshakeProbed\) \{/);
        assert.match(src, /this\.handshakeProbed = false;\s*this\.connect\(\);/, 'start() re-arms the probe');
        const giveUp = src.slice(src.indexOf('if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {'));
        assert.ok(giveUp.indexOf('this.shouldReconnect = false;') < giveUp.indexOf("this.emit('error'"), 'latched before reporting, so sendAudio cannot reconnect per chunk');
        assert.match(giveUp.slice(0, 600), /\{ terminal: true \}/);
        const diagnose = src.slice(src.indexOf('private async diagnoseRefusedHandshake'));
        assert.match(diagnose.slice(0, 600), /if \(!verdict \|\| !this\.isActive \|\| !this\.shouldReconnect\) return;/);
    });
});

describe('Soniox', () => {
    test('session-ending error frames are terminal; idle, rate and server errors are not', () => {
        const key = sonioxServerError(401, 'Invalid API key.');
        assert.equal(key.terminal, true);
        assert.deepEqual([seen(key).kind, seen(key).title], ['auth', 'Authentication Failed']);
        const balance = sonioxServerError(402, 'Organization balance exhausted.');
        assert.equal(balance.terminal, true);
        assert.deepEqual([seen(balance).kind, seen(balance).title], ['quota', 'Out of Credits']);
        const config = sonioxServerError(400, 'Invalid model.');
        assert.deepEqual([config.terminal, seen(config).title], [true, 'Invalid Configuration']);
        for (const code of [408, 429, 500, 503]) {
            assert.equal(sonioxServerError(code, 'x').terminal, false, String(code));
            assert.equal(seen(sonioxServerError(code, 'x')).kind, 'retry', String(code));
        }
    });

    test('a clean close with no error frame backs off instead of going silent', () => {
        assert.equal(sonioxCloseAction(true, 1000, null), 'backoff');
        assert.equal(sonioxCloseAction(true, 1000, 402), 'inactive');
        const src = read('electron/audio/SonioxStreamingSTT.ts');
        assert.match(src, /this\.emit\('error', sonioxServerError\(msg\.error_code, msg\.error_message\)\);/);
        assert.match(src, /new Error\('SonioxStreamingSTT: max reconnect attempts exceeded'\), \{ terminal: true \}/);
    });
});

describe('Google', () => {
    test('a permanent gRPC failure that is not a credential problem is emitted terminal', () => {
        const src = read('electron/audio/GoogleSTT.ts');
        assert.match(src, /: isPermanent\s*\? Object\.assign\(err instanceof Error \? err : new Error\(String\(\(err as any\)\?\.message \?\? err\)\), \{ terminal: true \}\)\s*: err,/);
        // PERMISSION_DENIED (7) is in the permanent set the terminal flag follows.
        assert.match(src, /PERMANENT_GRPC_CODES = new Set\(\[3, 7, 16\]\)/);
    });
});

describe('NVIDIA NIM', () => {
    const fakeFactory = () => {
        const streams = [];
        const factory = () => {
            const s = new EventEmitter();
            s.write = () => true;
            s.end = () => {};
            streams.push(s);
            return s;
        };
        return { factory, streams };
    };
    const grpc = (code, message) => Object.assign(new Error(`${code} ${message}`), { code });

    test('UNAUTHENTICATED / PERMISSION_DENIED stop at once, terminal, with no reconnect', () => {
        for (const code of [16, 7]) {
            const { factory, streams } = fakeFactory();
            const stt = new NvidiaNimStreamingSTT('nvapi-test', undefined, factory);
            const errors = [];
            stt.on('error', (e) => errors.push(e));
            stt.start();
            streams[0].emit('error', grpc(code, 'denied'));
            assert.equal(errors.length, 1);
            assert.equal(errors[0].terminal, true);
            assert.equal(seen(errors[0]).kind, 'auth');
            stt.write(Buffer.alloc(3200));
            assert.equal(streams.length, 1, `code ${code}: reconnected after a key verdict`);
            stt.stop();
        }
        assert.equal(nvidiaNimStreamError(grpc(14, 'unavailable')).terminal, undefined);
        assert.equal(nvidiaNimStreamError('plain').message, 'plain');
    });

    test('giving up after the last attempt is reported terminal; a long-lived stream resets the backoff', () => {
        mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        try {
            const { factory, streams } = fakeFactory();
            const stt = new NvidiaNimStreamingSTT('nvapi-test', undefined, factory);
            const errors = [];
            stt.on('error', (e) => errors.push(e));
            stt.start();
            // Ten quick ends (no data) exhaust the ladder.
            for (let i = 0; i < 10; i++) {
                streams[streams.length - 1].emit('end');
                mock.timers.tick(30_000);
            }
            streams[streams.length - 1].emit('end');
            assert.equal(errors.length, 1);
            assert.match(errors[0].message, /max reconnect attempts exceeded/);
            assert.equal(errors[0].terminal, true);
            assert.equal(seen(errors[0]).kind, 'auth');
            stt.stop();

            // Same ends, but each stream lived past the healthy threshold: never gives up.
            const second = fakeFactory();
            const healthy = new NvidiaNimStreamingSTT('nvapi-test', undefined, second.factory);
            const healthyErrors = [];
            healthy.on('error', (e) => healthyErrors.push(e));
            healthy.start();
            for (let i = 0; i < 15; i++) {
                mock.timers.tick(6_000);
                second.streams[second.streams.length - 1].emit('end');
                mock.timers.tick(1_000);
            }
            assert.equal(healthyErrors.length, 0, 'idle ends of working streams exhausted the ladder');
            assert.equal(second.streams.length, 16);
            healthy.stop();
        } finally {
            mock.timers.reset();
        }
    });
});

describe('Qwen (DashScope)', () => {
    test('account codes are kept and terminal; throttling is not', () => {
        const arrears = qwenEventError({ code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' });
        assert.equal(arrears.terminal, true);
        assert.equal(arrears.code, 'Arrearage');
        assert.deepEqual([seen(arrears).kind, seen(arrears).title], ['quota', 'Out of Credits']);
        const key = qwenEventError({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' });
        assert.deepEqual([key.terminal, seen(key).kind], [true, 'auth']);
        assert.equal(qwenEventError({ code: 'AccessDenied.Unpurchased', message: 'x' }).terminal, true);
        const throttled = qwenEventError({ code: 'Throttling', message: 'Requests rate limit exceeded' });
        assert.deepEqual([throttled.terminal, seen(throttled).kind], [false, 'retry']);
        assert.equal(qwenEventError(undefined).message, 'Qwen ASR rejected the request');
    });

    test('wiring: a terminal event latches terminalFailure before main hears it; 402 is final too', () => {
        const src = read('electron/audio/QwenRealtimeSTT.ts');
        const branch = src.slice(src.indexOf("} else if (event.type === 'error') {"));
        assert.ok(branch.indexOf('this.terminalFailure = true;') < branch.indexOf("this.emit('error', err);"));
        assert.match(src, /const keyRefused = status === 401 \|\| status === 402 \|\| status === 403;/);
        const refused = Object.assign(new Error('Qwen ASR account is out of credit (insufficient_funds)'), { response: { status: 402, statusText: 'Payment Required' } });
        assert.deepEqual([seen(refused).kind, seen(refused).title], ['quota', 'Out of Credits']);
    });
});

describe('OpenAI realtime', () => {
    test('a refused handshake: bad key and region are final, no credits is quota, a rate limit retries', () => {
        const key = openAiHandshakeVerdict(401, JSON.stringify({ error: { message: 'Incorrect API key provided: sk-***.', code: 'invalid_api_key' } }));
        assert.deepEqual([key.terminal, key.httpStatus], [true, 401]);
        assert.deepEqual([seen(key).kind, seen(key).title], ['auth', 'Authentication Failed']);
        const region = openAiHandshakeVerdict(403, JSON.stringify({ error: { message: 'Country, region, or territory not supported', code: 'unsupported_country_region_territory' } }));
        assert.deepEqual([seen(region).kind, seen(region).title], ['auth', 'Access Denied']);
        const credits = openAiHandshakeVerdict(429, JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } }));
        assert.equal(credits.code, 'insufficient_quota');
        assert.deepEqual([seen(credits).kind, seen(credits).title], ['quota', 'Out of Credits']);
        assert.equal(openAiHandshakeVerdict(429, JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } })), null);
        assert.equal(openAiHandshakeVerdict(500, 'oops'), null);
        assert.equal(openAiHandshakeVerdict(401, 'not json').message, 'OpenAI rejected the API key (invalid API key): not json');
    });

    test('wiring: the verdict stops every model and the REST fallback; REST refusals stop buffering', () => {
        const src = read('electron/audio/OpenAIStreamingSTT.ts');
        assert.match(src, /ws\.on\('unexpected-response'/);
        const handler = src.slice(src.indexOf('private _handleRefusedHandshake'));
        assert.ok(handler.indexOf('this.shouldReconnect = false;') < handler.indexOf("this.emit('error', verdict);"));
        assert.match(handler.slice(0, 1500), /ws\.terminate\(\)/);
        assert.match(src, /if \(restAccountVerdict\(err\)\) \{\s*\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s*this\.outOfCredits = true;/);
        assert.match(src, /\/\/ REST mode — accumulate for batch upload\. Not once the key or\s*\/\/ account was refused: every upload would fail the same way\.\s*if \(this\.outOfCredits\) return;/);
    });
});

describe('RestSTT (Groq / OpenAI-compatible) against a stand-in server', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const speech = (ms) => {
        const b = Buffer.alloc(ms * 32);
        for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.07) * 3000), i * 2);
        return b;
    };
    async function startServer(respond) {
        const requests = [];
        const server = http.createServer((req, res) => {
            req.on('data', () => {});
            req.on('end', () => { requests.push(Date.now()); respond(res); });
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        serverPort = server.address().port;
        return { requests, close: () => new Promise((r) => server.close(r)) };
    }
    const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

    for (const [label, status, body, kind, title] of [
        ['429 insufficient_quota (no credits)', 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }, 'quota', 'Out of Credits'],
        ['401 invalid key', 401, { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 'auth', 'Authentication Failed'],
    ]) {
        test(`${label}: reported terminal once, and nothing more is uploaded this meeting`, async () => {
            const server = await startServer((res) => json(res, status, body));
            const stt = new RestSTT('groq', 'gsk-test');
            stt.setSampleRate(16000);
            const errors = [];
            stt.on('error', (e) => errors.push(e));
            stt.start();
            stt.write(speech(1000));
            stt.notifySpeechEnded();
            await sleep(400);
            stt.write(speech(1000));
            stt.notifySpeechEnded();
            await sleep(1500); // past any rate-limit hold a 429 used to get
            stt.stop();
            await server.close();

            assert.equal(server.requests.length, 1, 'kept uploading after the account was refused');
            assert.equal(errors.length, 1);
            assert.equal(errors[0].terminal, true);
            assert.deepEqual([seen(errors[0]).kind, seen(errors[0]).title], [kind, title]);
        });
    }

    test('restAccountVerdict: only account verdicts stop uploads', () => {
        assert.equal(restAccountVerdict(axiosError(402, {})), 'credits');
        assert.equal(restAccountVerdict(axiosError(429, { error: { message: 'x', code: 'insufficient_quota' } })), 'credits');
        assert.equal(restAccountVerdict(axiosError(401, {})), 'refused');
        assert.equal(restAccountVerdict(axiosError(403, {})), 'refused');
        assert.equal(restAccountVerdict(axiosError(429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } })), null);
        assert.equal(restAccountVerdict(axiosError(500, {})), null);
        assert.equal(restAccountVerdict(new Error('socket hang up')), null);
    });
});
