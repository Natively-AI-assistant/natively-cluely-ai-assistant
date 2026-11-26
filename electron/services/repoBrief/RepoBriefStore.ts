// Where the user's repositories and their briefs live on this device (#781).
//
//   <dir>/repos.json             the list (≤ 5 entries), small
//   <dir>/repo-<owner>__<repo>.json  one built brief + symbol index each
//
// <dir> is userData/repo-briefs, passed in. Written through writeFileAtomicSync,
// which retries the brief Windows antivirus/indexer locks and never leaves half
// a file. File names are lower-cased: NTFS and APFS (default) are
// case-insensitive, so "Foo/Bar" and "foo/bar" must be one file. The "repo-"
// prefix keeps an owner named like a Windows device (con, nul, aux) legal.

import * as fs from 'fs';
import * as path from 'path';
import { readTextFileSync, writeFileAtomicSync } from '../outputs/atomicFile';
import type { RepoBriefResult } from './repoBriefClient';

export type StoredRepoStatus = 'queued' | 'building' | 'ready' | 'failed' | 'waiting';

export interface StoredRepo {
  /** owner/repo, lower case: the identity of the entry. */
  key: string;
  owner: string;
  repo: string;
  url: string;
  projectName?: string;
  addedAt: number;
  updatedAt: number;
  status: StoredRepoStatus;
  stage?: string | null;
  /** The server job being followed, while building. */
  jobId?: string | null;
  /** retryAt: when a wait for GitHub's allowance ends (epoch ms). */
  error?: { code: string; message: string; retryAt?: number } | null;
  /** Transient failures in a row; reset when a build is accepted. */
  attempts?: number;
  /** Set once a brief is saved: what the brief was built from. */
  sha?: string;
  tier?: RepoBriefResult['tier'];
  generatedAt?: string;
}

interface ListFile {
  version: 1;
  repos: StoredRepo[];
}

export class RepoBriefStore {
  constructor(private readonly dir: string) {}

  private listFile(): string {
    return path.join(this.dir, 'repos.json');
  }

  resultFile(key: string): string {
    const safe = key.toLowerCase().replace('/', '__').replace(/[^a-z0-9._-]/g, '_');
    return path.join(this.dir, `repo-${safe}.json`);
  }

  loadList(): StoredRepo[] {
    try {
      const r = readTextFileSync(this.listFile());
      if (r.state === 'missing') return [];
      const parsed = JSON.parse(r.text) as ListFile;
      return Array.isArray(parsed?.repos) ? parsed.repos.filter((x) => x && typeof x.key === 'string') : [];
    } catch (e: any) {
      console.warn('[RepoBriefStore] repos.json unreadable, starting empty:', e?.message);
      return [];
    }
  }

  saveList(repos: StoredRepo[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const body: ListFile = { version: 1, repos };
    writeFileAtomicSync(this.listFile(), JSON.stringify(body, null, 1));
  }

  loadResult(key: string): RepoBriefResult | null {
    try {
      const r = readTextFileSync(this.resultFile(key));
      if (r.state === 'missing') return null;
      const parsed = JSON.parse(r.text);
      return parsed && typeof parsed.brief === 'string' ? parsed as RepoBriefResult : null;
    } catch (e: any) {
      console.warn(`[RepoBriefStore] brief for ${key} unreadable:`, e?.message);
      return null;
    }
  }

  saveResult(key: string, result: RepoBriefResult): void {
    fs.mkdirSync(this.dir, { recursive: true });
    writeFileAtomicSync(this.resultFile(key), JSON.stringify(result));
  }

  deleteResult(key: string): void {
    try { fs.rmSync(this.resultFile(key), { force: true }); } catch (e: any) {
      console.warn(`[RepoBriefStore] could not delete brief for ${key}:`, e?.message);
    }
  }
}
