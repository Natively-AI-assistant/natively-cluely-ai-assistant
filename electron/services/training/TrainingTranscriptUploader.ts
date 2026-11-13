/**
 * Shares the transcripts of meetings where Auto Answer ran, for training the
 * Auto Answer decider (Evin 2026-11-13: Auto Answer is Pro, or free for users
 * who agree to share; see intelligence/autoAnswer/autoAnswerAccess.ts).
 *
 * WHAT IS SENT, AND WHEN
 *   Only a meeting in which Auto Answer actually ran (noteAutoAnswerRan was
 *   called during it) AND whose user has current consent at meeting end
 *   (access.uploads). The whole transcript of that meeting: each line's
 *   speaker side (user / others), its offset from the start, and its text with
 *   e-mail addresses, links, phone numbers and long digit runs replaced on this
 *   device (scrubTranscriptText). Also the meeting mode, its length and the
 *   app version. Not audio, not screenshots, not notes, not answers, not the
 *   meeting title or calendar event.
 *
 * DURABILITY
 *   A JSON file per meeting in <userData>/training-outbox/, written before any
 *   network attempt, so a quit, crash or offline meeting is sent later. Flushed
 *   after each meeting, at start-up and every 30 minutes; exponential backoff;
 *   a file the server rejects as malformed (400/413/422) is dropped, never
 *   retried forever. At most 50 files are kept (oldest dropped).
 *
 * WITHDRAWAL
 *   withdraw() deletes every file not yet sent. requestDeletion() asks the
 *   server to delete everything already received from this install.
 *
 * No platform branches: paths come from the injected directory (main passes
 * app.getPath('userData')), fetch and fs behave the same on macOS and Windows.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scrubTranscriptText, TrainingConsent } from '../../intelligence/autoAnswer/autoAnswerAccess';

export const TRAINING_UPLOAD_PATH = '/v1/training/meeting-transcripts';
export const TRAINING_SCHEMA_VERSION = 1;
const MAX_FILES = 50;
const MAX_TURNS = 20_000;
const MAX_TURN_CHARS = 4_000;

export interface TrainingTurn { s: 'user' | 'others'; t: number; x: string }

export interface TrainingUploadBody {
  schema: number;
  meeting_ref: string;
  install_id: string;
  consent_version: number;
  consent_granted_at: string;
  basis: 'pro' | 'sharing';
  mode: string | null;
  duration_ms: number;
  started_day: string;
  app_version: string;
  platform: string;
  turns: TrainingTurn[];
}

export interface UploaderDeps {
  dir: string;
  apiBase: () => string;
  installId: () => string | undefined;
  /**
   * Who is asking, as the API's shared-notes route checks it: x-natively-key or
   * x-trial-token when the user has one, else the install token this server
   * signed for the funnel (x-install-token). x-install-id is added here.
   */
  callerHeaders: () => Promise<Record<string, string>>;
  appVersion: string;
  platform: string;
  /** Current access at meeting end (autoAnswerAccess). */
  access: () => { allowed: boolean; basis: 'pro' | 'sharing' | 'none'; uploads: boolean };
  consent: () => TrainingConsent | null | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface OfferedMeeting {
  meetingId: string;
  startTime: number;
  durationMs: number;
  mode: string | null;
  transcript: Array<{ speaker: string; text: string; timestamp: number; final?: boolean }>;
}

/** Pure: a saved transcript → the upload body. Exported for tests. */
export function buildTrainingBody(m: OfferedMeeting, ctx: {
  installId: string; consent: TrainingConsent; basis: 'pro' | 'sharing'; appVersion: string; platform: string;
}): TrainingUploadBody {
  const turns: TrainingTurn[] = [];
  for (const seg of m.transcript) {
    if (seg.final === false) continue;
    const text = scrubTranscriptText(String(seg.text ?? '').trim()).slice(0, MAX_TURN_CHARS);
    if (!text) continue;
    // 'user' is the user's own microphone; everything else is the meeting audio.
    const s: TrainingTurn['s'] = seg.speaker === 'user' || seg.speaker === 'me' ? 'user' : 'others';
    turns.push({ s, t: Math.max(0, Math.round(seg.timestamp - m.startTime)), x: text });
    if (turns.length >= MAX_TURNS) break;
  }
  return {
    schema: TRAINING_SCHEMA_VERSION,
    // Not the local meeting id: a one-way reference, stable for re-sends only.
    meeting_ref: crypto.createHash('sha256').update(`${ctx.installId}:${m.meetingId}`).digest('hex').slice(0, 32),
    install_id: ctx.installId,
    consent_version: ctx.consent.version,
    consent_granted_at: ctx.consent.grantedAt,
    basis: ctx.basis,
    mode: m.mode,
    duration_ms: Math.max(0, Math.round(m.durationMs)),
    // The day only, never the time of day.
    started_day: new Date(m.startTime).toISOString().slice(0, 10),
    app_version: ctx.appVersion,
    platform: ctx.platform,
    turns,
  };
}

/**
 * Where MeetingPersistence hands a saved meeting (set by main; unset in tests
 * and tools, where nothing is shared). A function slot, not an import of main.
 */
let meetingSink: ((m: OfferedMeeting) => void) | null = null;
export function setTrainingMeetingSink(fn: ((m: OfferedMeeting) => void) | null): void { meetingSink = fn; }
export function offerTrainingMeeting(m: OfferedMeeting): void {
  try { meetingSink?.(m); } catch { /* sharing must never fail a meeting save */ }
}

export class TrainingTranscriptUploader {
  private ranThisMeeting = false;
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: UploaderDeps) {}

  private log(m: string) { (this.deps.log ?? ((x) => console.log(`[TrainingUpload] ${x}`)))(m); }
  private now() { return (this.deps.now ?? Date.now)(); }

  meetingStarted(): void { this.ranThisMeeting = false; }
  /** Called whenever Auto Answer acts on this meeting's speech (isAutoAnswerActive). */
  noteAutoAnswerRan(): void { this.ranThisMeeting = true; }

  /** At meeting end, after the meeting is saved. Never throws. */
  offerMeeting(m: OfferedMeeting): void {
    try {
      const ran = this.ranThisMeeting;
      this.ranThisMeeting = false;
      if (!ran) return;
      const access = this.deps.access();
      const consent = this.deps.consent();
      const installId = this.deps.installId();
      if (!access.uploads || access.basis === 'none' || !consent || !installId) return;
      const body = buildTrainingBody(m, { installId, consent, basis: access.basis, appVersion: this.deps.appVersion, platform: this.deps.platform });
      if (!body.turns.length) return;
      fs.mkdirSync(this.deps.dir, { recursive: true });
      const file = path.join(this.deps.dir, `${body.meeting_ref}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ body, attempts: 0, nextAt: 0 }));
      fs.renameSync(`${file}.tmp`, file);
      this.trim();
      this.log(`queued ${body.turns.length} lines`);
      void this.flush();
    } catch (e) {
      this.log(`not queued: ${(e as Error)?.message}`);
    }
  }

  start(): void {
    void this.flush();
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), 30 * 60_000);
      (this.timer as any).unref?.();
    }
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private files(): string[] {
    try {
      return fs.readdirSync(this.deps.dir).filter((f) => f.endsWith('.json')).sort((a, b) =>
        fs.statSync(path.join(this.deps.dir, a)).mtimeMs - fs.statSync(path.join(this.deps.dir, b)).mtimeMs);
    } catch { return []; }
  }

  private trim(): void {
    const f = this.files();
    for (const name of f.slice(0, Math.max(0, f.length - MAX_FILES))) {
      try { fs.rmSync(path.join(this.deps.dir, name), { force: true }); } catch { /* next time */ }
    }
  }

  private async headers(json: boolean): Promise<Record<string, string>> {
    let caller: Record<string, string> = {};
    try { caller = await this.deps.callerHeaders(); } catch { /* the server answers 401; retried later */ }
    const h: Record<string, string> = { ...caller };
    if (json) h['content-type'] = 'application/json';
    const id = this.deps.installId();
    if (id) h['x-install-id'] = id;
    return h;
  }

  /** Send what is due. Consent is re-checked first: withdrawn means nothing goes out. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      if (!this.deps.access().uploads) return;
      const fetchImpl = this.deps.fetchImpl ?? fetch;
      for (const name of this.files()) {
        const file = path.join(this.deps.dir, name);
        let entry: { body: TrainingUploadBody; attempts: number; nextAt: number };
        try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fs.rmSync(file, { force: true }); continue; }
        if (entry.nextAt > this.now()) continue;
        let status = 0;
        try {
          const res = await fetchImpl(`${this.deps.apiBase()}${TRAINING_UPLOAD_PATH}`, {
            method: 'POST', headers: await this.headers(true), body: JSON.stringify(entry.body), signal: AbortSignal.timeout(60_000),
          });
          status = res.status;
        } catch { status = 0; }
        if (status >= 200 && status < 300) { fs.rmSync(file, { force: true }); this.log('sent'); continue; }
        if (status === 400 || status === 413 || status === 422) { fs.rmSync(file, { force: true }); this.log(`dropped (server said ${status})`); continue; }
        entry.attempts += 1;
        entry.nextAt = this.now() + Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(entry.attempts, 10));
        try { fs.writeFileSync(file, JSON.stringify(entry)); } catch { /* retried next flush */ }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Consent withdrawn: nothing queued leaves this device. */
  withdraw(): void {
    for (const name of this.files()) {
      try { fs.rmSync(path.join(this.deps.dir, name), { force: true }); } catch { /* best effort */ }
    }
  }

  /** Ask the server to delete everything received from this install. */
  async requestDeletion(): Promise<{ success: boolean; error?: string }> {
    this.withdraw();
    try {
      const res = await (this.deps.fetchImpl ?? fetch)(`${this.deps.apiBase()}${TRAINING_UPLOAD_PATH}`, {
        method: 'DELETE', headers: await this.headers(false), signal: AbortSignal.timeout(30_000),
      });
      return res.ok ? { success: true } : { success: false, error: `server_${res.status}` };
    } catch (e) {
      return { success: false, error: 'network' };
    }
  }
}
