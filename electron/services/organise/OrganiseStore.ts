// OrganiseStore.ts
//
// Reads and writes for folders, tags, people and companies (organiseSchema.ts).
// Works on a better-sqlite3 handle passed in, so the app uses the shared
// connection and the tests use a scratch database; it never imports the
// DatabaseManager singleton.
//
// Every public method is guarded: a missing table or a locked database gives a
// neutral answer and a log line, never a throw into the save path or the UI.

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { foldersForMeeting, normaliseRuleValue, type FolderRule, type FolderRuleKind, type MeetingRuleFacts } from './folderRules';
import { companyDomainForEmail, companyNameFromDomain, nameKey, normaliseEmail, oneLineRecap, openActionItems, ownerIsPerson, type MeetingPersonRef, type OpenActionItem } from './people';

export interface FolderRow {
  id: string;
  name: string;
  position: number;
  meetingCount: number;
  rules: Array<{ kind: FolderRuleKind; value: string }>;
  /** When "Apply to past meetings" was offered for the current rules; null while the offer is open. */
  pastOfferedAt: number | null;
}

export interface TagRow { id: number; name: string; meetingCount: number }

export interface MeetingListRow {
  id: string;
  title: string;
  date: string;
  duration: string;
  summary: string;
  summaryStatus?: string;
}

export interface PersonListRow {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  meetingCount: number;
  lastMetAt: string | null;
}

export interface PersonMeetingRow { id: string; title: string; date: string; startMs: number }

export interface PersonFactRow {
  id: number;
  kind: 'title' | 'company';
  value: string;
  quote: string;
  status: 'suggested' | 'accepted' | 'dismissed';
  meetingId: string;
  meetingTitle: string;
}

export interface ActionItemRow extends OpenActionItem {
  meetingId: string;
  meetingTitle: string;
  date: string;
}

export interface PersonDetail extends PersonListRow {
  notes: string | null;
  titleSource: string | null;
  companySource: string | null;
  meetings: PersonMeetingRow[];
  openActionItems: ActionItemRow[];
  lastMet: { meetingId: string; title: string; date: string; recap: string } | null;
  suggestions: PersonFactRow[];
}

export interface CompanyListRow {
  domain: string;
  name: string;
  peopleCount: number;
  meetingCount: number;
  lastMetAt: string | null;
}

export interface CompanyDetail extends CompanyListRow {
  description: string | null;
  descriptionSource: string | null;
  notes: string | null;
  people: PersonListRow[];
  meetings: PersonMeetingRow[];
  openActionItems: ActionItemRow[];
}

/** What the notes prompt is told about one person: accepted values and the user's own notes only. */
export interface KnownPerson {
  email: string;
  name?: string;
  title?: string;
  company?: string;
  notes?: string;
  companyNotes?: string;
  companyName?: string;
}

const NAME_MAX = 120;
const TITLE_MAX = 120;
const NOTES_MAX = 20_000;
const DESCRIPTION_MAX = 2_000;
const TAG_MAX = 40;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\r\t]+/g, ' ').replace(/[ ]{2,}/g, ' ').trim().slice(0, max) : '';
}

function oneLine(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function durationString(ms: number): string {
  const minutes = Math.floor((ms || 0) / 60000);
  const seconds = Math.floor(((ms || 0) % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseSummary(json: unknown): any {
  if (typeof json !== 'string' || !json) return {};
  try { return JSON.parse(json) || {}; } catch { return {}; }
}

export class OrganiseStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  private guard<T>(label: string, fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch (e: any) {
      console.warn(`[OrganiseStore] ${label} failed:`, e?.message || e);
      return fallback;
    }
  }

  // ── Folders ──────────────────────────────────────────────────────────────

  listFolders(): FolderRow[] {
    return this.guard('listFolders', [], () => {
      const rows = this.db.prepare(`
        SELECT f.id, f.name, f.position, f.past_offered_at,
               (SELECT COUNT(*) FROM meeting_folders mf WHERE mf.folder_id = f.id AND mf.removed = 0) AS n
          FROM folders f ORDER BY f.position ASC, f.created_at ASC
      `).all() as any[];
      const rules = this.db.prepare('SELECT folder_id, kind, value FROM folder_rules ORDER BY id ASC').all() as any[];
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        meetingCount: r.n,
        pastOfferedAt: r.past_offered_at ?? null,
        rules: rules.filter((x) => x.folder_id === r.id).map((x) => ({ kind: x.kind, value: x.value })),
      }));
    });
  }

  createFolder(name: unknown): FolderRow | null {
    const n = oneLine(name, NAME_MAX);
    if (!n) return null;
    return this.guard('createFolder', null, () => {
      const id = randomUUID();
      const ts = this.now();
      const pos = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM folders').get() as any)?.p ?? 0;
      this.db.prepare('INSERT INTO folders (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, n, pos, ts, ts);
      return { id, name: n, position: pos, meetingCount: 0, rules: [], pastOfferedAt: null };
    });
  }

  renameFolder(id: string, name: unknown): boolean {
    const n = oneLine(name, NAME_MAX);
    if (!n || typeof id !== 'string') return false;
    return this.guard('renameFolder', false, () => this.db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(n, this.now(), id).changes > 0);
  }

  /** Removes the folder; its meetings stay where they are. */
  deleteFolder(id: string): boolean {
    if (typeof id !== 'string') return false;
    return this.guard('deleteFolder', false, () => this.db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0);
  }

  /**
   * Replace a folder's rules. A rule the folder did not have before reopens
   * the "Apply to past meetings" offer; removing rules does not.
   */
  setFolderRules(folderId: string, rules: Array<{ kind: unknown; value: unknown }>): { saved: Array<{ kind: FolderRuleKind; value: string }>; offerPast: boolean } | null {
    if (typeof folderId !== 'string' || !Array.isArray(rules)) return null;
    return this.guard('setFolderRules', null, () => {
      const exists = this.db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId);
      if (!exists) return null;
      const cleaned: Array<{ kind: FolderRuleKind; value: string }> = [];
      for (const r of rules.slice(0, 50)) {
        const kind = r?.kind === 'title' || r?.kind === 'attendee' || r?.kind === 'mode' ? r.kind : null;
        const value = kind ? normaliseRuleValue(kind, r.value) : null;
        if (kind && value && !cleaned.some((c) => c.kind === kind && c.value.toLowerCase() === value.toLowerCase())) cleaned.push({ kind, value });
      }
      const before = (this.db.prepare('SELECT kind, value FROM folder_rules WHERE folder_id = ?').all(folderId) as any[]).map((r) => `${r.kind}:${String(r.value).toLowerCase()}`);
      const added = cleaned.some((c) => !before.includes(`${c.kind}:${c.value.toLowerCase()}`));
      const ts = this.now();
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM folder_rules WHERE folder_id = ?').run(folderId);
        const ins = this.db.prepare('INSERT OR IGNORE INTO folder_rules (folder_id, kind, value, created_at) VALUES (?, ?, ?, ?)');
        for (const c of cleaned) ins.run(folderId, c.kind, c.value, ts);
        if (added) this.db.prepare('UPDATE folders SET past_offered_at = NULL, updated_at = ? WHERE id = ?').run(ts, folderId);
      })();
      const offerPast = cleaned.length > 0 && (this.db.prepare('SELECT past_offered_at AS p FROM folders WHERE id = ?').get(folderId) as any)?.p == null;
      return { saved: cleaned, offerPast };
    });
  }

  /** The user answered the "Apply to past meetings" offer (either way): it is not shown again for these rules. */
  markPastOffered(folderId: string): boolean {
    return this.guard('markPastOffered', false, () => this.db.prepare('UPDATE folders SET past_offered_at = ? WHERE id = ?').run(this.now(), folderId).changes > 0);
  }

  allRules(): FolderRule[] {
    return this.guard('allRules', [], () => (this.db.prepare(`
      SELECT r.folder_id, r.kind, r.value FROM folder_rules r JOIN folders f ON f.id = r.folder_id ORDER BY f.position ASC, r.id ASC
    `).all() as any[]).map((r) => ({ folderId: r.folder_id, kind: r.kind, value: r.value })));
  }

  addMeetingToFolder(meetingId: string, folderId: string, by: 'user' | 'rule' = 'user'): boolean {
    if (typeof meetingId !== 'string' || typeof folderId !== 'string') return false;
    return this.guard('addMeetingToFolder', false, () => {
      if (by === 'rule') {
        // A rule never overrides the user: a row that exists (even a removal) is left alone.
        return this.db.prepare(`INSERT OR IGNORE INTO meeting_folders (meeting_id, folder_id, added_by, removed, added_at) VALUES (?, ?, 'rule', 0, ?)`)
          .run(meetingId, folderId, this.now()).changes > 0;
      }
      return this.db.prepare(`
        INSERT INTO meeting_folders (meeting_id, folder_id, added_by, removed, added_at) VALUES (?, ?, 'user', 0, ?)
        ON CONFLICT(meeting_id, folder_id) DO UPDATE SET removed = 0, added_by = 'user'
      `).run(meetingId, folderId, this.now()).changes > 0;
    });
  }

  /** Taken out by the user: kept as a removal so a rule does not put it back. */
  removeMeetingFromFolder(meetingId: string, folderId: string): boolean {
    return this.guard('removeMeetingFromFolder', false, () => this.db.prepare(`
      INSERT INTO meeting_folders (meeting_id, folder_id, added_by, removed, added_at) VALUES (?, ?, 'user', 1, ?)
      ON CONFLICT(meeting_id, folder_id) DO UPDATE SET removed = 1
    `).run(meetingId, folderId, this.now()).changes > 0);
  }

  foldersOfMeeting(meetingId: string): string[] {
    return this.guard('foldersOfMeeting', [], () => (this.db.prepare('SELECT folder_id FROM meeting_folders WHERE meeting_id = ? AND removed = 0').all(meetingId) as any[]).map((r) => r.folder_id));
  }

  meetingIdsInFolder(folderId: string): string[] {
    return this.guard('meetingIdsInFolder', [], () => (this.db.prepare('SELECT meeting_id FROM meeting_folders WHERE folder_id = ? AND removed = 0').all(folderId) as any[]).map((r) => r.meeting_id));
  }

  /** File one meeting by every folder's rules. Returns the folders it was added to. */
  applyRulesToMeeting(meetingId: string, facts: MeetingRuleFacts): string[] {
    const targets = foldersForMeeting(facts, this.allRules());
    return targets.filter((folderId) => this.addMeetingToFolder(meetingId, folderId, 'rule'));
  }

  /** "Apply to past meetings": one folder's rules over every saved meeting. Returns how many were added. */
  applyFolderRulesToPast(folderId: string, factsFor: (meetingId: string) => MeetingRuleFacts | null): number {
    return this.guard('applyFolderRulesToPast', 0, () => {
      const rules = this.allRules().filter((r) => r.folderId === folderId);
      if (rules.length === 0) return 0;
      const ids = (this.db.prepare('SELECT id FROM meetings WHERE COALESCE(is_processed, 1) = 1').all() as any[]).map((r) => r.id as string);
      let added = 0;
      for (const id of ids) {
        const facts = factsFor(id);
        if (facts && foldersForMeeting(facts, rules).length > 0 && this.addMeetingToFolder(id, folderId, 'rule')) added++;
      }
      this.markPastOffered(folderId);
      return added;
    });
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  listTags(): TagRow[] {
    return this.guard('listTags', [], () => (this.db.prepare(`
      SELECT t.id, t.name, COUNT(mt.meeting_id) AS n FROM tags t
        JOIN meeting_tags mt ON mt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name COLLATE NOCASE ASC
    `).all() as any[]).map((r) => ({ id: r.id, name: r.name, meetingCount: r.n })));
  }

  tagsOfMeeting(meetingId: string): string[] {
    return this.guard('tagsOfMeeting', [], () => (this.db.prepare(`
      SELECT t.name FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.meeting_id = ? ORDER BY t.name COLLATE NOCASE
    `).all(meetingId) as any[]).map((r) => r.name));
  }

  /** Replace a meeting's tags. Tags are free text, compared without case; "#" in front is dropped. */
  setMeetingTags(meetingId: string, names: unknown): string[] | null {
    if (typeof meetingId !== 'string' || !Array.isArray(names)) return null;
    const wanted: string[] = [];
    for (const raw of names.slice(0, 30)) {
      const n = oneLine(typeof raw === 'string' ? raw.replace(/^#+/, '') : '', TAG_MAX);
      if (n && !wanted.some((w) => w.toLowerCase() === n.toLowerCase())) wanted.push(n);
    }
    return this.guard('setMeetingTags', null, () => {
      const exists = this.db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId);
      if (!exists) return null;
      const ts = this.now();
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM meeting_tags WHERE meeting_id = ?').run(meetingId);
        const insTag = this.db.prepare('INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)');
        const getTag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
        const link = this.db.prepare('INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id, added_at) VALUES (?, ?, ?)');
        for (const n of wanted) {
          insTag.run(n, ts);
          const id = (getTag.get(n) as any)?.id;
          if (id != null) link.run(meetingId, id, ts);
        }
        // Tags nobody uses any more go with the last meeting.
        this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM meeting_tags)').run();
      })();
      return this.tagsOfMeeting(meetingId);
    });
  }

  meetingIdsWithTag(name: string): string[] {
    return this.guard('meetingIdsWithTag', [], () => (this.db.prepare(`
      SELECT mt.meeting_id FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name = ? COLLATE NOCASE
    `).all(name) as any[]).map((r) => r.meeting_id));
  }

  // ── Meeting list rows (for a folder / tag filter) ────────────────────────

  listMeetings(filter: { folderId?: string; tag?: string }): MeetingListRow[] {
    return this.guard('listMeetings', [], () => {
      let ids: string[] | null = null;
      if (typeof filter.folderId === 'string' && filter.folderId) ids = this.meetingIdsInFolder(filter.folderId);
      if (typeof filter.tag === 'string' && filter.tag) {
        const tagged = this.meetingIdsWithTag(filter.tag);
        ids = ids === null ? tagged : ids.filter((id) => tagged.includes(id));
      }
      if (ids === null) return [];
      return this.meetingRows(ids).map((r) => ({
        id: r.id, title: r.title, date: r.date, duration: durationString(r.durationMs), summary: '', ...(r.summaryStatus ? { summaryStatus: r.summaryStatus } : {}),
      }));
    });
  }

  private meetingRows(ids: string[], withSummary = false): Array<{ id: string; title: string; date: string; startMs: number; durationMs: number; summaryStatus?: string; detailedSummary?: any }> {
    const out: Array<{ id: string; title: string; date: string; startMs: number; durationMs: number; summaryStatus?: string; detailedSummary?: any }> = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 400) {
      const chunk = unique.slice(i, i + 400);
      const ph = chunk.map(() => '?').join(',');
      const rows = this.db.prepare(`SELECT id, title, created_at, start_time, duration_ms, summary_status${withSummary ? ', summary_json' : ''} FROM meetings WHERE id IN (${ph})`).all(...chunk) as any[];
      for (const r of rows) {
        out.push({
          id: r.id,
          title: r.title || '',
          date: r.created_at,
          startMs: Number(r.start_time) || Date.parse(r.created_at) || 0,
          durationMs: Number(r.duration_ms) || 0,
          ...(r.summary_status ? { summaryStatus: r.summary_status } : {}),
          ...(withSummary ? { detailedSummary: parseSummary(r.summary_json).detailedSummary } : {}),
        });
      }
    }
    return out.sort((a, b) => b.startMs - a.startMs);
  }

  /** A meeting's title, linked event and saved notes, without its transcript. */
  meetingSnapshot(meetingId: string): { id: string; title: string; calendarEvent: any; detailedSummary: any } | null {
    return this.guard('meetingSnapshot', null, () => {
      const r = this.db.prepare('SELECT id, title, calendar_event_json, summary_json FROM meetings WHERE id = ?').get(meetingId) as any;
      if (!r) return null;
      let calendarEvent: any = null;
      try { calendarEvent = r.calendar_event_json ? JSON.parse(r.calendar_event_json) : null; } catch { calendarEvent = null; }
      return { id: r.id, title: r.title || '', calendarEvent, detailedSummary: parseSummary(r.summary_json).detailedSummary || {} };
    });
  }

  // ── People ───────────────────────────────────────────────────────────────

  /**
   * The person for one reference, created when new. An address is the
   * identity; a name-only reference joins the one person with that exact name
   * (an address-holder first). A new address takes over a name-only person of
   * the same name, so "Dana Fox" from a call and dana@acme.com become one.
   */
  resolvePerson(ref: { email?: string; name?: string }): string | null {
    const email = normaliseEmail(ref.email);
    const name = oneLine(ref.name, NAME_MAX);
    const key = nameKey(name);
    if (!email && !key) return null;
    const ts = this.now();
    if (email) {
      const existing = this.db.prepare('SELECT id, name FROM people WHERE email = ?').get(email) as any;
      if (existing) {
        if (!existing.name && name) this.db.prepare('UPDATE people SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, key, ts, existing.id);
        if (key) this.absorbNameOnly(existing.id, key);
        return existing.id;
      }
      const id = randomUUID();
      this.db.prepare('INSERT INTO people (id, email, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, email, name, key, ts, ts);
      if (key) this.absorbNameOnly(id, key);
      return id;
    }
    const withEmail = this.db.prepare('SELECT id FROM people WHERE name_key = ? AND email IS NOT NULL').all(key) as any[];
    if (withEmail.length === 1) return withEmail[0].id;
    const nameOnly = this.db.prepare('SELECT id FROM people WHERE name_key = ? AND email IS NULL ORDER BY created_at ASC').get(key) as any;
    if (nameOnly) return nameOnly.id;
    const id = randomUUID();
    this.db.prepare('INSERT INTO people (id, email, name, name_key, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)').run(id, name, key, ts, ts);
    return id;
  }

  /** Fold every name-only person with this exact name into `intoId` (only when that name points at one address-holder). */
  private absorbNameOnly(intoId: string, key: string): void {
    const holders = this.db.prepare('SELECT COUNT(*) AS n FROM people WHERE name_key = ? AND email IS NOT NULL').get(key) as any;
    if ((holders?.n ?? 0) !== 1) return;
    const others = this.db.prepare('SELECT id FROM people WHERE name_key = ? AND email IS NULL AND id != ?').all(key, intoId) as any[];
    for (const o of others) this.mergePeople(o.id, intoId);
  }

  /** Move everything from one person to another and remove the first. The target's own values win; empty ones are filled. */
  mergePeople(fromId: string, intoId: string): boolean {
    if (!fromId || !intoId || fromId === intoId) return false;
    return this.guard('mergePeople', false, () => {
      this.db.transaction(() => {
        const from = this.db.prepare('SELECT * FROM people WHERE id = ?').get(fromId) as any;
        const into = this.db.prepare('SELECT * FROM people WHERE id = ?').get(intoId) as any;
        if (!from || !into) return;
        this.db.prepare('INSERT OR IGNORE INTO person_meetings (person_id, meeting_id, via) SELECT ?, meeting_id, via FROM person_meetings WHERE person_id = ?').run(intoId, fromId);
        this.db.prepare('UPDATE OR IGNORE person_facts SET person_id = ? WHERE person_id = ?').run(intoId, fromId);
        const notes = [into.notes, from.notes].filter((n) => typeof n === 'string' && n.trim()).join('\n\n') || null;
        this.db.prepare(`
          UPDATE people SET
            name = CASE WHEN name = '' THEN ? ELSE name END,
            name_key = CASE WHEN name_key = '' THEN ? ELSE name_key END,
            title = COALESCE(title, ?), title_source = COALESCE(title_source, ?),
            company = COALESCE(company, ?), company_source = COALESCE(company_source, ?),
            notes = ?, updated_at = ?
          WHERE id = ?
        `).run(from.name || '', from.name_key || '', from.title, from.title_source, from.company, from.company_source, notes, this.now(), intoId);
        this.db.prepare('DELETE FROM people WHERE id = ?').run(fromId);
      })();
      return true;
    });
  }

  /**
   * Record who was in a meeting. Replaces that meeting's earlier list, so a
   * relinked calendar event or a renamed speaker is reflected; people left
   * with no meetings and nothing the user wrote are removed.
   */
  indexMeetingPeople(meetingId: string, refs: MeetingPersonRef[]): string[] {
    return this.guard('indexMeetingPeople', [], () => {
      const exists = this.db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId);
      if (!exists) return [];
      const ids: string[] = [];
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM person_meetings WHERE meeting_id = ?').run(meetingId);
        const link = this.db.prepare('INSERT OR IGNORE INTO person_meetings (person_id, meeting_id, via) VALUES (?, ?, ?)');
        for (const ref of refs) {
          const id = this.resolvePerson(ref);
          if (!id) continue;
          link.run(id, meetingId, ref.via);
          if (!ids.includes(id)) ids.push(id);
        }
        this.db.prepare('INSERT INTO organise_indexed (meeting_id, indexed_at) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET indexed_at = excluded.indexed_at').run(meetingId, this.now());
        this.prunePeople();
      })();
      return ids;
    });
  }

  private prunePeople(): void {
    this.db.prepare(`
      DELETE FROM people
       WHERE id NOT IN (SELECT DISTINCT person_id FROM person_meetings)
         AND (notes IS NULL OR notes = '')
         AND title_source IS NULL AND company_source IS NULL
    `).run();
  }

  /** Saved meetings whose people have not been read yet (oldest first, bounded). */
  unindexedMeetingIds(limit = 200): string[] {
    return this.guard('unindexedMeetingIds', [], () => (this.db.prepare(`
      SELECT m.id FROM meetings m LEFT JOIN organise_indexed oi ON oi.meeting_id = m.id
       WHERE oi.meeting_id IS NULL AND COALESCE(m.is_processed, 1) = 1
       ORDER BY m.start_time ASC LIMIT ?
    `).all(limit) as any[]).map((r) => r.id));
  }

  private personRow(r: any): PersonListRow {
    return {
      id: r.id,
      name: r.name || (r.email ? String(r.email).split('@')[0] : ''),
      email: r.email ?? null,
      title: r.title ?? null,
      company: r.company ?? null,
      companyDomain: companyDomainForEmail(r.email),
      meetingCount: r.n ?? 0,
      lastMetAt: r.last ? new Date(r.last).toISOString() : null,
    };
  }

  private static PEOPLE_SELECT = `
    SELECT p.*, COUNT(pm.meeting_id) AS n, MAX(COALESCE(m.start_time, 0)) AS last
      FROM people p
      LEFT JOIN person_meetings pm ON pm.person_id = p.id
      LEFT JOIN meetings m ON m.id = pm.meeting_id
  `;

  listPeople(query?: string): PersonListRow[] {
    return this.guard('listPeople', [], () => {
      const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
      const rows = this.db.prepare(`${OrganiseStore.PEOPLE_SELECT} GROUP BY p.id ORDER BY last DESC, p.name COLLATE NOCASE ASC LIMIT 2000`).all() as any[];
      return rows
        .map((r) => this.personRow(r))
        .filter((p) => !q || [p.name, p.email, p.title, p.company].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
    });
  }

  getPerson(id: string): PersonDetail | null {
    return this.guard('getPerson', null, () => {
      const r = this.db.prepare(`${OrganiseStore.PEOPLE_SELECT} WHERE p.id = ? GROUP BY p.id`).get(id) as any;
      if (!r) return null;
      const base = this.personRow(r);
      const meetingIds = (this.db.prepare('SELECT meeting_id FROM person_meetings WHERE person_id = ?').all(id) as any[]).map((x) => x.meeting_id);
      const meetings = this.meetingRows(meetingIds, true);
      const actions = this.actionItemsFor([{ id, name: base.name }], meetings);
      const newest = meetings[0];
      const facts = (this.db.prepare(`
        SELECT f.id, f.kind, f.value, f.quote, f.status, f.meeting_id, m.title AS meeting_title
          FROM person_facts f JOIN meetings m ON m.id = f.meeting_id
         WHERE f.person_id = ? AND f.status = 'suggested' ORDER BY f.created_at DESC
      `).all(id) as any[])
        // A suggestion equal to what the person already has is no suggestion.
        .filter((f) => (f.kind === 'title' ? r.title : r.company)?.toLowerCase?.() !== String(f.value).toLowerCase())
        .map((f) => ({ id: f.id, kind: f.kind, value: f.value, quote: f.quote, status: f.status, meetingId: f.meeting_id, meetingTitle: f.meeting_title || '' }));
      return {
        ...base,
        notes: r.notes ?? null,
        titleSource: r.title_source ?? null,
        companySource: r.company_source ?? null,
        meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.date, startMs: m.startMs })),
        openActionItems: actions,
        lastMet: newest ? { meetingId: newest.id, title: newest.title, date: newest.date, recap: oneLineRecap(newest.detailedSummary, newest.title) } : null,
        suggestions: facts,
      };
    });
  }

  /** Open action items owned by any of these people, newest meeting first. */
  private actionItemsFor(people: Array<{ id: string; name: string }>, meetings: Array<{ id: string; title: string; date: string; detailedSummary?: any }>): ActionItemRow[] {
    const out: ActionItemRow[] = [];
    for (const m of meetings) {
      const items = openActionItems(m.detailedSummary);
      if (items.length === 0) continue;
      const inMeeting = (this.db.prepare(`SELECT p.name FROM person_meetings pm JOIN people p ON p.id = pm.person_id WHERE pm.meeting_id = ?`).all(m.id) as any[]).map((x) => ({ name: x.name || '' }));
      for (const item of items) {
        if (!item.owner) continue;
        if (people.some((p) => ownerIsPerson(item.owner, p, inMeeting))) {
          out.push({ ...item, meetingId: m.id, meetingTitle: m.title, date: m.date });
          if (out.length >= 50) return out;
        }
      }
    }
    return out;
  }

  updatePerson(id: string, patch: { name?: unknown; title?: unknown; company?: unknown; notes?: unknown }): boolean {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') return false;
    return this.guard('updatePerson', false, () => {
      const sets: string[] = [];
      const params: any[] = [];
      if (patch.name !== undefined) {
        const n = oneLine(patch.name, NAME_MAX);
        if (n) { sets.push('name = ?', 'name_key = ?'); params.push(n, nameKey(n)); }
      }
      if (patch.title !== undefined) {
        const t = oneLine(patch.title, TITLE_MAX);
        sets.push('title = ?', 'title_source = ?'); params.push(t || null, t ? 'user' : null);
      }
      if (patch.company !== undefined) {
        const c = oneLine(patch.company, TITLE_MAX);
        sets.push('company = ?', 'company_source = ?'); params.push(c || null, c ? 'user' : null);
      }
      if (patch.notes !== undefined) {
        const n = clean(patch.notes, NOTES_MAX);
        sets.push('notes = ?'); params.push(n || null);
      }
      if (sets.length === 0) return false;
      sets.push('updated_at = ?'); params.push(this.now(), id);
      return this.db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...params).changes > 0;
    });
  }

  /** Store a proposed fact (once per person, kind and value). False when it was already known or dismissed. */
  addFact(personId: string, meetingId: string, kind: 'title' | 'company', value: string, quote: string): boolean {
    return this.guard('addFact', false, () => this.db.prepare(`
      INSERT OR IGNORE INTO person_facts (person_id, meeting_id, kind, value, quote, status, created_at) VALUES (?, ?, ?, ?, ?, 'suggested', ?)
    `).run(personId, meetingId, kind, oneLine(value, TITLE_MAX), oneLine(quote, 400), this.now()).changes > 0);
  }

  /** Accept (sets the person's title or company) or dismiss a suggestion. */
  resolveFact(factId: number, accept: boolean): boolean {
    return this.guard('resolveFact', false, () => {
      const f = this.db.prepare('SELECT * FROM person_facts WHERE id = ?').get(factId) as any;
      if (!f) return false;
      this.db.transaction(() => {
        this.db.prepare('UPDATE person_facts SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'dismissed', factId);
        if (accept) {
          const col = f.kind === 'title' ? 'title' : 'company';
          this.db.prepare(`UPDATE people SET ${col} = ?, ${col}_source = 'evidence', updated_at = ? WHERE id = ?`).run(f.value, this.now(), f.person_id);
          // The other suggestions of the same kind are answered by this one.
          this.db.prepare(`UPDATE person_facts SET status = 'dismissed' WHERE person_id = ? AND kind = ? AND id != ? AND status = 'suggested'`).run(f.person_id, f.kind, factId);
        }
      })();
      return true;
    });
  }

  /** The person ids in one meeting, with names (for the fact extractor). */
  peopleOfMeeting(meetingId: string): Array<{ id: string; name: string; email: string | null }> {
    return this.guard('peopleOfMeeting', [], () => (this.db.prepare(`
      SELECT p.id, p.name, p.email FROM person_meetings pm JOIN people p ON p.id = pm.person_id WHERE pm.meeting_id = ?
    `).all(meetingId) as any[]).map((r) => ({ id: r.id, name: r.name || '', email: r.email ?? null })));
  }

  /**
   * What the notes prompt may say about the people on an invite: titles and
   * companies the user typed or accepted, and the user's own notes on them and
   * their company. Nothing proposed-but-unaccepted.
   */
  knownPeopleByEmail(emails: string[]): KnownPerson[] {
    const wanted = [...new Set((emails || []).map(normaliseEmail).filter(Boolean))].slice(0, 200);
    if (wanted.length === 0) return [];
    return this.guard('knownPeopleByEmail', [], () => {
      const ph = wanted.map(() => '?').join(',');
      const rows = this.db.prepare(`SELECT email, name, title, company, notes FROM people WHERE email IN (${ph})`).all(...wanted) as any[];
      const domains = [...new Set(rows.map((r) => companyDomainForEmail(r.email)).filter((d): d is string => !!d))];
      const companies = new Map<string, any>();
      if (domains.length) {
        const cph = domains.map(() => '?').join(',');
        for (const c of this.db.prepare(`SELECT domain, name, notes, description FROM companies WHERE domain IN (${cph})`).all(...domains) as any[]) companies.set(c.domain, c);
      }
      return rows.map((r) => {
        const c = companies.get(companyDomainForEmail(r.email) || '');
        const out: KnownPerson = { email: r.email };
        if (r.name) out.name = r.name;
        if (r.title) out.title = r.title;
        if (r.company) out.company = r.company;
        if (r.notes) out.notes = r.notes;
        if (c?.notes) out.companyNotes = c.notes;
        if (c?.name) out.companyName = c.name;
        return out;
      }).filter((p) => p.title || p.company || p.notes || p.companyNotes);
    });
  }

  // ── Companies ────────────────────────────────────────────────────────────

  /** Companies of the people met, by email domain; personal mail and the user's own domain left out. */
  listCompanies(opts: { excludeDomain?: string | null; query?: string } = {}): CompanyListRow[] {
    return this.guard('listCompanies', [], () => {
      const exclude = opts.excludeDomain ? (companyDomainForEmail(`x@${opts.excludeDomain}`) || opts.excludeDomain.toLowerCase()) : null;
      const people = this.listPeople();
      const saved = new Map<string, any>((this.db.prepare('SELECT domain, name FROM companies').all() as any[]).map((c) => [c.domain, c]));
      const groups = new Map<string, { people: PersonListRow[]; meetings: Set<string>; last: number }>();
      const meetingsOf = this.db.prepare('SELECT meeting_id FROM person_meetings WHERE person_id = ?');
      for (const p of people) {
        const d = p.companyDomain;
        if (!d || d === exclude) continue;
        const g = groups.get(d) || { people: [], meetings: new Set<string>(), last: 0 };
        g.people.push(p);
        for (const m of meetingsOf.all(p.id) as any[]) g.meetings.add(m.meeting_id);
        g.last = Math.max(g.last, p.lastMetAt ? Date.parse(p.lastMetAt) : 0);
        groups.set(d, g);
      }
      const q = typeof opts.query === 'string' ? opts.query.trim().toLowerCase() : '';
      return [...groups.entries()]
        .map(([domain, g]) => ({
          domain,
          name: saved.get(domain)?.name || companyNameFromDomain(domain),
          peopleCount: g.people.length,
          meetingCount: g.meetings.size,
          lastMetAt: g.last ? new Date(g.last).toISOString() : null,
        }))
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.domain.includes(q))
        .sort((a, b) => (Date.parse(b.lastMetAt || '') || 0) - (Date.parse(a.lastMetAt || '') || 0));
    });
  }

  getCompany(domain: string): CompanyDetail | null {
    const d = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    if (!d) return null;
    return this.guard('getCompany', null, () => {
      const people = this.listPeople().filter((p) => p.companyDomain === d);
      if (people.length === 0) return null;
      const row = this.db.prepare('SELECT * FROM companies WHERE domain = ?').get(d) as any;
      const ids = new Set<string>();
      const q = this.db.prepare('SELECT meeting_id FROM person_meetings WHERE person_id = ?');
      for (const p of people) for (const m of q.all(p.id) as any[]) ids.add(m.meeting_id);
      const meetings = this.meetingRows([...ids], true);
      const last = meetings[0]?.startMs || 0;
      return {
        domain: d,
        name: row?.name || companyNameFromDomain(d),
        peopleCount: people.length,
        meetingCount: meetings.length,
        lastMetAt: last ? new Date(last).toISOString() : null,
        description: row?.description ?? null,
        descriptionSource: row?.description_source ?? null,
        notes: row?.notes ?? null,
        people,
        meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.date, startMs: m.startMs })),
        openActionItems: this.actionItemsFor(people.map((p) => ({ id: p.id, name: p.name })), meetings),
      };
    });
  }

  updateCompany(domain: string, patch: { name?: unknown; description?: unknown; descriptionSource?: 'user' | 'drafted' | 'clearbit'; notes?: unknown }): boolean {
    const d = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return false;
    return this.guard('updateCompany', false, () => {
      const ts = this.now();
      this.db.prepare('INSERT OR IGNORE INTO companies (domain, created_at, updated_at) VALUES (?, ?, ?)').run(d, ts, ts);
      const sets: string[] = [];
      const params: any[] = [];
      if (patch.name !== undefined) { const n = oneLine(patch.name, NAME_MAX); sets.push('name = ?'); params.push(n || null); }
      if (patch.description !== undefined) {
        const t = clean(patch.description, DESCRIPTION_MAX);
        sets.push('description = ?', 'description_source = ?'); params.push(t || null, t ? (patch.descriptionSource === 'drafted' ? 'drafted' : 'user') : null);
      }
      if (patch.notes !== undefined) { const n = clean(patch.notes, NOTES_MAX); sets.push('notes = ?'); params.push(n || null); }
      if (sets.length === 0) return false;
      sets.push('updated_at = ?'); params.push(ts, d);
      return this.db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE domain = ?`).run(...params).changes > 0;
    });
  }

  /** Notes text of a company's meetings, for the description draft (bounded by the caller). */
  companyMeetingSummaries(domain: string): Array<{ id: string; title: string; date: string; detailedSummary: any }> {
    const detail = this.getCompany(domain);
    if (!detail) return [];
    return this.guard('companyMeetingSummaries', [], () => this.meetingRows(detail.meetings.map((m) => m.id), true)
      .map((m) => ({ id: m.id, title: m.title, date: m.date, detailedSummary: m.detailedSummary })));
  }
}
