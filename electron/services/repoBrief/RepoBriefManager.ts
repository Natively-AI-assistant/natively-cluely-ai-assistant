// The user's GitHub repositories and their interview briefs (#781).
//
// The user adds up to five public repositories (offered from the résumé's
// project links, or pasted). For each, the Natively API reads the repository on
// its side and writes a brief: what each important function does and where it
// lives, file and line. This class asks for those builds one at a time in the
// background, follows each job until it settles, and keeps the result on this
// device so a live answer reads it with no network call.
//
// No platform branches: storage goes through RepoBriefStore (userData, atomic
// writes), the network through the injected client, timers are unref'd so they
// never hold the app open on quit (macOS or Windows).

import { EventEmitter } from 'events';
import type { RepoBriefClient, RepoBriefJob, RepoBriefResult } from './repoBriefClient';
import { RepoBriefApiError, asRepoBriefApiError, isTransient } from './repoBriefClient';
import { MAX_REPOS, canonicalRepoUrl, parseGithubRepoUrl, repoKey } from './githubRepoLinks';
import type { RepoBriefStore, StoredRepo } from './RepoBriefStore';

/** What the renderer is shown: never the brief text or the index. */
export interface RepoBriefView {
  key: string;
  owner: string;
  repo: string;
  url: string;
  projectName?: string;
  status: StoredRepo['status'];
  stage?: string | null;
  error?: { code: string; message: string; retryAt?: number } | null;
  sha?: string;
  tier?: StoredRepo['tier'];
  generatedAt?: string;
  functionCount?: number;
}

export interface RepoBriefManagerDeps {
  store: RepoBriefStore;
  client: RepoBriefClient;
  /** The user's GitHub login, for repositories too large to read whole. */
  getLogin?: () => string | null;
  now?: () => number;
  /** First poll after a job is accepted, then each poll waits a little longer up to pollMaxMs. */
  pollMinMs?: number;
  pollMaxMs?: number;
  /** Wait after a transient failure (busy, rate limit, network). */
  retryMs?: number;
  maxAttempts?: number;
  /** Give up following one job after this long (the server times builds out at 6 min). */
  jobDeadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The codes that mean "nothing will change until the user does something". */
const WAITING_CODES = new Set(['no_key', 'paid_key_required', 'unavailable', 'not_found', 'unauthorized', 'invalid_key', 'daily_limit']);

/**
 * Longest wait for GitHub's allowance. The Natively API reads GitHub without a
 * token (60 calls an hour for all users) and says when the allowance returns,
 * which is within the hour.
 */
const RATE_LIMIT_WAIT_MAX_MS = 65 * 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  (t as any).unref?.();
});

export class RepoBriefManager extends EventEmitter {
  private repos: StoredRepo[];
  private readonly results = new Map<string, RepoBriefResult>();
  /** Bumped by remove/refresh so a build already in flight stops writing to the entry. */
  private readonly generation = new Map<string, number>();
  private pumping: Promise<void> | null = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: RepoBriefManagerDeps) {
    super();
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.repos = deps.store.loadList().slice(0, MAX_REPOS);
    for (const r of this.repos) {
      if (r.status === 'ready') {
        const result = deps.store.loadResult(r.key);
        if (result) this.results.set(r.key, result);
        else Object.assign(r, { status: 'queued', jobId: null, error: null });
      }
      // A build cut off by quitting resumes from its job id (the server keeps
      // jobs an hour, and its brief cache longer).
      if (r.status === 'building') r.status = 'queued';
    }
  }

  list(): RepoBriefView[] {
    return this.repos.map((r) => ({
      key: r.key,
      owner: r.owner,
      repo: r.repo,
      url: r.url,
      ...(r.projectName ? { projectName: r.projectName } : {}),
      status: r.status,
      stage: r.stage ?? null,
      error: r.error ?? null,
      ...(r.sha ? { sha: r.sha } : {}),
      ...(r.tier ? { tier: r.tier } : {}),
      ...(r.generatedAt ? { generatedAt: r.generatedAt } : {}),
      ...(this.results.has(r.key) ? { functionCount: this.results.get(r.key)!.index.symbols.length } : {}),
    }));
  }

  /** Briefs ready to use in answers, in the order the user added them. */
  readyBriefs(): Array<{ entry: RepoBriefView; result: RepoBriefResult }> {
    const views = this.list();
    return views.filter((v) => this.results.has(v.key)).map((entry) => ({ entry, result: this.results.get(entry.key)! }));
  }

  add(input: string, opts: { projectName?: string } = {}): { ok: true; repo: RepoBriefView } | { ok: false; error: string } {
    const ref = parseGithubRepoUrl(input);
    if (!ref) return { ok: false, error: 'Expected a link like github.com/owner/repo' };
    const key = repoKey(ref);
    const existing = this.repos.find((r) => r.key === key);
    if (existing) return { ok: true, repo: this.list().find((v) => v.key === key)! };
    if (this.repos.length >= MAX_REPOS) return { ok: false, error: `At most ${MAX_REPOS} repositories. Remove one first` };
    const t = this.now();
    const entry: StoredRepo = {
      key,
      owner: ref.owner,
      repo: ref.repo,
      url: canonicalRepoUrl(ref),
      ...(opts.projectName ? { projectName: opts.projectName.slice(0, 120) } : {}),
      addedAt: t,
      updatedAt: t,
      status: 'queued',
      attempts: 0,
    };
    this.repos.push(entry);
    this.persist();
    this.kick();
    return { ok: true, repo: this.list().find((v) => v.key === key)! };
  }

  remove(key: string): boolean {
    const i = this.repos.findIndex((r) => r.key === key);
    if (i < 0) return false;
    this.repos.splice(i, 1);
    this.bump(key);
    this.results.delete(key);
    this.deps.store.deleteResult(key);
    this.persist();
    return true;
  }

  /** Build again: after a failure, or to pick up new commits. */
  refresh(key: string): boolean {
    const r = this.repos.find((x) => x.key === key);
    if (!r) return false;
    this.bump(key);
    Object.assign(r, { status: 'queued', jobId: null, error: null, attempts: 0, stage: null, updatedAt: this.now() });
    this.persist();
    this.kick();
    return true;
  }

  /** Re-run anything waiting on the user (a key was added, the plan changed). */
  retryWaiting(): void {
    let changed = false;
    for (const r of this.repos) {
      if (r.status === 'waiting') {
        Object.assign(r, { status: 'queued', error: null, attempts: 0 });
        changed = true;
      }
    }
    if (changed) this.persist();
    this.kick();
  }

  /** Start the background loop if there is work and it is not running. Returns it, for tests. */
  kick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.pumping && this.repos.some((r) => r.status === 'queued')) {
      this.pumping = this.pump().finally(() => { this.pumping = null; });
    }
    return this.pumping ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.removeAllListeners();
  }

  private persist(): void {
    try { this.deps.store.saveList(this.repos); } catch (e: any) {
      console.warn('[RepoBriefManager] could not save the repository list:', e?.message);
    }
    this.emit('changed', this.list());
  }

  private update(r: StoredRepo, patch: Partial<StoredRepo>): void {
    Object.assign(r, patch, { updatedAt: this.now() });
    this.persist();
  }

  private bump(key: string): void {
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
  }

  private alive(r: StoredRepo, gen: number): boolean {
    return !this.disposed && this.repos.includes(r) && (this.generation.get(r.key) ?? 0) === gen;
  }

  private async pump(): Promise<void> {
    for (;;) {
      const next = this.repos.find((r) => r.status === 'queued');
      if (!next || this.disposed) return;
      await this.build(next);
    }
  }

  private async build(r: StoredRepo): Promise<void> {
    const maxAttempts = this.deps.maxAttempts ?? 5;
    const gen = this.generation.get(r.key) ?? 0;
    try {
      let job: RepoBriefJob | null = null;
      if (r.jobId) {
        try { job = await this.deps.client.status(r.jobId); } catch (e) {
          // job_not_found after a restart: the server forgot the job; ask again.
          if (asRepoBriefApiError(e)?.code !== 'job_not_found') throw e;
        }
      }
      if (!job) job = await this.deps.client.request(r.url, this.deps.getLogin?.() ?? null);
      if (!this.alive(r, gen)) return;
      this.update(r, { status: 'building', jobId: job.id, stage: job.stage ?? null, error: null, attempts: 0 });

      const started = this.now();
      let wait = this.deps.pollMinMs ?? 3000;
      while (job.status === 'queued' || job.status === 'running') {
        if (this.now() - started > (this.deps.jobDeadlineMs ?? 10 * 60_000)) {
          throw new RepoBriefApiError('build_timeout', 'The repository took too long to read', 504);
        }
        await this.sleep(wait);
        if (!this.alive(r, gen)) return;
        wait = Math.min(Math.round(wait * 1.5), this.deps.pollMaxMs ?? 10_000);
        job = await this.deps.client.status(job.id);
        if (!this.alive(r, gen)) return;
        if ((job.stage ?? null) !== (r.stage ?? null)) this.update(r, { stage: job.stage ?? null });
      }

      if (job.status === 'failed' || !job.result) {
        const err = job.error ?? { code: 'build_failed', message: 'Could not build the brief' };
        this.update(r, { status: 'failed', jobId: null, stage: null, error: err });
        return;
      }
      this.deps.store.saveResult(r.key, job.result);
      this.results.set(r.key, job.result);
      this.update(r, {
        status: 'ready', jobId: null, stage: null, error: null,
        sha: job.result.repo.sha, tier: job.result.tier, generatedAt: job.result.generatedAt,
      });
    } catch (e: any) {
      if (!this.alive(r, gen)) return;
      const err = asRepoBriefApiError(e) ?? new RepoBriefApiError('unknown', e?.message || 'Could not build the brief');
      const error = { code: err.code, message: err.message };
      if (WAITING_CODES.has(err.code)) {
        this.update(r, { status: 'waiting', jobId: null, stage: null, error });
        return;
      }
      // GitHub's allowance is spent and the server said when it returns: wait
      // that long. Not a failed attempt, since nothing is wrong with the repo.
      if (err.code === 'github_rate_limited' && err.retryAfterMs) {
        const wait = Math.min(Math.max(err.retryAfterMs, this.deps.retryMs ?? 60_000), RATE_LIMIT_WAIT_MAX_MS);
        this.update(r, { status: 'building', stage: 'retrying', jobId: null, error: { code: err.code, message: 'GitHub is limiting requests', retryAt: this.now() + wait } });
        await this.sleep(wait);
        if (this.alive(r, gen) && r.status === 'building') this.update(r, { status: 'queued' });
        return;
      }
      const attempts = (r.attempts ?? 0) + 1;
      if (isTransient(err) && attempts < maxAttempts) {
        this.update(r, { status: 'building', stage: 'retrying', error, attempts });
        await this.sleep(this.deps.retryMs ?? 60_000);
        if (this.alive(r, gen) && r.status === 'building') this.update(r, { status: 'queued' });
        return;
      }
      this.update(r, { status: 'failed', jobId: null, stage: null, error, attempts });
    }
  }
}
