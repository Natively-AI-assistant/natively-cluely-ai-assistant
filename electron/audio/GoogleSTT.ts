import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';

/**
 * GoogleSTT
 * 
 * Manages a bi-directional streaming connection to Google Speech-to-Text.
 * Mirrors the logic previously in Swift:
 * - Handles infinite stream limits by restarting periodically (though less critical for short calls).
 * - Manages authentication via GOOGLE_APPLICATION_CREDENTIALS.
 * - Parses intermediate and final results.
 */
export class GoogleSTT extends EventEmitter {
    private client: SpeechClient;
    private stream: any = null; // Stream type is complex in google-cloud libs
    private isStreaming = false;
    private isActive = false;
    private isFatalError = false;
    // Sticky across start(), unlike isFatalError: a credential/auth-resolution
    // failure cannot self-heal when the next meeting re-start()s with the SAME
    // (missing/invalid) credentials — it would just fail again and re-emit a
    // rejection every meeting, drifting toward main.ts's 5-in-60s crash-loop
    // guard. So once auth is known-broken we skip opening the stream entirely
    // until setCredentials() supplies a new key (which clears this).
    private isAuthFatal = false;
    // Credential preflight. @google-cloud/speech opens every stream with
    //     this.initialize().catch(err => { throw err; });
    // which re-throws into a promise nobody holds, so EACH streamingRecognize()
    // on a client whose credentials cannot be resolved leaves one unhandled
    // rejection that nothing outside the library can catch. A meeting start
    // makes four such calls (two channels, each restarted once by the language
    // debounce) and main.ts exits the app at five inside a minute. So we
    // resolve the client ourselves, with the failure handled, and only ever
    // open a stream on a client that has resolved. The verdict belongs to one
    // client object: setCredentials() installs a new one and gets a new check.
    private credentialsCheckedFor: unknown = null;
    private credentialCheckPendingFor: unknown = null;
    private credentialsReportScheduled = false;
    // write() says once per start() that it is dropping audio, not once per chunk.
    private droppedWriteLogged = false;

    /**
     * `code` on the error emitted when the credentials cannot be resolved.
     * main.ts uses it to mark the channel failed (message shown) instead of
     * leaving it on "reconnecting" — same contract as LOCAL_STT_UNAVAILABLE_CODE.
     */
    public static readonly CREDENTIALS_UNAVAILABLE_CODE = 'google_stt_credentials_unavailable';

    /** The error main.ts shows in the overlay: worded for the user, raw cause attached. */
    private static credentialsUnavailableError(cause: unknown): Error {
        const e = new Error(
            'Google speech-to-text has no working Service Account JSON. ' +
            'Add one in Audio Settings, or choose another speech provider.'
        );
        (e as any).code = GoogleSTT.CREDENTIALS_UNAVAILABLE_CODE;
        (e as any).cause = cause;
        return e;
    }
    // Set once a code-3 rejection has been answered by dropping to the `default`
    // model. Bounds the downgrade to a SINGLE retry: a second INVALID_ARGUMENT,
    // or one that arrives while we are already on `default`, is genuinely
    // permanent and falls through to the fatal path.
    private modelDowngraded = false;
    private label = 'default';
    private writeCount = 0;

    // Diagnostic raw-PCM dump. Opt-in via NATIVELY_STT_DUMP=1. Captures the
    // EXACT bytes forwarded to Google's gRPC stream (post keepalive-drop), so
    // we can play the file back and hear what Google actually receives —
    // settling "is the audio garbled or is Google misconfigured?" empirically
    // rather than by inference. One raw file per channel; convert with:
    //   ffmpeg -f s16le -ar <rate> -ac 1 -i google_stt_<label>.raw out.wav
    private dumpStream: fs.WriteStream | null = null;
    private dumpBytes = 0;

    // gRPC permanent failure codes — retrying these is pointless.
    //   3  = INVALID_ARGUMENT (config the server will never accept)
    //   7  = PERMISSION_DENIED (API not enabled / wrong project / no IAM)
    //   16 = UNAUTHENTICATED (bad/expired credentials)
    private static readonly PERMANENT_GRPC_CODES = new Set([3, 7, 16]);

    // Credential/auth-resolution failures that google-auth-library throws
    // BEFORE any RPC, so they carry no gRPC status code and PERMANENT_GRPC_CODES
    // never matches them. Every one means the client cannot authenticate at all
    // (no key file, unreadable/invalid key, unresolvable project) — retrying the
    // stream with the same unchanged credentials can only fail identically, so
    // these are permanent for the session. Scoped to codeless errors: a real
    // gRPC status is always classified by its numeric code, never by message.
    private static readonly AUTH_RESOLUTION_FAILURE_RE =
        /could not load the default credentials|GOOGLE_APPLICATION_CREDENTIALS|could not refresh access token|invalid_grant|unable to (?:detect|determine) a project|error:0|DECODER routines|no key or keyFile/i;

    /** True for a credential/auth-resolution failure (no gRPC code). Pure; unit-tested. */
    private static isAuthResolutionFailure(err: unknown, grpcCode: unknown): boolean {
        if (typeof grpcCode === 'number') return false; // real gRPC status → classified by code
        const msg = (err as { message?: unknown } | null)?.message;
        return typeof msg === 'string' && GoogleSTT.AUTH_RESOLUTION_FAILURE_RE.test(msg);
    }

    // Google STT v1 does not accept the common `zh-*` BCP-47 tags — its
    // supported-languages table lists Mandarin only as `cmn-Hans-CN` (and
    // Traditional as `cmn-Hant-TW`). The shared RECOGNITION_LANGUAGES map
    // keeps `zh-CN` because other providers (Deepgram, Soniox) expect it,
    // so the translation must stay Google-local.
    private static readonly V1_LANGUAGE_CODE_OVERRIDES: Record<string, string> = {
        'zh-CN': 'cmn-Hans-CN',
        'zh-TW': 'cmn-Hant-TW',
    };

    // Languages the `latest_long` model does not cover in STT v1 (Mandarin
    // supports only `default`/`command_and_search`). Requesting latest_long
    // for these returns INVALID_ARGUMENT (gRPC code 3), which
    // PERMANENT_GRPC_CODES above then escalates to a session-wide STT
    // shutdown — the "Chinese never transcribes" bug.
    private static readonly LANGUAGES_WITHOUT_LATEST_LONG = new Set([
        'cmn-Hans-CN',
        'cmn-Hant-TW',
    ]);

    // Config
    private encoding = 'LINEAR16' as const;
    private sampleRateHertz = 16000;
    private audioChannelCount = 1; // Default to Mono
    private languageCode = 'en-US';
    private alternativeLanguageCodes: string[] = ['en-IN', 'en-GB']; // Default fallbacks

    constructor(label?: string) {
        super();
        if (label) this.label = label;
        // ... (credentials setup) ...

        // Note: In production, credentials are set by main.ts via process.env.GOOGLE_APPLICATION_CREDENTIALS
        // or passed explicitly to setCredentials(). We do not load .env files here to avoid ASAR path issues.
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!credentialsPath) {
            console.error(`[GoogleSTT/${this.label}] Missing GOOGLE_APPLICATION_CREDENTIALS in environment. Checked CWD:`, process.cwd());
        } else {
            console.log(`[GoogleSTT/${this.label}] Using credentials from: ${credentialsPath}`);
        }

        this.client = new SpeechClient({
            keyFilename: credentialsPath
        });
    }

    public setCredentials(keyFilePath: string): void {
        console.log(`[GoogleSTT/${this.label}] Updating credentials to: ${keyFilePath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
        this.client = new SpeechClient({
            keyFilename: keyFilePath
        });
        // New credentials — the prior auth-fatal verdict no longer holds; let the
        // next start() attempt a stream again.
        if (this.isAuthFatal) {
            // ...and a meeting that is still running: the fatal flag was only
            // about the old key, so let write()'s lazy connect try the new one
            // instead of staying dead until the meeting is restarted.
            this.isAuthFatal = false;
            this.isFatalError = false;
        }
        // A check still in flight is for the client just replaced; its answer is
        // ignored when it lands, so release the connecting state it was holding.
        if (this.credentialCheckPendingFor) {
            this.credentialCheckPendingFor = null;
            this.isConnecting = false;
        }
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRateHertz === rate) return;
        console.log(`[GoogleSTT/${this.label}] Updating Sample Rate to: ${rate}Hz`);
        this.sampleRateHertz = rate;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    /**
     * No-op for GoogleSTT — Google handles VAD server-side.
     * This method exists for interface consistency with RestSTT so that
     * main.ts can call notifySpeechEnded() without type-casting to `any`.
     */
    public notifySpeechEnded(): void {
        // Intentionally empty. Google STT detects speech boundaries server-side.
    }

    public setAudioChannelCount(count: number): void {
        if (this.audioChannelCount === count) return;
        console.log(`[GoogleSTT/${this.label}] Updating Channel Count to: ${count}`);
        this.audioChannelCount = count;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    private pendingLanguageChange?: NodeJS.Timeout;

    public setRecognitionLanguage(key: string): void {
        // Debounce to prevent rapid restarts (e.g. scrolling through list)
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
        }

        this.pendingLanguageChange = setTimeout(() => {
            if (key === 'auto') {
                // Google STT v1 supports up to 3 alternativeLanguageCodes.
                // Use en-US as primary with the most common languages as alternates.
                this.languageCode = 'en-US';
                this.alternativeLanguageCodes = ['fr-FR', 'es-ES', 'de-DE'];
                console.log(`[GoogleSTT/${this.label}] Language set to auto-detect (en-US + fr/es/de alternates)`);
            } else {
                const config = RECOGNITION_LANGUAGES[key];
                if (!config) {
                    console.warn(`[GoogleSTT/${this.label}] Unknown language key: ${key}`);
                    return;
                }

                this.languageCode = GoogleSTT.V1_LANGUAGE_CODE_OVERRIDES[config.bcp47] ?? config.bcp47;
                console.log(`[GoogleSTT/${this.label}] Updating recognition language to: ${key} (${this.languageCode})`);

                if ('alternates' in config) {
                    this.alternativeLanguageCodes = (config as EnglishVariant).alternates;
                } else {
                    this.alternativeLanguageCodes = [];
                }

                console.log(`[GoogleSTT/${this.label}] Primary:`, this.languageCode);
                if (this.alternativeLanguageCodes.length > 0) {
                    console.log(`[GoogleSTT/${this.label}] Alternates:`, this.alternativeLanguageCodes.join(', '));
                }
            }

            // A downgrade is a fact about the OLD language+model pair, so the new
            // language gets its own latest_long attempt. (start() resets this too,
            // but only the active path reaches start().)
            this.modelDowngraded = false;

            // Restart if active
            if (this.isStreaming || this.isActive) {
                console.log(`[GoogleSTT/${this.label}] Language changed while active. Restarting stream...`);
                this.stop();
                this.start();
            }

            this.pendingLanguageChange = undefined;
        }, 250);
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        // isAuthFatal is sticky: a known-broken credential stays broken across a
        // re-start() (only setCredentials() clears it), so don't reopen a stream
        // that can only fail auth again and emit another unhandled rejection.
        this.isFatalError = this.isAuthFatal;
        this.modelDowngraded = false;
        this.writeCount = 0;
        this.droppedWriteLogged = false;

        if (this.isAuthFatal) {
            console.warn(
                `[GoogleSTT/${this.label}] Credentials previously failed to resolve — STT stays ` +
                `disabled until setCredentials() provides a new key. Not opening a stream.`
            );
            this.reportCredentialsStillUnavailable();
            return;
        }

        this.openDumpStream();

        console.log(`[GoogleSTT/${this.label}] Starting recognition stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount})...`);
        this.startStream();
    }

    /**
     * main.ts can keep one instance across meetings, and the overlay resets
     * every channel to "Listening for audio…" when a meeting starts. A start()
     * that opens nothing must therefore say why again, or the second meeting
     * looks healthy and simply never transcribes. Deferred so it lands after
     * the caller's own start-of-meeting status, and coalesced so the
     * stop()+start() restarts of one tick report once.
     */
    private reportCredentialsStillUnavailable(): void {
        if (this.credentialsReportScheduled) return;
        this.credentialsReportScheduled = true;
        setImmediate(() => {
            this.credentialsReportScheduled = false;
            if (!this.isActive || !this.isAuthFatal || this.listenerCount('error') === 0) return;
            this.emit('error', GoogleSTT.credentialsUnavailableError(null));
        });
    }

    /** Opt-in diagnostic: open a raw-PCM dump of the exact bytes sent to Google. */
    private openDumpStream(): void {
        if (process.env.NATIVELY_STT_DUMP !== '1' || this.dumpStream) return;
        try {
            const file = path.join(os.homedir(), `google_stt_${this.label}_${this.sampleRateHertz}hz.raw`);
            this.dumpStream = fs.createWriteStream(file);
            this.dumpBytes = 0;
            console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump OPEN → ${file} (play: ffmpeg -f s16le -ar ${this.sampleRateHertz} -ac ${this.audioChannelCount} -i "${file}" out.wav)`);
        } catch (e) {
            console.error(`[GoogleSTT/${this.label}] Failed to open PCM dump:`, e);
        }
    }

    private closeDumpStream(): void {
        if (!this.dumpStream) return;
        try { this.dumpStream.end(); } catch { /* ignore */ }
        console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump CLOSED (${this.dumpBytes} bytes ≈ ${(this.dumpBytes / 2 / Math.max(1, this.sampleRateHertz)).toFixed(1)}s @ ${this.sampleRateHertz}Hz)`);
        this.dumpStream = null;
    }

    public stop(): void {
        if (!this.isActive) return;

        console.log(`[GoogleSTT/${this.label}] Stopping stream (wrote ${this.writeCount} chunks total)...`);
        this.isActive = false;
        this.isStreaming = false;

        if (this.proactiveRestartTimer) {
            clearTimeout(this.proactiveRestartTimer);
            this.proactiveRestartTimer = null;
        }

        // Clear any in-flight 250ms language-change debounce. Without this,
        // a user who changes language right before clicking Stop would have
        // the debounce body fire ~250ms after endMeeting() — the body would
        // see isStreaming=false and isActive=false (so it skips the
        // stop()+start() restart), BUT the timer's libuv slot survives, and
        // more importantly the closed-over `key` lock could leak the
        // language alternates into a NEXT session if start() runs before the
        // timer fires. Cancelling here keeps the next meeting's language
        // state clean.
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
            this.pendingLanguageChange = undefined;
        }

        if (this.stream) {
            this.stream.end();
            this.stream.destroy();
            this.stream = null;
        }

        this.closeDumpStream();
    }

    public finalize(): void {
        if (!this.isActive || !this.stream) return;
        console.log(`[GoogleSTT/${this.label}] Finalize — ending gRPC stream to flush final transcript`);
        try {
            this.stream.end();
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Finalize end() failed:`, err);
        }
        this.isStreaming = false;
        this.stream = null;
    }

    private buffer: Buffer[] = [];
    private isConnecting = false;
    private lastConnectAttempt = 0;

    // Google's streamingRecognize hard-kills any stream after 305 seconds.
    // We proactively restart at 4:30 (270s) to prevent the forced close from
    // causing a 1-second gap in transcription during long interviews.
    private proactiveRestartTimer: NodeJS.Timeout | null = null;
    private static readonly PROACTIVE_RESTART_MS = 270_000; // 4 min 30 sec

    /**
     * True only if every byte of the chunk is zero (a Rust-DSP keepalive frame).
     * Scans the whole buffer — never strided — so a chunk containing even one
     * non-zero sample of real audio is never misclassified as silence and dropped.
     * Chunks are ≤5760 bytes and arrive every 20–60ms, so a full scan is cheap.
     */
    private isAllZeroChunk(buf: Buffer): boolean {
        if (buf.length === 0) return true;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] !== 0) return false;
        }
        return true;
    }

    public write(audioData: Buffer): void {
        if (!this.isActive || this.isFatalError) {
            // Once per start(): a channel disabled before its first accepted
            // chunk (writeCount still 0) used to print this for every chunk of
            // the meeting.
            if (!this.droppedWriteLogged) {
                this.droppedWriteLogged = true;
                console.warn(
                    `[GoogleSTT/${this.label}] write() dropping audio ` +
                    `(${this.isActive ? 'STT disabled after a permanent error' : 'not started'})`
                );
            }
            return;
        }

        // Drop pure zero-fill keepalive frames injected by the Rust DSP
        // (FrameAction::SendSilence → vec![0u8; chunk_size*2]). For system audio
        // the suppressor runs with VAD disabled and a permissive RMS floor, so it
        // oscillates between real low-amplitude Send frames and these silent
        // keepalives. Google's streamingRecognize (unlike Deepgram/Natively, which
        // endpoint cleanly on silence) hallucinates tiny interim fragments —
        // "he", "heh", "hehehe" — when real audio is interleaved with zero frames.
        // Google holds the gRPC stream open on its own (10s idle timeout) and
        // write() lazily reconnects on the next real chunk, so the keepalive serves
        // no purpose here and only corrupts recognition. Real audio is never
        // bit-exactly zero (noise floor/dither), so an all-zero chunk is
        // unambiguously a keepalive.
        if (this.isAllZeroChunk(audioData)) return;

        // Diagnostic: capture the exact non-keepalive bytes handed to Google.
        if (this.dumpStream) {
            try { this.dumpStream.write(audioData); this.dumpBytes += audioData.length; } catch { /* ignore */ }
        }

        this.writeCount++;

        if (!this.isStreaming || !this.stream) {
            // Buffer if we are in connecting state, just started, or closed
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream not ready (write #${this.writeCount}). Lazy connecting on new audio...`);
                    this.startStream();
                }
            }
            return;
        }

        // Safety check to prevent "write after destroyed" error
        if (this.stream.destroyed) {
            this.isStreaming = false;
            this.stream = null;
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream destroyed (write #${this.writeCount}). Lazy reconnecting...`);
                    this.startStream();
                }
            }
            return;
        }

        try {
            // Log first 5 writes always, then every ~50th
            if (this.writeCount <= 5 || Math.random() < 0.02) {
                console.log(`[GoogleSTT/${this.label}] Writing ${audioData.length} bytes to stream (write #${this.writeCount}, isStreaming=${this.isStreaming})`);
            }

            if (this.stream.writable) {
                this.stream.write(audioData);
            } else {
                console.warn(`[GoogleSTT/${this.label}] Stream not writable! (write #${this.writeCount})`);
            }
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Safe write failed:`, err);
            this.isStreaming = false;
        }
    }

    private flushBuffer(): void {
        if (!this.stream) return;

        while (this.buffer.length > 0) {
            if (!this.stream.writable) {
                console.warn(`[GoogleSTT/${this.label}] flushBuffer: stream not writable — ${this.buffer.length} chunks re-queued`);
                break; // Leave remaining chunks in buffer for next stream
            }
            const data = this.buffer.shift();
            if (data) {
                try {
                    this.stream.write(data);
                } catch (e) {
                    console.error(`[GoogleSTT/${this.label}] Failed to flush buffer chunk:`, e);
                    break;
                }
            }
        }
    }

    /**
     * `latest_long` is the quality default, but STT v1 offers it for only a
     * subset of locales — Mandarin, for one, supports `default` and
     * `command_and_search` only. An unsupported model+language pair is rejected
     * with INVALID_ARGUMENT, a PERMANENT_GRPC_CODES entry, which used to kill
     * STT for the entire session ("Chinese never transcribes", PR #494).
     *
     * LANGUAGES_WITHOUT_LATEST_LONG catches the pairs we know about up front;
     * `modelDowngraded` catches the ones we do not, after Google has told us
     * once. Google no longer publishes the v1 language x model table (both doc
     * URLs now redirect to v2, which uses chirp/long/short), so the static list
     * can never be proven complete — the runtime downgrade is what actually
     * closes the class.
     */
    private resolveModel(): 'default' | 'latest_long' {
        if (this.modelDowngraded) return 'default';
        return GoogleSTT.LANGUAGES_WITHOUT_LATEST_LONG.has(this.languageCode)
            ? 'default'
            : 'latest_long';
    }

    /**
     * True when a stream may be opened on the current client right now.
     * Otherwise a check is (now) in flight; it opens the stream itself when it
     * resolves, or disables the channel when it does not. See
     * `credentialsCheckedFor` for why no stream is opened before that.
     */
    private credentialsResolved(): boolean {
        const client: any = this.client;
        if (this.credentialsCheckedFor === client) return true;
        // Nothing to check against (a client without the library's initialize(),
        // i.e. a test double): open directly, as before.
        if (typeof client?.initialize !== 'function') return true;

        // Hold the connecting state so write() buffers audio instead of
        // lazy-connecting while the check runs.
        this.lastConnectAttempt = Date.now();
        this.isStreaming = false;
        this.isConnecting = true;
        if (this.credentialCheckPendingFor === client) return false;

        this.credentialCheckPendingFor = client;
        console.log(`[GoogleSTT/${this.label}] Resolving credentials before opening a stream...`);
        let check: Promise<unknown>;
        try {
            check = Promise.resolve(client.initialize());
        } catch (err) {
            check = Promise.reject(err);
        }
        check.then(
            () => this.onCredentialCheckSettled(client, null),
            (err: unknown) => this.onCredentialCheckSettled(client, { cause: err }),
        ).catch((err: unknown) => {
            // Nothing holds this chain, so a throw from opening the stream or
            // from an 'error' listener would itself be an unhandled rejection.
            console.error(`[GoogleSTT/${this.label}] Opening the stream after the credential check failed:`, err);
        });
        return false;
    }

    private onCredentialCheckSettled(client: unknown, failure: { cause: unknown } | null): void {
        // setCredentials() replaced the client while this was in flight: the
        // answer is about a key no longer in use.
        if (client !== this.client) return;
        this.credentialCheckPendingFor = null;
        this.isConnecting = false;

        if (failure) {
            const reason = (failure.cause as { message?: unknown } | null)?.message ?? failure.cause;
            console.error(
                `[GoogleSTT/${this.label}] Credentials could not be resolved (${reason}) — ` +
                `STT disabled until new credentials are set. No stream opened.`
            );
            this.isFatalError = true;
            this.isAuthFatal = true;
            this.buffer = [];
            // A meeting ended while the check ran has nobody to tell (main.ts
            // removes the listeners on teardown, and an 'error' with no
            // listener throws — here, into a promise nobody holds). The verdict
            // is kept; the next start() reports it.
            if (this.isActive && this.listenerCount('error') > 0) {
                this.emit('error', GoogleSTT.credentialsUnavailableError(failure.cause));
            }
            return;
        }

        this.credentialsCheckedFor = client;
        // Only for a session that is still running: a stop() while the check
        // was in flight leaves the verdict for the next start() to use.
        if (this.isActive && !this.isFatalError && !this.stream) this.startStream();
    }

    private startStream(): void {
        if (!this.credentialsResolved()) return;

        this.lastConnectAttempt = Date.now();
        this.isStreaming = true;
        this.isConnecting = true;

        console.log(`[GoogleSTT/${this.label}] Creating gRPC stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount}, lang=${this.languageCode})...`);

        // F-203: bind the instance to a local so every STATE-MUTATING handler
        // can verify it still owns `this.stream` before touching shared state.
        // Without this, the synchronous stop()+start() restarts (setSampleRate
        // — which main.ts triggers on the first audio chunk of every meeting —
        // setAudioChannelCount, setRecognitionLanguage, and the 270s proactive
        // restart) let the DESTROYED stream's async 'close'/'end' run
        // `this.stream = null` against the freshly-created stream, orphaning it
        // (open, never ended) and pushing writes into the lazy-reconnect path
        // so a third stream opens. Mirrors NativelyProSTT's documented
        // `guard(ws === this.ws)` pattern. Live-reproduced in
        // scripts/audit/F-203-repro.mjs.
        const stream: any = this.client
            .streamingRecognize({
                config: {
                    encoding: this.encoding,
                    sampleRateHertz: this.sampleRateHertz,
                    audioChannelCount: this.audioChannelCount,
                    languageCode: this.languageCode,
                    enableAutomaticPunctuation: true,
                    model: this.resolveModel(),
                    useEnhanced: true,
                    alternativeLanguageCodes: this.alternativeLanguageCodes,
                },
                interimResults: true,
            })
            .on('error', (err: Error) => {
                if (stream !== this.stream) return; // F-203 stale-stream guard
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;

                const grpcCode = (err as any)?.code;

                // Google's streamingRecognize closes the stream with code 11
                // ("Audio Timeout Error: Long duration elapsed without audio")
                // after ~10s of silence. The lazy-reconnect path in write()
                // recovers automatically on the next chunk, so this is benign
                // and recurs every silent stretch. Log a single warn line and
                // do NOT re-emit as an error — bubbling it up trips the
                // consecutive-error counter in main.ts and spams the renderer
                // with reconnecting/failed STT status updates during normal
                // silence.
                const isIdleTimeout = grpcCode === 11
                    || /Audio Timeout Error/i.test(err.message || '');
                if (isIdleTimeout) {
                    console.warn(`[GoogleSTT/${this.label}] Stream idle-timed-out (Google's 10s no-audio limit), reconnecting on next chunk.`);
                    return;
                }

                // INVALID_ARGUMENT on a `latest_long` stream is far more likely the
                // model than the credentials: v1 supports latest_long for only some
                // locales and rejects the pair outright. Answer the FIRST one by
                // dropping to `default` and letting write()'s lazy reconnect reopen
                // the stream, rather than disabling STT for the session. Not
                // re-emitted, for the same reason the idle timeout is not: main.ts's
                // consecutive-error counter would tear the session down anyway. A
                // second code 3 — or one that arrives while we are already on
                // `default` — falls through below and is treated as permanent.
                if (grpcCode === 3 && !this.modelDowngraded && this.resolveModel() === 'latest_long') {
                    this.modelDowngraded = true;
                    console.warn(
                        `[GoogleSTT/${this.label}] INVALID_ARGUMENT on model=latest_long ` +
                        `(lang=${this.languageCode}) — retrying once on model=default. ` +
                        `Add '${this.languageCode}' to LANGUAGES_WITHOUT_LATEST_LONG to skip this ` +
                        `round-trip. Google said: ${err.message}`
                    );
                    return;
                }

                console.error(`[GoogleSTT/${this.label}] Stream error:`, err);

                // An auth/credential-resolution failure carries NO gRPC status
                // code (it is thrown by google-auth-library before any RPC is
                // issued — e.g. "Could not load the default credentials" when
                // GOOGLE_APPLICATION_CREDENTIALS is unset and ADC is absent).
                // PERMANENT_GRPC_CODES only matches numeric codes, so these
                // slipped through as "retryable": write() reopened the stream on
                // every audio chunk, each reopen failed auth the same way, and
                // the repeated rejections tripped main.ts's 5-in-60s
                // unhandled-rejection crash-loop guard — taking the whole app
                // down. Retrying with the same missing credentials can never
                // succeed, so treat it as permanent exactly like codes 7/16.
                const isPermanent =
                    (typeof grpcCode === 'number' && GoogleSTT.PERMANENT_GRPC_CODES.has(grpcCode)) ||
                    GoogleSTT.isAuthResolutionFailure(err, grpcCode);

                if (isPermanent) {
                    // Permanent failure — stop the write()-driven reconnect loop. Without this
                    // guard, a misconfigured Google project (e.g. Speech API not enabled →
                    // PERMISSION_DENIED) loops forever at ~1 reconnect/sec for the whole
                    // session. See issue #171.
                    const isAuth = GoogleSTT.isAuthResolutionFailure(err, grpcCode);
                    console.error(
                        `[GoogleSTT/${this.label}] Permanent error (${typeof grpcCode === 'number' ? `gRPC code ${grpcCode}` : 'credentials/auth could not resolve'}) — ` +
                        `disabling STT ${isAuth ? 'until new credentials are set' : 'for this session'}. No further retries.`
                    );
                    this.isFatalError = true;
                    // An auth failure also survives the next start() (see isAuthFatal):
                    // re-running with the same credentials can only fail identically.
                    if (isAuth) this.isAuthFatal = true;
                    if (this.proactiveRestartTimer) {
                        clearTimeout(this.proactiveRestartTimer);
                        this.proactiveRestartTimer = null;
                    }
                }

                // A credential failure reaches main.ts as the worded, coded error
                // (so the channel shows as failed with something the user can act
                // on); everything else is passed through untouched.
                this.emit(
                    'error',
                    GoogleSTT.isAuthResolutionFailure(err, grpcCode)
                        ? GoogleSTT.credentialsUnavailableError(err)
                        : err,
                );
            })
            .on('end', () => {
                if (stream !== this.stream) return; // F-203 stale-stream guard
                console.log(`[GoogleSTT/${this.label}] Stream ended server-side (idle timeout)`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('close', () => {
                if (stream !== this.stream) return; // F-203 stale-stream guard
                console.log(`[GoogleSTT/${this.label}] Stream closed server-side`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('data', (data: any) => {
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const result = data.results[0];
                    const alt = result.alternatives[0];
                    const transcript = alt.transcript;
                    const isFinal = result.isFinal;

                    if (transcript) {
                        console.log(`[GoogleSTT/${this.label}] Transcript received`, { final: isFinal, length: transcript.length });
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt.confidence
                        });
                    }
                }
            });

        // Publish the new stream only after its handlers are attached. The
        // 'data' handler is deliberately NOT identity-guarded: it mutates no
        // connection state, and a late final transcript is still real user
        // speech that should reach the transcript.
        this.stream = stream;

        // gRPC streams are writable immediately — no handshake needed.
        const bufferedCount = this.buffer.length;
        this.isConnecting = false;
        this.flushBuffer();

        console.log(`[GoogleSTT/${this.label}] Stream created. Flushed ${bufferedCount} buffered chunks. Waiting for events...`);

        // Schedule proactive restart before Google's 305-second hard limit.
        // Without this, the server closes the stream at 305s causing up to 1s of
        // lost audio until the lazy reconnect in write() fires.
        if (this.proactiveRestartTimer) clearTimeout(this.proactiveRestartTimer);
        this.proactiveRestartTimer = setTimeout(() => {
            this.proactiveRestartTimer = null;
            if (!this.isActive) return;
            console.log(`[GoogleSTT/${this.label}] Proactive stream restart at 4:30 to preempt Google's 305s limit`);
            if (this.stream) {
                this.stream.end();
                this.stream.destroy();
                this.stream = null;
            }
            this.isStreaming = false;
            this.startStream();
        }, GoogleSTT.PROACTIVE_RESTART_MS);
    }
}
