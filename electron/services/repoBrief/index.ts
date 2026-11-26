// The app's one RepoBriefManager and the live-answer hook (#781).
//
// Created at startup by initRepoBriefs() (main process). Answer paths only
// peek: a turn never creates the manager or touches the disk, so a test or a
// build without it composes exactly as before.

import * as path from 'path';
import { RepoBriefManager } from './RepoBriefManager';
import { RepoBriefStore } from './RepoBriefStore';
import { createRepoBriefClient } from './repoBriefClient';
import { buildRepoContext, rawGithubFetcher } from './repoBriefContext';
import { loginFromResume } from './githubRepoLinks';

// On globalThis, not a module variable: the build bundles each file with its
// own copy of this module, and every copy must see the one manager.
const SLOT = '__nativelyRepoBriefManager';
const slot = globalThis as unknown as Record<string, RepoBriefManager | null | undefined>;
const getInstance = (): RepoBriefManager | null => slot[SLOT] ?? null;
const setInstance = (m: RepoBriefManager | null): void => { slot[SLOT] = m; };

function userDataDir(): string {
  if (process.env.NATIVELY_TEST_USERDATA) return process.env.NATIVELY_TEST_USERDATA;
  const { app } = require('electron') as typeof import('electron');
  return app.getPath('userData');
}

/**
 * @param getProfile the résumé as Profile Intelligence holds it (getProfileData),
 *   read when a build starts so a résumé uploaded later still counts.
 */
export function initRepoBriefs(getProfile: () => any = () => null): RepoBriefManager {
  const existing = getInstance();
  if (existing) return existing;
  const { nativelyApiBase } = require('../nativelyApiBase') as typeof import('../nativelyApiBase');
  const client = createRepoBriefClient({
    baseUrl: nativelyApiBase(),
    getKey: () => {
      try {
        const { CredentialsManager } = require('../CredentialsManager') as typeof import('../CredentialsManager');
        return CredentialsManager.getInstance().getNativelyApiKey();
      } catch { return undefined; }
    },
  });
  const instance = new RepoBriefManager({
    store: new RepoBriefStore(path.join(userDataDir(), 'repo-briefs')),
    client,
    getLogin: () => {
      try { return loginFromResume(getProfile()); } catch { return null; }
    },
  });
  setInstance(instance);
  void instance.kick();
  return instance;
}

export function peekRepoBriefManager(): RepoBriefManager | null {
  return getInstance();
}

/** Tests only. */
export function setRepoBriefManagerForTests(m: RepoBriefManager | null): void {
  setInstance(m);
}

/**
 * The repository context for one answer: '' unless the user has a brief ready
 * and the question is about that code. Never throws; the GitHub read for exact
 * lines gives up after `deadlineMs`.
 */
export async function repoContextForQuestion(
  question: string,
  opts: { sessionId?: string; isFollowUp?: boolean; deadlineMs?: number } = {},
): Promise<string> {
  try {
    const m = getInstance();
    if (!m || !question?.trim()) return '';
    const briefs = m.readyBriefs();
    if (!briefs.length) return '';
    return await buildRepoContext(question, briefs, {
      fetchLines: rawGithubFetcher(),
      fetchDeadlineMs: opts.deadlineMs ?? 1500,
      sessionId: opts.sessionId,
      isFollowUp: opts.isFollowUp,
    });
  } catch (e: any) {
    console.warn('[repoBrief] context for the answer failed:', e?.message);
    return '';
  }
}
