// IPC for folders, tags, People and Companies.
//
//   organise:folders:*      list, create, rename, delete, set rules, apply to past
//   organise:meeting:*      a meeting's folders and tags; move it, tag it
//   organise:meetings:list  the meetings in a folder or with a tag (all of them, not the list's 50)
//   organise:tags:list
//   organise:people:*       list (indexes new meetings first), one person, edit, accept/dismiss a suggestion
//   organise:companies:*    list, one company, edit, draft a description from the meetings
//
// Every handler validates its input and answers with a neutral value on any
// failure. Only "draft a description" calls a model, and only because the
// user pressed its button; it uses the provider the notes use and honours the
// same data scope (no call when meeting notes may not be sent).

import { BrowserWindow } from 'electron';
import type { AppState } from '../../main';
import { organiseStore, indexMeetingPeople, syncPeopleIndex, indexRemainingPeopleInBackground, ruleFactsFor, currentUser, PEOPLE_INDEX_BATCH } from './organiseService';
import { companyDomainForEmail, isFreeMailDomain } from './people';
import { draftCompanyDescription } from './companyDescription';
import { emailDomain } from '../meeting/meetingNotesContext';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** People / Companies listen for this to refresh while older meetings are indexed. */
export const PEOPLE_INDEXED_CHANNEL = 'organise:people-indexed';

function broadcastPeopleIndexed(): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(PEOPLE_INDEXED_CHANNEL);
  } catch { /* a closing window */ }
}

/**
 * One batch now, so the list that is opening is not empty, and the rest in the
 * background, a batch at a time, refreshing the lists as each lands.
 */
function syncPeopleThenContinue(store: NonNullable<ReturnType<typeof organiseStore>>): void {
  if (syncPeopleIndex(store) >= PEOPLE_INDEX_BATCH) void indexRemainingPeopleInBackground(store, broadcastPeopleIndexed);
}

function broadcastMeetingsUpdated(): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('meetings-updated');
  } catch { /* a closing window */ }
}

/** Re-read who a meeting was with, after its calendar link or speaker names changed. */
export function reindexOrganisePeople(meetingId: string): void {
  if (isId(meetingId)) indexMeetingPeople(meetingId);
}

/** The meetings of one folder, for a folder-scoped Ask. */
export function organiseFolderMeetingIds(folderId: string): string[] {
  return isId(folderId) ? organiseStore()?.meetingIdsInFolder(folderId) ?? [] : [];
}

/** search:global-meetings filters → the meetings it may return, or null for no scope. */
export function organiseScopeMeetingIds(filters: unknown): Set<string> | null {
  if (!filters || typeof filters !== 'object') return null;
  const f = filters as { folderId?: unknown; tag?: unknown };
  const store = organiseStore();
  if (!store) return null;
  let ids: string[] | null = null;
  if (isId(f.folderId)) ids = store.meetingIdsInFolder(f.folderId);
  if (typeof f.tag === 'string' && f.tag.trim()) {
    const tagged = store.meetingIdsWithTag(f.tag.trim());
    ids = ids === null ? tagged : ids.filter((id) => tagged.includes(id));
  }
  return ids === null ? null : new Set(ids);
}

/** The user's own company domain, left out of Companies (those are colleagues). */
function userCompanyDomain(): string | null {
  const email = currentUser()?.email;
  const d = emailDomain(typeof email === 'string' ? email.toLowerCase() : '');
  return d && !isFreeMailDomain(d) ? companyDomainForEmail(email) : null;
}

export function registerOrganiseIpc(appState: AppState, safeHandle: SafeHandle): void {
  // ── Folders ──
  safeHandle('organise:folders:list', async () => organiseStore()?.listFolders() ?? []);

  safeHandle('organise:folders:create', async (_e, args: { name?: unknown }) => organiseStore()?.createFolder(args?.name) ?? null);

  safeHandle('organise:folders:rename', async (_e, args: { id?: unknown; name?: unknown }) =>
    isId(args?.id) ? organiseStore()?.renameFolder(args.id, args.name) ?? false : false);

  safeHandle('organise:folders:delete', async (_e, args: { id?: unknown }) => {
    const ok = isId(args?.id) ? organiseStore()?.deleteFolder(args.id) ?? false : false;
    if (ok) broadcastMeetingsUpdated();
    return ok;
  });

  safeHandle('organise:folders:set-rules', async (_e, args: { id?: unknown; rules?: unknown }) =>
    isId(args?.id) && Array.isArray(args.rules) ? organiseStore()?.setFolderRules(args.id, args.rules as any[]) ?? null : null);

  safeHandle('organise:folders:apply-past', async (_e, args: { id?: unknown }) => {
    const store = organiseStore();
    if (!store || !isId(args?.id)) return { added: 0 };
    const added = store.applyFolderRulesToPast(args.id, (meetingId) => ruleFactsFor(meetingId, store));
    if (added > 0) broadcastMeetingsUpdated();
    return { added };
  });

  safeHandle('organise:folders:dismiss-past', async (_e, args: { id?: unknown }) =>
    isId(args?.id) ? organiseStore()?.markPastOffered(args.id) ?? false : false);

  // ── One meeting ──
  safeHandle('organise:meeting:get', async (_e, args: { meetingId?: unknown }) => {
    const store = organiseStore();
    if (!store || !isId(args?.meetingId)) return { folderIds: [], tags: [] };
    return { folderIds: store.foldersOfMeeting(args.meetingId), tags: store.tagsOfMeeting(args.meetingId) };
  });

  safeHandle('organise:meeting:set-folder', async (_e, args: { meetingId?: unknown; folderId?: unknown; inFolder?: unknown }) => {
    const store = organiseStore();
    if (!store || !isId(args?.meetingId) || !isId(args?.folderId)) return false;
    const ok = args.inFolder === false
      ? store.removeMeetingFromFolder(args.meetingId, args.folderId)
      : store.addMeetingToFolder(args.meetingId, args.folderId, 'user');
    if (ok) broadcastMeetingsUpdated();
    return ok;
  });

  safeHandle('organise:meeting:set-tags', async (_e, args: { meetingId?: unknown; tags?: unknown }) => {
    const store = organiseStore();
    if (!store || !isId(args?.meetingId) || !Array.isArray(args.tags)) return null;
    const tags = store.setMeetingTags(args.meetingId, args.tags);
    if (tags) broadcastMeetingsUpdated();
    return tags;
  });

  safeHandle('organise:meetings:list', async (_e, args: { folderId?: unknown; tag?: unknown }) => {
    const store = organiseStore();
    if (!store) return [];
    return store.listMeetings({
      ...(isId(args?.folderId) ? { folderId: args.folderId } : {}),
      ...(typeof args?.tag === 'string' && args.tag.trim() ? { tag: args.tag.trim().slice(0, 40) } : {}),
    });
  });

  safeHandle('organise:tags:list', async () => organiseStore()?.listTags() ?? []);

  // ── People ──
  safeHandle('organise:people:list', async (_e, args: { query?: unknown }) => {
    const store = organiseStore();
    if (!store) return [];
    syncPeopleThenContinue(store);
    return store.listPeople(typeof args?.query === 'string' ? args.query.slice(0, 120) : undefined);
  });

  safeHandle('organise:people:get', async (_e, args: { id?: unknown }) => (isId(args?.id) ? organiseStore()?.getPerson(args.id) ?? null : null));

  safeHandle('organise:people:update', async (_e, args: { id?: unknown; patch?: unknown }) => {
    if (!isId(args?.id) || !args.patch || typeof args.patch !== 'object') return false;
    const p = args.patch as Record<string, unknown>;
    return organiseStore()?.updatePerson(args.id, { name: p.name, title: p.title, company: p.company, notes: p.notes }) ?? false;
  });

  safeHandle('organise:people:resolve-fact', async (_e, args: { factId?: unknown; accept?: unknown }) =>
    typeof args?.factId === 'number' && Number.isInteger(args.factId) ? organiseStore()?.resolveFact(args.factId, args.accept === true) ?? false : false);

  // ── Companies ──
  safeHandle('organise:companies:list', async (_e, args: { query?: unknown }) => {
    const store = organiseStore();
    if (!store) return [];
    syncPeopleThenContinue(store);
    return store.listCompanies({ excludeDomain: userCompanyDomain(), query: typeof args?.query === 'string' ? args.query.slice(0, 120) : undefined });
  });

  safeHandle('organise:companies:get', async (_e, args: { domain?: unknown }) =>
    typeof args?.domain === 'string' ? organiseStore()?.getCompany(args.domain.slice(0, 200)) ?? null : null);

  safeHandle('organise:companies:update', async (_e, args: { domain?: unknown; patch?: unknown }) => {
    if (typeof args?.domain !== 'string' || !args.patch || typeof args.patch !== 'object') return false;
    const p = args.patch as Record<string, unknown>;
    return organiseStore()?.updateCompany(args.domain, {
      name: p.name,
      description: p.description,
      descriptionSource: p.descriptionSource === 'drafted' ? 'drafted' : 'user',
      notes: p.notes,
    }) ?? false;
  });

  safeHandle('organise:companies:draft-description', async (_e, args: { domain?: unknown }) => {
    const store = organiseStore();
    if (!store || typeof args?.domain !== 'string') return { text: null, reason: 'failed' };
    // The same switch that keeps meeting notes off cloud providers keeps this off them too.
    try {
      const { SettingsManager } = require('../SettingsManager');
      const scopes = SettingsManager.getInstance().get('providerDataScopes');
      if (scopes?.post_call_summary === false) return { text: null, reason: 'not-allowed' };
    } catch { /* settings unavailable: the default allows notes */ }
    const company = store.getCompany(args.domain.slice(0, 200));
    if (!company) return { text: null, reason: 'failed' };
    const llm = appState.processingHelper?.getLLMHelper?.();
    if (!llm) return { text: null, reason: 'failed' };
    return draftCompanyDescription(
      { name: company.name, domain: company.domain },
      store.companyMeetingSummaries(company.domain),
      (system, context) => llm.generateMeetingSummary(system, context, system, { timeoutMs: 30_000, purpose: 'extraction' }),
    );
  });
}
